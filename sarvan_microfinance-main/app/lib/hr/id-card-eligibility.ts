// ============================================================
// ID CARD ELIGIBILITY — may this employee be issued an ID card?
// app/lib/hr/id-card-eligibility.ts
//
// An Employee ID is only a login/record key — it exists for staff created
// outside onboarding, staff with incomplete profiles and staff who have left,
// and it must (payroll, attendance and audit history all hang off it). The ID
// card is what proves current employment, so the card — not the ID — is gated:
// the employee must be currently employed and every field the card prints must
// be filled. Enforced server-side by both card APIs (app/lib/hr/id-card-data.ts),
// so preview, PDF and print can't be reached for an ineligible employee.
// ============================================================

import { deriveEmploymentStatus } from '@/app/lib/hr/employment-status';

/**
 * Onboarding field-config keys that feed a printed ID card field. Locked as
 * always-required in hr-onboarding-validation.service.ts, so an admin can't
 * switch one off and let a new joinee through onboarding without it.
 * (branchId is already hard-required at submit-for-approval.)
 */
export const ID_CARD_LOCKED_ONBOARDING_KEYS: ReadonlySet<string> = new Set([
    'employeeName',
    'bloodGroup',
    'emergencyContactNumber',
    'designationId',
    'dateOfJoining',
    'doc_KYC_PHOTO',
]);

/**
 * Code of the "To Be Assigned" Department/Designation seeded onto staff that
 * had none (scripts/seed-placeholder-department-designation.ts). It keeps forms
 * and required-field checks working until HR sets the real value, but is not a
 * real designation — so it must never be printed on a card.
 */
export const PLACEHOLDER_ORG_CODE = 'TBA';

export type IdCardIssueCode =
    | 'INACTIVE'
    | 'EXITED'
    | 'NO_EMPLOYEE_ID'
    | 'INVALID_EMPLOYEE_ID'
    | 'NO_NAME'
    | 'NO_DESIGNATION'
    | 'NO_BRANCH'
    | 'NO_DATE_OF_JOINING'
    | 'NO_BLOOD_GROUP'
    | 'NO_EMERGENCY_CONTACT'
    | 'NO_PHOTO';

export interface IdCardIssue {
    code: IdCardIssueCode;
    message: string;
}

export interface IdCardEligibilityInput {
    isActive: boolean;
    dateOfExit: Date | null;
    employeeId: string | null;
    fullName: string;
    designation: string | null;
    /** True when the designation is the seeded "To Be Assigned" placeholder. */
    designationIsPlaceholder?: boolean;
    branchName: string | null;
    dateOfJoining: Date | null;
    bloodGroup: string | null;
    emergencyContactMobile: string | null;
    /** Latest non-rejected photo key (see resolveEmployeePhotoKeys). */
    photoKey: string | null;
}

export type IdCardEligibility = { eligible: true; issues: [] } | { eligible: false; issues: IdCardIssue[] };

function isBlank(value: string | null | undefined): boolean {
    return !value || value.trim() === '';
}

export function evaluateIdCardEligibility(input: IdCardEligibilityInput, now: Date = new Date()): IdCardEligibility {
    const issues: IdCardIssue[] = [];

    const status = deriveEmploymentStatus(input.isActive, input.dateOfExit, now);
    if (status === 'EXITED') issues.push({ code: 'EXITED', message: 'Employee has exited the organisation' });
    else if (status === 'INACTIVE') issues.push({ code: 'INACTIVE', message: 'Employee record is inactive' });

    if (isBlank(input.employeeId)) issues.push({ code: 'NO_EMPLOYEE_ID', message: 'Employee ID not generated' });
    // The QR verification page trims the scanned ID, so "ST089 " would resolve to
    // a different person's "ST089" — never print a card for a malformed ID.
    else if (/\s/.test(input.employeeId!)) {
        issues.push({ code: 'INVALID_EMPLOYEE_ID', message: 'Employee ID contains spaces or tabs — correct it first' });
    }
    if (isBlank(input.fullName)) issues.push({ code: 'NO_NAME', message: 'Name missing' });
    if (isBlank(input.designation)) issues.push({ code: 'NO_DESIGNATION', message: 'Designation missing' });
    else if (input.designationIsPlaceholder) {
        issues.push({ code: 'NO_DESIGNATION', message: 'Designation not assigned yet ("To Be Assigned")' });
    }
    if (isBlank(input.branchName)) issues.push({ code: 'NO_BRANCH', message: 'Branch missing' });
    if (!input.dateOfJoining) issues.push({ code: 'NO_DATE_OF_JOINING', message: 'Date of joining missing' });
    if (isBlank(input.bloodGroup)) issues.push({ code: 'NO_BLOOD_GROUP', message: 'Blood group missing' });
    if (isBlank(input.emergencyContactMobile)) {
        issues.push({ code: 'NO_EMERGENCY_CONTACT', message: 'Emergency contact number missing' });
    }
    if (isBlank(input.photoKey)) issues.push({ code: 'NO_PHOTO', message: 'Photo missing or rejected' });

    return issues.length === 0 ? { eligible: true, issues: [] } : { eligible: false, issues };
}

/**
 * Coarse status for list badges: ELIGIBLE, NOT_EMPLOYED (inactive/exited — no
 * amount of data entry makes them eligible) or INCOMPLETE (fixable details).
 */
export type IdCardStatus = 'ELIGIBLE' | 'INCOMPLETE' | 'NOT_EMPLOYED';

export function summarizeIdCardStatus(eligibility: IdCardEligibility): IdCardStatus {
    if (eligibility.eligible) return 'ELIGIBLE';
    return eligibility.issues.some((i) => i.code === 'INACTIVE' || i.code === 'EXITED') ? 'NOT_EMPLOYED' : 'INCOMPLETE';
}

/** One-line summary for API error messages, e.g. "Blood group missing, Photo missing or rejected". */
export function formatIdCardIssues(issues: IdCardIssue[]): string {
    return issues.map((i) => i.message).join(', ');
}
