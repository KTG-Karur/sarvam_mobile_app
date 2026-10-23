import { prisma } from '@/app/lib/prisma';

export type BranchIncentiveType = 'NEW' | 'EXISTING';

const THIRTY_FIVE_WEEKS_MS = 35 * 7 * 24 * 60 * 60 * 1000;

/**
 * Determines whether a branch counts as "New" or "Existing" for Gold Loan
 * incentive targeting (see IncentiveConfigType.GOLD_TARGET).
 *
 * A branch becomes "Existing" once:
 *  (a) some weekly-frequency loan in the branch has had its firstDueDate
 *      pass 35 weeks ago, AND
 *  (b) some client in the branch has a 2nd-or-later DISBURSED loan (a
 *      "renewal") dated on/after the date (a) was first satisfied.
 * Otherwise the branch is "New".
 */
export async function determineBranchType(branchId: string): Promise<BranchIncentiveType> {
    const weeklyLoans = await prisma.loan.findMany({
        where: {
            branchId,
            disbursementStatus: 'DISBURSED',
            frequency: { equals: 'weekly', mode: 'insensitive' },
            firstDueDate: { not: null },
        },
        select: { firstDueDate: true },
        orderBy: { firstDueDate: 'asc' },
    });

    if (weeklyLoans.length === 0) return 'NEW';

    const now = Date.now();
    // Earliest point at which any weekly loan in this branch crosses 35 weeks old.
    let earliest35WeekDate: Date | null = null;
    for (const loan of weeklyLoans) {
        if (!loan.firstDueDate) continue;
        const crosses35WeeksAt = new Date(loan.firstDueDate.getTime() + THIRTY_FIVE_WEEKS_MS);
        if (crosses35WeeksAt.getTime() > now) continue; // hasn't hit 35 weeks yet
        if (!earliest35WeekDate || crosses35WeeksAt < earliest35WeekDate) {
            earliest35WeekDate = crosses35WeeksAt;
        }
    }

    if (!earliest35WeekDate) return 'NEW';

    // Renewal = a client's 2nd-or-later disbursed loan in this branch.
    const disbursedLoans = await prisma.loan.findMany({
        where: { branchId, disbursementStatus: 'DISBURSED' },
        select: { clientId: true, disbursedByBMAt: true, disbursedLevel1At: true },
        orderBy: [{ clientId: 'asc' }, { disbursedLevel1At: 'asc' }],
    });

    const seenClientIds = new Set<string>();
    for (const loan of disbursedLoans) {
        const disbursedAt = loan.disbursedByBMAt ?? loan.disbursedLevel1At;
        const isRenewal = seenClientIds.has(loan.clientId);
        seenClientIds.add(loan.clientId);
        if (isRenewal && disbursedAt && disbursedAt >= earliest35WeekDate) {
            return 'EXISTING';
        }
    }

    return 'NEW';
}
