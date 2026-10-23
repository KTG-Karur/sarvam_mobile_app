import { describe, it, expect } from 'vitest';
import {
    isFieldApplicable,
    clearChildAadhaarErrors,
} from '@/app/lib/hr/onboarding-validation-rules';
import {
    onboardingFormFieldsSchema,
    validateOnboardingServerRules,
    getInapplicableSpouseKeys,
    getOnboardingSkipKeys,
    CONFIGURABLE_ONBOARDING_FIELD_KEYS,
} from '@/app/lib/hr/onboarding-form-fields';
import { findMissingRequiredEmployeeFields } from '@/app/lib/hr/employee-required-fields';
import { emptyOnboardingFormValues, toOnboardingApiPayload } from '@/components/hr/OnboardingRequestForm';

// Manual entry, the joinee link, draft resume and Employee Master edit must
// all agree on which fields apply and how blanks are saved.
describe('Onboarding / Employee Master entry parity', () => {
    describe('spouse-field applicability (one shared rule)', () => {
        it('married with other/blank gender shows no spouse details but still Wedding Date and Children', () => {
            for (const gender of ['OTHER', '', undefined]) {
                expect(isFieldApplicable('wifeName', 'MARRIED', gender)).toBe(false);
                expect(isFieldApplicable('husbandAadhaarNumber', 'MARRIED', gender)).toBe(false);
                expect(isFieldApplicable('weddingDate', 'MARRIED', gender)).toBe(true);
                expect(isFieldApplicable('children', 'MARRIED', gender)).toBe(true);
            }
        });

        it('every non-married status hides all spouse fields, Wedding Date and Children', () => {
            for (const status of ['SINGLE', 'DIVORCED', 'WIDOWED', '', undefined]) {
                for (const key of ['wifeName', 'husbandName', 'weddingDate', 'children']) {
                    expect(isFieldApplicable(key, status, 'MALE')).toBe(false);
                }
            }
        });

        it('server skip keys use the exact same rule as the client', () => {
            for (const status of ['MARRIED', 'SINGLE', 'DIVORCED', 'WIDOWED', null]) {
                for (const gender of ['MALE', 'FEMALE', 'OTHER', null]) {
                    expect(getOnboardingSkipKeys(status, gender)).toEqual(getInapplicableSpouseKeys(status, gender));
                }
            }
            expect(getOnboardingSkipKeys('MARRIED', 'OTHER')).not.toContain('weddingDate');
        });

        it('server rules only format-check the spouse whose fields the form actually shows', () => {
            const schema = onboardingFormFieldsSchema.superRefine(validateOnboardingServerRules);
            const badWife = { maritalStatus: 'MARRIED', wifeAadhaarNumber: '123' };
            expect(schema.safeParse({ ...badWife, gender: 'MALE' }).success).toBe(false);
            expect(schema.safeParse({ ...badWife, gender: 'OTHER' }).success).toBe(true);
            expect(schema.safeParse({ ...badWife, gender: 'FEMALE' }).success).toBe(true);
        });
    });

    describe('toOnboardingApiPayload (used by manual entry, drafts and the joinee link)', () => {
        it('sends null for a blanked configurable field so a draft save really clears it', () => {
            const payload = toOnboardingApiPayload({ ...emptyOnboardingFormValues(), employeeName: 'Asha', currentAddress: '   ' });
            expect(payload.employeeName).toBe('Asha');
            expect(payload.currentAddress).toBeNull();
            for (const key of CONFIGURABLE_ONBOARDING_FIELD_KEYS) {
                if (key === 'employeeName') continue;
                expect((payload as Record<string, unknown>)[key]).toBeNull();
            }
        });

        it('leaves the organization keys blank ("leave unchanged"), never null', () => {
            const payload = toOnboardingApiPayload(emptyOnboardingFormValues());
            expect(payload.branchId).toBe('');
            expect(payload.designationId).toBe('');
            expect(payload.departmentId).toBe('');
            expect(payload.reportingManagerId).toBe('');
            expect(payload.dateOfJoining).toBe('');
        });

        it('nulls spouse fields hidden by marital status/gender so stale values cannot linger', () => {
            const filled = {
                ...emptyOnboardingFormValues(),
                wifeName: 'Old Wife', wifeAge: '30', husbandName: 'Old Husband', weddingDate: '2020-01-01',
                children: [{ gender: 'MALE', age: '4', aadhaarNumber: '' }],
            };
            const single = toOnboardingApiPayload({ ...filled, maritalStatus: 'SINGLE', gender: 'MALE' });
            expect(single.wifeName).toBeNull();
            expect(single.wifeAge).toBeNull();
            expect(single.husbandName).toBeNull();
            expect(single.weddingDate).toBeNull();
            expect(single.children).toEqual([]);

            const marriedMale = toOnboardingApiPayload({ ...filled, maritalStatus: 'MARRIED', gender: 'MALE' });
            expect(marriedMale.wifeName).toBe('Old Wife');
            expect(marriedMale.wifeAge).toBe(30);
            expect(marriedMale.husbandName).toBeNull();
            expect(marriedMale.weddingDate).toBe('2020-01-01');
            expect(marriedMale.children).toHaveLength(1);

            const marriedOther = toOnboardingApiPayload({ ...filled, maritalStatus: 'MARRIED', gender: 'OTHER' });
            expect(marriedOther.wifeName).toBeNull();
            expect(marriedOther.husbandName).toBeNull();
            expect(marriedOther.weddingDate).toBe('2020-01-01');
        });
    });

    describe('clearChildAadhaarErrors', () => {
        const child = (aadhaarNumber: string) => ({ aadhaarNumber });

        it('clears only the edited child\'s error', () => {
            const errors = { 'children.0.aadhaarNumber': 'bad', 'children.1.aadhaarNumber': 'bad', mobileNumber: 'bad' };
            const result = clearChildAadhaarErrors(errors, [child('1'), child('2')], [child('1'), child('22')]);
            expect(result).toEqual({ 'children.0.aadhaarNumber': 'bad', mobileNumber: 'bad' });
        });

        it('drops the error of a removed child and returns the same object when nothing changed', () => {
            const errors = { 'children.1.aadhaarNumber': 'bad' };
            expect(clearChildAadhaarErrors(errors, [child('1'), child('2')], [child('1')])).toEqual({});
            expect(clearChildAadhaarErrors(errors, [child('1'), child('2')], [child('1'), child('2')])).toBe(errors);
        });
    });

    describe('findMissingRequiredEmployeeFields (Employee Master server-side check)', () => {
        const required = new Set(['dateOfBirth', 'mobileNumber', 'currentAddress', 'wifeName', 'weddingDate', 'departmentId']);

        it('flags required fields the payload blanks, mapping employee keys to config keys', () => {
            const missing = findMissingRequiredEmployeeFields(
                { dob: null, mobileNumber: '  ', address: '', departmentId: 'dept-1' },
                required,
                { maritalStatus: 'SINGLE', gender: 'MALE' }
            );
            expect(missing.sort()).toEqual(['currentAddress', 'dateOfBirth', 'mobileNumber']);
        });

        it('never blocks on a field the payload does not touch (e.g. the active toggle)', () => {
            expect(findMissingRequiredEmployeeFields({ isActive: false }, required, {})).toEqual([]);
        });

        it('ignores spouse fields the form hides for that marital status/gender', () => {
            const payload = { wifeName: null, weddingDate: null };
            expect(findMissingRequiredEmployeeFields(payload, required, { maritalStatus: 'SINGLE', gender: 'MALE' })).toEqual([]);
            expect(findMissingRequiredEmployeeFields(payload, required, { maritalStatus: 'MARRIED', gender: 'FEMALE' })).toEqual(['weddingDate']);
            expect(findMissingRequiredEmployeeFields(payload, required, { maritalStatus: 'MARRIED', gender: 'MALE' }).sort()).toEqual(['weddingDate', 'wifeName']);
        });

        it('only demands keys the admin marked required', () => {
            expect(findMissingRequiredEmployeeFields({ bloodGroup: null }, required, {})).toEqual([]);
        });
    });
});
