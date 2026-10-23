import { prisma } from '@/app/lib/db';

/**
 * For branches with no eodStartDate on record, derive what it actually was from
 * the earliest real activity (denomination entry, loan transaction, financial
 * transaction, collection meeting). Display-only — never written to the DB.
 * Batched via groupBy (not per-branch queries) to avoid an N+1 across a branch list.
 */
export async function deriveEodStartDates(branchIds: string[]): Promise<Map<string, Date>> {
    const derivedStartByBranch = new Map<string, Date>();
    if (branchIds.length === 0) return derivedStartByBranch;

    const [denomMin, loanTxMin, finTxMin, meetingMin] = await Promise.all([
        prisma.denominationEntry.groupBy({
            by: ['branchId'],
            where: { branchId: { in: branchIds } },
            _min: { entryDate: true },
        }),
        prisma.loanTransaction.groupBy({
            by: ['branchId'],
            where: { branchId: { in: branchIds } },
            _min: { transactionDate: true },
        }),
        prisma.financialTransaction.groupBy({
            by: ['branchId'],
            where: { branchId: { in: branchIds }, isActive: true },
            _min: { transactionDate: true },
        }),
        prisma.collectionMeetingRecord.groupBy({
            by: ['branchId'],
            where: { branchId: { in: branchIds } },
            _min: { collectionDate: true },
        }),
    ]);

    for (const branchId of branchIds) {
        const candidates = [
            denomMin.find((r) => r.branchId === branchId)?._min.entryDate,
            loanTxMin.find((r) => r.branchId === branchId)?._min.transactionDate,
            finTxMin.find((r) => r.branchId === branchId)?._min.transactionDate,
            meetingMin.find((r) => r.branchId === branchId)?._min.collectionDate,
        ].filter((d): d is Date => d != null);
        if (candidates.length > 0) {
            derivedStartByBranch.set(branchId, candidates.reduce((min, d) => (d < min ? d : min)));
        }
    }
    return derivedStartByBranch;
}
