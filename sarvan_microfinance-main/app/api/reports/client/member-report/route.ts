import { NextRequest } from 'next/server';
import type { Prisma, LoanDisbursementStatus } from '@prisma/client';
import { prisma } from '@/app/lib/db';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';
import { buildBranchWhereClause, resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';
import { memberIdSearchConditions, loanMemberIdSearchConditions } from '@/app/lib/reports/member-contacts';

export async function OPTIONS() {
    return handleCorsPreflight();
}

function userName(u: { firstName: string; lastName: string } | null | undefined) {
    return u ? `${u.firstName} ${u.lastName}`.trim() : '';
}

export async function queryLoans(where: Prisma.LoanWhereInput, skip?: number, take?: number) {
    return prisma.loan.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { loanNumber: 'asc' }, { id: 'asc' }],
        skip,
        take,
        select: {
            id: true,
            loanNumber: true,
            applicationStatus: true,
            disbursementStatus: true,
            amount: true,
            interestRate: true,
            principalPaid: true,
            frequency: true,
            disbursedByBMAt: true,
            firstDueDate: true,
            lastPaymentDate: true,
            closedDate: true,
            isDead: true,
            closureReason: true,
            createdAt: true,
            savingsPaid: true,
            appliedAmount: true,
            tenureMonths: true,
            interestPaid: true,
            penaltiesPaid: true,
            rejectionReason: true,
            verifiedAt: true,
            createdBy: { select: { firstName: true, lastName: true } },
            verifiedBy: { select: { firstName: true, lastName: true } },
            client: {
                select: {
                    id: true,
                    clientId: true,
                    firstName: true,
                    lastName: true,
                    isActive: true,
                    createdAt: true,
                    phone: true,
                    mobileNumber: true,
                    email: true,
                    dateOfBirth: true,
                    age: true,
                    gender: true,
                    permanentAddress: true,
                    state: true,
                    country: true,
                    district: true,
                    pincode: true,
                    postOffice: true,
                    latitude: true,
                    longitude: true,
                    caste: true,
                    community: true,
                    religion: true,
                    maritalStatus: true,
                    qualification: true,
                    houseStatus: true,
                    noOfChildren: true,
                    fatherName: true,
                    motherName: true,
                    votersIdNo: true,
                    otherIdNo: true,
                    smartCardNo: true,
                    admissionFees: true,
                    loanAdvance: true,
                    monthlyFamilyIncome: true,
                    monthlyFamilyExpense: true,
                    requestedAmount: true,
                    requestedLoanFrequency: true,
                    inactiveDate: true,
                    dropoutReason: true,
                    spouseName: true,
                    spouseDob: true,
                    spouseMobileNumber: true,
                    approvalStatus: true,
                    verificationStatus: true,
                    pancardNo: true,
                    bankAcNo: true,
                    ifscCode: true,
                    bankName: true,
                    bankBranch: true,
                    bankAccountType: true,
                    finalRemarks: true,
                    enrolledBy: { select: { firstName: true, lastName: true } },
                    economicActivity: { select: { name: true } },
                    spouseEconomicActivity: { select: { name: true } },
                    requestedLoanProductType: { select: { name: true } },
                    requestedLoanPurpose: { select: { name: true } },
                    groupId: true,
                    kycDocuments: {
                        where: { isDeleted: false },
                        orderBy: { createdAt: 'asc' },
                        take: 1,
                        select: { documentType: true, documentNumber: true },
                    },
                    insuranceRecords: {
                        orderBy: { createdAt: 'desc' },
                        take: 1,
                        select: {
                            policyNumber: true,
                            policyType: true,
                            coverageAmount: true,
                            premiumAmount: true,
                            startDate: true,
                            endDate: true,
                        },
                    },
                    loanApplications: { select: { id: true, createdAt: true } },
                },
            },
            branch: { select: { name: true } },
            center: {
                select: {
                    name: true,
                    code: true,
                    address: true,
                    localArea: true,
                    meetingDay: true,
                    meetingTime: true,
                    meetingPlace: true,
                    centerLeader: { select: { firstName: true, lastName: true } },
                },
            },
            loanProduct: {
                select: {
                    productName: true,
                    numberOfDues: true,
                    loanProductType: { select: { name: true } },
                },
            },
            loanPurpose: { select: { name: true } },
            funder: { select: { funderName: true } },
            approvedLevel2By: { select: { firstName: true, lastName: true } },
            coApplicantSnapshot: {
                select: {
                    name: true,
                    gender: true,
                    dateOfBirth: true,
                    age: true,
                    relationWithClient: true,
                    mobileNumber: true,
                    voterIdNo: true,
                    pancardNo: true,
                    economicActivityTypeName: true,
                    economicActivityName: true,
                },
            },
            schedules: {
                orderBy: { dueDate: 'asc' },
                select: {
                    dueDate: true,
                    principalDue: true,
                    interestDue: true,
                    principalPaid: true,
                    interestPaid: true,
                    status: true,
                },
            },
            transactions: {
                where: { isReversed: false, status: 'APPROVED' },
                orderBy: { transactionDate: 'desc' },
                take: 1,
                select: {
                    transactionDate: true,
                    principalAmount: true,
                    interestAmount: true,
                    amount: true,
                    openingArrearsPrincipal: true,
                    openingArrearsInterest: true,
                    collectedBy: { select: { firstName: true, lastName: true } },
                },
            },
        },
    });
}

