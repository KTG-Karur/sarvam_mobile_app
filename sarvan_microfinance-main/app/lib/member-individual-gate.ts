import { prisma } from '@/app/lib/prisma';

/**
 * Determines which of the given loans are NOT yet cleared for disbursement.
 * A loan is complete when:
 *  - its MemberIndividual record has Cash Flow, Loan Appraisal and House Hold
 *    Visit all marked complete, AND
 *  - the loan itself (not just the client) belongs to at least one COMPLETED
 *    center-wide grtSession — GRT coverage is loan-scoped, so a renewal/new
 *    loan for the same client always needs its own separate GRT session; a
 *    prior loan's completed session never satisfies a different loan cycle.
 *
 * Used as the hard gate at AM Level-2 approval and (defense-in-depth) at BM
 * final disbursement.
 */
export async function findIncompleteMemberIndividualLoanIds(
    loans: { id: string }[]
): Promise<Set<string>> {
    if (loans.length === 0) return new Set();

    const loanIds = loans.map((l) => l.id);

    const [memberIndividuals, grtCoveredLoans] = await Promise.all([
        prisma.memberIndividual.findMany({
            where: {
                loanId: { in: loanIds },
                cashFlowCompletedAt: { not: null },
                loanAppraisalReviewedAt: { not: null },
                houseHoldVisitCompletedAt: { not: null },
            },
            select: { loanId: true },
        }),
        prisma.grtSessionClient.findMany({
            where: { loanId: { in: loanIds }, grtSession: { completedAt: { not: null } } },
            select: { loanId: true },
        }),
    ]);

    const miCompleteLoanIds = new Set(memberIndividuals.map((m) => m.loanId));
    const grtCompleteLoanIds = new Set(grtCoveredLoans.map((c) => c.loanId));

    const incomplete = new Set<string>();
    for (const loan of loans) {
        if (!miCompleteLoanIds.has(loan.id) || !grtCompleteLoanIds.has(loan.id)) {
            incomplete.add(loan.id);
        }
    }
    return incomplete;
}
