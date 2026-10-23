import { NextRequest } from 'next/server';
import { z } from 'zod';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { revertLocationFields, toRevertLocationDto } from '@/app/lib/revert-location';
import { findLaterUnreversedSavingsActivity, revertSavingsCollectionTx } from '@/app/lib/savings-revert';
import { assertSameEodDay, assertNotEodAllocated } from '@/app/lib/revert-eod-guard';
import { getLoanAdvanceEnabled } from '@/app/lib/loan-advance-config';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const RevertSchema = z.object({
    transactionId: z.string().min(1, 'Transaction ID is required'),
    reason: z.string().min(1, 'Reason is required'),
    ...revertLocationFields,
});

/**
 * GET /api/collections/savings/revert?branchId=&date=YYYY-MM-DD
 * Admin-only: list approved SAVINGS_COLLECTION transactions for a branch/day,
 * flagging which ones are actually LIFO-eligible to revert right now.
 */
export async function GET(request: NextRequest) {
    return withRole(['ADMIN'], async (req) => {
        try {
            const { searchParams } = new URL(req.url);
            const branchId = searchParams.get('branchId');
            const date = searchParams.get('date');
            const statusParam = searchParams.get('status') === 'reverted' ? 'reverted' : 'active';
            if (!branchId) return errorResponse('branchId is required', 400);
            if (!date) return errorResponse('date is required', 400);

            const dayStart = new Date(`${date}T00:00:00.000Z`);
            const dayEnd = new Date(`${date}T23:59:59.999Z`);

            const txns = await prisma.loanTransaction.findMany({
                where: {
                    branchId,
                    type: 'SAVINGS_COLLECTION',
                    status: 'APPROVED',
                    isReversed: statusParam === 'reverted',
                    transactionDate: { gte: dayStart, lte: dayEnd },
                },
                include: {
                    client: { select: { clientId: true, firstName: true, lastName: true } },
                    loan: { select: { loanNumber: true } },
                    revertedBy: { select: { firstName: true, lastName: true, employeeId: true } },
                },
                orderBy: statusParam === 'reverted' ? { revertedAt: 'desc' } : { approvedAt: 'desc' },
            });

            if (statusParam === 'reverted') {
                const revertedRows = txns.map((txn) => ({
                    transactionId: txn.id,
                    loanNumber: txn.loan.loanNumber,
                    clientCode: txn.client.clientId,
                    memberName: `${txn.client.firstName} ${txn.client.lastName}`,
                    amount: Number(txn.amount),
                    transactionDate: txn.transactionDate.toISOString(),
                    revertedAt: txn.revertedAt ? txn.revertedAt.toISOString() : null,
                    revertedByName: txn.revertedBy ? `${txn.revertedBy.firstName} ${txn.revertedBy.lastName}` : null,
                    revertedByEmployeeId: txn.revertedBy?.employeeId ?? null,
                    revertReason: txn.revertReason ?? null,
                    revertLocation: toRevertLocationDto(txn),
                }));
                return successResponse(revertedRows, revertedRows.length === 0 ? 'No reverted loan advance collections found for this branch/date' : 'Reverted loan advance collections fetched');
            }

            const rows = await Promise.all(
                txns.map(async (txn) => {
                    const isLifoSafe = txn.approvedAt
                        ? !(await findLaterUnreversedSavingsActivity(prisma, txn.loanId, txn.id, txn.approvedAt))
                        : false;
                    const eodError = await assertSameEodDay(prisma, txn.branchId, txn.transactionDate);
                    const allocationError = assertNotEodAllocated(txn.eodAllocatedAt);
                    const eligible = isLifoSafe && !eodError && !allocationError;
                    const ineligibleReason: 'LATER_ACTIVITY' | 'EOD_LOCKED' | 'ALLOCATED' | null = eligible
                        ? null
                        : !isLifoSafe
                            ? 'LATER_ACTIVITY'
                            : eodError
                                ? 'EOD_LOCKED'
                                : 'ALLOCATED';
                    return {
                        transactionId: txn.id,
                        loanNumber: txn.loan.loanNumber,
                        clientCode: txn.client.clientId,
                        memberName: `${txn.client.firstName} ${txn.client.lastName}`,
                        amount: Number(txn.amount),
                        transactionDate: txn.transactionDate.toISOString(),
                        approvedAt: txn.approvedAt?.toISOString() ?? null,
                        eligible,
                        ineligibleReason,
                    };
                })
            );

            return successResponse(rows, rows.length === 0 ? 'No loan advance collections found for this branch/date' : 'Loan advance collections fetched');
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Failed to search loan advance collections';
            return errorResponse(message, 500);
        }
    })(request);
}

/**
 * POST /api/collections/savings/revert
 * Admin-only: undo an approved SAVINGS_COLLECTION transaction (loan advance
 * collected against a member's savings). See app/lib/savings-revert.ts for why
 * the LIFO guard spans both SAVINGS_COLLECTION and SAVINGS_REFUND — reverting
 * out of order would leave a later refund's amount unbacked.
 */
export async function POST(request: NextRequest) {
    return withRole(['ADMIN'], async (req, user) => {
        try {
            if (!(await getLoanAdvanceEnabled())) {
                return errorResponse('Loan Advance is disabled — this action is unavailable', 403);
            }
            const body = await req.json();
            const { transactionId, reason, latitude, longitude } = RevertSchema.parse(body);

            await prisma.$transaction((tx) => revertSavingsCollectionTx(tx, transactionId, user.userId, reason, { latitude, longitude }));

            return successResponse(null, 'Loan advance collection reverted successfully');
        } catch (error: unknown) {
            if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
            const message = error instanceof Error ? error.message : 'Failed to revert loan advance collection';
            return errorResponse(message, 500);
        }
    })(request);
}
