import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Filters of the Staff Loan / Staff Advance reports (search, branch, department, employee, status/type,
 * closed-date range) reach the database query for every report. Figures and layouts are covered in service.test.ts.
 */

const { db, salary } = vi.hoisted(() => ({
    db: { staffLoan: { findMany: vi.fn() }, staffAdvance: { findMany: vi.fn() } } as any,
    salary: { getAdvanceSalarySummary: vi.fn() },
}));

vi.mock('@/app/lib/db', () => ({ prisma: db }));
vi.mock('@/app/lib/staff-advances/salary', () => salary);
vi.mock('@/app/lib/branch-lock', () => ({ getKolkataCalendarYmd: () => '2026-09-25' }));
vi.mock('@/app/lib/storage/staff-loan-document-storage', () => ({ isStaffLoanDocumentKeyFor: vi.fn(), readStaffLoanDocument: vi.fn() }));
vi.mock('@/app/lib/storage/gcs-client', () => ({ getSignedReadUrl: vi.fn() }));

import { listStaffSchedules, runStaffReport, staffReportFilterSchema } from './service';

const admin = () => ({ userId: 'u1', isAdmin: true, isHR: false, branchIds: null, assignments: [] }) as any;
const scoped = () => ({ userId: 'u1', isAdmin: true, isHR: false, branchIds: ['b1', 'b2'], assignments: [] }) as any;

const LOAN_REPORTS = ['active-staff-loans', 'staff-loan-closure'] as const;
const ADVANCE_REPORTS = ['active-staff-advances', 'staff-advance-closure'] as const;

const whereOf = (model: 'staffLoan' | 'staffAdvance') => JSON.stringify(db[model].findMany.mock.calls.map((c: any[]) => c[0].where));

beforeEach(() => {
    vi.clearAllMocks();
    db.staffLoan.findMany.mockResolvedValue([]);
    db.staffAdvance.findMany.mockResolvedValue([]);
    salary.getAdvanceSalarySummary.mockResolvedValue({ grossSalary: 0, otherDeductions: 0, existingLoanDeduction: 0, existingAdvanceDeduction: 0, currentInHand: 0 });
});

describe.each([
    ...LOAN_REPORTS.map((slug) => [slug, 'staffLoan', 'loanNumber'] as const),
    ...ADVANCE_REPORTS.map((slug) => [slug, 'staffAdvance', 'advanceNumber'] as const),
])('%s', (slug, model, numberField) => {
    it('Search matches the number, the employee name and the employee ID', async () => {
        await runStaffReport(slug, admin(), { search: 'ravi' });
        const where = whereOf(model);
        expect(where).toContain(`"${numberField}":{"contains":"ravi"`);
        expect(where).toContain('"firstName":{"contains":"ravi"');
        expect(where).toContain('"lastName":{"contains":"ravi"');
        expect(where).toContain('"employeeId":{"contains":"ravi"');
    });

    it('Department, Employee and Branch filters narrow the query', async () => {
        await runStaffReport(slug, admin(), { departmentId: 'dep-1', employeeId: 'emp-1', branchId: 'branch-1' });
        const where = whereOf(model);
        expect(where).toContain('"employee":{"departmentId":"dep-1"}');
        expect(where).toContain('"employeeId":"emp-1"');
        expect(where).toContain('"branchId":"branch-1"');
    });

    it('with no filters nothing extra is applied', async () => {
        await runStaffReport(slug, admin(), {});
        const where = whereOf(model);
        expect(where).not.toContain('dep-1');
        expect(where).not.toContain('"contains"');
    });

    it('a branch outside the user\'s access is refused', async () => {
        await expect(runStaffReport(slug, scoped(), { branchId: 'secret' })).rejects.toMatchObject({ status: 403 });
    });
});

