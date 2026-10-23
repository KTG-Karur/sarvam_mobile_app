import { NextRequest } from 'next/server';
import { z } from 'zod';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { revertLocationFields, revertLocationColumns, toRevertLocationDto } from '@/app/lib/revert-location';
import { findLaterUnreversedSavingsActivity } from '@/app/lib/savings-revert';
import { assertSameEodDay } from '@/app/lib/revert-eod-guard';
import { getLoanAdvanceEnabled } from '@/app/lib/loan-advance-config';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const RevertSchema = z.object({
    requestId: z.string().min(1, 'Request ID is required'),
    reason: z.string().min(1, 'Reason is required'),
    ...revertLocationFields,
});

// SavingsRefundRequest has no direct FK to the LoanTransaction it produced on
// approval (no schema change for this phase) — both are written in the same
// PUT-approve call a few milliseconds apart, so match on loan/client/amount
// within a generous window around reviewedAt.
const MATCH_WINDOW_MS = 60_000;

/**
 * GET /api/savings/refund/revert?branchId=
 * Admin-only: list APPROVED loan-advance refund requests for a branch that
 * have not already been reverted, for the Loan Advance Revert screen.
 */
export async function GET(request: NextRequest) {
    return withRole(['ADMIN'], async (req) => {
        try {
            const { searchParams } = new URL(req.url);
            const branchId = searchParams.get('branchId');
            const statusParam = searchParams.get('status') === 'reverted' ? 'reverted' : 'active';
            if (!branchId) return errorResponse('branchId is required', 400);

            const requests = await prisma.savingsRefundRequest.findMany({
                where: statusParam === 'reverted'
                    ? { branchId, isReversed: true }
                    : { branchId, status: 'APPROVED', isReversed: false },
                include: {
                    loan: { select: { loanNumber: true } },
                    client: { select: { clientId: true, firstName: true, lastName: true } },
                    revertedBy: { select: { firstName: true, lastName: true, employeeId: true } },
                },
                orderBy: statusParam === 'reverted' ? { revertedAt: 'desc' } : { reviewedAt: 'desc' },
            });

            if (statusParam === 'reverted') {
                const revertedRows = requests.map((r) => ({
                    requestId: r.id,
                    loanNumber: r.loan.loanNumber,
                    clientCode: r.client.clientId,
                    memberName: `${r.client.firstName} ${r.client.lastName}`,
                    refundAmount: Number(r.refundAmount),
                    reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
                    revertedAt: r.revertedAt ? r.revertedAt.toISOString() : null,
                    revertedByName: r.revertedBy ? `${r.revertedBy.firstName} ${r.revertedBy.lastName}` : null,
                    revertedByEmployeeId: r.revertedBy?.employeeId ?? null,
                    revertReason: r.revertReason ?? null,
                    revertLocation: toRevertLocationDto(r),
                }));
                return successResponse(revertedRows, revertedRows.length === 0 ? 'No reverted loan advance refunds found for this branch' : 'Reverted loan advance refunds fetched');
            }

            const rows = [];
            for (const r of requests) {
                if (!r.reviewedAt) continue;
                const windowStart = new Date(r.reviewedAt.getTime() - MATCH_WINDOW_MS);
                const windowEnd = new Date(r.reviewedAt.getTime() + MATCH_WINDOW_MS);
                const txn = await prisma.loanTransaction.findFirst({
                    where: {
                        loanId: r.loanId,
                        clientId: r.clientId,
                        type: 'SAVINGS_REFUND',
                        amount: r.refundAmount,
                        approvedAt: { gte: windowStart, lte: windowEnd },
                    },
                    orderBy: { approvedAt: 'desc' },
                });
                if (!txn || txn.isReversed) continue; // already reverted or not found — hide it

                const isLifoSafe = txn.approvedAt
                    ? !(await findLaterUnreversedSavingsActivity(prisma, r.loanId, txn.id, txn.approvedAt))
                    : false;
                const eodError = await assertSameEodDay(prisma, txn.branchId, txn.transactionDate);
                const eligible = isLifoSafe && !eodError;

                rows.push({
                    requestId: r.id,
                    loanNumber: r.loan.loanNumber,
                    clientCode: r.client.clientId,
                    memberName: `${r.client.firstName} ${r.client.lastName}`,
                    refundAmount: Number(r.refundAmount),
                    reviewedAt: r.reviewedAt.toISOString(),
                    eligible,
                });
            }

            return successResponse(rows, rows.length === 0 ? 'No revertible loan advance refunds found for this branch' : 'Loan advance refunds fetched');
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Failed to search loan advance refunds';
            return errorResponse(message, 500);
        }
    })(request);
}

