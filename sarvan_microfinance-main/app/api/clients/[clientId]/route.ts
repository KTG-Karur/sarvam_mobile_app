import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/prisma';
import { withAuth, errorResponse, successResponse, handleCorsPreflight } from '@/app/lib/api-utils';
import { buildKycResetData, buildApprovalRestartData } from '@/app/lib/kyc-verification';
import {
    checkIdentityUniqueness,
    valuesMatchAfterNormalization,
    type IdentityField,
} from '@/app/lib/services/identity-uniqueness.service';
import { isSubAdminUser } from '@/app/lib/permissions/sub-admin';
import { getAllowFdoEditApprovedClient } from '@/app/lib/fdo-approved-client-edit-config';
import { getAllowBmEditApprovedClient } from '@/app/lib/bm-approved-client-edit-config';
import {
    getActiveWorkflowConfig,
    getUserWorkflowRoleSlugs,
    isClientPendingForRole,
    userHoldsStage,
} from '@/app/lib/workflow-config';
import { enrollmentValidationService } from '@/app/lib/services/enrollment-validation.service';
import { CLIENT_UPDATE_FIELD_CONFIG_MAP } from '@/app/lib/constants/enrollment-field-config-map';
import { ApprovalAction, type KYCDocumentDecision } from '@prisma/client';

/**
 * Compares an incoming PATCH value against the currently-stored value for a
 * single client field, normalizing types Prisma round-trips differently than
 * plain JS equality (Date objects, Decimal). Used only to detect whether an
 * Admin/Sub Admin edit on an already-APPROVED client is a genuine change
 * (which must restart the approval workflow) vs. a no-op re-save.
 */
function valuesEqual(incoming: unknown, current: unknown): boolean {
    if (incoming === current) return true;
    if (incoming == null && current == null) return true;
    if (incoming == null || current == null) return false;

    if (incoming instanceof Date || current instanceof Date) {
        const a = incoming instanceof Date ? incoming.getTime() : new Date(String(incoming)).getTime();
        const b = current instanceof Date ? current.getTime() : new Date(String(current)).getTime();
        return a === b;
    }

    if (typeof incoming === 'number' || typeof current === 'number') {
        return Number(incoming) === Number(current);
    }

    // Prisma Decimal fields (e.g. requestedAmount) round-trip as Decimal
    // objects rather than plain numbers — compare via their string form.
    if (typeof current === 'object') {
        const currentAsNumber = Number(String(current));
        if (!Number.isNaN(currentAsNumber)) {
            return Number(incoming) === currentAsNumber;
        }
    }

    return incoming === current;
}

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * Validation schema for client KYC update
 */
const clientUpdateSchema = z.object({
    // Basic Information
    firstName: z.string().min(1, 'First name is required').optional(),
    lastName: z.string().min(1, 'Last name is required').optional(),
    phone: z.string().optional().nullable(),
    email: z.string().email('Invalid email format').optional().nullable(),
    
    // Personal Details
    dateOfBirth: z.string().optional().nullable(),
    age: z.number().int().min(0).max(150).optional().nullable(),
    gender: z.string().optional().nullable(),
    fatherName: z.string().optional().nullable(),
    motherName: z.string().optional().nullable(),
    
    // Address Information
    permanentAddress: z.string().optional().nullable(),
    pincode: z.string().regex(/^[0-9]{6}$/, 'Pincode must be 6 digits').optional().nullable(),
    postOffice: z.string().optional().nullable(),
    district: z.string().optional().nullable(),
    state: z.string().optional().nullable(),
    country: z.string().optional().nullable(),
    
    // Contact
    mobileNumber: z.string().regex(/^[0-9]{10}$/, 'Mobile number must be 10 digits').optional().nullable(),
    
    // Banking Details
    bankName: z.string().optional().nullable(),
    bankBranch: z.string().optional().nullable(),
    bankIFSC: z
        .string()
        .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/i, 'Bank IFSC must be in format: SBIN0001234')
        .optional()
        .nullable(),
    bankAcNo: z.string().optional().nullable(),
    
    // Identity Documents
    otherIdNo: z.string().optional().nullable(),
    smartCardNo: z.string().optional().nullable(),
    votersIdNo: z.string().optional().nullable(),
    pancardNo: z.string().optional().nullable(),
    
    // Location
    latitude: z.string().optional().nullable(),
    longitude: z.string().optional().nullable(),
    
    // Financial
    requestedAmount: z.string().optional().nullable(),

    // Spouse details
    spouseName: z.string().optional().nullable(),
    spouseDob: z.string().optional().nullable(),
    spouseMobileNumber: z.string().optional().nullable(),
    spouseGender: z.string().optional().nullable(),

    // Bank account type
    bankAccountType: z.string().optional().nullable(),

    // Loan product selection
    requestedLoanProductTypeId: z.string().optional().nullable(),
    requestedLoanFrequency: z.string().optional().nullable(),
    requestedLoanProductId: z.string().optional().nullable(),
    requestedLoanPurposeTypeId: z.string().optional().nullable(),
    requestedLoanPurposeId: z.string().optional().nullable(),

    // Group/center request
    memberGroupStatus: z.string().optional().nullable(),
    requestedCenterId: z.string().optional().nullable(),
    requestedGroupId: z.string().optional().nullable(),

    // Economic Activities
    economicActivityTypeId: z.string().optional().nullable(),
    economicActivityId: z.string().optional().nullable(),
    spouseEconomicActivityTypeId: z.string().optional().nullable(),
    spouseEconomicActivityId: z.string().optional().nullable(),

    // Personal & Social
    caste: z.string().optional().nullable(),
    community: z.string().optional().nullable(),
    religion: z.string().optional().nullable(),
    qualification: z.string().optional().nullable(),
    maritalStatus: z.string().optional().nullable(),
    noOfChildren: z.number().int().optional().nullable(),
    monthlyFamilyIncome: z.number().int().optional().nullable(),
    monthlyFamilyExpense: z.number().int().optional().nullable(),
    houseStatus: z.string().optional().nullable(),
});

