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
import { getRenewalStages, resolveRenewalStage, getFirstRenewalStatus } from '@/app/lib/renewal-workflow';
import { canAccessClientBranch } from '@/app/lib/client-approval-access';
import { isSubAdminUser } from '@/app/lib/permissions/sub-admin';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const bodySchema = z.object({
    remarks: z.string().trim().min(1, 'Remarks are required to re-access a rejected renewal loan'),
});

/**
 * POST /api/approval/loans/[loanId]/renewal-reaccess
 * Re-access a REJECTED renewal loan: it goes back to the exact stage that
 * rejected it (the renewalApprovalStatus recorded in the RENEWAL_REJECTED
 * history entry's previousState). Renewal KYC decisions are left untouched.
 *
 * - If that stage is no longer in the workflow, the renewal restarts at the first stage.
 * - Blocked when the member has since started another renewal / unindexed loan
 *   (same in-flight guard as renewal creation), so two never run at once.
 *
 * @access ADMIN, Sub Admin, BRANCH_MANAGER, AREA_MANAGER — scoped to the loan's branch
 */
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ loanId: string }> }
) {
    const { loanId } = await params;

    return withAuth(async (req, user) => {
        try {
            const { remarks } = bodySchema.parse(await req.json());

            const isSubAdmin = user.role !== 'ADMIN' && await isSubAdminUser(user.userId);
            if (!['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'].includes(user.role) && !isSubAdmin) {
                return errorResponse('Insufficient permissions', 403);
            }

            const loan = await prisma.loan.findUnique({
                where: { id: loanId },
                select: {
                    id: true,
                    loanNumber: true,
                    clientId: true,
                    branchId: true,
                    isActive: true,
                    isRenewalApplication: true,
                    renewalApprovalStatus: true,
                },
            });
            if (!loan || !loan.isActive) return errorResponse('Renewal loan not found', 404);
            if (!loan.isRenewalApplication) return errorResponse('This loan is not a renewal loan application', 400);
            if (loan.renewalApprovalStatus !== 'REJECTED') {
                return errorResponse(`Only rejected renewal loans can be re-accessed (current status: ${loan.renewalApprovalStatus})`, 400);
            }
            if (!(await canAccessClientBranch(user, loan.branchId))) {
                return errorResponse('Loan does not belong to your branch', 403);
            }

            const blockingLoan = await prisma.loan.findFirst({
                where: {
                    clientId: loan.clientId,
                    isActive: true,
                    id: { not: loan.id },
                    OR: [
                        { renewalApprovalStatus: { notIn: ['APPROVED', 'REJECTED'] as ClientApprovalStatus[] } },
                        {
                            indexId: null,
                            disbursementStatus: { in: ['PENDING_LEVEL1', 'APPROVED_LEVEL1'] },
                            applicationStatus: { in: ['PENDING_VERIFICATION', 'VERIFIED'] },
                        },
                    ],
                },
                select: { loanNumber: true },
            });
            if (blockingLoan) {
                return errorResponse(
                    `This member already has another loan application in progress (${blockingLoan.loanNumber}). Complete or delete it before re-accessing this renewal.`,
                    409
                );
            }

            const lastReject = await prisma.loanApprovalHistory.findFirst({
                where: { loanId: loan.id, action: 'RENEWAL_REJECTED' },
                orderBy: { createdAt: 'desc' },
                select: { previousState: true },
            });
            let rejectedAtStatus: string | null = null;
            try {
                rejectedAtStatus = lastReject?.previousState ? JSON.parse(lastReject.previousState).renewalApprovalStatus ?? null : null;
            } catch { /* malformed snapshot → restart at first stage */ }

            const { stages } = await getRenewalStages();
            const isValidTarget = !!rejectedAtStatus && rejectedAtStatus !== 'REJECTED' && (
                rejectedAtStatus === 'PENDING_FINAL_REVIEW' || !!resolveRenewalStage(rejectedAtStatus, stages)
            );
            const newStatus = (isValidTarget ? rejectedAtStatus : getFirstRenewalStatus(stages)) as ClientApprovalStatus;

            await prisma.$transaction([
                prisma.loan.update({
                    where: { id: loan.id },
                    data: { renewalApprovalStatus: newStatus },
                }),
                prisma.loanApprovalHistory.create({
                    data: {
                        loanId: loan.id,
                        action: 'RENEWAL_REJECTION_REVOKED',
                        performedById: user.userId,
                        remarks,
                        previousState: JSON.stringify({ renewalApprovalStatus: 'REJECTED' }),
                        newState: JSON.stringify({ renewalApprovalStatus: newStatus }),
                    },
                }),
            ]);

            return successResponse(
                { loanId: loan.id, loanNumber: loan.loanNumber, newStatus, returnedToRejectingStage: isValidTarget },
                'Renewal loan re-accessed and returned to the approval queue'
            );
        } catch (error) {
            if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
            console.error('Error re-accessing rejected renewal loan:', error);
            return errorResponse(error instanceof Error ? error.message : 'Failed to re-access renewal loan', 500);
        }
    })(request);
}
