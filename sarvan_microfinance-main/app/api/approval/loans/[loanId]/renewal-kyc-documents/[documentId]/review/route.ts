import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
} from '@/app/lib/api-utils';
import { KYCDocumentDecision } from '@prisma/client';
import { getUserWorkflowRoleSlugs, userHoldsStage } from '@/app/lib/workflow-config';
import { getRenewalStages, resolveRenewalStage } from '@/app/lib/renewal-workflow';
import {
    KYC_STAGE_DECISION_SELECT,
    getStageDecision,
    writeStageDecision,
} from '@/app/lib/kyc-stage-decisions';
import { canAccessClientBranch } from '@/app/lib/client-approval-access';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * POST /api/approval/loans/[loanId]/renewal-kyc-documents/[documentId]/review
 *
 * Per-document analogue of /api/approval/loans/[loanId]/renewal-action, scoped to a
 * single re-uploaded house/co-applicant image on a Renewal Loan. Whoever holds the
 * stage the loan is waiting on (configured workflow order — see renewal-workflow.ts)
 * approves or flags-for-retake ONE image at a time; the decision is stored by role
 * (kyc-stage-decisions.ts). renewal-action's LEVEL_APPROVE then refuses to forward the
 * loan until every renewal document is VERIFIED by the current stage.
 *
 * Body:
 *   decision:  "VERIFIED" | "RETAKE_REQUIRED"
 *   remarks?:  string  (mandatory for RETAKE_REQUIRED)
 */
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ loanId: string; documentId: string }> }
) {
    const { loanId, documentId } = await params;

    return withAuth(async (req, user) => {
        try {
            const body = await req.json();
            const { decision, remarks } = body as { decision: string; remarks?: string };

            const validDecisions: KYCDocumentDecision[] = ['VERIFIED', 'RETAKE_REQUIRED'];
            if (!validDecisions.includes(decision as KYCDocumentDecision)) {
                return errorResponse(`Invalid decision. Must be one of: ${validDecisions.join(', ')}`, 400);
            }
            if (decision === 'RETAKE_REQUIRED' && (!remarks || !remarks.trim())) {
                return errorResponse('Remarks are required to request a retake', 400);
            }

            const loan = await prisma.loan.findUnique({
                where: { id: loanId },
                select: { id: true, isRenewalApplication: true, renewalApprovalStatus: true, branchId: true },
            });
            if (!loan) return errorResponse('Renewal loan not found', 404);
            if (!loan.isRenewalApplication || !loan.renewalApprovalStatus) {
                return errorResponse('This loan is not a renewal loan application', 400);
            }

            // The stage the loan is waiting on (configured order, any role), and the
            // user must hold it — same rule as renewal-action's stage actions.
            const { stages, isDynamic } = await getRenewalStages();
            const stage = resolveRenewalStage(loan.renewalApprovalStatus, stages);
            if (!stage) {
                return errorResponse(`Documents cannot be reviewed while the loan is at status: ${loan.renewalApprovalStatus}`, 400);
            }
            const slugs = await getUserWorkflowRoleSlugs(user);
            const legacyAdminOverride = !isDynamic && user.role === 'ADMIN';
            if (!userHoldsStage(stage, slugs) && !legacyAdminOverride) {
                return errorResponse(`This renewal loan is waiting for "${stage.stageName}" — you are not the current reviewer`, 403);
            }
            if (!(await canAccessClientBranch(user, loan.branchId))) {
                return errorResponse('Loan does not belong to your branch', 403);
            }

            const doc = await prisma.kYC.findFirst({
                where: { id: documentId, loanId: loan.id, isDeleted: false },
                select: { id: true, documentType: true, retakeReason: true, ...KYC_STAGE_DECISION_SELECT },
            });
            if (!doc) return errorResponse('Renewal document not found', 404);

            const now = new Date();
            const previousDecision = getStageDecision(doc, stage.roleSlug).decision;
            const stageInfo = { levelOrder: stage.levelOrder, roleSlug: stage.roleSlug, stageName: stage.stageName };

            const updatedDoc = await prisma.$transaction(async (tx) => {
                await writeStageDecision(tx, {
                    kycId: doc.id,
                    roleSlug: stage.roleSlug,
                    decision: decision as KYCDocumentDecision,
                    remark: decision === 'RETAKE_REQUIRED' ? (remarks || null) : null,
                    reviewerId: user.userId,
                    reviewedAt: now,
                    kycExtra: decision === 'RETAKE_REQUIRED'
                        ? { retakeReason: remarks || null }
                        : doc.retakeReason ? { retakeReason: null } : undefined,
                });
                await tx.loanApprovalHistory.create({
                    data: {
                        loanId: loan.id,
                        action: `RENEWAL_DOC_${decision}`,
                        performedById: user.userId,
                        remarks: remarks || `${doc.documentType} ${decision.toLowerCase().replace('_', ' ')}`,
                        kycDocumentId: documentId,
                        previousState: JSON.stringify({ documentId, stage: stageInfo, decision: previousDecision }),
                        newState: JSON.stringify({ documentId, stage: stageInfo, decision }),
                    },
                });
                return tx.kYC.findUnique({ where: { id: doc.id } });
            });

            return successResponse({ document: updatedDoc }, `Document ${decision.toLowerCase().replace('_', ' ')} successfully`);
        } catch (error) {
            console.error('Error reviewing renewal KYC document:', error);
            return errorResponse(
                error instanceof Error ? error.message : 'Failed to review renewal document',
                500
            );
        }
    })(request);
}
