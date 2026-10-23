// ============================================================
// ONBOARDING FORM FIELDS — shared Zod shape & server rules
// app/lib/hr/onboarding-form-fields.ts
//
// Every field from the "Employee Profile Details" reference form, all
// optional/nullable here — the three call sites (create, PATCH-update, and
// the public link's submit) each layer their own requiredness on top rather
// than duplicating the ~35-field list three times over.
// ============================================================

import { z } from 'zod';
import { Prisma } from '@prisma/client';

export const FIELD_PATTERNS = {
    // Mobile number: exact 10 digits
    MOBILE: /^\d{10}$/,
    // PAN card: 5 uppercase letters, 4 digits, 1 uppercase letter
    PAN: /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/,
    // Aadhaar: exact 12 digits
    AADHAAR: /^\d{12}$/,
    // IFSC code: 4 uppercase letters, 0, then 6 alphanumeric
    IFSC: /^[A-Z]{4}0[A-Z0-9]{6}$/,
    // Bank account: 9 to 18 digits
    BANK_ACCOUNT: /^\d{9,18}$/,
    // UAN: exact 12 digits
    UAN: /^\d{12}$/,
    // ESI: exact 17 digits
    ESI: /^\d{17}$/,
    // Email standard
    EMAIL: /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
};

export const FIELD_ERROR_MESSAGES = {
    REQUIRED: 'This field is required',
    MOBILE: 'Mobile number must contain exactly 10 digits.',
    EMERGENCY_MOBILE: 'Emergency contact number must contain exactly 10 digits.',
    AADHAAR: 'Aadhaar number must contain exactly 12 digits.',
    PAN: 'Enter a valid PAN number.',
    IFSC: 'IFSC code must contain 11 characters in the format ABCD0123456.',
    BANK_ACCOUNT: 'Bank account number must contain 9–18 digits.',
    UAN: 'UAN must contain exactly 12 digits.',
    ESI: 'ESI number must contain exactly 17 digits.',
    EMAIL: 'Please enter a valid email address',
    DOB_MIN_AGE: 'Employee must be at least 18 years old.',
    DOB_INVALID: 'Please enter a valid date of birth in the past',
    INSURANCE_DATES: 'Valid To date cannot be earlier than Valid From date.',
    FATHER_AADHAAR: 'Father Aadhaar number must contain exactly 12 digits.',
    MOTHER_AADHAAR: 'Mother Aadhaar number must contain exactly 12 digits.',
    SPOUSE_AADHAAR: 'Spouse Aadhaar number must contain exactly 12 digits.',
    SPOUSE_CONTACT: 'Spouse contact number must contain exactly 10 digits.',
    SPOUSE_BANK: 'Spouse bank account number must contain 9–18 digits.',
    SPOUSE_IFSC: 'Spouse IFSC code must contain 11 characters in the format ABCD0123456.',
    CHILD_AADHAAR: 'Child Aadhaar number must contain exactly 12 digits.',
};

// The form always sends a plain string per field ('' for "not filled in
// yet"), never omits a key or sends null — so `.optional()` alone never
// actually triggers, and a stricter check underneath (.min(1), .regex,
// .email, z.coerce.date/number) rejects the empty string outright. This is
// exactly what broke Save Draft: with per-field requiredness now enforced
// dynamically via HrOnboardingFieldConfig (not by this schema), a partially
// filled draft must be able to save with any field still blank.
const emptyToUndefined = (val: unknown) => (val === '' ? undefined : val);
function optional<T extends z.ZodTypeAny>(schema: T) {
    return z.preprocess(emptyToUndefined, schema.optional().nullable());
}

export const childSchema = z.object({
    gender: optional(z.string()),
    age: optional(z.coerce.number().int().min(0).max(120)),
    aadhaarNumber: optional(z.string().regex(FIELD_PATTERNS.AADHAAR, FIELD_ERROR_MESSAGES.CHILD_AADHAAR)),
});