/**
 * Draft-stage clients (`approvalStatus: 'DRAFT'`) have no `Loan` row yet — see
 * app/api/clients/draft/route.ts — so they can never be reached via `queryLoans`. Queried
 * separately and merged into the report as blank-loan rows (see GET handler). Mirrors the
 * client sub-select in `queryLoans` above so the two row builders stay visually consistent.
 */
export async function queryDraftClients(where: Prisma.ClientWhereInput, skip?: number, take?: number) {
    return prisma.client.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip,
        take,
        select: {
            id: true,
            clientId: true,
            firstName: true,
            lastName: true,
            createdAt: true,
            phone: true,
            mobileNumber: true,
            email: true,
            dateOfBirth: true,
            age: true,
            gender: true,
            permanentAddress: true,
            state: true,
            country: true,
            district: true,
            pincode: true,
            postOffice: true,
            latitude: true,
            longitude: true,
            caste: true,
            community: true,
            religion: true,
            maritalStatus: true,
            qualification: true,
            houseStatus: true,
            noOfChildren: true,
            fatherName: true,
            motherName: true,
            votersIdNo: true,
            otherIdNo: true,
            smartCardNo: true,
            admissionFees: true,
            loanAdvance: true,
            monthlyFamilyIncome: true,
            monthlyFamilyExpense: true,
            requestedAmount: true,
            requestedLoanFrequency: true,
            inactiveDate: true,
            dropoutReason: true,
            spouseName: true,
            spouseDob: true,
            spouseMobileNumber: true,
            approvalStatus: true,
            verificationStatus: true,
            pancardNo: true,
            bankAcNo: true,
            ifscCode: true,
            bankName: true,
            bankBranch: true,
            bankAccountType: true,
            finalRemarks: true,
            enrolledBy: { select: { firstName: true, lastName: true, branch: { select: { name: true } } } },
            economicActivity: { select: { name: true } },
            spouseEconomicActivity: { select: { name: true } },
            requestedLoanProductType: { select: { name: true } },
            requestedLoanPurpose: { select: { name: true } },
            groupId: true,
            center: {
                select: {
                    name: true,
                    code: true,
                    address: true,
                    localArea: true,
                    meetingDay: true,
                    meetingTime: true,
                    meetingPlace: true,
                    branch: { select: { name: true } },
                    centerLeader: { select: { firstName: true, lastName: true } },
                },
            },
            kycDocuments: {
                where: { isDeleted: false },
                orderBy: { createdAt: 'asc' },
                take: 1,
                select: { documentType: true, documentNumber: true },
            },
            coApplicants: {
                orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
                take: 1,
                select: {
                    name: true,
                    gender: true,
                    dateOfBirth: true,
                    age: true,
                    relationWithClient: true,
                    mobileNumber: true,
                    voterIdNo: true,
                    pancardNo: true,
                    economicActivity: { select: { name: true } },
                },
            },
        },
    });
}

/** Blank-loan row for a loanless client (Draft, or any later approval stage that
 *  simply hasn't been loaned yet — see loanApplications:{none:{}} in the GET handler's
 *  draftWhere) — every loan-specific field is null/0/'' (renders as '-' via fmtNum/orDash
 *  on the client). Center/Group/Branch are populated from the client's own assignment
 *  when present (a true fresh Draft typically has none yet; a later-stage loanless
 *  client usually does). */
