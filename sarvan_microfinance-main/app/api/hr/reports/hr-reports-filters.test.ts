import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { REPORT_CATALOG } from '@/components/hr/reports/report-catalog';

/**
 * Every report served by GET /api/hr/reports/[slug] is called through the REAL route with each filter the
 * report page offers (branch, dates, employee, shift, role, type, status, month/year) and we assert that the
 * filter actually reaches the database query, plus the rendered rows for a few reports.
 * The database is a recording mock: every findMany returns the rows we preload (default none).
 */

type Call = { model: string; method: string; args: Record<string, unknown> };

const rec = vi.hoisted(() => ({
    calls: [] as { model: string; method: string; args: Record<string, unknown> }[],
    rows: {} as Record<string, unknown[]>,
    permitted: ['b1', 'b2'] as string[] | null,
}));

vi.mock('@/app/lib/db', () => {
    const model = (name: string) =>
        new Proxy({}, {
            get: (_t, method: string) => async (args: Record<string, unknown> = {}) => {
                rec.calls.push({ model: name, method, args });
                if (method === 'findMany') return rec.rows[name] ?? [];
                if (method === 'count') return 0;
                return null;
            },
        });
    const prisma = new Proxy({}, { get: (_t, name: string) => (name === '$transaction' ? async (ops: unknown[]) => Promise.all(ops) : model(name)) });
    return { prisma };
});
vi.mock('@/app/lib/prisma', async () => await import('@/app/lib/db'));
vi.mock('@/app/lib/permissions/guards', () => ({
    requirePermission: vi.fn(async () => ({ userId: 'hr1', branchId: 'b1', isHeadOffice: false, branchAccess: [], roles: [] })),
    isUserContext: () => true,
}));
vi.mock('@/app/lib/permissions/branch-scope', () => ({ getPermittedBranchIdsForContext: vi.fn(async () => rec.permitted) }));
vi.mock('@/app/lib/employee-shift', () => ({
    resolveDefaultShiftConfig: vi.fn(async () => ({ shiftId: null, shiftName: 'Default', shiftStart: '09:30', shiftEnd: '18:00', graceMinutes: 15 })),
}));

import { GET } from './[slug]/route';

const FROM = '2026-10-01';
const TO = '2026-10-13';
const FROM_UTC = '2026-09-30T18:30:00.000Z'; // 1 Oct 00:00 IST
const TO_UTC = '2026-10-13T18:29:59.999Z'; // 13 Oct 23:59:59.999 IST

async function run(slug: string, query: Record<string, string> = {}) {
    rec.calls.length = 0;
    const qs = new URLSearchParams(query).toString();
    const res = await GET(new NextRequest(`http://localhost/api/hr/reports/${slug}${qs ? `?${qs}` : ''}`), { params: Promise.resolve({ slug }) });
    const json = await res.json();
    const where = JSON.stringify(rec.calls.filter((c) => c.method === 'findMany').map((c) => c.args.where ?? null));
    return { status: res.status, json, where, calls: rec.calls as Call[] };
}

beforeEach(() => {
    rec.calls.length = 0;
    rec.rows = {};
    rec.permitted = ['b1', 'b2'];
});

// slugs served by the dynamic route (staff loan/advance reports have their own routes + tests)
const DYNAMIC = [
    'late-attendance', 'absentee', 'leave-register', 'leave-balance', 'permission-register', 'missed-punch-in', 'holiday-register',
    'employee-master', 'joining', 'exit', 'transfer', 'promotion', 'confirmation', 'salary-register',
    'staff-loan-deduction', 'staff-advance-deduction', 'travel-client-visit', 'travel-similarity',
];
const RANGE = ['late-attendance', 'absentee', 'leave-register', 'permission-register', 'missed-punch-in', 'holiday-register', 'joining', 'exit', 'transfer', 'promotion', 'confirmation', 'travel-client-visit', 'travel-similarity'];
const REQUIRED_RANGE = ['late-attendance', 'absentee', 'missed-punch-in', 'holiday-register', 'travel-client-visit', 'travel-similarity'];