describe('Closure reports: closed-date range (IST, inclusive)', () => {
    it.each([['staff-loan-closure', 'staffLoan'], ['staff-advance-closure', 'staffAdvance']] as const)('%s', async (slug, model) => {
        await runStaffReport(slug, admin(), { fromDate: '2026-10-01', toDate: '2026-10-13' });
        const where = whereOf(model);
        expect(where).toContain('2026-09-30T18:30:00.000Z'); // 1 Oct 00:00 IST
        expect(where).toContain('2026-10-13T18:29:59.999Z'); // 13 Oct 23:59:59.999 IST
    });

    it('a single date still filters, and no dates means all closed', async () => {
        await runStaffReport('staff-loan-closure', admin(), { fromDate: '2026-10-01' });
        expect(whereOf('staffLoan')).toContain('2026-09-30T18:30:00.000Z');
        expect(whereOf('staffLoan')).not.toContain('2026-10-13T18:29:59.999Z');
        db.staffLoan.findMany.mockClear();
        await runStaffReport('staff-loan-closure', admin(), {});
        expect(whereOf('staffLoan')).not.toContain('T18:');
    });
});

describe('Total Staff Outstanding: Type filter', () => {
    it('Staff Loan only reads loans; Staff Advance only reads advances; "all" reads both', async () => {
        await runStaffReport('staff-outstanding', admin(), { type: 'LOAN' });
        expect(db.staffLoan.findMany).toHaveBeenCalled();
        expect(db.staffAdvance.findMany).not.toHaveBeenCalled();

        vi.clearAllMocks();
        db.staffLoan.findMany.mockResolvedValue([]);
        db.staffAdvance.findMany.mockResolvedValue([]);
        await runStaffReport('staff-outstanding', admin(), { type: 'ADVANCE' });
        expect(db.staffAdvance.findMany).toHaveBeenCalled();
        expect(db.staffLoan.findMany).not.toHaveBeenCalled();

        vi.clearAllMocks();
        db.staffLoan.findMany.mockResolvedValue([]);
        db.staffAdvance.findMany.mockResolvedValue([]);
        await runStaffReport('staff-outstanding', admin(), {});
        expect(db.staffLoan.findMany).toHaveBeenCalled();
        expect(db.staffAdvance.findMany).toHaveBeenCalled();
    });

    it('applies search / department / employee to both loans and advances', async () => {
        await runStaffReport('staff-outstanding', admin(), { search: 'ravi', departmentId: 'dep-1', employeeId: 'emp-1' });
        for (const model of ['staffLoan', 'staffAdvance'] as const) {
            const where = whereOf(model);
            expect(where, model).toContain('"firstName":{"contains":"ravi"');
            expect(where, model).toContain('"departmentId":"dep-1"');
            expect(where, model).toContain('"employeeId":"emp-1"');
        }
    });
});

describe('filter values the page sends', () => {
    it('accepts exactly the filters the report page can send and "all" for branch', () => {
        const parsed = staffReportFilterSchema.parse({ search: ' x ', branchId: 'all', departmentId: 'd', employeeId: 'e', status: 'OVERDUE', type: 'LOAN', fromDate: '2026-10-01', toDate: '2026-10-13' });
        expect(parsed.branchId).toBeUndefined();
        expect(parsed.search).toBe('x');
        expect(parsed.status).toBe('OVERDUE');
    });

    it('rejects a malformed date instead of silently ignoring it', () => {
        expect(() => staffReportFilterSchema.parse({ fromDate: '01-10-2026' })).toThrow();
    });
});

describe.each([['LOAN', 'staffLoan', 'loanNumber', 'CLOSED'], ['ADVANCE', 'staffAdvance', 'advanceNumber', 'COMPLETED']] as const)(
    'Schedule list (%s): search, branch, department, employee, status',
    (kind, model, numberField, closedStatus) => {
        it('search / department / employee / branch reach the query', async () => {
            await listStaffSchedules(kind, admin(), { search: 'ravi', departmentId: 'dep-1', employeeId: 'emp-1', branchId: 'branch-1' });
            const where = whereOf(model);
            expect(where).toContain(`"${numberField}":{"contains":"ravi"`);
            expect(where).toContain('"employee":{"departmentId":"dep-1"}');
            expect(where).toContain('"employeeId":"emp-1"');
            expect(where).toContain('"branchId":"branch-1"');
        });

        it('status narrows to that status; no status lists active and closed', async () => {
            await listStaffSchedules(kind, admin(), { status: closedStatus });
            expect(whereOf(model)).toContain(`"status":{"in":["${closedStatus}"]}`);
            db[model].findMany.mockClear();
            await listStaffSchedules(kind, admin(), {});
            expect(whereOf(model)).toContain('"status":{"in":["ACTIVE","' + closedStatus + '"]}');
        });
    },
);
