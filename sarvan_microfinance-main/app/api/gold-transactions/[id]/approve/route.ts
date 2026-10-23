import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';

export async function OPTIONS() {
    return handleCorsPreflight();
}

// PATCH /api/gold-transactions/[id]/approve - AM approves or rejects a gold return
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    return withRole(['ADMIN', 'AREA_MANAGER'], async (req, user) => {
        try {
            const { id } = await params;
            const body = await req.json();
            const { action, rejectionReason } = body; // action: 'APPROVE' | 'REJECT'

            if (!action || !['APPROVE', 'REJECT'].includes(action)) {
                return errorResponse('action must be APPROVE or REJECT', 400);
            }

            const goldTxn = await prisma.goldTransaction.findUnique({
                where: { id },
                include: { loan: { select: { branchId: true, loanNumber: true } } },
            });

            if (!goldTxn) return errorResponse('Gold transaction not found', 404);
            if (goldTxn.type !== 'GIVE') return errorResponse('Only GIVE transactions require approval', 400);
            if (goldTxn.status !== 'PENDING') return errorResponse('Transaction is not pending approval', 400);

            // AM branch scope check
            if (user.role === 'AREA_MANAGER') {
                const assignedIds = user.assignedBranchIds || [];
                if (assignedIds.length > 0 && !assignedIds.includes(goldTxn.loan.branchId)) {
                    return errorResponse('This loan does not belong to your assigned branches', 403);
                }
            }

            if (action === 'REJECT' && !rejectionReason?.trim()) {
                return errorResponse('Rejection reason is required', 400);
            }

            const updated = await prisma.goldTransaction.update({
                where: { id },
                data:
                    action === 'APPROVE'
                        ? { status: 'APPROVED', approvedById: user.userId, approvedAt: new Date() }
                        : { status: 'REJECTED', rejectedById: user.userId, rejectedAt: new Date(), rejectionReason },
                include: {
                    loan: { select: { loanNumber: true } },
                    approvedBy: { select: { firstName: true, lastName: true } },
                    rejectedBy: { select: { firstName: true, lastName: true } },
                },
            });

            const msg = action === 'APPROVE' ? 'Gold return approved successfully' : 'Gold return rejected';
            return successResponse(updated, msg);
        } catch (error) {
            console.error('Error approving gold transaction:', error);
            return errorResponse('Failed to process approval', 500);
        }
    })(request);
}
