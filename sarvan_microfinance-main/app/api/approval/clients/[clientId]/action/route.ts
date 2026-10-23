import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
} from '@/app/lib/api-utils';
import { ClientApprovalStatus, KYCDocumentDecision } from '@prisma/client';
import { moveKycDocumentToVerified, extractFileKeyFromUrl } from '@/app/lib/storage/kyc-storage';
import {
    getActiveWorkflowConfig,
    getPendingStatusForStage,
    getRetakeStatusForStage,
    getAllStageRetakeStatuses,
    ALL_LEVEL_RETAKE_STATUSES,
} from '@/app/lib/workflow-config';
import {
    canAccessClientBranch,
    getClientApprovalBranchId,
    resolveActingStage,
} from '@/app/lib/client-approval-access';
import { isWithinOrgScope } from '@/app/lib/permissions/org-scope';
import {
    KYC_STAGE_DECISION_SELECT,
    getClientReviewerFields,
    getStageDecision,
    buildResetAllStageDecisionsOps,
} from '@/app/lib/kyc-stage-decisions';
import { isSubAdminUser } from '@/app/lib/permissions/sub-admin';
import { createFirstLoanIfEligible } from '@/app/lib/services/first-loan.service';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * POST /api/approval/clients/[clientId]/action
 * Execute a stage-level action on a client's approval workflow.
 *
 * Body:
 *   action:  "BM_SUBMIT_TO_AM" | "BM_RETAKE" | "BM_REJECT" |
 *            "AM_APPROVE" | "AM_RETAKE" | "AM_REJECT" |
 *            "QC_VERIFY_APPROVE" | "QC_VERIFY_REJECT" | "QC_VERIFY_RETAKE" |
 *            "FINAL_APPROVE" | "FINAL_RETAKE" | "FINAL_REJECT" |
 *            "FDO_RESUBMIT"
 *   remarks?: string — mandatory for RETAKE / REJECT actions
 *
 * Transitions:
 *   BM_SUBMIT_TO_AM    → SUBMITTED/PENDING_BM_REVIEW → PENDING_AM_REVIEW
 *   BM_RETAKE          → SUBMITTED/PENDING_BM_REVIEW → BM_RETAKE_REQUIRED
 *   BM_REJECT          → SUBMITTED/PENDING_BM_REVIEW → REJECTED
 *   AM_APPROVE         → PENDING_AM_REVIEW → PENDING_QC_VERIFICATION
 *   AM_RETAKE          → PENDING_AM_REVIEW → AM_RETAKE_REQUIRED
 *   AM_REJECT          → PENDING_AM_REVIEW → REJECTED
 *   QC_VERIFY_APPROVE  → PENDING_QC_VERIFICATION → PENDING_FINAL_REVIEW  (QC team only)
 *   QC_VERIFY_REJECT   → PENDING_QC_VERIFICATION → REJECTED               (QC team only)
 *   QC_VERIFY_RETAKE   → PENDING_QC_VERIFICATION → QC_VERIFICATION_RETAKE_REQUIRED (QC team only)
 *   FINAL_APPROVE      → PENDING_FINAL_REVIEW → APPROVED  (Admin or Sub Admin only; QC verification required first)
 *   FINAL_RETAKE       → PENDING_FINAL_REVIEW → FINAL_RETAKE_REQUIRED  (Admin or Sub Admin only)
 *   FINAL_REJECT       → PENDING_FINAL_REVIEW → REJECTED  (Admin or Sub Admin only)
 *   FDO_RESUBMIT       → BM_RETAKE_REQUIRED            → SUBMITTED (BM re-reviews)
 *                     → AM_RETAKE_REQUIRED            → SUBMITTED (full restart: BM re-reviews, then AM again)
 *                     → QC_VERIFICATION_RETAKE_REQUIRED → PENDING_QC_VERIFICATION (skip BM+AM)
 *                     → FINAL_RETAKE_REQUIRED          → PENDING_FINAL_REVIEW (skip all previous)
 *
 * Recheck cycle: FDO -> BM -> AM -> (any image flagged by BM/AM) -> FDO -> BM -> AM -> QC -> Admin
 *
 * Dynamic workflow (ClientWorkflowConfig active): only LEVEL_* / FINAL_* / FDO_RESUBMIT.
 *   LEVEL_APPROVE / LEVEL_RETAKE / LEVEL_REJECT — by the holder of the client's
 *   current stage role (ANY role, built-in or admin-created, at any level).
 *   FDO_RESUBMIT from any stage's retake status restarts at Level 1 and every
 *   stage re-reviews every document; from FINAL_RETAKE_REQUIRED it returns to final.
 *
 * @access BRANCH_MANAGER, AREA_MANAGER, ADMIN, FDO (FDO_RESUBMIT only), background-verification-team (QC_ actions),
 *         Sub Admin roles (FINAL_ actions — see Role.isSubAdmin — plus LEVEL_ actions at a
 *         workflow stage their role is configured for)
 */
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ clientId: string }> }
) {
    const { clientId } = await params;

    return withAuth(async (req, user) => {
        try {
            const body = await req.json();
            const { action, remarks } = body as { action: string; remarks?: string };

            const validActions = [
                'BM_SUBMIT_TO_AM', 'BM_RETAKE', 'BM_REJECT',
                'AM_APPROVE', 'AM_RETAKE', 'AM_REJECT',
                'QC_VERIFY_APPROVE', 'QC_VERIFY_REJECT', 'QC_VERIFY_RETAKE',
                'FINAL_APPROVE', 'FINAL_RETAKE', 'FINAL_REJECT',
                'FDO_RESUBMIT',
                // Dynamic workflow actions (used when ClientWorkflowConfig is active)
                'LEVEL_APPROVE', 'LEVEL_RETAKE', 'LEVEL_REJECT',
            ];
            if (!validActions.includes(action)) {
                return errorResponse(`Invalid action. Must be one of: ${validActions.join(', ')}`, 400);
            }

            // QC role is always Quality Checkers. FDO needs the RBAC assignment.
            const isQCTeam = user.role === 'QC' || !!(await prisma.userRoleAssignment.findFirst({
                where: {
                    userId: user.userId,
                    isActive: true,
                    role: { slug: 'quality-checkers', isActive: true },
                },
            }));

            // Sub Admin: a custom role explicitly flagged Role.isSubAdmin === true.
            // Grants FINAL_ actions only — nothing else Admin-only.
            const isSubAdmin = user.role !== 'ADMIN' && await isSubAdminUser(user.userId);

            // Base access gate (mirrors the previous withRole([...]) allowlist),
            // extended to let Sub Admin roles reach the handler for FINAL_ actions.
            // LEVEL_ actions are authorized by holding the current stage's role
            // (resolveActingStage below) — any role, including admin-created ones
            // whose user.role is a custom code not listed here.
            const isLevelAction = action.startsWith('LEVEL_');
            const baseAllowedRoles = ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN', 'FDO', 'QC'];
            if (!isLevelAction && !baseAllowedRoles.includes(user.role) && !isQCTeam && !isSubAdmin) {
                return errorResponse('Insufficient permissions', 403);
            }

            // Sub Admin can only perform final approval actions
            // (LEVEL_ actions are still checked below: the user must hold the stage's role.)
            if (isSubAdmin && !action.startsWith('FINAL_') && !isLevelAction) {
                return errorResponse('Sub Admin can only perform final approval actions', 403);
            }

            // QC actions are exclusively for the Quality Checkers role
            if (action.startsWith('QC_') && !isQCTeam) {
                return errorResponse('Only Quality Checkers can perform QC verification actions', 403);
            }

            // FDO can only resubmit (unless they are Quality Checkers)
            if (user.role === 'FDO' && !isQCTeam && action !== 'FDO_RESUBMIT' && !isLevelAction) {
                return errorResponse('FDO can only perform FDO_RESUBMIT action', 403);
            }

            // QC role can only perform QC_ actions (or LEVEL_ actions in dynamic workflow)
            if (user.role === 'QC' && !action.startsWith('QC_') && !action.startsWith('LEVEL_')) {
                return errorResponse('QC role can only perform QC verification actions', 403);
            }

            // BM can only do BM actions (or LEVEL_ actions in dynamic workflow)
            if (user.role === 'BRANCH_MANAGER' && !action.startsWith('BM_') && !action.startsWith('LEVEL_')) {
                return errorResponse('Branch Manager can only perform BM actions', 403);
            }

            // AM can only do AM actions (or LEVEL_ actions in dynamic workflow)
            if (user.role === 'AREA_MANAGER' && !action.startsWith('AM_') && !action.startsWith('LEVEL_')) {
                return errorResponse('Area Manager can only perform AM actions', 403);
            }

            // Only ADMIN or a Sub Admin role can perform final approval actions
            if (action.startsWith('FINAL_') && user.role !== 'ADMIN' && !isSubAdmin) {
                return errorResponse('Only Admin can perform final approval actions', 403);
            }

            // Admin's legacy BM_/AM_/QC_ override (a fallback from before the dynamic
            // workflow existed) must not let them jump the queue once a
            // ClientWorkflowConfig is active — those stages are explicitly assigned
            // to other roles, and Admin taking them silently forwards to the next
            // stage instead of finalizing, which looks like a broken approval to an
            // Admin who expects their action to be final. Admin should use LEVEL_
            // actions (only if genuinely assigned a stage via RBAC) or wait for
            // FINAL_APPROVE at PENDING_FINAL_REVIEW.
            //
            // Same for BM/AM/QC themselves: the legacy actions hard-code the
            // BM → AM → QC order (e.g. BM_SUBMIT_TO_AM from SUBMITTED), which would
            // let a role skip a stage the config placed before it (QC → BM → AM).
            if (action.startsWith('BM_') || action.startsWith('AM_') || action.startsWith('QC_')) {
                const wfConfig = await getActiveWorkflowConfig();
                if (wfConfig) {
                    return errorResponse(
                        user.role === 'ADMIN'
                            ? 'A dynamic approval workflow is active — Admin can only give Final Approval once BM/AM/QC review is complete.'
                            : 'A dynamic approval workflow is active — use the stage approval actions for your configured level.',
                        403
                    );
                }
            }

            // Admin / Sub Admin cannot bypass background verification
            if (action === 'FINAL_APPROVE' && (user.role === 'ADMIN' || isSubAdmin)) {
                const clientStatus = await prisma.client.findFirst({
                    where: { clientId },
                    orderBy: { createdAt: 'asc' },
                    select: { approvalStatus: true },
                });
                if (clientStatus?.approvalStatus === 'PENDING_QC_VERIFICATION' ||
                    clientStatus?.approvalStatus === 'QC_VERIFICATION_RETAKE_REQUIRED') {
                    return errorResponse(
                        'Background verification must be completed before Admin can give final approval',
                        422
                    );
                }
            }

            // Remarks required for retake/reject
            if ((action.includes('RETAKE') || action.includes('REJECT')) && (!remarks || !remarks.trim())) {
                return errorResponse('Remarks are required for retake or reject actions', 400);
            }

            // Fetch client — findFirst, not findUnique: Client.clientId isn't DB-unique
            // (uploan-imported legacy IDs can intentionally collide, see schema.prisma) —
            // deterministic oldest-created tiebreak.
            const client = await prisma.client.findFirst({
                where: { clientId },
                orderBy: { createdAt: 'asc' },
                select: {
                    id: true,
                    approvalStatus: true,
                    verificationStatus: true,
                    centerId: true,
                    locationApprovalStatus: true,
                    latitude: true,
                    longitude: true,
                    center: { select: { branchId: true, latitude: true, longitude: true } },
                    requestedCenter: { select: { branchId: true } },
                    enrolledBy: { select: { branchId: true } },
                    groupMemberships: { select: { id: true } },
                    kycDocuments: {
                        where: { isDeleted: false },
                        select: { id: true, loanId: true, ...KYC_STAGE_DECISION_SELECT },
                    },
                },
            });
            if (!client) return errorResponse('Client not found', 404);

            // Region/Division/Area/Branch org scope (e.g. Quality Checkers) —
            // applies to every action, legacy QC_* included.
            if (!(await isWithinOrgScope(user.userId, getClientApprovalBranchId(client)))) {
                return errorResponse('Client is outside your assigned Region / Division / Area', 403);
            }

            // Branch-level access
            if (user.role === 'BRANCH_MANAGER') {
                const u = await prisma.user.findUnique({ where: { id: user.userId }, select: { branchId: true } });
                const clientBranchId = client.center?.branchId ?? client.enrolledBy?.branchId ?? null;
                if (!u?.branchId || clientBranchId !== u.branchId) {
                    return errorResponse('Client does not belong to your branch', 403);
                }
            }

            // ── Determine transition ──
            const current = client.approvalStatus;
            let newStatus: ClientApprovalStatus;
            let auditAction: string;
            let legacyVerificationStatus: string | null = null;
            const now = new Date();
            // Collects extra reviewer fields set inside LEVEL_APPROVE before clientUpdate is declared
            const levelApproveFields: Record<string, any> = {};
            // The dynamic stage a LEVEL_ action was taken at — recorded in history so the
            // trail can name custom-role stages.
            let levelStageInfo: { levelOrder: number; roleSlug: string; stageName: string } | null = null;

            const bmAllowedFrom = ['SUBMITTED', 'PENDING_BM_REVIEW'] as ClientApprovalStatus[];
            const amAllowedFrom = ['PENDING_AM_REVIEW'] as ClientApprovalStatus[];
            const qcAllowedFrom = ['PENDING_QC_VERIFICATION'] as ClientApprovalStatus[];
            const finalAllowedFrom = ['PENDING_FINAL_REVIEW'] as ClientApprovalStatus[];
            const fdoAllowedFrom = [
                'BM_RETAKE_REQUIRED', 'AM_RETAKE_REQUIRED', 'QC_VERIFICATION_RETAKE_REQUIRED', 'FINAL_RETAKE_REQUIRED',
                ...ALL_LEVEL_RETAKE_STATUSES,
            ] as ClientApprovalStatus[];
            // Dynamic workflow: the stage-level decisions only cover the client's own
            // enrollment KYC (renewal re-uploads have their own review cycle).
            const enrollmentDocs = client.kycDocuments.filter(d => d.loanId === null);
            const activeWfConfig = await getActiveWorkflowConfig();
            // Set by FDO_RESUBMIT when the client restarts at Level 1 (dynamic workflow).
            let resetAllDecisions = false;

            switch (action) {
                case 'BM_SUBMIT_TO_AM': {
                    if (!bmAllowedFrom.includes(current)) {
                        return errorResponse(
                            `Cannot submit to AM from current status: ${current}. Expected: ${bmAllowedFrom.join(' or ')}`,
                            400
                        );
                    }
                    // Gate: Center must be assigned before BM can forward to AM
                    if (!client.centerId) {
                        return errorResponse(
                            'Center must be assigned to the client before forwarding to AM. Please assign a center first.',
                            400
                        );
                    }
                    // Gate: Group must be assigned before BM can forward to AM
                    if (!client.groupMemberships || client.groupMemberships.length === 0) {
                        return errorResponse(
                            'Group must be assigned to the client before forwarding to AM. Please assign a group first.',
                            400
                        );
                    }
                    // Gate: no retake-pending docs (retake must be resolved first)
                    const retakeDocs = client.kycDocuments.filter(
                        (d) => d.bmDecision === 'RETAKE_REQUIRED'
                    );
                    if (retakeDocs.length > 0) {
                        return errorResponse(
                            `${retakeDocs.length} document(s) still pending retake. Resolve before forwarding to AM.`,
                            400
                        );
                    }
                    // Gate: all documents must be explicitly reviewed/verified (no bulk single-click approval)
                    const unreviewedBmDocs = client.kycDocuments.filter(
                        (d) => d.bmDecision === 'PENDING'
                    );
                    if (unreviewedBmDocs.length > 0) {
                        return errorResponse(
                            `${unreviewedBmDocs.length} document(s) have not been verified yet. Please review and verify each document individually before forwarding to AM.`,
                            400
                        );
                    }
                    newStatus = 'PENDING_AM_REVIEW';
                    auditAction = 'BM_COMPLETED_REVIEW';
                    legacyVerificationStatus = 'UNDER_REVIEW';
                    break;
                }
                case 'BM_RETAKE': {
                    if (!bmAllowedFrom.includes(current)) {
                        return errorResponse(`Cannot request retake from current status: ${current}`, 400);
                    }
                    newStatus = 'BM_RETAKE_REQUIRED';
                    auditAction = 'BM_RETAKE_DOCUMENT';
                    legacyVerificationStatus = 'PENDING_VERIFICATION';
                    break;
                }
                case 'BM_REJECT': {
                    if (!bmAllowedFrom.includes(current)) {
                        return errorResponse(`Cannot reject from current status: ${current}`, 400);
                    }
                    newStatus = 'REJECTED';
                    auditAction = 'BM_REJECTED_CLIENT';
                    legacyVerificationStatus = 'REJECTED';
                    break;
                }
                case 'AM_APPROVE': {
                    if (!amAllowedFrom.includes(current)) {
                        return errorResponse(
                            `Cannot forward to background verification from current status: ${current}. BM review must be completed first.`,
                            400
                        );
                    }
                    // Gate: all documents must be explicitly reviewed/verified by AM
                    const unreviewedAmDocs = client.kycDocuments.filter(
                        (d) => d.amDecision === 'PENDING'
                    );
                    if (unreviewedAmDocs.length > 0) {
                        return errorResponse(
                            `${unreviewedAmDocs.length} document(s) have not been verified yet. Please review and verify each document individually before approving.`,
                            400
                        );
                    }
                    newStatus = 'PENDING_QC_VERIFICATION' as ClientApprovalStatus;
                    auditAction = 'AM_APPROVED_CLIENT';
                    legacyVerificationStatus = 'UNDER_REVIEW';
                    break;
                }
                case 'AM_RETAKE': {
                    if (!amAllowedFrom.includes(current)) {
                        return errorResponse(`Cannot request retake from current status: ${current}`, 400);
                    }
                    newStatus = 'AM_RETAKE_REQUIRED';
                    auditAction = 'AM_RETAKE_DOCUMENT';
                    legacyVerificationStatus = 'PENDING_VERIFICATION';
                    break;
                }
                case 'AM_REJECT': {
                    if (!amAllowedFrom.includes(current)) {
                        return errorResponse(`Cannot reject from current status: ${current}`, 400);
                    }
                    newStatus = 'REJECTED';
                    auditAction = 'AM_REJECTED_CLIENT';
                    legacyVerificationStatus = 'REJECTED';
                    break;
                }

                // ── Background Verification Stage ──────────────────────────────────────
                case 'QC_VERIFY_APPROVE': {
                    if (!qcAllowedFrom.includes(current)) {
                        return errorResponse(
                            `Cannot complete background verification from current status: ${current}. AM approval must be done first.`,
                            400
                        );
                    }
                    // Gate: all documents must be explicitly reviewed/verified by QC
                    const unreviewedQcDocs = client.kycDocuments.filter(
                        (d) => (d.qcDecision ?? 'PENDING') === 'PENDING'
                    );
                    if (unreviewedQcDocs.length > 0) {
                        return errorResponse(
                            `${unreviewedQcDocs.length} document(s) have not been verified by QC yet. Please review and verify each document individually before approving.`,
                            400
                        );
                    }
                    newStatus = 'PENDING_FINAL_REVIEW' as ClientApprovalStatus;
                    auditAction = 'QC_VERIFIED_CLIENT';
                    legacyVerificationStatus = 'UNDER_REVIEW';
                    break;
                }
                case 'QC_VERIFY_REJECT': {
                    if (!qcAllowedFrom.includes(current)) {
                        return errorResponse(`Cannot reject from current status: ${current}`, 400);
                    }
                    newStatus = 'REJECTED';
                    auditAction = 'QC_REJECTED_CLIENT';
                    legacyVerificationStatus = 'REJECTED';
                    break;
                }
                case 'QC_VERIFY_RETAKE': {
                    if (!qcAllowedFrom.includes(current)) {
                        return errorResponse(`Cannot request retake from current status: ${current}`, 400);
                    }
                    newStatus = 'QC_VERIFICATION_RETAKE_REQUIRED' as ClientApprovalStatus;
                    auditAction = 'QC_RETAKE_CLIENT';
                    legacyVerificationStatus = 'PENDING_VERIFICATION';
                    break;
                }

                case 'FINAL_APPROVE': {
                    if (!finalAllowedFrom.includes(current)) {
                        return errorResponse(
                            `Cannot give final approval from current status: ${current}. AM review must be completed first.`,
                            400
                        );
                    }
                    newStatus = 'APPROVED';
                    auditAction = 'FINAL_APPROVED_CLIENT';
                    legacyVerificationStatus = 'VERIFIED';
                    break;
                }
                case 'FINAL_RETAKE': {
                    if (!finalAllowedFrom.includes(current)) {
                        return errorResponse(`Cannot request retake from current status: ${current}`, 400);
                    }
                    newStatus = 'FINAL_RETAKE_REQUIRED' as ClientApprovalStatus;
                    auditAction = 'FINAL_RETAKE_CLIENT';
                    legacyVerificationStatus = 'PENDING_VERIFICATION';
                    break;
                }
                case 'FINAL_REJECT': {
                    if (!finalAllowedFrom.includes(current)) {
                        return errorResponse(`Cannot reject from current status: ${current}`, 400);
                    }
                    newStatus = 'REJECTED';
                    auditAction = 'FINAL_REJECTED_CLIENT';
                    legacyVerificationStatus = 'REJECTED';
                    break;
                }
                // ── Dynamic Workflow Level Actions ─────────────────────────────────
                case 'LEVEL_APPROVE':
                case 'LEVEL_RETAKE':
                case 'LEVEL_REJECT': {
                    if (!activeWfConfig) {
                        return errorResponse('No active workflow config. Use legacy BM/AM/QC actions or ask admin to configure workflow.', 400);
                    }
                    if (!(await canAccessClientBranch(user, getClientApprovalBranchId(client)))) {
                        return errorResponse('Client does not belong to your branch', 403);
                    }

                    // The stage the client is waiting on (SUBMITTED = first stage), and
                    // the acting user must hold that stage's role — any role, any level.
                    const acting = await resolveActingStage(user, current, activeWfConfig.stages);
                    if (!acting.ok) return errorResponse(acting.error, acting.status);
                    const currentStage = acting.stage;
                    const stageInfo = { levelOrder: currentStage.levelOrder, roleSlug: currentStage.roleSlug, stageName: currentStage.stageName };
                    levelStageInfo = stageInfo;

                    if (action === 'LEVEL_APPROVE') {
                        // Gate: the Branch Manager stage (wherever it sits in the order)
                        // must have center & group assigned before forwarding — same rule
                        // as the legacy BM_SUBMIT_TO_AM gate.
                        if (currentStage.roleSlug === 'branch-manager') {
                            if (!client.centerId) {
                                return errorResponse('Center must be assigned to the client before forwarding. Please assign a center first.', 400);
                            }
                            if (!client.groupMemberships || client.groupMemberships.length === 0) {
                                return errorResponse('Group must be assigned to the client before forwarding. Please assign a group first.', 400);
                            }
                        }

                        // Gate: every document must carry THIS stage's decision (stored by
                        // role — see kyc-stage-decisions.ts), with no retake still open.
                        const decisions = enrollmentDocs.map(d => getStageDecision(d, currentStage.roleSlug).decision);
                        const pendingRetake = decisions.filter(d => d === 'RETAKE_REQUIRED').length;
                        if (pendingRetake > 0) {
                            return errorResponse(
                                `${pendingRetake} document(s) still pending retake. Resolve before forwarding.`,
                                400
                            );
                        }
                        const unreviewed = decisions.filter(d => d === 'PENDING').length;
                        if (unreviewed > 0) {
                            return errorResponse(
                                `${unreviewed} document(s) have not been verified yet. Please review and verify each document individually before forwarding.`,
                                400
                            );
                        }

                        const nextStage = activeWfConfig.stages.find(s => s.levelOrder === currentStage.levelOrder + 1);
                        newStatus = nextStage
                            ? getPendingStatusForStage(nextStage)
                            : 'PENDING_FINAL_REVIEW' as ClientApprovalStatus;
                        auditAction = 'LEVEL_APPROVED';
                        legacyVerificationStatus = 'UNDER_REVIEW';
                        // Built-in stages also stamp the client-level "reviewed by" columns
                        // (Approval Trail); custom stages are traced via history.
                        Object.assign(levelApproveFields, getClientReviewerFields(currentStage.roleSlug, user.userId, now, remarks || null));
                    } else if (action === 'LEVEL_RETAKE') {
                        if (!remarks?.trim()) {
                            return errorResponse('Remarks are required for retake', 400);
                        }
                        newStatus = getRetakeStatusForStage(currentStage);
                        auditAction = 'LEVEL_RETAKE_REQUESTED';
                        legacyVerificationStatus = 'PENDING_VERIFICATION';
                        Object.assign(levelApproveFields, getClientReviewerFields(currentStage.roleSlug, user.userId, now, remarks));
                    } else {
                        // LEVEL_REJECT
                        if (!remarks?.trim()) {
                            return errorResponse('Remarks are required for reject', 400);
                        }
                        newStatus = 'REJECTED' as ClientApprovalStatus;
                        auditAction = 'LEVEL_REJECTED';
                        legacyVerificationStatus = 'REJECTED';
                    }
                    break;
                }

                case 'FDO_RESUBMIT': {
                    // An APPROVED client never re-enters the BM/AM/QC/Admin queue (see
                    // admin-edit-no-reapproval policy) — a document can still be flagged
                    // RETAKE_REQUIRED on it without any client-level transition (see the
                    // reupload route), and re-uploading it already cleared that flag back
                    // to PENDING. Nothing to resubmit — treat as a no-op success instead
                    // of erroring, rather than requiring the caller to special-case this.
                    if (current === 'APPROVED') {
                        return successResponse({ approvalStatus: current }, 'Client is already approved — no resubmission needed');
                    }
                    if (activeWfConfig) {
                        // Dynamic workflow: a retake at ANY configured stage restarts the
                        // whole chain at Level 1, and every stage re-reviews every
                        // document. A final-review retake goes back to final review.
                        const stageRetakes = getAllStageRetakeStatuses(activeWfConfig.stages);
                        if (current === 'FINAL_RETAKE_REQUIRED') {
                            newStatus = 'PENDING_FINAL_REVIEW' as ClientApprovalStatus;
                        } else if (stageRetakes.includes(current) || fdoAllowedFrom.includes(current)) {
                            newStatus = 'SUBMITTED' as ClientApprovalStatus;
                            resetAllDecisions = true;
                        } else {
                            return errorResponse(
                                `Cannot resubmit from current status: ${current}. Only retake-required clients can be resubmitted.`,
                                400
                            );
                        }
                        auditAction = 'FDO_RESUBMITTED';
                        legacyVerificationStatus = 'PENDING_VERIFICATION';
                        break;
                    }
                    if (!fdoAllowedFrom.includes(current)) {
                        return errorResponse(
                            `Cannot resubmit from current status: ${current}. Only retake-required clients can be resubmitted.`,
                            400
                        );
                    }
                    // Route back to the correct stage. AM-level retake (whether a
                    // whole-stage "Request Retake" or a single image flagged during
                    // review) restarts the full BM -> AM re-review cycle rather than
                    // skipping straight back to AM, so the recheck cycle is:
                    //   FDO -> BM -> AM -> (recheck) -> FDO -> BM -> AM -> QC -> Admin
                    const resubmitTargetMap: Partial<Record<ClientApprovalStatus, ClientApprovalStatus>> = {
                        BM_RETAKE_REQUIRED:              'SUBMITTED',                    // BM must re-review
                        AM_RETAKE_REQUIRED:              'SUBMITTED',                    // restart: BM re-reviews, then AM again
                        QC_VERIFICATION_RETAKE_REQUIRED: 'SUBMITTED',                   // full restart: BM → AM → QC cycle again
                        FINAL_RETAKE_REQUIRED:           'PENDING_FINAL_REVIEW',         // All levels done, go to final
                        // Dynamic level retakes — go back to the same level's pending status
                        LEVEL_1_RETAKE_REQUIRED: 'SUBMITTED',         // Level 1 re-reviews from SUBMITTED
                        LEVEL_2_RETAKE_REQUIRED: 'SUBMITTED',         // restart: Level 1 re-reviews, then Level 2 again
                        LEVEL_3_RETAKE_REQUIRED: 'PENDING_LEVEL_3',
                        LEVEL_4_RETAKE_REQUIRED: 'PENDING_LEVEL_4',
                        LEVEL_5_RETAKE_REQUIRED: 'PENDING_LEVEL_5',
                    } as Partial<Record<ClientApprovalStatus, ClientApprovalStatus>>;
                    newStatus = resubmitTargetMap[current] ?? 'SUBMITTED';
                    auditAction = 'FDO_RESUBMITTED';
                    legacyVerificationStatus = 'PENDING_VERIFICATION';
                    break;
                }
                default:
                    return errorResponse('Unhandled action', 400);
            }

            // ── Execute transition in a transaction ──
            // `now` is declared before the switch above so LEVEL_APPROVE can reference it.
            const clientUpdate: any = {
                approvalStatus: newStatus,
                ...levelApproveFields,
            };

            // Set reviewer tracking
            if (action.startsWith('BM_')) {
                clientUpdate.bmReviewedById = user.userId;
                clientUpdate.bmReviewedAt = now;
                clientUpdate.bmRemarks = remarks || null;
            }
            if (action.startsWith('AM_')) {
                clientUpdate.amReviewedById = user.userId;
                clientUpdate.amReviewedAt = now;
                clientUpdate.amRemarks = remarks || null;
            }
            if (action.startsWith('QC_')) {
                clientUpdate.qcVerifiedById = user.userId;
                clientUpdate.qcVerifiedAt = now;
                clientUpdate.qcRemarks = remarks || null;
            }
            if (action.startsWith('FINAL_')) {
                clientUpdate.finalReviewedById = user.userId;
                clientUpdate.finalReviewedAt = now;
                clientUpdate.finalRemarks = remarks || null;
            }

            // Sync legacy field
            if (legacyVerificationStatus) {
                clientUpdate.verificationStatus = legacyVerificationStatus;
            }
            if (action === 'FINAL_APPROVE') {
                clientUpdate.verifiedById = user.userId;
                clientUpdate.verifiedAt = now;
            }
            if (action === 'BM_REJECT' || action === 'AM_REJECT' || action === 'FINAL_REJECT' || action === 'LEVEL_REJECT') {
                clientUpdate.rejectionReason = remarks;
            }

            // On FDO_RESUBMIT — reset only the KYC decisions relevant to the stage being
            // re-entered.  Stages that have already been signed off keep their decisions intact.
            const kycResetUpdate = (() => {
                if (action !== 'FDO_RESUBMIT' || activeWfConfig) return null;

                if (
                    current === 'BM_RETAKE_REQUIRED' ||
                    current === 'AM_RETAKE_REQUIRED' ||
                    current === 'LEVEL_1_RETAKE_REQUIRED' ||
                    current === 'LEVEL_2_RETAKE_REQUIRED'
                ) {
                    // Sent back to BM (whether BM or AM flagged the retake) — full
                    // restart: BM must re-review everything before AM re-reviews,
                    // so clear both BM and AM decisions.
                    return prisma.kYC.updateMany({
                        where: { clientId: client.id, isDeleted: false },
                        data: {
                            bmDecision: 'PENDING' as KYCDocumentDecision,
                            bmRemark: null,
                            bmReviewerId: null,
                            bmReviewedAt: null,
                            amDecision: 'PENDING' as KYCDocumentDecision,
                            amRemark: null,
                            amReviewerId: null,
                            amReviewedAt: null,
                            retakeReason: null,
                        },
                    });
                }

                if (current === 'QC_VERIFICATION_RETAKE_REQUIRED' || current === 'LEVEL_3_RETAKE_REQUIRED') {
                    // QC requested a retake → full restart through BM → AM → QC cycle.
                    // Clear BM, AM, and QC decisions so every stage re-reviews the
                    // re-uploaded images from scratch.
                    return prisma.kYC.updateMany({
                        where: { clientId: client.id, isDeleted: false },
                        data: {
                            bmDecision: 'PENDING' as KYCDocumentDecision,
                            bmRemark: null,
                            bmReviewerId: null,
                            bmReviewedAt: null,
                            amDecision: 'PENDING' as KYCDocumentDecision,
                            amRemark: null,
                            amReviewerId: null,
                            amReviewedAt: null,
                            qcDecision: 'PENDING' as KYCDocumentDecision,
                            qcRemark: null,
                            qcReviewerId: null,
                            qcReviewedAt: null,
                            retakeReason: null,
                        },
                    });
                }

                // FINAL_RETAKE_REQUIRED: all stages signed off — only clear retakeReason flag.
                return prisma.kYC.updateMany({
                    where: { clientId: client.id, isDeleted: false },
                    data: { retakeReason: null },
                });
            })();

            const txnOps: any[] = [
                prisma.client.update({
                    where: { id: client.id },
                    data: clientUpdate,
                    select: {
                        id: true,
                        clientId: true,
                        firstName: true,
                        lastName: true,
                        approvalStatus: true,
                        verificationStatus: true,
                        bmReviewedAt: true,
                        amReviewedAt: true,
                    },
                }),
                prisma.clientApprovalHistory.create({
                    data: {
                        clientId: client.id,
                        action: auditAction as any,
                        performedById: user.userId,
                        remarks: remarks || null,
                        previousState: JSON.stringify({ approvalStatus: current, ...(levelStageInfo ? { stage: levelStageInfo } : {}) }),
                        newState: JSON.stringify({ approvalStatus: newStatus, ...(levelStageInfo ? { stage: levelStageInfo } : {}) }),
                    },
                }),
            ];

            if (kycResetUpdate) txnOps.push(kycResetUpdate);

            // All documents must be individually verified before approving a stage.
            // Auto-verification has been removed as per strict document review policy.

            // Dynamic restart at Level 1 — clear every stage's decision (built-in
            // columns and custom-role rows) so each stage re-reviews from scratch.
            if (resetAllDecisions) txnOps.push(...buildResetAllStageDecisionsOps(client.id));

            const [updatedClient] = await prisma.$transaction(txnOps);
            // FINAL_APPROVE only — returned so the approver is told when the member's
            // first loan could not be auto-created (it would otherwise be missing from Loan Indexation).
            let firstLoan: Awaited<ReturnType<typeof createFirstLoanIfEligible>> | null = null;

            // ── File-Move Logic (kyc/ -> verified/) ──
            // Move KYC documents to verified folder only on final approval
            if (action === 'FINAL_APPROVE') {
                try {
                    // Get all non-deleted KYC docs for this client
                    const kycDocs = await prisma.kYC.findMany({
                        where: { clientId: client.id, isDeleted: false },
                        select: { id: true, fileUrl: true }
                    });

                    for (const doc of kycDocs) {
                        if (doc.fileUrl && doc.fileUrl.includes('/kyc/') && !doc.fileUrl.includes('/verified/')) {
                            try {
                                const fileKey = extractFileKeyFromUrl(doc.fileUrl);
                                if (fileKey && !fileKey.includes('/verified/')) {
                                    const newUrl = await moveKycDocumentToVerified(fileKey);
                                    
                                    // Update DB with new URL
                                    await prisma.kYC.update({
                                        where: { id: doc.id },
                                        data: { fileUrl: newUrl }
                                    });
                                }
                            } catch (moveErr) {
                                console.error(`[AM_APPROVE] Failed to move doc ${doc.id} for client ${clientId}:`, moveErr);
                            }
                        }
                    }
                } catch (err) {
                    console.error(`[AM_APPROVE] Error processing KYC document moves for client ${clientId}:`, err);
                }

                // Auto-create the client's first loan from enrollment-captured Loan
                // Details, if eligible — skips the manual FDO "Application" step so
                // the loan lands directly in Loan Indexation's unindexed list.
                // Best-effort: never blocks or fails the approval response.
                try {
                    const firstLoanResult = await createFirstLoanIfEligible(client.id, user.userId);
                    firstLoan = firstLoanResult;
                    if (firstLoanResult.created) {
                        console.log(`[FINAL_APPROVE] Auto-created first loan ${firstLoanResult.loanNumber} for client ${clientId}`);
                    } else {
                        console.log(`[FINAL_APPROVE] Skipped auto-loan creation for client ${clientId}: ${firstLoanResult.reason}`);
                    }
                } catch (err) {
                    console.error(`[FINAL_APPROVE] Error auto-creating first loan for client ${clientId}:`, err);
                    firstLoan = { created: false, reason: err instanceof Error ? err.message : 'Unknown error' };
                }
            }

            return successResponse(
                { client: updatedClient, action, previousStatus: current, newStatus, firstLoan },
                `Client ${action.toLowerCase().replace(/_/g, ' ')} completed successfully`
            );
        } catch (error) {
            console.error('Error executing approval action:', error);
            return errorResponse(
                error instanceof Error ? error.message : 'Failed to execute approval action',
                500
            );
        }
    })(request);
}
