import { NextRequest } from 'next/server';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
    withRole,
} from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { recordLoanHistory } from '@/app/lib/loan-history';
import { z } from 'zod';

const deleteIndexSchema = z.object({
    reason: z.string().trim().min(5, 'A reason (at least 5 characters) is required to delete an index'),
});

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * DELETE /api/loan-indexes/[indexId]
 * Delete a loan index and release its loans.
 * Blocked once any loan in the index is AM approved or disbursed.
 */
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ indexId: string }> }
) {
    return withRole(['BRANCH_MANAGER', 'ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH'], async (req, user) => {
        try {
            const { indexId } = await params;
            const { reason } = deleteIndexSchema.parse(await req.json().catch(() => ({})));

            // Check if index exists
            const loanIndex = await prisma.loanIndex.findUnique({
                where: { id: indexId },
            });

            if (!loanIndex || !loanIndex.isActive) {
                return errorResponse('Loan index not found', 404);
            }

            if (user.role !== 'ADMIN' && loanIndex.branchId !== user.branchId) {
                return errorResponse('You can only delete indexes of your own branch', 403);
            }

            // Perform deletion in a transaction
            await prisma.$transaction(async (tx) => {
                // Once the AM has approved (or the loan is disbursed) the index is the link BM
                // final disbursement depends on — deleting it would strand the loan as
                // "unindexed" while its AM approval is still recorded.
                const lockedLoans = await tx.loan.count({
                    where: { indexId, isActive: true, disbursementStatus: { in: ['APPROVED_LEVEL2', 'DISBURSED'] } },
                });
                if (lockedLoans > 0) {
                    throw new Error(`Cannot delete this index: ${lockedLoans} loan(s) are already AM approved or disbursed`);
                }

                const indexLoans = await tx.loan.findMany({
                    where: { indexId },
                    select: { id: true, disbursementStatus: true },
                });

                // 1a. Loans waiting for AM approval go back to the pre-index stage so they
                // don't sit in the unindexed pool with a stale PENDING_LEVEL2 status.
                await tx.loan.updateMany({
                    where: { indexId, disbursementStatus: 'PENDING_LEVEL2' },
                    data: { disbursementStatus: 'PENDING_LEVEL1' },
                });

                // 1b. Update all loans associated with this index to remove the link
                await tx.loan.updateMany({
                    where: { indexId: indexId },
                    data: { indexId: null, indexedAmount: null, memberIndividualApprovedAmount: null },
                });

                await recordLoanHistory(
                    tx,
                    indexLoans.map((l) => ({
                        loanId: l.id,
                        action: 'INDEX_DELETED',
                        performedById: user.userId,
                        remarks: `Index ${loanIndex.indexNo} deleted: ${reason}`,
                        previousState: l.disbursementStatus,
                        newState: l.disbursementStatus === 'PENDING_LEVEL2' ? 'PENDING_LEVEL1' : l.disbursementStatus,
                    }))
                );

                // 2. Soft delete the index (keeping it for records but mark as inactive)
                // Or hard delete if that's the requirement. Here we'll soft delete as it has isActive field.
                await tx.loanIndex.update({
                    where: { id: indexId },
                    data: { isActive: false, deletedById: user.userId, deletedAt: new Date(), deleteReason: reason },
                });
            });

            return successResponse({}, 'Loan index deleted successfully');
        } catch (error) {
            if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
            console.error('Error deleting loan index:', error);
            const message = error instanceof Error ? error.message : 'Failed to delete loan index';
            return errorResponse(message, message.startsWith('Cannot delete this index') ? 400 : 500);
        }
    })(request);
}

/**
 * GET /api/loan-indexes/[indexId]
 * Get details for a single loan index
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ indexId: string }> }
) {
    return withAuth(async (req, user) => {
        try {
            const { indexId } = await params;

            const loanIndex = await prisma.loanIndex.findUnique({
                where: { id: indexId },
                include: {
                    center: {
                        select: {
                            code: true,
                            name: true,
                        },
                    },
                    createdBy: {
                        select: {
                            firstName: true,
                            lastName: true,
                        },
                    },
                },
            });

            if (!loanIndex || !loanIndex.isActive) {
                return errorResponse('Loan index not found', 404);
            }

            return successResponse(loanIndex, 'Loan index retrieved successfully');
        } catch (error) {
            console.error('Error fetching loan index details:', error);
            return errorResponse(
                error instanceof Error ? error.message : 'Failed to fetch loan index details',
                500
            );
        }
    })(request);
}