export const onboardingFormFieldsSchema = z.object({
    employeeName: optional(z.string()),
    branchId: optional(z.string()),
    regionId: optional(z.string()),
    divisionId: optional(z.string()),
    shiftId: optional(z.string()),
    designationId: optional(z.string()),
    departmentId: optional(z.string()),
    educationQualification: optional(z.string()),
    mobileNumber: optional(z.string().regex(FIELD_PATTERNS.MOBILE, FIELD_ERROR_MESSAGES.MOBILE)),
    email: optional(z.string().email(FIELD_ERROR_MESSAGES.EMAIL)),
    currentAddress: optional(z.string()),
    permanentAddress: optional(z.string()),
    dateOfBirth: optional(z.coerce.date()),
    gender: optional(z.string()),
    maritalStatus: optional(z.string()),
    emergencyContactName: optional(z.string()),
    emergencyContactRelation: optional(z.string()),
    emergencyContactNumber: optional(z.string().regex(FIELD_PATTERNS.MOBILE, FIELD_ERROR_MESSAGES.EMERGENCY_MOBILE)),
    bloodGroup: optional(z.string()),
    aadhaarNumber: optional(z.string().regex(FIELD_PATTERNS.AADHAAR, FIELD_ERROR_MESSAGES.AADHAAR)),
    panNumber: optional(z.string().regex(FIELD_PATTERNS.PAN, FIELD_ERROR_MESSAGES.PAN)),
    dlNumber: optional(z.string()),
    voterIdNumber: optional(z.string()),
    uanNumber: optional(z.string().regex(FIELD_PATTERNS.UAN, FIELD_ERROR_MESSAGES.UAN)),
    esiNumber: optional(z.string().regex(FIELD_PATTERNS.ESI, FIELD_ERROR_MESSAGES.ESI)),
    bankName: optional(z.string()),
    bankBranchName: optional(z.string()),
    accountNumber: optional(z.string().regex(FIELD_PATTERNS.BANK_ACCOUNT, FIELD_ERROR_MESSAGES.BANK_ACCOUNT)),
    ifscCode: optional(z.string().regex(FIELD_PATTERNS.IFSC, FIELD_ERROR_MESSAGES.IFSC)),
    reportingManagerId: optional(z.string()),
    dateOfJoining: optional(z.coerce.date()),
    insuranceCompanyName: optional(z.string()),
    insurancePolicyNumber: optional(z.string()),
    insuranceValidFrom: optional(z.coerce.date()),
    insuranceValidTo: optional(z.coerce.date()),
    // ── Family Details ──
    fatherName: optional(z.string()),
    fatherAge: optional(z.coerce.number().int().min(0).max(120)),
    fatherAadhaarNumber: optional(z.string().regex(FIELD_PATTERNS.AADHAAR, FIELD_ERROR_MESSAGES.FATHER_AADHAAR)),
    motherName: optional(z.string()),
    motherAge: optional(z.coerce.number().int().min(0).max(120)),
    motherAadhaarNumber: optional(z.string().regex(FIELD_PATTERNS.AADHAAR, FIELD_ERROR_MESSAGES.MOTHER_AADHAAR)),
    // Conditional spouse fields: held as optional strings here so hidden fields
    // never block saving if inactive. Strict format checking is enforced conditionally
    // via validateOnboardingServerRules.
    wifeName: optional(z.string()),
    wifeAge: optional(z.coerce.number().int().min(0).max(120)),
    wifeAadhaarNumber: optional(z.string()),
    wifeBankAccountNumber: optional(z.string()),
    wifeIfscCode: optional(z.string()),
    wifeContactNumber: optional(z.string()),
    husbandName: optional(z.string()),
    husbandAge: optional(z.coerce.number().int().min(0).max(120)),
    husbandAadhaarNumber: optional(z.string()),
    husbandBankAccountNumber: optional(z.string()),
    husbandIfscCode: optional(z.string()),
    husbandContactNumber: optional(z.string()),
    weddingDate: optional(z.coerce.date()),
    children: z.array(childSchema).optional().nullable(),
});

export type OnboardingFormFields = z.infer<typeof onboardingFormFieldsSchema>;
export type OnboardingChild = z.infer<typeof childSchema>;

/**
 * Wife/Husband details + Wedding Date + Children only apply while currently
 * married — SINGLE, DIVORCED, and WIDOWED applicants never fill these (a
 * divorce/widowhood ends the marriage, so these fields are treated the same
 * as never having been married). Server routes that enforce
 * HrOnboardingFieldConfig's required-toggle on these keys must skip them for
 * any UNMARRIED_STATUSES request, mirroring the same exclusion the form
 * itself applies.
 */
