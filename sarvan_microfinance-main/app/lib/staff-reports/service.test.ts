import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

const { db, salary } = vi.hoisted(() => ({
    db: { staffLoan: { findMany: vi.fn() }, staffAdvance: { findMany: vi.fn() } } as any,
    salary: { getAdvanceSalarySummary: vi.fn() },
}));

vi.mock('@/app/lib/db', () => ({ prisma: db }));
vi.mock('@/app/lib/staff-advances/salary', () => salary);
// "Today" is fixed at 2026-09-25; any other date is converted to its real IST calendar day.
vi.mock('@/app/lib/branch-lock', () => ({
    getKolkataCalendarYmd: (d: Date) => (Math.abs(d.getTime() - Date.now()) < 60_000 ? '2026-09-25' : new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10)),
}));
vi.mock('@/app/lib/storage/staff-loan-document-storage', () => ({ isStaffLoanDocumentKeyFor: vi.fn(), readStaffLoanDocument: vi.fn() }));
vi.mock('@/app/lib/storage/gcs-client', () => ({ getSignedReadUrl: vi.fn() }));

import { getStaffScheduleDetail, listStaffSchedules, runStaffReport, staffReportFilterSchema } from './service';

const D = (n: number | string) => new Prisma.Decimal(n);
const admin = (over: Record<string, unknown> = {}) => ({ userId: 'u1', isAdmin: true, isHR: false, branchIds: null, assignments: [], ...over }) as any;
const nobody = () => ({ userId: 'u1', isAdmin: false, isHR: false, branchIds: null, assignments: [] }) as any;
const emp = (id: string, first: string) => ({
    id, employeeId: `E-${id}`, firstName: first, lastName: 'Kumar', role: 'FDO',
    department: { name: 'Operations' }, designation: { name: 'Officer' }, branch: { name: 'Karur' },
});
const alloc = (principal: number, interest: number) => ({ principal: D(principal), interest: D(interest), transaction: { transactionDate: new Date('2026-09-30') } });

// 2 installments of 3300 principal + 330 interest, the first one paid in full.
const loan = (id: string, employee: ReturnType<typeof emp>, over: Record<string, unknown> = {}) => ({
    id: `loan-${id}`, loanNumber: `SL-00000${id}`, employeeId: employee.id, status: 'ACTIVE', approvedAmount: D(6600), requestedAmount: D(6600), tenureMonths: 2, interestType: 'FLAT', annualInterestRate: D(12),
    employee, branch: { name: 'Karur' },
    schedules: [
        { id: `${id}a`, installmentNo: 1, dueDate: new Date('2026-09-30'), principalDue: D(3300), interestDue: D(330), allocations: [alloc(3300, 330)] },
        { id: `${id}b`, installmentNo: 2, dueDate: new Date('2026-10-30'), principalDue: D(3300), interestDue: D(330), allocations: [] },
    ],
    ...over,
});
const advance = (id: string, employee: ReturnType<typeof emp>, over: Record<string, unknown> = {}) => ({
    id: `adv-${id}`, advanceNumber: `SA-00000${id}`, employeeId: employee.id, status: 'ACTIVE', amount: D(10000), repaymentMonths: 2,
    employee, branch: { name: 'Karur' },
    schedules: [
        { id: `${id}a`, installmentNo: 1, dueDate: new Date('2026-09-30'), amountDue: D(5000), allocations: [] },
        { id: `${id}b`, installmentNo: 2, dueDate: new Date('2026-10-30'), amountDue: D(5000), allocations: [] },
    ],
    ...over,
});

beforeEach(() => {
    vi.clearAllMocks();
    db.staffLoan.findMany.mockResolvedValue([]);
    db.staffAdvance.findMany.mockResolvedValue([]);
    salary.getAdvanceSalarySummary.mockResolvedValue({
        grossSalary: 30000, otherDeductions: 1500, existingLoanDeduction: 3630, existingAdvanceDeduction: 5000, currentInHand: 19870,
    });
});

const col = (result: Awaited<ReturnType<typeof runStaffReport>>, header: string) => result.headers.indexOf(header);

