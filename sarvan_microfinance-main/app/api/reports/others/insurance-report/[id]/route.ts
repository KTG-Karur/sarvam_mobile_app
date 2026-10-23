import { NextRequest } from 'next/server';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { z } from 'zod';
import { deleteInsuranceDocument } from '@/app/lib/storage/insurance-storage';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const updateSchema = z.object({
    policyType: z.enum(['CREDIT_LIFE', 'HEALTH', 'PERSONAL_ACCIDENT', 'GROUP']).optional(),
    coverageAmount: z.number().positive().optional(),
    premiumAmount: z.number().positive().optional(),
    premiumFrequency: z.enum(['ONE_TIME', 'MONTHLY', 'ANNUAL']).optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    nomineeName: z.string().min(1).optional(),
    nomineeRelationship: z.string().min(1).optional(),
    nomineeAge: z.number().int().positive().nullable().optional(),
    status: z.enum(['ACTIVE', 'EXPIRED', 'CANCELLED', 'CLAIMED']).optional(),
    claimDate: z.string().nullable().optional(),
    claimAmount: z.number().positive().nullable().optional(),
    remarks: z.string().nullable().optional(),

    // Master/Org defaults
    masterCode: z.string().min(1).optional(),
    agentCode: z.string().min(1).optional(),
    source: z.string().min(1).optional(),
    cafosCode: z.string().min(1).optional(),
    fscFsmCode: z.string().min(1).optional(),

    // Cover type axes
    coverType: z.enum(['SINGLE_LIFE', 'JOINT_LIFE']).optional(),
    coverBasis: z.enum(['LEVEL', 'REDUCING']).optional(),

    // Member declaration
    hasMedicalConditions: z.boolean().optional(),
    consentSplitPayment: z.boolean().optional(),
    consentCoverContinuation: z.boolean().optional(),

    // Payment details
    utrnNumber: z.string().nullable().optional(),
    fundTransferDate: z.string().nullable().optional(),

    // Appointee details
    appointeeName: z.string().nullable().optional(),
    appointeeSurname: z.string().nullable().optional(),
    appointeeGender: z.string().nullable().optional(),
    appointeeDob: z.string().nullable().optional(),
    appointeeRelationWithNominee: z.string().nullable().optional(),

    // COVID declaration
    covidTestedOrIsolated: z.boolean().optional(),
    covidAdvisedIsolationOrSymptoms: z.boolean().optional(),
    covidTravelOverseas: z.boolean().optional(),

    // Additional member details
    adbSumAssured: z.number().nonnegative().nullable().optional(),
    acceleratedTiBenefit: z.number().nonnegative().nullable().optional(),
});

