import { describe, expect, it } from 'vitest';
import { getAllowedRolesForHref } from './navigation.config';

describe('getAllowedRolesForHref', () => {
    it('returns the exact allowedRoles configured for a leaf href', () => {
        expect(getAllowedRolesForHref('/dashboard/admin-reports/account/daybook')).toEqual([
            'ADMIN',
            'AREA_MANAGER',
            'BRANCH_MANAGER',
        ]);
    });

    it('returns undefined (no restriction) for a page with no allowedRoles configured', () => {
        expect(getAllowedRolesForHref('/dashboard')).toBeUndefined();
    });

    it('returns undefined for an href not present anywhere in navigationConfig', () => {
        expect(getAllowedRolesForHref('/dashboard/does-not-exist/at-all')).toBeUndefined();
    });

    it('falls back to the longest matching parent prefix for an unlisted sub-path', () => {
        // A dynamic/child path under a configured parent that itself has no
        // exact navigationConfig entry should inherit the parent's roles.
        const parent = getAllowedRolesForHref('/dashboard/admin-reports/account');
        const child = getAllowedRolesForHref('/dashboard/admin-reports/account/some-unlisted-sub-page');
        expect(child).toEqual(parent);
    });
});
