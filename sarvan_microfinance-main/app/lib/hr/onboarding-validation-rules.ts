// ============================================================
// ONBOARDING VALIDATION RULES & INPUT HELPERS
// app/lib/hr/onboarding-validation-rules.ts
//
// Single shared validation authority for HR Employee Onboarding forms.
// Aligned with app/lib/validations/field-validations.ts and consumed by:
// 1. Client-side form UX (OnboardingRequestForm, OnboardingQueueClient, Public page)
// 2. Server-side Zod validation (app/lib/hr/onboarding-form-fields.ts)
// ============================================================

import type { OnboardingFormValues, SectionId } from '@/components/hr/OnboardingRequestForm';
import {
    FIELD_PATTERNS,
    FIELD_ERROR_MESSAGES,
    getInapplicableSpouseKeys,
    CONFIGURABLE_ONBOARDING_FIELD_KEYS,
    CHILD_FIELD_CONFIG_KEYS,
    type ChildFieldName,
} from '@/app/lib/hr/onboarding-form-fields';

import { HR_ONBOARDING_FIELDS } from '@/app/lib/hr/onboarding-field-definitions';

export { FIELD_PATTERNS, FIELD_ERROR_MESSAGES };

export const FIELD_LABELS: Record<string, string> = Object.fromEntries(
    HR_ONBOARDING_FIELDS.map((f) => [f.fieldKey, f.fieldLabel])
);

export const SECTION_LABELS: Record<SectionId, string> = {
    personal: 'Personal Details',
    address: 'Address Details',
    identity: 'Identity & Statutory',
    bank: 'Bank Details',
    insurance: 'Vehicle Insurance',
    family: 'Family Details',
    documents: 'Documents',
};

/**
 * Returns human-readable label for any onboarding field key (including child array items).
 */
export function getFieldLabel(fieldKey: string): string {
    if (FIELD_LABELS[fieldKey]) {
        return FIELD_LABELS[fieldKey];
    }
    if (fieldKey.startsWith('children.')) {
        const parts = fieldKey.split('.');
        const idx = parseInt(parts[1], 10);
        const childField = parts[2];
        const num = !isNaN(idx) ? ` ${idx + 1}` : '';
        if (childField === 'aadhaarNumber') return `Child${num} Aadhaar Number`;
        if (childField === 'age') return `Child${num} Age`;
        if (childField === 'gender') return `Child${num} Gender`;
        return `Child${num} Details`;
    }
    // Fallback: convert camelCase to Title Case
    return fieldKey
        .replace(/([A-Z])/g, ' $1')
        .replace(/^./, (str) => str.toUpperCase())
        .trim();
}

export interface SectionErrorGroup {
    sectionId: SectionId;
    sectionLabel: string;
    errors: {
        fieldKey: string;
        fieldLabel: string;
        message: string;
    }[];
}

/**
 * Groups a flat dictionary of field errors by their section in form tab order.
 */
export function groupErrorsBySection(errors: Record<string, string>): SectionErrorGroup[] {
    const sectionOrder: SectionId[] = ['personal', 'address', 'identity', 'bank', 'insurance', 'family', 'documents'];
    const groupsMap = new Map<SectionId, { fieldKey: string; fieldLabel: string; message: string }[]>();

    for (const [key, message] of Object.entries(errors)) {
        if (!message) continue;
        const sectionId = getSectionForField(key) || 'personal';
        if (!groupsMap.has(sectionId)) {
            groupsMap.set(sectionId, []);
        }
        groupsMap.get(sectionId)!.push({
            fieldKey: key,
            fieldLabel: getFieldLabel(key),
            message,
        });
    }

    const result: SectionErrorGroup[] = [];
    for (const sid of sectionOrder) {
        const items = groupsMap.get(sid);
        if (items && items.length > 0) {
            result.push({
                sectionId: sid,
                sectionLabel: SECTION_LABELS[sid] || sid,
                errors: items,
            });
        }
    }
    return result;
}

/**
 * Filter string input to digits only, optionally slicing to maxLength.
 */
export function filterDigits(value: string, maxLength?: number): string {
    const cleaned = value.replace(/\D/g, '');
    return maxLength && cleaned.length > maxLength ? cleaned.slice(0, maxLength) : cleaned;
}

