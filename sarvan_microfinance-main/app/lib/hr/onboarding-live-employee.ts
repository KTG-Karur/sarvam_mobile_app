import { prisma } from '@/app/lib/db';

/**
 * Once an onboarding request is approved the employee (User) record becomes the source of truth —
 * Employee Master edits it from then on. The request row only holds the snapshot taken at approval,
 * so reading it as-is shows stale data. These helpers overlay the employee's CURRENT values onto an
 * approved request (field names mapped back to the request's own names, the inverse of the
 * request → User copy done in app/api/hr/onboarding/[id]/action/route.ts). Pending / rejected
 * requests have no employee yet and pass through untouched.
 */

const LIVE_USER_SELECT = {
    id: true,
    firstName: true,
    lastName: true,
    mobileNumber: true,
    email: true,
    branchId: true,
    shiftId: true,
    departmentId: true,
    designationId: true,
    dateOfJoining: true,
    education: true,
    address: true,
    permanentAddress: true,
    dob: true,
    gender: true,
    maritalStatus: true,
    bloodGroup: true,
    emergencyContactName: true,
    emergencyContactRelation: true,
    emergencyContactMobile: true,
    aadhaarNumber: true,
    panNumber: true,
    dlNumber: true,
    voterIdNumber: true,
    uanNumber: true,
    esiNumber: true,
    bankName: true,
    bankBranchName: true,
    bankAccountNumber: true,
    bankIfscCode: true,
    reportingManagerL1Id: true,
    insuranceCompanyName: true,
    insurancePolicyNumber: true,
    insuranceValidFrom: true,
    insuranceValidTo: true,
    fatherName: true,
    fatherAge: true,
    fatherAadhaarNumber: true,
    motherName: true,
    motherAge: true,
    motherAadhaarNumber: true,
    wifeName: true,
    wifeAge: true,
    wifeAadhaarNumber: true,
    wifeBankAccountNumber: true,
    wifeIfscCode: true,
    wifeContactNumber: true,
    husbandName: true,
    husbandAge: true,
    husbandAadhaarNumber: true,
    husbandBankAccountNumber: true,
    husbandIfscCode: true,
    husbandContactNumber: true,
    weddingDate: true,
    children: true,
    orgRegionId: true,
    orgDivisionId: true,
    orgRegion: { select: { name: true } },
    orgDivision: { select: { name: true } },
    branch: { select: { name: true } },
    department: { select: { name: true } },
    designation: { select: { name: true } },
    shift: { select: { name: true } },
    reportingManagerL1: { select: { id: true, firstName: true, lastName: true } },
} as const;

type LiveUser = NonNullable<Awaited<ReturnType<typeof loadLiveUsers>>[number]>;

function loadLiveUsers(userIds: string[]) {
    return prisma.user.findMany({ where: { id: { in: userIds } }, select: LIVE_USER_SELECT });
}

/** Employee's current values, keyed by the onboarding request's field names. */
function liveFields(u: LiveUser) {
    return {
        employeeName: `${u.firstName} ${u.lastName}`.trim(),
        mobileNumber: u.mobileNumber,
        email: u.email,
        branchId: u.branchId,
        branch: u.branch,
        shiftId: u.shiftId,
        shift: u.shift,
        // Region / Division are placed on the employee at approval; once set, the employee's own
        // values win. Employees created before this existed keep what the request recorded.
        ...(u.orgRegionId ? { regionId: u.orgRegionId, region: u.orgRegion } : {}),
        ...(u.orgDivisionId ? { divisionId: u.orgDivisionId, division: u.orgDivision } : {}),
        departmentId: u.departmentId,
        department: u.department,
        designationId: u.designationId,
        designation: u.designation,
        dateOfJoining: u.dateOfJoining,
        educationQualification: u.education,
        currentAddress: u.address,
        permanentAddress: u.permanentAddress,
        dateOfBirth: u.dob,
        gender: u.gender,
        maritalStatus: u.maritalStatus,
        bloodGroup: u.bloodGroup,
        emergencyContactName: u.emergencyContactName,
        emergencyContactRelation: u.emergencyContactRelation,
        emergencyContactNumber: u.emergencyContactMobile,
        aadhaarNumber: u.aadhaarNumber,
        panNumber: u.panNumber,
        dlNumber: u.dlNumber,
        voterIdNumber: u.voterIdNumber,
        uanNumber: u.uanNumber,
        esiNumber: u.esiNumber,
        bankName: u.bankName,
        bankBranchName: u.bankBranchName,
        accountNumber: u.bankAccountNumber,
        ifscCode: u.bankIfscCode,
        reportingManagerId: u.reportingManagerL1Id,
        reportingManager: u.reportingManagerL1,
        insuranceCompanyName: u.insuranceCompanyName,
        insurancePolicyNumber: u.insurancePolicyNumber,
        insuranceValidFrom: u.insuranceValidFrom,
        insuranceValidTo: u.insuranceValidTo,
        fatherName: u.fatherName,
        fatherAge: u.fatherAge,
        fatherAadhaarNumber: u.fatherAadhaarNumber,
        motherName: u.motherName,
        motherAge: u.motherAge,
        motherAadhaarNumber: u.motherAadhaarNumber,
        wifeName: u.wifeName,
        wifeAge: u.wifeAge,
        wifeAadhaarNumber: u.wifeAadhaarNumber,
        wifeBankAccountNumber: u.wifeBankAccountNumber,
        wifeIfscCode: u.wifeIfscCode,
        wifeContactNumber: u.wifeContactNumber,
        husbandName: u.husbandName,
        husbandAge: u.husbandAge,
        husbandAadhaarNumber: u.husbandAadhaarNumber,
        husbandBankAccountNumber: u.husbandBankAccountNumber,
        husbandIfscCode: u.husbandIfscCode,
        husbandContactNumber: u.husbandContactNumber,
        weddingDate: u.weddingDate,
        children: u.children,
    };
}

/** Overlays each approved request (one with a createdUser) with its employee's current values. */
export async function withLiveEmployeeData<T extends { createdUser?: { id: string } | null }>(requests: T[]): Promise<T[]> {
    const userIds = Array.from(new Set(requests.map((r) => r.createdUser?.id).filter((id): id is string => !!id)));
    if (userIds.length === 0) return requests;
    const users = await loadLiveUsers(userIds);
    const byId = new Map(users.map((u) => [u.id, u]));
    return requests.map((r) => {
        const user = r.createdUser?.id ? byId.get(r.createdUser.id) : undefined;
        return user ? { ...r, ...liveFields(user) } : r;
    });
}
