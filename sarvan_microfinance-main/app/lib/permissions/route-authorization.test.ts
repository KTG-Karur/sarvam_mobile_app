import { describe, expect, it } from 'vitest';
import {
    computeEffectiveRole,
    isHeadOfficeBranchInfo,
    resolvePageAuthorization,
} from './route-authorization';

describe('isHeadOfficeBranchInfo', () => {
    it('is true for branch code HO (case-insensitive)', () => {
        expect(isHeadOfficeBranchInfo({ code: 'ho', name: 'Main' })).toBe(true);
        expect(isHeadOfficeBranchInfo({ code: 'HO', name: 'Main' })).toBe(true);
    });

    it('is true for branch name "head office" (case-insensitive)', () => {
        expect(isHeadOfficeBranchInfo({ code: 'X1', name: 'Head Office' })).toBe(true);
    });

    it('is false for a regular branch', () => {
        expect(isHeadOfficeBranchInfo({ code: 'BR01', name: 'Salem Branch' })).toBe(false);
    });

    it('is false for null/undefined branch', () => {
        expect(isHeadOfficeBranchInfo(null)).toBe(false);
        expect(isHeadOfficeBranchInfo(undefined)).toBe(false);
    });
});

describe('computeEffectiveRole', () => {
    it('passes non-ADMIN roles through unchanged', () => {
        expect(computeEffectiveRole('FDO', { code: 'HO' })).toBe('FDO');
        expect(computeEffectiveRole('BRANCH_MANAGER', { code: 'BR01' })).toBe('BRANCH_MANAGER');
    });

    it('keeps ADMIN as ADMIN when branch is Head Office', () => {
        expect(computeEffectiveRole('ADMIN', { code: 'HO' })).toBe('ADMIN');
    });

    it('keeps ADMIN as ADMIN on a non-HO branch — no downgrade, Admin is always unrestricted', () => {
        expect(computeEffectiveRole('ADMIN', { code: 'BR01', name: 'Salem Branch' })).toBe('ADMIN');
    });

    it('defaults ADMIN to ADMIN when branch info is not yet known', () => {
        expect(computeEffectiveRole('ADMIN', null)).toBe('ADMIN');
    });
});

describe('resolvePageAuthorization', () => {
    const base = {
        userRole: 'FDO',
        effectiveRole: 'FDO',
        pathname: '/dashboard/reports/collection/dcb',
        pagePermissions: null,
        permissionsHydrated: false,
    };

    it('allows Head-Office Admin unconditionally, even with a failing legacy check', () => {
        const decision = resolvePageAuthorization({
            ...base,
            userRole: 'ADMIN',
            effectiveRole: 'ADMIN',
            requiredRoles: ['BRANCH_MANAGER'],
        });
        expect(decision).toBe('allow');
    });

    it('allows through when no requiredPermission/requiredRoles are configured', () => {
        expect(resolvePageAuthorization({ ...base })).toBe('allow');
    });

    it('allows immediately via the legacy requiredRoles check, without needing RBAC data', () => {
        const decision = resolvePageAuthorization({
            ...base,
            userRole: 'BRANCH_MANAGER',
            effectiveRole: 'BRANCH_MANAGER',
            requiredRoles: ['BRANCH_MANAGER', 'AREA_MANAGER'],
        });
        expect(decision).toBe('allow');
    });

    it('allows Admin unconditionally even if a stale effectiveRole was passed in', () => {
        const decision = resolvePageAuthorization({
            ...base,
            userRole: 'ADMIN',
            effectiveRole: 'ADMIN_NON_HO_BRANCH_SWITCH',
            requiredRoles: ['BRANCH_MANAGER', 'AREA_MANAGER'],
        });
        expect(decision).toBe('allow');
    });

    it('stays pending when the legacy check fails and RBAC data has not loaded yet', () => {
        const decision = resolvePageAuthorization({
            ...base,
            requiredRoles: ['BRANCH_MANAGER', 'AREA_MANAGER'],
            pagePermissions: null,
            permissionsHydrated: false,
        });
        expect(decision).toBe('pending');
    });

    it('stays pending on a stale/incomplete cached grant until hydration confirms it', () => {
        const decision = resolvePageAuthorization({
            ...base,
            requiredRoles: ['BRANCH_MANAGER', 'AREA_MANAGER'],
            pagePermissions: { '/dashboard/reports/collection/dcb': { view: false, add: false, edit: false, delete: false, approve: false } },
            permissionsHydrated: false,
        });
        expect(decision).toBe('pending');
    });

    it('denies once hydration has confirmed there is no grant', () => {
        const decision = resolvePageAuthorization({
            ...base,
            requiredRoles: ['BRANCH_MANAGER', 'AREA_MANAGER'],
            pagePermissions: null,
            permissionsHydrated: true,
        });
        expect(decision).toBe('deny');
    });

    it('allows once the RBAC grant explicitly opens the page for this role, overriding a failed legacy check', () => {
        const decision = resolvePageAuthorization({
            ...base,
            requiredRoles: ['BRANCH_MANAGER', 'AREA_MANAGER'],
            pagePermissions: {
                '/dashboard/reports/collection/dcb': { view: true, add: false, edit: false, delete: false, approve: false },
            },
            permissionsHydrated: false, // even before the fetch settles — the grant is already known
        });
        expect(decision).toBe('allow');
    });

    it('denies when RBAC data is loaded and confirmed, but this page is not in the granted map', () => {
        const decision = resolvePageAuthorization({
            ...base,
            requiredRoles: ['BRANCH_MANAGER', 'AREA_MANAGER'],
            pagePermissions: {
                '/dashboard/some/other/page': { view: true, add: false, edit: false, delete: false, approve: false },
            },
            permissionsHydrated: true,
        });
        expect(decision).toBe('deny');
    });

    it('honors requiredPermission via the legacy PERMISSIONS table', () => {
        const allow = resolvePageAuthorization({
            ...base,
            userRole: 'BRANCH_MANAGER',
            effectiveRole: 'BRANCH_MANAGER',
            requiredPermission: 'CENTER_CREATE',
        });
        expect(allow).toBe('allow');

        const pending = resolvePageAuthorization({
            ...base,
            userRole: 'FDO',
            effectiveRole: 'FDO',
            requiredPermission: 'CENTER_CREATE',
        });
        expect(pending).toBe('pending');
    });
});