/**
 * Filter string input to uppercase, optionally slicing to maxLength.
 */
export function filterUppercase(value: string, maxLength?: number): string {
    const upper = value.toUpperCase();
    return maxLength && upper.length > maxLength ? upper.slice(0, maxLength) : upper;
}

/**
 * Determines whether a field is currently visible and applicable based on maritalStatus and gender.
 * Hidden fields are strictly excluded from validation.
 */
export function isFieldApplicable(
    fieldKey: string,
    maritalStatus?: string | null,
    gender?: string | null
): boolean {
    if (fieldKey === 'children') return maritalStatus === 'MARRIED';
    return !getInapplicableSpouseKeys(maritalStatus, gender).includes(fieldKey);
}

/**
 * Validate age in years (must be at least 18 and at most 100).
 */
export function validateDateOfBirth(dobString: string): string | null {
    if (!dobString || dobString.trim() === '') return null;
    const dob = new Date(dobString);
    if (Number.isNaN(dob.getTime())) {
        return FIELD_ERROR_MESSAGES.DOB_INVALID;
    }
    const today = new Date();
    if (dob > today) {
        return FIELD_ERROR_MESSAGES.DOB_INVALID;
    }
    let age = today.getFullYear() - dob.getFullYear();
    const m = today.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) {
        age--;
    }
    if (age < 18) {
        return FIELD_ERROR_MESSAGES.DOB_MIN_AGE;
    }
    if (age > 100) {
        return FIELD_ERROR_MESSAGES.DOB_INVALID;
    }
    return null;
}

/**
 * Validate insurance date range.
 */
export function validateInsuranceDates(fromStr?: string, toStr?: string): string | null {
    if (!fromStr || !toStr || fromStr.trim() === '' || toStr.trim() === '') return null;
    const from = new Date(fromStr);
    const to = new Date(toStr);
    if (!Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime())) {
        if (to < from) {
            return FIELD_ERROR_MESSAGES.INSURANCE_DATES;
        }
    }
    return null;
}

/**
 * Validates a single field's value.
 * Returns null if valid, or an error message string if invalid.
 */
export function validateSingleField(
    field: keyof OnboardingFormValues,
    value: unknown,
    values: OnboardingFormValues,
    isRequired: boolean
): string | null {
    if (!isFieldApplicable(field, values.maritalStatus, values.gender)) {
        return null;
    }

    const strVal = typeof value === 'string' ? value.trim() : '';
    const isEmpty = strVal === '';

    if (isRequired && isEmpty) {
        return FIELD_ERROR_MESSAGES.REQUIRED;
    }

    if (isEmpty) {
        return null;
    }

    switch (field) {
        case 'mobileNumber':
            return FIELD_PATTERNS.MOBILE.test(strVal) ? null : FIELD_ERROR_MESSAGES.MOBILE;

        case 'emergencyContactNumber':
            return FIELD_PATTERNS.MOBILE.test(strVal) ? null : FIELD_ERROR_MESSAGES.EMERGENCY_MOBILE;

        case 'email':
            return FIELD_PATTERNS.EMAIL.test(strVal) ? null : FIELD_ERROR_MESSAGES.EMAIL;

        case 'dateOfBirth':
            return validateDateOfBirth(strVal);

        case 'aadhaarNumber':
            return FIELD_PATTERNS.AADHAAR.test(strVal) ? null : FIELD_ERROR_MESSAGES.AADHAAR;

        case 'panNumber':
            return FIELD_PATTERNS.PAN.test(strVal.toUpperCase()) ? null : FIELD_ERROR_MESSAGES.PAN;

        case 'uanNumber':
            return FIELD_PATTERNS.UAN.test(strVal) ? null : FIELD_ERROR_MESSAGES.UAN;

        case 'esiNumber':
            return FIELD_PATTERNS.ESI.test(strVal) ? null : FIELD_ERROR_MESSAGES.ESI;

        case 'accountNumber':
            return FIELD_PATTERNS.BANK_ACCOUNT.test(strVal) ? null : FIELD_ERROR_MESSAGES.BANK_ACCOUNT;

        case 'ifscCode':
            return FIELD_PATTERNS.IFSC.test(strVal.toUpperCase()) ? null : FIELD_ERROR_MESSAGES.IFSC;

        case 'fatherAadhaarNumber':
            return FIELD_PATTERNS.AADHAAR.test(strVal) ? null : FIELD_ERROR_MESSAGES.FATHER_AADHAAR;

        case 'motherAadhaarNumber':
            return FIELD_PATTERNS.AADHAAR.test(strVal) ? null : FIELD_ERROR_MESSAGES.MOTHER_AADHAAR;

        case 'wifeAadhaarNumber':
        case 'husbandAadhaarNumber':
            return FIELD_PATTERNS.AADHAAR.test(strVal) ? null : FIELD_ERROR_MESSAGES.SPOUSE_AADHAAR;

        case 'wifeContactNumber':
        case 'husbandContactNumber':
            return FIELD_PATTERNS.MOBILE.test(strVal) ? null : FIELD_ERROR_MESSAGES.SPOUSE_CONTACT;

        case 'wifeBankAccountNumber':
        case 'husbandBankAccountNumber':
            return FIELD_PATTERNS.BANK_ACCOUNT.test(strVal) ? null : FIELD_ERROR_MESSAGES.SPOUSE_BANK;

        case 'wifeIfscCode':
        case 'husbandIfscCode':
            return FIELD_PATTERNS.IFSC.test(strVal.toUpperCase()) ? null : FIELD_ERROR_MESSAGES.SPOUSE_IFSC;

        case 'insuranceValidTo':
            return validateInsuranceDates(values.insuranceValidFrom, strVal);

        default:
            return null;
    }
}

