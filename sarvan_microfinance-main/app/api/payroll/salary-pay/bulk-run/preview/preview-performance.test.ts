import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Company-wide Bulk Payroll preview: it must read shared data once (not per employee), keep the employees in
 * order, and still apply the same "will this employee run?" rules.
 */

const state = vi.hoisted(() => ({ permitted: null as string[] | null }));

const db = vi.hoisted(() => ({
    prisma: {
        user: { findMany: vi.fn() },
        salaryPayRecord: { findMany: vi.fn(), findUnique: vi.fn() },
    },
}));
const payroll = vi.hoisted(() => ({
    buildPayrollSharedContext: vi.fn(async () => ({ salaryComponents: [], incentives: new Map(), incentiveBranchIds: new Set(['b1']) })),
    computeEmployeePayroll: vi.fn(),
    toGridRowBase: vi.fn(),
}));

vi.mock('@/app/lib/db', () => db);
vi.mock('@/app/lib/api-utils', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/app/lib/api-utils')>();
    return {
        ...actual,
        withRole: (_roles: string[], handler: (req: NextRequest, user: unknown) => Promise<Response>) =>
            (req: NextRequest) => handler(req, { userId: 'admin1', role: 'ADMIN', branchId: 'b1' }),
    };
});
vi.mock('@/app/lib/permissions/branch-scope', () => ({ getPermittedBranchIds: vi.fn(async () => state.permitted) }));
vi.mock('@/app/lib/payroll/run-payroll', () => payroll);
vi.mock('@/app/lib/payroll/attendance-days', () => ({ describeUnpaidDays: vi.fn(() => '') }));

import { POST } from './route';

const employee = (n: number, branchId = 'b1') => ({
    id: `emp${n}`, employeeId: `E${n}`, firstName: `F${n}`, lastName: 'L', dateOfJoining: null, isActive: true, branchId,
    branch: { code: '001', name: 'Salem', areas: [] }, designation: null, department: null,
});

const preview = (body: Record<string, unknown> = { branchId: 'all', month: 9, year: 2026 }) =>
    POST(new NextRequest('http://localhost/api/payroll/salary-pay/bulk-run/preview', {
        method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
    }));

beforeEach(() => {
    vi.clearAllMocks();
    state.permitted = null;
    db.prisma.user.findMany.mockResolvedValue([employee(1), employee(2), employee(3), employee(4)]);
    db.prisma.salaryPayRecord.findMany.mockResolvedValue([]);
    payroll.computeEmployeePayroll.mockImplementation(async (id: string) => ({ employeeFound: true, ctcInfo: { id }, components: [] }));
    payroll.toGridRowBase.mockImplementation((c: { ctcInfo: { id: string } }) => ({ monthlyCtc: c.ctcInfo.id === 'emp3' ? 0 : 20000 }));
});

describe('POST /api/payroll/salary-pay/bulk-run/preview', () => {
    it('reads the existing payslips with ONE query for everyone (no per-employee lookup)', async () => {
        await preview();
        expect(db.prisma.salaryPayRecord.findMany).toHaveBeenCalledTimes(1);
        expect(db.prisma.salaryPayRecord.findMany.mock.calls[0][0].where).toMatchObject({ month: 9, year: 2026, employeeId: { in: ['emp1', 'emp2', 'emp3', 'emp4'] } });
        expect(db.prisma.salaryPayRecord.findUnique).not.toHaveBeenCalled();
    });

    it('builds the shared context once, for the branches being processed, and passes it to every employee', async () => {
        db.prisma.user.findMany.mockResolvedValue([employee(1, 'b1'), employee(2, 'b2'), employee(3, 'b1')]);
        await preview();
        expect(payroll.buildPayrollSharedContext).toHaveBeenCalledTimes(1);
        expect(payroll.buildPayrollSharedContext).toHaveBeenCalledWith(9, 2026, ['b1', 'b2', 'b1']);
        expect(payroll.computeEmployeePayroll).toHaveBeenCalledTimes(3);
        for (const call of payroll.computeEmployeePayroll.mock.calls) {
            expect(call[3]).toBeUndefined();
            expect(call[4]).toBeDefined();
        }
    });

    it('returns one row per employee in the same order, with the same run / blocked rules', async () => {
        db.prisma.salaryPayRecord.findMany.mockResolvedValue([
            { employeeId: 'emp1', status: 'PAID' },
            { employeeId: 'emp2', status: 'APPROVED' },
        ]);
        const json = await (await preview()).json();
        expect(json.data.rows.map((r: { employeeId: string }) => r.employeeId)).toEqual(['emp1', 'emp2', 'emp3', 'emp4']);
        const byId = Object.fromEntries(json.data.rows.map((r: { employeeId: string }) => [r.employeeId, r]));
        expect(byId.emp1).toMatchObject({ willRun: false, reason: 'Already paid for this period', existingStatus: 'PAID' });
        expect(byId.emp2).toMatchObject({ willRun: false, reason: 'Already approved on the individual flow' });
        expect(byId.emp3).toMatchObject({ willRun: false, reason: 'No Month CTC Pay set', hasCtc: false });
        expect(byId.emp4).toMatchObject({ willRun: true, hasCtc: true, existingStatus: null });
        expect(json.data).toMatchObject({ total: 4, willRunCount: 1, blockedCount: 3 });
    });

    it('never has more employees being computed at once than the concurrency limit', async () => {
        db.prisma.user.findMany.mockResolvedValue(Array.from({ length: 40 }, (_, i) => employee(i + 1)));
        let running = 0;
        let peak = 0;
        payroll.computeEmployeePayroll.mockImplementation(async (id: string) => {
            running++;
            peak = Math.max(peak, running);
            await new Promise((r) => setTimeout(r, 2));
            running--;
            return { employeeFound: true, ctcInfo: { id }, components: [] };
        });
        const json = await (await preview()).json();
        expect(json.data.total).toBe(40);
        expect(peak).toBeGreaterThan(1);
        expect(peak).toBeLessThanOrEqual(8);
    });

    it('refuses a branch the user cannot access', async () => {
        state.permitted = ['b1'];
        const res = await preview({ branchId: 'secret', month: 9, year: 2026 });
        expect(res.status).toBe(403);
        expect(payroll.computeEmployeePayroll).not.toHaveBeenCalled();
    });

    it('"All Branches" for a limited user covers only their permitted branches', async () => {
        state.permitted = ['b1', 'b2'];
        await preview();
        expect(db.prisma.user.findMany.mock.calls[0][0].where).toMatchObject({ isActive: true, branchId: { in: ['b1', 'b2'] } });
    });
});
