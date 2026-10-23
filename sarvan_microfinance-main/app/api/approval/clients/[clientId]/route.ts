import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
} from '@/app/lib/api-utils';
import {
    getActiveWorkflowConfig,
    getPendingStatusForStage,
    getRetakeStatusForStage,
    getStageForStatus,
    getUserWorkflowRoleSlugs,
    userHoldsStage,
} from '@/app/lib/workflow-config';
import { getAllStageDecisions, getStageDecision, type KycWithStageDecisions } from '@/app/lib/kyc-stage-decisions';
import { isSubAdminUser } from '@/app/lib/permissions/sub-admin';
import { isWithinOrgScope } from '@/app/lib/permissions/org-scope';
import { getClientApprovalBranchId } from '@/app/lib/client-approval-access';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/approval/clients/[clientId]
 * Returns the full client approval detail — everything BM/AM needs on one screen.
 *
 * Payload includes:
 *  - Client master data (personal, address, nominee, banking, co-applicant)
 *  - Center & group context
 *  - Approval status & reviewer info
 *  - KYC documents with per-document BM/AM review metadata
 *  - Approval history timeline
 *  - Approval-readiness checklist (computed server-side)
 *
 * @access BRANCH_MANAGER, AREA_MANAGER, ADMIN, FDO (background-verification-team only),
 *         Sub Admin roles (see Role.isSubAdmin — read-only), and — with a dynamic
 *         workflow active — any user holding one of the configured stage roles
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ clientId: string }> }
) {
    const { clientId } = await params;

    return withAuth(async (req, user) => {
        try {
            const isSubAdmin = user.role !== 'ADMIN' && await isSubAdminUser(user.userId);
            const wfConfig = await getActiveWorkflowConfig();
            const userSlugs = await getUserWorkflowRoleSlugs(user);
            // Any role configured as a workflow stage (incl. admin-created roles with a
            // custom user.role code) may open the detail screen.
            const holdsAnyStage = !!wfConfig?.stages.some(s => userHoldsStage(s, userSlugs));
            const baseAllowedRoles = ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN', 'FDO', 'QC'];
            if (!baseAllowedRoles.includes(user.role) && !isSubAdmin && !holdsAnyStage) {
                return errorResponse('Insufficient permissions', 403);
            }

            // Find client by business clientId — findFirst, not findUnique: uploan-imported
            // legacy clientIds can intentionally collide (see the doc comment on
            // Client.clientId in schema.prisma); this deterministically resolves to the
            // oldest-created match rather than erroring or picking arbitrarily.
            const clientRaw = await prisma.client.findFirst({
                where: { clientId },
                orderBy: { createdAt: 'asc' },
                select: {
                    // Identity
                    id: true,
                    clientId: true,
                    firstName: true,
                    lastName: true,
                    phone: true,
                    email: true,
                    mobileNumber: true,

                    // Personal
                    dateOfBirth: true,
                    age: true,
                    gender: true,
                    fatherName: true,
                    motherName: true,
                    spouseName: true,
                    spouseOccupation: true,
                    maritalStatus: true,
                    religion: true,
                    caste: true,
                    community: true,
                    qualification: true,
                    occupation: true,
                    noOfChildren: true,
                    houseStatus: true,

                    // Economic Activities
                    economicActivityTypeId: true,
                    economicActivityId: true,
                    spouseEconomicActivityTypeId: true,
                    spouseEconomicActivityId: true,
                    economicActivityType: {
                        select: {
                            id: true,
                            name: true,
                        },
                    },
                    economicActivity: {
                        select: {
                            id: true,
                            name: true,
                        },
                    },
                    spouseEconomicActivityType: {
                        select: {
                            id: true,
                            name: true,
                        },
                    },
                    spouseEconomicActivity: {
                        select: {
                            id: true,
                            name: true,
                        },
                    },

                    // Address
                    permanentAddress: true,
                    pincode: true,
                    postOffice: true,
                    district: true,
                    state: true,
                    country: true,

                    // Financial
                    monthlyFamilyIncome: true,
                    monthlyFamilyExpense: true,
                    requestedAmount: true,
                    admissionFees: true,

                    // Requested loan (captured at enrollment's Loan Details tab — the
                    // real Loan row is only created at FINAL_APPROVE by
                    // createFirstLoanIfEligible, so this is all that exists to show/edit
                    // during BM/AM/QC/Admin review).
                    requestedLoanProductTypeId: true,
                    requestedLoanProductId: true,
                    requestedLoanFrequency: true,
                    requestedLoanPurposeTypeId: true,
                    requestedLoanPurposeId: true,
                    requestedLoanProductType: { select: { id: true, name: true } },
                    requestedLoanProduct: { select: { id: true, productName: true } },
                    requestedLoanPurposeType: { select: { id: true, name: true } },
                    requestedLoanPurpose: { select: { id: true, name: true } },

                    // Banking
                    bankName: true,
                    bankBranch: true,
                    ifscCode: true,
                    bankAcNo: true,

                    // Identity docs
                    pancardNo: true,
                    votersIdNo: true,
                    otherIdNo: true,
                    smartCardNo: true,

                    // Nominee
                    nomineeName: true,
                    nomineeRelation: true,
                    nomineeGender: true,
                    nomineeAge: true,
                    nomineeDateOfBirth: true,
                    nomineePhone: true,

                    // Approval workflow
                    verificationStatus: true,
                    approvalStatus: true,
                    bmReviewedById: true,
                    bmReviewedAt: true,
                    bmRemarks: true,
                    amReviewedById: true,
                    amReviewedAt: true,
                    amRemarks: true,
                    qcVerifiedById: true,
                    qcVerifiedAt: true,
                    qcRemarks: true,
                    finalReviewedById: true,
                    finalReviewedAt: true,
                    finalRemarks: true,
                    rejectionReason: true,

                    // Location
                    latitude: true,
                    longitude: true,
                    locationApprovalStatus: true,
                    locationApprovalRemarks: true,
                    locationApprovedAt: true,
                    pendingLatitude: true,
                    pendingLongitude: true,
                    relocationRemarks: true,

                    // Enrollment
                    enrolledById: true,
                    enrolledBy:      { select: { id: true, firstName: true, lastName: true, role: true, branchId: true, employeeId: true } },
                    verifiedBy:      { select: { id: true, firstName: true, lastName: true, role: true, employeeId: true } },
                    bmReviewedBy:    { select: { id: true, firstName: true, lastName: true, role: true, employeeId: true } },
                    amReviewedBy:    { select: { id: true, firstName: true, lastName: true, role: true, employeeId: true } },
                    qcVerifiedBy:    { select: { id: true, firstName: true, lastName: true, role: true, employeeId: true } },
                    finalReviewedBy: { select: { id: true, firstName: true, lastName: true, role: true, employeeId: true } },

                    // Context
                    centerId: true,
                    requestedCenter: { select: { branchId: true } },
                    center: {
                        select: {
                            id: true,
                            name: true,
                            code: true,
                            branchId: true,
                            latitude: true,
                            longitude: true,
                            branch: { select: { id: true, name: true, code: true } },
                        },
                    },
                    groupMemberships: {
                        select: {
                            group: { select: { id: true, name: true } },
                        },
                    },

                    // Co-applicant — a client may have several over time; this
                    // approval view shows the Primary one (first-ever created).
                    coApplicants: {
                        where: { isPrimary: true },
                        take: 1,
                        select: {
                            id: true,
                            name: true,
                            gender: true,
                            dateOfBirth: true,
                            age: true,
                            occupation: true,
                            relationWithClient: true,
                            mobileNumber: true,
                            voterIdNo: true,
                            otherIdNo: true,
                            pancardNo: true,
                            economicActivityTypeId: true,
                            economicActivityId: true,
                            economicActivityType: {
                                select: {
                                    id: true,
                                    name: true,
                                },
                            },
                            economicActivity: {
                                select: {
                                    id: true,
                                    name: true,
                                },
                            },
                        },
                    },

                    // KYC documents with full review metadata. loanId: null scopes this
                    // to the client's own canonical KYC — never set on a normal
                    // enrollment's docs, only on a Renewal Loan's own re-uploads (house
                    // images/location QR, see KYC.loanId's doc comment) — so a client
                    // with an in-flight renewal doesn't show that renewal's still-
                    // pending docs mixed into this reference view; those have their own
                    // dedicated review UI on the renewal's own approval screen.
                    kycDocuments: {
                        where: { isDeleted: false, loanId: null },
                        select: {
                            id: true,
                            documentType: true,
                            documentNumber: true,
                            fileUrl: true,
                            fileName: true,
                            fileSize: true,
                            mimeType: true,
                            status: true,
                            // BM review
                            bmDecision: true,
                            bmRemark: true,
                            bmReviewerId: true,
                            bmReviewedAt: true,
                            bmReviewer: { select: { firstName: true, lastName: true, employeeId: true } },
                            // AM review
                            amDecision: true,
                            amRemark: true,
                            amReviewerId: true,
                            amReviewedAt: true,
                            amReviewer: { select: { firstName: true, lastName: true, employeeId: true } },
                            // QC review
                            qcDecision: true,
                            qcRemark: true,
                            qcReviewerId: true,
                            qcReviewedAt: true,
                            qcReviewer: { select: { firstName: true, lastName: true, employeeId: true } },
                            // Custom-role dynamic stage decisions (see kyc-stage-decisions.ts)
                            stageReviews: {
                                select: {
                                    roleSlug: true, decision: true, remark: true, reviewedAt: true,
                                    reviewer: { select: { firstName: true, lastName: true, employeeId: true } },
                                },
                            },
                            // Meta
                            revisionNo: true,
                            retakeReason: true,
                            uploadedBy: { select: { firstName: true, lastName: true, employeeId: true } },
                            createdAt: true,
                            updatedAt: true,
                        },
                        orderBy: { createdAt: 'desc' },
                    },

                    // Approval history
                    approvalHistory: {
                        select: {
                            id: true,
                            action: true,
                            remarks: true,
                            kycDocumentId: true,
                            previousState: true,   // needed to identify which LEVEL_APPROVED = which stage
                            createdAt: true,
                            performedBy: { select: { firstName: true, lastName: true, role: true, employeeId: true } },
                        },
                        orderBy: { createdAt: 'desc' },
                        take: 200,  // raised from 50 — clients with many docs across multiple recheck cycles can have 50+ entries
                    },

                    createdAt: true,
                    updatedAt: true,
                    isActive: true,

                    // Default Member (No Loan) flag — Admin/Sub Admin only in the UI
                    isDefaultMember: true,
                    defaultMemberReason: true,
                    defaultMemberSetAt: true,
                    defaultMemberSetBy: { select: { firstName: true, lastName: true, employeeId: true } },
                },
            });

            if (!clientRaw) {
                return errorResponse('Client not found', 404);
            }

            // Preserve the historical shape (singular `coApplicant`) for the rest
            // of this handler — resolve to the Primary co-applicant.
            const { coApplicants, ...clientFields } = clientRaw;
            // With a dynamic workflow, each document also carries its decision for every
            // configured stage (in level order) so the UI can render any role's chips.
            const client = {
                ...clientFields,
                coApplicant: coApplicants[0] ?? null,
                kycDocuments: clientFields.kycDocuments.map(d => ({
                    ...d,
                    stageDecisions: wfConfig ? getAllStageDecisions(d, wfConfig.stages) : [],
                })),
            };

            // ── Branch-level access check ──
            if (user.role === 'BRANCH_MANAGER') {
                const userRecord = await prisma.user.findUnique({
                    where: { id: user.userId },
                    select: { branchId: true },
                });
                const clientBranchId = client.center?.branchId ?? client.enrolledBy?.branchId ?? null;
                if (!userRecord?.branchId || clientBranchId !== userRecord.branchId) {
                    return errorResponse('Client does not belong to your branch', 403);
                }
            }

            // ── Region/Division/Area/Branch org scope (e.g. Quality Checkers) ──
            if (!(await isWithinOrgScope(user.userId, getClientApprovalBranchId(client)))) {
                return errorResponse('Client is outside your assigned Region / Division / Area', 403);
            }

            // ── Dynamic workflow context ──
            // The stage the client is waiting on; the user can act only when they hold
            // that stage's role. A user holding a different stage still gets their own
            // stage info (canAct=false) so the UI can explain why it's read-only.
            let dynamicLevel: DynamicLevel | null = null;
            if (wfConfig) {
                const currentStage = getStageForStatus(client.approvalStatus, wfConfig.stages);
                const canAct = !!currentStage && userHoldsStage(currentStage, userSlugs);
                const shownStage = canAct ? currentStage : wfConfig.stages.find(s => userHoldsStage(s, userSlugs)) ?? null;
                if (shownStage) {
                    const nextStage = wfConfig.stages.find((s) => s.levelOrder === shownStage.levelOrder + 1);
                    dynamicLevel = {
                        isActive: true,
                        canAct,
                        stageName: shownStage.stageName,
                        levelOrder: shownStage.levelOrder,
                        roleSlug: shownStage.roleSlug,
                        nextStageName: nextStage?.stageName ?? null,
                        currentStageName: currentStage?.stageName ?? null,
                    };
                }
            }

            // ── Server-side approval checklist ──
            // Sub Admin only ever reaches this route for PENDING_FINAL_REVIEW clients
            // (the queue restricts them to that stage) — treat them as ADMIN so the
            // checklist renders the final-review section instead of nothing.
            const checklist = wfConfig
                ? buildDynamicChecklist(client, isSubAdmin ? 'ADMIN' : user.role, dynamicLevel)
                : buildApprovalChecklist(client, isSubAdmin ? 'ADMIN' : user.role);

            return successResponse(
                {
                    client,
                    groups: client.groupMemberships.map((gm) => gm.group),
                    checklist,
                    dynamicLevel,
                    // Lets the frontend tell "no dynamic workflow configured" (Admin
                    // keeps legacy BM/AM override access) apart from "a dynamic
                    // workflow is active but this user isn't one of its stages"
                    // (dynamicLevel is null in both cases) — see isBM/isAM in
                    // ApprovalClientDetail.tsx.
                    dynamicWorkflowActive: !!wfConfig,
                    // Configured stages in order — lets the UI label any role's stage.
                    workflowStages: wfConfig?.stages.map(s => ({
                        levelOrder: s.levelOrder,
                        roleSlug: s.roleSlug,
                        stageName: s.stageName,
                        pendingStatus: getPendingStatusForStage(s),
                        retakeStatus: getRetakeStatusForStage(s),
                    })) ?? [],
                },
                'Client approval detail fetched'
            );
        } catch (error) {
            console.error('Error fetching client approval detail:', error);
            return errorResponse(
                error instanceof Error ? error.message : 'Failed to fetch client approval detail',
                500
            );
        }
    })(request);
}