/**
 * Validates an entire onboarding form.
 *
 * @param values Current form state
 * @param isRequiredFn Predicate returning whether a fieldKey is required
 * @param forFinalize If true (submit/create), checks required emptiness + format.
 *                    If false (draft saving), skips empty fields and only checks format of entered text.
 */
export function validateOnboardingForm(
    values: OnboardingFormValues,
    isRequiredFn: (fieldKey: string) => boolean,
    forFinalize: boolean
): Record<string, string> {
    const errors: Record<string, string> = {};

    // Only the fields this form actually collects — NOT
    // branchId/designationId/departmentId/reportingManagerId/dateOfJoining.
    // Those are Organization fields the admin fills in later, in the
    // "Finalize Employee Details" panel at final approval (a separate check
    // there — see missingFinalizeFields in OnboardingQueueClient.tsx). Using
    // Object.keys(values) here used to include them too: since the intake
    // form renders no input for them, they stayed permanently empty, and once
    // the admin marked them Required (the seeded default), "Create Request"
    // could never succeed at all — blocked on fields nobody could fill in yet.
    for (const key of CONFIGURABLE_ONBOARDING_FIELD_KEYS) {
        const isReq = forFinalize && isRequiredFn(key);
        const err = validateSingleField(key, values[key], values, isReq);
        if (err) {
            errors[key] = err;
        }
    }

    // Also check insurance date range cross-field
    if (values.insuranceValidFrom && values.insuranceValidTo) {
        const dateErr = validateInsuranceDates(values.insuranceValidFrom, values.insuranceValidTo);
        if (dateErr && !errors.insuranceValidTo) {
            errors.insuranceValidTo = dateErr;
        }
    }

    // Children validation (if applicable)
    if (isFieldApplicable('children', values.maritalStatus, values.gender) && values.children) {
        for (let i = 0; i < values.children.length; i++) {
            const child = values.children[i];
            if (forFinalize) {
                // Admin-configured per-row requiredness (Child Gender/Age/Aadhaar).
                for (const field of Object.keys(CHILD_FIELD_CONFIG_KEYS) as ChildFieldName[]) {
                    if (isRequiredFn(CHILD_FIELD_CONFIG_KEYS[field]) && String(child[field] ?? '').trim() === '') {
                        errors[`children.${i}.${field}`] = FIELD_ERROR_MESSAGES.REQUIRED;
                    }
                }
            }
            if (child.aadhaarNumber && child.aadhaarNumber.trim() !== '') {
                if (!FIELD_PATTERNS.AADHAAR.test(child.aadhaarNumber.trim())) {
                    errors[`children.${i}.aadhaarNumber`] = FIELD_ERROR_MESSAGES.CHILD_AADHAAR;
                }
            }
        }
    }

    return errors;
}

