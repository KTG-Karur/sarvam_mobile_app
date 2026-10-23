import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/prisma';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
} from '@/app/lib/api-utils';
import { isSubAdminUser } from '@/app/lib/permissions/sub-admin';
import { getActiveWorkflowConfig } from '@/app/lib/workflow-config';
import { canAccessClientBranch, getClientApprovalBranchId, resolveActingStage } from '@/app/lib/client-approval-access';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const bodySchema = z.object({
    loanProductId: z.string().min(1).optional(),
    loanPurposeId: z.string().min(1).optional(),
}).refine((b) => !!b.loanProductId || !!b.loanPurposeId, { message: 'Nothing to update' });

/**
 * PATCH /api/approval/clients/[clientId]/loan-details
 *
 * Lets a reviewer (BM/AM/QC/Admin, at any stage) edit the loan details a
 * client requested at enrollment — product and/or purpose — before their
 * first Loan is auto-created at FINAL_APPROVE (see first-loan.service.ts).
 * Changing the product also re-derives the requested amount and frequency
 * from it, mirroring the same "product drives amount/frequency" convention
 * used by /api/disbursements/[loanId]/update-product for a real, already-
 * created Loan. Changing the purpose re-derives its purpose type.
 *
 * @access BRANCH_MANAGER, AREA_MANAGER, ADMIN, QC team, Sub Admin roles
 */
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ clientId: string }> }
) {
    const { clientId } = await params;

    return withAuth(async (req, user) => {
        try {
            const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
            if (!parsed.success) {
                return errorResponse(parsed.error.errors[0]?.message || 'Invalid request', 400);
            }
            const { loanProductId, loanPurposeId } = parsed.data;

            const isQCTeam = user.role === 'QC' || !!(await prisma.userRoleAssignment.findFirst({
                where: { userId: user.userId, isActive: true, role: { slug: 'quality-checkers', isActive: true } },
            }));
            const isSubAdmin = user.role !== 'ADMIN' && await isSubAdminUser(user.userId);
            const allowedRoles = ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH'];
            const isBuiltinReviewer = allowedRoles.includes(user.role) || isQCTeam || isSubAdmin;

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

            // Any other role may change loan details only while the client is at a
            // dynamic workflow stage that role holds (and within its branch scope).
            if (!isBuiltinReviewer) {
                const wfConfig = await getActiveWorkflowConfig();
                const acting = wfConfig ? await resolveActingStage(user, client.approvalStatus, wfConfig.stages) : null;
                if (!acting?.ok) return errorResponse('Insufficient permissions', 403);
                if (!(await canAccessClientBranch(user, getClientApprovalBranchId(client)))) {
                    return errorResponse('Client does not belong to your branch', 403);
                }
            }
            if (client.approvalStatus === 'APPROVED' || client.approvalStatus === 'REJECTED') {
                return errorResponse(`Cannot change loan details once the client is ${client.approvalStatus.toLowerCase()}`, 400);
            }

            if (user.role === 'BRANCH_MANAGER') {
                const u = await prisma.user.findUnique({ where: { id: user.userId }, select: { branchId: true } });
                const clientBranchId = client.center?.branchId ?? client.enrolledBy?.branchId ?? null;
                if (!u?.branchId || clientBranchId !== u.branchId) {
                    return errorResponse('Client does not belong to your branch', 403);
                }
            }

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const data: Record<string, any> = {};
            let productName: string | undefined;
            let purposeName: string | undefined;

            if (loanProductId) {
                const product = await prisma.loanProduct.findUnique({
                    where: { id: loanProductId },
                    select: { id: true, productName: true, loanAmount: true, frequency: true, loanProductTypeId: true, isActive: true },
                });
                if (!product || !product.isActive) {
                    return errorResponse('Selected loan product is not available', 404);
                }
                data.requestedLoanProductId = product.id;
                data.requestedLoanProductTypeId = product.loanProductTypeId;
                data.requestedAmount = product.loanAmount;
                data.requestedLoanFrequency = product.frequency;
                productName = product.productName;
            }

            if (loanPurposeId) {
                const purpose = await prisma.loanPurpose.findUnique({
                    where: { id: loanPurposeId },
                    select: { id: true, name: true, loanPurposeTypeId: true, isActive: true },
                });
                if (!purpose || !purpose.isActive) {
                    return errorResponse('Selected loan purpose is not available', 404);
                }
                data.requestedLoanPurposeId = purpose.id;
                data.requestedLoanPurposeTypeId = purpose.loanPurposeTypeId;
                purposeName = purpose.name;
            }

            // No dedicated ClientApprovalHistory row here — ApprovalAction has no
            // "loan details changed" value, and (mirroring the rest of this route's
            // plain field-edit convention) not every edit gets its own audit entry,
            // only actual stage transitions do.
            const updated = await prisma.client.update({
                where: { id: client.id },
                data,
                select: {
                    id: true,
                    requestedLoanProductId: true, requestedAmount: true, requestedLoanFrequency: true,
                    requestedLoanPurposeId: true,
                },
            });

            return successResponse(
                {
                    id: updated.id,
                    requestedLoanProductId: updated.requestedLoanProductId,
                    productName,
                    requestedAmount: updated.requestedAmount != null ? Number(updated.requestedAmount) : null,
                    requestedLoanFrequency: updated.requestedLoanFrequency,
                    requestedLoanPurposeId: updated.requestedLoanPurposeId,
                    purposeName,
                },
                'Loan details updated successfully'
            );
        } catch (error) {
            console.error('Error updating requested loan details:', error);
            return errorResponse(error instanceof Error ? error.message : 'Failed to update loan details', 500);
        }
    })(request);
}
