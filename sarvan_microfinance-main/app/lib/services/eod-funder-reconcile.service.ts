import type { Prisma } from '@prisma/client';
import { buildFunderLedgerNames } from '@/app/lib/gl-config';
import { getKolkataCalendarYmd } from '@/app/lib/branch-lock';
import { EOD_FUNDER_POSTING_MARKER_PREFIX } from '@/app/lib/services/accounting-posting.service';
import {
    applyVoucherMove,
    eodMarkerFor,
    refreshEodFunderDescriptions,
    round2,
    type VoucherMove,
} from '@/app/lib/services/loan-funder-change.service';

type Db = Prisma.TransactionClient;

/**
 * GL reconcile (Super Control) — for every EOD day of a branch, compares what each funder's EOD
 * vouchers hold in the GL with what the funder's loans actually collected (LoanTransaction side),
 * and moves the surplus from the over-posted funder ledger to the under-posted one.
 *
 * Only misallocation between funders is fixed: a day/component whose GL total differs from the
 * collected total is reported and left alone. Legacy ":GOLD" / description-marker vouchers are
 * out of scope here (handled by the old-ledger flow of Bulk Funder Change).
 */

const EPS = 0.005;
const MARKER_RE = /^\[POSTING:EOD_FUNDER:[^:]+:(\d{4}-\d{2}-\d{2}):([^:\]]+)\]$/;

export interface ReconcilePlan {
    moves: VoucherMove[];
    /** Day/component groups that cannot be fixed by moving money between funders. */
    skipped: string[];
}

const keyToFunderId = (key: string) => (key === 'OWN' ? null : key);