describe('staffReportFilterSchema', () => {
    it('rejects unknown filters and an unknown type', () => {
        expect(staffReportFilterSchema.safeParse({ search: 'a', type: 'LOAN' }).success).toBe(true);
        expect(staffReportFilterSchema.safeParse({ type: 'BOTH' }).success).toBe(false);
        expect(staffReportFilterSchema.safeParse({ limit: 5 }).success).toBe(false);
    });
});

describe('access', () => {
    it('refuses a user with no Staff Loan / Staff Advance access', async () => {
        await expect(runStaffReport('active-staff-loans', nobody(), {})).rejects.toMatchObject({ status: 403 });
        await expect(runStaffReport('staff-outstanding', nobody(), {})).rejects.toMatchObject({ status: 403 });
        expect(db.staffLoan.findMany).not.toHaveBeenCalled();
    });

    it('cannot pick a branch outside the user\'s branch access', async () => {
        await expect(runStaffReport('active-staff-loans', admin({ branchIds: ['b1'] }), { branchId: 'b2' })).rejects.toMatchObject({ status: 403 });
        expect(db.staffLoan.findMany).not.toHaveBeenCalled();
    });
});

describe('Active Staff Loan report', () => {
    it('asks only for ACTIVE loans and reports principal/interest outstanding from the ledger', async () => {
        db.staffLoan.findMany.mockResolvedValue([loan('1', emp('e1', 'Arun'))]);
        const result = await runStaffReport('active-staff-loans', admin(), {});

        expect(JSON.stringify(db.staffLoan.findMany.mock.calls[0][0].where)).toContain('"status":"ACTIVE"');
        expect(result.headers).toEqual([
            'Loan Number', 'Employee ID', 'Employee Name', 'Department', 'Designation', 'Branch', 'Loan Amount', 'Total Repayable', 'Principal Outstanding',
            'Interest Outstanding', 'Total Outstanding', 'Monthly Repayment', 'Paid Amount', 'Remaining Installments', 'Next Due Month', 'Status',
        ]);
        const row = result.rows[0];
        expect(row[col(result, 'Loan Amount')]).toBe(6600);
        expect(row[col(result, 'Total Repayable')]).toBe(7260);
        expect(row[col(result, 'Principal Outstanding')]).toBe(3300);
        expect(row[col(result, 'Interest Outstanding')]).toBe(330);
        expect(row[col(result, 'Total Outstanding')]).toBe(3630);
        expect(row[col(result, 'Monthly Repayment')]).toBe(3630);
        expect(row[col(result, 'Paid Amount')]).toBe(3630);
        expect(row[col(result, 'Remaining Installments')]).toBe(1);
        expect(row[col(result, 'Next Due Month')]).toBe('Oct 2026');
        expect(row[col(result, 'Status')]).toBe('ACTIVE');
        expect(result.summary.find(c => c.label === 'Total Outstanding')?.value).toBe(3630);
    });

    it('marks a loan with an unpaid installment past its due date as OVERDUE and filters by that status', async () => {
        const late = loan('2', emp('e2', 'Bala'), {
            schedules: [{ id: '2a', installmentNo: 1, dueDate: new Date('2026-08-30'), principalDue: D(3300), interestDue: D(330), allocations: [] }],
        });
        db.staffLoan.findMany.mockResolvedValue([loan('1', emp('e1', 'Arun')), late]);
        const overdue = await runStaffReport('active-staff-loans', admin(), { status: 'OVERDUE' });
        expect(overdue.rows.map(r => r[0])).toEqual(['SL-000002']);
        expect(overdue.rows[0][col(overdue, 'Status')]).toBe('OVERDUE');
    });
});

describe('Active Staff Advance report', () => {
    it('has no interest column and derives everything from the schedule', async () => {
        db.staffAdvance.findMany.mockResolvedValue([advance('1', emp('e1', 'Arun'))]);
        const result = await runStaffReport('active-staff-advances', admin(), {});

        expect(JSON.stringify(db.staffAdvance.findMany.mock.calls[0][0].where)).toContain('"status":"ACTIVE"');
        expect(result.headers.some(h => /interest/i.test(h))).toBe(false);
        const row = result.rows[0];
        expect(row[col(result, 'Advance Amount')]).toBe(10000);
        expect(row[col(result, 'Total Repayable')]).toBe(10000);
        expect(row[col(result, 'Principal Outstanding')]).toBe(10000);
        expect(row[col(result, 'Monthly Repayment')]).toBe(5000);
        expect(row[col(result, 'Remaining Installments')]).toBe(2);
        expect(row[col(result, 'Next Due Month')]).toBe('Sep 2026');
    });
});

