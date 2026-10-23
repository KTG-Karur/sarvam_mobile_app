import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { handleCorsPreflight, errorResponse, successResponse, withAuth } from '@/app/lib/api-utils';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';
import { computeOutstandingBalance } from '@/app/lib/dashboard/arrears';
import { cachedLoanBalance } from '@/app/lib/cache/loan-balance-cache';

export async function OPTIONS() {
    return handleCorsPreflight();
}

type LoanBalancePayload = {
    loanId: string;
    branchId: string;
    principalOutstanding: number;
    interestOutstanding: number;
    totalOutstanding: number;
};

/**
 * GET /api/loans/{loanId}/balance
 * Read-only outstanding balance for display. One single-row read + ONE grouped
 * SUM over the loan's schedules (no schedule/transaction rows loaded into Node),
 * cached in Redis for 60s and invalidated by bumpLoanBalance() on every
 * balance-changing write. Not for use inside financial write paths.
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ loanId: string }> }
) {
    return withAuth(async (_req, user) => {
        try {
            const { loanId } = await params;
            if (!loanId) return errorResponse('Loan ID is required', 400);

            const payload = await cachedLoanBalance<LoanBalancePayload | null>(loanId, async () => {
                const loan = await prisma.loan.findUnique({
                    where: { id: loanId },
                    select: { id: true, branchId: true, amount: true, principalPaid: true },
                });
                if (!loan) return null;
                const balances = await computeOutstandingBalance([loan]);
                const b = balances.get(loan.id) ?? { principal: 0, interest: 0 };
                return {
                    loanId: loan.id,
                    branchId: loan.branchId,
                    principalOutstanding: b.principal,
                    interestOutstanding: b.interest,
                    totalOutstanding: b.principal + b.interest,
                };
            });

            if (!payload) return errorResponse('Loan not found', 404);

            // Branch scope is checked against the (cached) loan's branch on every
            // request, so a cache hit can never leak across branches.
            const permitted = await getPermittedBranchIds(user);
            if (permitted && !permitted.includes(payload.branchId)) {
                return errorResponse('Loan not found', 404);
            }

            return successResponse(payload, 'Loan balance fetched successfully');
        } catch (error) {
            console.error('Error fetching loan balance:', error);
            return errorResponse(error instanceof Error ? error.message : 'Failed to fetch loan balance', 500);
        }
    })(request);
}
