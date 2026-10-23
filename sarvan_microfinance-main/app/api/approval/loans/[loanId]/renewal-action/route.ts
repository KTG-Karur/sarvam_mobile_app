import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
} from '@/app/lib/api-utils';
import { ClientApprovalStatus, KYCDocumentDecision } from '@prisma/client';
import {
    getRetakeStatusForStage,
    getUserWorkflowRoleSlugs,
    userHoldsStage,
    type WorkflowStage,
} from '@/app/lib/workflow-config';
import {
    getRenewalStages,
    resolveRenewalStage,
    getNextRenewalStatus,
    getFirstRenewalStatus,
    getCoApplicantRequiredRank,
    RENEWAL_RETAKE_STATUSES,
} from '@/app/lib/renewal-workflow';
import {
    KYC_STAGE_DECISION_SELECT,
    getBuiltinColumns,
    getStageDecision,
    writeStageDecision,
} from '@/app/lib/kyc-stage-decisions';
import { canAccessClientBranch } from '@/app/lib/client-approval-access';
import { isSubAdminUser } from '@/app/lib/permissions/sub-admin';
import { renewalLoanService } from '@/app/lib/services/renewal-loan.service';

export async function OPTIONS() {
    return handleCorsPreflight();
}

// Legacy audit names for the built-in stages (the renewal stage-cycle trail reads
// them); any other role's stage is recorded as LEVEL_APPROVED with the stage in newState.
const APPROVE_AUDIT_ACTION: Record<string, string> = {
    BM: 'BM_COMPLETED_REVIEW',
    AM: 'AM_APPROVED_LOAN',
    QC: 'QC_VERIFIED_LOAN',
};

