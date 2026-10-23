import { NextRequest } from 'next/server';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { recordLoanHistory } from '@/app/lib/loan-history';
import { z } from 'zod';
import { assertBranchNotLocked } from '@/app/lib/branch-lock';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const rejectLoansSchema = z.object({
    centerId: z.string().min(1, 'Center ID is required'),
    loanIds: z.array(z.string().min(1)).min(1, 'Select at least one loan to reject'),
    reason: z.string().trim().min(3, 'A reason (at least 3 characters) is required'),
});

/**
 * POST /api/loan-indexes/reject-loans
 * BM rejects unindexed loans from the Loan Indexation screen. The loans are not
 * part of any index (rejection happens before / instead of indexing), so this
 * works with or without an index being created in the same save. A rejected
 * loan is final: disbursementStatus REJECTED, and it drops out of the
 * unindexed list (unindexed-loans/route.ts excludes REJECTED).
 *
 * @access BRANCH_MANAGER, ADMIN, ADMIN_NON_HO_BRANCH_SWITCH (branch-scoped)
 */
export async function POST(request: NextRequest) {
    return withRole(['BRANCH_MANAGER', 'ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH'], async (req, user) => {
        try {
            const { centerId, loanIds, reason } = rejectLoansSchema.parse(await req.json());

            const center = await prisma.center.findUnique({
                where: { id: centerId },
                select: { branchId: true },
            });
            if (!center) return errorResponse('Center not found', 404);

            const permitted = await getPermittedBranchIds(user);
            if (permitted !== null && !permitted.includes(center.branchId)) {
                return errorResponse('Access denied to this branch', 403);
            }

            const lockResponse = await assertBranchNotLocked(center.branchId);
            if (lockResponse) return lockResponse;

            // Same eligibility as the unindexed list — only those loans can be rejected here
            const eligibleWhere = {
                id: { in: loanIds },
                centerId,
                indexId: null,
                isActive: true,
                applicationStatus: { in: ['VERIFIED' as const, 'PENDING_VERIFICATION' as const] },
                disbursementStatus: { notIn: ['DISBURSED' as const, 'REJECTED' as const] },
            };
            const loans = await prisma.loan.findMany({
                where: eligibleWhere,
                select: { id: true, disbursementStatus: true },
            });
            if (loans.length !== loanIds.length) {
                return errorResponse('Some loans can no longer be rejected (already indexed, disbursed or rejected) — refresh and try again', 409);
            }

            const remarks = `Rejected by BM at Loan Indexation: ${reason}`;
            await prisma.$transaction(async (tx) => {
                const updated = await tx.loan.updateMany({
                    where: eligibleWhere,
                    data: {
                        disbursementStatus: 'REJECTED',
                        rejectionReason: reason,
                        firstDueDate: null,
                    },
                });
                if (updated.count !== loanIds.length) {
                    throw new Error('Some loans were already processed — refresh and try again');
                }
                await recordLoanHistory(
                    tx,
                    loans.map((l) => ({
                        loanId: l.id,
                        action: 'BM_REJECTED',
                        performedById: user.userId,
                        remarks,
                        previousState: l.disbursementStatus,
                        newState: 'REJECTED',
                    }))
                );
            });

            return successResponse({ rejected: loans.length }, `${loans.length} loan(s) rejected`);
        } catch (error: unknown) {
            if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
            console.error('Error rejecting unindexed loans:', error);
            const message = error instanceof Error ? error.message : 'Failed to reject loans';
            return errorResponse(message, message.startsWith('Some loans were already processed') ? 409 : 500);
        }
    })(request);
}
