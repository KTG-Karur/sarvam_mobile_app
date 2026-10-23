import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { errorResponse, successResponse, withAuth } from '@/app/lib/api-utils';
import { getBranchEodLockYmdMap, isEodLockedForTransaction } from '@/app/lib/financial-transaction-eod-lock';
import { isSubAdminUser } from '@/app/lib/permissions/sub-admin';
import { z } from 'zod';

const approvalActionSchema = z.object({
    action: z.enum(['approve', 'reject', 'revert']),
    rejectionReason: z.string().optional(),
    revertReason: z.string().optional(),
});

/**
 * PATCH /api/transactions/approval/[id]
 * Single approval flow: AM, Admin, and Sub-Admin approve PENDING_APPROVAL → APPROVED
 * Any of these roles can reject: PENDING_APPROVAL → REJECTED, or APPROVED → REJECTED
 * (an already-approved voucher can still be reversed by rejecting it, as long
 * as EOD hasn't closed its branch/date yet — see the EOD-lock check below).
 * Symmetrically, a REJECTED voucher can still be approved (reversing the
 * rejection) under the same EOD-open condition.
 * Once approved, transaction is immediately APPROVED and ready to post.
 */
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    return withAuth(async (req, user) => {
        try {
            const isSubAdmin = user.role !== 'ADMIN' && user.role !== 'AREA_MANAGER' && await isSubAdminUser(user.userId);
            if (user.role !== 'AREA_MANAGER' && user.role !== 'ADMIN' && !isSubAdmin) {
                return errorResponse('Only Area Managers, Admins, and Sub-Admins can perform approval actions', 403);
            }

            const { id } = await params;
            const body = await req.json();
            const validation = approvalActionSchema.safeParse(body);

            if (!validation.success) {
                return errorResponse(validation.error.errors[0].message, 400);
            }

            const { action, rejectionReason, revertReason } = validation.data;

            if (action === 'reject' && !rejectionReason?.trim()) {
                return errorResponse('Rejection reason is required', 400);
            }
            if (action === 'revert' && !revertReason?.trim()) {
                return errorResponse('Revert reason is required', 400);
            }
            if (action === 'revert' && user.role !== 'ADMIN' && !isSubAdmin) {
                return errorResponse('Only Admins and Sub-Admins can revert an approved transaction', 403);
            }

            const tx = await prisma.financialTransaction.findFirst({
                where: { id, isActive: true },
            });

            if (!tx) {
                return errorResponse('Transaction not found', 404);
            }

            // System-posted vouchers (e.g. Loan Advance Refund) are owned by the
            // workflow that created them — approving/rejecting/reverting here would
            // desync the source record. They can only be undone from that workflow's
            // own revert screen.
            if (tx.postingMarker) {
                return errorResponse(
                    'This voucher was auto-posted by another workflow (e.g. Loan Advance Refund). Undo it from that workflow\'s revert screen, not here.',
                    409
                );
            }

            // For AM, verify they have access to this transaction's branch
            if (user.role === 'AREA_MANAGER') {
                const assignedBranchIds = (user as any).assignedBranchIds || [];
                if (tx.branchId && !assignedBranchIds.includes(tx.branchId)) {
                    return errorResponse('Access denied to this transaction', 403);
                }
            }

            console.log(`[PATCH] Transaction ${id} current status: ${tx.approvalStatus}, user role: ${user.role}, action: ${action}`);

            // Approve can act on PENDING_APPROVAL (normal approval) or REJECTED
            // (reversing a rejection) — but not on an already-APPROVED transaction.
            // Reject can act on PENDING_APPROVAL (normal rejection), APPROVED
            // (reversing an approval), or REVERTED (mark a reverted transaction
            // dead-end instead of editing and resubmitting it) — but not on an
            // already-REJECTED transaction.
            if (action === 'approve' && tx.approvalStatus !== 'PENDING_APPROVAL' && tx.approvalStatus !== 'REJECTED') {
                return errorResponse(
                    `Transaction is in ${tx.approvalStatus} status. Can only approve PENDING_APPROVAL or REJECTED transactions.`,
                    409
                );
            }
            if (action === 'reject' && tx.approvalStatus !== 'PENDING_APPROVAL' && tx.approvalStatus !== 'APPROVED' && tx.approvalStatus !== 'REVERTED') {
                return errorResponse(
                    `Transaction is in ${tx.approvalStatus} status. Can only reject PENDING_APPROVAL, APPROVED, or REVERTED transactions.`,
                    409
                );
            }
            if (action === 'revert' && tx.approvalStatus !== 'APPROVED') {
                return errorResponse(
                    `Transaction is in ${tx.approvalStatus} status. Can only revert APPROVED transactions.`,
                    409
                );
            }

            // Both approve and reject are locked once EOD has moved the branch's
            // working date past this transaction's date.
            if (tx.branchId) {
                const lockYmd = (await getBranchEodLockYmdMap([tx.branchId])).get(tx.branchId);
                if (isEodLockedForTransaction(lockYmd, tx.transactionDate)) {
                    return errorResponse('EOD date does not match the branch\'s current working date — action locked', 409);
                }
            }

            const previousStatus = tx.approvalStatus;
            let newStatus: string;
            let historyAction: string;
            let updateData: Record<string, unknown>;
            let successMessage: string;

            if (action === 'approve') {
                // AM, ADMIN, and Sub-Admin all move to APPROVED immediately
                newStatus = 'APPROVED';
                const approverRole = user.role === 'AREA_MANAGER' ? 'AM' : 'ADMIN';
                historyAction = approverRole === 'AM' ? 'AM_APPROVED' : 'ADMIN_APPROVED';

                updateData = {
                    approvalStatus: 'APPROVED',
                    // Prior rejectedBy/rejectedAt/rejectionReason are intentionally left
                    // untouched when reversing a REJECTED transaction back to APPROVED —
                    // that history stays visible in the modal alongside the new approval.
                    ...(approverRole === 'AM' && {
                        amApprovedById: user.userId,
                        amApprovedAt: new Date(),
                    }),
                    ...(approverRole === 'ADMIN' && {
                        adminApprovedById: user.userId,
                        adminApprovedAt: new Date(),
                    }),
                };
                successMessage = `Transaction approved by ${approverRole} — posted to accounts and ledger`;
            } else if (action === 'revert') {
                newStatus = 'REVERTED';
                historyAction = 'REVERTED';
                updateData = {
                    approvalStatus: 'REVERTED',
                    revertedById: user.userId,
                    revertedAt: new Date(),
                    revertReason,
                };
                successMessage = 'Transaction reverted — it can now be edited and will re-enter the approval queue once saved';
            } else {
                // Rejection is the same for both roles
                newStatus = 'REJECTED';
                historyAction = user.role === 'AREA_MANAGER' ? 'AM_REJECTED' : 'ADMIN_REJECTED';
                updateData = {
                    approvalStatus: 'REJECTED',
                    rejectedById: user.userId,
                    rejectedAt: new Date(),
                    rejectionReason,
                };
                successMessage = `Transaction rejected by ${user.role === 'AREA_MANAGER' ? 'AM' : 'Admin'}`;
            }

            // Use transaction to ensure both operations succeed
            const result = await prisma.$transaction(async (prisma) => {
                const updatedTx = await prisma.financialTransaction.update({
                    where: { id },
                    data: updateData as any,
                });

                await prisma.transactionApprovalHistory.create({
                    data: {
                        transactionId: id,
                        action: historyAction as any,
                        performedById: user.userId,
                        previousStatus: previousStatus as any,
                        newStatus: newStatus as any,
                        remarks: action === 'reject' ? rejectionReason : action === 'revert' ? revertReason : undefined,
                    },
                });

                return updatedTx;
            });

            console.log(`[PATCH] Transaction ${id} updated: ${previousStatus} → ${newStatus}`);

            return successResponse(result, successMessage);
        } catch (error) {
            console.error('Error processing approval action:', error);
            return errorResponse('Failed to process approval action', 500);
        }
    })(request);
}

