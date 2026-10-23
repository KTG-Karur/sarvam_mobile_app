import { prisma } from '@/app/lib/prisma';

/**
 * Determines which of the given (gold) loans have zero uploaded pledge photos yet.
 * GoldLoanDetail doesn't exist until the BM-disburse transaction commits, so photos
 * are keyed by loanId directly rather than by goldLoanDetailId — mirrors
 * member-individual-gate.ts's shape. Used as the hard gate at BM final disbursement.
 */
export async function findGoldLoansMissingPhoto(
    loans: { id: string }[]
): Promise<Set<string>> {
    if (loans.length === 0) return new Set();

    const loanIds = loans.map((l) => l.id);

    const photographed = await prisma.goldLoanDetailPhoto.findMany({
        where: { loanId: { in: loanIds } },
        select: { loanId: true },
        distinct: ['loanId'],
    });
    const photographedLoanIds = new Set(photographed.map((p) => p.loanId));

    const missing = new Set<string>();
    for (const loan of loans) {
        if (!photographedLoanIds.has(loan.id)) missing.add(loan.id);
    }
    return missing;
}
