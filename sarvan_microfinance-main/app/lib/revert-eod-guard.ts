import type { Prisma } from '@prisma/client';
import { prisma } from '@/app/lib/prisma';
import { getKolkataCalendarYmd } from '@/app/lib/branch-lock';

type AnyPrismaClient = typeof prisma | Prisma.TransactionClient;

/**
 * Most revert types are only allowed while EOD hasn't yet rolled the branch's
 * working date past the day the action happened on — once EOD moves the
 * branch forward, that day is closed out and the action can no longer be
 * reverted, by anyone (no Admin bypass). Death Marking Revert is the one
 * exception the business wants revertible regardless of EOD state, so it
 * doesn't call this guard. Pre-Closure Revert (foreclosure) uses this same guard.
 */
export async function assertSameEodDay(
    client: AnyPrismaClient,
    branchId: string,
    referenceDate: Date
): Promise<string | null> {
    const branchLock = await client.branchLock.findUnique({
        where: { branchId },
        select: { currentWorkingDate: true },
    });
    if (!branchLock) return null;

    const lockYmd = getKolkataCalendarYmd(branchLock.currentWorkingDate);
    const referenceYmd = getKolkataCalendarYmd(referenceDate);

    if (lockYmd > referenceYmd) {
        return 'EOD has already been processed past this date — it can no longer be reverted.';
    }
    return null;
}

/** Same guard, but the reference side is already a YYYY-MM-DD string (e.g. an EOD allocation's target date). */
export async function assertSameEodDayYmd(
    client: AnyPrismaClient,
    branchId: string,
    referenceYmd: string
): Promise<string | null> {
    const branchLock = await client.branchLock.findUnique({
        where: { branchId },
        select: { currentWorkingDate: true },
    });
    if (!branchLock) return null;

    const lockYmd = getKolkataCalendarYmd(branchLock.currentWorkingDate);

    if (lockYmd > referenceYmd) {
        return 'EOD has already been processed past this date — it can no longer be reverted.';
    }
    return null;
}

/**
 * Enforces the reverse-of-forward ordering for a collection: EOD Revert -> Allocation
 * Revert -> Collection Revert. `LoanTransaction.eodAllocatedAt` is stamped when a
 * collection is included in an "Allocate for EOD" GL posting and cleared only by
 * Allocation Revert (see accounting-posting.service.ts / eod-allocation/revert routes).
 * While it's still set, the collection itself can't be reverted directly — doing so
 * would leave that GL voucher orphaned. No bypass for any role, same as assertSameEodDay.
 */
export function assertNotEodAllocated(eodAllocatedAt: Date | null): string | null {
    if (eodAllocatedAt) {
        return 'This collection has been allocated for EOD settlement. Please revert the Allocation first (Allocation Revert), then try again.';
    }
    return null;
}

/**
 * Blocks changing a loan's funder while any of its collections is still covered by an active
 * "Allocate for EOD" voucher. That voucher is keyed by funder (`[POSTING:EOD_FUNDER:...:funderKey]`)
 * and Allocation Revert finds it through the loan's *current* funderId — so moving the loan to
 * another funder strands the old voucher: it stays active in the Day Book, but no Allocation
 * Revert bucket ever lists it again. Same ordering rule as assertNotEodAllocated: revert the
 * allocation first, then change the funder. No bypass for any role.
 */
export async function assertFunderChangeAllowed(
    client: AnyPrismaClient,
    loanId: string,
    currentFunderId: string | null,
    nextFunderId: string | null
): Promise<string | null> {
    if ((currentFunderId ?? null) === (nextFunderId ?? null)) return null;

    const allocated = await client.loanTransaction.findFirst({
        where: {
            loanId,
            type: { in: ['REPAYMENT', 'PRECLOSURE', 'WRITEOFF'] },
            eodAllocatedAt: { not: null },
        },
        select: { transactionDate: true },
        orderBy: { transactionDate: 'desc' },
    });
    if (!allocated) return null;

    return `This loan has collections allocated for EOD (latest on ${getKolkataCalendarYmd(allocated.transactionDate)}). Please revert the Allocation first (Allocation Revert), then change the funder.`;
}