export async function buildReconcilePlan(db: Db, branchId: string): Promise<ReconcilePlan> {
    const funders = await db.funder.findMany({ select: { id: true, funderName: true } });
    const nameOf = new Map(funders.map((f) => [f.id, f.funderName]));
    const ledgerNameFor = (key: string, component: 'PRINCIPAL' | 'INTEREST') => {
        const names = buildFunderLedgerNames(key === 'OWN' ? null : nameOf.get(key) ?? null, false);
        return component === 'PRINCIPAL' ? names.principal : names.interest;
    };
    const norm = (n: string) => n.toUpperCase().replace(/\s+/g, ' ').trim();

    // Loan side: what each funder LEDGER should hold per day (EOD-allocated, approved, not reversed).
    // Two funder keys can share one ledger (no funder → "OWN FUND"), so everything is keyed by ledger name.
    const txns = await db.loanTransaction.findMany({
        where: {
            status: 'APPROVED',
            isReversed: false,
            eodAllocatedAt: { not: null },
            type: { in: ['REPAYMENT', 'PRECLOSURE', 'WRITEOFF'] },
            loan: { branchId },
        },
        select: { transactionDate: true, principalAmount: true, interestAmount: true, loan: { select: { funderId: true } } },
    });
    const bump = (m: Map<string, number>, k: string, v: number) => m.set(k, round2((m.get(k) ?? 0) + v));
    const expected = new Map<string, number>(); // `${ymd}|${LEDGER}|P/I`
    const ledgerKey = new Map<string, string>(); // LEDGER -> a funder key that owns it (for the target marker)
    for (const t of txns) {
        const ymd = getKolkataCalendarYmd(t.transactionDate);
        const key = t.loan.funderId ?? 'OWN';
        const pl = norm(ledgerNameFor(key, 'PRINCIPAL'));
        const il = norm(ledgerNameFor(key, 'INTEREST'));
        bump(expected, `${ymd}|${pl}|P`, Number(t.principalAmount ?? 0));
        bump(expected, `${ymd}|${il}|I`, Number(t.interestAmount ?? 0));
        ledgerKey.set(pl, key);
        ledgerKey.set(il, key);
    }
    for (const f of funders) {
        for (const c of ['PRINCIPAL', 'INTEREST'] as const) {
            const l = norm(ledgerNameFor(f.id, c));
            if (!ledgerKey.has(l)) ledgerKey.set(l, f.id);
        }
    }

    // GL side: current EOD_FUNDER vouchers, per ledger.
    const vouchers = await db.financialTransaction.findMany({
        where: {
            branchId,
            isActive: true,
            type: 'CASH_RECEIPT',
            postingMarker: { startsWith: `${EOD_FUNDER_POSTING_MARKER_PREFIX}${branchId}:` },
        },
        select: { id: true, voucherNo: true, amount: true, postingMarker: true, ledger: { select: { ledgerName: true } } },
        orderBy: { createdAt: 'asc' },
    });
    const actual = new Map<string, number>();
    const byGroup = new Map<string, { id: string; voucherNo: string; left: number; marker: string; ledgerName: string }[]>();
    for (const v of vouchers) {
        const m = MARKER_RE.exec(v.postingMarker ?? '');
        const ledgerName = v.ledger?.ledgerName ?? '';
        const comp = /PRINCIPAL\s*$/i.test(ledgerName) ? 'P' : /INTEREST\s*$/i.test(ledgerName) ? 'I' : null;
        if (!m || !comp) continue;
        const g = `${m[1]}|${norm(ledgerName)}|${comp}`;
        bump(actual, g, Number(v.amount));
        const list = byGroup.get(g) ?? [];
        list.push({ id: v.id, voucherNo: v.voucherNo, left: Number(v.amount), marker: v.postingMarker!, ledgerName });
        byGroup.set(g, list);
    }

    const moves: VoucherMove[] = [];
    const skipped: string[] = [];
    const rows = new Map<string, Set<string>>(); // `${ymd}|${comp}` -> ledgers
    for (const k of [...expected.keys(), ...actual.keys()]) {
        const [ymd, ledger, comp] = k.split('|');
        const dc = `${ymd}|${comp}`;
        rows.set(dc, (rows.get(dc) ?? new Set()).add(ledger));
    }

    for (const dc of [...rows.keys()].sort()) {
        const [ymd, comp] = dc.split('|');
        const diffs = [...rows.get(dc)!].map((ledger) => ({
            ledger,
            diff: round2((actual.get(`${ymd}|${ledger}|${comp}`) ?? 0) - (expected.get(`${ymd}|${ledger}|${comp}`) ?? 0)),
        }));
        if (diffs.every((d) => Math.abs(d.diff) <= EPS)) continue;

        const net = round2(diffs.reduce((sum, d) => sum + d.diff, 0));
        if (Math.abs(net) > EPS) {
            skipped.push(`${ymd} ${comp === 'P' ? 'principal' : 'interest'}: GL total differs from collections by ₹${net} — not a funder mix-up, left as is.`);
            continue;
        }

        const component = comp === 'P' ? 'PRINCIPAL' : 'INTEREST';
        const surplus = diffs.filter((d) => d.diff > EPS).map((d) => ({ ...d }));
        const deficit = diffs.filter((d) => d.diff < -EPS).map((d) => ({ ledger: d.ledger, need: -d.diff }));
        for (const need of deficit) {
            const toKey = ledgerKey.get(need.ledger);
            if (!toKey) continue;
            for (const sp of surplus) {
                if (need.need <= EPS) break;
                const give = Math.min(sp.diff, need.need);
                if (give <= EPS) continue;
                let remaining = give;
                for (const src of byGroup.get(`${ymd}|${sp.ledger}|${comp}`) ?? []) {
                    if (remaining <= EPS) break;
                    const take = Math.min(src.left, remaining);
                    if (take <= EPS) continue;
                    src.left = round2(src.left - take);
                    remaining = round2(remaining - take);
                    moves.push({
                        group: 'EOD_FUNDER',
                        component,
                        date: ymd,
                        amount: round2(take),
                        fromVoucherId: src.id,
                        fromVoucherNo: src.voucherNo,
                        fromLedgerName: src.ledgerName,
                        toLedgerName: ledgerNameFor(toKey, component),
                        fromMarker: src.marker,
                        toMarker: eodMarkerFor('EOD_FUNDER', branchId, ymd, toKey),
                        markerInColumn: true,
                    });
                }
                sp.diff = round2(sp.diff - (give - remaining));
                need.need = round2(need.need - (give - remaining));
            }
        }
    }

    return { moves, skipped };
}

export async function applyReconcilePlan(db: Db, branchId: string, plan: ReconcilePlan, params: { changedById: string; reason: string }) {
    const touched = new Set<string>(); // `${ymd}|${funderKey}`
    for (const move of plan.moves) {
        await applyVoucherMove(db, move, {
            loanNumber: '',
            changedById: params.changedById,
            remarks: `GL reconcile (Super Control): ₹${move.amount} moved ${move.fromLedgerName} → ${move.toLedgerName}. Reason: ${params.reason}`,
        });
        const from = MARKER_RE.exec(move.fromMarker)?.[2];
        const to = MARKER_RE.exec(move.toMarker)?.[2];
        if (from) touched.add(`${move.date}|${from}`);
        if (to) touched.add(`${move.date}|${to}`);
    }
    for (const t of touched) {
        const [ymd, key] = t.split('|');
        await refreshEodFunderDescriptions(db, branchId, ymd, keyToFunderId(key));
    }
    return { movedVoucherCount: plan.moves.length };
}