/**
 * POST /api/approval/loans/[loanId]/renewal-action
 *
 * Per-loan analogue of /api/approval/clients/[clientId]/action — drives a
 * renewal loan through the SAME configured stage chain as member approval
 * (ClientWorkflowConfig, any roles in any order, e.g. QC → BM → AM), then Admin
 * final review. With no active config the legacy BM → AM → QC chain applies
 * (see app/lib/renewal-workflow.ts). Operates on `Loan.renewalApprovalStatus`.
 *
 * Body:
 *   action:  stage actions — "LEVEL_APPROVE" | "LEVEL_RETAKE" | "LEVEL_REJECT"
 *              (legacy BM_ / AM_ / QC_VERIFY_ names are accepted as aliases; the
 *               acting stage is always resolved from the loan's current status)
 *            "FINAL_APPROVE" | "FINAL_RETAKE" | "FINAL_REJECT"  (Admin / Sub Admin)
 *            "FDO_RESUBMIT"  — from any retake status; restarts at the FIRST
 *                              configured stage (final retake → back to final)
 *   remarks?:            string  (mandatory for RETAKE / REJECT)
 *   retakeDocumentIds?:  string[]  (optional; RETAKE actions — flag a subset,
 *                                   otherwise every renewal doc is flagged)
 */
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ loanId: string }> }
) {
    const { loanId } = await params;

    return withAuth(async (req, user) => {
        try {
            const body = await req.json();
            const { action, remarks } = body as { action: string; remarks?: string };
            const retakeDocumentIds: string[] = Array.isArray(body?.retakeDocumentIds) ? body.retakeDocumentIds : [];

            const stageApprove = ['BM_SUBMIT_TO_AM', 'AM_APPROVE', 'QC_VERIFY_APPROVE', 'LEVEL_APPROVE'];
            const stageRetake = ['BM_RETAKE', 'AM_RETAKE', 'QC_VERIFY_RETAKE', 'LEVEL_RETAKE'];
            const stageReject = ['BM_REJECT', 'AM_REJECT', 'QC_VERIFY_REJECT', 'LEVEL_REJECT'];
            const finalActions = ['FINAL_APPROVE', 'FINAL_RETAKE', 'FINAL_REJECT'];
            const validActions = [...stageApprove, ...stageRetake, ...stageReject, ...finalActions, 'FDO_RESUBMIT'];
            if (!validActions.includes(action)) {
                return errorResponse(`Invalid action. Must be one of: ${validActions.join(', ')}`, 400);
            }
            if ((action.includes('RETAKE') || action.includes('REJECT')) && (!remarks || !remarks.trim())) {
                return errorResponse('Remarks are required for retake or reject actions', 400);
            }

            const loan = await prisma.loan.findUnique({
                where: { id: loanId },
                select: {
                    id: true,
                    loanNumber: true,
                    isRenewalApplication: true,
                    renewalApprovalStatus: true,
                    renewalProposedData: true,
                    branchId: true,
                    centerId: true,
                    createdById: true,
                    renewalKycDocuments: {
                        where: { isDeleted: false },
                        select: { id: true, ...KYC_STAGE_DECISION_SELECT },
                    },
                },
            });
            if (!loan) return errorResponse('Renewal loan not found', 404);
            if (!loan.isRenewalApplication || !loan.renewalApprovalStatus) {
                return errorResponse('This loan is not a renewal loan application', 400);
            }

            const isSubAdmin = user.role !== 'ADMIN' && await isSubAdminUser(user.userId);
            const { stages, isDynamic } = await getRenewalStages();
            const current = loan.renewalApprovalStatus;

            // ── New co-applicant gate ────────────────────────────────────────────
            // A spouse/co-applicant added during this renewal (renewalProposedData.
            // coApplicantMode === 'new') rides its own BM -> AM -> QC -> Admin
            // Co-Applicant Approval queue (/api/co-applicants/[id]/action). A stage
            // can't forward this renewal past a co-applicant its own role hasn't
            // approved yet (see getCoApplicantRequiredRank).
            const proposed = (loan.renewalProposedData ?? {}) as {
                coApplicantMode?: 'existing' | 'new';
                coApplicantId?: string | null;
            };
            const newCoApplicant = proposed.coApplicantMode === 'new' && proposed.coApplicantId
                ? await prisma.coApplicant.findUnique({
                    where: { id: proposed.coApplicantId },
                    select: { id: true, name: true, status: true, currentStage: true },
                })
                : null;
            const CO_APPLICANT_STAGE_RANK: Record<string, number> = { BM: 0, AM: 1, QC: 2, ADMIN: 3 };
            const coApplicantRank = (): number => {
                if (!newCoApplicant) return Infinity; // nothing to gate (existing co-applicant or none)
                if (newCoApplicant.status === 'APPROVED') return 4;
                if (newCoApplicant.currentStage && newCoApplicant.currentStage in CO_APPLICANT_STAGE_RANK) {
                    return CO_APPLICANT_STAGE_RANK[newCoApplicant.currentStage];
                }
                return -1; // REJECTED / INACTIVE / anything else — never satisfies a gate
            };
            const assertCoApplicantReviewed = (requiredRank: number): string | null => {
                if (!newCoApplicant) return null;
                if (newCoApplicant.status === 'REJECTED') {
                    return `The new co-applicant "${newCoApplicant.name}" was rejected during approval — this renewal application cannot proceed until it's resolved.`;
                }
                if (coApplicantRank() < requiredRank) {
                    return `Approve the new co-applicant "${newCoApplicant.name}" in the Co-Applicant Approval queue before forwarding this renewal loan from this stage.`;
                }
                return null;
            };

            let newStatus: ClientApprovalStatus;
            let auditAction: string;
            let actingStage: WorkflowStage | null = null;
            let resetAllDecisions = false;
            const now = new Date();

            if (action === 'FDO_RESUBMIT') {
                const isOwnFdo = user.role === 'FDO' && loan.createdById === user.userId;
                if (!isOwnFdo && user.role !== 'ADMIN' && !isSubAdmin) {
                    return errorResponse(
                        user.role === 'FDO' ? 'You can only resubmit your own renewal applications' : 'Insufficient permissions',
                        403
                    );
                }
                if (current === 'FINAL_RETAKE_REQUIRED') {
                    newStatus = 'PENDING_FINAL_REVIEW';
                } else if (RENEWAL_RETAKE_STATUSES.includes(current)) {
                    // A retake at ANY stage restarts the whole chain at the first
                    // configured stage, and every stage re-reviews every image.
                    newStatus = getFirstRenewalStatus(stages);
                    resetAllDecisions = true;
                } else {
                    return errorResponse(`Cannot resubmit from status: ${current}. Only retake-required applications can be resubmitted.`, 400);
                }
                auditAction = 'FDO_RESUBMITTED_RENEWAL';
            } else if (finalActions.includes(action)) {
                if (user.role !== 'ADMIN' && !isSubAdmin) {
                    return errorResponse('Only Admin can perform final approval actions', 403);
                }
                // A final retake flags no individual image, so the renewal never shows
                // in the FDO Recheck tab — Admin may still approve/reject it from
                // FINAL_RETAKE_REQUIRED (a second retake is pointless there).
                const finalOverride = current === 'FINAL_RETAKE_REQUIRED' && action !== 'FINAL_RETAKE';
                if (current !== 'PENDING_FINAL_REVIEW' && !finalOverride) {
                    return errorResponse(`Final review actions are only allowed at Pending Final Review (current status: ${current}).`, 400);
                }
                if (action === 'FINAL_APPROVE') {
                    const coErr = assertCoApplicantReviewed(4);
                    if (coErr) return errorResponse(coErr, 400);
                    newStatus = 'APPROVED';
                    auditAction = 'FINAL_APPROVED_LOAN';
                } else if (action === 'FINAL_RETAKE') {
                    newStatus = 'FINAL_RETAKE_REQUIRED';
                    auditAction = 'RENEWAL_RETAKE_REQUESTED';
                } else {
                    newStatus = 'REJECTED';
                    auditAction = 'RENEWAL_REJECTED';
                }
            } else {
                // Stage action — the stage is whatever the loan is waiting on, and the
                // user must hold that stage's role (any role, any level). Admin may
                // act for a stage only on the legacy chain (no workflow configured).
                const stage = resolveRenewalStage(current, stages);
                if (!stage) {
                    return errorResponse(`This renewal loan is not at an approval stage (status: ${current})`, 400);
                }
                const slugs = await getUserWorkflowRoleSlugs(user);
                const legacyAdminOverride = !isDynamic && user.role === 'ADMIN';
                if (!userHoldsStage(stage, slugs) && !legacyAdminOverride) {
                    return errorResponse(`This renewal loan is waiting for "${stage.stageName}" — your role cannot act at this stage`, 403);
                }
                if (!(await canAccessClientBranch(user, loan.branchId))) {
                    return errorResponse('Loan does not belong to your branch', 403);
                }
                actingStage = stage;

                if (stageApprove.includes(action)) {
                    // Every renewal image must be individually VERIFIED by this stage
                    // (renewal-kyc-documents/[id]/review) before it can be forwarded.
                    const decisions = loan.renewalKycDocuments.map((d) => getStageDecision(d, stage.roleSlug).decision);
                    const pendingRetake = decisions.filter((d) => d === 'RETAKE_REQUIRED').length;
                    if (pendingRetake > 0) {
                        return errorResponse(`${pendingRetake} document(s) still flagged for retake. Resolve them before forwarding.`, 400);
                    }
                    const notReviewed = decisions.filter((d) => d !== 'VERIFIED').length;
                    if (notReviewed > 0) {
                        return errorResponse(`${notReviewed} document(s) still awaiting review. Approve each uploaded image before forwarding.`, 400);
                    }
                    const coErr = assertCoApplicantReviewed(getCoApplicantRequiredRank(stage.roleSlug));
                    if (coErr) return errorResponse(coErr, 400);
                    newStatus = getNextRenewalStatus(stage, stages);
                    const prefix = getBuiltinColumns(stage.roleSlug)?.auditPrefix;
                    auditAction = (prefix && APPROVE_AUDIT_ACTION[prefix]) || 'LEVEL_APPROVED';
                } else if (stageRetake.includes(action)) {
                    newStatus = getRetakeStatusForStage(stage);
                    auditAction = 'RENEWAL_RETAKE_REQUESTED';
                } else {
                    newStatus = 'REJECTED';
                    auditAction = 'RENEWAL_REJECTED';
                }
            }

            const isRetake = action.includes('RETAKE');
            const stageInfo = actingStage
                ? { levelOrder: actingStage.levelOrder, roleSlug: actingStage.roleSlug, stageName: actingStage.stageName }
                : undefined;

            await prisma.$transaction(async (tx) => {
                await tx.loan.update({
                    where: { id: loan.id },
                    data: { renewalApprovalStatus: newStatus },
                });

                if (isRetake && actingStage) {
                    const stage = actingStage;
                    // Images this reviewer already flagged one by one (renewal-kyc-documents/
                    // [id]/review) are exactly the ones they want redone — leave just those,
                    // with their own per-image remarks. Only a retake with nothing flagged
                    // (and no explicit ids) sends the whole batch back.
                    const alreadyFlagged = loan.renewalKycDocuments.some(
                        (d) => getStageDecision(d, stage.roleSlug).decision === 'RETAKE_REQUIRED'
                    );
                    if (retakeDocumentIds.length > 0 || !alreadyFlagged) {
                        const targets = retakeDocumentIds.length > 0
                            ? loan.renewalKycDocuments.filter((d) => retakeDocumentIds.includes(d.id))
                            : loan.renewalKycDocuments;
                        for (const d of targets) {
                            await writeStageDecision(tx, {
                                kycId: d.id,
                                roleSlug: stage.roleSlug,
                                decision: 'RETAKE_REQUIRED' as KYCDocumentDecision,
                                remark: remarks || null,
                                reviewerId: user.userId,
                                reviewedAt: now,
                                kycExtra: { retakeReason: remarks || null },
                            });
                        }
                    }
                }
                if (resetAllDecisions) {
                    // Full restart — every stage (built-in columns and custom-role rows)
                    // re-reviews every renewal image.
                    await tx.kYC.updateMany({
                        where: { loanId: loan.id, isDeleted: false },
                        data: {
                            bmDecision: 'PENDING' as KYCDocumentDecision,
                            amDecision: 'PENDING' as KYCDocumentDecision,
                            qcDecision: 'PENDING' as KYCDocumentDecision,
                            retakeReason: null,
                        },
                    });
                    await tx.kycStageReview.deleteMany({
                        where: { kyc: { loanId: loan.id, isDeleted: false } },
                    });
                }

                await tx.loanApprovalHistory.create({
                    data: {
                        loanId: loan.id,
                        action: auditAction,
                        performedById: user.userId,
                        remarks: remarks || null,
                        previousState: JSON.stringify({ renewalApprovalStatus: current }),
                        newState: JSON.stringify({ renewalApprovalStatus: newStatus, ...(stageInfo ? { stage: stageInfo } : {}) }),
                    },
                });

                if (action === 'FINAL_APPROVE') {
                    await renewalLoanService.finalizeRenewalApproval(tx, loan.id, user.userId);
                }
            }, { maxWait: 10000, timeout: 20000 });

            // Post-commit: move renewal KYC files kyc/ -> verified/ (network I/O
            // must not sit inside the DB transaction). Best-effort.
            if (action === 'FINAL_APPROVE') {
                await renewalLoanService.moveRenewalKycToVerified(loan.id);
            }

            return successResponse(
                { loanId: loan.id, loanNumber: loan.loanNumber, action, previousStatus: current, newStatus },
                `Renewal loan ${action.toLowerCase().replace(/_/g, ' ')} completed successfully`
            );
        } catch (error) {
            console.error('Error executing renewal approval action:', error);
            return errorResponse(
                error instanceof Error ? error.message : 'Failed to execute renewal approval action',
                500
            );
        }
    })(request);
}
