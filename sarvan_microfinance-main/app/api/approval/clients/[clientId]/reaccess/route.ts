import { NextRequest } from 'next/server';
import * as z from 'zod';
import { prisma } from '@/app/lib/prisma';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
} from '@/app/lib/api-utils';
import type { ClientApprovalStatus } from '@prisma/client';
import { getActiveWorkflowConfig, getPendingStatusForStage } from '@/app/lib/workflow-config';
import { canAccessClientBranch, getClientApprovalBranchId } from '@/app/lib/client-approval-access';
import { isSubAdminUser } from '@/app/lib/permissions/sub-admin';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const bodySchema = z.object({
    remarks: z.string().trim().min(1, 'Remarks are required to re-access a rejected member'),
});

const REJECT_ACTIONS = ['BM_REJECTED_CLIENT', 'AM_REJECTED_CLIENT', 'QC_REJECTED_CLIENT', 'FINAL_REJECTED_CLIENT', 'LEVEL_REJECTED'] as const;

// Legacy fixed chain (no ClientWorkflowConfig active).
const LEGACY_PENDING_STATUSES = ['SUBMITTED', 'PENDING_BM_REVIEW', 'PENDING_AM_REVIEW', 'PENDING_QC_VERIFICATION', 'PENDING_FINAL_REVIEW'];

/**
 * POST /api/approval/clients/[clientId]/reaccess
 * Re-access a REJECTED client: it goes back to the exact stage that rejected it
 * (the approvalStatus recorded in the rejection's history previousState), so the
 * same stage reviews it again. KYC decisions are left untouched.
 *
 * If the workflow config has changed since and that stage no longer exists, the
 * client restarts at the first stage (SUBMITTED).
 *
 * @access ADMIN, Sub Admin, BRANCH_MANAGER, AREA_MANAGER — scoped to the client's branch
 */
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ clientId: string }> }
) {
    const { clientId } = await params;

    return withAuth(async (req, user) => {
        try {
            const { remarks } = bodySchema.parse(await req.json());

            const isSubAdmin = user.role !== 'ADMIN' && await isSubAdminUser(user.userId);
            if (!['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'].includes(user.role) && !isSubAdmin) {
                return errorResponse('Insufficient permissions', 403);
            }

            const client = await prisma.client.findFirst({
                where: { clientId },
                orderBy: { createdAt: 'asc' },
                select: {
                    id: true,
                    approvalStatus: true,
                    center: { select: { branchId: true } },
                    requestedCenter: { select: { branchId: true } },
                    enrolledBy: { select: { branchId: true } },
                },
            });
            if (!client) return errorResponse('Client not found', 404);
            if (client.approvalStatus !== 'REJECTED') {
                return errorResponse(`Only rejected members can be re-accessed (current status: ${client.approvalStatus})`, 400);
            }
            if (!(await canAccessClientBranch(user, getClientApprovalBranchId(client)))) {
                return errorResponse('Client does not belong to your branch', 403);
            }

            const lastReject = await prisma.clientApprovalHistory.findFirst({
                where: { clientId: client.id, action: { in: [...REJECT_ACTIONS] } },
                orderBy: { createdAt: 'desc' },
                select: { previousState: true },
            });
            let rejectedAtStatus: string | null = null;
            try {
                rejectedAtStatus = lastReject?.previousState ? JSON.parse(lastReject.previousState).approvalStatus ?? null : null;
            } catch { /* malformed snapshot → fall back to SUBMITTED */ }

            const wfConfig = await getActiveWorkflowConfig();
            const validStatuses = wfConfig
                ? ['SUBMITTED', 'PENDING_FINAL_REVIEW', ...wfConfig.stages.map(getPendingStatusForStage)]
                : LEGACY_PENDING_STATUSES;
            const newStatus = (rejectedAtStatus && validStatuses.includes(rejectedAtStatus)
                ? rejectedAtStatus
                : 'SUBMITTED') as ClientApprovalStatus;

            const [updated] = await prisma.$transaction([
                prisma.client.update({
                    where: { id: client.id },
                    data: {
                        approvalStatus: newStatus,
                        verificationStatus: 'UNDER_REVIEW',
                        rejectionReason: null,
                    },
                    select: { id: true, clientId: true, approvalStatus: true },
                }),
                prisma.clientApprovalHistory.create({
                    data: {
                        clientId: client.id,
                        action: 'REJECTION_REVOKED',
                        performedById: user.userId,
                        remarks,
                        previousState: JSON.stringify({ approvalStatus: 'REJECTED' }),
                        newState: JSON.stringify({ approvalStatus: newStatus }),
                    },
                }),
            ]);

            return successResponse(
                { client: updated, newStatus, returnedToRejectingStage: newStatus === rejectedAtStatus },
                'Member re-accessed and returned to the approval queue'
            );
        } catch (error) {
            if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
            console.error('Error re-accessing rejected client:', error);
            return errorResponse(error instanceof Error ? error.message : 'Failed to re-access member', 500);
        }
    })(request);
}