/**
 * GET /api/transactions/approval/[id]
 * Fetch a single transaction with full approval history.
 */
export async function GET_DETAIL(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    return withAuth(async (req, user) => {
        try {
            if (user.role !== 'AREA_MANAGER' && user.role !== 'ADMIN') {
                return errorResponse('Access denied', 403);
            }

            const { id } = await params;

            const tx = await prisma.financialTransaction.findFirst({
                where: { id, isActive: true },
                include: {
                    selfAccount: { select: { id: true, name: true } },
                    contraAccount: { select: { id: true, name: true } },
                    ledger: { select: { id: true, ledgerName: true } },
                    creditLedger: { select: { id: true, ledgerName: true } },
                    createdBy: { select: { id: true, firstName: true, lastName: true, role: true } },
                    amApprovedBy: { select: { id: true, firstName: true, lastName: true } },
                    adminApprovedBy: { select: { id: true, firstName: true, lastName: true } },
                    rejectedBy: { select: { id: true, firstName: true, lastName: true } },
                    revertedBy: { select: { id: true, firstName: true, lastName: true } },
                    approvalHistory: {
                        include: {
                            performedBy: { select: { id: true, firstName: true, lastName: true, role: true } },
                        },
                        orderBy: { createdAt: 'asc' },
                    },
                    branch: { select: { id: true, name: true, code: true } },
                },
            });

            if (!tx) return errorResponse('Transaction not found', 404);
            
            // For AM, verify they have access to this transaction's branch
            if (user.role === 'AREA_MANAGER') {
                const assignedBranchIds = (user as any).assignedBranchIds || [];
                if (tx.branchId && !assignedBranchIds.includes(tx.branchId)) {
                    return errorResponse('Access denied to this transaction', 403);
                }
            }

            return successResponse(tx);
        } catch (error) {
            console.error('Error fetching transaction:', error);
            return errorResponse('Failed to fetch transaction', 500);
        }
    })(request);
}
