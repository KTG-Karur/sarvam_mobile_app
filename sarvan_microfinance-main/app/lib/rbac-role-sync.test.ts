import { describe, expect, it } from 'vitest';
import {
    SYSTEM_SLUG_TO_ROLE,
    computeRoleCode,
    resolveLegacyRoleForRbacRole,
} from './rbac-role-sync';

describe('rbac-role-sync', () => {
    it('maps system role slugs to canonical legacy codes', () => {
        expect(SYSTEM_SLUG_TO_ROLE['admin']).toBe('ADMIN');
        expect(SYSTEM_SLUG_TO_ROLE['area-manager']).toBe('AREA_MANAGER');
        expect(SYSTEM_SLUG_TO_ROLE['branch-manager']).toBe('BRANCH_MANAGER');
        expect(SYSTEM_SLUG_TO_ROLE['fdo']).toBe('FDO');
        expect(SYSTEM_SLUG_TO_ROLE['division-manager']).toBe('DIVISION_MANAGER');
        expect(SYSTEM_SLUG_TO_ROLE['quality-checkers']).toBe('QC');
    });

    it('resolves legacy role for system role slugs regardless of role.legacyRole fallback', () => {
        expect(
            resolveLegacyRoleForRbacRole({
                slug: 'area-manager',
                legacyRole: 'SOMETHING_ELSE',
            })
        ).toBe('AREA_MANAGER');

        expect(
            resolveLegacyRoleForRbacRole({
                slug: 'admin',
                legacyRole: 'ADMIN',
            })
        ).toBe('ADMIN');
    });

    it('falls back to custom role legacyRole if slug is not a system role', () => {
        expect(
            resolveLegacyRoleForRbacRole({
                slug: 'custom-auditor',
                legacyRole: 'AUDITOR',
            })
        ).toBe('AUDITOR');
    });

    it('computes role codes correctly for single and multi-word names', () => {
        expect(computeRoleCode('Administrator')).toBe('ADMINISTRATOR');
        expect(computeRoleCode('Area Manager')).toBe('AM');
        expect(computeRoleCode('Chief Executive Officer')).toBe('CEO');
    });
});

