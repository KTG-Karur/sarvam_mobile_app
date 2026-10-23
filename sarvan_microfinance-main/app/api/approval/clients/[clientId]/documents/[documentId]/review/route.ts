import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
} from '@/app/lib/api-utils';
import { KYCDocumentDecision } from '@prisma/client';
import type { JWTPayload } from '@/app/lib/auth';
import {
    getActiveWorkflowConfig,
    getRetakeStatusForStage,
    type WorkflowStage,
} from '@/app/lib/workflow-config';
import {
    canAccessClientBranch,
    getClientApprovalBranchId,
    resolveActingStage,
} from '@/app/lib/client-approval-access';
import {
    KYC_STAGE_DECISION_SELECT,
    getClientReviewerFields,
    getDocumentAuditAction,
    getStageDecision,
    writeStageDecision,
} from '@/app/lib/kyc-stage-decisions';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * POST /api/approval/clients/[clientId]/documents/[documentId]/review
 * BM, AM, or QC records a per-document review decision.
 *
 * Body:
 *   decision:  "VERIFIED" | "RETAKE_REQUIRED" | "DELETED" | "REJECTED"
 *   remark?:   string — mandatory when decision ≠ VERIFIED
 *
 * Dynamic workflow (ClientWorkflowConfig active) — ANY role at ANY level:
 *   - The user must hold the role of the stage the client is currently at
 *   - The decision is stored in that stage role's slot (see kyc-stage-decisions.ts)
 *   - RETAKE_REQUIRED moves the client to that stage's retake status
 *
 * Legacy rules (no workflow configured):
 *   - BM  writes bmDecision / bmRemark / bmReviewerId / bmReviewedAt
 *   - AM  writes amDecision / amRemark / amReviewerId / amReviewedAt  (BM must have reviewed first)
 *   - QC  writes qcDecision / qcRemark / qcReviewerId / qcReviewedAt  (AM must have reviewed first)
 *   - Soft-delete on DELETED: sets isDeleted + metadata instead of hard delete
 *   - Logs an entry in ClientApprovalHistory
 *
 * @access Dynamic: holder of the client's current stage role (any role).
 *         Legacy: BRANCH_MANAGER, AREA_MANAGER, ADMIN, QC, FDO (quality-checkers RBAC only)
 */
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ clientId: string; documentId: string }> }
) {
    const { clientId, documentId } = await params;

    return withAuth(async (req, user) => {
        try {
            const body = await req.json();
            const { decision, remark } = body as { decision: string; remark?: string };

            // Validate decision
            const validDecisions: KYCDocumentDecision[] = ['VERIFIED', 'RETAKE_REQUIRED', 'DELETED', 'REJECTED'];
            if (!validDecisions.includes(decision as KYCDocumentDecision)) {
                return errorResponse(
                    `Invalid decision. Must be one of: ${validDecisions.join(', ')}`,
                    400
                );
            }

            // Remark mandatory for non-verified decisions
            if (decision !== 'VERIFIED' && (!remark || remark.trim().length === 0)) {
                return errorResponse('Remark is required for retake, delete, or reject decisions', 400);
            }

            // ── Dynamic workflow: stage order and roles come from config ──
            const wfConfig = await getActiveWorkflowConfig();
            if (wfConfig) {
                return reviewDynamic(user, clientId, documentId, decision as KYCDocumentDecision, remark?.trim() || null, wfConfig.stages);
            }

            // ── Legacy fixed BM → AM → QC ──
            if (!['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN', 'FDO', 'QC'].includes(user.role)) {
                return errorResponse('Insufficient permissions', 403);
            }

            // ── Resolve actor type ──
            // QC role is always Quality Checkers. FDO needs the RBAC assignment.
            const isQCTeam = user.role === 'QC' || !!(await prisma.userRoleAssignment.findFirst({
                where: {
                    userId: user.userId,
                    isActive: true,
                    role: { slug: 'quality-checkers', isActive: true },
                },
            }));

            // FDO can only act as Quality Checkers
            if (user.role === 'FDO' && !isQCTeam) {
                return errorResponse('FDO can only review documents as Quality Checkers', 403);
            }

            // findFirst, not findUnique — Client.clientId isn't DB-unique (uploan-imported
            // legacy IDs can intentionally collide, see schema.prisma) — deterministic
            // oldest-created tiebreak.
            const client = await prisma.client.findFirst({
                where: { clientId },
                orderBy: { createdAt: 'asc' },
                select: {
                    id: true,
                    approvalStatus: true,
                    centerId: true,
                    center: { select: { branchId: true } },
                    enrolledBy: { select: { branchId: true } },
                },
            });
            if (!client) return errorResponse('Client not found', 404);

            // Branch access check for BM
            if (user.role === 'BRANCH_MANAGER') {
                const u = await prisma.user.findUnique({ where: { id: user.userId }, select: { branchId: true } });
                const clientBranchId = client.center?.branchId ?? client.enrolledBy?.branchId ?? null;
                if (!u?.branchId || clientBranchId !== u.branchId) {
                    return errorResponse('Client does not belong to your branch', 403);
                }
            }

            // Fetch the KYC document
            const doc = await prisma.kYC.findFirst({
                where: { id: documentId, clientId: client.id, isDeleted: false },
            });
            if (!doc) return errorResponse('KYC document not found', 404);

            // ── Determine reviewer role ──
            const isBM = (user.role === 'BRANCH_MANAGER' || user.role === 'ADMIN') && !isQCTeam;
            const isAM = (user.role === 'AREA_MANAGER') && !isQCTeam;
            const now = new Date();

            // AM gate: BM must have reviewed first
            if (isAM && doc.bmDecision === 'PENDING') {
                return errorResponse('BM must review this document before AM can act on it', 400);
            }

            // QC gate: AM must have reviewed first
            if (isQCTeam && doc.amDecision === 'PENDING') {
                return errorResponse('AM must review this document before QC verification', 400);
            }

            // ── Client-level cascade on RETAKE_REQUIRED ──
            // A single image being sent for recheck must immediately move the whole
            // client into that stage's retake status — otherwise the client sits in
            // limbo (still "PENDING_X_REVIEW") with no way for FDO to act on it.
            // This mirrors the stage-level "Request Retake" action (BM_RETAKE /
            // AM_RETAKE / QC_VERIFY_RETAKE) so the recheck cycle is:
            //   FDO -> BM -> AM -> (AM flags an image) -> FDO -> BM -> AM -> QC -> Admin
            let clientStatusUpdate: Record<string, unknown> | null = null;
            if (decision === 'RETAKE_REQUIRED') {
                if (isBM && ['SUBMITTED', 'PENDING_BM_REVIEW'].includes(client.approvalStatus)) {
                    clientStatusUpdate = {
                        approvalStatus: 'BM_RETAKE_REQUIRED',
                        verificationStatus: 'PENDING_VERIFICATION',
                        bmReviewedById: user.userId,
                        bmReviewedAt: now,
                        bmRemarks: remark,
                    };
                } else if (isAM && client.approvalStatus === 'PENDING_AM_REVIEW') {
                    clientStatusUpdate = {
                        approvalStatus: 'AM_RETAKE_REQUIRED',
                        verificationStatus: 'PENDING_VERIFICATION',
                        amReviewedById: user.userId,
                        amReviewedAt: now,
                        amRemarks: remark,
                    };
                } else if (isQCTeam && client.approvalStatus === 'PENDING_QC_VERIFICATION') {
                    clientStatusUpdate = {
                        approvalStatus: 'QC_VERIFICATION_RETAKE_REQUIRED',
                        verificationStatus: 'PENDING_VERIFICATION',
                        qcVerifiedById: user.userId,
                        qcVerifiedAt: now,
                        qcRemarks: remark,
                    };
                }
            }

            // ── Build KYC update ──
            const kycUpdate: Record<string, unknown> = {};
            let auditAction: string;

            if (isQCTeam) {
                // ── QC Verification ──
                kycUpdate.qcDecision = decision as KYCDocumentDecision;
                kycUpdate.qcRemark = remark || null;
                kycUpdate.qcReviewerId = user.userId;
                kycUpdate.qcReviewedAt = now;

                if (decision === 'DELETED') {
                    kycUpdate.isDeleted = true;
                    kycUpdate.deletedAt = now;
                    kycUpdate.deletedById = user.userId;
                    kycUpdate.deleteReason = remark;
                    auditAction = 'QC_DELETED_DOCUMENT';
                } else if (decision === 'RETAKE_REQUIRED') {
                    kycUpdate.retakeReason = remark;
                    auditAction = 'QC_RETAKE_DOCUMENT';
                } else if (decision === 'REJECTED') {
                    auditAction = 'QC_REJECTED_DOCUMENT';
                } else {
                    auditAction = 'QC_VERIFIED_DOCUMENT';
                }

            } else if (isBM) {
                // ── BM Review ──
                kycUpdate.bmDecision = decision as KYCDocumentDecision;
                kycUpdate.bmRemark = remark || null;
                kycUpdate.bmReviewerId = user.userId;
                kycUpdate.bmReviewedAt = now;

                if (decision === 'DELETED') {
                    kycUpdate.isDeleted = true;
                    kycUpdate.deletedAt = now;
                    kycUpdate.deletedById = user.userId;
                    kycUpdate.deleteReason = remark;
                    auditAction = 'BM_DELETED_DOCUMENT';
                } else if (decision === 'RETAKE_REQUIRED') {
                    kycUpdate.retakeReason = remark;
                    auditAction = 'BM_RETAKE_DOCUMENT';
                } else if (decision === 'REJECTED') {
                    auditAction = 'BM_REJECTED_DOCUMENT';
                } else {
                    auditAction = 'BM_VERIFIED_DOCUMENT';
                }

            } else {
                // ── AM Review ──
                kycUpdate.amDecision = decision as KYCDocumentDecision;
                kycUpdate.amRemark = remark || null;
                kycUpdate.amReviewerId = user.userId;
                kycUpdate.amReviewedAt = now;

                if (decision === 'DELETED') {
                    kycUpdate.isDeleted = true;
                    kycUpdate.deletedAt = now;
                    kycUpdate.deletedById = user.userId;
                    kycUpdate.deleteReason = remark;
                    auditAction = 'AM_DELETED_DOCUMENT';
                } else if (decision === 'RETAKE_REQUIRED') {
                    kycUpdate.retakeReason = remark;
                    auditAction = 'AM_RETAKE_DOCUMENT';
                } else if (decision === 'REJECTED') {
                    auditAction = 'AM_REJECTED_DOCUMENT';
                } else {
                    auditAction = 'AM_VERIFIED_DOCUMENT';
                }
            }

            // Sync legacy status field
            if (decision === 'VERIFIED') {
                kycUpdate.status = 'VERIFIED';
            } else if (decision === 'REJECTED') {
                kycUpdate.status = 'REJECTED';
                kycUpdate.rejectionReason = remark;
            } else {
                kycUpdate.status = 'PENDING_VERIFICATION';
            }

            // Execute in a transaction
            const txnOps: any[] = [
                prisma.kYC.update({
                    where: { id: documentId },
                    data: kycUpdate,
                    select: {
                        id: true,
                        documentType: true,
                        bmDecision: true,
                        bmRemark: true,
                        bmReviewedAt: true,
                        amDecision: true,
                        amRemark: true,
                        amReviewedAt: true,
                        isDeleted: true,
                        status: true,
                    },
                }),
                prisma.clientApprovalHistory.create({
                    data: {
                        clientId: client.id,
                        action: auditAction as never,
                        performedById: user.userId,
                        remarks: remark || `Document ${decision.toLowerCase().replace('_', ' ')}`,
                        kycDocumentId: documentId,
                        previousState: JSON.stringify({
                            bmDecision: doc.bmDecision,
                            amDecision: doc.amDecision,
                        }),
                        newState: JSON.stringify({
                            bmDecision: kycUpdate.bmDecision ?? doc.bmDecision,
                            amDecision: kycUpdate.amDecision ?? doc.amDecision,
                        }),
                    },
                }),
            ];

            if (clientStatusUpdate) {
                txnOps.push(
                    prisma.client.update({
                        where: { id: client.id },
                        data: clientStatusUpdate,
                    })
                );
            }

            const [updatedDoc] = await prisma.$transaction(txnOps);

            return successResponse(
                { document: updatedDoc },
                `Document ${decision.toLowerCase().replace('_', ' ')} successfully`
            );
        } catch (error) {
            console.error('Error reviewing document:', error);
            return errorResponse(
                error instanceof Error ? error.message : 'Failed to review document',
                500
            );
        }
    })(request);
}

