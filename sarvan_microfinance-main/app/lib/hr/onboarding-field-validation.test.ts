import { describe, it, expect } from 'vitest';
import {
    filterDigits,
    filterUppercase,
    isFieldApplicable,
    validateDateOfBirth,
    validateInsuranceDates,
    validateSingleField,
    validateOnboardingForm,
    getSectionForField,
    getFieldLabel,
    groupErrorsBySection,
    validateEmployeeField,
    EMPLOYEE_TO_ONBOARDING_FIELD_MAP,
    EMPLOYEE_FIELD_INPUT_CONFIG,
    EMPLOYEE_FIELD_TAB_MAP,
} from '@/app/lib/hr/onboarding-validation-rules';
import {
    onboardingFormFieldsSchema,
    validateOnboardingServerRules,
    FIELD_ERROR_MESSAGES,
    FIELD_PATTERNS,
    CONFIGURABLE_ONBOARDING_FIELD_KEYS,
    getOnboardingSkipKeys,
} from '@/app/lib/hr/onboarding-form-fields';
import { HR_ONBOARDING_FIELDS, HR_ONBOARDING_SECTION_ORDER } from '@/app/lib/hr/onboarding-field-definitions';
import { emptyOnboardingFormValues, type OnboardingFormValues } from '@/components/hr/OnboardingRequestForm';