describe('catalog and route agree', () => {
    it('every dynamic catalog report exists in the route and every one runs', async () => {
        const catalogDynamic = REPORT_CATALOG.map((r) => r.slug).filter((s) => !s.startsWith('staff-loan-') || s.endsWith('-deduction'))
            .filter((s) => !['staff-outstanding', 'active-staff-loans', 'active-staff-advances', 'staff-loan-closure', 'staff-advance-closure', 'staff-loan-schedule', 'staff-advance-schedule'].includes(s));
        expect(new Set(catalogDynamic)).toEqual(new Set(DYNAMIC));
        for (const slug of DYNAMIC) {
            const r = await run(slug, { fromDate: FROM, toDate: TO });
            expect(r.status, `${slug} -> ${JSON.stringify(r.json)}`).toBe(200);
            expect(Array.isArray(r.json.data.headers), slug).toBe(true);
            expect(r.json.data.totalCount, slug).toBe(0);
        }
    });

    it('an unknown report is a 404', async () => {
        expect((await run('nope')).status).toBe(404);
    });
});

describe('Branch filter (All Branches + one branch)', () => {
    const BRANCH_AWARE = DYNAMIC.filter((s) => s !== 'travel-similarity' || true);

    it.each(BRANCH_AWARE)('%s: "All" is every permitted branch; one branch narrows to just that branch', async (slug) => {
        const all = await run(slug, { fromDate: FROM, toDate: TO });
        expect(all.where, slug).toContain('"in":["b1","b2"]');
        const one = await run(slug, { fromDate: FROM, toDate: TO, branchId: 'b2' });
        expect(one.where, slug).toContain('"in":["b2"]');
        expect(one.where, slug).not.toContain('"b1"');
        const explicitAll = await run(slug, { fromDate: FROM, toDate: TO, branchId: 'all' });
        expect(explicitAll.where, slug).toContain('"in":["b1","b2"]');
    });

    it.each(DYNAMIC)('%s: a branch the user cannot see is refused (403)', async (slug) => {
        const r = await run(slug, { fromDate: FROM, toDate: TO, branchId: 'secret' });
        expect(r.status).toBe(403);
        expect(rec.calls.filter((c) => c.method === 'findMany')).toHaveLength(0);
    });

    it('head-office user: no branch means no branch filter; a chosen branch is honoured', async () => {
        rec.permitted = null;
        const all = await run('joining', { fromDate: FROM, toDate: TO });
        expect(all.where).not.toContain('branchId');
        const one = await run('joining', { fromDate: FROM, toDate: TO, branchId: 'b9' });
        expect(one.where).toContain('"in":["b9"]');
    });
});

describe('Date range filter (IST calendar days)', () => {
    it.each(RANGE)('%s: From/To become the exact IST day bounds in the query', async (slug) => {
        // The travel reports walk day by day over the employees they find, so give them two (same branch).
        if (slug.startsWith('travel-')) {
            const emp = (id: string) => ({ id, employeeId: id, firstName: id, lastName: 'X', branchId: 'b1', branch: { name: 'Salem', latitude: null, longitude: null } });
            rec.rows.user = [emp('e1'), emp('e2')];
        }
        const r = await run(slug, { fromDate: FROM, toDate: TO });
        expect(r.status, slug).toBe(200);
        expect(r.where, slug).toContain(FROM_UTC);
        expect(r.where, slug).toContain(TO_UTC);
    });

    it.each(REQUIRED_RANGE)('%s: refuses to run without both dates', async (slug) => {
        const r = await run(slug, {});
        expect(r.status).toBe(500);
        expect(r.json.error).toMatch(/required/i);
    });

    it.each(['joining', 'exit', 'transfer', 'promotion', 'confirmation', 'leave-register', 'permission-register'])(
        '%s: a single date still filters (From only / To only)',
        async (slug) => {
            const fromOnly = await run(slug, { fromDate: FROM });
            expect(fromOnly.where, slug).toContain(FROM_UTC);
            expect(fromOnly.where, slug).not.toContain(TO_UTC);
            const toOnly = await run(slug, { toDate: TO });
            expect(toOnly.where, slug).toContain(TO_UTC);
            expect(toOnly.where, slug).not.toContain(FROM_UTC);
        },
    );

    it('leave register uses overlap: a leave spanning the range edge is included', async () => {
        const r = await run('leave-register', { fromDate: FROM, toDate: TO });
        expect(r.where).toContain(`"fromDate":{"lte":"${TO_UTC}"}`);
        expect(r.where).toContain(`"toDate":{"gte":"${FROM_UTC}"}`);
    });
});

