import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SCHEME_PAGE } from './configuration';

const mocks = vi.hoisted(() => ({ user: vi.fn() }));
vi.mock('@/app/lib/db', () => ({ prisma: { user: { findUnique: mocks.user } } }));
vi.mock('@/app/lib/api-utils', () => ({
    errorResponse: (error: string, status: number) => NextResponse.json({ success: false, error }, { status }),
    withAuth: (handler: (request: NextRequest, session: { userId: string }) => Promise<NextResponse>) =>
        (request: NextRequest) => handler(request, { userId: 'authenticated-user' }),
}));
import { configurationError, withStaffLoanMaster } from './configuration-api';

beforeEach(() => vi.resetAllMocks());
const request = () => new NextRequest('http://localhost/api/admin/staff-loan-schemes');
const profile = (pagePermissions: unknown, isActive = true) => ({ id: 'authenticated-user', role: 'CUSTOM', isActive,
    userRoles: [{ role: { slug: 'custom-config-manager', pagePermissions } }] });

describe('staff loan configuration API guard', () => {
    it('rejects an inactive employee before invoking a handler', async () => {
        mocks.user.mockResolvedValue(profile({ [SCHEME_PAGE]: { view: true } }, false));
        const handler = vi.fn();
        const result = await withStaffLoanMaster(SCHEME_PAGE, 'view', handler)(request());
        expect(result.status).toBe(401); expect(handler).not.toHaveBeenCalled();
    });
    it('does not let read-only grants write', async () => {
        mocks.user.mockResolvedValue(profile({ [SCHEME_PAGE]: { view: true } }));
        const handler = vi.fn();
        const result = await withStaffLoanMaster(SCHEME_PAGE, 'edit', handler)(request());
        expect(result.status).toBe(403); expect(handler).not.toHaveBeenCalled();
    });
    it('allows explicitly granted custom roles and returns server capabilities', async () => {
        mocks.user.mockResolvedValue(profile({ [SCHEME_PAGE]: { view: true, edit: true } }));
        const handler = vi.fn().mockResolvedValue(NextResponse.json({ success: true }));
        const result = await withStaffLoanMaster(SCHEME_PAGE, 'edit', handler)(request());
        expect(result.status).toBe(200);
        expect(handler).toHaveBeenCalledWith(expect.any(NextRequest), 'authenticated-user', { view: true, add: false, edit: true });
        expect(mocks.user).toHaveBeenCalledWith(expect.objectContaining({ select: expect.objectContaining({ userRoles: expect.objectContaining({ where: expect.objectContaining({
            branchId: null, isActive: true, role: { isActive: true }, OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
        }) }) }) }));
    });
    it('does not expose database error details', async () => {
        const response = configurationError({ code: 'P2021', message: 'private SQL connection details' });
        expect(response.status).toBe(503);
        expect(JSON.stringify(await response.json())).not.toContain('private SQL');
    });
});