describe('HR Onboarding Field Validation Suite', () => {
    describe('1. Input Filter Utilities', () => {
        it('filterDigits strips non-digits and respects maxLength', () => {
            expect(filterDigits('9876543210', 10)).toBe('9876543210');
            expect(filterDigits('9876543210999', 10)).toBe('9876543210');
            expect(filterDigits('+91 98765-43210', 10)).toBe('9198765432');
            expect(filterDigits('abc123xyz456', 6)).toBe('123456');
            expect(filterDigits('', 10)).toBe('');
        });

        it('filterUppercase transforms letters and respects maxLength', () => {
            expect(filterUppercase('abcde1234f', 10)).toBe('ABCDE1234F');
            expect(filterUppercase('abcdefghij123', 10)).toBe('ABCDEFGHIJ');
            expect(filterUppercase('sbin0001234', 11)).toBe('SBIN0001234');
        });
    });

    describe('2. Single Field Format Validation', () => {
        const baseValues = emptyOnboardingFormValues();

        it('validates mobile number (exact 10 digits)', () => {
            expect(validateSingleField('mobileNumber', '9876543210', baseValues, false)).toBeNull();
            expect(validateSingleField('mobileNumber', '987654321', baseValues, false)).toBe(FIELD_ERROR_MESSAGES.MOBILE);
            expect(validateSingleField('mobileNumber', '98765432101', baseValues, false)).toBe(FIELD_ERROR_MESSAGES.MOBILE);
            expect(validateSingleField('mobileNumber', '98765abcde', baseValues, false)).toBe(FIELD_ERROR_MESSAGES.MOBILE);
            expect(validateSingleField('mobileNumber', '', baseValues, false)).toBeNull();
            expect(validateSingleField('mobileNumber', '', baseValues, true)).toBe(FIELD_ERROR_MESSAGES.REQUIRED);
        });

        it('validates emergency contact number (exact 10 digits)', () => {
            expect(validateSingleField('emergencyContactNumber', '9123456780', baseValues, false)).toBeNull();
            expect(validateSingleField('emergencyContactNumber', '912345', baseValues, false)).toBe(FIELD_ERROR_MESSAGES.EMERGENCY_MOBILE);
        });

        it('validates Aadhaar number (exact 12 digits)', () => {
            expect(validateSingleField('aadhaarNumber', '123456789012', baseValues, false)).toBeNull();
            expect(validateSingleField('aadhaarNumber', '12345678901', baseValues, false)).toBe(FIELD_ERROR_MESSAGES.AADHAAR);
            expect(validateSingleField('aadhaarNumber', '1234567890123', baseValues, false)).toBe(FIELD_ERROR_MESSAGES.AADHAAR);
            expect(validateSingleField('aadhaarNumber', '12345678901a', baseValues, false)).toBe(FIELD_ERROR_MESSAGES.AADHAAR);
        });

        it('validates PAN number (format ABCDE1234F)', () => {
            expect(validateSingleField('panNumber', 'ABCDE1234F', baseValues, false)).toBeNull();
            expect(validateSingleField('panNumber', 'abcde1234f', baseValues, false)).toBeNull();
            expect(validateSingleField('panNumber', 'ABCD12345F', baseValues, false)).toBe(FIELD_ERROR_MESSAGES.PAN);
            expect(validateSingleField('panNumber', 'ABCDE1234', baseValues, false)).toBe(FIELD_ERROR_MESSAGES.PAN);
        });

        it('validates IFSC code (format SBIN0001234)', () => {
            expect(validateSingleField('ifscCode', 'SBIN0001234', baseValues, false)).toBeNull();
            expect(validateSingleField('ifscCode', 'sbin0001234', baseValues, false)).toBeNull();
            expect(validateSingleField('ifscCode', 'SBIN1001234', baseValues, false)).toBe(FIELD_ERROR_MESSAGES.IFSC);
            expect(validateSingleField('ifscCode', 'SBI0001234', baseValues, false)).toBe(FIELD_ERROR_MESSAGES.IFSC);
        });

        it('validates Bank Account number (9 to 18 digits)', () => {
            expect(validateSingleField('accountNumber', '123456789', baseValues, false)).toBeNull();
            expect(validateSingleField('accountNumber', '123456789012345678', baseValues, false)).toBeNull();
            expect(validateSingleField('accountNumber', '12345678', baseValues, false)).toBe(FIELD_ERROR_MESSAGES.BANK_ACCOUNT);
            expect(validateSingleField('accountNumber', '1234567890123456789', baseValues, false)).toBe(FIELD_ERROR_MESSAGES.BANK_ACCOUNT);
        });

        it('validates UAN number (12 digits) and ESI number (17 digits)', () => {
            expect(validateSingleField('uanNumber', '100123456789', baseValues, false)).toBeNull();
            expect(validateSingleField('uanNumber', '10012345678', baseValues, false)).toBe(FIELD_ERROR_MESSAGES.UAN);

            expect(validateSingleField('esiNumber', '12345678901234567', baseValues, false)).toBeNull();
            expect(validateSingleField('esiNumber', '1234567890123456', baseValues, false)).toBe(FIELD_ERROR_MESSAGES.ESI);
        });

        it('validates Date of Birth (must be past date and age >= 18)', () => {
            // Valid adult (e.g. 1995)
            expect(validateDateOfBirth('1995-05-15')).toBeNull();

            // Under 18 (e.g. 2 years ago)
            const twoYearsAgo = new Date();
            twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
            expect(validateDateOfBirth(twoYearsAgo.toISOString().split('T')[0])).toBe(FIELD_ERROR_MESSAGES.DOB_MIN_AGE);

            // Future date
            const future = new Date();
            future.setFullYear(future.getFullYear() + 1);
            expect(validateDateOfBirth(future.toISOString().split('T')[0])).toBe(FIELD_ERROR_MESSAGES.DOB_INVALID);
        });

        it('validates Insurance Dates (validTo must be on or after validFrom)', () => {
            expect(validateInsuranceDates('2025-01-01', '2026-01-01')).toBeNull();
            expect(validateInsuranceDates('2025-01-01', '2025-01-01')).toBeNull();
            expect(validateInsuranceDates('2026-01-01', '2025-01-01')).toBe(FIELD_ERROR_MESSAGES.INSURANCE_DATES);
            expect(validateInsuranceDates('', '2025-01-01')).toBeNull();
        });
    });

    describe('3. Conditional Visibility and Spouse Validation', () => {
        it('excludes spouse fields for unmarried applicants (SINGLE, DIVORCED, WIDOWED)', () => {
            for (const status of ['SINGLE', 'DIVORCED', 'WIDOWED']) {
                expect(isFieldApplicable('wifeName', status, 'MALE')).toBe(false);
                expect(isFieldApplicable('wifeAadhaarNumber', status, 'MALE')).toBe(false);
                expect(isFieldApplicable('husbandName', status, 'FEMALE')).toBe(false);
                expect(isFieldApplicable('weddingDate', status, 'MALE')).toBe(false);
                expect(isFieldApplicable('children', status, 'MALE')).toBe(false);

                const singleValues: OnboardingFormValues = {
                    ...emptyOnboardingFormValues(),
                    maritalStatus: status,
                    gender: 'MALE',
                    wifeAadhaarNumber: 'invalid-non-digits',
                    wifeContactNumber: '123',
                };

                // Hidden fields are strictly excluded from validation even if populated
                expect(validateSingleField('wifeAadhaarNumber', 'invalid-non-digits', singleValues, true)).toBeNull();
                expect(validateSingleField('wifeContactNumber', '123', singleValues, true)).toBeNull();
            }
        });

        it('validates wife fields for married male applicants, but skips husband fields', () => {
            expect(isFieldApplicable('wifeName', 'MARRIED', 'MALE')).toBe(true);
            expect(isFieldApplicable('wifeAadhaarNumber', 'MARRIED', 'MALE')).toBe(true);
            expect(isFieldApplicable('husbandName', 'MARRIED', 'MALE')).toBe(false);
            expect(isFieldApplicable('husbandAadhaarNumber', 'MARRIED', 'MALE')).toBe(false);

            const marriedMaleValues: OnboardingFormValues = {
                ...emptyOnboardingFormValues(),
                maritalStatus: 'MARRIED',
                gender: 'MALE',
                wifeAadhaarNumber: '123456789012',
                wifeContactNumber: '9876543210',
                husbandAadhaarNumber: 'invalid-ignored',
            };

            expect(validateSingleField('wifeAadhaarNumber', '123456789012', marriedMaleValues, false)).toBeNull();
            expect(validateSingleField('wifeAadhaarNumber', 'bad', marriedMaleValues, false)).toBe(FIELD_ERROR_MESSAGES.SPOUSE_AADHAAR);
            // Husband field is skipped for male
            expect(validateSingleField('husbandAadhaarNumber', 'invalid-ignored', marriedMaleValues, false)).toBeNull();
        });

        it('validates husband fields for married female applicants, but skips wife fields', () => {
            expect(isFieldApplicable('husbandName', 'MARRIED', 'FEMALE')).toBe(true);
            expect(isFieldApplicable('husbandAadhaarNumber', 'MARRIED', 'FEMALE')).toBe(true);
            expect(isFieldApplicable('wifeName', 'MARRIED', 'FEMALE')).toBe(false);
            expect(isFieldApplicable('wifeAadhaarNumber', 'MARRIED', 'FEMALE')).toBe(false);

            const marriedFemaleValues: OnboardingFormValues = {
                ...emptyOnboardingFormValues(),
                maritalStatus: 'MARRIED',
                gender: 'FEMALE',
                husbandAadhaarNumber: '123456789012',
                wifeAadhaarNumber: 'invalid-ignored',
            };

            expect(validateSingleField('husbandAadhaarNumber', '123456789012', marriedFemaleValues, false)).toBeNull();
            expect(validateSingleField('husbandAadhaarNumber', 'bad', marriedFemaleValues, false)).toBe(FIELD_ERROR_MESSAGES.SPOUSE_AADHAAR);
            // Wife field is skipped for female
            expect(validateSingleField('wifeAadhaarNumber', 'invalid-ignored', marriedFemaleValues, false)).toBeNull();
        });
    });

    describe('4. Draft vs Finalize Form Validation', () => {
        it('in draft mode (forFinalize: false), empty fields are allowed, only format errors are flagged', () => {
            const draftValues: OnboardingFormValues = {
                ...emptyOnboardingFormValues(),
                employeeName: '',
                mobileNumber: '9876543210', // valid format
                aadhaarNumber: '', // empty allowed in draft
                panNumber: 'INVALID_PAN', // format error must be caught
            };

            const isReq = (k: string) => ['employeeName', 'mobileNumber', 'aadhaarNumber'].includes(k);
            const errors = validateOnboardingForm(draftValues, isReq, false);

            expect(errors.employeeName).toBeUndefined(); // blank allowed in draft
            expect(errors.aadhaarNumber).toBeUndefined(); // blank allowed in draft
            expect(errors.mobileNumber).toBeUndefined(); // valid
            expect(errors.panNumber).toBe(FIELD_ERROR_MESSAGES.PAN); // invalid format caught
        });

        it('in finalize mode (forFinalize: true), empty required fields produce errors', () => {
            const submitValues: OnboardingFormValues = {
                ...emptyOnboardingFormValues(),
                employeeName: '',
                mobileNumber: '9876543210',
            };

            const isReq = (k: string) => ['employeeName', 'mobileNumber'].includes(k);
            const errors = validateOnboardingForm(submitValues, isReq, true);

            expect(errors.employeeName).toBe(FIELD_ERROR_MESSAGES.REQUIRED);
            expect(errors.mobileNumber).toBeUndefined();
        });
    });

    describe('5. Section Mapping', () => {
        it('correctly identifies section for any field', () => {
            expect(getSectionForField('employeeName')).toBe('personal');
            expect(getSectionForField('mobileNumber')).toBe('personal');
            expect(getSectionForField('currentAddress')).toBe('address');
            expect(getSectionForField('emergencyContactRelation')).toBe('address');
            expect(getSectionForField('aadhaarNumber')).toBe('identity');
            expect(getSectionForField('panNumber')).toBe('identity');
            expect(getSectionForField('accountNumber')).toBe('bank');
            expect(getSectionForField('insurancePolicyNumber')).toBe('insurance');
            expect(getSectionForField('fatherName')).toBe('family');
            expect(getSectionForField('wifeAadhaarNumber')).toBe('family');
            expect(getSectionForField('children.0.aadhaarNumber')).toBe('family');
        });
    });

    describe('6. Server-Side Zod Schemas & Refinement', () => {
        const fullServerSchema = onboardingFormFieldsSchema.superRefine(validateOnboardingServerRules);

        it('accepts valid full payload', () => {
            const validPayload = {
                employeeName: 'Jane Doe',
                mobileNumber: '9876543210',
                email: 'jane@example.com',
                dateOfBirth: '1990-01-01',
                gender: 'FEMALE',
                maritalStatus: 'MARRIED',
                emergencyContactNumber: '9876543211',
                aadhaarNumber: '123456789012',
                panNumber: 'ABCDE1234F',
                accountNumber: '123456789012',
                ifscCode: 'SBIN0001234',
                husbandAadhaarNumber: '987654321098',
                husbandContactNumber: '9123456789',
                insuranceValidFrom: '2025-01-01',
                insuranceValidTo: '2026-01-01',
            };

            const result = fullServerSchema.safeParse(validPayload);
            expect(result.success).toBe(true);
        });

        it('rejects invalid mobile number on server', () => {
            const result = fullServerSchema.safeParse({ mobileNumber: '12345' });
            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.error.errors[0].message).toBe(FIELD_ERROR_MESSAGES.MOBILE);
            }
        });

        it('rejects invalid PAN on server', () => {
            const result = fullServerSchema.safeParse({ panNumber: '12345' });
            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.error.errors[0].message).toBe(FIELD_ERROR_MESSAGES.PAN);
            }
        });

        it('rejects insurance validTo earlier than validFrom on server', () => {
            const result = fullServerSchema.safeParse({
                insuranceValidFrom: '2026-01-01',
                insuranceValidTo: '2025-01-01',
            });
            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.error.errors[0].message).toBe(FIELD_ERROR_MESSAGES.INSURANCE_DATES);
            }
        });

        it('skips hidden spouse errors on server for unmarried status', () => {
            const singleWithStaleWife = {
                maritalStatus: 'SINGLE',
                gender: 'MALE',
                wifeAadhaarNumber: 'stale-value', // hidden, excluded from validation
            };
            const result = fullServerSchema.safeParse(singleWithStaleWife);
            expect(result.success).toBe(true);
        });

        it('validates spouse fields on server when married', () => {
            const marriedWithBadWife = {
                maritalStatus: 'MARRIED',
                gender: 'MALE',
                wifeAadhaarNumber: '123', // invalid 3 digits
            };
            const result = fullServerSchema.safeParse(marriedWithBadWife);
            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.error.errors[0].message).toBe(FIELD_ERROR_MESSAGES.SPOUSE_AADHAAR);
            }
        });
    });

    describe('7. Error Grouping & Field Label Helpers', () => {
        it('returns canonical labels for known fields', () => {
            expect(getFieldLabel('employeeName')).toBe('Employee Name');
            expect(getFieldLabel('mobileNumber')).toBe('Mobile Number');
            expect(getFieldLabel('aadhaarNumber')).toBe('Aadhaar Number');
            expect(getFieldLabel('panNumber')).toBe('PAN Number');
            expect(getFieldLabel('emergencyContactRelation')).toBe('Emergency Contact Relationship');
            expect(getFieldLabel('emergencyContactNumber')).toBe('Emergency Contact Number');
            expect(getFieldLabel('wifeAadhaarNumber')).toBe('Wife Aadhaar Number');
        });

        it('returns human-readable labels for child array elements', () => {
            expect(getFieldLabel('children.0.aadhaarNumber')).toBe('Child 1 Aadhaar Number');
            expect(getFieldLabel('children.1.aadhaarNumber')).toBe('Child 2 Aadhaar Number');
            expect(getFieldLabel('children.0.age')).toBe('Child 1 Age');
            expect(getFieldLabel('children.0.gender')).toBe('Child 1 Gender');
        });

        it('correctly groups errors by form sections in canonical tab order', () => {
            const rawErrors = {
                panNumber: FIELD_ERROR_MESSAGES.PAN,
                mobileNumber: FIELD_ERROR_MESSAGES.MOBILE,
                wifeAadhaarNumber: FIELD_ERROR_MESSAGES.SPOUSE_AADHAAR,
                'children.0.aadhaarNumber': FIELD_ERROR_MESSAGES.CHILD_AADHAAR,
            };

            const groups = groupErrorsBySection(rawErrors);

            // Tab order: Personal -> Address -> Identity -> Bank -> Insurance -> Family -> Documents
            expect(groups.length).toBe(3);
            expect(groups[0].sectionId).toBe('personal');
            expect(groups[0].sectionLabel).toBe('Personal Details');
            expect(groups[0].errors).toHaveLength(1);
            expect(groups[0].errors[0].fieldKey).toBe('mobileNumber');
            expect(groups[0].errors[0].fieldLabel).toBe('Mobile Number');
            expect(groups[0].errors[0].message).toBe(FIELD_ERROR_MESSAGES.MOBILE);

            expect(groups[1].sectionId).toBe('identity');
            expect(groups[1].sectionLabel).toBe('Identity & Statutory');
            expect(groups[1].errors).toHaveLength(1);
            expect(groups[1].errors[0].fieldKey).toBe('panNumber');

            expect(groups[2].sectionId).toBe('family');
            expect(groups[2].sectionLabel).toBe('Family Details');
            expect(groups[2].errors).toHaveLength(2);
            expect(groups[2].errors[0].fieldKey).toBe('wifeAadhaarNumber');
            expect(groups[2].errors[1].fieldKey).toBe('children.0.aadhaarNumber');
            expect(groups[2].errors[1].fieldLabel).toBe('Child 1 Aadhaar Number');
        });

        it('returns empty group list when there are no errors', () => {
            expect(groupErrorsBySection({})).toEqual([]);
        });
    });

    describe('8. Unified Employee Field Validation (Employee Master & APIs)', () => {
        it('validates Employee Master mobileNumber with canonical 10-digit rule', () => {
            expect(validateEmployeeField('mobileNumber', '9876543210')).toBeNull();
            expect(validateEmployeeField('mobileNumber', '98765')).toBe(FIELD_ERROR_MESSAGES.MOBILE);
            expect(validateEmployeeField('mobileNumber', '98765432101')).toBe(FIELD_ERROR_MESSAGES.MOBILE);
            expect(validateEmployeeField('mobileNumber', 'abc1234567')).toBe(FIELD_ERROR_MESSAGES.MOBILE);
        });

        it('validates Employee Master aliases (emergencyContactMobile, bankAccountNumber, bankIfscCode, dob)', () => {
            // emergencyContactMobile -> emergencyContactNumber
            expect(validateEmployeeField('emergencyContactMobile', '9876543210')).toBeNull();
            expect(validateEmployeeField('emergencyContactMobile', '12345')).toBe(FIELD_ERROR_MESSAGES.EMERGENCY_MOBILE);

            // bankAccountNumber -> accountNumber
            expect(validateEmployeeField('bankAccountNumber', '123456789012')).toBeNull();
            expect(validateEmployeeField('bankAccountNumber', '12345')).toBe(FIELD_ERROR_MESSAGES.BANK_ACCOUNT);

            // bankIfscCode -> ifscCode
            expect(validateEmployeeField('bankIfscCode', 'SBIN0001234')).toBeNull();
            expect(validateEmployeeField('bankIfscCode', 'sbin0001234')).toBeNull(); // case-insensitive check
            expect(validateEmployeeField('bankIfscCode', 'INVALID')).toBe(FIELD_ERROR_MESSAGES.IFSC);

            // dob -> dateOfBirth
            expect(validateEmployeeField('dob', '1995-05-15')).toBeNull();
            expect(validateEmployeeField('dob', '2020-01-01')).toBe(FIELD_ERROR_MESSAGES.DOB_MIN_AGE);
        });

        it('validates statutory numbers in Employee Master (aadhaar, pan, uan, esi)', () => {
            // Aadhaar: 12 digits
            expect(validateEmployeeField('aadhaarNumber', '123456789012')).toBeNull();
            expect(validateEmployeeField('aadhaarNumber', '12345')).toBe(FIELD_ERROR_MESSAGES.AADHAAR);

            // PAN: ABCDE1234F
            expect(validateEmployeeField('panNumber', 'ABCDE1234F')).toBeNull();
            expect(validateEmployeeField('panNumber', 'abcde1234f')).toBeNull();
            expect(validateEmployeeField('panNumber', 'INVALID')).toBe(FIELD_ERROR_MESSAGES.PAN);

            // UAN: 12 digits
            expect(validateEmployeeField('uanNumber', '123456789012')).toBeNull();
            expect(validateEmployeeField('uanNumber', '1234')).toBe(FIELD_ERROR_MESSAGES.UAN);

            // ESI: 17 digits
            expect(validateEmployeeField('esiNumber', '12345678901234567')).toBeNull();
            expect(validateEmployeeField('esiNumber', '12345')).toBe(FIELD_ERROR_MESSAGES.ESI);
        });

        it('handles optional empty values without error when not required', () => {
            expect(validateEmployeeField('mobileNumber', '', { isRequired: false })).toBeNull();
            expect(validateEmployeeField('aadhaarNumber', null, { isRequired: false })).toBeNull();
            expect(validateEmployeeField('panNumber', undefined, { isRequired: false })).toBeNull();
            expect(validateEmployeeField('bankAccountNumber', '', { isRequired: false })).toBeNull();
        });

        it('enforces required rule when isRequired is true and value is empty', () => {
            expect(validateEmployeeField('mobileNumber', '', { isRequired: true })).toBe(FIELD_ERROR_MESSAGES.REQUIRED);
            expect(validateEmployeeField('firstName', '', { isRequired: true })).toBe(FIELD_ERROR_MESSAGES.REQUIRED);
        });

        it('skips hidden spouse validation when unmarried or gender does not match', () => {
            // Unmarried skips wifeAadhaarNumber
            expect(validateEmployeeField('wifeAadhaarNumber', '123', { maritalStatus: 'SINGLE', gender: 'MALE' })).toBeNull();
            expect(validateEmployeeField('wifeContactNumber', '123', { maritalStatus: 'UNMARRIED', gender: 'MALE' })).toBeNull();

            // Married Male validates wife fields
            expect(validateEmployeeField('wifeAadhaarNumber', '123', { maritalStatus: 'MARRIED', gender: 'MALE' })).toBe(FIELD_ERROR_MESSAGES.SPOUSE_AADHAAR);
            expect(validateEmployeeField('wifeContactNumber', '123', { maritalStatus: 'MARRIED', gender: 'MALE' })).toBe(FIELD_ERROR_MESSAGES.SPOUSE_CONTACT);

            // Married Male skips husband fields
            expect(validateEmployeeField('husbandAadhaarNumber', '123', { maritalStatus: 'MARRIED', gender: 'MALE' })).toBeNull();

            // Married Female validates husband fields
            expect(validateEmployeeField('husbandAadhaarNumber', '123', { maritalStatus: 'MARRIED', gender: 'FEMALE' })).toBe(FIELD_ERROR_MESSAGES.SPOUSE_AADHAAR);
            expect(validateEmployeeField('husbandContactNumber', '123', { maritalStatus: 'MARRIED', gender: 'FEMALE' })).toBe(FIELD_ERROR_MESSAGES.SPOUSE_CONTACT);
        });

        it('validates insurance date range', () => {
            expect(validateEmployeeField('insuranceValidTo', '2026-12-31', { insuranceValidFrom: '2026-01-01' })).toBeNull();
            expect(validateEmployeeField('insuranceValidTo', '2025-01-01', { insuranceValidFrom: '2026-01-01' })).toBe(FIELD_ERROR_MESSAGES.INSURANCE_DATES);
        });

        it('applies the required check to monthlyCtc and routes its error to the organization tab', () => {
            expect(validateEmployeeField('monthlyCtc', '', { isRequired: true })).toBe(FIELD_ERROR_MESSAGES.REQUIRED);
            expect(validateEmployeeField('monthlyCtc', undefined, { isRequired: true })).toBe(FIELD_ERROR_MESSAGES.REQUIRED);
            expect(validateEmployeeField('monthlyCtc', 45000, { isRequired: true })).toBeNull();
            expect(validateEmployeeField('monthlyCtc', '', { isRequired: false })).toBeNull();
            expect(EMPLOYEE_FIELD_TAB_MAP.monthlyCtc).toBe('organization');
        });

        it('has correct input filtering configurations and tab mappings', () => {
            expect(EMPLOYEE_TO_ONBOARDING_FIELD_MAP.mobileNumber).toBe('mobileNumber');
            expect(EMPLOYEE_TO_ONBOARDING_FIELD_MAP.bankAccountNumber).toBe('accountNumber');
            expect(EMPLOYEE_TO_ONBOARDING_FIELD_MAP.bankIfscCode).toBe('ifscCode');
            expect(EMPLOYEE_TO_ONBOARDING_FIELD_MAP.dob).toBe('dateOfBirth');
            expect(EMPLOYEE_TO_ONBOARDING_FIELD_MAP.emergencyContactRelation).toBe('emergencyContactRelation');
            expect(EMPLOYEE_TO_ONBOARDING_FIELD_MAP.emergencyContactMobile).toBe('emergencyContactNumber');
            expect(EMPLOYEE_TO_ONBOARDING_FIELD_MAP.pfNumber).toBe('uanNumber');

            expect(EMPLOYEE_FIELD_INPUT_CONFIG.mobileNumber).toEqual({ digitsOnly: true, maxLength: 10 });
            expect(EMPLOYEE_FIELD_INPUT_CONFIG.aadhaarNumber).toEqual({ digitsOnly: true, maxLength: 12 });
            expect(EMPLOYEE_FIELD_INPUT_CONFIG.panNumber).toEqual({ uppercase: true, maxLength: 10 });
            expect(EMPLOYEE_FIELD_INPUT_CONFIG.uanNumber).toEqual({ digitsOnly: true, maxLength: 12 });
            expect(EMPLOYEE_FIELD_INPUT_CONFIG.pfNumber).toEqual({ digitsOnly: true, maxLength: 12 });
            expect(EMPLOYEE_FIELD_INPUT_CONFIG.bankAccountNumber).toEqual({ digitsOnly: true, maxLength: 18 });
            expect(EMPLOYEE_FIELD_INPUT_CONFIG.bankIfscCode).toEqual({ uppercase: true, maxLength: 11 });

            expect(EMPLOYEE_FIELD_TAB_MAP.mobileNumber).toBe('personal');
            expect(EMPLOYEE_FIELD_TAB_MAP.address).toBe('address');
            expect(EMPLOYEE_FIELD_TAB_MAP.aadhaarNumber).toBe('identity');
            expect(EMPLOYEE_FIELD_TAB_MAP.bankAccountNumber).toBe('bank');
            expect(EMPLOYEE_FIELD_TAB_MAP.insurancePolicyNumber).toBe('insurance');
            expect(EMPLOYEE_FIELD_TAB_MAP.fatherAadhaarNumber).toBe('family');
            expect(EMPLOYEE_FIELD_TAB_MAP.departmentId).toBe('organization');
        });
    });

    describe('6. Cross-Page Employee Data Validation Consistency', () => {
        it('validates mobile number across all entry points using canonical pattern', () => {
            const validMobile = '9876543210';
            const invalidMobiles = ['987654321', '98765432101', 'abcdefghij', '98765abcde'];

            expect(FIELD_PATTERNS.MOBILE.test(validMobile)).toBe(true);
            for (const m of invalidMobiles) {
                expect(FIELD_PATTERNS.MOBILE.test(m)).toBe(false);
            }
        });

        it('validates Aadhaar across all entry points (exact 12 digits)', () => {
            expect(FIELD_PATTERNS.AADHAAR.test('123456789012')).toBe(true);
            expect(FIELD_PATTERNS.AADHAAR.test('12345678901')).toBe(false);
            expect(FIELD_PATTERNS.AADHAAR.test('1234567890123')).toBe(false);
            expect(FIELD_PATTERNS.AADHAAR.test('12345678901a')).toBe(false);
        });

        it('validates PAN across all entry points (format ABCDE1234F)', () => {
            expect(FIELD_PATTERNS.PAN.test('ABCDE1234F')).toBe(true);
            expect(FIELD_PATTERNS.PAN.test('abcde1234f'.toUpperCase())).toBe(true);
            expect(FIELD_PATTERNS.PAN.test('1234567890')).toBe(false);
            expect(FIELD_PATTERNS.PAN.test('ABCDE12345')).toBe(false);
            expect(FIELD_PATTERNS.PAN.test('ABCD12345F')).toBe(false);
        });

        it('validates UAN / PF across all entry points (exact 12 digits)', () => {
            expect(FIELD_PATTERNS.UAN.test('100123456789')).toBe(true);
            expect(FIELD_PATTERNS.UAN.test('10012345678')).toBe(false);
            expect(FIELD_PATTERNS.UAN.test('1001234567890')).toBe(false);
            expect(FIELD_PATTERNS.UAN.test('10012345678a')).toBe(false);
        });

        it('validates ESI across all entry points (exact 17 digits)', () => {
            expect(FIELD_PATTERNS.ESI.test('12345678901234567')).toBe(true);
            expect(FIELD_PATTERNS.ESI.test('1234567890123456')).toBe(false);
            expect(FIELD_PATTERNS.ESI.test('123456789012345678')).toBe(false);
            expect(FIELD_PATTERNS.ESI.test('1234567890123456a')).toBe(false);
        });

        it('validates Bank Account Number across all entry points (9 to 18 digits)', () => {
            expect(FIELD_PATTERNS.BANK_ACCOUNT.test('123456789')).toBe(true);
            expect(FIELD_PATTERNS.BANK_ACCOUNT.test('123456789012345678')).toBe(true);
            expect(FIELD_PATTERNS.BANK_ACCOUNT.test('12345678')).toBe(false);
            expect(FIELD_PATTERNS.BANK_ACCOUNT.test('1234567890123456789')).toBe(false);
            expect(FIELD_PATTERNS.BANK_ACCOUNT.test('12345678a')).toBe(false);
        });

        it('validates IFSC Code across all entry points (11 characters uppercase)', () => {
            expect(FIELD_PATTERNS.IFSC.test('SBIN0001234')).toBe(true);
            expect(FIELD_PATTERNS.IFSC.test('HDFC0000123')).toBe(true);
            expect(FIELD_PATTERNS.IFSC.test('sbin0001234'.toUpperCase())).toBe(true);
            expect(FIELD_PATTERNS.IFSC.test('SBIN001234')).toBe(false);
            expect(FIELD_PATTERNS.IFSC.test('SBIN1001234')).toBe(false); // 5th char must be 0
            expect(FIELD_PATTERNS.IFSC.test('SBIN00012345')).toBe(false);
        });

        it('validates Email format across all entry points', () => {
            expect(FIELD_PATTERNS.EMAIL.test('employee@sarvam.com')).toBe(true);
            expect(FIELD_PATTERNS.EMAIL.test('invalid-email')).toBe(false);
            expect(FIELD_PATTERNS.EMAIL.test('employee@')).toBe(false);
            expect(FIELD_PATTERNS.EMAIL.test('@sarvam.com')).toBe(false);
        });
    });

    describe('9. Complete Field Configuration & Lifecycle Audit Suite', () => {
        it('verifies HR_ONBOARDING_FIELDS contains no duplicate keys', () => {
            const keys = HR_ONBOARDING_FIELDS.map((f) => f.fieldKey);
            const uniqueKeys = new Set(keys);
            expect(uniqueKeys.size).toBe(keys.length);
        });

        it('verifies all section orders and sections are valid', () => {
            for (const field of HR_ONBOARDING_FIELDS) {
                expect(HR_ONBOARDING_SECTION_ORDER).toContain(field.section);
            }
        });

        it('verifies every configurable onboarding field exists in HR_ONBOARDING_FIELDS', () => {
            const adminFieldKeys = new Set(HR_ONBOARDING_FIELDS.map((f) => f.fieldKey));
            for (const key of CONFIGURABLE_ONBOARDING_FIELD_KEYS) {
                expect(adminFieldKeys.has(key)).toBe(true);
            }
        });

        it('verifies emergencyContactRelation and bankBranchName are completely integrated', () => {
            // In CONFIGURABLE_ONBOARDING_FIELD_KEYS
            expect((CONFIGURABLE_ONBOARDING_FIELD_KEYS as readonly string[]).includes('emergencyContactRelation')).toBe(true);
            expect((CONFIGURABLE_ONBOARDING_FIELD_KEYS as readonly string[]).includes('bankBranchName')).toBe(true);

            // In HR_ONBOARDING_FIELDS
            const relConfig = HR_ONBOARDING_FIELDS.find((f) => f.fieldKey === 'emergencyContactRelation');
            expect(relConfig).toBeDefined();
            expect(relConfig?.section).toBe('address');
            expect(relConfig?.fieldLabel).toBe('Emergency Contact Relationship');

            const bankBranchConfig = HR_ONBOARDING_FIELDS.find((f) => f.fieldKey === 'bankBranchName');
            expect(bankBranchConfig).toBeDefined();
            expect(bankBranchConfig?.section).toBe('bank');
            expect(bankBranchConfig?.fieldLabel).toBe('Bank Branch Name');

            // In section mapping
            expect(getSectionForField('emergencyContactRelation')).toBe('address');
            expect(getSectionForField('bankBranchName')).toBe('bank');

            // In employee master field map
            expect(EMPLOYEE_TO_ONBOARDING_FIELD_MAP.emergencyContactRelation).toBe('emergencyContactRelation');
            expect(EMPLOYEE_TO_ONBOARDING_FIELD_MAP.bankBranchName).toBe('bankBranchName');

            // In employee tab map
            expect(EMPLOYEE_FIELD_TAB_MAP.emergencyContactRelation).toBe('address');
            expect(EMPLOYEE_FIELD_TAB_MAP.bankBranchName).toBe('bank');

            // In labels
            expect(getFieldLabel('emergencyContactRelation')).toBe('Emergency Contact Relationship');
            expect(getFieldLabel('bankBranchName')).toBe('Bank Branch Name');

            // In empty form values
            const emptyVals = emptyOnboardingFormValues();
            expect('emergencyContactRelation' in emptyVals).toBe(true);
            expect('bankBranchName' in emptyVals).toBe(true);
            expect(emptyVals.emergencyContactRelation).toBe('');
            expect(emptyVals.bankBranchName).toBe('');
        });

        it('verifies monthlyCtc is integrated in HR_ONBOARDING_FIELDS under organization section', () => {
            const ctcConfig = HR_ONBOARDING_FIELDS.find((f) => f.fieldKey === 'monthlyCtc');
            expect(ctcConfig).toBeDefined();
            expect(ctcConfig?.section).toBe('organization');
            expect(ctcConfig?.fieldLabel).toBe('Month CTC Pay');
            expect(getFieldLabel('monthlyCtc')).toBe('Month CTC Pay');
        });

        it('verifies getOnboardingSkipKeys correctly skips spouse keys for unmarried applicants', () => {
            const unmarriedStatuses = ['SINGLE', 'DIVORCED', 'WIDOWED', null, undefined];
            for (const status of unmarriedStatuses) {
                const skipped = getOnboardingSkipKeys(status, 'MALE');
                expect(skipped).toContain('wifeName');
                expect(skipped).toContain('wifeAge');
                expect(skipped).toContain('wifeAadhaarNumber');
                expect(skipped).toContain('husbandName');
                expect(skipped).toContain('husbandAadhaarNumber');
                expect(skipped).toContain('weddingDate');
            }
        });

        it('verifies getOnboardingSkipKeys correctly filters opposite-gender spouse keys for married applicants', () => {
            const maleSkipped = getOnboardingSkipKeys('MARRIED', 'MALE');
            expect(maleSkipped).toContain('husbandName');
            expect(maleSkipped).toContain('husbandAge');
            expect(maleSkipped).toContain('husbandAadhaarNumber');
            expect(maleSkipped).not.toContain('wifeName');
            expect(maleSkipped).not.toContain('weddingDate');

            const femaleSkipped = getOnboardingSkipKeys('MARRIED', 'FEMALE');
            expect(femaleSkipped).toContain('wifeName');
            expect(femaleSkipped).toContain('wifeAge');
            expect(femaleSkipped).toContain('wifeAadhaarNumber');
            expect(femaleSkipped).not.toContain('husbandName');
            expect(femaleSkipped).not.toContain('weddingDate');
        });

        it('verifies required-check logic: respects required when empty, passes when non-empty', () => {
            const isReq = (k: string) => k === 'bankBranchName' || k === 'emergencyContactRelation';

            // Empty values with required -> flagged
            const emptyValues: OnboardingFormValues = {
                ...emptyOnboardingFormValues(),
                bankBranchName: '',
                emergencyContactRelation: '',
            };
            const errors = validateOnboardingForm(emptyValues, isReq, true);
            expect(errors.bankBranchName).toBe(FIELD_ERROR_MESSAGES.REQUIRED);
            expect(errors.emergencyContactRelation).toBe(FIELD_ERROR_MESSAGES.REQUIRED);

            // Populated values with required -> passes
            const populatedValues: OnboardingFormValues = {
                ...emptyOnboardingFormValues(),
                bankBranchName: 'Main Branch',
                emergencyContactRelation: 'Spouse',
            };
            const validErrors = validateOnboardingForm(populatedValues, isReq, true);
            expect(validErrors.bankBranchName).toBeUndefined();
            expect(validErrors.emergencyContactRelation).toBeUndefined();
        });

        it('verifies optional fields without required flag never produce errors when empty', () => {
            const isNoneReq = () => false;
            const emptyValues = emptyOnboardingFormValues();
            const errors = validateOnboardingForm(emptyValues, isNoneReq, true);
            expect(Object.keys(errors).length).toBe(0);
        });

        it('verifies draft mode allows empty fields even when required in finalize mode', () => {
            const isAllReq = () => true;
            const emptyValues = emptyOnboardingFormValues();
            const draftErrors = validateOnboardingForm(emptyValues, isAllReq, false);
            expect(Object.keys(draftErrors).length).toBe(0);
        });
    });
});