/**
 * Drops the `children.N.<field>` error for any child field that was just
 * edited (or whose row no longer exists), so the red state clears the moment
 * the value is corrected — the same behaviour Employee Master already has.
 * Returns the same object when nothing changed so callers can skip a re-render.
 */
export function clearChildAadhaarErrors(
    errors: Record<string, string>,
    previous: Partial<Record<ChildFieldName, string>>[],
    next: Partial<Record<ChildFieldName, string>>[]
): Record<string, string> {
    let changed = false;
    const result = { ...errors };
    for (const key of Object.keys(errors)) {
        const match = /^children\.(\d+)\.(gender|age|aadhaarNumber)$/.exec(key);
        if (!match) continue;
        const index = Number(match[1]);
        const field = match[2] as ChildFieldName;
        if (index >= next.length || previous[index]?.[field] !== next[index][field]) {
            delete result[key];
            changed = true;
        }
    }
    return changed ? result : errors;
}

/**
 * Map an OnboardingFormValues field key to its containing SectionId.
 */
export function getSectionForField(field: keyof OnboardingFormValues | string): SectionId | null {
    if (field.startsWith('children.')) return 'family';

    const personalKeys = ['employeeName', 'mobileNumber', 'email', 'dateOfBirth', 'gender', 'maritalStatus', 'bloodGroup', 'educationQualification'];
    const addressKeys = ['currentAddress', 'permanentAddress', 'emergencyContactName', 'emergencyContactRelation', 'emergencyContactNumber'];
    const identityKeys = ['aadhaarNumber', 'panNumber', 'dlNumber', 'voterIdNumber', 'uanNumber', 'esiNumber'];
    const bankKeys = ['bankName', 'bankBranchName', 'accountNumber', 'ifscCode'];
    const insuranceKeys = ['insuranceCompanyName', 'insurancePolicyNumber', 'insuranceValidFrom', 'insuranceValidTo'];
    const familyKeys = [
        'fatherName', 'fatherAge', 'fatherAadhaarNumber',
        'motherName', 'motherAge', 'motherAadhaarNumber',
        'wifeName', 'wifeAge', 'wifeAadhaarNumber', 'wifeBankAccountNumber', 'wifeIfscCode', 'wifeContactNumber',
        'husbandName', 'husbandAge', 'husbandAadhaarNumber', 'husbandBankAccountNumber', 'husbandIfscCode', 'husbandContactNumber',
        'weddingDate', 'children'
    ];

    if (personalKeys.includes(field)) return 'personal';
    if (addressKeys.includes(field)) return 'address';
    if (identityKeys.includes(field)) return 'identity';
    if (bankKeys.includes(field)) return 'bank';
    if (insuranceKeys.includes(field)) return 'insurance';
    if (familyKeys.includes(field)) return 'family';
    return null;
}

/**
 * Mapping of Employee Master (and Prisma User) field names to Onboarding field keys.
 */
export const EMPLOYEE_TO_ONBOARDING_FIELD_MAP: Record<string, keyof OnboardingFormValues> = {
    mobileNumber: 'mobileNumber',
    email: 'email',
    dob: 'dateOfBirth',
    aadhaarNumber: 'aadhaarNumber',
    panNumber: 'panNumber',
    uanNumber: 'uanNumber',
    esiNumber: 'esiNumber',
    bankName: 'bankName',
    bankBranchName: 'bankBranchName',
    bankAccountNumber: 'accountNumber',
    bankIfscCode: 'ifscCode',
    emergencyContactRelation: 'emergencyContactRelation',
    emergencyContactMobile: 'emergencyContactNumber',
    fatherAadhaarNumber: 'fatherAadhaarNumber',
    motherAadhaarNumber: 'motherAadhaarNumber',
    wifeAadhaarNumber: 'wifeAadhaarNumber',
    wifeBankAccountNumber: 'wifeBankAccountNumber',
    wifeIfscCode: 'wifeIfscCode',
    wifeContactNumber: 'wifeContactNumber',
    husbandAadhaarNumber: 'husbandAadhaarNumber',
    husbandBankAccountNumber: 'husbandBankAccountNumber',
    husbandIfscCode: 'husbandIfscCode',
    husbandContactNumber: 'husbandContactNumber',
    insuranceValidTo: 'insuranceValidTo',
    pfNumber: 'uanNumber',
};

