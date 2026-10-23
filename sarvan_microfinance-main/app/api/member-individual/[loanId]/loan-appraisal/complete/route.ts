import { NextRequest } from 'next/server';
import { handleCorsPreflight, errorResponse, successResponse, withRole } from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * PATCH /api/member-individual/[loanId]/loan-appraisal/complete
 * Marks the Loan Appraisal tab reviewed. The product itself is changed via
 * the existing /api/disbursements/[loanId]/update-product route.
 */
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ loanId: string }> }
) {
    return withRole(['BRANCH_MANAGER', 'ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH'], async (req, user) => {
        try {
            const { loanId } = await params;

            const memberIndividual = await prisma.memberIndividual.findUnique({ where: { loanId } });
            if (!memberIndividual) return errorResponse('Member Individual record not found — open the loan first', 404);

            const loan = await prisma.loan.findUnique({ where: { id: loanId }, select: { amount: true } });
            if (!loan) return errorResponse('Loan not found', 404);

            const [updated] = await prisma.$transaction([
                prisma.memberIndividual.update({
                    where: { loanId },
                    data: {
                        loanAppraisalReviewedAt: new Date(),
                        loanAppraisalReviewedById: user.userId,
                    },
                }),
                prisma.loan.update({
                    where: { id: loanId },
                    data: { memberIndividualApprovedAmount: loan.amount },
                }),
            ]);

            return successResponse({ reviewedAt: updated.loanAppraisalReviewedAt }, 'Loan Appraisal marked reviewed');
        } catch (error: any) {
            console.error('Error completing Loan Appraisal:', error);
            return errorResponse(error.message || 'Failed to complete Loan Appraisal', 500);
        }
    })(request);
}
