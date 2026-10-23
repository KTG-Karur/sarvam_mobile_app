import { prisma } from '@/app/lib/db';
import { getKolkataCalendarYmd } from '@/app/lib/branch-lock';

/**
 * Maps each given branchId to its BranchLock.currentWorkingDate, expressed as
 * a Kolkata-calendar YYYY-MM-DD string. Branches with no BranchLock row are
 * omitted from the map (treated as unlocked).
 */
export async function getBranchEodLockYmdMap(branchIds: string[]): Promise<Map<string, string>> {
    const distinctBranchIds = [...new Set(branchIds.filter(Boolean))];
    if (distinctBranchIds.length === 0) return new Map();

    const branchLocks = await prisma.branchLock.findMany({
        where: { branchId: { in: distinctBranchIds } },
        select: { branchId: true, currentWorkingDate: true },
    });

    return new Map(branchLocks.map((bl) => [bl.branchId, getKolkataCalendarYmd(bl.currentWorkingDate)]));
}

/**
 * True once the branch's EOD has moved its current working date past the
 * transaction's date — i.e. the transaction's business day is closed.
 */
export function isEodLockedForTransaction(lockYmd: string | undefined, transactionDate: Date): boolean {
    if (!lockYmd) return false;
    return lockYmd > getKolkataCalendarYmd(transactionDate);
}
