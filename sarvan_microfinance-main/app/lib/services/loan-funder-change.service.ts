import type { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import {
    GL_DEFAULT_GROUPS,
    buildFunderLedgerNames,
    getNextVoucherNo,
    resolveOrCreateLedger,
} from '@/app/lib/gl-config';
import {
    getKolkataCalendarYmd,
    getKolkataDayEndExclusiveUtc,
    parseKolkataAttendanceDateYmd,
} from '@/app/lib/branch-lock';
import { INDEX_DISBURSEMENT_POSTING_MARKER_PREFIX, EOD_FUNDER_POSTING_MARKER_PREFIX } from '@/app/lib/services/accounting-posting.service';
import { isGoldLoanProduct } from '@/app/lib/gl-config';
import { buildEodClosureMarker } from '@/app/lib/eod-closure-allocation';

type Db = Prisma.TransactionClient;

/**
 * Individual Funder Change (Super Control) — change the funder of an already-disbursed loan and
 * re-home every GL voucher that was posted under the OLD funder's ledgers, so the books read
 * exactly as if the loan had always belonged to the new funder (original dates, original
 * vouchers — no reclass journal; the business asked for the originals to be rewritten).
 *
 * The funder lives only on `Loan.funderId` — LoanTransaction/LoanSchedule carry no funder, and
 * every funder-wise report derives it live from the loan. What IS stored per-funder is the GL:
 *   1. DISBURSEMENT  — one CASH_PAYMENT per index+funder ("{FUNDER} PRINCIPAL"), marker
 *                      `[POSTING:INDEX_DISBURSEMENT:{indexId}]` in `postingMarker`.
 *   2. EOD_FUNDER    — one CASH_RECEIPT pair per branch+date+funder (principal / interest),
 *                      marker in `postingMarker`.
 *   3. Legacy EOD_COLLECTION / EOD_PRECLOSURE / EOD_WRITEOFF vouchers — same idea, but the
 *                      marker is embedded in `description` as "{marker} {ledger name}".
 *
 * `buildFunderChangePlan` is read-only (drives the preview); `applyFunderChangePlan` performs
 * the rewrite and MUST run inside one `prisma.$transaction`.
 */

export type VoucherGroup = 'DISBURSEMENT' | 'EOD_FUNDER' | 'EOD_COLLECTION' | 'EOD_PRECLOSURE' | 'EOD_WRITEOFF';

export interface VoucherMove {
    group: VoucherGroup;
    component: 'PRINCIPAL' | 'INTEREST';
    /** Kolkata calendar day (YYYY-MM-DD) the voucher bucket belongs to. */
    date: string;
    amount: number;
    fromVoucherId: string;
    fromVoucherNo: string;
    fromLedgerName: string;
    toLedgerName: string;
    /** Marker the voucher is found by today / will carry after the move. */
    fromMarker: string;
    toMarker: string;
    /** true → marker lives in `postingMarker`; false → embedded in `description`. */
    markerInColumn: boolean;
}

export interface FunderChangePlan {
    loanId: string;
    loanNumber: string;
    branchId: string;
    loanAmount: number;
    oldFunderId: string | null;
    oldFunderName: string;
    newFunderId: string;
    newFunderName: string;
    moves: VoucherMove[];
    /** Money that should have a voucher but none could be matched — needs a human look. */
    warnings: string[];
}

export const round2 = (n: number) => Number(n.toFixed(2));
const EPS = 0.005;
const funderKey = (id: string | null) => id ?? 'OWN';

const EOD_COLLECTION_PREFIX = '[POSTING:EOD_COLLECTION:';

export function eodMarkerFor(group: VoucherGroup, branchId: string, ymd: string, key: string): string {
    switch (group) {
        case 'EOD_FUNDER':
            return `${EOD_FUNDER_POSTING_MARKER_PREFIX}${branchId}:${ymd}:${key}]`;
        case 'EOD_COLLECTION':
            return `${EOD_COLLECTION_PREFIX}${branchId}:${ymd}:${key}]`;
        case 'EOD_PRECLOSURE':
            return buildEodClosureMarker(branchId, ymd, key, 'PRECLOSURE');
        case 'EOD_WRITEOFF':
            return buildEodClosureMarker(branchId, ymd, key, 'WRITEOFF');
        default:
            throw new Error(`No EOD marker for ${group}`);
    }
}

/** Loan numbers appear in the disbursement voucher description as parseInt'ed, comma-joined. */
const DISBURSEMENT_DESC_RE = /^([\s\S]*:\s*)([\d,\s]*?)\s*\(Members:\s*(\d+)\)\s*$/;

/** Older vouchers list loans as "Loan Nos: LN26000072,LN26000071" or "Loan Numbers : 26000077,26000078". */
const LEGACY_LIST_RE = /(Loan Nos?:|Loan Numbers\s*:)\s*([^\n(]*)/i;

const sameLoan = (item: string, loanNumber: string) =>
    item.trim().toUpperCase() === loanNumber.toUpperCase() ||
    String(parseInt(item.replace(/^LN/i, ''), 10)) === String(parseInt(loanNumber.replace(/^LN/i, ''), 10));

function editDisbursementDescription(desc: string | null, loanNumber: string, mode: 'remove' | 'add' | 'only'): string | null {
    if (!desc) return desc;
    const m = DISBURSEMENT_DESC_RE.exec(desc);
    if (!m) {
        const lm = LEGACY_LIST_RE.exec(desc);
        if (!lm) return desc;
        let items = lm[2].split(',').map((x) => x.trim()).filter(Boolean);
        if (mode === 'remove') items = items.filter((x) => !sameLoan(x, loanNumber));
        else if (mode === 'only') items = [loanNumber];
        else if (!items.some((x) => sameLoan(x, loanNumber))) items.push(loanNumber);
        return desc.replace(lm[0], `${lm[1]} ${items.join(',')}${/\s$/.test(lm[2]) ? ' ' : ''}`);
    }
    if (mode === 'only') return desc.replace(DISBURSEMENT_DESC_RE, (_m, head: string) => `${head}${parseInt(loanNumber, 10)} (Members: 1)`);
    const numKey = parseInt(loanNumber, 10).toString();
    let nums = m[2].split(',').map((s) => s.trim()).filter(Boolean);
    if (mode === 'remove') nums = nums.filter((n) => n !== numKey);
    else if (!nums.includes(numKey)) nums.push(numKey);
    nums.sort((a, b) => Number(a) - Number(b));
    return `${m[1]}${nums.join(',')} (Members: ${nums.length})`;
}

const ledgerNameMatch = (name: string) => ({ ledgerName: { equals: name, mode: 'insensitive' as const } });

const normalizeLedgerName = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Every ledger that is the same funder ledger under an older spelling — e.g. "OWN FUND GOLD PRINCIPAL"
 * vs "OWN FUND - GOLD PRINCIPAL" (a funder renamed after vouchers were posted). Names match when
 * equal ignoring case, spaces and punctuation.
 */
async function ledgerAliasNames(db: Db, name: string): Promise<string[]> {
    const target = normalizeLedgerName(name);
    const head = name.trim().split(/\s+/)[0] ?? name;
    const candidates = await db.accountLedger.findMany({
        where: { ledgerName: { contains: head, mode: 'insensitive' } },
        select: { ledgerName: true },
    });
    const names = candidates.map((c) => c.ledgerName).filter((n) => normalizeLedgerName(n) === target);
    return names.length > 0 ? names : [name];
}

const ledgerNamesMatch = (names: string[]) => ({ OR: names.map((n) => ledgerNameMatch(n)) });

const POSTING_TAG_RE = /\[POSTING:[^\]]+\]/;

/** Does a voucher's marker / description name this loan? (`-LN26000047-`, "LN26000047", or the bare 26000047) */
function voucherMentionsLoan(text: string, loanNumber: string): boolean {
    const full = loanNumber.toUpperCase();
    const bare = String(parseInt(loanNumber.replace(/^LN/i, ''), 10));
    const upper = text.toUpperCase();
    const hit = (needle: string) => {
        let i = upper.indexOf(needle);
        while (i !== -1) {
            const before = upper[i - 1];
            const after = upper[i + needle.length];
            if (!(before && /[0-9A-Z]/.test(before)) && !(after && /[0-9]/.test(after))) return true;
            i = upper.indexOf(needle, i + 1);
        }
        return false;
    };
    return hit(full) || hit(bare);
}

interface FoundVoucher {
    id: string;
    voucherNo: string;
    amount: Prisma.Decimal;
    ledgerName: string;
    marker: string | null;
    markerInColumn: boolean;
}

/**
 * Last-resort match for vouchers posted in older formats (per-loan `[POSTING:DISBURSEMENT:TXN-BKP-LN…]`,
 * "Loan Nos: LN…" groups, `…:OWN:GOLD` EOD markers) that sit in an older-named funder ledger.
 */
async function findLegacyVouchers(
    db: Db,
    where: Prisma.FinancialTransactionWhereInput,
    ledgerNames: string[]
): Promise<(FoundVoucher & { text: string })[]> {
    const rows = await db.financialTransaction.findMany({
        where: { ...where, isActive: true, ledger: ledgerNamesMatch(ledgerNames) },
        select: { id: true, voucherNo: true, amount: true, postingMarker: true, description: true, ledger: { select: { ledgerName: true } } },
        orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => {
        const text = `${r.postingMarker ?? ''} ${r.description ?? ''}`;
        return {
            id: r.id,
            voucherNo: r.voucherNo,
            amount: r.amount,
            ledgerName: r.ledger?.ledgerName ?? '',
            marker: r.postingMarker ?? POSTING_TAG_RE.exec(r.description ?? '')?.[0] ?? null,
            markerInColumn: Boolean(r.postingMarker),
            text,
        };
    });
}

/**
 * `legacyLedgerAlias` = GL-only fix: the loan keeps its funder, but vouchers posted under an older /
 * misspelt ledger name of that SAME funder (e.g. "OWN FUND GOLD") are moved to the funder's proper ledgers.
 */
export async function buildFunderChangePlan(
    db: Db,
    loanId: string,
    newFunderId: string,
    opts: { legacyLedgerAlias?: string } = {}
): Promise<FunderChangePlan> {
    const legacyAlias = opts.legacyLedgerAlias?.trim() || null;
    const loan = await db.loan.findUnique({
        where: { id: loanId },
        select: {
            id: true,
            loanNumber: true,
            branchId: true,
            indexId: true,
            amount: true,
            funderId: true,
            disbursementStatus: true,
            funder: { select: { funderName: true } },
            loanProduct: { select: { loanProductType: { select: { name: true } } } },
        },
    });
    if (!loan) throw new Error('Loan not found');
    if (loan.disbursementStatus !== 'DISBURSED' && loan.disbursementStatus !== 'CLOSED') {
        throw new Error('Funder can only be changed on a disbursed or closed loan');
    }
    if (!legacyAlias && loan.funderId === newFunderId) throw new Error('Loan is already under this funder');

    const newFunder = await db.funder.findUnique({ where: { id: newFunderId }, select: { id: true, funderName: true, isActive: true } });
    if (!newFunder || !newFunder.isActive) throw new Error('Selected funder not found or inactive');

    const oldName = loan.funder?.funderName ?? null;
    const oldNames = buildFunderLedgerNames(legacyAlias ?? oldName, false);
    const newNames = buildFunderLedgerNames(newFunder.funderName, false);
    // GL-only fix: the alias match ignores punctuation, so it would also pick up the target funder's own
    // ledger ("OWN FUND - GOLD …") and "move" a voucher onto itself, leaving the old ledger undrained.
    const excludeTarget = async (oldName: string, targetName: string) => {
        const names = await ledgerAliasNames(db, oldName);
        if (!legacyAlias || targetName.toLowerCase() === oldName.toLowerCase()) return names;
        const rest = names.filter((n) => n.toLowerCase() !== targetName.toLowerCase());
        return rest.length > 0 ? rest : [oldName];
    };
    const oldPrincipalAliases = await excludeTarget(oldNames.principal, newNames.principal);
    const oldInterestAliases = await excludeTarget(oldNames.interest, newNames.interest);
    const oldKey = funderKey(loan.funderId);
    // Older EOD markers were keyed by the funder the loan had WHEN POSTED, with a ":GOLD" suffix for gold loans.
    const firstChange = await db.loanFunderChangeLog.findFirst({ where: { loanId }, orderBy: { createdAt: 'asc' }, select: { oldFunderId: true } });
    const originalKey = funderKey(firstChange ? firstChange.oldFunderId : loan.funderId);
    const isGoldLoan = isGoldLoanProduct(loan.loanProduct?.loanProductType?.name);
    const newKey = funderKey(newFunder.id);
    const loanAmount = Number(loan.amount);

    const moves: VoucherMove[] = [];
    const warnings: string[] = [];

    // 1. Disbursement leg (CASH_PAYMENT under the index's marker).
    if (loan.indexId && loanAmount > 0) {
        const marker = `${INDEX_DISBURSEMENT_POSTING_MARKER_PREFIX}${loan.indexId}]`;
        const vouchers = await db.financialTransaction.findMany({
            where: { postingMarker: marker, isActive: true, type: 'CASH_PAYMENT', ledger: ledgerNamesMatch(oldPrincipalAliases) },
            select: { id: true, voucherNo: true, amount: true, transactionDate: true },
            orderBy: { createdAt: 'asc' },
        });
        let v = vouchers.find((x) => Number(x.amount) + EPS >= loanAmount);
        let moveAmount = loanAmount;
        if (!v && legacyAlias) {
            // earlier transfers drained most of the voucher — sweep what is left instead of leaving it stranded
            v = vouchers.find((x) => Number(x.amount) > EPS);
            if (v) {
                moveAmount = round2(Number(v.amount));
                warnings.push(`Old-ledger disbursement voucher ${v.voucherNo} holds only ₹${moveAmount} (loan ₹${loanAmount}) — the remaining ₹${moveAmount} is moved to this loan's funder ledger.`);
            }
        }
        if (v) {
            moves.push({
                group: 'DISBURSEMENT',
                component: 'PRINCIPAL',
                date: getKolkataCalendarYmd(v.transactionDate),
                amount: moveAmount,
                fromVoucherId: v.id,
                fromVoucherNo: v.voucherNo,
                fromLedgerName: oldNames.principal,
                toLedgerName: newNames.principal,
                fromMarker: marker,
                toMarker: marker,
                markerInColumn: true,
            });
        } else if (!legacyAlias) {
            warnings.push(`Disbursement voucher ("${oldNames.principal}", ₹${loanAmount}) not found under index marker — GL disbursement leg left as is.`);
        }
    }

    // 1b. Older-format disbursement vouchers (per-loan TXN-BKP marker, "Loan Nos: LN…" groups, backfill).
    if (loanAmount > 0 && !moves.some((m) => m.group === 'DISBURSEMENT')) {
        const candidates = await findLegacyVouchers(db, { branchId: loan.branchId, type: 'CASH_PAYMENT' }, oldPrincipalAliases);
        const v = candidates.find((x) => Number(x.amount) + EPS >= loanAmount && voucherMentionsLoan(x.text, loan.loanNumber));
        if (v) {
            const marker = v.marker ?? '';
            // drop the "not found under index marker" warning now that the leg is matched
            const wi = warnings.findIndex((w) => w.startsWith('Disbursement voucher'));
            if (wi >= 0) warnings.splice(wi, 1);
            moves.push({
                group: 'DISBURSEMENT',
                component: 'PRINCIPAL',
                date: getKolkataCalendarYmd(
                    (await db.financialTransaction.findUnique({ where: { id: v.id }, select: { transactionDate: true } }))!.transactionDate
                ),
                amount: loanAmount,
                fromVoucherId: v.id,
                fromVoucherNo: v.voucherNo,
                fromLedgerName: v.ledgerName,
                toLedgerName: newNames.principal,
                fromMarker: marker,
                toMarker: marker,
                markerInColumn: v.markerInColumn,
            });
        }
    }

    // 2. EOD collection / closure allocations, grouped per Kolkata day + transaction family.
    const txns = await db.loanTransaction.findMany({
        where: {
            loanId,
            status: 'APPROVED',
            isReversed: false,
            eodAllocatedAt: { not: null },
            type: { in: ['REPAYMENT', 'PRECLOSURE', 'WRITEOFF'] },
        },
        select: { type: true, transactionDate: true, principalAmount: true, interestAmount: true },
    });
    const buckets = new Map<string, { ymd: string; type: 'REPAYMENT' | 'PRECLOSURE' | 'WRITEOFF'; principal: number; interest: number }>();
    for (const t of txns) {
        const ymd = getKolkataCalendarYmd(t.transactionDate);
        const type = t.type as 'REPAYMENT' | 'PRECLOSURE' | 'WRITEOFF';
        const k = `${ymd}|${type}`;
        const b = buckets.get(k) ?? { ymd, type, principal: 0, interest: 0 };
        b.principal += Number(t.principalAmount ?? 0);
        b.interest += Number(t.interestAmount ?? 0);
        buckets.set(k, b);
    }

    // A voucher can only be drained once per plan — track what each already gave up so two
    // buckets of the same loan never over-draw it.
    const drained = new Map<string, number>();

    for (const b of [...buckets.values()].sort((a, c) => a.ymd.localeCompare(c.ymd))) {
        for (const component of ['PRINCIPAL', 'INTEREST'] as const) {
            const amount = round2(component === 'PRINCIPAL' ? b.principal : b.interest);
            if (amount <= 0) continue;
            const fromName = component === 'PRINCIPAL' ? oldNames.principal : oldNames.interest;
            const toName = component === 'PRINCIPAL' ? newNames.principal : newNames.interest;
            const legacyGroup: VoucherGroup = b.type === 'REPAYMENT' ? 'EOD_COLLECTION' : b.type === 'PRECLOSURE' ? 'EOD_PRECLOSURE' : 'EOD_WRITEOFF';

            let found: { id: string; voucherNo: string; amount: Prisma.Decimal } | undefined;
            let group: VoucherGroup = 'EOD_FUNDER';
            let inColumn = true;

            const funderMarker = eodMarkerFor('EOD_FUNDER', loan.branchId, b.ymd, oldKey);
            const funderVouchers = await db.financialTransaction.findMany({
                where: { postingMarker: funderMarker, isActive: true, ledger: ledgerNamesMatch(component === 'PRINCIPAL' ? oldPrincipalAliases : oldInterestAliases) },
                select: { id: true, voucherNo: true, amount: true },
                orderBy: { createdAt: 'asc' },
            });
            found = funderVouchers.find((x) => Number(x.amount) - (drained.get(x.id) ?? 0) + EPS >= amount);

            if (!found) {
                const legacyMarker = eodMarkerFor(legacyGroup, loan.branchId, b.ymd, oldKey);
                const legacyVouchers = await db.financialTransaction.findMany({
                    where: {
                        isActive: true,
                        OR: (component === 'PRINCIPAL' ? oldPrincipalAliases : oldInterestAliases).map((n) => ({
                            description: { contains: `${legacyMarker} ${n}`, mode: 'insensitive' as const },
                        })),
                    },
                    select: { id: true, voucherNo: true, amount: true },
                    orderBy: { createdAt: 'asc' },
                });
                found = legacyVouchers.find((x) => Number(x.amount) - (drained.get(x.id) ?? 0) + EPS >= amount);
                if (found) {
                    group = legacyGroup;
                    inColumn = false;
                }
            }

            let foundLedgerName: string = fromName;
            let foundMarker: string | null = null;
            let foundInColumn: boolean | null = null;

            if (!found && isGoldLoan) {
                // Older gold-loan markers: `…:{ymd}:{funder key at posting}:GOLD` — match day + original funder key.
                const aliasNames = component === 'PRINCIPAL' ? oldPrincipalAliases : oldInterestAliases;
                const dayVouchers = await findLegacyVouchers(db, { branchId: loan.branchId, type: 'CASH_RECEIPT' }, aliasNames);
                const dayHit = dayVouchers
                    .filter(
                        (x) =>
                            x.text.includes('EOD') &&
                            (x.text.includes(`:${b.ymd}:${originalKey}:GOLD`) || (!firstChange && x.text.includes(`:${b.ymd}:OWN:GOLD`)))
                    )
                    .find((x) => Number(x.amount) - (drained.get(x.id) ?? 0) + EPS >= amount);
                if (dayHit) {
                    found = dayHit;
                    foundLedgerName = dayHit.ledgerName;
                    foundMarker = dayHit.marker;
                    foundInColumn = dayHit.markerInColumn;
                    const tag = (dayHit.marker ?? '').match(/POSTING:(EOD_[A-Z]+)/)?.[1];
                    group = tag === 'EOD_FUNDER' || tag === 'EOD_COLLECTION' || tag === 'EOD_PRECLOSURE' || tag === 'EOD_WRITEOFF' ? tag : legacyGroup;
                    inColumn = dayHit.markerInColumn;
                }
            }

            if (!found) {
                if (!legacyAlias) warnings.push(`${b.ymd} ${b.type} ${component.toLowerCase()} ₹${amount}: no active "${fromName}" voucher found to move — GL left as is.`);
                continue;
            }
            drained.set(found.id, (drained.get(found.id) ?? 0) + amount);
            moves.push({
                group,
                component,
                date: b.ymd,
                amount,
                fromVoucherId: found.id,
                fromVoucherNo: found.voucherNo,
                fromLedgerName: foundLedgerName,
                toLedgerName: toName,
                fromMarker: foundMarker ?? eodMarkerFor(group, loan.branchId, b.ymd, oldKey),
                toMarker: eodMarkerFor(group, loan.branchId, b.ymd, newKey),
                markerInColumn: foundInColumn ?? inColumn,
            });
        }
    }

    // GL-only legacy-ledger fix: a loan with nothing under the old ledger is simply a no-op.
    if (legacyAlias && moves.length === 0) warnings.length = 0;

    return {
        loanId: loan.id,
        loanNumber: loan.loanNumber,
        branchId: loan.branchId,
        loanAmount,
        oldFunderId: loan.funderId,
        oldFunderName: oldName ?? 'OWN FUND',
        newFunderId: newFunder.id,
        newFunderName: newFunder.funderName,
        moves,
        warnings,
    };
}

/** Rebuilds the Collection / Pre-Closed / Closed Loan breakdown text of EOD_FUNDER vouchers. */
export async function refreshEodFunderDescriptions(db: Db, branchId: string, ymd: string, funderId: string | null) {
    const marker = eodMarkerFor('EOD_FUNDER', branchId, ymd, funderKey(funderId));
    const vouchers = await db.financialTransaction.findMany({
        where: { postingMarker: marker, isActive: true },
        select: { id: true, description: true },
    });
    if (vouchers.length === 0) return;

    const dayStart = parseKolkataAttendanceDateYmd(ymd);
    const tagged = await db.loanTransaction.findMany({
        where: {
            branchId,
            type: { in: ['REPAYMENT', 'PRECLOSURE', 'WRITEOFF'] },
            isReversed: false,
            eodAllocatedAt: { not: null },
            transactionDate: { gte: dayStart, lt: getKolkataDayEndExclusiveUtc(dayStart) },
            loan: funderId ? { funderId } : { funderId: null },
        },
        select: { type: true, principalAmount: true, interestAmount: true },
    });
    const sum = (type: string, field: 'principalAmount' | 'interestAmount') =>
        round2(tagged.filter((t) => t.type === type).reduce((s, t) => s + Number(t[field] ?? 0), 0));
    const lines = (field: 'principalAmount' | 'interestAmount') => {
        const out: string[] = [];
        if (sum('REPAYMENT', field) > 0) out.push(`Collection: ₹${sum('REPAYMENT', field).toFixed(2)}`);
        if (sum('PRECLOSURE', field) > 0) out.push(`Pre-Closed: ₹${sum('PRECLOSURE', field).toFixed(2)}`);
        if (sum('WRITEOFF', field) > 0) out.push(`Closed Loan: ₹${sum('WRITEOFF', field).toFixed(2)}`);
        return out.join('\n');
    };

    for (const v of vouchers) {
        const head = (v.description ?? '').split('\n')[0];
        const isPrincipal = /PRINCIPAL\s*$/i.test(head);
        const isInterest = /INTEREST\s*$/i.test(head);
        if (!isPrincipal && !isInterest) continue;
        const field = isPrincipal ? 'principalAmount' : 'interestAmount';
        await db.financialTransaction.update({
            where: { id: v.id },
            data: { description: `${head}\n\nEOD ${isPrincipal ? 'Principal' : 'Interest'} Amount Collected on ${ymd}\n${lines(field)}` },
        });
    }
}

/** Re-homes `move.amount` of one voucher into the target ledger/voucher (shared by funder change and GL reconcile). */
export async function applyVoucherMove(
    db: Db,
    move: VoucherMove,
    ctx: { loanNumber: string; changedById: string; remarks?: string }
): Promise<void> {
    const from = await db.financialTransaction.findUnique({ where: { id: move.fromVoucherId } });
    if (!from || !from.isActive) throw new Error(`Voucher ${move.fromVoucherNo} is no longer active — reload and try again`);
    const fromAmount = Number(from.amount);
    if (fromAmount + EPS < move.amount) throw new Error(`Voucher ${move.fromVoucherNo} no longer holds ₹${move.amount} — reload and try again`);

    const remaining = round2(fromAmount - move.amount);
    const isDisbursement = move.group === 'DISBURSEMENT';
    const parent = move.component === 'PRINCIPAL' ? GL_DEFAULT_GROUPS.ASSETS : GL_DEFAULT_GROUPS.INCOME;
    const toLedgerId = await resolveOrCreateLedger(db as never, move.toLedgerName, parent);

    if (remaining <= EPS) {
        await db.financialTransaction.update({ where: { id: from.id }, data: { isActive: false } });
    } else {
        await db.financialTransaction.update({
            where: { id: from.id },
            data: {
                amount: new Decimal(remaining),
                ...(isDisbursement ? { description: editDisbursementDescription(from.description, ctx.loanNumber, 'remove') } : {}),
            },
        });
    }

    const target = await db.financialTransaction.findFirst({
        where: move.markerInColumn
            ? { postingMarker: move.toMarker, isActive: true, type: from.type, ledgerId: toLedgerId }
            : { isActive: true, type: from.type, ledgerId: toLedgerId, description: { contains: `${move.toMarker} ${move.toLedgerName}`, mode: 'insensitive' } },
        orderBy: { createdAt: 'asc' },
    });

    if (target) {
        await db.financialTransaction.update({
            where: { id: target.id },
            data: {
                amount: new Decimal(round2(Number(target.amount) + move.amount)),
                ...(isDisbursement ? { description: editDisbursementDescription(target.description, ctx.loanNumber, 'add') } : {}),
            },
        });
        return;
    }

    let description = from.description ?? '';
    if (isDisbursement) {
        const numKey = parseInt(ctx.loanNumber, 10).toString();
        description = editDisbursementDescription(description, ctx.loanNumber, 'only') ?? description;
    } else {
        description = description.split(move.fromMarker).join(move.toMarker);
    }
    description = description.split(move.fromLedgerName).join(move.toLedgerName);

    const voucherNo = await getNextVoucherNo(db as never, from.type === 'CASH_PAYMENT' ? 'CP' : 'CR');
    const created = await db.financialTransaction.create({
        data: {
            voucherNo,
            transactionDate: from.transactionDate,
            type: from.type,
            branchId: from.branchId,
            selfAccountId: from.selfAccountId,
            ledgerId: toLedgerId,
            amount: new Decimal(move.amount),
            description,
            postingMarker: move.markerInColumn ? move.toMarker : from.postingMarker,
            createdById: from.createdById,
            approvalStatus: from.approvalStatus,
            createdByRole: from.createdByRole,
        },
        select: { id: true },
    });
    if (isDisbursement || ctx.remarks) {
        await db.transactionApprovalHistory.create({
            data: {
                transactionId: created.id,
                action: 'AUTO_APPROVED',
                performedById: ctx.changedById,
                previousStatus: 'PENDING_APPROVAL',
                newStatus: 'APPROVED',
                remarks: ctx.remarks ?? `System-generated by Member Loan Edit funder change (loan ${ctx.loanNumber}).`,
            },
        });
    }
}

export async function applyFunderChangePlan(
    db: Db,
    plan: FunderChangePlan,
    params: { changedById: string; reason: string }
): Promise<{ movedVoucherCount: number }> {
    // Re-validate against the live loan inside the transaction (guards a concurrent change).
    const live = await db.loan.findUnique({ where: { id: plan.loanId }, select: { funderId: true } });
    if (!live || live.funderId !== plan.oldFunderId) {
        throw new Error('Loan funder changed while you were reviewing — reload and try again');
    }

    for (const move of plan.moves) {
        await applyVoucherMove(db, move, {
            loanNumber: plan.loanNumber,
            changedById: params.changedById,
            remarks: move.group === 'DISBURSEMENT' ? `System-generated by Member Loan Edit funder change (loan ${plan.loanNumber}: ${plan.oldFunderName} → ${plan.newFunderName}).` : undefined,
        });
    }

    await db.loan.update({ where: { id: plan.loanId }, data: { funderId: plan.newFunderId } });

    // Breakdown text must be rebuilt AFTER Loan.funderId flips — it's derived from which
    // transactions now belong to each funder's bucket.
    const touched = new Set<string>();
    for (const m of plan.moves) {
        if (m.group === 'EOD_FUNDER') touched.add(m.date);
    }
    for (const ymd of touched) {
        await refreshEodFunderDescriptions(db, plan.branchId, ymd, plan.oldFunderId);
        await refreshEodFunderDescriptions(db, plan.branchId, ymd, plan.newFunderId);
    }

    await db.loanFunderChangeLog.create({
        data: {
            loanId: plan.loanId,
            oldFunderId: plan.oldFunderId,
            newFunderId: plan.newFunderId,
            changedById: params.changedById,
            reason: params.reason,
            snapshot: JSON.parse(
                JSON.stringify({
                    oldFunderName: plan.oldFunderName,
                    newFunderName: plan.newFunderName,
                    moves: plan.moves,
                    warnings: plan.warnings,
                })
            ),
        },
    });

    return { movedVoucherCount: plan.moves.length };
}
