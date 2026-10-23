import type { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { GL_DEFAULT_GROUPS, buildFunderLedgerNames, resolveOrCreateLedger } from '@/app/lib/gl-config';

type Db = Prisma.TransactionClient;

/**
 * Old-ledger OPENING BALANCE fix. A funder ledger renamed after the books were opened (e.g. "OWN FUND GOLD
 * PRINCIPAL" -> "OWN FUND - GOLD PRINCIPAL") can leave the branch's opening balance on the old-named ledger,
 * while every later voucher posts to the new one. Opening balances are not vouchers, so the loan-wise funder
 * change cannot see them — this moves the amount onto the funder's proper ledger instead.
 */

export interface OpeningMove {
    openingId: string;
    fromLedgerId: string;
    fromLedgerName: string;
    toLedgerName: string;
    balanceType: 'DEBIT' | 'CREDIT';
    amount: number;
}

const normalize = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
const signed = (type: 'DEBIT' | 'CREDIT', amount: number) => (type === 'DEBIT' ? amount : -amount);
const round2 = (n: number) => Number(n.toFixed(2));

export async function buildOpeningAliasPlan(db: Db, branchId: string): Promise<OpeningMove[]> {
    const [rows, funders] = await Promise.all([
        db.ledgerOpeningBalance.findMany({
            where: { branchId, amount: { gt: 0 } },
            select: { id: true, ledgerId: true, balanceType: true, amount: true, ledger: { select: { ledgerName: true } } },
        }),
        db.funder.findMany({ select: { funderName: true } }),
    ]);
    const moves: OpeningMove[] = [];
    const seen = new Set<string>();
    for (const f of funders) {
        const names = buildFunderLedgerNames(f.funderName, false);
        for (const target of [names.principal, names.interest]) {
            for (const r of rows) {
                const name = r.ledger.ledgerName;
                if (seen.has(r.id) || normalize(name) !== normalize(target) || name.toUpperCase() === target.toUpperCase()) continue;
                seen.add(r.id);
                moves.push({
                    openingId: r.id,
                    fromLedgerId: r.ledgerId,
                    fromLedgerName: name,
                    toLedgerName: target,
                    balanceType: r.balanceType,
                    amount: Number(r.amount),
                });
            }
        }
    }
    return moves;
}

/** Must run inside one `prisma.$transaction`. */
export async function applyOpeningAliasPlan(db: Db, branchId: string, moves: OpeningMove[], ctx: { changedById: string; reason: string }) {
    for (const m of moves) {
        const source = await db.ledgerOpeningBalance.findUnique({ where: { id: m.openingId } });
        if (!source || Number(source.amount) <= 0) throw new Error(`Opening balance of "${m.fromLedgerName}" changed — reload and try again`);

        const isPrincipal = /PRINCIPAL\s*$/i.test(m.toLedgerName);
        const toLedgerId = await resolveOrCreateLedger(db as never, m.toLedgerName, isPrincipal ? GL_DEFAULT_GROUPS.ASSETS : GL_DEFAULT_GROUPS.INCOME);
        const target = await db.ledgerOpeningBalance.findUnique({ where: { branchId_ledgerId: { branchId, ledgerId: toLedgerId } } });

        const net = round2(signed(source.balanceType, Number(source.amount)) + (target ? signed(target.balanceType, Number(target.amount)) : 0));
        const data = { balanceType: net >= 0 ? ('DEBIT' as const) : ('CREDIT' as const), amount: new Decimal(Math.abs(net)) };
        if (target) {
            await db.ledgerOpeningBalance.update({ where: { id: target.id }, data: { ...data, updatedById: ctx.changedById } });
        } else {
            // a branch has exactly one opening date, so the new row inherits the source row's
            await db.ledgerOpeningBalance.create({
                data: { branchId, ledgerId: toLedgerId, openingDate: source.openingDate, createdById: ctx.changedById, ...data },
            });
        }
        await db.ledgerOpeningBalance.update({ where: { id: source.id }, data: { amount: new Decimal(0), updatedById: ctx.changedById } });
        console.info(`[opening-balance-alias] branch ${branchId}: ${m.fromLedgerName} ${m.balanceType} ${m.amount} -> ${m.toLedgerName} by ${ctx.changedById} (${ctx.reason})`);
    }
}