export function buildDraftRows(
    clients: Awaited<ReturnType<typeof queryDraftClients>>,
    offset: number,
    groupNameById: Map<string, string>
) {
    return clients.map((client, index) => {
        const kyc = client.kycDocuments[0] ?? null;
        const coApp = client.coApplicants[0] ?? null;
        return {
            sNo: offset + index + 1,
            memberId: client.clientId,
            loanId: '',
            loanStatus: 'No Loan',
            name: `${client.firstName} ${client.lastName}`.trim(),
            phone: client.phone ?? client.mobileNumber ?? '',
            email: client.email ?? '',
            dob: client.dateOfBirth,
            age: client.age,
            gender: client.gender ?? '',
            economicActivityName: client.economicActivity?.name ?? '',
            branch: client.center?.branch?.name ?? client.enrolledBy?.branch?.name ?? '',
            center: client.center?.name ?? '',
            group: client.groupId ? (groupNameById.get(client.groupId) ?? '') : '',
            officerName: userName(client.enrolledBy),
            address: client.permanentAddress ?? '',
            localArea: client.center?.localArea ?? '',
            state: client.state ?? '',
            country: client.country ?? '',
            district: client.district ?? '',
            pinCode: client.pincode ?? '',
            houseLatitude: client.latitude,
            houseLongitude: client.longitude,
            permanentAddress: client.permanentAddress ?? '',
            centerLocation: client.center?.address ?? '',
            meetingDay: client.center?.meetingDay ?? '',
            meetingTime: client.center?.meetingTime ?? '',
            meetingCenterName: client.center?.meetingPlace ?? '',
            panCard: client.pancardNo ?? '',
            idProof: kyc?.documentType ?? '',
            idProofNo: kyc?.documentNumber ?? '',
            caste: client.caste ?? '',
            spouseName: client.spouseName ?? '',
            spouseDob: client.spouseDob,
            memberStatus: client.approvalStatus,
            memberActive: 'No',
            insurance: '',
            insurancePolicyType: '',
            insuranceCoverageAmount: null,
            insurancePremiumAmount: null,
            insuranceStartDate: null,
            insuranceEndDate: null,
            memberIsVerified: client.verificationStatus === 'VERIFIED' ? 'Yes' : 'No',
            loanCycleNo: 0,
            purposeOfLoan: '',
            productType: '',
            productName: '',
            productAmount: 0,
            rateOfInterest: 0,
            noOfInstallments: 0,
            loanDisbursementDate: null,
            loanStartDate: null,
            loanEndDate: null,
            collectionDay: '',
            loanPrincipal: 0,
            loanInterest: 0,
            totalAmount: 0,
            actualOutstandingPrincipal: 0,
            actualOutstandingInterest: 0,
            actualOutstandingTotal: 0,
            outstandingPrincipal: 0,
            outstandingInterest: 0,
            outstandingAsOnDate: null,
            arrearCollectionPrincipal: 0,
            arrearCollectionInterest: 0,
            arrearCollectionAsOnDate: null,
            fundingLine: '',
            lastRepayDate: null,
            lastRepayPrincipal: null,
            lastRepayInterest: null,
            lastRepayDueAmount: null,
            collectedBy: '',
            approvedBy: '',
            pattern: '',
            memberRemark: client.finalRemarks ?? '',
            accountNumber: client.bankAcNo ?? '',
            ifscCode: client.ifscCode ?? '',
            bankName: client.bankName ?? '',
            bankBranchName: client.bankBranch ?? '',
            accountType: client.bankAccountType ?? '',
            closedDate: null,
            centerID: client.center?.code ?? '',
            deadMember: 'No',
            loanClosureReason: '',

            admissionFees: client.admissionFees != null ? Number(client.admissionFees) : null,
            loanAdvance: client.loanAdvance != null ? Number(client.loanAdvance) : null,
            requestedAmount: client.requestedAmount != null ? Number(client.requestedAmount) : null,
            requestedLoanProductType: client.requestedLoanProductType?.name ?? '',
            requestedLoanPurpose: client.requestedLoanPurpose?.name ?? '',
            requestedLoanFrequency: client.requestedLoanFrequency ?? '',

            monthlyFamilyIncome: client.monthlyFamilyIncome != null ? Number(client.monthlyFamilyIncome) : null,
            monthlyFamilyExpense: client.monthlyFamilyExpense != null ? Number(client.monthlyFamilyExpense) : null,
            fatherName: client.fatherName ?? '',
            motherName: client.motherName ?? '',
            maritalStatus: client.maritalStatus ?? '',
            qualification: client.qualification ?? '',
            religion: client.religion ?? '',
            community: client.community ?? '',
            noOfChildren: client.noOfChildren,
            houseStatus: client.houseStatus ?? '',
            postOffice: client.postOffice ?? '',
            spouseMobileNumber: client.spouseMobileNumber ?? '',
            spouseEconomicActivity: client.spouseEconomicActivity?.name ?? '',
            votersIdNo: client.votersIdNo ?? '',
            otherIdNo: client.otherIdNo ?? '',
            smartCardNo: client.smartCardNo ?? '',
            inactiveDate: client.inactiveDate,
            dropoutReason: client.dropoutReason ?? '',

            appliedAmount: null,
            tenureMonths: 0,
            interestPaid: 0,
            penaltiesPaid: 0,
            loanRejectionReason: '',
            loanCreatedBy: '',
            loanVerifiedBy: '',
            loanVerifiedAt: null,

            loanMemberId: client.clientId,

            alternatePhone: client.mobileNumber ?? '',
            city: client.state ?? '',

            groupAddress: client.center?.address ?? '',
            memberLeadName: userName(client.center?.centerLeader),

            joiningDate: client.createdAt,
            aadharNumber: client.otherIdNo ?? '',
            addressProof: kyc?.documentType ?? '',
            addressProofNo: kyc?.documentNumber ?? '',

            processingFee: client.admissionFees != null ? Number(client.admissionFees) : null,
            walletAmount: 0,

            collectionStaff: '',
            accountName: client.bankName ?? '',
            annualIncome: client.monthlyFamilyIncome != null ? Number(client.monthlyFamilyIncome) * 12 : null,

            coApplicantName: coApp?.name ?? '',
            coApplicantRelation: coApp?.relationWithClient ?? '',
            coApplicantGender: coApp?.gender ?? '',
            coApplicantDob: coApp?.dateOfBirth ?? null,
            coApplicantAge: coApp?.age ?? null,
            coApplicantMobile: coApp?.mobileNumber ?? '',
            coApplicantOccupation: coApp?.economicActivity?.name ?? '',
            coApplicantPanCard: coApp?.pancardNo ?? '',
            coApplicantVoterId: coApp?.voterIdNo ?? '',
        };
    });
}

