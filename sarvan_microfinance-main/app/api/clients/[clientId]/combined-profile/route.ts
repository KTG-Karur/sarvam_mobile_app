import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { withAuth, errorResponse, successResponse, handleCorsPreflight } from '@/app/lib/api-utils';
import { CLIENT_KYC_DOCUMENT_TYPE_VALUES } from '@/app/lib/kyc-document-types';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/clients/[clientId]/combined-profile
 * Fetch client details + co-applicant + KYC documents in one request
 * Used by the consolidated Client Update page
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ clientId: string }> }
) {
    const { clientId } = await params;

    return withAuth(async (req, user) => {
        try {
            // Step 1: Fetch client (full profile with relations) — findFirst, not
            // findUnique: Client.clientId isn't DB-unique (uploan-imported legacy IDs can
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
                    ifscCode: true,
                    bankAcNo: true,
                    otherIdNo: true,
                    smartCardNo: true,
                    votersIdNo: true,
                    pancardNo: true,
                    requestedAmount: true,
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
                    spouseName: true,
                    spouseDob: true,
                    spouseMobileNumber: true,
                    spouseGender: true,
                    bankAccountType: true,
                    noOfChildren: true,
                    houseStatus: true,
                    monthlyFamilyIncome: true,
                    monthlyFamilyExpense: true,
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
                    center: {
                        select: {
                            id: true,
                            name: true,
                            code: true,
                            branchId: true,
                            branch: {
                                select: {
                                    id: true,
                                    name: true,
                                },
                            },
                        },
                    },
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

            // RBAC check: client's enrollment branch must be one the user is assigned to
            // (UserBranchAssignment / AreaManagerBranch), not just their primary branch.
            if (user.role !== 'ADMIN' && user.role !== 'ADMIN_NON_HO_BRANCH_SWITCH') {
                const permittedBranchIds = await getPermittedBranchIds(user);
                if (permittedBranchIds !== null && !permittedBranchIds.includes(client.enrolledBy.branchId ?? '')) {
                    return errorResponse('Unauthorized: client not in your branch', 403);
                }
            }

            // Step 2: Parallel fetch co-applicant + KYC documents
            // A client may have several co-applicants over time — this profile
            // shows the Primary one (first-ever created), same as before.
            const [coApplicant, kycDocuments] = await Promise.all([
                prisma.coApplicant.findFirst({
                    where: { clientId: client.id, isPrimary: true },
                    include: {
                        economicActivityType: { select: { id: true, name: true } },
                        economicActivity: { select: { id: true, name: true } },
                    },
                }),
                prisma.kYC.findMany({
                    where: {
                        clientId: client.id,
                        documentType: { in: CLIENT_KYC_DOCUMENT_TYPE_VALUES },
                        isDeleted: false,
                    },
                    select: {
                        id: true,
                        documentType: true,
                        fileUrl: true,
                        fileName: true,
                        fileSize: true,
                        mimeType: true,
                        createdAt: true,
                    },
                    orderBy: { createdAt: 'desc' },
                }),
            ]);

            // Step 3: Format response
            const { _count, ...clientRest } = client;
            return successResponse(
                {
                    client: {
                        ...clientRest,
                        // Member (no loan yet) vs Client (has at least one loan) label signal
                        hasLoan: (_count?.loanApplications ?? 0) > 0,
                    },
                    coApplicant: coApplicant || null,
                    kycDocuments: kycDocuments.map((doc) => ({
                        id: doc.id,
                        documentType: doc.documentType,
                        fileUrl: doc.fileUrl,
                        fileName: doc.fileName,
                        fileSize: doc.fileSize,
                        mimeType: doc.mimeType,
                        uploadedAt: doc.createdAt,
                    })),
                },
                'Combined profile fetched successfully'
            );
        } catch (error: any) {
            console.error('[combined-profile]', error);
            return errorResponse(error.message || 'Failed to fetch combined profile', 500);
        }
    })(request);
}
