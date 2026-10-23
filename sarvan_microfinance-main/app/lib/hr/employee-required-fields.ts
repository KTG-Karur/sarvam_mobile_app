// ============================================================
// EMPLOYEE MASTER — server-side required-field check
// app/lib/hr/employee-required-fields.ts
//
// The Employee Master form marks fields required from the same admin config as
// intake (/dashboard/admin/hr-onboarding-field-config), but only the browser
// enforced it — a direct PATCH could blank a required field. This is the
// server-side counterpart. It only looks at keys actually present in the
// payload, so a partial update (e.g. the Employee List's active toggle, which
// sends `isActive` alone) is never blocked by fields it doesn't touch.
// ============================================================

import { getInapplicableSpouseKeys } from '@/app/lib/hr/onboarding-form-fields';

/** Employee Master field key -> the config page's field key, where they differ. */
export const EMPLOYEE_TO_CONFIG_KEY: Record<string, string> = {
    dob: 'dateOfBirth',
    education: 'educationQualification',
    address: 'currentAddress',
    emergencyContactMobile: 'emergencyContactNumber',
    bankAccountNumber: 'accountNumber',
    bankIfscCode: 'ifscCode',
    reportingManagerL1Id: 'reportingManagerId',
};

// firstName/lastName are already min(1) in the schema; monthlyCtc is a number
// (0 is a legitimate stored value server-side, the form itself gates blank).
const NOT_CHECKED = new Set(['firstName', 'lastName', 'monthlyCtc', 'isActive', 'children', 'sameAsCurrentAddress']);

function isEmpty(value: unknown): boolean {
    if (value === null || value === undefined) return true;
    if (typeof value === 'string') return value.trim() === '';
    return false;
}

/**
 * Returns the config keys of every required field that this payload sets to
 * an empty value. `context` is the marital status/gender the record will have
 * after the update, so spouse fields the form hides are never demanded.
 */
export function findMissingRequiredEmployeeFields(
    payload: Record<string, unknown>,
    requiredConfigKeys: ReadonlySet<string>,
    context: { maritalStatus?: string | null; gender?: string | null }
): string[] {
    const notApplicable = getInapplicableSpouseKeys(context.maritalStatus, context.gender);
    const missing: string[] = [];
    for (const [key, value] of Object.entries(payload)) {
        if (NOT_CHECKED.has(key)) continue;
        const configKey = EMPLOYEE_TO_CONFIG_KEY[key] ?? key;
        if (!requiredConfigKeys.has(configKey)) continue;
        if (notApplicable.includes(configKey)) continue;
        if (isEmpty(value) && !missing.includes(configKey)) missing.push(configKey);
    }
    return missing;
}
