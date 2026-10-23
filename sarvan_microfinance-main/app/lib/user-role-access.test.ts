import { describe, expect, it, vi } from 'vitest';
import { evaluateApiRoleAccess } from './user-role-access';

describe('evaluateApiRoleAccess', () => {
    it('lets Admin through regardless of the route allow-list', () => {
        expect(
            evaluateApiRoleAccess({
                userRole: 'ADMIN',
                allowedRoles: ['FDO'],
            })
        ).toBe(true);

        expect(
            evaluateApiRoleAccess({
                userRole: 'ADMIN',
                allowedRoles: [],
            })
        ).toBe(true);
    });

    it('matches when the user role is directly in the allow-list', () => {
        expect(
            evaluateApiRoleAccess({
                userRole: 'BRANCH_MANAGER',
                allowedRoles: ['BRANCH_MANAGER', 'AREA_MANAGER'],
            })
        ).toBe(true);
    });

    it('denies a non-admin role that is not in the allow-list', () => {
        expect(
            evaluateApiRoleAccess({
                userRole: 'FDO',
                allowedRoles: ['BRANCH_MANAGER', 'AREA_MANAGER'],
            })
        ).toBe(false);
    });

    it('lets Admin through a route scoped to a single unrelated role', () => {
        expect(
            evaluateApiRoleAccess({
                userRole: 'ADMIN',
                allowedRoles: ['FDO'],
            })
        ).toBe(true);
    });
});

describe('userMatchesAllowedApiRoles — Sub Admin RBAC role', () => {
    const user = { userId: 'u1', role: 'FDO' } as never;

    it('lets a user with an active Sub Admin role through an ADMIN-only route', async () => {
        vi.resetModules();
        vi.doMock('@/app/lib/permissions/sub-admin', () => ({ isSubAdminUser: vi.fn().mockResolvedValue(true) }));
        const { userMatchesAllowedApiRoles } = await import('./user-role-access');
        expect(await userMatchesAllowedApiRoles(user, ['ADMIN'])).toBe(true);
    });

    it('still denies a user without the Sub Admin role', async () => {
        vi.resetModules();
        vi.doMock('@/app/lib/permissions/sub-admin', () => ({ isSubAdminUser: vi.fn().mockResolvedValue(false) }));
        const { userMatchesAllowedApiRoles } = await import('./user-role-access');
        expect(await userMatchesAllowedApiRoles(user, ['ADMIN'])).toBe(false);
    });

    it('fails closed when the Sub Admin lookup throws', async () => {
        vi.resetModules();
        vi.doMock('@/app/lib/permissions/sub-admin', () => ({ isSubAdminUser: vi.fn().mockRejectedValue(new Error('db down')) }));
        const { userMatchesAllowedApiRoles } = await import('./user-role-access');
        expect(await userMatchesAllowedApiRoles(user, ['ADMIN'])).toBe(false);
    });
});
