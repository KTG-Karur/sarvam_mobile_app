import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Admin side of the Punch Radius lock: GET /api/hr/punch-radius (list) and
 * POST /api/hr/punch-radius/assign (bulk lock / unlock) — permission gate, branch scoping,
 * filters, "only real changes are written + audited".
 */

const state = vi.hoisted(() => ({
    allowed: true,
    hasContext: true,
    scope: { branchId: { in: ['br1', 'br2'] } } as Record<string, unknown>,
}));

const db = vi.hoisted(() => ({
    prisma: {
        user: { findMany: vi.fn(), updateMany: vi.fn(async () => ({ count: 0 })) },
        punchRadiusLog: { createMany: vi.fn(async () => ({ count: 0 })) },
        $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops)),
    },
}));

const branchScope = vi.hoisted(() => ({ buildBranchWhereClause: vi.fn(async () => state.scope) }));

vi.mock('@/app/lib/db', () => ({ prisma: db.prisma }));
vi.mock('@/app/lib/prisma', () => ({ prisma: db.prisma }));
vi.mock('@/app/lib/api-utils', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/app/lib/api-utils')>();
    return {
        ...actual,
        withAuth: (handler: (req: NextRequest, user: unknown) => Promise<Response>) =>
            (req: NextRequest) => handler(req, { userId: 'hr1', branchId: 'br1', role: 'AREA_MANAGER' }),
    };
});
vi.mock('@/app/lib/permissions/guards', () => ({
    getUserContext: vi.fn(async () => (state.hasContext ? { userId: 'hr1' } : null)),
}));
vi.mock('@/app/lib/permissions/engine', () => ({
    checkPermission: vi.fn(() => ({ allowed: state.allowed })),
}));
vi.mock('@/app/lib/permissions/branch-scope', () => branchScope);

import { GET } from './route';
import { POST } from './assign/route';

const get = (qs = '') => GET(new NextRequest(`http://localhost/api/hr/punch-radius${qs}`));
const post = (body: unknown) =>
    POST(new NextRequest('http://localhost/api/hr/punch-radius/assign', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
    }));

const emp = (id: string, locked: boolean, lat: number | null = 11.66, lng: number | null = 78.14) => ({
    id,
    employeeId: `E-${id}`,
    firstName: `F${id}`,
    lastName: 'L',
    role: 'FDO',
    punchRadiusLocked: locked,
    branch: { id: 'br1', name: 'Salem', code: '001', latitude: lat, longitude: lng },
    department: { id: 'd1', name: 'Ops' },
    shift: { id: 's1', name: 'General', shiftStart: '09:30', shiftEnd: '18:00' },
});

beforeEach(() => {
    vi.clearAllMocks();
    state.allowed = true;
    state.hasContext = true;
    state.scope = { branchId: { in: ['br1', 'br2'] } };
    db.prisma.user.findMany.mockResolvedValue([]);
    db.prisma.user.updateMany.mockResolvedValue({ count: 0 });
});

describe('GET /api/hr/punch-radius', () => {
    it('is refused without hr-attendance view permission', async () => {
        state.allowed = false;
        const res = await get();
        expect(res.status).toBe(403);
        expect(db.prisma.user.findMany).not.toHaveBeenCalled();
    });

    it('is refused when there is no permission context', async () => {
        state.hasContext = false;
        expect((await get()).status).toBe(403);
    });

    it('lists employees with lock state, flags branches without coordinates and never leaks lat/lng', async () => {
        db.prisma.user.findMany.mockResolvedValue([emp('1', true), emp('2', false, null, null)]);
        const json = await (await get()).json();
        expect(json.success).toBe(true);
        expect(json.data).toHaveLength(2);
        expect(json.data[0]).toMatchObject({ id: '1', punchRadiusLocked: true, branchHasLocation: true, branch: { id: 'br1', name: 'Salem', code: '001' } });
        expect(json.data[1]).toMatchObject({ id: '2', punchRadiusLocked: false, branchHasLocation: false });
        expect(JSON.stringify(json.data)).not.toContain('latitude');
    });

    it('only asks for active employees inside the caller’s permitted branches', async () => {
        await get();
        const where = db.prisma.user.findMany.mock.calls[0][0].where;
        expect(where).toMatchObject({ isActive: true, branchId: { in: ['br1', 'br2'] } });
    });

    it('"all" branches means the permitted set; a specific branch is passed to the scope helper', async () => {
        await get('?branchId=all');
        expect(branchScope.buildBranchWhereClause).toHaveBeenLastCalledWith(expect.anything(), null);
        await get('?branchId=br2');
        expect(branchScope.buildBranchWhereClause).toHaveBeenLastCalledWith(expect.anything(), 'br2');
    });

    it('applies the lock / department / search filters', async () => {
        await get('?locked=true&departmentId=d1&search=ravi');
        let where = db.prisma.user.findMany.mock.calls[0][0].where;
        expect(where.punchRadiusLocked).toBe(true);
        expect(where.departmentId).toBe('d1');
        expect(where.OR).toHaveLength(3);

        await get('?locked=false');
        where = db.prisma.user.findMany.mock.calls[1][0].where;
        expect(where.punchRadiusLocked).toBe(false);

        await get('?locked=all&departmentId=all');
        where = db.prisma.user.findMany.mock.calls[2][0].where;
        expect(where).not.toHaveProperty('punchRadiusLocked');
        expect(where).not.toHaveProperty('departmentId');
    });
});

