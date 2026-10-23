import { NextRequest } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/app/lib/prisma';
import {
    withAuth,
    successResponse,
    errorResponse,
    handleCorsPreflight,
} from '@/app/lib/api-utils';
import { isSubAdminUser } from '@/app/lib/permissions/sub-admin';
import { renewalLoanService } from '@/app/lib/services/renewal-loan.service';
import {
    getRenewalStages,
    resolveRenewalStage,
    getNextRenewalStatus,
    getFirstRenewalStatus,
    RENEWAL_RETAKE_STATUSES,
} from '@/app/lib/renewal-workflow';
import { getStageForStatus } from '@/app/lib/workflow-config';
import {
    KYC_STAGE_DECISION_SELECT,
    getStageDecision,
    getAllStageDecisions,
    findRetakeFlag,
} from '@/app/lib/kyc-stage-decisions';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const kycDocSchema = z.object({
    documentType: z.string().min(1),
    fileUrl: z.string().min(1),
    fileName: z.string().optional().nullable(),
    documentNumber: z.string().optional().nullable(),
});

const proposedAddressSchema = z.object({
    permanentAddress: z.string().optional().nullable(),
    pincode: z.string().optional().nullable(),
    postOffice: z.string().optional().nullable(),
    district: z.string().optional().nullable(),
    state: z.string().optional().nullable(),
    country: z.string().optional().nullable(),
    latitude: z.string().optional().nullable(),
    longitude: z.string().optional().nullable(),
});

const coApplicantSchema = z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('existing'), coApplicantId: z.string().min(1) }),
    z.object({
        mode: z.literal('new'),
        name: z.string().min(1, 'Co-applicant name is required'),
        gender: z.string().min(1),
        dateOfBirth: z.string().min(1),
        age: z.coerce.number().int().min(0),
        relationWithClient: z.string().min(1),
        mobileNumber: z.string().min(1),
        economicActivityTypeId: z.string().optional().nullable(),
        economicActivityId: z.string().optional().nullable(),
        voterIdNo: z.string().optional().nullable(),
        otherIdNo: z.string().optional().nullable(),
        pancardNo: z.string().optional().nullable(),
    }),
]);

const createSchema = z.object({
    clientId: z.string().min(1, 'Member is required'),
    centerId: z.string().min(1, 'Center is required'),
    loanProductId: z.string().min(1, 'Loan product is required'),
    amount: z.string().min(1).refine((v) => !isNaN(Number(v)) && Number(v) > 0, 'Amount must be a positive number'),
    interestRate: z.string().min(1),
    tenureMonths: z.coerce.number().int().min(1, 'Tenure must be at least 1 month'),
    frequency: z.enum(['daily', 'weekly', 'forthnight', 'monthly', 'quarterly']),
    loanPurposeId: z.string().min(1, 'Loan purpose is required'),
    proposedAddress: proposedAddressSchema,
    coApplicant: coApplicantSchema,
    houseDocuments: z.array(kycDocSchema).min(1, 'At least one house image is required'),
    coApplicantDocuments: z.array(kycDocSchema).optional(),
});

const patchSchema = z.object({
    loanId: z.string().min(1),
    amount: createSchema.shape.amount.optional(),
    interestRate: z.string().optional(),
    tenureMonths: z.coerce.number().int().min(1).optional(),
    frequency: createSchema.shape.frequency.optional(),
    loanProductId: z.string().optional(),
    loanPurposeId: z.string().optional(),
    proposedAddress: proposedAddressSchema.optional(),
    houseDocuments: z.array(kycDocSchema).optional(),
});

/**
 * POST /api/loans/renewal-application
 * FDO / ADMIN / Sub Admin submit a renewal loan from the Member Enrollment page.
 */
