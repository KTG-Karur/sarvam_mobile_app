import { NextRequest } from 'next/server';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
} from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { toRevertLocationDto } from '@/app/lib/revert-location';
import { buildBranchWhereClause } from '@/app/lib/permissions/branch-scope';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/collections/client/non-demand
 * Fetch non-demand collection history for a client
 */
export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const clientId = searchParams.get('clientId');

            if (!clientId) {
                return errorResponse('Client ID is required', 400);
            }

            // 'active' (default) shows currently-standing collections; 'reverted'
            // shows the separate reverted-history view (who/when it was reverted).
            const statusParam = searchParams.get('status') === 'reverted' ? 'reverted' : 'active';

            // Multi-tenancy boundary — never trust the X-Branch-Id header alone;
            // constrain to whatever branch(es) this role is actually permitted to see.
            const branchWhere = await buildBranchWhereClause(user, req.headers.get('x-branch-id'));

            const transactions = await prisma.loanTransaction.findMany({
                where: {
                    clientId,
                    ...branchWhere,
                    collectionType: 'Non Demand Collection',
                    isReversed: statusParam === 'reverted',
                },
                include: {
                    loan: {
                        select: {
                            loanNumber: true,
                            amount: true,
                        }
                    },
                    collectedBy: {
                        select: {
                            firstName: true,
                            lastName: true,
                        }
                    },
                    revertedBy: {
                        select: {
                            firstName: true,
                            lastName: true,
                            employeeId: true,
                        }
                    }
                },
                orderBy: statusParam === 'reverted' ? { revertedAt: 'desc' } : { transactionDate: 'desc' },
            });

            const formattedTransactions = (transactions as any[]).map(t => ({
                id: t.id,
                transactionId: t.transactionId,
                loanId: t.loanId,
                loanNumber: t.loan?.loanNumber,
                amount: Number(t.amount),
                transactionDate: t.transactionDate.toISOString(),
                collectedBy: t.collectedBy ? `${t.collectedBy.firstName} ${t.collectedBy.lastName}`.trim() : undefined,
                remarks: t.remarks,
                principalAmount: Number(t.principalAmount || 0),
                interestAmount: Number(t.interestAmount || 0),
                feesAmount: Number(t.feesAmount || 0),
                penaltyAmount: Number(t.penaltyAmount || 0),
                isReversed: t.isReversed,
                revertedAt: t.revertedAt ? t.revertedAt.toISOString() : null,
                revertedByName: t.revertedBy ? `${t.revertedBy.firstName} ${t.revertedBy.lastName}` : null,
                revertedByEmployeeId: t.revertedBy?.employeeId ?? null,
                revertReason: t.revertReason ?? null,
                revertLocation: toRevertLocationDto(t),
            }));

            return successResponse(formattedTransactions, 'Collection history fetched successfully');

        } catch (error) {
            console.error('[Delete Collection] Error fetching history:', error);
            return errorResponse('Failed to fetch collection history', 500);
        }
    })(request);
}