/**
 * GET /api/reports/others/insurance-report/[id]
 * Fetch a single insurance record by ID.
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    return withRole(['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER'], async (req, user) => {
        try {
            const { id } = await params;

            const record = await prisma.insuranceRecord.findUnique({
                where: { id, isActive: true },
                include: {
                    client: {
                        select: {
                            id: true,
                            clientId: true,
                            firstName: true,
                            lastName: true,
                            phone: true,
                            mobileNumber: true,
                            gender: true,
                            permanentAddress: true,
                            district: true,
                            state: true,
                            pincode: true,
                            country: true,
                            occupation: true,
                            center: { select: { name: true, code: true } },
                        },
                    },
                    branch: { select: { id: true, name: true, code: true } },
                    loan: {
                        select: {
                            id: true,
                            loanNumber: true,
                            amount: true,
                            tenureMonths: true,
                            disbursedByBMAt: true,
                            disbursementStatus: true,
                            loanProduct: { select: { numberOfDues: true } },
                            _count: { select: { schedules: true } },
                        },
                    },
                    createdBy: { select: { firstName: true, lastName: true } },
                },
            });

            if (!record) return errorResponse('Insurance record not found', 404);

            // Branch access guard — any branch the user is assigned to (UserBranchAssignment /
            // AreaManagerBranch), not just their primary/active branch.
            {
                // Role-agnostic: ADMIN/HO users are unrestricted via a null permitted set.
                const permittedBranchIds = await getPermittedBranchIds(user);
                if (permittedBranchIds !== null && !permittedBranchIds.includes(record.branchId)) {
                    return errorResponse('Access denied to this record', 403);
                }
            }

            // isPrimary is false on every existing row, so require it first and fall
            // back to the earliest co-applicant for the client — same pattern as
            // app/api/co-applicants/route.ts.
            let coApplicant = await prisma.coApplicant.findFirst({
                where: { clientId: record.clientId, isPrimary: true },
                select: { name: true, gender: true, dateOfBirth: true, age: true, relationWithClient: true },
            });
            if (!coApplicant) {
                coApplicant = await prisma.coApplicant.findFirst({
                    where: { clientId: record.clientId },
                    select: { name: true, gender: true, dateOfBirth: true, age: true, relationWithClient: true },
                    orderBy: { createdAt: 'asc' },
                });
            }

            const { providerName: _providerName, ...recordWithoutProvider } = record;

            return successResponse({
                ...recordWithoutProvider,
                coverageAmount: Number(record.coverageAmount),
                premiumAmount: Number(record.premiumAmount),
                claimAmount: record.claimAmount ? Number(record.claimAmount) : null,
                adbSumAssured: record.adbSumAssured ? Number(record.adbSumAssured) : null,
                acceleratedTiBenefit: record.acceleratedTiBenefit ? Number(record.acceleratedTiBenefit) : null,
                coApplicant,
            }, 'Insurance record fetched successfully');
        } catch (error) {
            console.error('[Insurance] Error fetching record:', error);
            return errorResponse('Failed to fetch insurance record', 500);
        }
    })(request);
}

/**
 * PUT /api/reports/others/insurance-report/[id]
 * Update an insurance record.
 */
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    return withRole(['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER'], async (req, user) => {
        try {
            const { id } = await params;
            const body = await req.json();
            const validation = updateSchema.safeParse(body);

            if (!validation.success) {
                return errorResponse(validation.error.errors[0].message, 400);
            }

            // Verify record exists
            const existing = await prisma.insuranceRecord.findUnique({
                where: { id, isActive: true },
            });
            if (!existing) return errorResponse('Insurance record not found', 404);

            // Branch access guard — any branch the user is assigned to (UserBranchAssignment /
            // AreaManagerBranch), not just their primary/active branch.
            {
                // Role-agnostic: ADMIN/HO users are unrestricted via a null permitted set.
                const permittedBranchIds = await getPermittedBranchIds(user);
                if (permittedBranchIds !== null && !permittedBranchIds.includes(existing.branchId)) {
                    return errorResponse('Access denied to this record', 403);
                }
            }

            const data = validation.data;

            // Build update object
            const updateData: any = {};
            if (data.policyType !== undefined) updateData.policyType = data.policyType;
            if (data.coverageAmount !== undefined) updateData.coverageAmount = data.coverageAmount;
            if (data.premiumAmount !== undefined) updateData.premiumAmount = data.premiumAmount;
            if (data.premiumFrequency !== undefined) updateData.premiumFrequency = data.premiumFrequency;
            if (data.startDate !== undefined) updateData.startDate = new Date(data.startDate);
            if (data.endDate !== undefined) updateData.endDate = new Date(data.endDate);
            if (data.nomineeName !== undefined) updateData.nomineeName = data.nomineeName;
            if (data.nomineeRelationship !== undefined) updateData.nomineeRelationship = data.nomineeRelationship;
            if (data.nomineeAge !== undefined) updateData.nomineeAge = data.nomineeAge;
            if (data.status !== undefined) updateData.status = data.status;
            if (data.claimDate !== undefined) updateData.claimDate = data.claimDate ? new Date(data.claimDate) : null;
            if (data.claimAmount !== undefined) updateData.claimAmount = data.claimAmount;
            if (data.remarks !== undefined) updateData.remarks = data.remarks;

            if (data.masterCode !== undefined) updateData.masterCode = data.masterCode;
            if (data.agentCode !== undefined) updateData.agentCode = data.agentCode;
            if (data.source !== undefined) updateData.source = data.source;
            if (data.cafosCode !== undefined) updateData.cafosCode = data.cafosCode;
            if (data.fscFsmCode !== undefined) updateData.fscFsmCode = data.fscFsmCode;

            if (data.coverType !== undefined) updateData.coverType = data.coverType;
            if (data.coverBasis !== undefined) updateData.coverBasis = data.coverBasis;

            if (data.hasMedicalConditions !== undefined) updateData.hasMedicalConditions = data.hasMedicalConditions;
            if (data.consentSplitPayment !== undefined) updateData.consentSplitPayment = data.consentSplitPayment;
            if (data.consentCoverContinuation !== undefined) updateData.consentCoverContinuation = data.consentCoverContinuation;

            if (data.utrnNumber !== undefined) updateData.utrnNumber = data.utrnNumber;
            if (data.fundTransferDate !== undefined) updateData.fundTransferDate = data.fundTransferDate ? new Date(data.fundTransferDate) : null;

            if (data.appointeeName !== undefined) updateData.appointeeName = data.appointeeName;
            if (data.appointeeSurname !== undefined) updateData.appointeeSurname = data.appointeeSurname;
            if (data.appointeeGender !== undefined) updateData.appointeeGender = data.appointeeGender;
            if (data.appointeeDob !== undefined) updateData.appointeeDob = data.appointeeDob ? new Date(data.appointeeDob) : null;
            if (data.appointeeRelationWithNominee !== undefined) updateData.appointeeRelationWithNominee = data.appointeeRelationWithNominee;

            if (data.covidTestedOrIsolated !== undefined) updateData.covidTestedOrIsolated = data.covidTestedOrIsolated;
            if (data.covidAdvisedIsolationOrSymptoms !== undefined) updateData.covidAdvisedIsolationOrSymptoms = data.covidAdvisedIsolationOrSymptoms;
            if (data.covidTravelOverseas !== undefined) updateData.covidTravelOverseas = data.covidTravelOverseas;

            if (data.adbSumAssured !== undefined) updateData.adbSumAssured = data.adbSumAssured;
            if (data.acceleratedTiBenefit !== undefined) updateData.acceleratedTiBenefit = data.acceleratedTiBenefit;

            const updated = await prisma.insuranceRecord.update({
                where: { id },
                data: updateData,
            });

            const { providerName: _providerName, ...updatedWithoutProvider } = updated;
            return successResponse(updatedWithoutProvider, 'Insurance record updated successfully');
        } catch (error) {
            console.error('[Insurance] Error updating record:', error);
            return errorResponse('Failed to update insurance record', 500);
        }
    })(request);
}

