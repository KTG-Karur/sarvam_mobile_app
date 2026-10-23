// Response shape of GET /api/public/verify-employee/[employeeId] — the ID card
// QR verification endpoint. Shared by the route and the public verify page.

/**
 * ACTIVE   — isActive and no exit date in the past (still employed on the last working day)
 * INACTIVE — User.isActive is false, no past exit date
 * EXITED   — dateOfExit is before today (IST), regardless of isActive
 * NOT_FOUND — no record, or the scanned ID is malformed
 */
export type EmploymentStatus = 'ACTIVE' | 'INACTIVE' | 'EXITED' | 'NOT_FOUND';

/** Fields anyone who scans the card may see. Null = not recorded. */
export interface PublicEmployeeDetails {
    employeeId: string;
    fullName: string;
    designation: string | null;
    department: string | null;
    branchName: string | null;
    branchCode: string | null;
    /** Office address of the branch — not the employee's residence. */
    branchAddress: string | null;
    dateOfJoining: string | null;
    dateOfExit: string | null;
    /** Short-lived signed URL. */
    photoUrl: string | null;
}

/** Only for a signed-in viewer allowed to see this employee's HR record. */
export interface InternalEmployeeDetails {
    gender: string | null;
    bloodGroup: string | null;
    grade: number | null;
    confirmationDate: string | null;
    shift: string | null;
    reportingManager: { name: string | null; employeeId: string | null; designation: string | null } | null;
    email: string | null;
    mobileNumber: string | null;
}

export interface EmployeeVerificationResult {
    status: EmploymentStatus;
    checkedAt: string;
    employee: PublicEmployeeDetails | null;
    internal: InternalEmployeeDetails | null;
}
