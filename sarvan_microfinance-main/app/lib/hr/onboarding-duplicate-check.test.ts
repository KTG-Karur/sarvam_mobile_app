import { describe, expect, it } from 'vitest';
import { normalize, checkOnboardingDuplicates } from '@/app/lib/hr/onboarding-duplicate-check';

/**
 * Minimal fake Prisma client — only implements the two calls
 * checkOnboardingDuplicates actually makes. `activeUser`/`inactiveUser` are
 * returned from user.findFirst based on the isActive flag in the query's
 * where clause (mirroring the real active-block-check vs. rejoiner-hint-check
 * queries); `request` is returned from employeeOnboardingRequest.findFirst.
 */
type FakeDb = Parameters<typeof checkOnboardingDuplicates>[0];

function makeFakeDb(fixtures: {
    activeUser?: { employeeId: string; firstName: string; lastName: string } | null;
    inactiveUser?: { employeeId: string; firstName: string; lastName: string; dateOfExit: Date | null } | null;
    request?: { employeeName: string; status: string } | null;
}): FakeDb {
    return {
        user: {
            findFirst: async ({ where }: { where: { isActive: boolean } }) => {
                if (where.isActive) return fixtures.activeUser ?? null;
                return fixtures.inactiveUser ?? null;
            },
        },
        employeeOnboardingRequest: {
            findFirst: async () => fixtures.request ?? null,
        },
    } as unknown as FakeDb;
}

describe('normalize', () => {
    it('normalizes mobile: strips non-digits, handles +91/leading-0 prefixes', () => {
        expect(normalize('mobileNumber', '9876543210')).toBe('9876543210');
        expect(normalize('mobileNumber', '+91 98765 43210')).toBe('9876543210');
        expect(normalize('mobileNumber', '919876543210')).toBe('9876543210');
        expect(normalize('mobileNumber', '09876543210')).toBe('9876543210');
    });

    it('normalizes Aadhaar to digits-only', () => {
        expect(normalize('aadhaarNumber', '1234 5678 9012')).toBe('123456789012');
        expect(normalize('aadhaarNumber', '1234-5678-9012')).toBe('123456789012');
        expect(normalize('aadhaarNumber', '123456789012')).toBe('123456789012');
    });

    it('normalizes UAN to digits-only', () => {
        expect(normalize('uanNumber', '100 200 300 400')).toBe('100200300400');
    });

    it('normalizes PAN to uppercase, trimmed', () => {
        expect(normalize('panNumber', 'abcde1234f')).toBe('ABCDE1234F');
        expect(normalize('panNumber', '  ABCDE1234F  ')).toBe('ABCDE1234F');
    });

    it('normalizes DL number to uppercase, spaces stripped', () => {
        expect(normalize('dlNumber', 'tn 07 20230012345')).toBe('TN0720230012345');
    });

    it('normalizes Voter ID to uppercase, spaces stripped', () => {
        expect(normalize('voterIdNumber', 'abc 1234567')).toBe('ABC1234567');
    });

    it('returns null for blank/whitespace-only/null/undefined input, for every field', () => {
        const fields = ['mobileNumber', 'aadhaarNumber', 'panNumber', 'dlNumber', 'voterIdNumber', 'uanNumber'] as const;
        for (const field of fields) {
            expect(normalize(field, '')).toBeNull();
            expect(normalize(field, '   ')).toBeNull();
            expect(normalize(field, null)).toBeNull();
            expect(normalize(field, undefined)).toBeNull();
        }
    });
});

describe('checkOnboardingDuplicates — rejoinerHint (informational, never blocks)', () => {
    it('surfaces a rejoinerHint when the only match is an inactive user (allowed, not blocked)', async () => {
        const db = makeFakeDb({
            activeUser: null,
            request: null,
            inactiveUser: { employeeId: 'EMP-100', firstName: 'Old', lastName: 'Employee', dateOfExit: new Date('2025-01-15') },
        });
        const result = await checkOnboardingDuplicates(db, { aadhaarNumber: '123456789012' });
        expect(result.hit).toBeNull();
        expect(result.rejoinerHint).toEqual({
            field: 'aadhaarNumber',
            employeeId: 'EMP-100',
            name: 'Old Employee',
            dateOfExit: new Date('2025-01-15'),
        });
    });

    it('never surfaces a rejoinerHint when an active-user block already fired (short-circuit)', async () => {
        const db = makeFakeDb({
            activeUser: { employeeId: 'EMP-200', firstName: 'Active', lastName: 'Employee' },
            request: null,
            inactiveUser: { employeeId: 'EMP-100', firstName: 'Old', lastName: 'Employee', dateOfExit: new Date('2025-01-15') },
        });
        const result = await checkOnboardingDuplicates(db, { aadhaarNumber: '123456789012' });
        expect(result.hit).not.toBeNull();
        expect(result.hit?.source).toBe('employee');
        expect(result.rejoinerHint).toBeNull();
    });

    it('never surfaces a rejoinerHint when an in-flight request block already fired (short-circuit)', async () => {
        const db = makeFakeDb({
            activeUser: null,
            request: { employeeName: 'Someone Else', status: 'SUBMITTED' },
            inactiveUser: { employeeId: 'EMP-100', firstName: 'Old', lastName: 'Employee', dateOfExit: new Date('2025-01-15') },
        });
        const result = await checkOnboardingDuplicates(db, { aadhaarNumber: '123456789012' });
        expect(result.hit).not.toBeNull();
        expect(result.hit?.source).toBe('request');
        expect(result.rejoinerHint).toBeNull();
    });

    it('returns both null when nothing (active, request, or inactive) matches', async () => {
        const db = makeFakeDb({ activeUser: null, request: null, inactiveUser: null });
        const result = await checkOnboardingDuplicates(db, { aadhaarNumber: '123456789012' });
        expect(result.hit).toBeNull();
        expect(result.rejoinerHint).toBeNull();
    });

    it('never queries or hints on a blank/absent field', async () => {
        const db = makeFakeDb({
            activeUser: null,
            request: null,
            inactiveUser: { employeeId: 'EMP-100', firstName: 'Old', lastName: 'Employee', dateOfExit: null },
        });
        // aadhaarNumber present-but-blank normalizes to null and is skipped
        // entirely — it must never surface a hint even though the fixture
        // would otherwise report an inactive match for any field checked.
        const result = await checkOnboardingDuplicates(db, { aadhaarNumber: '   ' });
        expect(result.hit).toBeNull();
        expect(result.rejoinerHint).toBeNull();
    });
});
