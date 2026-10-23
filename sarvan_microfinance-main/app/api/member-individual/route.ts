import { NextRequest } from 'next/server';
import { handleCorsPreflight, errorResponse, successResponse, withRole } from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { buildBranchWhereClause } from '@/app/lib/permissions/branch-scope';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/member-individual?centerId=&indexId=
 * Center-wise roster of indexed, non-disbursed loans with their Member
 * Individual completion status per tab (BM's post-indexation, pre-disbursement
 * data collection step).
 */
export async function GET(request: NextRequest) {
    return withRole(['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH'], async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const centerId = searchParams.get('centerId');
            const indexId = searchParams.get('indexId');
            if (!centerId) return errorResponse('centerId is required', 400);

            const branchWhere = await buildBranchWhereClause(user);

            const loans = await prisma.loan.findMany({
                where: {
                    centerId,
                    isActive: true,
                    indexId: { not: null },
                    disbursementStatus: { in: ['PENDING_LEVEL2', 'APPROVED_LEVEL2'] },
                    ...(indexId ? { indexId } : {}),
                    ...branchWhere,
                },
                select: {
                    id: true,
                    loanNumber: true,
                    amount: true,
                    frequency: true,
                    disbursementStatus: true,
                    indexId: true,
                    clientId: true,
                    client: { select: { id: true, clientId: true, firstName: true, lastName: true } },
                    loanProduct: { select: { productName: true } },
                    memberIndividual: {
                        select: {
                            cashFlowCompletedAt: true,
                            loanAppraisalReviewedAt: true,
                            houseHoldVisitCompletedAt: true,
                        },
                    },
                },
                orderBy: { client: { firstName: 'asc' } },
            });

            const grtCoveredLoans = await prisma.grtSessionClient.findMany({
                where: {
                    loanId: { in: loans.map((l) => l.id) },
                    grtSession: { completedAt: { not: null } },
                },
                select: { loanId: true },
            });
            const grtCompleteLoanIds = new Set(grtCoveredLoans.map((c) => c.loanId));

            const roster = loans.map((loan) => {
                const mi = loan.memberIndividual;
                const grtComplete = grtCompleteLoanIds.has(loan.id);
                return {
                    loanId: loan.id,
                    loanNumber: loan.loanNumber,
                    amount: Number(loan.amount),
                    frequency: loan.frequency,
                    disbursementStatus: loan.disbursementStatus,
                    indexId: loan.indexId,
                    clientId: loan.client.id,
                    clientDisplayId: loan.client.clientId,
                    clientName: `${loan.client.firstName} ${loan.client.lastName}`.trim(),
                    productName: loan.loanProduct?.productName ?? null,
                    cashFlowComplete: !!mi?.cashFlowCompletedAt,
                    loanAppraisalComplete: !!mi?.loanAppraisalReviewedAt,
                    houseHoldVisitComplete: !!mi?.houseHoldVisitCompletedAt,
                    grtComplete,
                    isComplete: !!(mi?.cashFlowCompletedAt && mi?.loanAppraisalReviewedAt && mi?.houseHoldVisitCompletedAt && grtComplete),
                };
            });

            return successResponse(roster, 'Member Individual roster retrieved successfully');
        } catch (error: any) {
            console.error('Error fetching Member Individual roster:', error);
            return errorResponse(error.message || 'Failed to fetch roster', 500);
        }
    })(request);
}
