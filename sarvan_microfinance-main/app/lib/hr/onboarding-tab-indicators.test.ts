import { describe, it, expect } from 'vitest';
import {
    validateSingleField,
} from '@/app/lib/hr/onboarding-validation-rules';
import {
    emptyOnboardingFormValues,
    type OnboardingFormValues,
    type SectionId,
} from '@/components/hr/OnboardingRequestForm';
import {
    CHILD_FIELD_CONFIG_KEYS,
    type ChildFieldName,
    getInapplicableSpouseKeys,
} from '@/app/lib/hr/onboarding-form-fields';

function isFieldFilled(value: unknown): boolean {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.trim() !== '';
    return Boolean(value);
}

const SECTION_FIELDS: Record<SectionId, (keyof OnboardingFormValues)[]> = {
    personal: ['employeeName', 'mobileNumber', 'email', 'dateOfBirth', 'gender', 'maritalStatus', 'bloodGroup', 'educationQualification'],
    address: ['currentAddress', 'permanentAddress', 'emergencyContactName', 'emergencyContactRelation', 'emergencyContactNumber'],
    identity: ['aadhaarNumber', 'panNumber', 'dlNumber', 'voterIdNumber', 'uanNumber', 'esiNumber'],
    bank: ['bankName', 'bankBranchName', 'accountNumber', 'ifscCode'],
    insurance: ['insuranceCompanyName', 'insurancePolicyNumber', 'insuranceValidFrom', 'insuranceValidTo'],
    family: ['fatherName', 'fatherAge', 'fatherAadhaarNumber', 'motherName', 'motherAge', 'motherAadhaarNumber',
        'wifeName', 'wifeAge', 'wifeAadhaarNumber', 'wifeBankAccountNumber', 'wifeIfscCode', 'wifeContactNumber',
        'husbandName', 'husbandAge', 'husbandAadhaarNumber', 'husbandBankAccountNumber', 'husbandIfscCode', 'husbandContactNumber',
        'weddingDate'],
    documents: [],
};

function createSectionComplete(
    values: OnboardingFormValues,
    reqFn: (field: string) => boolean,
    errors: Record<string, string> = {}
) {
    const sectionHasErrors = (id: SectionId): boolean => {
        if (!errors || Object.keys(errors).length === 0) return false;
        if (id === 'family') {
            const familyErrors = SECTION_FIELDS.family.filter((f) => Boolean(errors[f])).length;
            const childErrors = Object.keys(errors).filter((k) => k.startsWith('children.') && Boolean(errors[k])).length;
            return familyErrors + childErrors > 0;
        }
        return SECTION_FIELDS[id].filter((f) => Boolean(errors[f])).length > 0;
    };

    return (id: SectionId): boolean => {
        if (id === 'personal') {
            const requiredFields = SECTION_FIELDS.personal.filter(
                (f) => reqFn(f) || ['employeeName', 'mobileNumber', 'dateOfBirth', 'gender'].includes(f)
            );
            if (sectionHasErrors('personal')) return false;

            const allRequiredValid = requiredFields.every((field) => {
                const val = values[field];
                if (!isFieldFilled(val)) return false;
                return validateSingleField(field, val, values, true) === null;
            });
            if (!allRequiredValid) return false;

            const optionalFields = SECTION_FIELDS.personal.filter((f) => !requiredFields.includes(f));
            const allOptionalValid = optionalFields.every((field) => {
                const val = values[field];
                if (!isFieldFilled(val)) return true;
                return validateSingleField(field, val, values, false) === null;
            });
            return allOptionalValid;
        }

        if (id === 'address') {
            const requiredFields = SECTION_FIELDS.address.filter(
                (f) => reqFn(f) || ['currentAddress', 'permanentAddress'].includes(f)
            );
            if (sectionHasErrors('address')) return false;

            const allRequiredValid = requiredFields.every((field) => {
                const val = values[field];
                if (!isFieldFilled(val)) return false;
                return validateSingleField(field, val, values, true) === null;
            });
            if (!allRequiredValid) return false;

            const optionalFields = SECTION_FIELDS.address.filter((f) => !requiredFields.includes(f));
            const allOptionalValid = optionalFields.every((field) => {
                const val = values[field];
                if (!isFieldFilled(val)) return true;
                return validateSingleField(field, val, values, false) === null;
            });
            return allOptionalValid;
        }

        if (id !== 'family') {
            return SECTION_FIELDS[id].every((field) => !reqFn(field) || isFieldFilled(values[field] as string));
        }
        const notShown = getInapplicableSpouseKeys(values.maritalStatus, values.gender);
        const fields = SECTION_FIELDS.family.filter((field) => !notShown.includes(field));
        const childrenComplete = values.maritalStatus !== 'MARRIED' || values.children.every((child) =>
            (Object.keys(CHILD_FIELD_CONFIG_KEYS) as ChildFieldName[]).every((f) => !reqFn(CHILD_FIELD_CONFIG_KEYS[f]) || isFieldFilled(child[f])));
        return childrenComplete && fields.every((field) => !reqFn(field) || isFieldFilled(values[field] as string));
    };
}

