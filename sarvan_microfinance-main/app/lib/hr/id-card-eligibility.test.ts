import { describe, expect, it } from 'vitest';
import { evaluateIdCardEligibility, summarizeIdCardStatus, type IdCardEligibilityInput } from '@/app/lib/hr/id-card-eligibility';

// 2026-10-21 12:00 IST
const NOW = new Date('2026-10-21T06:30:00.000Z');

const complete: IdCardEligibilityInput = {
    isActive: true,
    dateOfExit: null,
    employeeId: 'SCT0042',
    fullName: 'Lakshmi Narayanan',
    designation: 'Field Development Officer',
    branchName: 'Karur Main',
    dateOfJoining: new Date('2023-06-12T00:00:00.000Z'),
    bloodGroup: 'B+',
    emergencyContactMobile: '9876543210',
    photoKey: 'employees/SCT0042/photo.jpg',
};

const codes = (input: IdCardEligibilityInput) => evaluateIdCardEligibility(input, NOW).issues.map((i) => i.code);

describe('evaluateIdCardEligibility', () => {
    it('issues a card to an active employee with every card field filled', () => {
        expect(evaluateIdCardEligibility(complete, NOW)).toEqual({ eligible: true, issues: [] });
    });

    it('blocks an inactive employee', () => {
        expect(codes({ ...complete, isActive: false })).toEqual(['INACTIVE']);
    });

    it('blocks an employee whose last working day has passed, even if still flagged active', () => {
        expect(codes({ ...complete, dateOfExit: new Date('2026-10-20T00:00:00.000Z') })).toEqual(['EXITED']);
    });

    it('still issues a card on the last working day (serving notice)', () => {
        expect(evaluateIdCardEligibility({ ...complete, dateOfExit: new Date('2026-10-21T00:00:00.000Z') }, NOW).eligible).toBe(true);
    });

    it('lists every missing card field, treating blank strings as missing', () => {
        expect(
            codes({
                ...complete,
                employeeId: null,
                designation: null,
                branchName: '  ',
                dateOfJoining: null,
                bloodGroup: '',
                emergencyContactMobile: null,
                photoKey: null,
            })
        ).toEqual([
            'NO_EMPLOYEE_ID',
            'NO_DESIGNATION',
            'NO_BRANCH',
            'NO_DATE_OF_JOINING',
            'NO_BLOOD_GROUP',
            'NO_EMERGENCY_CONTACT',
            'NO_PHOTO',
        ]);
    });

    it('blocks an Employee ID containing whitespace (would resolve to another person on the QR page)', () => {
        expect(codes({ ...complete, employeeId: 'ST089 ' })).toEqual(['INVALID_EMPLOYEE_ID']);
        expect(codes({ ...complete, employeeId: 'ST221\t' })).toEqual(['INVALID_EMPLOYEE_ID']);
    });

    it('treats the seeded "To Be Assigned" designation as not assigned', () => {
        expect(codes({ ...complete, designation: 'To Be Assigned', designationIsPlaceholder: true })).toEqual(['NO_DESIGNATION']);
    });

    it('summarizes status for list badges: employment problems outrank missing details', () => {
        expect(summarizeIdCardStatus(evaluateIdCardEligibility(complete, NOW))).toBe('ELIGIBLE');
        expect(summarizeIdCardStatus(evaluateIdCardEligibility({ ...complete, photoKey: null }, NOW))).toBe('INCOMPLETE');
        expect(summarizeIdCardStatus(evaluateIdCardEligibility({ ...complete, isActive: false, photoKey: null }, NOW))).toBe(
            'NOT_EMPLOYED'
        );
    });

    it('reports both an employment problem and missing details together', () => {
        expect(codes({ ...complete, isActive: false, photoKey: null })).toEqual(['INACTIVE', 'NO_PHOTO']);
    });
});