/**
 * DELETE /api/reports/others/insurance-report/[id]
 * Soft-delete an insurance record and clean up stored PDF.
 */
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    return withRole(['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER'], async (req, user) => {
        try {
            const { id } = await params;

            const record = await prisma.insuranceRecord.findUnique({
                where: { id, isActive: true },
            });
            if (!record) return errorResponse('Insurance record not found', 404);

            // Branch access guard — any branch the user is assigned to (UserBranchAssignment /
            // AreaManagerBranch), not just their primary/active branch.
            {
                // Role-agnostic: ADMIN/HO users are unrestricted via a null permitted set.
                const permittedBranchIds = await getPermittedBranchIds(user);
                if (permittedBranchIds !== null && !permittedBranchIds.includes(record.branchId)) {
                    return errorResponse('Access denied to this record', 403);
                }
            }

            // Soft delete
            await prisma.insuranceRecord.update({
                where: { id },
                data: { isActive: false },
            });

            // Clean up storage if PDF exists
            if (record.documentKey) {
                try {
                    await deleteInsuranceDocument(record.documentKey);
                } catch (storageError) {
                    console.warn('[Insurance] Failed to delete stored document, continuing:', storageError);
                }
            }

            return successResponse(null, 'Insurance record deleted successfully');
        } catch (error) {
            console.error('[Insurance] Error deleting record:', error);
            return errorResponse('Failed to delete insurance record', 500);
        }
    })(request);
}