/**
 * POST /api/savings/refund/revert
 * Admin-only: undo an APPROVED loan-advance refund. See app/lib/savings-revert.ts
 * for the shared LIFO guard rationale. `status` moves back to PENDING_APPROVAL — a
 * revert undoes the approval decision itself, so the request reappears on the Loan
 * Advance Refund Requests tab awaiting a fresh review, exactly like a freshly
 * initiated request (also deactivates its GL Cash Payment voucher — see
 * accounting-posting.service.ts's postSavingsRefundPayment). `isReversed` carries the
 * "this specific approval cycle was reverted" flag for the "Show Reverted History"
 * toggle (GET below), along with its own revertedBy/revertedAt/revertReason instead
 * of only free-text reviewRemarks; PUT's APPROVE branch resets it to false on a fresh
 * approval so the request becomes revertible again.
 */
export async function POST(request: NextRequest) {
    return withRole(['ADMIN'], async (req, user) => {
        try {
            if (!(await getLoanAdvanceEnabled())) {
                return errorResponse('Loan Advance is disabled — this action is unavailable', 403);
            }
            const body = await req.json();
            const { requestId, reason, latitude, longitude } = RevertSchema.parse(body);
            const revertLocation = { latitude, longitude };

            await prisma.$transaction(async (tx) => {
                const refundRequest = await tx.savingsRefundRequest.findUnique({ where: { id: requestId } });
                if (!refundRequest) throw new Error('Loan advance refund request not found');
                if (refundRequest.status !== 'APPROVED') {
                    throw new Error('Only an APPROVED refund request can be reverted');
                }
                if (!refundRequest.reviewedAt) throw new Error('Refund request has no approval timestamp');

                const windowStart = new Date(refundRequest.reviewedAt.getTime() - MATCH_WINDOW_MS);
                const windowEnd = new Date(refundRequest.reviewedAt.getTime() + MATCH_WINDOW_MS);

                const txn = await tx.loanTransaction.findFirst({
                    where: {
                        loanId: refundRequest.loanId,
                        clientId: refundRequest.clientId,
                        type: 'SAVINGS_REFUND',
                        isReversed: false,
                        amount: refundRequest.refundAmount,
                        approvedAt: { gte: windowStart, lte: windowEnd },
                    },
                    orderBy: { approvedAt: 'desc' },
                });
                if (!txn || !txn.approvedAt) {
                    throw new Error('Could not find the loan transaction created by this refund approval');
                }

                const laterActivity = await findLaterUnreversedSavingsActivity(tx, refundRequest.loanId, txn.id, txn.approvedAt);
                if (laterActivity) {
                    throw new Error('Cannot revert — a later loan advance collection/refund exists on this loan; revert that first');
                }

                const eodError = await assertSameEodDay(tx, txn.branchId, txn.transactionDate);
                if (eodError) throw new Error(eodError);

                const amount = Number(refundRequest.refundAmount);

                const client = await tx.client.findUnique({ where: { id: refundRequest.clientId }, select: { loanAdvance: true } });
                await tx.client.update({
                    where: { id: refundRequest.clientId },
                    data: { loanAdvance: Number(client?.loanAdvance || 0) + amount },
                });

                await tx.loan.update({
                    where: { id: refundRequest.loanId },
                    data: { savingsPaid: { increment: amount } },
                });

                console.log(
                    `[SavingsRefundRevert] requestId=${requestId} txnId=${txn.transactionId} loanId=${refundRequest.loanId} amount=${amount} revertedBy=${user.userId} reason=${reason}`
                );

                await tx.loanTransaction.update({
                    where: { id: txn.id },
                    data: {
                        isReversed: true,
                        revertedAt: new Date(),
                        revertedById: user.userId,
                        revertReason: reason,
                        ...revertLocationColumns(revertLocation),
                        remarks: txn.remarks ? `${txn.remarks}\n[REVERSED: ${reason}]` : `[REVERSED: ${reason}]`,
                    },
                });

                await tx.savingsRefundRequest.update({
                    where: { id: requestId },
                    data: {
                        status: 'PENDING_APPROVAL',
                        isReversed: true,
                        revertedAt: new Date(),
                        revertedById: user.userId,
                        revertReason: reason,
                        ...revertLocationColumns(revertLocation),
                        reviewRemarks: refundRequest.reviewRemarks
                            ? `${refundRequest.reviewRemarks}\n[REVERTED: ${reason}]`
                            : `[REVERTED: ${reason}]`,
                    },
                });

                // Deactivate the Cash Payment voucher this refund's approval posted (see
                // accounting-posting.service.ts's postSavingsRefundPayment) — older requests
                // approved before this linkage existed have no financialTransactionId and are
                // left as-is, same as they already are today.
                if (refundRequest.financialTransactionId) {
                    await tx.financialTransaction.update({
                        where: { id: refundRequest.financialTransactionId },
                        data: {
                            isActive: false,
                            revertedById: user.userId,
                            revertedAt: new Date(),
                            revertReason: reason,
                            ...revertLocationColumns(revertLocation),
                        },
                    });
                }
            });

            return successResponse(null, 'Loan advance refund reverted successfully');
        } catch (error: unknown) {
            if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
            const message = error instanceof Error ? error.message : 'Failed to revert loan advance refund';
            return errorResponse(message, 500);
        }
    })(request);
}