describe('Employee / shift / role / type / status filters', () => {
    it.each(['late-attendance', 'absentee', 'leave-register', 'leave-balance', 'permission-register', 'travel-client-visit', 'employee-master', 'salary-register', 'staff-loan-deduction', 'staff-advance-deduction'])(
        '%s: Employee filter reaches the query',
        async (slug) => {
            const r = await run(slug, { fromDate: FROM, toDate: TO, employeeId: 'emp-77' });
            expect(r.where, slug).toContain('emp-77');
            const without = await run(slug, { fromDate: FROM, toDate: TO });
            expect(without.where, slug).not.toContain('emp-77');
        },
    );

    it('Late Attendance: Shift filter applies, "all" does not', async () => {
        expect((await run('late-attendance', { fromDate: FROM, toDate: TO, shiftId: 'shift-9' })).where).toContain('"shiftId":"shift-9"');
        expect((await run('late-attendance', { fromDate: FROM, toDate: TO, shiftId: 'all' })).where).not.toContain('shiftId');
    });

    it('Missed Punch In: Role filter applies', async () => {
        expect((await run('missed-punch-in', { fromDate: FROM, toDate: TO, role: 'FDO' })).where).toContain('"role":"FDO"');
        expect((await run('missed-punch-in', { fromDate: FROM, toDate: TO })).where).not.toContain('"role"');
    });

    it('Holiday report: Type filter (holidays only / working-day overrides only / both)', async () => {
        expect((await run('holiday-register', { fromDate: FROM, toDate: TO, type: 'HOLIDAY' })).where).toContain('"isWorkingDay":false');
        expect((await run('holiday-register', { fromDate: FROM, toDate: TO, type: 'WORKING_DAY' })).where).toContain('"isWorkingDay":true');
        expect((await run('holiday-register', { fromDate: FROM, toDate: TO })).where).not.toContain('isWorkingDay');
    });

    it('Employee Master: Status filter (active only by default / inactive only / everyone)', async () => {
        expect((await run('employee-master')).where).toContain('"isActive":true');
        expect((await run('employee-master', { status: 'inactive' })).where).toContain('"isActive":false');
        expect((await run('employee-master', { status: 'everyone' })).where).not.toContain('isActive');
    });
});

describe('Month / Year filter (Payroll, Staff Loan/Advance Deduction, Leave Balance)', () => {
    it.each(['salary-register', 'staff-loan-deduction', 'staff-advance-deduction'])('%s: month + year narrow the payslips; none = all months', async (slug) => {
        const one = await run(slug, { month: '9', year: '2026' });
        expect(one.where, slug).toContain('"month":9');
        expect(one.where, slug).toContain('"year":2026');
        const yearOnly = await run(slug, { year: '2026' });
        expect(yearOnly.where, slug).toContain('"year":2026');
        expect(yearOnly.where, slug).not.toContain('"month"');
        const all = await run(slug, {});
        expect(all.where, slug).not.toContain('"month"');
        expect(all.where, slug).not.toContain('"year"');
    });

    it('Leave Balance: uses the chosen month/year; defaults to the current month', async () => {
        const chosen = await run('leave-balance', { month: '3', year: '2026' });
        expect(chosen.where).toContain('"month":3');
        expect(chosen.where).toContain('"year":2026');
        const def = await run('leave-balance', {});
        expect(def.where).toMatch(/"month":\d+,"year":20\d\d/);
    });

    it('ignores an invalid month / year instead of failing or filtering on garbage', async () => {
        const r = await run('salary-register', { month: '13', year: 'abc' });
        expect(r.status).toBe(200);
        expect(r.where).not.toContain('"month"');
        expect(r.where).not.toContain('"year"');
    });
});

