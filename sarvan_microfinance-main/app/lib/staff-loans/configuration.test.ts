import { describe, expect, it } from 'vitest';
import { resolveMasterCapabilities, SCHEME_PAGE, schemeSchema, workflowSchema } from './configuration';
import { getApplicableActions } from '@/app/lib/permissions/page-permission-tree';

const validScheme = () => ({
    code: 'TEST', name: 'Test scheme', description: '', minimumServiceMonths: 6, minimumSalaryPerMonth: 0,
    amountBasis: 'FIXED_AMOUNT', maximumAmount: 20000, salaryMultiplier: null,
    maximumTenureMonths: 12, maximumActiveLoans: 1,
    interestType: 'INTEREST_FREE', annualInterestRate: 0,
    isActive: true,
    branchIds: [], departmentIds: [], roleIds: [], salaryBasisComponentIds: [],
});

describe('staff loan scheme policy validation', () => {
    it('accepts explicit interest-free, flat and monthly schemes', () => {
        expect(schemeSchema.safeParse(validScheme()).success).toBe(true);
        expect(schemeSchema.safeParse({ ...validScheme(), interestType: 'FLAT', annualInterestRate: 8.125 }).success).toBe(true);
        expect(schemeSchema.safeParse({ ...validScheme(), interestType: 'MONTHLY', annualInterestRate: 1 }).success).toBe(true);
        expect(schemeSchema.safeParse({ ...validScheme(), minimumSalaryPerMonth: 15000 }).success).toBe(true);
    });
    it.each([
        { maximumTenureMonths: 0 }, { minimumServiceMonths: -1 }, { maximumActiveLoans: 0 },
        { maximumAmount: 100.001 }, { annualInterestRate: 2 },
        { interestType: 'FLAT', annualInterestRate: 0 },
        { interestType: 'MONTHLY', annualInterestRate: 0 },
        { minimumSalaryPerMonth: -1 },
        { branchIds: ['same', 'same'] },
        { maximumAmount: NaN },
        { isActive: 'true' }, { createdById: 'forged-actor' },
    ])('rejects invalid financial configuration %j', patch => {
        expect(schemeSchema.safeParse({ ...validScheme(), ...patch }).success).toBe(false);
    });
    it('requires salary basis for salary multiples and rejects conflicting fixed limits', () => {
        const input = { ...validScheme(), amountBasis: 'SALARY_MULTIPLE', maximumAmount: null, salaryMultiplier: 2 };
        expect(schemeSchema.safeParse(input).success).toBe(false);
        expect(schemeSchema.safeParse({ ...input, salaryBasisComponentIds: ['earnings-component'] }).success).toBe(true);
        expect(schemeSchema.safeParse({ ...input, maximumAmount: 1000, salaryBasisComponentIds: ['earnings-component'] }).success).toBe(false);
    });
});

describe('staff loan workflow configuration', () => {
    const input = { expectedConfigId: null, name: 'Configured review', isActive: true, salaryDay: 5,
        stages: [{ levelOrder: 1, stageName: 'Review', roleId: 'custom-role' }], disbursementRoleIds: ['other-role'] };
    it('accepts a custom approver and disburser without a fixed admin stage', () => {
        expect(workflowSchema.parse(input).stages).toEqual(input.stages);
    });
    it('requires a salary date that is a whole day between 1 and 31', () => {
        for (const day of [1, 15, 28, 31]) expect(workflowSchema.safeParse({ ...input, salaryDay: day }).success).toBe(true);
        for (const day of [0, 32, -3, 4.5, NaN, '5', null, undefined]) {
            expect(workflowSchema.safeParse({ ...input, salaryDay: day }).success).toBe(false);
        }
        const { salaryDay: _omitted, ...withoutSalaryDay } = input;
        const missing = workflowSchema.safeParse(withoutSalaryDay);
        expect(missing.success).toBe(false);
        expect(!missing.success && missing.error.issues[0].message).toContain('salary date');
    });
    it('rejects missing approval, missing disburser and gaps in stage order', () => {
        expect(workflowSchema.safeParse({ ...input, stages: [] }).success).toBe(false);
        expect(workflowSchema.safeParse({ ...input, disbursementRoleIds: [] }).success).toBe(false);
        expect(workflowSchema.safeParse({ ...input, stages: [{ ...input.stages[0], levelOrder: 2 }] }).success).toBe(false);
    });
});

describe('staff loan master permissions', () => {
    it('fails closed without grants and treats old boolean permissions as view only', () => {
        expect(resolveMasterCapabilities(false, [null], SCHEME_PAGE)).toEqual({ view: false, add: false, edit: false });
        expect(resolveMasterCapabilities(false, [{ [SCHEME_PAGE]: true }], SCHEME_PAGE)).toEqual({ view: true, add: false, edit: false });
    });
    it('unions explicit page grants and requires view before write', () => {
        expect(resolveMasterCapabilities(false, [{ [SCHEME_PAGE]: { add: true } }], SCHEME_PAGE).add).toBe(false);
        expect(resolveMasterCapabilities(false, [{ [SCHEME_PAGE]: { view: true } }, { [SCHEME_PAGE]: { edit: true } }], SCHEME_PAGE))
            .toEqual({ view: true, add: false, edit: true });
        expect(resolveMasterCapabilities(false, [{ '/another-page': { view: true, edit: true } }], SCHEME_PAGE).edit).toBe(false);
    });
    it('preserves administrator access and exposes no delete action', () => {
        expect(resolveMasterCapabilities(true, [], SCHEME_PAGE)).toEqual({ view: true, add: true, edit: true });
        expect(getApplicableActions(SCHEME_PAGE)).toEqual(['view', 'add', 'edit']);
    });
});