export const UNMARRIED_STATUSES = ['SINGLE', 'DIVORCED', 'WIDOWED'] as const;

export const GENDER_OPTIONS = [
    { id: 'MALE', label: 'Male' },
    { id: 'FEMALE', label: 'Female' },
    { id: 'OTHER', label: 'Other' },
];

export const MARITAL_STATUS_OPTIONS = [
    { id: 'SINGLE', label: 'Single' },
    { id: 'MARRIED', label: 'Married' },
    { id: 'DIVORCED', label: 'Divorced' },
    { id: 'WIDOWED', label: 'Widowed' },
];

export const WIFE_SPECIFIC_FIELD_KEYS = [
    'wifeName', 'wifeAge', 'wifeAadhaarNumber', 'wifeBankAccountNumber', 'wifeIfscCode', 'wifeContactNumber',
] as const;

export const HUSBAND_SPECIFIC_FIELD_KEYS = [
    'husbandName', 'husbandAge', 'husbandAadhaarNumber', 'husbandBankAccountNumber', 'husbandIfscCode', 'husbandContactNumber',
] as const;

export const WIFE_RELATED_FIELD_KEYS = [
    ...WIFE_SPECIFIC_FIELD_KEYS,
    'weddingDate',
] as const;

export const HUSBAND_RELATED_FIELD_KEYS = [
    ...HUSBAND_SPECIFIC_FIELD_KEYS,
] as const;

export const SPOUSE_RELATED_FIELD_KEYS = [
    ...WIFE_SPECIFIC_FIELD_KEYS,
    ...HUSBAND_SPECIFIC_FIELD_KEYS,
    'weddingDate',
] as const;

/**
 * Every onboarding fieldKey that HrOnboardingFieldConfig can govern and that
 * is actually collected AT INTAKE (personal/address/identity/bank/insurance/
 * family) — the single list both entry points enforce an admin's
 * required-toggle against: HR's Manual Entry / "Submit for Approval"
 * (app/api/hr/onboarding/[id]/submit-for-approval/route.ts) and the joinee's
 * own public-link submission (app/api/public/hr-onboarding/[token]/route.ts).
 * Sharing one list is what keeps the two entry points from drifting apart.
 *
 * branchId is NOT here (and has no HrOnboardingFieldConfig row at all) — it's
 * hard-required by intake's own zod schema instead, since a config-driven
 * toggle for it could never actually govern anything. designationId/
 * departmentId/reportingManagerId/dateOfJoining are also NOT here — they're
 * collected by the admin at final approval instead
 * (app/api/hr/onboarding/[id]/action/route.ts), using this same
 * HrOnboardingFieldConfig required-toggle at that later point.
 */
export const CONFIGURABLE_ONBOARDING_FIELD_KEYS = [
    'employeeName', 'mobileNumber', 'email', 'dateOfBirth', 'gender', 'maritalStatus', 'bloodGroup', 'educationQualification',
    'currentAddress', 'permanentAddress', 'emergencyContactName', 'emergencyContactRelation', 'emergencyContactNumber',
    'aadhaarNumber', 'panNumber', 'dlNumber', 'voterIdNumber', 'uanNumber', 'esiNumber',
    'bankName', 'bankBranchName', 'accountNumber', 'ifscCode',
    'insuranceCompanyName', 'insurancePolicyNumber', 'insuranceValidFrom', 'insuranceValidTo',
    'fatherName', 'fatherAge', 'fatherAadhaarNumber', 'motherName', 'motherAge', 'motherAadhaarNumber',
    'wifeName', 'wifeAge', 'wifeAadhaarNumber', 'wifeBankAccountNumber', 'wifeIfscCode', 'wifeContactNumber', 'weddingDate',
    'husbandName', 'husbandAge', 'husbandAadhaarNumber', 'husbandBankAccountNumber', 'husbandIfscCode', 'husbandContactNumber',
] as const;

/**
 * Per-child-row fields -> their HrOnboardingFieldConfig key. Children are a
 * repeatable list, so a required toggle applies to every child row that was
 * added; it never forces a married employee to add a child at all.
 */
export const CHILD_FIELD_CONFIG_KEYS = {
    gender: 'childGender',
    age: 'childAge',
    aadhaarNumber: 'childAadhaarNumber',
} as const;

