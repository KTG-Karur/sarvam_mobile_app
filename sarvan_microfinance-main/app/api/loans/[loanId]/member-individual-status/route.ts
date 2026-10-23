import { NextRequest } from 'next/server';
import { handleCorsPreflight, errorResponse, successResponse, withAuth } from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/loans/[loanId]/member-individual-status
 * Lightweight completeness check used by Final Disbursement's pre-flight gate.
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ loanId: string }> }
) {
    return withAuth(async (req) => {
        try {
            const { loanId } = await params;

            const loan = await prisma.loan.findUnique({ where: { id: loanId }, select: { id: true } });
            if (!loan) return errorResponse('Loan not found', 404);

            const [memberIndividual, completedGrtSession] = await Promise.all([
                prisma.memberIndividual.findUnique({
                    where: { loanId },
                    select: { cashFlowCompletedAt: true, loanAppraisalReviewedAt: true, houseHoldVisitCompletedAt: true },
                }),
                prisma.grtSessionClient.findFirst({
                    where: { loanId, grtSession: { completedAt: { not: null } } },
                    select: { id: true },
                }),
            ]);

            const pendingTabs: string[] = [];
            if (!memberIndividual?.cashFlowCompletedAt) pendingTabs.push('Cash Flow');
            if (!memberIndividual?.loanAppraisalReviewedAt) pendingTabs.push('Loan Appraisal');
            if (!memberIndividual?.houseHoldVisitCompletedAt) pendingTabs.push('House Hold Assessment');
            if (!completedGrtSession) pendingTabs.push('GRT');

            return successResponse({ isComplete: pendingTabs.length === 0, pendingTabs }, 'Member Individual status retrieved');
        } catch (error: any) {
            console.error('Error fetching Member Individual status:', error);
            return errorResponse(error.message || 'Failed to fetch status', 500);
        }
    })(request);
}
