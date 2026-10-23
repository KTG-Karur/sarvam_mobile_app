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
import { getAreaManagerBranchIds } from '@/app/lib/am-branch-utils';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * Which screen the reject comes from — fixes the loan status it must be in and
 * who may do it:
 *  - AM_APPROVAL        (Disbursement page)       PENDING_LEVEL2  — AREA_MANAGER / ADMIN
 *  - FINAL_DISBURSEMENT (Final Disbursement page) APPROVED_LEVEL2 — BRANCH_MANAGER / ADMIN
 */
const STAGES = {
    AM_APPROVAL: { status: 'PENDING_LEVEL2', roles: ['AREA_MANAGER', 'ADMIN'], label: 'AM' },
    FINAL_DISBURSEMENT: { status: 'APPROVED_LEVEL2', roles: ['BRANCH_MANAGER', 'ADMIN'], label: 'BM' },
} as const;

const rejectSchema = z.object({
    loanId: z.string().min(1, 'Loan ID is required'),
    stage: z.enum(['AM_APPROVAL', 'FINAL_DISBURSEMENT']),
    reason: z.string().trim().min(3, 'A reason (at least 3 characters) is required'),
});

/**
 * POST /api/disbursements/reject-to-indexation
 * Rejects a single member from an index batch and sends that loan back to Loan
 * Indexation — the per-loan equivalent of deleting the index
 * (DELETE /api/loan-indexes/[indexId]): status returns to PENDING_LEVEL1, the
 * index link / indexed amount (and any AM approval stamp) are cleared, so the BM
 * can re-index it later. The rest of the index is untouched; an index left with
 * no loans is soft-deleted.
 *
 * @access AREA_MANAGER (AM_APPROVAL), BRANCH_MANAGER (FINAL_DISBURSEMENT), ADMIN (both)
 */
export async function POST(request: NextRequest) {
    return withRole(['AREA_MANAGER', 'BRANCH_MANAGER', 'ADMIN'], async (req, user) => {
        try {
            const { loanId, stage, reason } = rejectSchema.parse(await req.json());
            const stageConfig = STAGES[stage];
            if (!(stageConfig.roles as readonly string[]).includes(user.role)) {
                return errorResponse('Insufficient permissions for this stage', 403);
            }

            const loan = await prisma.loan.findUnique({
                where: { id: loanId },
                select: {
                    id: true,
                    isActive: true,
                    indexId: true,
                    disbursementStatus: true,
                    principalPaid: true,
                    interestPaid: true,
                    penaltiesPaid: true,
                    savingsPaid: true,
                    client: { select: { clientId: true, firstName: true, lastName: true } },
                    loanIndex: { select: { id: true, indexNo: true, isActive: true, branchId: true } },
                },
            });
            if (!loan || !loan.isActive) return errorResponse('Loan not found', 404);
            if (!loan.indexId || !loan.loanIndex?.isActive) {
                return errorResponse('Loan is not part of an active index', 400);
            }
            if (loan.disbursementStatus !== stageConfig.status) {
                return errorResponse(`Loan cannot be rejected at this stage (current status: ${loan.disbursementStatus})`, 400);
            }

            const branchId = loan.loanIndex.branchId;
            const lockResponse = await assertBranchNotLocked(branchId);
            if (lockResponse) return lockResponse;

            if (user.role === 'AREA_MANAGER') {
                // Same check as level2-action: the AM's FULL assigned-branch set, not just the active branch
                const assignedBranchIds =
                    user.assignedBranchIds && user.assignedBranchIds.length > 0
                        ? user.assignedBranchIds
                        : await getAreaManagerBranchIds(user.userId);
                if (!assignedBranchIds.includes(branchId)) {
                    return errorResponse('Insufficient permissions: Loan is not in your assigned branches', 403);
                }
            } else if (user.role === 'BRANCH_MANAGER') {
                // Same check as bm-disburse
                const permittedBranchIds = await getPermittedBranchIds(user);
                if (permittedBranchIds !== null && !permittedBranchIds.includes(branchId)) {
                    return errorResponse('Loan does not belong to one of your assigned branches', 403);
                }
            }

            // Mirrors send-back-to-am: an AM-approved loan that already has a schedule or a
            // payment is (being) disbursed — that needs Disbursement Revert, not this.
            if (stage === 'FINAL_DISBURSEMENT') {
                const hasPayments =
                    Number(loan.principalPaid || 0) > 0 ||
                    Number(loan.interestPaid || 0) > 0 ||
                    Number(loan.penaltiesPaid || 0) > 0 ||
                    Number(loan.savingsPaid || 0) > 0;
                const scheduleCount = await prisma.loanSchedule.count({ where: { loanId } });
                if (hasPayments || scheduleCount > 0) {
                    return errorResponse('Cannot reject — this loan is already disbursed or has a payment. Use Disbursement Revert instead.', 400);
                }
            }

            const indexId = loan.indexId;
            const indexNo = loan.loanIndex.indexNo;
            const remarks = `Rejected by ${stageConfig.label} from index ${indexNo} and sent back to Loan Indexation: ${reason}`;

            const { indexClosed } = await prisma.$transaction(async (tx) => {
                // Guarded on status so a concurrent approve/disburse/reject can't be overwritten
                const released = await tx.loan.updateMany({
                    where: { id: loanId, indexId, disbursementStatus: stageConfig.status },
                    data: {
                        disbursementStatus: 'PENDING_LEVEL1',
                        indexId: null,
                        indexedAmount: null,
                        memberIndividualApprovedAmount: null,
                        approvedLevel2ById: null,
                        approvedLevel2At: null,
                    },
                });
                if (released.count === 0) {
                    throw new Error('Loan was already processed — refresh and try again');
                }

                await recordLoanHistory(tx, [{
                    loanId,
                    action: `${stageConfig.label}_REJECTED_TO_INDEXATION`,
                    performedById: user.userId,
                    remarks,
                    previousState: stageConfig.status,
                    newState: 'PENDING_LEVEL1',
                }]);

                const remaining = await tx.loan.aggregate({
                    where: { indexId },
                    _count: { _all: true },
                    _sum: { amount: true },
                });
                const remainingCount = remaining._count._all;

                await tx.loanIndex.update({
                    where: { id: indexId },
                    data: {
                        totalApps: remainingCount,
                        totalAmount: remaining._sum.amount ?? 0,
                        ...(remainingCount === 0 && {
                            isActive: false,
                            deletedById: user.userId,
                            deletedAt: new Date(),
                            deleteReason: `All loans rejected back to Loan Indexation (last: ${reason})`,
                        }),
                    },
                });

                return { indexClosed: remainingCount === 0 };
            });

            const memberName = `${loan.client.firstName} ${loan.client.lastName}`.trim();
            return successResponse(
                { loanId, indexId, indexNo, indexClosed },
                `${loan.client.clientId} (${memberName}) rejected and sent back to Loan Indexation` +
                    (indexClosed ? ` — index ${indexNo} had no loans left and was removed` : '')
            );
        } catch (error: unknown) {
            if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
            console.error('Error rejecting loan back to indexation:', error);
            const message = error instanceof Error ? error.message : 'Failed to reject member';
            return errorResponse(message, message.startsWith('Loan was already processed') ? 409 : 500);
        }
    })(request);
}