export async function POST(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const isSubAdmin = user.role !== 'ADMIN' && (await isSubAdminUser(user.userId));
            if (!['FDO', 'ADMIN'].includes(user.role) && !isSubAdmin) {
                return errorResponse('Insufficient permissions', 403);
            }

            const body = await req.json();
            const parsed = createSchema.safeParse(body);
            if (!parsed.success) {
                return errorResponse('Validation failed: ' + parsed.error.errors.map((e) => e.message).join(', '), 400);
            }

            const result = await renewalLoanService.createRenewalApplication(parsed.data, user.userId);
            if (!result.success) {
                return errorResponse(result.error || 'Failed to create renewal loan application', 400);
            }
            return successResponse(
                { loanId: result.loanId, loanNumber: result.loanNumber },
                'Renewal loan application submitted for approval',
                201
            );
        } catch (error) {
            console.error('Error in renewal application POST:', error);
            return errorResponse(error instanceof Error ? error.message : 'Internal server error', 500);
        }
    })(request);
}

/**
 * PATCH /api/loans/renewal-application
 * FDO edits a retake-required renewal application (loan details / address /
 * re-uploaded house docs). Does NOT change status — the caller then POSTs
 * `FDO_RESUBMIT` to /api/approval/loans/[loanId]/renewal-action.
 */
export async function PATCH(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const body = await req.json();
            const parsed = patchSchema.safeParse(body);
            if (!parsed.success) {
                return errorResponse('Validation failed: ' + parsed.error.errors.map((e) => e.message).join(', '), 400);
            }
            const data = parsed.data;

            const loan = await prisma.loan.findUnique({
                where: { id: data.loanId },
                select: {
                    id: true,
                    createdById: true,
                    isRenewalApplication: true,
                    renewalApprovalStatus: true,
                    renewalProposedData: true,
                    clientId: true,
                },
            });
            if (!loan || !loan.isRenewalApplication) return errorResponse('Renewal loan not found', 404);
            if (user.role === 'FDO' && loan.createdById !== user.userId) {
                return errorResponse('You can only edit your own renewal applications', 403);
            }
            if (!loan.renewalApprovalStatus || !RENEWAL_RETAKE_STATUSES.includes(loan.renewalApprovalStatus)) {
                return errorResponse('This renewal application is not open for edits', 400);
            }

            await prisma.$transaction(async (tx) => {
                const loanUpdate: Prisma.LoanUpdateInput = {};
                if (data.amount) { loanUpdate.amount = data.amount; loanUpdate.appliedAmount = data.amount; }
                if (data.interestRate) loanUpdate.interestRate = data.interestRate;
                if (data.tenureMonths) loanUpdate.tenureMonths = data.tenureMonths;
                if (data.frequency) loanUpdate.frequency = data.frequency;
                if (data.loanProductId) loanUpdate.loanProduct = { connect: { id: data.loanProductId } };
                if (data.loanPurposeId) loanUpdate.loanPurpose = { connect: { id: data.loanPurposeId } };
                if (data.proposedAddress) {
                    const prev = (loan.renewalProposedData ?? {}) as { address?: Record<string, unknown> };
                    loanUpdate.renewalProposedData = { ...prev, address: { ...(prev.address ?? {}), ...data.proposedAddress } };
                }
                if (Object.keys(loanUpdate).length > 0) {
                    await tx.loan.update({ where: { id: loan.id }, data: loanUpdate });
                }

                if (data.houseDocuments && data.houseDocuments.length > 0) {
                    // Replace the loan-scoped house/NOC/QR docs
                    await tx.kYC.deleteMany({
                        where: {
                            loanId: loan.id,
                            coApplicantId: null,
                            documentType: {
                                in: ['house_image_1', 'house_image_2', 'house_image_3', 'location_qr', 'gas_bill', 'noc_image_1', 'noc_image_2', 'noc_image_3'],
                            },
                        },
                    });
                    await tx.kYC.createMany({
                        data: data.houseDocuments.map((d) => ({
                            clientId: loan.clientId,
                            loanId: loan.id,
                            documentType: d.documentType,
                            documentNumber: d.documentNumber ?? null,
                            fileUrl: d.fileUrl,
                            fileName: d.fileName ?? null,
                            uploadedById: user.userId,
                        })),
                    });
                }
            });

            return successResponse({ loanId: loan.id }, 'Renewal application updated');
        } catch (error) {
            console.error('Error in renewal application PATCH:', error);
            return errorResponse(error instanceof Error ? error.message : 'Internal server error', 500);
        }
    })(request);
}