/**
 * Dynamic-workflow document review — works for any role configured at any
 * level. The acting stage is derived from the client's status; the user must
 * hold that stage's role.
 */
async function reviewDynamic(
    user: JWTPayload,
    clientId: string,
    documentId: string,
    decision: KYCDocumentDecision,
    remark: string | null,
    stages: WorkflowStage[]
) {
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

    if (!(await canAccessClientBranch(user, getClientApprovalBranchId(client)))) {
        return errorResponse('Client does not belong to your branch', 403);
    }

    const acting = await resolveActingStage(user, client.approvalStatus, stages);
    if (!acting.ok) return errorResponse(acting.error, acting.status);
    const { stage } = acting;

    const doc = await prisma.kYC.findFirst({
        where: { id: documentId, clientId: client.id, isDeleted: false, loanId: null },
        select: { id: true, ...KYC_STAGE_DECISION_SELECT },
    });
    if (!doc) return errorResponse('KYC document not found', 404);

    const now = new Date();
    const previousDecision = getStageDecision(doc, stage.roleSlug).decision;

    // Extra KYC columns — legacy status sync, soft delete, retake reason.
    const kycExtra: Record<string, unknown> = {
        status: decision === 'VERIFIED' ? 'VERIFIED' : decision === 'REJECTED' ? 'REJECTED' : 'PENDING_VERIFICATION',
    };
    if (decision === 'REJECTED') kycExtra.rejectionReason = remark;
    if (decision === 'RETAKE_REQUIRED') kycExtra.retakeReason = remark;
    if (decision === 'DELETED') {
        kycExtra.isDeleted = true;
        kycExtra.deletedAt = now;
        kycExtra.deletedById = user.userId;
        kycExtra.deleteReason = remark;
    }

    // A single image flagged for retake moves the whole client into this stage's
    // retake status so FDO can act on it (same as the stage-level LEVEL_RETAKE).
    const clientStatusUpdate = decision === 'RETAKE_REQUIRED'
        ? {
            approvalStatus: getRetakeStatusForStage(stage),
            verificationStatus: 'PENDING_VERIFICATION' as const,
            ...getClientReviewerFields(stage.roleSlug, user.userId, now, remark),
        }
        : null;

    const stageInfo = { levelOrder: stage.levelOrder, roleSlug: stage.roleSlug, stageName: stage.stageName };

    await prisma.$transaction(async (tx) => {
        await writeStageDecision(tx, {
            kycId: doc.id,
            roleSlug: stage.roleSlug,
            decision,
            remark,
            reviewerId: user.userId,
            reviewedAt: now,
            kycExtra,
        });
        await tx.clientApprovalHistory.create({
            data: {
                clientId: client.id,
                action: getDocumentAuditAction(stage.roleSlug, decision) as never,
                performedById: user.userId,
                remarks: remark || `Document ${decision.toLowerCase().replace('_', ' ')}`,
                kycDocumentId: doc.id,
                previousState: JSON.stringify({ stage: stageInfo, decision: previousDecision }),
                newState: JSON.stringify({ stage: stageInfo, decision }),
            },
        });
        if (clientStatusUpdate) {
            await tx.client.update({ where: { id: client.id }, data: clientStatusUpdate });
        }
    });

    return successResponse(
        { document: { id: doc.id, roleSlug: stage.roleSlug, decision } },
        `Document ${decision.toLowerCase().replace('_', ' ')} successfully`
    );
}
