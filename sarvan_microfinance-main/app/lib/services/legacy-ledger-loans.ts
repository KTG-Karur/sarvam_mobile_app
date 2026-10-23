import { prisma } from '@/app/lib/prisma';
import { INDEX_DISBURSEMENT_POSTING_MARKER_PREFIX } from '@/app/lib/services/accounting-posting.service';
import { getKolkataCalendarYmd } from '@/app/lib/branch-lock';

/**
 * Ids of this branch+funder's loans whose DISBURSEMENT sits in an older-named principal ledger of the
 * funder (e.g. "OWN FUND GOLD PRINCIPAL"): matched by index marker, by "Loan Nos: LN…" text, or by
 * the plain loan numbers of newer vouchers.
 */
export async function legacyLedgerLoanIds(branchId: string, funderId: string | null, alias: string): Promise<Set<string>> {
    const vouchers = await prisma.financialTransaction.findMany({
        where: { branchId, isActive: true, type: 'CASH_PAYMENT', ledger: { ledgerName: { equals: `${alias} PRINCIPAL`, mode: 'insensitive' } } },
        select: { postingMarker: true, description: true },
    });
    const indexIds = new Set<string>();
    const tokens = new Set<string>();
    const numbers = new Set<string>();
    for (const v of vouchers) {
        if (v.postingMarker?.startsWith(INDEX_DISBURSEMENT_POSTING_MARKER_PREFIX)) {
            indexIds.add(v.postingMarker.slice(INDEX_DISBURSEMENT_POSTING_MARKER_PREFIX.length).replace(/\]$/, ''));
        }
        for (const t of (v.description ?? '').match(/LN\d+|\b\d{3,}\b/g) ?? []) {
            if (t.startsWith('LN')) tokens.add(t.toUpperCase());
            else numbers.add(String(parseInt(t, 10)));
        }
    }
    const loans = await prisma.loan.findMany({
        where: { branchId, ...(funderId ? { funderId } : {}), disbursementStatus: { in: ['DISBURSED', 'CLOSED'] } },
        select: { id: true, loanNumber: true, indexId: true },
    });
    const out = new Set<string>();
    for (const l of loans) {
        const n = parseInt(l.loanNumber, 10);
        if ((l.indexId && indexIds.has(l.indexId)) || tokens.has(l.loanNumber.toUpperCase()) || (!Number.isNaN(n) && numbers.has(String(n)))) out.add(l.id);
    }

    // Loans whose COLLECTIONS still sit in the old ledger (their disbursement may already have been moved):
    // gold loans with an approved EOD collection on a day the old ledger holds an EOD voucher keyed
    // `:{ymd}:{funder key at posting}:GOLD`.
    const receipts = await prisma.financialTransaction.findMany({
        where: {
            branchId,
            isActive: true,
            type: 'CASH_RECEIPT',
            ledger: { ledgerName: { in: [`${alias} PRINCIPAL`, `${alias} INTEREST`], mode: 'insensitive' } },
        },
        select: { postingMarker: true, description: true },
    });
    const dayKeys = new Set<string>(); // "ymd|funderKey"
    for (const r of receipts) {
        const m = /:(\d{4}-\d{2}-\d{2}):([^:\]]+):GOLD/.exec(`${r.postingMarker ?? ''} ${r.description ?? ''}`);
        if (m) dayKeys.add(`${m[1]}|${m[2]}`);
    }
    if (dayKeys.size > 0) {
        const days = [...dayKeys].map((k) => k.split('|')[0]).sort();
        const from = new Date(`${days[0]}T00:00:00+05:30`);
        const to = new Date(new Date(`${days[days.length - 1]}T00:00:00+05:30`).getTime() + 24 * 3600 * 1000);
        const txns = await prisma.loanTransaction.findMany({
            where: {
                status: 'APPROVED',
                isReversed: false,
                eodAllocatedAt: { not: null },
                type: { in: ['REPAYMENT', 'PRECLOSURE', 'WRITEOFF'] },
                transactionDate: { gte: from, lt: to },
                loan: {
                    branchId,
                    disbursementStatus: { in: ['DISBURSED', 'CLOSED'] },
                    ...(funderId ? { funderId } : {}),
                    loanProduct: { loanProductType: { name: { contains: 'gold', mode: 'insensitive' } } },
                },
            },
            select: { loanId: true, transactionDate: true, loan: { select: { funderId: true, funderChangeLogs: { orderBy: { createdAt: 'asc' }, take: 1, select: { oldFunderId: true } } } } },
        });
        for (const t of txns) {
            const original = t.loan.funderChangeLogs[0] ? t.loan.funderChangeLogs[0].oldFunderId : t.loan.funderId;
            const ymd = getKolkataCalendarYmd(t.transactionDate);
            // key 'OWN' = the loan had no funder when posted; an unlogged loan may have been assigned one later
            if (dayKeys.has(`${ymd}|${original ?? 'OWN'}`) || (!t.loan.funderChangeLogs[0] && dayKeys.has(`${ymd}|OWN`))) out.add(t.loanId);
        }
    }
    return out;
}