/**
 * GET /api/loans/renewal-application?loanId=... — full detail for the approval
 * workbench and the FDO resume flow.
 */
export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const loanId = searchParams.get('loanId');

            // No loanId → list the caller's own renewal applications (FDO's "my
            // renewals" panel). `mine=true` + optional `retakeOnly=true`.
            if (!loanId) {
                const retakeOnly = searchParams.get('retakeOnly') === 'true';
                const rows = await prisma.loan.findMany({
                    where: {
                        isRenewalApplication: true,
                        isActive: true,
                        ...(user.role === 'FDO' ? { createdById: user.userId } : {}),
                        ...(retakeOnly ? { renewalApprovalStatus: { in: RENEWAL_RETAKE_STATUSES } } : {}),
                    },
                    orderBy: { createdAt: 'desc' },
                    take: 50,
                    select: {
                        id: true, loanNumber: true, amount: true, renewalApprovalStatus: true, createdAt: true,
                        client: { select: { clientId: true, firstName: true, lastName: true } },
                        center: { select: { name: true, code: true } },
                    },
                });
                return successResponse(rows.map((r) => ({
                    id: r.id,
                    loanNumber: r.loanNumber,
                    amount: Number(r.amount),
                    renewalApprovalStatus: r.renewalApprovalStatus,
                    createdAt: r.createdAt,
                    clientDisplayId: r.client.clientId,
                    clientName: `${r.client.firstName} ${r.client.lastName}`.trim(),
                    centerName: r.center ? `${r.center.code} - ${r.center.name}` : null,
                })));
            }

            const loan = await prisma.loan.findUnique({
                where: { id: loanId },
                select: {
                    id: true,
                    loanNumber: true,
                    isRenewalApplication: true,
                    renewalApprovalStatus: true,
                    renewalProposedData: true,
                    amount: true,
                    interestRate: true,
                    tenureMonths: true,
                    frequency: true,
                    loanProductId: true,
                    loanPurposeId: true,
                    centerId: true,
                    branchId: true,
                    createdById: true,
                    createdAt: true,
                    loanProduct: { select: { id: true, productName: true } },
                    loanPurpose: { select: { id: true, name: true, loanPurposeType: { select: { name: true } } } },
                    center: { select: { id: true, name: true, code: true } },
                    client: {
                        select: {
                            id: true, clientId: true, firstName: true, lastName: true,
                            permanentAddress: true, pincode: true, postOffice: true,
                            district: true, state: true, country: true, latitude: true, longitude: true,
                            // Member's enrollment-time KYC (not loan-scoped) — shown view-only
                            // in the FDO's renewal re-upload dialog as reference.
                            kycDocuments: {
                                where: { loanId: null, isDeleted: false },
                                orderBy: { revisionNo: 'desc' },
                                select: {
                                    id: true, documentType: true, fileUrl: true, fileName: true,
                                    mimeType: true, coApplicantId: true, revisionNo: true,
                                },
                            },
                        },
                    },
                    renewalKycDocuments: {
                        where: { isDeleted: false },
                        select: {
                            id: true, documentType: true, fileUrl: true, fileName: true, coApplicantId: true,
                            bmDecision: true, amDecision: true, qcDecision: true, retakeReason: true,
                            // Per-stage remark + reviewer, so the FDO sees who raised a recheck and why
                            bmRemark: true, amRemark: true, qcRemark: true,
                            bmReviewedAt: true, amReviewedAt: true, qcReviewedAt: true,
                            bmReviewer: { select: { firstName: true, lastName: true, employeeId: true } },
                            amReviewer: { select: { firstName: true, lastName: true, employeeId: true } },
                            qcReviewer: { select: { firstName: true, lastName: true, employeeId: true } },
                            // Custom-role stage decisions (kyc_stage_reviews)
                            stageReviews: KYC_STAGE_DECISION_SELECT.stageReviews,
                        },
                    },
                    renewalHistory: {
                        orderBy: { createdAt: 'desc' },
                        select: {
                            id: true, action: true, remarks: true, createdAt: true,
                            previousState: true, newState: true,
                            performedBy: { select: { firstName: true, lastName: true, employeeId: true, role: true } },
                        },
                    },
                },
            });
            if (!loan || !loan.isRenewalApplication) return errorResponse('Renewal loan not found', 404);

            const proposed = (loan.renewalProposedData ?? {}) as {
                address?: Record<string, string | null>;
                coApplicantMode?: 'existing' | 'new';
                coApplicantId?: string | null;
            };
            let coApplicant: Prisma.CoApplicantGetPayload<{
                select: {
                    id: true; name: true; gender: true; dateOfBirth: true; age: true;
                    relationWithClient: true; mobileNumber: true; status: true; isPrimary: true;
                    voterIdNo: true; otherIdNo: true; pancardNo: true;
                };
            }> | null = null;
            if (proposed.coApplicantId) {
                coApplicant = await prisma.coApplicant.findUnique({
                    where: { id: proposed.coApplicantId },
                    select: {
                        id: true, name: true, gender: true, dateOfBirth: true, age: true,
                        relationWithClient: true, mobileNumber: true, status: true, isPrimary: true,
                        voterIdNo: true, otherIdNo: true, pancardNo: true,
                    },
                });
            }

            // Stage chain as configured (any roles, any order) — the screens show
            // these names and send generic LEVEL_* actions instead of assuming BM → AM → QC.
            const { stages } = await getRenewalStages();
            const status = loan.renewalApprovalStatus ?? '';
            const currentStage = resolveRenewalStage(status, stages);
            const nextStatus = currentStage ? getNextRenewalStatus(currentStage, stages) : null;
            const nextStage = nextStatus ? getStageForStatus(nextStatus, stages) : null;
            const firstStage = getStageForStatus(getFirstRenewalStatus(stages), stages);
            const workflow = {
                stages: stages.map((st) => ({ levelOrder: st.levelOrder, roleSlug: st.roleSlug, stageName: st.stageName })),
                currentStage: currentStage
                    ? { levelOrder: currentStage.levelOrder, roleSlug: currentStage.roleSlug, stageName: currentStage.stageName }
                    : null,
                /** null when the current stage is the last one (→ Admin final review). */
                nextStageName: nextStage?.stageName ?? null,
                /** Where an FDO resubmit sends the renewal (any non-final retake restarts here). */
                firstStageName: firstStage?.stageName ?? null,
                isFinalReview: status === 'PENDING_FINAL_REVIEW' || status === 'FINAL_RETAKE_REQUIRED',
            };
            const renewalKycDocuments = loan.renewalKycDocuments.map((d) => ({
                ...d,
                currentStageDecision: currentStage ? getStageDecision(d, currentStage.roleSlug).decision : null,
                stageDecisions: getAllStageDecisions(d, stages),
                retakeFlaggedBy: findRetakeFlag(d, stages)?.stageName ?? null,
            }));

            return successResponse({
                loan: { ...loan, renewalKycDocuments },
                coApplicant,
                coApplicantMode: proposed.coApplicantMode ?? null,
                workflow,
            });
        } catch (error) {
            console.error('Error in renewal application GET:', error);
            return errorResponse(error instanceof Error ? error.message : 'Internal server error', 500);
        }
    })(request);
}