/**
 * Input filtering constraints for employee / onboarding form inputs.
 */
export const EMPLOYEE_FIELD_INPUT_CONFIG: Record<string, { digitsOnly?: boolean; uppercase?: boolean; maxLength?: number }> = {
    mobileNumber: { digitsOnly: true, maxLength: 10 },
    emergencyContactMobile: { digitsOnly: true, maxLength: 10 },
    emergencyContactNumber: { digitsOnly: true, maxLength: 10 },
    aadhaarNumber: { digitsOnly: true, maxLength: 12 },
    fatherAadhaarNumber: { digitsOnly: true, maxLength: 12 },
    motherAadhaarNumber: { digitsOnly: true, maxLength: 12 },
    wifeAadhaarNumber: { digitsOnly: true, maxLength: 12 },
    husbandAadhaarNumber: { digitsOnly: true, maxLength: 12 },
    panNumber: { uppercase: true, maxLength: 10 },
    uanNumber: { digitsOnly: true, maxLength: 12 },
    pfNumber: { digitsOnly: true, maxLength: 12 },
    esiNumber: { digitsOnly: true, maxLength: 17 },
    bankAccountNumber: { digitsOnly: true, maxLength: 18 },
    accountNumber: { digitsOnly: true, maxLength: 18 },
    bankIfscCode: { uppercase: true, maxLength: 11 },
    ifscCode: { uppercase: true, maxLength: 11 },
    wifeContactNumber: { digitsOnly: true, maxLength: 10 },
    husbandContactNumber: { digitsOnly: true, maxLength: 10 },
    wifeBankAccountNumber: { digitsOnly: true, maxLength: 18 },
    husbandBankAccountNumber: { digitsOnly: true, maxLength: 18 },
    wifeIfscCode: { uppercase: true, maxLength: 11 },
    husbandIfscCode: { uppercase: true, maxLength: 11 },
};

/**
 * Maps employee master fields to their containing tab in EmployeeMasterForm.
 */
export type EmployeeMasterTabId = 'personal' | 'address' | 'identity' | 'bank' | 'insurance' | 'family' | 'organization';

export const EMPLOYEE_FIELD_TAB_MAP: Record<string, EmployeeMasterTabId> = {
    firstName: 'personal',
    lastName: 'personal',
    mobileNumber: 'personal',
    email: 'personal',
    dob: 'personal',
    gender: 'personal',
    maritalStatus: 'personal',
    bloodGroup: 'personal',
    education: 'personal',
    address: 'address',
    permanentAddress: 'address',
    emergencyContactName: 'address',
    emergencyContactRelation: 'address',
    emergencyContactMobile: 'address',
    aadhaarNumber: 'identity',
    panNumber: 'identity',
    dlNumber: 'identity',
    voterIdNumber: 'identity',
    uanNumber: 'identity',
    esiNumber: 'identity',
    pfNumber: 'identity',
    bankName: 'bank',
    bankBranchName: 'bank',
    bankAccountNumber: 'bank',
    bankIfscCode: 'bank',
    insuranceCompanyName: 'insurance',
    insurancePolicyNumber: 'insurance',
    insuranceValidFrom: 'insurance',
    insuranceValidTo: 'insurance',
    fatherName: 'family',
    fatherAge: 'family',
    fatherAadhaarNumber: 'family',
    motherName: 'family',
    motherAge: 'family',
    motherAadhaarNumber: 'family',
    wifeName: 'family',
    wifeAge: 'family',
    wifeAadhaarNumber: 'family',
    wifeBankAccountNumber: 'family',
    wifeIfscCode: 'family',
    wifeContactNumber: 'family',
    husbandName: 'family',
    husbandAge: 'family',
    husbandAadhaarNumber: 'family',
    husbandBankAccountNumber: 'family',
    husbandIfscCode: 'family',
    husbandContactNumber: 'family',
    weddingDate: 'family',
    departmentId: 'organization',
    designationId: 'organization',
    reportingManagerL1Id: 'organization',
    reportingManagerL2Id: 'organization',
    reportingManagerL3Id: 'organization',
    dateOfJoining: 'organization',
    monthlyCtc: 'organization',
};