// ────────────────────────────────────────
// Server-side approval readiness checklist
// ────────────────────────────────────────

interface ChecklistItem {
    key: string;
    label: string;
    passed: boolean;
    severity: 'blocker' | 'warning';
}

type DynamicLevel = {
    isActive: boolean;
    /** True when the client is at this user's stage right now. */
    canAct: boolean;
    stageName: string;
    levelOrder: number;
    /** Role slug of the stage — where its per-document decisions are stored. */
    roleSlug: string;
    nextStageName: string | null;
    /** Stage the client is currently waiting on (may be someone else's). */
    currentStageName: string | null;
};

// Turns "house_image_1" into "House Image 1" so unreviewed-doc blockers name the
// actual document instead of a generic "documents pending" message.
function docTypeLabel(documentType: string): string {
    return documentType.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function buildApprovalChecklist(
    client: any,
    role: string
): ChecklistItem[] {
    const items: ChecklistItem[] = [];

    // Mandatory fields check
    const requiredFields: { field: string; label: string }[] = [
        { field: 'firstName', label: 'First Name' },
        { field: 'lastName', label: 'Last Name' },
        { field: 'dateOfBirth', label: 'Date of Birth' },
        { field: 'gender', label: 'Gender' },
        { field: 'fatherName', label: 'Father Name' },
        { field: 'permanentAddress', label: 'Address' },
        { field: 'mobileNumber', label: 'Mobile Number' },
        { field: 'pincode', label: 'Pincode' },
    ];

    for (const { field, label } of requiredFields) {
        items.push({
            key: `field_${field}`,
            label: `${label} is provided`,
            passed: !!client[field],
            severity: 'blocker',
        });
    }

    // Center & group — blocker for BM (must be assigned before BM can forward to AM);
    // warning for all other roles (AM/Admin/QC see it as informational only).
    const isBmActing =
        role === 'BRANCH_MANAGER' ||
        (role === 'ADMIN' &&
            (client.approvalStatus === 'SUBMITTED' || client.approvalStatus === 'PENDING_BM_REVIEW'));
    const centerGroupSeverity: 'blocker' | 'warning' = isBmActing ? 'blocker' : 'warning';

    items.push({
        key: 'center_mapped',
        label: isBmActing
            ? 'Center assigned (required before forwarding to AM)'
            : 'Center assigned (required before loan application)',
        passed: !!client.centerId,
        severity: centerGroupSeverity,
    });
    items.push({
        key: 'group_mapped',
        label: isBmActing
            ? 'Group assigned (required before forwarding to AM)'
            : 'Group assigned (required before loan application)',
        passed: !!(client.groupMemberships && client.groupMemberships.length > 0),
        severity: centerGroupSeverity,
    });

    // KYC documents check
    const activeDocs = client.kycDocuments || [];
    items.push({
        key: 'kyc_uploaded',
        label: 'At least one KYC document uploaded',
        passed: activeDocs.length > 0,
        severity: 'blocker',
    });

    if (role === 'BRANCH_MANAGER' || role === 'ADMIN') {
        // BM-specific: check there are no unreviewed documents
        const unreviewedDocs = activeDocs.filter((d: any) => d.bmDecision === 'PENDING');
        items.push({
            key: 'bm_all_docs_reviewed',
            label: unreviewedDocs.length > 0
                ? `Pending review: ${unreviewedDocs.map((d: any) => docTypeLabel(d.documentType)).join(', ')}`
                : 'All KYC documents reviewed by BM',
            passed: activeDocs.length > 0 && unreviewedDocs.length === 0,
            severity: 'blocker',
        });

        // No retake-pending docs
        const retakeDocs = activeDocs.filter((d: any) => d.bmDecision === 'RETAKE_REQUIRED');
        items.push({
            key: 'bm_no_retake_pending',
            label: 'No documents pending retake',
            passed: retakeDocs.length === 0,
            severity: 'blocker',
        });
    }

    if (role === 'AREA_MANAGER') {
        // AM-specific: BM must have completed
        items.push({
            key: 'bm_review_complete',
            label: 'BM review completed',
            passed: client.approvalStatus === 'PENDING_AM_REVIEW',
            severity: 'blocker',
        });

        // All docs AM-reviewed
        const amUnreviewed = activeDocs.filter((d: any) => d.amDecision === 'PENDING');
        items.push({
            key: 'am_all_docs_reviewed',
            label: amUnreviewed.length > 0
                ? `Pending review: ${amUnreviewed.map((d: any) => docTypeLabel(d.documentType)).join(', ')}`
                : 'All KYC documents reviewed by AM',
            passed: activeDocs.length > 0 && amUnreviewed.length === 0,
            severity: 'blocker',
        });
    }

    if (role === 'ADMIN') {
        const status = client.approvalStatus;
        // Show checklist relevant to the current stage the admin is acting on
        if (status === 'SUBMITTED' || status === 'PENDING_BM_REVIEW') {
            // Admin acting as BM
            const unreviewedDocs = activeDocs.filter((d: any) => d.bmDecision === 'PENDING');
            items.push({
                key: 'bm_all_docs_reviewed',
                label: unreviewedDocs.length > 0
                    ? `Pending review: ${unreviewedDocs.map((d: any) => docTypeLabel(d.documentType)).join(', ')}`
                    : 'All KYC documents reviewed by BM',
                passed: activeDocs.length > 0 && unreviewedDocs.length === 0,
                severity: 'blocker',
            });
        } else if (status === 'PENDING_AM_REVIEW') {
            // Admin acting as AM
            const amUnreviewed = activeDocs.filter((d: any) => d.amDecision === 'PENDING');
            items.push({
                key: 'am_all_docs_reviewed',
                label: amUnreviewed.length > 0
                    ? `Pending review: ${amUnreviewed.map((d: any) => docTypeLabel(d.documentType)).join(', ')}`
                    : 'All KYC documents reviewed by AM',
                passed: activeDocs.length > 0 && amUnreviewed.length === 0,
                severity: 'blocker',
            });
        } else if (status === 'PENDING_FINAL_REVIEW') {
            // Admin final review stage
            items.push({
                key: 'am_review_complete',
                label: 'AM review completed',
                passed: true,
                severity: 'blocker',
            });
        }
    }

    // Banking details (warning, not blocker)
    items.push({
        key: 'bank_details',
        label: 'Banking details provided',
        passed: !!(client.bankName && client.bankAcNo && client.ifscCode),
        severity: 'warning',
    });

    // Co-applicant (warning)
    items.push({
        key: 'co_applicant',
        label: 'Co-applicant details provided',
        passed: !!client.coApplicant,
        severity: 'warning',
    });

    return items;
}

/**
 * Checklist when a dynamic workflow is active — driven entirely by the acting
 * stage (any role), never by the fixed BM → AM → QC order.
 */

type ChecklistDoc = KycWithStageDecisions & { documentType: string };
type DynamicChecklistClient = {
    approvalStatus: string;
    centerId: string | null;
    groupMemberships?: unknown[];
    kycDocuments?: ChecklistDoc[];
    coApplicant: unknown;
    bankName?: string | null;
    bankAcNo?: string | null;
    ifscCode?: string | null;
    [field: string]: unknown;
};

function buildDynamicChecklist(
    client: DynamicChecklistClient,
    role: string,
    dynamicLevel: DynamicLevel | null
): ChecklistItem[] {
    const items: ChecklistItem[] = [];

    const requiredFields: { field: string; label: string }[] = [
        { field: 'firstName', label: 'First Name' },
        { field: 'lastName', label: 'Last Name' },
        { field: 'dateOfBirth', label: 'Date of Birth' },
        { field: 'gender', label: 'Gender' },
        { field: 'fatherName', label: 'Father Name' },
        { field: 'permanentAddress', label: 'Address' },
        { field: 'mobileNumber', label: 'Mobile Number' },
        { field: 'pincode', label: 'Pincode' },
    ];
    for (const { field, label } of requiredFields) {
        items.push({ key: `field_${field}`, label: `${label} is provided`, passed: !!client[field], severity: 'blocker' });
    }

    const acting = dynamicLevel?.canAct ? dynamicLevel : null;
    // Center & group are a blocker for whichever stage the Branch Manager role holds
    // (mirrors the legacy BM gate, enforced server-side in LEVEL_APPROVE).
    const centerGroupBlocks = acting?.roleSlug === 'branch-manager';
    items.push({
        key: 'center_mapped',
        label: centerGroupBlocks ? `Center assigned (required before ${acting!.stageName} can forward)` : 'Center assigned (required before loan application)',
        passed: !!client.centerId,
        severity: centerGroupBlocks ? 'blocker' : 'warning',
    });
    items.push({
        key: 'group_mapped',
        label: centerGroupBlocks ? `Group assigned (required before ${acting!.stageName} can forward)` : 'Group assigned (required before loan application)',
        passed: !!(client.groupMemberships && client.groupMemberships.length > 0),
        severity: centerGroupBlocks ? 'blocker' : 'warning',
    });

    const activeDocs = client.kycDocuments ?? [];
    items.push({ key: 'kyc_uploaded', label: 'At least one KYC document uploaded', passed: activeDocs.length > 0, severity: 'blocker' });

    if (acting) {
        const decisionOf = (d: ChecklistDoc) => getStageDecision(d, acting.roleSlug).decision;
        const unreviewedDocs = activeDocs.filter(d => decisionOf(d) === 'PENDING');
        items.push({
            key: 'level_all_docs_reviewed',
            label: unreviewedDocs.length > 0
                ? `Pending review: ${unreviewedDocs.map(d => docTypeLabel(d.documentType)).join(', ')}`
                : `All KYC documents reviewed by ${acting.stageName}`,
            passed: activeDocs.length > 0 && unreviewedDocs.length === 0,
            severity: 'blocker',
        });
        const retakeDocs = activeDocs.filter(d => decisionOf(d) === 'RETAKE_REQUIRED');
        items.push({
            key: 'level_no_retake_pending',
            label: retakeDocs.length > 0
                ? `Pending retake: ${retakeDocs.map(d => docTypeLabel(d.documentType)).join(', ')}`
                : 'No documents pending retake',
            passed: retakeDocs.length === 0,
            severity: 'blocker',
        });
    } else if (role === 'ADMIN' && client.approvalStatus === 'PENDING_FINAL_REVIEW') {
        items.push({ key: 'stages_complete', label: 'All approval stages completed', passed: true, severity: 'blocker' });
    }

    items.push({
        key: 'bank_details',
        label: 'Banking details provided',
        passed: !!(client.bankName && client.bankAcNo && client.ifscCode),
        severity: 'warning',
    });
    items.push({
        key: 'co_applicant',
        label: 'Co-applicant details provided',
        passed: !!client.coApplicant,
        severity: 'warning',
    });

    return items;
}
