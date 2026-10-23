import { describe, expect, it, vi } from 'vitest';

const findMany = vi.fn();
vi.mock('@/app/lib/db', () => ({ prisma: { areaManagerBranch: { findMany: (...args: unknown[]) => findMany(...args) } } }));
vi.mock('./engine', () => ({ loadUserContext: vi.fn(), checkPermission: vi.fn() }));
const getOrgScope = vi.fn();
vi.mock('./org-scope', () => ({ getOrgScope: (...args: unknown[]) => getOrgScope(...args) }));
vi.mock('@/app/lib/auth/jwt', () => ({ verifyAccessToken: vi.fn() }));

import { isEmployeeBranchPermitted, isEmployeeInCallerScope, getEmployeeAreaBranchIds } from './guards';
import type { UserContext } from './types';

function ctx(overrides: Partial<UserContext> = {}): UserContext {
    return {
        userId: 'caller',
        email: '',
        firstName: '',
        lastName: '',
        isActive: true,
        branchId: 'b-karur',
        isHeadOffice: false,
        roles: [{ roleId: 'r1', roleName: 'HR', roleSlug: 'hr', priority: 1, branchId: null }],
        permissions: { granted: new Set(), denied: new Set(), conditions: new Map() },
        branchAccess: [{ branchId: 'b-karur' }],
        fieldPermissions: {},
        reportPermissions: {},
        ...overrides,
    } as unknown as UserContext;
}

describe('isEmployeeBranchPermitted', () => {
    it('allows an employee in one of the caller’s branches and denies one outside them', () => {
        expect(isEmployeeBranchPermitted(ctx(), 'b-karur')).toBe(true);
        expect(isEmployeeBranchPermitted(ctx(), 'b-cumbum')).toBe(false);
    });

    it('lets head-office callers see everyone', () => {
        expect(isEmployeeBranchPermitted(ctx({ isHeadOffice: true, branchAccess: [] }), 'b-cumbum')).toBe(true);
    });

    it('lets an admin with no branch of their own (e.g. the CEO) see everyone', () => {
        const admin = ctx({
            branchId: null,
            branchAccess: [],
            roles: [{ roleId: 'r0', roleName: 'Admin', roleSlug: 'admin', priority: 0, branchId: null }],
        } as Partial<UserContext>);
        expect(isEmployeeBranchPermitted(admin, 'b-cumbum')).toBe(true);
        expect(isEmployeeBranchPermitted(admin, null)).toBe(true);
    });

    it('reaches an Area Manager (branchId null) through their assigned branches', () => {
        expect(isEmployeeBranchPermitted(ctx(), null)).toBe(false);
        expect(isEmployeeBranchPermitted(ctx(), null, ['b-cumbum', 'b-karur'])).toBe(true);
        expect(isEmployeeBranchPermitted(ctx(), null, ['b-cumbum'])).toBe(false);
    });
});

describe('getEmployeeAreaBranchIds', () => {
    it('skips the lookup for anyone with a User.branchId', async () => {
        findMany.mockClear();
        expect(await getEmployeeAreaBranchIds('u1', 'b-karur')).toEqual([]);
        expect(findMany).not.toHaveBeenCalled();
    });

    it('returns an Area Manager’s branch ids', async () => {
        findMany.mockResolvedValueOnce([{ branchId: 'b-cumbum' }, { branchId: 'b-karur' }]);
        expect(await getEmployeeAreaBranchIds('am1', null)).toEqual(['b-cumbum', 'b-karur']);
    });
});

describe('isEmployeeInCallerScope (org scope, same as the Employee List)', () => {
    it('does not consult org scope when the branch rule already allows it', async () => {
        getOrgScope.mockClear();
        expect(await isEmployeeInCallerScope(ctx(), 'b-karur')).toBe(true);
        expect(getOrgScope).not.toHaveBeenCalled();
    });

    it('allows a caller with Head Office assigned in Manage Branches', async () => {
        getOrgScope.mockResolvedValueOnce({ headOffice: true, branchIds: [] });
        expect(await isEmployeeInCallerScope(ctx({ branchAccess: [] }), 'b-cumbum')).toBe(true);
    });

    it('allows employees in branches covered by the caller’s Region/Division/Area', async () => {
        getOrgScope.mockResolvedValueOnce({ headOffice: false, branchIds: ['b-cumbum'] });
        expect(await isEmployeeInCallerScope(ctx({ branchAccess: [] }), 'b-cumbum')).toBe(true);
    });

    it('denies when neither branch access nor org scope covers the employee', async () => {
        getOrgScope.mockResolvedValueOnce(null);
        expect(await isEmployeeInCallerScope(ctx(), 'b-cumbum')).toBe(false);
        getOrgScope.mockResolvedValueOnce({ headOffice: false, branchIds: ['b-sattur'] });
        expect(await isEmployeeInCallerScope(ctx(), 'b-cumbum')).toBe(false);
    });
});
