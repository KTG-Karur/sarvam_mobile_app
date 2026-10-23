import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import {
    withAuth,
    successResponse,
    errorResponse,
    handleCorsPreflight,
} from '@/app/lib/api-utils';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/clients/[clientId]/renewal-prefill
 *
 * Read-only member snapshot for the Member Enrollment page's "Renewal Loan"
 * mode. The form renders identity / bank / economic-activity / KYC-number
 * fields read-only from this payload, and only lets the editable areas
 * (address + location, co-applicant, Loan Details, house KYC) through.
 * `clientId` here is the internal `Client.id`.
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ clientId: string }> }
) {
    const { clientId } = await params;

    return withAuth(async () => {
        try {
            const client = await prisma.client.findUnique({
                where: { id: clientId },
                select: {
                    id: true,
                    clientId: true,
                    approvalStatus: true,
                    isActive: true,
                    centerId: true,
                    firstName: true,
                    lastName: true,
                    phone: true,
                    email: true,
                    mobileNumber: true,
                    otherIdNo: true,
                    pancardNo: true,
                    votersIdNo: true,
                    smartCardNo: true,
                    caOtherIdNo: true,
                    caPancardNo: true,
                    caVoterIdNo: true,
                    dateOfBirth: true,
                    age: true,
                    gender: true,
                    caste: true,
                    community: true,
                    religion: true,
                    qualification: true,
                    maritalStatus: true,
                    spouseName: true,
                    spouseDob: true,
                    spouseMobileNumber: true,
                    spouseGender: true,
                    spouseEconomicActivityTypeId: true,
                    spouseEconomicActivityId: true,
                    fatherName: true,
                    motherName: true,
                    noOfChildren: true,
                    monthlyFamilyIncome: true,
                    monthlyFamilyExpense: true,
                    economicActivityTypeId: true,
                    economicActivityId: true,
                    houseStatus: true,
                    ifscCode: true,
                    bankAcNo: true,
                    bankName: true,
                    bankBranch: true,
                    bankAccountType: true,
                    // Editable on renewal
                    permanentAddress: true,
                    pincode: true,
                    postOffice: true,
                    district: true,
                    state: true,
                    country: true,
                    latitude: true,
                    longitude: true,
                    center: { select: { id: true, name: true, code: true, branchId: true, latitude: true, longitude: true } },
                    highmarkReports: {
                        orderBy: { pulledAt: 'desc' },
                        take: 1,
                        select: { creditScore: true, status: true, pulledAt: true },
                    },
                    groupMemberships: {
                        select: { group: { select: { id: true, name: true, code: true } } },
                    },
                    kycDocuments: {
                        where: { isDeleted: false, loanId: null },
                        select: { id: true, documentType: true, fileUrl: true, fileName: true, mimeType: true },
                    },
                },
            });

            if (!client) return errorResponse('Member not found', 404);
            if (client.approvalStatus !== 'APPROVED') {
                return errorResponse('Only fully approved members are eligible for a renewal loan', 400);
            }

            return successResponse({
                ...client,
                latestHighmark: client.highmarkReports[0] ?? null,
                group: client.groupMemberships[0]?.group ?? null,
            });
        } catch (error) {
            console.error('Error in renewal-prefill:', error);
            return errorResponse(error instanceof Error ? error.message : 'Internal server error', 500);
        }
    })(request);
}