describe('Onboarding Tab Completion Indicators', () => {
    const defaultReq = (field: string) => ['employeeName', 'mobileNumber', 'dateOfBirth', 'gender'].includes(field);

    describe('Personal Details Tab', () => {
        it('is incomplete when empty', () => {
            const values = emptyOnboardingFormValues();
            const sectionComplete = createSectionComplete(values, defaultReq);
            expect(sectionComplete('personal')).toBe(false);
        });

        it('is complete when core required fields are validly filled and optional fields are empty', () => {
            const values = emptyOnboardingFormValues();
            values.employeeName = 'John Doe';
            values.mobileNumber = '9876543210';
            values.dateOfBirth = '1995-05-15';
            values.gender = 'MALE';

            const sectionComplete = createSectionComplete(values, defaultReq);
            expect(sectionComplete('personal')).toBe(true);
        });

        it('becomes incomplete immediately when mobile number is invalid (< 10 digits)', () => {
            const values = emptyOnboardingFormValues();
            values.employeeName = 'John Doe';
            values.mobileNumber = '98765';
            values.dateOfBirth = '1995-05-15';
            values.gender = 'MALE';

            const sectionComplete = createSectionComplete(values, defaultReq);
            expect(sectionComplete('personal')).toBe(false);
        });

        it('becomes incomplete immediately when DOB is underage (< 18)', () => {
            const values = emptyOnboardingFormValues();
            values.employeeName = 'John Doe';
            values.mobileNumber = '9876543210';
            values.dateOfBirth = '2020-01-01';
            values.gender = 'MALE';

            const sectionComplete = createSectionComplete(values, defaultReq);
            expect(sectionComplete('personal')).toBe(false);
        });

        it('becomes incomplete if optional email is formatted invalidly', () => {
            const values = emptyOnboardingFormValues();
            values.employeeName = 'John Doe';
            values.mobileNumber = '9876543210';
            values.dateOfBirth = '1995-05-15';
            values.gender = 'MALE';
            values.email = 'not-an-email';

            const sectionComplete = createSectionComplete(values, defaultReq);
            expect(sectionComplete('personal')).toBe(false);
        });

        it('is complete when optional email is valid', () => {
            const values = emptyOnboardingFormValues();
            values.employeeName = 'John Doe';
            values.mobileNumber = '9876543210';
            values.dateOfBirth = '1995-05-15';
            values.gender = 'MALE';
            values.email = 'john@example.com';

            const sectionComplete = createSectionComplete(values, defaultReq);
            expect(sectionComplete('personal')).toBe(true);
        });
    });

    describe('Address Tab', () => {
        it('is incomplete when empty', () => {
            const values = emptyOnboardingFormValues();
            const sectionComplete = createSectionComplete(values, defaultReq);
            expect(sectionComplete('address')).toBe(false);
        });

        it('is complete when current and permanent addresses are filled', () => {
            const values = emptyOnboardingFormValues();
            values.currentAddress = '123 Main St, City';
            values.permanentAddress = '456 Cross St, Town';

            const sectionComplete = createSectionComplete(values, defaultReq);
            expect(sectionComplete('address')).toBe(true);
        });

        it('becomes incomplete if optional emergencyContactNumber is invalid (< 10 digits)', () => {
            const values = emptyOnboardingFormValues();
            values.currentAddress = '123 Main St, City';
            values.permanentAddress = '456 Cross St, Town';
            values.emergencyContactNumber = '12345';

            const sectionComplete = createSectionComplete(values, defaultReq);
            expect(sectionComplete('address')).toBe(false);
        });

        it('is complete when optional emergency contact is filled validly', () => {
            const values = emptyOnboardingFormValues();
            values.currentAddress = '123 Main St, City';
            values.permanentAddress = '456 Cross St, Town';
            values.emergencyContactName = 'Jane Doe';
            values.emergencyContactRelation = 'Sister';
            values.emergencyContactNumber = '9123456780';

            const sectionComplete = createSectionComplete(values, defaultReq);
            expect(sectionComplete('address')).toBe(true);
        });
    });

    describe('Other Tabs Preservation', () => {
        it('preserves Identity & Statutory completion logic', () => {
            const values = emptyOnboardingFormValues();
            const reqFn = (f: string) => f === 'aadhaarNumber';
            const sectionComplete = createSectionComplete(values, reqFn);

            expect(sectionComplete('identity')).toBe(false);
            values.aadhaarNumber = '123456789012';
            expect(sectionComplete('identity')).toBe(true);
        });

        it('preserves Bank Details completion logic', () => {
            const values = emptyOnboardingFormValues();
            const reqFn = (f: string) => f === 'accountNumber';
            const sectionComplete = createSectionComplete(values, reqFn);

            expect(sectionComplete('bank')).toBe(false);
            values.accountNumber = '987654321123';
            expect(sectionComplete('bank')).toBe(true);
        });
    });
});

