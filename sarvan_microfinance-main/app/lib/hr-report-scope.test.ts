import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

/** Employee scoping shared by the HR attendance / leave / permission summary + detail report APIs. */

const state = vi.hoisted(() => ({ permitted: ['b1', 'b2'] as string[] | null }));
const db = vi.hoisted(() => ({ prisma: { user: { findMany: vi.fn(async () => []), findUnique: vi.fn() } } }));

vi.mock('@/app/lib/db', () => db);
vi.mock('@/app/lib/permissions/branch-scope', () => ({ getPermittedBranchIds: vi.fn(async () => state.permitted) }));

import { resolveReportEmployees } from './hr-report-scope';

const user = { userId: 'hr1', role: 'ADMIN', branchId: 'b1' };
const run = async (qs: string) => {
    db.prisma.user.findMany.mockClear();
    const r = await resolveReportEmployees(user, new URLSearchParams(qs));
    const where = JSON.stringify((db.prisma.user.findMany.mock.calls[0] as unknown as [{ where: unknown }])?.[0]?.where ?? null);
    return { r, where };
};

beforeEach(() => { state.permitted = ['b1', 'b2']; db.prisma.user.findUnique.mockReset(); });

describe('resolveReportEmployees', () => {
    it('no branch = every permitted branch; "all" is the same; one branch narrows', async () => {
        expect((await run('')).where).toContain('"branchId":{"in":["b1","b2"]}');
        expect((await run('branchId=all')).where).toContain('"branchId":{"in":["b1","b2"]}');
        expect((await run('branchId=b2')).where).toContain('"branchId":{"in":["b2"]}');
    });

    it('a branch the user cannot see never widens the result', async () => {
        expect((await run('branchId=secret')).where).toContain('"branchId":{"in":["b1","b2"]}');
    });

    it('head office: "all" means no branch filter; a chosen branch is honoured', async () => {
        state.permitted = null;
        expect((await run('branchId=all')).where).not.toContain('branchId');
        expect((await run('')).where).not.toContain('branchId');
        expect((await run('branchId=b9')).where).toContain('"branchId":{"in":["b9"]}');
    });

    it('department / designation / role filters apply, and only active employees are listed', async () => {
        const { where } = await run('departmentId=d1&designationId=g1&role=fdo');
        expect(where).toContain('"isActive":true');
        expect(where).toContain('"departmentId":"d1"');
        expect(where).toContain('"designationId":"g1"');
        expect(where).toContain('"role":{"equals":"fdo","mode":"insensitive"}');
    });

    it('a single employee: 404 when unknown, 403 outside the user\'s branches, allowed for self or a permitted branch', async () => {
        db.prisma.user.findUnique.mockResolvedValueOnce(null);
        expect(((await run('employeeId=x')).r as NextResponse).status).toBe(404);

        db.prisma.user.findUnique.mockResolvedValueOnce({ id: 'e1', branchId: 'zzz', branch: null });
        expect(((await run('employeeId=e1')).r as NextResponse).status).toBe(403);

        db.prisma.user.findUnique.mockResolvedValueOnce({ id: 'e1', branchId: 'b2', branch: null });
        const ok = (await run('employeeId=e1')).r as { employeeMode: boolean };
        expect(ok.employeeMode).toBe(true);

        db.prisma.user.findUnique.mockResolvedValueOnce({ id: 'hr1', branchId: 'zzz', branch: null });
        expect(((await run('employeeId=hr1')).r as { employeeMode: boolean }).employeeMode).toBe(true);
    });
});