/**
 * Client.groupId has no `@relation` in the schema (it's a plain denormalized FK, see
 * where-clause comment above), so its target group name can't be fetched via a Prisma
 * `include`/`select` on the client relation — resolved separately via a lookup map instead.
 */
export async function buildGroupNameMap(
    loans: Awaited<ReturnType<typeof queryLoans>>,
    draftClients: Awaited<ReturnType<typeof queryDraftClients>> = []
): Promise<Map<string, string>> {
    const groupIds = [...new Set([
        ...loans.map((l) => l.client.groupId),
        ...draftClients.map((c) => c.groupId),
    ].filter((id): id is string => !!id))];
    if (groupIds.length === 0) return new Map();
    const groups = await prisma.group.findMany({ where: { id: { in: groupIds } }, select: { id: true, name: true } });
    return new Map(groups.map((g) => [g.id, g.name]));
}

export function buildRows(
    loans: Awaited<ReturnType<typeof queryLoans>>,
    offset: number,
    today: Date,
    groupNameById: Map<string, string>
) {
    return loans.map((loan, index) => {
        const client = loan.client;
        const schedules = loan.schedules;
        const lastTxn = loan.transactions[0] ?? null;
        const kyc = client.kycDocuments[0] ?? null;
        const insurance = client.insuranceRecords[0] ?? null;
        const coApp = loan.coApplicantSnapshot ?? null;

        const loanPrincipal = Number(loan.amount);
        const loanInterest = schedules.reduce((s, sch) => s + Number(sch.interestDue), 0);
        const totalAmount = loanPrincipal + loanInterest;

        const osPrincipal = Math.max(0, loanPrincipal - Number(loan.principalPaid));
        const osInterest = schedules.reduce(
            (s, sch) => s + Math.max(0, Number(sch.interestDue) - Number(sch.interestPaid)),
            0
        );
        const osTotal = osPrincipal + osInterest;

        const loanEndDate = schedules.length > 0 ? schedules[schedules.length - 1].dueDate : null;

        const loanCycleNo =
            client.loanApplications
                .slice()
                .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
                .findIndex((l) => l.id === loan.id) + 1;

        const loanStatus =
            loan.disbursementStatus === 'DISBURSED'
                ? 'Disbursed'
                : loan.disbursementStatus === 'CLOSED'
                    ? 'Closed'
                    : loan.disbursementStatus === 'REJECTED'
                        ? 'Rejected'
                        : loan.applicationStatus;

        return {
            sNo: offset + index + 1,
            memberId: client.clientId,
            loanId: loan.loanNumber,
            loanStatus,
            name: `${client.firstName} ${client.lastName}`.trim(),
            phone: client.phone ?? client.mobileNumber ?? '',
            email: client.email ?? '',
            dob: client.dateOfBirth,
            age: client.age,
            gender: client.gender ?? '',
            economicActivityName: client.economicActivity?.name ?? '',
            branch: loan.branch.name,
            center: loan.center.name,
            group: client.groupId ? (groupNameById.get(client.groupId) ?? '') : '',
            officerName: userName(client.enrolledBy),
            address: client.permanentAddress ?? '',
            localArea: loan.center.localArea ?? '',
            state: client.state ?? '',
            country: client.country ?? '',
            district: client.district ?? '',
            pinCode: client.pincode ?? '',
            houseLatitude: client.latitude,
            houseLongitude: client.longitude,
            permanentAddress: client.permanentAddress ?? '',
            centerLocation: loan.center.address ?? '',
            meetingDay: loan.center.meetingDay ?? '',
            meetingTime: loan.center.meetingTime ?? '',
            meetingCenterName: loan.center.meetingPlace ?? '',
            panCard: client.pancardNo ?? '',
            idProof: kyc?.documentType ?? '',
            idProofNo: kyc?.documentNumber ?? '',
            caste: client.caste ?? '',
            spouseName: client.spouseName ?? '',
            spouseDob: client.spouseDob,
            memberStatus: client.approvalStatus,
            memberActive: client.isActive ? 'Yes' : 'No',
            insurance: insurance?.policyNumber ?? '',
            insurancePolicyType: insurance?.policyType ?? '',
            insuranceCoverageAmount: insurance?.coverageAmount != null ? Number(insurance.coverageAmount) : null,
            insurancePremiumAmount: insurance?.premiumAmount != null ? Number(insurance.premiumAmount) : null,
            insuranceStartDate: insurance?.startDate ?? null,
            insuranceEndDate: insurance?.endDate ?? null,
            memberIsVerified: client.verificationStatus === 'VERIFIED' ? 'Yes' : 'No',
            loanCycleNo,
            purposeOfLoan: loan.loanPurpose?.name ?? '',
            productType: loan.loanProduct?.loanProductType?.name ?? '',
            productName: loan.loanProduct?.productName ?? '',
            productAmount: loanPrincipal,
            rateOfInterest: Number(loan.interestRate),
            noOfInstallments: loan.loanProduct?.numberOfDues ?? schedules.length,
            loanDisbursementDate: loan.disbursedByBMAt,
            loanStartDate: loan.firstDueDate,
            loanEndDate,
            collectionDay: loan.center.meetingDay ?? '',
            loanPrincipal,
            loanInterest,
            totalAmount,
            actualOutstandingPrincipal: osPrincipal,
            actualOutstandingInterest: osInterest,
            actualOutstandingTotal: osTotal,
            outstandingPrincipal: osPrincipal,
            outstandingInterest: osInterest,
            outstandingAsOnDate: today,
            arrearCollectionPrincipal: lastTxn ? Number(lastTxn.openingArrearsPrincipal) : 0,
            arrearCollectionInterest: lastTxn ? Number(lastTxn.openingArrearsInterest) : 0,
            arrearCollectionAsOnDate: lastTxn?.transactionDate ?? null,
            fundingLine: loan.funder?.funderName ?? '',
            lastRepayDate: loan.lastPaymentDate,
            lastRepayPrincipal: lastTxn?.principalAmount != null ? Number(lastTxn.principalAmount) : null,
            lastRepayInterest: lastTxn?.interestAmount != null ? Number(lastTxn.interestAmount) : null,
            lastRepayDueAmount: lastTxn ? Number(lastTxn.amount) : null,
            collectedBy: userName(lastTxn?.collectedBy),
            approvedBy: userName(loan.approvedLevel2By),
            pattern: loan.frequency ?? '',
            memberRemark: client.finalRemarks ?? '',
            accountNumber: client.bankAcNo ?? '',
            ifscCode: client.ifscCode ?? '',
            bankName: client.bankName ?? '',
            bankBranchName: client.bankBranch ?? '',
            accountType: client.bankAccountType ?? '',
            closedDate: loan.closedDate,
            centerID: loan.center.code,
            deadMember: loan.isDead ? 'Yes' : 'No',
            loanClosureReason: loan.closureReason ?? '',

            // Requested-loan / admission fields (Client)
            admissionFees: client.admissionFees != null ? Number(client.admissionFees) : null,
            loanAdvance: client.loanAdvance != null ? Number(client.loanAdvance) : null,
            requestedAmount: client.requestedAmount != null ? Number(client.requestedAmount) : null,
            requestedLoanProductType: client.requestedLoanProductType?.name ?? '',
            requestedLoanPurpose: client.requestedLoanPurpose?.name ?? '',
            requestedLoanFrequency: client.requestedLoanFrequency ?? '',

            // Family / demographic fields (Client)
            monthlyFamilyIncome: client.monthlyFamilyIncome != null ? Number(client.monthlyFamilyIncome) : null,
            monthlyFamilyExpense: client.monthlyFamilyExpense != null ? Number(client.monthlyFamilyExpense) : null,
            fatherName: client.fatherName ?? '',
            motherName: client.motherName ?? '',
            maritalStatus: client.maritalStatus ?? '',
            qualification: client.qualification ?? '',
            religion: client.religion ?? '',
            community: client.community ?? '',
            noOfChildren: client.noOfChildren,
            houseStatus: client.houseStatus ?? '',
            postOffice: client.postOffice ?? '',
            spouseMobileNumber: client.spouseMobileNumber ?? '',
            spouseEconomicActivity: client.spouseEconomicActivity?.name ?? '',
            votersIdNo: client.votersIdNo ?? '',
            otherIdNo: client.otherIdNo ?? '',
            smartCardNo: client.smartCardNo ?? '',
            inactiveDate: client.inactiveDate,
            dropoutReason: client.dropoutReason ?? '',

            // Loan financial detail
            appliedAmount: loan.appliedAmount != null ? Number(loan.appliedAmount) : null,
            tenureMonths: loan.tenureMonths,
            interestPaid: Number(loan.interestPaid),
            penaltiesPaid: Number(loan.penaltiesPaid),
            loanRejectionReason: loan.rejectionReason ?? '',
            loanCreatedBy: userName(loan.createdBy),
            loanVerifiedBy: userName(loan.verifiedBy),
            loanVerifiedAt: loan.verifiedAt,

            // Loan-related
            loanMemberId: client.clientId,

            // Personal/contact
            alternatePhone: client.mobileNumber ?? '',
            city: client.state ?? '',

            // Center/group
            groupAddress: loan.center.address ?? '',
            memberLeadName: userName(loan.center.centerLeader),

            // KYC/identity
            joiningDate: client.createdAt,
            aadharNumber: client.otherIdNo ?? '',
            addressProof: kyc?.documentType ?? '',
            addressProofNo: kyc?.documentNumber ?? '',

            // Financial/fees
            processingFee: client.admissionFees != null ? Number(client.admissionFees) : null,
            walletAmount: Number(loan.savingsPaid),

            // Staff/banking
            collectionStaff: userName(lastTxn?.collectedBy),
            accountName: client.bankName ?? '',
            annualIncome: client.monthlyFamilyIncome != null ? Number(client.monthlyFamilyIncome) * 12 : null,

            // Co-Applicant (frozen snapshot taken at loan-application time)
            coApplicantName: coApp?.name ?? '',
            coApplicantRelation: coApp?.relationWithClient ?? '',
            coApplicantGender: coApp?.gender ?? '',
            coApplicantDob: coApp?.dateOfBirth ?? null,
            coApplicantAge: coApp?.age ?? null,
            coApplicantMobile: coApp?.mobileNumber ?? '',
            coApplicantOccupation: coApp?.economicActivityName ?? coApp?.economicActivityTypeName ?? '',
            coApplicantPanCard: coApp?.pancardNo ?? '',
            coApplicantVoterId: coApp?.voterIdNo ?? '',
        };
    });
}