describe('Staff Loan Schedule report (list, then View Schedule)', () => {
    it('lists the loans first, with no installment rows', async () => {
        db.staffLoan.findMany.mockResolvedValue([loan('1', emp('e1', 'Arun'))]);
        const list = await listStaffSchedules('LOAN', admin(), {});

        expect(list.items).toHaveLength(1);
        expect(list.items[0]).toMatchObject({
            id: 'loan-1', number: 'SL-000001', employeeName: 'Arun Kumar', employeeCode: 'E-e1', department: 'Operations', branch: 'Karur',
            amount: 6600, installments: 2, status: 'ACTIVE', totalOutstanding: 3630,
        });
        expect(JSON.stringify(list)).not.toMatch(/Sep 2026/);
        expect(JSON.stringify(db.staffLoan.findMany.mock.calls[0][0].where)).toContain('"in":["ACTIVE","CLOSED"]');
    });

    it('narrows to closed loans on the status filter', async () => {
        await listStaffSchedules('LOAN', admin(), { status: 'CLOSED' });
        expect(JSON.stringify(db.staffLoan.findMany.mock.calls[0][0].where)).toContain('"in":["CLOSED"]');
    });

    it('shows the schedule by Month + Year only, never the actual due date', async () => {
        db.staffLoan.findMany.mockResolvedValue([loan('1', emp('e1', 'Arun'))]);
        const detail = await getStaffScheduleDetail('LOAN', admin(), 'loan-1');

        expect(JSON.stringify(db.staffLoan.findMany.mock.calls[0][0].where)).toContain('"id":"loan-1"');
        expect(detail).toMatchObject({ number: 'SL-000001', amount: 6600, tenureMonths: 2, interestLabel: 'Flat 12% p.a.' });
        expect(detail.schedule.map(r => r.month)).toEqual(['Sep 2026', 'Oct 2026']);
        expect(JSON.stringify(detail.schedule)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
        expect(detail.schedule[0]).toMatchObject({ principal: 3300, interest: 330, totalDue: 3630, paid: 3630, outstanding: 0, status: 'PAID' });
        expect(detail.schedule[1]).toMatchObject({ outstanding: 3630 });
    });

    it('shows a settled loan as settled with nothing outstanding (waived interest is not owed)', async () => {
        const settled = loan('3', emp('e3', 'Chitra'), {
            status: 'CLOSED',
            schedules: [
                { id: '3a', installmentNo: 1, dueDate: new Date('2026-09-30'), principalDue: D(3300), interestDue: D(330), allocations: [alloc(3300, 330)] },
                { id: '3b', installmentNo: 2, dueDate: new Date('2026-10-30'), principalDue: D(3300), interestDue: D(330), allocations: [alloc(3300, 0)] },
            ],
        });
        db.staffLoan.findMany.mockResolvedValue([settled]);
        const detail = await getStaffScheduleDetail('LOAN', admin(), 'loan-3');
        expect(detail.schedule.map(r => r.outstanding)).toEqual([0, 0]);
        expect(detail.schedule.map(r => r.status)).toEqual(['PAID', 'SETTLED']);
    });

    it('treats a loan outside the user\'s access as not found, and refuses a user with no access', async () => {
        db.staffLoan.findMany.mockResolvedValue([]);
        await expect(getStaffScheduleDetail('LOAN', admin(), 'other')).rejects.toMatchObject({ status: 404 });
        await expect(getStaffScheduleDetail('LOAN', nobody(), 'loan-1')).rejects.toMatchObject({ status: 403 });
        await expect(listStaffSchedules('LOAN', nobody(), {})).rejects.toMatchObject({ status: 403 });
    });
});

describe('Staff Advance Schedule report (list, then View Schedule)', () => {
    it('lists the advances first and has no interest anywhere', async () => {
        db.staffAdvance.findMany.mockResolvedValue([advance('1', emp('e1', 'Arun'))]);
        const list = await listStaffSchedules('ADVANCE', admin(), {});
        expect(list.items[0]).toMatchObject({ number: 'SA-000001', amount: 10000, installments: 2, status: 'ACTIVE', totalOutstanding: 10000 });
        expect(JSON.stringify(list)).not.toMatch(/interest/i);
    });

    it('shows two Month rows, interest-free, with the advance repayment limit intact', async () => {
        db.staffAdvance.findMany.mockResolvedValue([advance('1', emp('e1', 'Arun'))]);
        const detail = await getStaffScheduleDetail('ADVANCE', admin(), 'adv-1');

        expect(detail.interestLabel).toBeNull();
        expect(detail.tenureMonths).toBe(2);
        expect(detail.schedule).toHaveLength(2);
        expect(detail.schedule.map(r => r.month)).toEqual(['Sep 2026', 'Oct 2026']);
        expect(detail.schedule.every(r => r.interest === 0)).toBe(true);
        expect(detail.schedule[0]).toMatchObject({ principal: 5000, totalDue: 5000, paid: 0, outstanding: 5000, status: 'PENDING' });
    });
});

describe('Staff Loan Closure report', () => {
    const settledLoan = () => loan('5', emp('e5', 'Esha'), {
        status: 'CLOSED', disbursedAt: new Date('2026-08-01T00:00:00Z'), closedAt: new Date('2026-09-20T05:00:00Z'),
        schedules: [
            { id: '5a', installmentNo: 1, dueDate: new Date('2026-09-30'), principalDue: D(3300), interestDue: D(330), allocations: [alloc(3300, 330)] },
            { id: '5b', installmentNo: 2, dueDate: new Date('2026-10-30'), principalDue: D(3300), interestDue: D(330), allocations: [alloc(3300, 0)] },
        ],
        transactions: [{ paymentMode: 'BANK_TRANSFER', reference: 'UTR55', createdBy: { firstName: 'Mani', lastName: 'Manager' } }],
    });
    const repaidLoan = () => loan('6', emp('e6', 'Farah'), {
        status: 'CLOSED', disbursedAt: new Date('2026-06-01T00:00:00Z'), closedAt: new Date('2026-09-10T05:00:00Z'),
        schedules: [{ id: '6a', installmentNo: 1, dueDate: new Date('2026-09-05'), principalDue: D(3300), interestDue: D(330), allocations: [alloc(3300, 330)] }],
        transactions: [],
    });

    it('asks only for CLOSED loans and applies the closed-date range in IST', async () => {
        await runStaffReport('staff-loan-closure', admin(), { fromDate: '2026-09-01', toDate: '2026-09-30' });
        const where = db.staffLoan.findMany.mock.calls[0][0].where;
        expect(JSON.stringify(where)).toContain('"status":"CLOSED"');
        const range = where.AND[1].closedAt;
        expect(range.gte.toISOString()).toBe('2026-08-31T18:30:00.000Z');
        expect(range.lte.toISOString()).toBe('2026-09-30T18:29:59.999Z');
    });

    it('reports an early settlement with its payment details and the interest it waived', async () => {
        db.staffLoan.findMany.mockResolvedValue([settledLoan(), repaidLoan()]);
        const result = await runStaffReport('staff-loan-closure', admin(), {});

        const early = result.rows.find(r => r[0] === 'SL-000005')!;
        expect(early[col(result, 'Loan Amount')]).toBe(6600);
        expect(early[col(result, 'Total Repayable')]).toBe(7260);
        expect(early[col(result, 'Total Paid')]).toBe(6930);
        expect(early[col(result, 'Interest Waived')]).toBe(330);
        expect(early[col(result, 'Closed On')]).toBe('20 Sep 2026');
        expect(early[col(result, 'Closure Type')]).toBe('Early Settlement');
        expect(early[col(result, 'Payment Method')]).toBe('Bank Transfer');
        expect(early[col(result, 'Reference')]).toBe('UTR55');
        expect(early[col(result, 'Settled By')]).toBe('Mani Manager');

        const regular = result.rows.find(r => r[0] === 'SL-000006')!;
        expect(regular[col(result, 'Closure Type')]).toBe('Regular Repayment');
        expect(regular[col(result, 'Interest Waived')]).toBe(0);
        expect(regular[col(result, 'Payment Method')]).toBe('');
        expect(result.summary.find(c => c.label === 'Early Settlements')?.value).toBe(1);
        expect(result.summary.find(c => c.label === 'Interest Waived')?.value).toBe(330);
    });

    it('filters by closure type', async () => {
        db.staffLoan.findMany.mockResolvedValue([settledLoan(), repaidLoan()]);
        const early = await runStaffReport('staff-loan-closure', admin(), { status: 'EARLY_SETTLEMENT' });
        expect(early.rows.map(r => r[0])).toEqual(['SL-000005']);
        const regular = await runStaffReport('staff-loan-closure', admin(), { status: 'REGULAR' });
        expect(regular.rows.map(r => r[0])).toEqual(['SL-000006']);
    });

    it('is refused without access', async () => {
        await expect(runStaffReport('staff-loan-closure', nobody(), {})).rejects.toMatchObject({ status: 403 });
    });
});

describe('Staff Advance Closure report', () => {
    const paid = [{ amount: D(5000) }];
    const completed = (id: string, transactions: unknown[]) => advance(id, emp('e' + id, 'Gita'), {
        status: 'COMPLETED', disbursedAt: new Date('2026-08-01T00:00:00Z'), completedAt: new Date('2026-09-22T05:00:00Z'), transactions,
        schedules: [
            { id: id + 'a', installmentNo: 1, dueDate: new Date('2026-09-30'), amountDue: D(5000), allocations: paid },
            { id: id + 'b', installmentNo: 2, dueDate: new Date('2026-10-30'), amountDue: D(5000), allocations: paid },
        ],
    });

    it('asks only for COMPLETED advances and has no interest column', async () => {
        db.staffAdvance.findMany.mockResolvedValue([completed('7', [])]);
        const result = await runStaffReport('staff-advance-closure', admin(), {});
        expect(JSON.stringify(db.staffAdvance.findMany.mock.calls[0][0].where)).toContain('"status":"COMPLETED"');
        expect(result.headers.some(h => /interest/i.test(h))).toBe(false);
        expect(result.rows[0][col(result, 'Advance Amount')]).toBe(10000);
        expect(result.rows[0][col(result, 'Total Paid')]).toBe(10000);
        expect(result.rows[0][col(result, 'Closed On')]).toBe('22 Sep 2026');
    });

    it('tells an early settlement (paid directly) from a salary-deduction closure', async () => {
        db.staffAdvance.findMany.mockResolvedValue([
            completed('7', [{ paymentMode: 'CASH', reference: null, createdBy: { firstName: 'Mani', lastName: 'Manager' } }]),
            completed('8', []),
        ]);
        const result = await runStaffReport('staff-advance-closure', admin(), {});
        const early = result.rows.find(r => r[0] === 'SA-000007')!;
        expect(early[col(result, 'Closure Type')]).toBe('Early Settlement');
        expect(early[col(result, 'Payment Method')]).toBe('Cash');
        expect(early[col(result, 'Settled By')]).toBe('Mani Manager');
        expect(result.rows.find(r => r[0] === 'SA-000008')![col(result, 'Closure Type')]).toBe('Salary Deduction');

        const onlyEarly = await runStaffReport('staff-advance-closure', admin(), { status: 'EARLY_SETTLEMENT' });
        expect(onlyEarly.rows.map(r => r[0])).toEqual(['SA-000007']);
    });

    it('is refused without access', async () => {
        await expect(runStaffReport('staff-advance-closure', nobody(), {})).rejects.toMatchObject({ status: 403 });
    });
});

describe('Total Staff Outstanding report', () => {
    it('combines loans and advances per employee without counting anyone twice', async () => {
        const arun = emp('e1', 'Arun');
        db.staffLoan.findMany.mockResolvedValue([loan('1', arun), loan('2', arun)]); // two loans, same employee
        db.staffAdvance.findMany.mockResolvedValue([advance('1', arun), advance('2', emp('e2', 'Bala'))]);
        const result = await runStaffReport('staff-outstanding', admin(), {});

        expect(result.rows).toHaveLength(2);
        const a = result.rows.find(r => r[col(result, 'Employee')] === 'Arun Kumar')!;
        expect(a[col(result, 'Loan Principal')]).toBe(6600);
        expect(a[col(result, 'Loan Interest')]).toBe(660);
        expect(a[col(result, 'Staff Loan Outstanding')]).toBe(7260);
        expect(a[col(result, 'Advance Principal')]).toBe(10000);
        expect(a[col(result, 'Staff Advance Outstanding')]).toBe(10000);
        expect(a[col(result, 'Advance Interest')]).toBe(0);
        expect(a[col(result, 'Total Principal')]).toBe(16600);
        expect(a[col(result, 'Total Interest')]).toBe(660);
        expect(a[col(result, 'Total Outstanding')]).toBe(17260);

        const cards = Object.fromEntries(result.summary.map(c => [c.label, c.value]));
        expect(cards).toEqual({
            'Total Staff Loan Outstanding': 7260, 'Total Staff Loan Principal': 6600, 'Total Staff Loan Interest': 660,
            'Total Staff Advance Outstanding': 20000, 'Total Staff Principal Outstanding': 26600, 'Total Staff Outstanding': 27260,
        });
    });

    it('adds the salary picture from the existing payroll calculation, and leaves it blank when payroll cannot be computed', async () => {
        db.staffLoan.findMany.mockResolvedValue([loan('1', emp('e1', 'Arun'))]);
        db.staffAdvance.findMany.mockResolvedValue([advance('2', emp('e2', 'Bala'))]);
        salary.getAdvanceSalarySummary.mockImplementation(async (id: string) => {
            if (id === 'e2') throw new Error('no salary set-up');
            return { grossSalary: 30000, otherDeductions: 1500, existingLoanDeduction: 3630, existingAdvanceDeduction: 5000, currentInHand: 19870 };
        });
        const result = await runStaffReport('staff-outstanding', admin(), {});

        const a = result.rows.find(r => r[col(result, 'Employee')] === 'Arun Kumar')!;
        expect(a[col(result, 'Current Salary')]).toBe(30000);
        expect(a[col(result, 'Staff Loan Deduction')]).toBe(3630);
        expect(a[col(result, 'Staff Advance Deduction')]).toBe(5000);
        expect(a[col(result, 'Current In-Hand Salary')]).toBe(19870);
        expect(a[col(result, 'Expected In-Hand (No Staff Deductions)')]).toBe(28500);
        const b = result.rows.find(r => r[col(result, 'Employee')] === 'Bala Kumar')!;
        expect(b[col(result, 'Current In-Hand Salary')]).toBe('');
        expect(b[col(result, 'Total Outstanding')]).toBe(10000);
    });

    it('type filter keeps loans and advances apart', async () => {
        db.staffLoan.findMany.mockResolvedValue([loan('1', emp('e1', 'Arun'))]);
        const loansOnly = await runStaffReport('staff-outstanding', admin(), { type: 'LOAN' });
        expect(db.staffAdvance.findMany).not.toHaveBeenCalled();
        expect(loansOnly.rows[0][col(loansOnly, 'Staff Advance Outstanding')]).toBe(0);

        db.staffAdvance.findMany.mockResolvedValue([advance('1', emp('e1', 'Arun'))]);
        db.staffLoan.findMany.mockClear();
        const advancesOnly = await runStaffReport('staff-outstanding', admin(), { type: 'ADVANCE' });
        expect(db.staffLoan.findMany).not.toHaveBeenCalled();
        expect(advancesOnly.rows[0][col(advancesOnly, 'Staff Loan Outstanding')]).toBe(0);
        expect(advancesOnly.rows[0][col(advancesOnly, 'Total Outstanding')]).toBe(10000);
    });
});