describe('POST /api/hr/punch-radius/assign', () => {
    it('is refused without hr-attendance edit permission', async () => {
        state.allowed = false;
        const res = await post({ employeeIds: ['1'], locked: true });
        expect(res.status).toBe(403);
        expect(db.prisma.user.updateMany).not.toHaveBeenCalled();
    });

    it('rejects an empty selection and a missing lock flag', async () => {
        expect((await post({ employeeIds: [], locked: true })).status).toBe(400);
        expect((await post({ employeeIds: ['1'] })).status).toBe(400);
    });

    it('refuses when none of the selected employees are in the caller’s branches', async () => {
        db.prisma.user.findMany.mockResolvedValue([]);
        const res = await post({ employeeIds: ['x'], locked: true });
        expect(res.status).toBe(403);
        expect(db.prisma.user.updateMany).not.toHaveBeenCalled();
    });

    it('re-applies the caller’s branch scope server-side when looking up the selected ids', async () => {
        db.prisma.user.findMany.mockResolvedValue([{ id: '1', punchRadiusLocked: false }]);
        await post({ employeeIds: ['1', 'outsider'], locked: true });
        const where = db.prisma.user.findMany.mock.calls[0][0].where;
        expect(where).toMatchObject({ id: { in: ['1', 'outsider'] }, isActive: true, branchId: { in: ['br1', 'br2'] } });
    });

    it('LOCKS only the employees that are not locked yet, and audits exactly those changes', async () => {
        db.prisma.user.findMany.mockResolvedValue([
            { id: '1', punchRadiusLocked: false },
            { id: '2', punchRadiusLocked: true },
            { id: '3', punchRadiusLocked: false },
        ]);
        const res = await post({ employeeIds: ['1', '2', '3'], locked: true });
        const json = await res.json();
        expect(res.status).toBe(200);
        expect(json.data).toMatchObject({ changedCount: 2, unchangedCount: 1, skippedCount: 0 });
        expect(db.prisma.user.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['1', '3'] } }, data: { punchRadiusLocked: true } });
        expect(db.prisma.punchRadiusLog.createMany).toHaveBeenCalledWith({
            data: [
                { employeeId: '1', locked: true, changedById: 'hr1' },
                { employeeId: '3', locked: true, changedById: 'hr1' },
            ],
        });
        expect(db.prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('UNLOCKS only the employees that are locked', async () => {
        db.prisma.user.findMany.mockResolvedValue([
            { id: '1', punchRadiusLocked: true },
            { id: '2', punchRadiusLocked: false },
        ]);
        const json = await (await post({ employeeIds: ['1', '2'], locked: false })).json();
        expect(json.data).toMatchObject({ changedCount: 1, unchangedCount: 1 });
        expect(db.prisma.user.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['1'] } }, data: { punchRadiusLocked: false } });
        expect(db.prisma.punchRadiusLog.createMany).toHaveBeenCalledWith({ data: [{ employeeId: '1', locked: false, changedById: 'hr1' }] });
    });

    it('writes nothing (no update, no audit row) when everyone is already in the requested state', async () => {
        db.prisma.user.findMany.mockResolvedValue([{ id: '1', punchRadiusLocked: true }]);
        const res = await post({ employeeIds: ['1'], locked: true });
        expect(res.status).toBe(200);
        expect(db.prisma.$transaction).not.toHaveBeenCalled();
        expect(db.prisma.user.updateMany).not.toHaveBeenCalled();
        expect(db.prisma.punchRadiusLog.createMany).not.toHaveBeenCalled();
    });

    it('reports employees outside the caller’s branches as skipped', async () => {
        db.prisma.user.findMany.mockResolvedValue([{ id: '1', punchRadiusLocked: false }]);
        const json = await (await post({ employeeIds: ['1', 'outsider'], locked: true })).json();
        expect(json.data).toMatchObject({ changedCount: 1, skippedCount: 1 });
        expect(json.message).toContain('skipped');
    });
});