/**
 * Universal field validator for employee records (works with both onboarding and employee master keys).
 */
export function validateEmployeeField(
    fieldKey: string,
    value: unknown,
    context?: {
        maritalStatus?: string | null;
        gender?: string | null;
        insuranceValidFrom?: string | null;
        isRequired?: boolean;
    }
): string | null {
    const canonicalKey = EMPLOYEE_TO_ONBOARDING_FIELD_MAP[fieldKey] || (fieldKey as keyof OnboardingFormValues);

    if (!isFieldApplicable(canonicalKey, context?.maritalStatus, context?.gender)) {
        return null;
    }

    const strVal = typeof value === 'string' ? value.trim() : (value != null ? String(value).trim() : '');
    const isEmpty = strVal === '';

    if (context?.isRequired && isEmpty) {
        return FIELD_ERROR_MESSAGES.REQUIRED;
    }

    if (isEmpty) {
        return null;
    }

    switch (canonicalKey) {
        case 'mobileNumber':
            return FIELD_PATTERNS.MOBILE.test(strVal) ? null : FIELD_ERROR_MESSAGES.MOBILE;

        case 'emergencyContactNumber':
            return FIELD_PATTERNS.MOBILE.test(strVal) ? null : FIELD_ERROR_MESSAGES.EMERGENCY_MOBILE;

        case 'email':
            return FIELD_PATTERNS.EMAIL.test(strVal) ? null : FIELD_ERROR_MESSAGES.EMAIL;

        case 'dateOfBirth':
            return validateDateOfBirth(strVal);

        case 'aadhaarNumber':
            return FIELD_PATTERNS.AADHAAR.test(strVal) ? null : FIELD_ERROR_MESSAGES.AADHAAR;

        case 'panNumber':
            return FIELD_PATTERNS.PAN.test(strVal.toUpperCase()) ? null : FIELD_ERROR_MESSAGES.PAN;

        case 'uanNumber':
            return FIELD_PATTERNS.UAN.test(strVal) ? null : FIELD_ERROR_MESSAGES.UAN;

        case 'esiNumber':
            return FIELD_PATTERNS.ESI.test(strVal) ? null : FIELD_ERROR_MESSAGES.ESI;

        case 'accountNumber':
            return FIELD_PATTERNS.BANK_ACCOUNT.test(strVal) ? null : FIELD_ERROR_MESSAGES.BANK_ACCOUNT;

        case 'ifscCode':
            return FIELD_PATTERNS.IFSC.test(strVal.toUpperCase()) ? null : FIELD_ERROR_MESSAGES.IFSC;

        case 'fatherAadhaarNumber':
            return FIELD_PATTERNS.AADHAAR.test(strVal) ? null : FIELD_ERROR_MESSAGES.FATHER_AADHAAR;

        case 'motherAadhaarNumber':
            return FIELD_PATTERNS.AADHAAR.test(strVal) ? null : FIELD_ERROR_MESSAGES.MOTHER_AADHAAR;

        case 'wifeAadhaarNumber':
        case 'husbandAadhaarNumber':
            return FIELD_PATTERNS.AADHAAR.test(strVal) ? null : FIELD_ERROR_MESSAGES.SPOUSE_AADHAAR;

        case 'wifeContactNumber':
        case 'husbandContactNumber':
            return FIELD_PATTERNS.MOBILE.test(strVal) ? null : FIELD_ERROR_MESSAGES.SPOUSE_CONTACT;

        case 'wifeBankAccountNumber':
        case 'husbandBankAccountNumber':
            return FIELD_PATTERNS.BANK_ACCOUNT.test(strVal) ? null : FIELD_ERROR_MESSAGES.SPOUSE_BANK;

        case 'wifeIfscCode':
        case 'husbandIfscCode':
            return FIELD_PATTERNS.IFSC.test(strVal.toUpperCase()) ? null : FIELD_ERROR_MESSAGES.SPOUSE_IFSC;

        case 'insuranceValidTo':
            return validateInsuranceDates(context?.insuranceValidFrom || undefined, strVal);

        default:
            return null;
    }
}