export type ChildFieldName = keyof typeof CHILD_FIELD_CONFIG_KEYS;

const CHILD_FIELD_LABELS: Record<ChildFieldName, string> = { gender: 'Gender', age: 'Age', aadhaarNumber: 'Aadhaar Number' };

/**
 * One required-check entry per child field per child row, shaped for
 * hrOnboardingValidationService.assertRequiredFieldsPresent. Empty when
 * children don't apply (not currently married).
 */
export function buildChildRequiredChecks(
    children: unknown,
    maritalStatus: string | null | undefined
): { configKey: string; value: unknown; label: string }[] {
    if (maritalStatus !== 'MARRIED' || !Array.isArray(children)) return [];
    return children.flatMap((child: Partial<Record<ChildFieldName, unknown>> | null, i) =>
        (Object.keys(CHILD_FIELD_CONFIG_KEYS) as ChildFieldName[]).map((field) => ({
            configKey: CHILD_FIELD_CONFIG_KEYS[field],
            value: child?.[field] == null ? null : String(child[field]),
            label: `Child ${i + 1} ${CHILD_FIELD_LABELS[field]}`,
        }))
    );
}

/**
 * Which CONFIGURABLE_ONBOARDING_FIELD_KEYS don't apply to this particular
 * applicant — spouse/wedding fields hidden by marital status, or the opposite
 * gender's spouse fields. Shared by every route that enforces
 * HrOnboardingFieldConfig's required-toggle, so a required check never blocks
 * on a field the form itself never shows.
 */
export function getOnboardingSkipKeys(
    maritalStatus: string | null | undefined,
    gender: string | null | undefined
): readonly string[] {
    return getInapplicableSpouseKeys(maritalStatus, gender);
}

const BOTH_SPOUSE_DETAIL_KEYS: readonly string[] = [...WIFE_SPECIFIC_FIELD_KEYS, ...HUSBAND_SPECIFIC_FIELD_KEYS];

/**
 * The one rule for which spouse fields the forms (manual entry, joinee link,
 * Employee Master edit), the client validators and the server checks all
 * treat as not applicable — so they can never disagree about what's shown.
 *  - Not currently married (Single/Divorced/Widowed/blank): every spouse
 *    field and Wedding Date is hidden.
 *  - Married male: wife details apply, husband details don't.
 *  - Married female: husband details apply, wife details don't.
 *  - Married, other/unspecified gender: neither spouse's details show, but
 *    Wedding Date still does (Employee Master has always shown it here).
 */
export function getInapplicableSpouseKeys(
    maritalStatus: string | null | undefined,
    gender: string | null | undefined
): readonly string[] {
    if (maritalStatus !== 'MARRIED') return SPOUSE_RELATED_FIELD_KEYS;
    if (gender === 'MALE') return HUSBAND_SPECIFIC_FIELD_KEYS;
    if (gender === 'FEMALE') return WIFE_SPECIFIC_FIELD_KEYS;
    return BOTH_SPOUSE_DETAIL_KEYS;
}

/**
 * Server-side refinement for conditional rules:
 * - Spouse field format checks are only applied when maritalStatus === 'MARRIED'
 * - Wife fields are only checked when gender is not 'FEMALE'
 * - Husband fields are only checked when gender is not 'MALE'
 * - Insurance validTo date must be on or after validFrom date
 * - Date of Birth must represent a past date with age >= 18
 */