describe('Report output', () => {
    it('Leave Register shows a half-day as 0.5 (not rounded up to 1)', async () => {
        rec.rows.leaveApplication = [{
            fromDate: new Date('2026-10-05T00:00:00+05:30'), toDate: new Date('2026-10-05T00:00:00+05:30'), numberOfDays: '0.5', status: 'APPROVED',
            employee: { employeeId: 'E1', firstName: 'Ravi', lastName: 'K', department: { name: 'Ops' } }, leaveType: { leaveType: 'Casual' },
        }];
        const r = await run('leave-register', { fromDate: FROM, toDate: TO });
        expect(r.json.data.headers).toEqual(['Employee ID', 'Name', 'Department', 'Leave Type', 'From', 'To', 'Days', 'Status']);
        expect(r.json.data.rows[0]).toEqual(['E1', 'Ravi K', 'Ops', 'Casual', expect.any(String), expect.any(String), 0.5, 'APPROVED']);
        expect(r.json.data.totalCount).toBe(1);
    });

    it('Leave Balance shows fractional balances', async () => {
        rec.rows.employeeLeaveBalance = [{
            openingBalance: '1.5', carriedForwardDays: '0.5', remainingBalance: '1.5',
            employee: { employeeId: 'E1', firstName: 'Ravi', lastName: 'K' }, leaveType: { leaveType: 'Casual' },
        }];
        const r = await run('leave-balance', {});
        expect(r.json.data.rows[0]).toEqual(['E1', 'Ravi K', 'Casual', 1.5, 0.5, 1.5]);
    });

    it('Employee Master lists the employee row with department / designation / branch', async () => {
        rec.rows.user = [{
            employeeId: 'E1', firstName: 'Ravi', lastName: 'K', mobileNumber: '9876543210', dateOfJoining: new Date('2026-01-15T00:00:00+05:30'),
            department: { name: 'Ops' }, designation: { name: 'FDO' }, branch: { name: 'Salem' },
        }];
        const r = await run('employee-master');
        expect(r.json.data.rows[0].slice(0, 6)).toEqual(['E1', 'Ravi K', 'Ops', 'FDO', 'Salem', '9876543210']);
    });

    it('Permission Register lists date, type, times and hours', async () => {
        rec.rows.permissionRequest = [{
            date: new Date('2026-10-05T00:00:00+05:30'), fromTime: '10:00', toTime: '11:30', hours: '1.5', status: 'APPROVED', reason: 'Bank',
            employee: { employeeId: 'E1', firstName: 'Ravi', lastName: 'K', department: null, branch: { name: 'Salem' } },
            permissionType: { permissionType: 'Personal' },
        }];
        const r = await run('permission-register', { fromDate: FROM, toDate: TO });
        expect(r.json.data.rows[0]).toEqual([expect.any(String), 'E1', 'Ravi K', 'Salem', 'Personal', '10:00', '11:30', 1.5, 'APPROVED', 'Bank']);
    });

    it('Staff Loan Deduction lists employee, month, year and amount', async () => {
        rec.rows.salaryPayLineItem = [{
            amount: '1500', salaryPayRecord: { month: 9, year: 2026, employee: { employeeId: 'E1', firstName: 'Ravi', lastName: 'K' } },
        }];
        const r = await run('staff-loan-deduction', { month: '9', year: '2026' });
        expect(r.json.data.rows[0]).toEqual(['E1', 'Ravi K', 9, 2026, 1500]);
    });
});
