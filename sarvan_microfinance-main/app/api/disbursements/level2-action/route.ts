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
import { getKolkataCalendarYmd } from '@/app/lib/branch-lock';
import { findIncompleteMemberIndividualLoanIds } from '@/app/lib/member-individual-gate';
import { getAreaManagerBranchIds } from '@/app/lib/am-branch-utils';



export async function OPTIONS() {
    return handleCorsPreflight();
}

const level2ActionSchema = z.object({
    centerId: z.string().min(1, 'Center ID is required'),
    action: z.enum(['APPROVE', 'REJECT']),
    indexIds: z.array(z.string().min(1)).optional(),
    rejectionReason: z.string().optional(),
});

/**
 * POST /api/disbursements/level2-action
 * AM approves loans for disbursement (marks as APPROVED_LEVEL2).
 * The actual disbursement (schedule generation, GL posting) is done
 * separately by BM via POST /api/disbursements/bm-disburse.
 *
 * @access AREA_MANAGER, ADMIN
 */
export async function POST(request: NextRequest) {
    return withRole(['AREA_MANAGER', 'ADMIN'], async (req, user) => {
        try {
            const body = await req.json();
            const { centerId, action, indexIds, rejectionReason } = level2ActionSchema.parse(body);

            const center = await prisma.center.findUnique({
                where: { id: centerId },
                select: { id: true, branchId: true, code: true, name: true },
            });
            if (!center) return errorResponse('Center not found', 404);

            const lockResponse = await assertBranchNotLocked(center.branchId);
            if (lockResponse) return lockResponse;

            // Check permissions against the AM's FULL assigned-branch set, not just their
            // currently-active branch — an AM assigned to branches A/B/C must be able to
            // approve for all three without switching active context first.
            if (user.role === 'AREA_MANAGER') {
                const assignedBranchIds =
                    user.assignedBranchIds && user.assignedBranchIds.length > 0
                        ? user.assignedBranchIds
                        : await getAreaManagerBranchIds(user.userId);
                if (!assignedBranchIds.includes(center.branchId)) {
                    return errorResponse('Insufficient permissions: Center is not in your assigned branches', 403);
                }
            }

            const targetLoans = await prisma.loan.findMany({
                where: {
                    centerId,
                    isActive: true,
                    disbursementStatus: 'PENDING_LEVEL2',
                    ...(indexIds?.length ? { indexId: { in: indexIds } } : {}),
                },
                select: {
                    id: true,
                    clientId: true,
                    client: { select: { clientId: true, firstName: true, lastName: true } },
                },
            });

            if (targetLoans.length === 0) {
                return errorResponse('No pending Level 2 loans found for this action', 400);
            }

            const loanIds = targetLoans.map((l) => l.id);
            const now = new Date();

            // Member Individual + GRT gate — an AM cannot approve a loan for
            // disbursement until the BM has completed Cash Flow, Loan Appraisal
            // and House Hold Visit for that loan, AND the client is covered by a
            // completed center-wide GRT session.
            if (action === 'APPROVE') {
                const incompleteLoanIds = await findIncompleteMemberIndividualLoanIds(targetLoans);
                if (incompleteLoanIds.size > 0) {
                    const names = targetLoans
                        .filter((l) => incompleteLoanIds.has(l.id))
                        .map((l) => `${l.client.clientId} (${l.client.firstName} ${l.client.lastName})`.trim())
                        .join(', ');
                    return errorResponse(
                        `Cannot approve — Member Individual / GRT not completed for: ${names}`,
                        400
                    );
                }
            }

            if (action === 'REJECT') {
                const finalReason =
                    rejectionReason?.trim() ||
                    'Rejected by Area Manager during Level 2 Verification';
                await prisma.$transaction(async (tx) => {
                    await tx.loan.updateMany({
                        where: { id: { in: loanIds } },
                        data: {
                            disbursementStatus: 'REJECTED',
                            rejectionReason: finalReason,
                        },
                    });
                    await recordLoanHistory(
                        tx,
                        loanIds.map((loanId) => ({
                            loanId,
                            action: 'AM_REJECTED',
                            performedById: user.userId,
                            remarks: finalReason,
                            previousState: 'PENDING_LEVEL2',
                            newState: 'REJECTED',
                        }))
                    );
                });

                return successResponse(
                    { count: loanIds.length, centerId, action },
                    `${loanIds.length} loan(s) rejected successfully`
                );
            }

            // APPROVE: mark as APPROVED_LEVEL2 — BM will perform the actual disbursement
            await prisma.$transaction(async (tx) => {
                await tx.loan.updateMany({
                    where: { id: { in: loanIds } },
                    data: {
                        disbursementStatus: 'APPROVED_LEVEL2',
                        approvedLevel2ById: user.userId,
                        approvedLevel2At: now,
                    },
                });
                await recordLoanHistory(
                    tx,
                    loanIds.map((loanId) => ({
                        loanId,
                        action: 'AM_APPROVED',
                        performedById: user.userId,
                        remarks: 'Approved by AM for disbursement',
                        previousState: 'PENDING_LEVEL2',
                        newState: 'APPROVED_LEVEL2',
                    }))
                );
            });

            return successResponse(
                { count: loanIds.length, centerId, action },
                `${loanIds.length} loan(s) approved for disbursement. Branch Manager must now perform the final disbursement.`
            );
        } catch (error: any) {
            if (error instanceof z.ZodError) {
                return errorResponse(
                    `Validation error: ${error.errors.map((e) => e.message).join(', ')}`,
                    400
                );
            }
            console.error('Error processing Level 2 action:', error);
            return errorResponse(error.message || 'Failed to process action', 500);
        }
    })(request);
}
