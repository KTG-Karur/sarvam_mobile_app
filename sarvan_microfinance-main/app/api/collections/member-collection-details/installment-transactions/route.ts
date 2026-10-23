import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/collections/member-collection-details/installment-transactions
 * Returns all non-reversed transactions for a specific loan installment.
 * Used by the Collection-Revert modal to show per-transaction delete actions.
 *
 * Query params:
 *   loanId        - required
 *   installmentNo - required (integer)
 */
export async function GET(request: NextRequest) {
    return withRole(['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER'], async (req) => {
        try {
            const { searchParams } = new URL(req.url);
            const loanId = searchParams.get('loanId');
            const installmentNoParam = searchParams.get('installmentNo');

            if (!loanId) return errorResponse('loanId is required', 400);
            if (!installmentNoParam) return errorResponse('installmentNo is required', 400);

            const installmentNo = parseInt(installmentNoParam, 10);
            if (isNaN(installmentNo)) return errorResponse('installmentNo must be a number', 400);

            // Find the schedule row for this installment
            const schedule = await prisma.loanSchedule.findFirst({
                where: { loanId, installmentNo },
                select: { id: true },
            });

            if (!schedule) return errorResponse('Schedule not found', 404);

            // Fetch the loan's branchId for EOD lock check
            const loan = await prisma.loan.findUnique({
                where: { id: loanId },
                select: { branchId: true },
            });

            if (!loan) return errorResponse('Loan not found', 404);

            const branchLock = loan.branchId
                ? await prisma.branchLock.findUnique({
                      where: { branchId: loan.branchId },
                      select: { currentWorkingDate: true },
                  })
                : null;
            const currentWorkingDate = branchLock?.currentWorkingDate ?? null;

            // Find all non-reversed transactions that have a line for this schedule
            const transactions = await prisma.loanTransaction.findMany({
                where: {
                    loanId,
                    isReversed: false,
                    status: { in: ['PENDING', 'APPROVED'] as any },
                    type: { in: ['REPAYMENT', 'PRECLOSURE'] as any },
                    lines: { some: { scheduleId: schedule.id } },
                },
                orderBy: { transactionDate: 'asc' },
                select: {
                    id: true,
                    transactionDate: true,
                    principalAmount: true,
                    interestAmount: true,
                    feesAmount: true,
                    penaltyAmount: true,
                    amount: true,
                    paymentMode: true,
                    collectionType: true,
                    status: true,
                    collectedBy: { select: { firstName: true, lastName: true } },
                },
            });

            const result = transactions.map((txn) => {
                const txnDate = new Date(txn.transactionDate);
                const isEodLocked =
                    currentWorkingDate ? txnDate < currentWorkingDate : false;

                return {
                    id: txn.id,
                    transactionDate: txn.transactionDate.toISOString(),
                    principalAmount: Number(txn.principalAmount ?? 0),
                    interestAmount: Number(txn.interestAmount ?? 0),
                    feesAmount: Number(txn.feesAmount ?? 0),
                    penaltyAmount: Number(txn.penaltyAmount ?? 0),
                    amount: Number(txn.amount),
                    paymentMode: txn.paymentMode as string,
                    collectionType: txn.collectionType ?? null,
                    status: txn.status as string,
                    isEodLocked,
                    collectedByName: txn.collectedBy
                        ? `${txn.collectedBy.firstName} ${txn.collectedBy.lastName}`.trim()
                        : null,
                };
            });

            return successResponse({ transactions: result }, 'Transactions fetched');
        } catch (error: any) {
            console.error('[installment-transactions] Error:', error);
            return errorResponse(error.message || 'Failed to fetch transactions', 500);
        }
    })(request);
}
