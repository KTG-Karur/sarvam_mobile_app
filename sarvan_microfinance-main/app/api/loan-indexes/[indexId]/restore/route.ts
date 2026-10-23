import { NextRequest } from 'next/server';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { recordLoanHistory } from '@/app/lib/loan-history';

export async function OPTIONS() {
    return handleCorsPreflight();
}

// Legacy deletions (before audit history existed) have no INDEX_DELETED rows; the delete
// transaction updated the loans and the index within milliseconds of each other, so loans
// touched within this window of the index's updatedAt are treated as its released loans.
const LEGACY_MATCH_WINDOW_MS = 5000;

/**
 * POST /api/loan-indexes/[indexId]/restore
 * Restores a soft-deleted loan index and relinks the loans it released.
 *
 * @access ADMIN
 */
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ indexId: string }> }
) {
    return withRole(['ADMIN'], async (_req, user) => {
        try {
            const { indexId } = await params;

            const loanIndex = await prisma.loanIndex.findUnique({ where: { id: indexId } });
            if (!loanIndex) return errorResponse('Loan index not found', 404);
            if (loanIndex.isActive) return errorResponse('Loan index is not deleted', 400);

            const candidateSelect = {
                id: true,
                amount: true,
                disbursementStatus: true,
                indexId: true,
                isActive: true,
                updatedAt: true,
            } as const;

            // Primary: loans recorded as released by this index's deletion.
            const history = await prisma.loanApprovalHistory.findMany({
                where: {
                    action: 'INDEX_DELETED',
                    remarks: { startsWith: `Index ${loanIndex.indexNo} deleted` },
                },
                select: { loanId: true },
            });
            let candidates = history.length
                ? await prisma.loan.findMany({
                    where: { id: { in: history.map((h) => h.loanId) } },
                    select: candidateSelect,
                })
                : [];
            let usedLegacyMatch = false;

            // Fallback for indexes deleted before history was recorded.
            if (candidates.length === 0) {
                usedLegacyMatch = true;
                const from = new Date(loanIndex.updatedAt.getTime() - LEGACY_MATCH_WINDOW_MS);
                const to = new Date(loanIndex.updatedAt.getTime() + LEGACY_MATCH_WINDOW_MS);
                candidates = await prisma.loan.findMany({
                    where: {
                        centerId: loanIndex.centerId,
                        indexId: null,
                        updatedAt: { gte: from, lte: to },
                    },
                    select: candidateSelect,
                });
            }

            // Only loans that are still free (not re-indexed elsewhere, not disbursed).
            const restorable = candidates.filter(
                (l) => l.isActive && l.indexId === null && l.disbursementStatus !== 'DISBURSED'
            );
            if (restorable.length === 0) {
                return errorResponse(
                    'No loans can be relinked to this index (they may already be re-indexed or disbursed)',
                    400
                );
            }

            const totalAmount = restorable.reduce((sum, l) => sum + Number(l.amount), 0);

            await prisma.$transaction(async (tx) => {
                // Per-loan update: indexedAmount (the Disbursement-stage ceiling) is per loan.
                for (const l of restorable) {
                    await tx.loan.update({
                        where: { id: l.id },
                        data: { indexId, indexedAmount: l.amount },
                    });
                }

                await tx.loanIndex.update({
                    where: { id: indexId },
                    data: {
                        isActive: true,
                        totalApps: restorable.length,
                        totalAmount,
                        // Keep deletedById/deletedAt/deleteReason as the record of the last deletion;
                        // the restore itself is recorded in the loans' approval history below.
                    },
                });

                await recordLoanHistory(
                    tx,
                    restorable.map((l) => ({
                        loanId: l.id,
                        action: 'INDEX_RESTORED',
                        performedById: user.userId,
                        remarks: `Index ${loanIndex.indexNo} restored by Admin${usedLegacyMatch ? ' (loans matched by deletion time)' : ''}`,
                        previousState: l.disbursementStatus,
                        newState: l.disbursementStatus,
                    }))
                );
            });

            return successResponse(
                { indexId, restoredLoans: restorable.length, matchedByTimestamp: usedLegacyMatch },
                `Index ${loanIndex.indexNo} restored with ${restorable.length} loan(s)`
            );
        } catch (error) {
            console.error('Error restoring loan index:', error);
            return errorResponse(
                error instanceof Error ? error.message : 'Failed to restore loan index',
                500
            );
        }
    })(request);
}