/**
 * GET /api/clients/[clientId]
 * Get client details by ID
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ clientId: string }> }
) {
    const { clientId } = await params;
    
    return withAuth(async (req, user) => {
        try {
            // Find client by clientId (not database id) — findFirst, not findUnique:
            // Client.clientId isn't DB-unique (uploan-imported legacy IDs can
            // intentionally collide, see schema.prisma) — deterministic oldest-created
            // tiebreak.
            const client = await prisma.client.findFirst({
                where: { clientId },
                orderBy: { createdAt: 'asc' },
                select: {
                    id: true,
                    clientId: true,
                    firstName: true,
                    lastName: true,
                    phone: true,
                    email: true,
                    approvalStatus: true,
                    dateOfBirth: true,
                    age: true,
                    gender: true,
                    fatherName: true,
                    motherName: true,
                    permanentAddress: true,
                    pincode: true,
                    postOffice: true,
                    district: true,
                    state: true,
                    country: true,
                    mobileNumber: true,
                    bankName: true,
                    bankBranch: true,
                    bankAccountType: true,
                    ifscCode: true,
                    bankAcNo: true,
                    otherIdNo: true,
                    smartCardNo: true,
                    votersIdNo: true,
                    pancardNo: true,
                    requestedAmount: true,
                    requestedLoanProductTypeId: true,
                    requestedLoanFrequency: true,
                    requestedLoanProductId: true,
                    requestedLoanPurposeTypeId: true,
                    requestedLoanPurposeId: true,
                    memberGroupStatus: true,
                    requestedCenterId: true,
                    requestedCenterName: true,
                    requestedGroupId: true,
                    requestedGroupName: true,
                    spouseName: true,
                    spouseDob: true,
                    spouseMobileNumber: true,
                    spouseGender: true,
                    latitude: true,
                    longitude: true,
                    verificationStatus: true,
                    centerId: true,
                    economicActivityTypeId: true,
                    economicActivityId: true,
                    spouseEconomicActivityTypeId: true,
                    spouseEconomicActivityId: true,
                    caste: true,
                    community: true,
                    religion: true,
                    qualification: true,
                    maritalStatus: true,
                    noOfChildren: true,
                    monthlyFamilyIncome: true,
                    monthlyFamilyExpense: true,
                    houseStatus: true,
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
                    // A client may have several co-applicants over time — this page
                    // shows the Primary one (first-ever created), same as before.
                    coApplicants: {
                        where: { isPrimary: true },
                        take: 1,
                        select: {
                            id: true,
                            name: true,
                            gender: true,
                            dateOfBirth: true,
                            age: true,
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
                            relationWithClient: true,
                            mobileNumber: true,
                            voterIdNo: true,
                            otherIdNo: true,
                            pancardNo: true,
                            createdAt: true,
                            updatedAt: true,
                        },
                    },
                    center: {
                        select: {
                            id: true,
                            name: true,
                            code: true,
                            branchId: true,
                            latitude: true,
                            longitude: true,
                            branch: {
                                select: {
                                    id: true,
                                    name: true,
                                    latitude: true,
                                    longitude: true,
                                },
                            },
                        },
                    },
                    // The client's REQUESTED center (Loan Details tab selection) — the
                    // correct branch-attribution source while still unassigned, in
                    // preference to enrolledBy's own branch.
                    requestedCenter: { select: { branchId: true } },
                    enrolledBy: { select: { id: true, branchId: true } },
                    createdAt: true,
                    _count: {
                        select: {
                            loanApplications: true,
                        },
                    },
                },
            });

            if (!client) {
                return errorResponse('Client not found', 404);
            }

            // Role-based access control
            if (user.role === 'BRANCH_MANAGER') {
                const userRecord = await prisma.user.findUnique({
                    where: { id: user.userId },
                    select: { branchId: true },
                });

                if (!userRecord || !userRecord.branchId || (client.center?.branchId ?? client.enrolledBy?.branchId) !== userRecord.branchId) {
                    return errorResponse('Insufficient permissions', 403);
                }
            } else if (user.role === 'FDO') {
                const userRecord = await prisma.user.findUnique({
                    where: { id: user.userId },
                    select: {
                        branchId: true,
                        assignedCenters: {
                            select: { id: true },
                        },
                    },
                });

                const centersWithFdoId = await prisma.center.findMany({
                    where: { fdoId: user.userId },
                    select: { id: true },
                });

                const assignedCenterIds = [
                    ...(userRecord?.assignedCenters?.map((c) => c.id) || []),
                    ...centersWithFdoId.map((c) => c.id),
                ];
                const uniqueCenterIds = [...new Set(assignedCenterIds)];

                // Check if client's center is assigned OR if it's an APPROVED center in FDO's branch
                let hasAccess = uniqueCenterIds.includes(client.centerId ?? "");

                if (!hasAccess && userRecord?.branchId && client.center?.branchId === userRecord.branchId) {
                    // Check if it's an APPROVED center in FDO's branch
                    const approvedCenter = await prisma.center.findFirst({
                        where: {
                            id: client.centerId ?? undefined,
                            branchId: userRecord.branchId,
                            status: 'APPROVED',
                        },
                        select: { id: true },
                    });
                    hasAccess = !!approvedCenter;
                }

                // Also grant access when client has no center but was enrolled in FDO's branch
                if (!hasAccess && userRecord?.branchId && client.enrolledBy?.branchId === userRecord.branchId) {
                    hasAccess = true;
                }
                if (!hasAccess) {
                    return errorResponse('Insufficient permissions', 403);
                }
            }

            // Preserve the historical response shape (singular `coApplicant`) so
            // existing frontend consumers need no changes — resolve to Primary.
            const { coApplicants, _count, ...clientRest } = client;
            const responseClient = {
                ...clientRest,
                coApplicant: coApplicants[0] ?? null,
                // Member (no loan yet) vs Client (has at least one loan) label signal
                hasLoan: (_count?.loanApplications ?? 0) > 0,
            };

            return successResponse(responseClient, 'Client fetched successfully');
        } catch (error) {
            console.error('Error fetching client:', error);
            return errorResponse(
                error instanceof Error ? error.message : 'Failed to fetch client',
                500
            );
        }
    })(request);
}

/**
 * PATCH /api/clients/[clientId]
 * Update client KYC details
 */
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ clientId: string }> }
) {
    const { clientId } = await params;
    
    return withAuth(async (req, user) => {
        try {
            // Opt-in flag — only the Client Update page sends this. When true (and
            // the client is APPROVED and the editor is Admin/Sub Admin), any real
            // field change restarts the approval workflow from BM review. Absent
            // for every other caller (KYC Update page, Approval Workbench edit
            // dialog, Co-Applicant loan-product patch), preserving their existing
            // behavior unchanged.
            const restartApprovalOnEdit = new URL(req.url).searchParams.get('restartApprovalOnEdit') === 'true';

            const body = await req.json();

            // Validate request body
            const validationResult = clientUpdateSchema.safeParse(body);
            if (!validationResult.success) {
                return errorResponse(
                    validationResult.error.errors[0]?.message || 'Invalid request data',
                    400
                );
            }

            const data = validationResult.data;

            // Check if client exists — findFirst, not findUnique: Client.clientId isn't
            // DB-unique (uploan-imported legacy IDs can intentionally collide, see
            // schema.prisma) — deterministic oldest-created tiebreak.
            const existingClient = await prisma.client.findFirst({
                where: { clientId },
                orderBy: { createdAt: 'asc' },
                select: {
                    id: true,
                    centerId: true,
                    approvalStatus: true,
                    center: {
                        select: {
                            branchId: true,
                        },
                    },
                    enrolledBy: { select: { id: true, branchId: true } },
                    mobileNumber: true,
                    otherIdNo: true,
                    pancardNo: true,
                    votersIdNo: true,
                    bankAcNo: true,
                    // Remaining fields below are only needed to diff against on a
                    // restartApprovalOnEdit request (see isFullRestartEditor), so we
                    // can detect a genuine change vs. a no-op re-save.
                    firstName: true,
                    lastName: true,
                    phone: true,
                    email: true,
                    dateOfBirth: true,
                    age: true,
                    gender: true,
                    fatherName: true,
                    motherName: true,
                    permanentAddress: true,
                    pincode: true,
                    postOffice: true,
                    district: true,
                    state: true,
                    country: true,
                    bankName: true,
                    bankBranch: true,
                    ifscCode: true,
                    smartCardNo: true,
                    requestedAmount: true,
                    latitude: true,
                    longitude: true,
                    economicActivityTypeId: true,
                    economicActivityId: true,
                    spouseEconomicActivityTypeId: true,
                    spouseEconomicActivityId: true,
                    spouseName: true,
                    spouseDob: true,
                    spouseMobileNumber: true,
                    spouseGender: true,
                    caste: true,
                    community: true,
                    religion: true,
                    qualification: true,
                    maritalStatus: true,
                    noOfChildren: true,
                    monthlyFamilyIncome: true,
                    monthlyFamilyExpense: true,
                    houseStatus: true,
                    bankAccountType: true,
                    requestedLoanProductTypeId: true,
                    requestedLoanFrequency: true,
                    requestedLoanProductId: true,
                    requestedLoanPurposeTypeId: true,
                    requestedLoanPurposeId: true,
                    memberGroupStatus: true,
                    requestedCenterId: true,
                    requestedCenterName: true,
                    requestedGroupId: true,
                    requestedGroupName: true,
                    // Cross-check against the Primary co-applicant only (matches this
                    // route's other co-applicant lookup above).
                    coApplicants: {
                        where: { isPrimary: true },
                        take: 1,
                        select: { mobileNumber: true, otherIdNo: true, pancardNo: true, voterIdNo: true },
                    },
                },
            });

            if (!existingClient) {
                return errorResponse('Client not found', 404);
            }

            // Role-based access control
            if (user.role === 'BRANCH_MANAGER') {
                const userRecord = await prisma.user.findUnique({
                    where: { id: user.userId },
                    select: { branchId: true },
                });

                if (!userRecord || !userRecord.branchId || (existingClient.center?.branchId ?? existingClient.enrolledBy?.branchId) !== userRecord.branchId) {
                    return errorResponse('Insufficient permissions: Client is not in your branch', 403);
                }
            } else if (user.role === 'FDO') {
                const userRecord = await prisma.user.findUnique({
                    where: { id: user.userId },
                    select: {
                        branchId: true,
                        assignedCenters: {
                            select: { id: true },
                        },
                    },
                });

                const centersWithFdoId = await prisma.center.findMany({
                    where: { fdoId: user.userId },
                    select: { id: true },
                });

                const assignedCenterIds = [
                    ...(userRecord?.assignedCenters?.map((c) => c.id) || []),
                    ...centersWithFdoId.map((c) => c.id),
                ];

                let hasAccess = assignedCenterIds.includes(existingClient.centerId ?? "");

                // Also grant access when client has no center but was enrolled in FDO's branch
                if (!hasAccess && userRecord?.branchId && existingClient.enrolledBy?.branchId === userRecord.branchId) {
                    hasAccess = true;
                }

                if (!hasAccess) {
                    return errorResponse('Insufficient permissions: Client is not in your assigned centers', 403);
                }
            } else if (user.role === 'AREA_MANAGER') {
                // AM may only edit while the client is currently pending at their own
                // review stage (legacy PENDING_AM_REVIEW, or the dynamic-workflow
                // level status configured for the area-manager role).
                const allowed = await isClientPendingForRole(
                    existingClient.approvalStatus,
                    'area-manager',
                    ['PENDING_AM_REVIEW']
                );
                if (!allowed) {
                    return errorResponse('Client is not currently at your review stage', 403);
                }
            } else {
                // QC (Quality Checkers) — either the legacy 'QC' role or an RBAC
                // assignment to the 'quality-checkers' role. Same stage restriction
                // as AM. Any other role (Admin/SubAdmin, etc.) falls through
                // unrestricted, matching existing behavior.
                const isQCTeam = user.role === 'QC' || !!(await prisma.userRoleAssignment.findFirst({
                    where: {
                        userId: user.userId,
                        isActive: true,
                        role: { slug: 'quality-checkers', isActive: true },
                    },
                }));
                if (isQCTeam) {
                    const allowed = await isClientPendingForRole(
                        existingClient.approvalStatus,
                        'quality-checkers',
                        ['PENDING_QC_VERIFICATION']
                    );
                    if (!allowed) {
                        return errorResponse('Client is not currently at your review stage', 403);
                    }
                } else if (user.role !== 'ADMIN' && !(await isSubAdminUser(user.userId))) {
                    // A custom role configured as a dynamic approval stage gets the
                    // same rule as AM/QC: edit only while the client is at its stage.
                    const wfConfig = await getActiveWorkflowConfig();
                    if (wfConfig) {
                        const slugs = await getUserWorkflowRoleSlugs(user);
                        const myStages = wfConfig.stages.filter(st => userHoldsStage(st, slugs));
                        if (myStages.length > 0) {
                            const checks = await Promise.all(
                                myStages.map(st => isClientPendingForRole(existingClient.approvalStatus, st.roleSlug, []))
                            );
                            if (!checks.some(Boolean)) {
                                return errorResponse('Client is not currently at your review stage', 403);
                            }
                        }
                    }
                }
            }

            // Once a client is fully APPROVED (final Admin/sub-admin approval), lock
            // details from further edits — except for Admin/sub-admin, Branch
            // Manager (who can still make corrections from the Approval Workbench;
            // see canEditClient in ApprovalClientDetail.tsx), and FDO (who can still
            // make corrections from the Member Update page; see canSeeApprovedClients
            // in client-update/page.tsx). Both the BM and FDO exemptions are further
            // gated by their own Admin-controlled kill-switch — BmApprovedClientEditConfig
            // and FdoApprovedClientEditConfig respectively.
            const isAdminRole = user.role === 'ADMIN' || user.role === 'ADMIN_NON_HO_BRANCH_SWITCH';
            const isSubAdmin = isAdminRole ? false : await isSubAdminUser(user.userId);
            const isBranchManager = user.role === 'BRANCH_MANAGER';
            const isFdo = user.role === 'FDO';
            const isFdoEditApproved =
                isFdo && existingClient.approvalStatus === 'APPROVED' && (await getAllowFdoEditApprovedClient());
            const isBmEditApproved =
                isBranchManager && existingClient.approvalStatus === 'APPROVED' && (await getAllowBmEditApprovedClient());
            if (existingClient.approvalStatus === 'APPROVED' && !isAdminRole && !isSubAdmin && !isBmEditApproved && !isFdoEditApproved) {
                return errorResponse('Client is already approved; details cannot be edited', 400);
            }

            // Requested-loan fields (Client Update's Loan Details tab) close off even
            // for Admin/Sub Admin once the client has been fully APPROVED — unlike
            // every other field on this endpoint, Admin/Sub Admin does NOT get to
            // keep correcting these 5 fields after their own final approval has
            // already happened. Scoped narrowly: only fires when the payload actually
            // touches one of these fields, and only for Admin/Sub Admin (BM/FDO are
            // already covered by the general lock + kill-switch check above).
            const LOAN_DETAIL_FIELD_KEYS = [
                'requestedLoanProductTypeId', 'requestedLoanFrequency', 'requestedLoanProductId',
                'requestedLoanPurposeTypeId', 'requestedLoanPurposeId',
            ] as const;
            const isEditingLoanFields = LOAN_DETAIL_FIELD_KEYS.some((k) => data[k] !== undefined);
            if (isEditingLoanFields && (isAdminRole || isSubAdmin) && existingClient.approvalStatus === 'APPROVED') {
                return errorResponse('Loan details cannot be edited after the client has been approved', 400);
            }

            const primaryCoApplicant = existingClient.coApplicants[0];

            // Identity/contact uniqueness checks — only for fields present in the
            // payload AND actually changing vs. the currently-stored value.
            const identityChecks: Array<{
                field: IdentityField;
                incoming?: string | null;
                current: string | null;
                label: string;
                coApplicantValue?: string | null;
            }> = [
                {
                    field: 'MOBILE',
                    incoming: data.mobileNumber,
                    current: existingClient.mobileNumber,
                    label: 'Mobile Number',
                    coApplicantValue: primaryCoApplicant?.mobileNumber,
                },
                {
                    field: 'AADHAAR',
                    incoming: data.otherIdNo,
                    current: existingClient.otherIdNo,
                    label: 'Aadhaar Number',
                    coApplicantValue: primaryCoApplicant?.otherIdNo,
                },
                {
                    field: 'PAN',
                    incoming: data.pancardNo,
                    current: existingClient.pancardNo,
                    label: 'PAN Card Number',
                    coApplicantValue: primaryCoApplicant?.pancardNo,
                },
                {
                    field: 'VOTER_ID',
                    incoming: data.votersIdNo,
                    current: existingClient.votersIdNo,
                    label: 'Voter ID Number',
                    coApplicantValue: primaryCoApplicant?.voterIdNo,
                },
                {
                    field: 'BANK_ACCOUNT',
                    incoming: data.bankAcNo,
                    current: existingClient.bankAcNo,
                    label: 'Bank Account Number',
                },
            ];

            for (const check of identityChecks) {
                if (check.incoming === undefined) continue; // not part of this PATCH payload
                if (valuesMatchAfterNormalization(check.field, check.incoming, check.current)) continue; // unchanged

                // Same-family cross-check against this client's own co-applicant (mandatory,
                // separate from the global uniqueness check below — see identity-uniqueness.service.ts)
                if (check.coApplicantValue && valuesMatchAfterNormalization(check.field, check.incoming, check.coApplicantValue)) {
                    return errorResponse(`Client and Co-Applicant cannot use the same ${check.label}.`, 400);
                }

                const result = await checkIdentityUniqueness(check.field, check.incoming, {
                    excludeFamilyClientId: existingClient.id,
                });
                if (result.isDuplicate) {
                    return errorResponse(`${check.label} already exists.`, 400);
                }
            }

            // Server-side counterpart to each caller's own client-side configErrors
            // gate (KYCDetailsFlatForm, KYCUpdateForm, CoApplicantForm's loan-trio
            // patch, LoanDetailsUpdateForm). This route is shared by all of them and
            // each PATCHes only its own slice of the client record, so — unlike the
            // enrollment POST route, which checks the whole record — only fields
            // actually present in THIS request body are checked (data[key] !==
            // undefined), matching the identity-uniqueness loop's own pattern above.
            // A field required by config but not part of this particular PATCH is not
            // flagged here; it's whichever tab owns that field's job to gate its own
            // submit (which it already does client-side).
            const presentFieldChecks = Object.entries(CLIENT_UPDATE_FIELD_CONFIG_MAP)
                .filter(([payloadKey]) => (data as Record<string, unknown>)[payloadKey] !== undefined)
                .map(([payloadKey, configKey]) => ({
                    configKey,
                    value: (data as Record<string, unknown>)[payloadKey],
                    label: configKey,
                }));
            const requiredFieldCheck = await enrollmentValidationService.assertRequiredFieldsPresent(presentFieldChecks);
            if (!requiredFieldCheck.ok) {
                return errorResponse(
                    'Validation failed: ' + requiredFieldCheck.missing.map((label) => `${label} is required`).join(', '),
                    400
                );
            }

            // Build update data
            const updateData: any = {};
            let shouldResetKycVerification = false;

            if (data.firstName !== undefined) updateData.firstName = data.firstName;
            if (data.lastName !== undefined) updateData.lastName = data.lastName;
            if (data.phone !== undefined) updateData.phone = data.phone;
            if (data.email !== undefined) updateData.email = data.email;
            if (data.dateOfBirth !== undefined) {
                updateData.dateOfBirth = data.dateOfBirth ? new Date(data.dateOfBirth) : null;
                shouldResetKycVerification = true;
            }
            if (data.age !== undefined) {
                updateData.age = data.age;
                shouldResetKycVerification = true;
            }
            if (data.gender !== undefined) {
                updateData.gender = data.gender;
                shouldResetKycVerification = true;
            }
            if (data.fatherName !== undefined) {
                updateData.fatherName = data.fatherName;
                shouldResetKycVerification = true;
            }
            if (data.motherName !== undefined) {
                updateData.motherName = data.motherName;
                shouldResetKycVerification = true;
            }
            if (data.permanentAddress !== undefined) {
                updateData.permanentAddress = data.permanentAddress;
                shouldResetKycVerification = true;
            }
            if (data.pincode !== undefined) {
                updateData.pincode = data.pincode;
                shouldResetKycVerification = true;
            }
            if (data.postOffice !== undefined) {
                updateData.postOffice = data.postOffice;
                shouldResetKycVerification = true;
            }
            if (data.district !== undefined) {
                updateData.district = data.district;
                shouldResetKycVerification = true;
            }
            if (data.state !== undefined) {
                updateData.state = data.state;
                shouldResetKycVerification = true;
            }
            if (data.country !== undefined) {
                updateData.country = data.country;
                shouldResetKycVerification = true;
            }
            if (data.mobileNumber !== undefined) {
                updateData.mobileNumber = data.mobileNumber;
                shouldResetKycVerification = true;
            }
            if (data.bankName !== undefined) {
                updateData.bankName = data.bankName;
                shouldResetKycVerification = true;
            }
            if (data.bankBranch !== undefined) {
                updateData.bankBranch = data.bankBranch;
                shouldResetKycVerification = true;
            }
            if (data.bankIFSC !== undefined) {
                updateData.ifscCode = data.bankIFSC;
                shouldResetKycVerification = true;
            }
            if (data.bankAcNo !== undefined) {
                updateData.bankAcNo = data.bankAcNo;
                shouldResetKycVerification = true;
            }
            if (data.otherIdNo !== undefined) {
                updateData.otherIdNo = data.otherIdNo;
                shouldResetKycVerification = true;
            }
            if (data.smartCardNo !== undefined) {
                updateData.smartCardNo = data.smartCardNo;
                shouldResetKycVerification = true;
            }
            if (data.votersIdNo !== undefined) {
                updateData.votersIdNo = data.votersIdNo;
                shouldResetKycVerification = true;
            }
            if (data.pancardNo !== undefined) {
                updateData.pancardNo = data.pancardNo;
                shouldResetKycVerification = true;
            }
            if (data.requestedAmount !== undefined) {
                updateData.requestedAmount = data.requestedAmount ? parseFloat(data.requestedAmount) : null;
            }
            if (data.latitude !== undefined) {
                updateData.latitude = data.latitude ? parseFloat(data.latitude) : null;
            }
            if (data.longitude !== undefined) {
                updateData.longitude = data.longitude ? parseFloat(data.longitude) : null;
            }
            if (data.economicActivityTypeId !== undefined) {
                updateData.economicActivityTypeId = data.economicActivityTypeId;
            }
            if (data.economicActivityId !== undefined) {
                updateData.economicActivityId = data.economicActivityId;
            }
            if (data.spouseEconomicActivityTypeId !== undefined) {
                updateData.spouseEconomicActivityTypeId = data.spouseEconomicActivityTypeId;
            }
            if (data.spouseEconomicActivityId !== undefined) {
                updateData.spouseEconomicActivityId = data.spouseEconomicActivityId;
            }
            if (data.spouseName !== undefined) {
                updateData.spouseName = data.spouseName;
            }
            if (data.spouseDob !== undefined) {
                updateData.spouseDob = data.spouseDob ? new Date(data.spouseDob) : null;
            }
            if (data.spouseMobileNumber !== undefined) {
                updateData.spouseMobileNumber = data.spouseMobileNumber;
            }
            if (data.spouseGender !== undefined) {
                updateData.spouseGender = data.spouseGender;
            }
            if (data.caste !== undefined) updateData.caste = data.caste;
            if (data.community !== undefined) updateData.community = data.community;
            if (data.religion !== undefined) updateData.religion = data.religion;
            if (data.qualification !== undefined) updateData.qualification = data.qualification;
            if (data.maritalStatus !== undefined) updateData.maritalStatus = data.maritalStatus;
            if (data.noOfChildren !== undefined) updateData.noOfChildren = data.noOfChildren;
            if (data.monthlyFamilyIncome !== undefined) updateData.monthlyFamilyIncome = data.monthlyFamilyIncome;
            if (data.monthlyFamilyExpense !== undefined) updateData.monthlyFamilyExpense = data.monthlyFamilyExpense;
            if (data.houseStatus !== undefined) updateData.houseStatus = data.houseStatus;
            if (data.bankAccountType !== undefined) {
                updateData.bankAccountType = data.bankAccountType;
            }
            if (data.requestedLoanProductTypeId !== undefined) {
                updateData.requestedLoanProductTypeId = data.requestedLoanProductTypeId;
            }
            if (data.requestedLoanFrequency !== undefined) {
                updateData.requestedLoanFrequency = data.requestedLoanFrequency;
            }
            if (data.requestedLoanProductId !== undefined) {
                updateData.requestedLoanProductId = data.requestedLoanProductId;
                // Auto-update requestedAmount from selected loan product
                if (data.requestedLoanProductId) {
                    const lp = await prisma.loanProduct.findUnique({
                        where: { id: data.requestedLoanProductId },
                        select: { loanAmount: true },
                    });
                    if (lp) updateData.requestedAmount = lp.loanAmount;
                }
            }
            if (data.requestedLoanPurposeTypeId !== undefined) {
                updateData.requestedLoanPurposeTypeId = data.requestedLoanPurposeTypeId;
            }
            if (data.requestedLoanPurposeId !== undefined) {
                updateData.requestedLoanPurposeId = data.requestedLoanPurposeId;
            }
            if (data.memberGroupStatus !== undefined) {
                updateData.memberGroupStatus = data.memberGroupStatus;
            }
            if (data.requestedCenterId !== undefined) {
                updateData.requestedCenterId = data.requestedCenterId;
                // Keep the denormalized name in sync with the ID, same as enrollment does.
                if (data.requestedCenterId) {
                    const center = await prisma.center.findUnique({
                        where: { id: data.requestedCenterId },
                        select: { name: true },
                    });
                    updateData.requestedCenterName = center?.name ?? null;
                } else {
                    updateData.requestedCenterName = null;
                }
            }
            if (data.requestedGroupId !== undefined) {
                updateData.requestedGroupId = data.requestedGroupId;
                if (data.requestedGroupId) {
                    const group = await prisma.group.findUnique({
                        where: { id: data.requestedGroupId },
                        select: { name: true },
                    });
                    updateData.requestedGroupName = group?.name ?? null;
                } else {
                    updateData.requestedGroupName = null;
                }
            }

            // Admin/Sub Admin/Branch Manager/FDO correcting an already-APPROVED
            // client never restarts the approval workflow — once one of them has
            // signed off on (or originally submitted) the correction themselves,
            // there is no need to re-queue BM -> AM -> QC -> Admin. This overrides
            // both the full-restart path below AND the "sensitive field" partial
            // reset (shouldResetKycVerification) further down, which would
            // otherwise silently flip approvalStatus back to SUBMITTED on its own.
            const isAdminOrSubAdminEditingApprovedClient =
                existingClient.approvalStatus === 'APPROVED' && (isAdminRole || isSubAdmin || isBmEditApproved || isFdoEditApproved);

            // Opted in via restartApprovalOnEdit (sent only by the Client Update
            // page) — restarts the approval workflow from BM review on ANY genuine
            // field change, not just the "sensitive" subset that triggers
            // shouldResetKycVerification. A no-op re-save (identical values) must
            // not spuriously reopen the client. Never applies to Admin/Sub
            // Admin/Branch Manager/FDO — see isAdminOrSubAdminEditingApprovedClient above.
            const isFullRestartEditor =
                !isAdminOrSubAdminEditingApprovedClient &&
                restartApprovalOnEdit &&
                existingClient.approvalStatus === 'APPROVED';
            const existingClientFields = existingClient as unknown as Record<string, unknown>;
            const hasActualChange = isFullRestartEditor
                ? Object.keys(updateData).some(
                      (key) => !valuesEqual(updateData[key], existingClientFields[key])
                  )
                : false;
            const isFullRestart = isFullRestartEditor && hasActualChange;
            // A DRAFT has never been submitted — resetting it would set SUBMITTED and push
            // it into the approval queue with its DRF- id. It enters approval only via enrollment.
            const isDraftClient = (existingClient.approvalStatus as string) === 'DRAFT';

            if (isFullRestart) {
                Object.assign(updateData, buildApprovalRestartData());
            } else if (shouldResetKycVerification && !isAdminOrSubAdminEditingApprovedClient && !isDraftClient) {
                Object.assign(updateData, buildKycResetData());
            }

            // Update client (+ approval-history audit row and per-document KYC
            // decision reset when this is a full restart) — related writes go
            // through a single transaction. `any[]` matches the established
            // pattern in app/api/approval/clients/[clientId]/action/route.ts for
            // mixed-model $transaction() arrays.
            const txnOps: any[] = [
                prisma.client.update({
                    // Target the specific record already resolved above by internal id —
                    // Client.clientId isn't DB-unique, so `update` (which requires a unique
                    // selector) can no longer take { clientId } directly.
                    where: { id: existingClient.id },
                    data: updateData,
                    select: {
                        id: true,
                        clientId: true,
                        firstName: true,
                        lastName: true,
                        phone: true,
                        email: true,
                        dateOfBirth: true,
                        age: true,
                        gender: true,
                        fatherName: true,
                        motherName: true,
                        permanentAddress: true,
                        pincode: true,
                        postOffice: true,
                        district: true,
                        state: true,
                        country: true,
                        mobileNumber: true,
                        bankName: true,
                        bankBranch: true,
                        bankAccountType: true,
                        ifscCode: true,
                        bankAcNo: true,
                        otherIdNo: true,
                        smartCardNo: true,
                        votersIdNo: true,
                        pancardNo: true,
                        requestedAmount: true,
                        requestedLoanProductTypeId: true,
                        requestedLoanFrequency: true,
                        requestedLoanProductId: true,
                        spouseName: true,
                        spouseDob: true,
                        spouseMobileNumber: true,
                        spouseGender: true,
                        latitude: true,
                        longitude: true,
                        verificationStatus: true,
                        updatedAt: true,
                    },
                }),
            ];

            if (isFullRestart) {
                txnOps.push(
                    prisma.clientApprovalHistory.create({
                        data: {
                            clientId: existingClient.id,
                            action: ApprovalAction.PROFILE_EDIT_RESET,
                            performedById: user.userId,
                            remarks: 'Admin/Sub Admin edit on an approved client (Client Update page) — approval workflow restarted from BM verification.',
                            previousState: JSON.stringify({ approvalStatus: existingClient.approvalStatus }),
                            newState: JSON.stringify({ approvalStatus: 'SUBMITTED' }),
                        },
                    }),
                    prisma.kYC.updateMany({
                        where: { clientId: existingClient.id, isDeleted: false },
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
                    })
                );
            }

            const [updatedClient] = await prisma.$transaction(txnOps);

            return successResponse(updatedClient, 'Client KYC updated successfully');
        } catch (error) {
            console.error('Error updating client:', error);
            
            if (error instanceof Error) {
                if (error.message.includes('Record to update not found')) {
                    return errorResponse('Client not found', 404);
                }
                return errorResponse(error.message, 500);
            }
            
            return errorResponse('Failed to update client KYC', 500);
        }
    })(request);
}
