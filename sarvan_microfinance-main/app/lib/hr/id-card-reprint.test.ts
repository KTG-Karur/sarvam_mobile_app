import { describe, expect, it } from 'vitest';
import { computeIdCardFingerprint, type PrintedIdCardFields } from '@/app/lib/hr/id-card-reprint';

const printed: PrintedIdCardFields = {
    employeeId: 'SCT0042',
    fullName: 'Lakshmi Narayanan',
    photoKey: 'employees/SCT0042/photo-1.jpg',
    bloodGroup: 'B+',
    emergencyContactMobile: '9876543210',
    dateOfJoining: new Date('2023-06-12T00:00:00.000Z'),
    dateOfBirth: new Date('1995-03-04T00:00:00.000Z'),
    address: '12, Jawahar Bazaar, Karur',
};

const fp = (overrides: Partial<PrintedIdCardFields> = {}) => computeIdCardFingerprint({ ...printed, ...overrides });

describe('computeIdCardFingerprint', () => {
    it('is stable for the same printed details', () => {
        expect(fp()).toBe(fp());
    });

    it.each<[string, Partial<PrintedIdCardFields>]>([
        ['name', { fullName: 'Lakshmi N' }],
        ['photo', { photoKey: 'employees/SCT0042/photo-2.jpg' }],
        ['blood group', { bloodGroup: 'O+' }],
        ['emergency contact', { emergencyContactMobile: '9000000000' }],
        ['joining date', { dateOfJoining: new Date('2023-07-01T00:00:00.000Z') }],
        ['date of birth', { dateOfBirth: null }],
        ['address', { address: 'New address' }],
        ['employee code (also the QR)', { employeeId: 'SCT0043' }],
    ])('changes when the printed %s changes', (_label, change) => {
        expect(fp(change)).not.toBe(fp());
    });

    it('ignores whitespace-only differences and the time of day on dates', () => {
        expect(fp({ fullName: '  Lakshmi Narayanan ', dateOfJoining: new Date('2023-06-12T10:15:00.000Z') })).toBe(fp());
    });
});
