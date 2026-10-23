import { describe, expect, it } from 'vitest';
import { evaluateServerRouteAccess, roleBasedRoutes } from './server-route-protection';

describe('evaluateServerRouteAccess', () => {
    it('lets Admin through a route it is not explicitly listed on', () => {
        // Sanity check on the fixture: this route intentionally excludes plain 'ADMIN'.
        expect(roleBasedRoutes['/dashboard/client/enrollment']).not.toContain('ADMIN');

        expect(
            evaluateServerRouteAccess('/dashboard/client/enrollment', 'ADMIN', 'ADMIN')
        ).toBe(true);
    });

    it('allows a role explicitly listed for the matched route', () => {
        expect(
            evaluateServerRouteAccess('/dashboard/client/enrollment', 'FDO', 'FDO')
        ).toBe(true);
    });

    it('denies a role not listed for the matched route', () => {
        expect(
            evaluateServerRouteAccess('/dashboard/client/enrollment', 'BRANCH_MANAGER', 'BRANCH_MANAGER')
        ).toBe(false);
    });

    it('lets Admin through regardless of branch — no downgrade — even on a route scoped to neither BM/AM', () => {
        expect(
            evaluateServerRouteAccess(
                '/dashboard/client/enrollment',
                'ADMIN',
                'ADMIN'
            )
        ).toBe(true);
    });

    it('allows any authenticated role on a path with no configured restriction', () => {
        expect(evaluateServerRouteAccess('/dashboard/unlisted-page', 'FDO', 'FDO')).toBe(true);
    });

    it('uses the longest matching prefix rather than the first match', () => {
        // '/dashboard/reports/employee' allows ADMIN among others, but the more
        // specific '/dashboard/reports/employee/task-report' is ADMIN-only.
        expect(
            evaluateServerRouteAccess(
                '/dashboard/reports/employee/task-report',
                'AREA_MANAGER',
                'AREA_MANAGER'
            )
        ).toBe(false);
        expect(
            evaluateServerRouteAccess('/dashboard/reports/employee', 'AREA_MANAGER', 'AREA_MANAGER')
        ).toBe(true);
    });
});