export async function GET(request: NextRequest) {
    return withRole(['ADMIN', 'BRANCH_MANAGER', 'FDO', 'AREA_MANAGER'], async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);

            const branchIdParam = searchParams.get('branchId');
            const centerId = searchParams.get('centerId') || undefined;
            const search = searchParams.get('search') || undefined;
            const exportAll = searchParams.get('exportAll') === 'true';
            const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
            const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '20')));

            // 'DRAFT' is a client-only pseudo-status (no disbursementStatus value) — selecting it
            // means "show only Draft-stage clients", so it never becomes a real Loan filter.
            const rawLoanStatus = searchParams.get('loanStatus') || undefined;
            const isDraftOnly = rawLoanStatus === 'DRAFT';
            const loanStatus = (rawLoanStatus && !isDraftOnly) ? (rawLoanStatus as LoanDisbursementStatus) : undefined;
            const loanTypeId = searchParams.get('loanTypeId') || undefined; // LoanProductType.id
            const groupFilter = searchParams.get('groupFilter') || undefined; // 'WITH' | 'WITHOUT'
            const funderId = searchParams.get('funderId') || undefined;
            const dateMode = searchParams.get('dateMode') || undefined; // 'AS_ON' | 'RANGE'
            const asOnDate = searchParams.get('asOnDate') || undefined;
            const fromDate = searchParams.get('fromDate') || undefined;
            const toDate = searchParams.get('toDate') || undefined;

            const branchWhere = await buildBranchWhereClause(user, branchIdParam);

            const searchWhere: Prisma.LoanWhereInput['OR'] = search
                ? [
                    { loanNumber: { contains: search, mode: 'insensitive' } },
                    { client: { firstName: { contains: search, mode: 'insensitive' } } },
                    { client: { lastName: { contains: search, mode: 'insensitive' } } },
                    { client: { clientId: { contains: search, mode: 'insensitive' } } },
                    { client: { phone: { contains: search, mode: 'insensitive' } } },
                    { client: { mobileNumber: { contains: search, mode: 'insensitive' } } },
                    ...loanMemberIdSearchConditions(search),
                ]
                : undefined;

            const where: Prisma.LoanWhereInput = {
                // Loan closure (foreclosure, write-off, normal final-installment closure) always
                // sets isActive:false alongside disbursementStatus:'CLOSED', so a hardcoded
                // isActive:true would make the 'Closed' status filter self-contradicting and
                // always return zero rows. Match on isActive only when it doesn't conflict with
                // the requested status.
                ...(loanStatus === 'CLOSED' ? { isActive: false } : loanStatus ? { isActive: true } : {}),
                ...branchWhere,
                ...(centerId && { centerId }),
                ...(searchWhere && { OR: searchWhere }),
                ...(loanStatus && { disbursementStatus: loanStatus }),
                ...(loanTypeId && { loanProduct: { loanProductTypeId: loanTypeId } }),
                // Client.groupId (not the GroupMember relation) is the authoritative group-membership
                // signal in this app — it's what the group-assign screens and app/api/clients/route.ts's
                // own group filter operate on; GroupMember is a secondary index that isn't guaranteed to
                // exist for every grouped client, so filtering on it under-counted "With Group" and
                // over-counted "Without Group".
                ...(groupFilter === 'WITH' && { client: { groupId: { not: null } } }),
                ...(groupFilter === 'WITHOUT' && { client: { groupId: null } }),
                ...(funderId && { funderId }),
                // Date inputs are IST business calendar days, not server-local/UTC midnight — use
                // the +05:30 offset (matches app/lib/branch-lock.ts's parseKolkataAttendanceDateYmd)
                // so the boundary doesn't drift by the 5:30 UTC/IST gap.
                ...(dateMode === 'AS_ON' && asOnDate && { disbursedByBMAt: { lte: new Date(`${asOnDate}T23:59:59.999+05:30`) } }),
                ...(dateMode === 'RANGE' && fromDate && toDate && {
                    disbursedByBMAt: { gte: new Date(`${fromDate}T00:00:00.000+05:30`), lte: new Date(`${toDate}T23:59:59.999+05:30`) },
                }),
            };

            // Loanless clients (true Drafts, and any later-stage client — e.g. SUBMITTED,
            // ungrouped — that simply has no Loan row yet) have no loan yet, so any loan-only
            // filter (a specific status, center, funder) can never match one — only include
            // them when none of those narrow the results (Loan Type is the one exception:
            // matched against the client's *requested* product type, since that's meaningful
            // pre-loan data).
            const includeDrafts = !isDraftOnly ? (!centerId && groupFilter !== 'WITH' && !funderId && !loanStatus) : true;
            let draftWhere: Prisma.ClientWhereInput | null = null;
            if (includeDrafts) {
                const draftBranchIds = await resolveScopedBranchIds(user, branchIdParam);
                const draftSearchWhere: Prisma.ClientWhereInput['OR'] = search
                    ? [
                        { firstName: { contains: search, mode: 'insensitive' } },
                        { lastName: { contains: search, mode: 'insensitive' } },
                        { clientId: { contains: search, mode: 'insensitive' } },
                        { phone: { contains: search, mode: 'insensitive' } },
                        { mobileNumber: { contains: search, mode: 'insensitive' } },
                        ...memberIdSearchConditions(search),
                    ]
                    : undefined;
                draftWhere = {
                    // The true criterion is "no loan yet" — approvalStatus:'DRAFT' was
                    // previously used as a proxy for this, which incorrectly excluded any
                    // later-stage (e.g. SUBMITTED, not-yet-grouped) client who also has no
                    // Loan row, making them vanish from the report entirely.
                    loanApplications: { none: {} },
                    ...(draftBranchIds !== null && { enrolledBy: { branchId: { in: draftBranchIds } } }),
                    ...(draftSearchWhere && { OR: draftSearchWhere }),
                    ...(loanTypeId && { requestedLoanProductTypeId: loanTypeId }),
                    // 'WITH' already excludes drafts entirely via includeDrafts above; 'WITHOUT'
                    // still needs its own check here since Client.groupId can be set pre-loan
                    // (group-assign only requires a centerId, not a specific approvalStatus).
                    ...(groupFilter === 'WITHOUT' && { groupId: null }),
                    ...(dateMode === 'AS_ON' && asOnDate && { createdAt: { lte: new Date(`${asOnDate}T23:59:59.999+05:30`) } }),
                    ...(dateMode === 'RANGE' && fromDate && toDate && {
                        createdAt: { gte: new Date(`${fromDate}T00:00:00.000+05:30`), lte: new Date(`${toDate}T23:59:59.999+05:30`) },
                    }),
                };
            }

            const today = new Date();
            today.setHours(0, 0, 0, 0);

            let summary = {
                loanAmountPrincipal: 0, loanAmountInterest: 0,
                osPrincipal: 0, osInterest: 0,
                collectedPrincipal: 0, collectedInterest: 0,
                memberCount: 0, membersWithLoan: 0, membersWithoutLoan: 0,
            };
            // Distinct members, not rows — a client with several loans (renewals) is one member.
            const [membersWithLoan, membersWithoutLoan] = await Promise.all([
                !isDraftOnly ? prisma.client.count({ where: { loanApplications: { some: where } } }) : Promise.resolve(0),
                draftWhere ? prisma.client.count({ where: draftWhere }) : Promise.resolve(0),
            ]);
            summary.membersWithLoan = membersWithLoan;
            summary.membersWithoutLoan = membersWithoutLoan;
            summary.memberCount = membersWithLoan + membersWithoutLoan;
            if (!isDraftOnly) {
                const [loanAgg, scheduleAgg] = await Promise.all([
                    prisma.loan.aggregate({ where, _sum: { amount: true, principalPaid: true } }),
                    prisma.loanSchedule.aggregate({ where: { loan: where }, _sum: { interestDue: true, interestPaid: true } }),
                ]);
                const loanAmountPrincipal = Number(loanAgg._sum.amount ?? 0);
                const loanAmountInterest = Number(scheduleAgg._sum.interestDue ?? 0);
                const collectedPrincipal = Number(loanAgg._sum.principalPaid ?? 0);
                const collectedInterest = Number(scheduleAgg._sum.interestPaid ?? 0);
                summary = {
                    ...summary,
                    loanAmountPrincipal,
                    loanAmountInterest,
                    osPrincipal: Math.max(0, loanAmountPrincipal - collectedPrincipal),
                    osInterest: Math.max(0, loanAmountInterest - collectedInterest),
                    collectedPrincipal,
                    collectedInterest,
                };
            }

            if (exportAll) {
                const EXPORT_LOAN_CAP = 5000;
                const EXPORT_DRAFT_CAP = 500;
                const [loanCount, draftCount] = await Promise.all([
                    !isDraftOnly ? prisma.loan.count({ where }) : Promise.resolve(0),
                    draftWhere ? prisma.client.count({ where: draftWhere }) : Promise.resolve(0),
                ]);
                if (loanCount > EXPORT_LOAN_CAP || draftCount > EXPORT_DRAFT_CAP) {
                    return errorResponse(
                        `Export matched ${loanCount + draftCount} records, which exceeds the ${EXPORT_LOAN_CAP + EXPORT_DRAFT_CAP} export limit. Narrow the branch, center, or date filters and try again.`,
                        400
                    );
                }
                const [loans, draftClients] = await Promise.all([
                    !isDraftOnly ? queryLoans(where, undefined, EXPORT_LOAN_CAP) : Promise.resolve([]),
                    draftWhere ? queryDraftClients(draftWhere, undefined, EXPORT_DRAFT_CAP) : Promise.resolve([]),
                ]);
                const groupNameById = await buildGroupNameMap(loans, draftClients);
                const draftRows = buildDraftRows(draftClients, 0, groupNameById);
                const loanRows = buildRows(loans, draftRows.length, today, groupNameById);
                const rows = [...draftRows, ...loanRows];
                return successResponse(
                    { data: rows, total: rows.length, page: 1, pageSize: rows.length, totalPages: 1, summary },
                    'Member report export fetched successfully'
                );
            }

            // Drafts are prepended ahead of loans in one unified, globally-numbered list —
            // standard "two concatenated lists" pagination math (drafts occupy global positions
            // [0, draftTotal), loans occupy [draftTotal, draftTotal + loanTotal)).
            const [loanTotal, draftTotal] = await Promise.all([
                !isDraftOnly ? prisma.loan.count({ where }) : Promise.resolve(0),
                draftWhere ? prisma.client.count({ where: draftWhere }) : Promise.resolve(0),
            ]);
            const totalCount = draftTotal + loanTotal;
            const globalStart = (page - 1) * pageSize;
            const globalEnd = globalStart + pageSize;

            const draftSkip = Math.min(globalStart, draftTotal);
            const draftTake = Math.max(0, Math.min(globalEnd, draftTotal) - draftSkip);
            const loanSkip = Math.max(0, globalStart - draftTotal);
            const loanTake = Math.max(0, Math.min(globalEnd - draftTotal, loanTotal) - loanSkip);

            const [draftClients, loans] = await Promise.all([
                draftWhere && draftTake > 0 ? queryDraftClients(draftWhere, draftSkip, draftTake) : Promise.resolve([]),
                !isDraftOnly && loanTake > 0 ? queryLoans(where, loanSkip, loanTake) : Promise.resolve([]),
            ]);

            const groupNameById = await buildGroupNameMap(loans, draftClients);
            const draftRows = buildDraftRows(draftClients, globalStart, groupNameById);
            const loanRows = buildRows(loans, draftTotal + loanSkip, today, groupNameById);
            const rows = [...draftRows, ...loanRows];

            return successResponse(
                { data: rows, total: totalCount, page, pageSize, totalPages: Math.max(1, Math.ceil(totalCount / pageSize)), summary },
                'Member report fetched successfully'
            );
        } catch (error) {
            console.error('[MemberReport] Error:', error);
            return errorResponse('Failed to fetch member report', 500);
        }
    })(request);
}