export function validateOnboardingServerRules(data: Record<string, unknown>, ctx: z.RefinementCtx) {
    // 1. Insurance dates cross-field check
    if (data.insuranceValidFrom && data.insuranceValidTo) {
        const from = new Date(data.insuranceValidFrom as string | number | Date);
        const to = new Date(data.insuranceValidTo as string | number | Date);
        if (!Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime()) && to < from) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: FIELD_ERROR_MESSAGES.INSURANCE_DATES,
                path: ['insuranceValidTo'],
            });
        }
    }

    // 2. Date of birth check (age >= 18 and past date)
    if (data.dateOfBirth) {
        const dob = new Date(data.dateOfBirth as string | number | Date);
        if (!Number.isNaN(dob.getTime())) {
            const today = new Date();
            if (dob > today) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: FIELD_ERROR_MESSAGES.DOB_INVALID,
                    path: ['dateOfBirth'],
                });
            } else {
                let age = today.getFullYear() - dob.getFullYear();
                const m = today.getMonth() - dob.getMonth();
                if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) {
                    age--;
                }
                if (age < 18) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        message: FIELD_ERROR_MESSAGES.DOB_MIN_AGE,
                        path: ['dateOfBirth'],
                    });
                }
            }
        }
    }

    // 3. Conditional spouse checks
    const isMarried = data.maritalStatus === 'MARRIED';
    if (!isMarried) {
        // Unmarried applicants: spouse fields are hidden and strictly excluded from validation
        return;
    }

    const wifeAadhaar = typeof data.wifeAadhaarNumber === 'string' ? data.wifeAadhaarNumber : '';
    const wifeContact = typeof data.wifeContactNumber === 'string' ? data.wifeContactNumber : '';
    const wifeBank = typeof data.wifeBankAccountNumber === 'string' ? data.wifeBankAccountNumber : '';
    const wifeIfsc = typeof data.wifeIfscCode === 'string' ? data.wifeIfscCode : '';

    const husbandAadhaar = typeof data.husbandAadhaarNumber === 'string' ? data.husbandAadhaarNumber : '';
    const husbandContact = typeof data.husbandContactNumber === 'string' ? data.husbandContactNumber : '';
    const husbandBank = typeof data.husbandBankAccountNumber === 'string' ? data.husbandBankAccountNumber : '';
    const husbandIfsc = typeof data.husbandIfscCode === 'string' ? data.husbandIfscCode : '';

    // Married male applicants -> validate wife fields if populated (other/
    // unspecified gender shows neither spouse's details, so nothing to check)
    if (data.gender === 'MALE') {
        if (wifeAadhaar && !FIELD_PATTERNS.AADHAAR.test(wifeAadhaar.trim())) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: FIELD_ERROR_MESSAGES.SPOUSE_AADHAAR,
                path: ['wifeAadhaarNumber'],
            });
        }
        if (wifeContact && !FIELD_PATTERNS.MOBILE.test(wifeContact.trim())) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: FIELD_ERROR_MESSAGES.SPOUSE_CONTACT,
                path: ['wifeContactNumber'],
            });
        }
        if (wifeBank && !FIELD_PATTERNS.BANK_ACCOUNT.test(wifeBank.trim())) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: FIELD_ERROR_MESSAGES.SPOUSE_BANK,
                path: ['wifeBankAccountNumber'],
            });
        }
        if (wifeIfsc && !FIELD_PATTERNS.IFSC.test(wifeIfsc.trim().toUpperCase())) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: FIELD_ERROR_MESSAGES.SPOUSE_IFSC,
                path: ['wifeIfscCode'],
            });
        }
    }

    // Married female applicants -> validate husband fields if populated
    if (data.gender === 'FEMALE') {
        if (husbandAadhaar && !FIELD_PATTERNS.AADHAAR.test(husbandAadhaar.trim())) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: FIELD_ERROR_MESSAGES.SPOUSE_AADHAAR,
                path: ['husbandAadhaarNumber'],
            });
        }
        if (husbandContact && !FIELD_PATTERNS.MOBILE.test(husbandContact.trim())) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: FIELD_ERROR_MESSAGES.SPOUSE_CONTACT,
                path: ['husbandContactNumber'],
            });
        }
        if (husbandBank && !FIELD_PATTERNS.BANK_ACCOUNT.test(husbandBank.trim())) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: FIELD_ERROR_MESSAGES.SPOUSE_BANK,
                path: ['husbandBankAccountNumber'],
            });
        }
        if (husbandIfsc && !FIELD_PATTERNS.IFSC.test(husbandIfsc.trim().toUpperCase())) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: FIELD_ERROR_MESSAGES.SPOUSE_IFSC,
                path: ['husbandIfscCode'],
            });
        }
    }
}

/**
 * Prisma's Json? columns need Prisma.JsonNull for an explicit database NULL —
 * a plain `null` is ambiguous (it could mean "the JSON value null") and the
 * generated types reject it outright. `undefined` (field omitted) still
 * means "leave unchanged" on an update and needs no conversion.
 */
export function childrenJsonInput(
    children: OnboardingChild[] | null | undefined
): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
    if (children === undefined) return undefined;
    if (children === null) return Prisma.JsonNull;
    return children;
}
