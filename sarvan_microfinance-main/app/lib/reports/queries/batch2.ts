import { prisma } from '@/app/lib/prisma';
import { format } from 'date-fns';
import { getMemberContacts } from '@/app/lib/reports/member-contacts';

/**
 * Shared query functions for reports whose API route previously had the
 * Prisma query inlined — each function here is called by BOTH the report's
 * own API route (paginated/on-screen view) and its app/lib/reports/report-registry.ts
 * async-export adapter, so the two can never silently diverge.
 */

// ── Preclosure ────────────────────────────────────────────────────

export type PreclosureFilters = {
    fromDate: string;
    toDate: string;
    branchIds: string[] | null;
    centerId?: string | null;
};

export async function getPreclosureRows(filters: PreclosureFilters) {
    const startDate = new Date(filters.fromDate);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(filters.toDate);
    endDate.setHours(23, 59, 59, 999);

    const transactions = await prisma.loanTransaction.findMany({
        where: {
            transactionDate: { gte: startDate, lte: endDate },
            type: 'PRECLOSURE',
            isReversed: false,
            ...(filters.branchIds ? { branchId: { in: filters.branchIds } } : {}),
            ...(filters.centerId && filters.centerId !== 'all' ? { centerId: filters.centerId } : {}),
        },
        include: {
            client: true,
            center: { include: { branch: true } },
            loan: true,
        },
        orderBy: { transactionDate: 'desc' },
    });
    const contactOf = await getMemberContacts({ clientIds: transactions.map((t) => t.clientId), loanIds: transactions.map((t) => t.loanId) });

    return transactions.map((tx) => ({
        precloseDate: format(new Date(tx.transactionDate), 'dd/MM/yyyy'),
        branchName: tx.center?.branch ? `${tx.center.branch.code} - ${tx.center.branch.name}` : 'N/A',
        centerName: tx.center ? `${tx.center.code} - ${tx.center.name}` : 'N/A',
        clientName: `${tx.client?.clientId} - ${tx.client?.firstName || ''} ${tx.client?.lastName || ''}`.trim(),
        loanAccount: tx.loan?.loanNumber || 'N/A',
        arrearPri: Number(tx.openingArrearsPrincipal || 0),
        arrearInt: Number(tx.openingArrearsInterest || 0),
        currDmdPri: Number(tx.currentDemandPrincipal || 0),
        currDmdInt: Number(tx.currentDemandInterest || 0),
        preclosurePri: Number(tx.principalAmount || 0),
        preclosureInt: Number(tx.interestAmount || 0),
        totalAmount: Number(tx.amount || 0),
        ...contactOf(tx.clientId, tx.loanId),
    }));
}
