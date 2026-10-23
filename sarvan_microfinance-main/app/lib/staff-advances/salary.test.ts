import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

const db = vi.hoisted(() => ({ staffLoan: { findMany: vi.fn() }, staffAdvance: { findMany: vi.fn() } }));
vi.mock('@/app/lib/db', () => ({ prisma: db }));
vi.mock('@/app/lib/payroll/run-payroll', () => ({ computeEmployeePayroll: vi.fn() }));

import { loadObligations } from './salary';

const d = (v: number) => new Prisma.Decimal(v);

beforeEach(() => {
    vi.resetAllMocks();
    db.staffLoan.findMany.mockResolvedValue([{
        id: 'loan1', loanNumber: 'SL-000001', status: 'ACTIVE', approvedAmount: d(9000), requestedAmount: d(9000), tenureMonths: 3,
        interestType: 'INTEREST_FREE', annualInterestRate: d(0), createdAt: new Date('2026-05-01T00:00:00Z'), closedAt: null,
        schedules: [1, 2, 3].map(n => ({
            id: `ls${n}`, installmentNo: n, dueDate: new Date(`2026-0${5 + n}-05T00:00:00Z`), principalDue: d(3000), interestDue: d(0),
            allocations: n === 1 ? [{ principal: d(3000), interest: d(0), transaction: { transactionDate: new Date('2026-06-05T00:00:00Z') } }] : [],
        })),
    }, {
        id: 'loan2', loanNumber: 'SL-000002', status: 'SUBMITTED', approvedAmount: null, requestedAmount: d(5000), tenureMonths: 5,
        interestType: 'INTEREST_FREE', annualInterestRate: d(0), createdAt: new Date('2026-09-01T00:00:00Z'), closedAt: null, schedules: [],
    }]);
    db.staffAdvance.findMany.mockResolvedValue([{
        id: 'adv1', advanceNumber: 'SA-000001', status: 'ACTIVE', amount: d(4000), repaymentMonths: 2, createdAt: new Date('2026-08-01T00:00:00Z'), completedAt: null,
        schedules: [
            { id: 'as1', installmentNo: 1, dueDate: new Date('2026-09-10T00:00:00Z'), amountDue: d(2000), allocations: [{ amount: d(2000), transaction: { postedAt: new Date('2026-09-10T00:00:00Z') } }] },
            { id: 'as2', installmentNo: 2, dueDate: new Date('2999-10-10T00:00:00Z'), amountDue: d(2000), allocations: [] },
        ],
    }]);
});

describe('loadObligations - each loan / advance has its own repayment track', () => {
    it('gives every disbursed loan and advance a separate schedule, and none to the undisbursed', async () => {
        const rows = await loadObligations('emp1');
        const byNumber = Object.fromEntries(rows.map(r => [r.number, r]));

        expect(byNumber['SL-000001'].schedule).toHaveLength(3);
        expect(byNumber['SL-000001'].schedule!.map(s => s.status)).toEqual(['PAID', expect.stringMatching(/PENDING|OVERDUE/), expect.stringMatching(/PENDING|OVERDUE/)]);
        expect(byNumber['SL-000001'].schedule!.reduce((sum, s) => sum + s.totalDue, 0)).toBe(9000);

        expect(byNumber['SA-000001'].schedule).toHaveLength(2);
        expect(byNumber['SA-000001'].schedule!.map(s => s.status)).toEqual(['PAID', 'PENDING']);
        expect(byNumber['SA-000001'].schedule!.every(s => s.interest === 0)).toBe(true);
        expect(byNumber['SA-000001'].schedule!.reduce((sum, s) => sum + s.totalDue, 0)).toBe(4000);

        expect(byNumber['SL-000002'].schedule).toBeNull();
    });

    it('never mixes the schedules: each track only contains its own installments', async () => {
        const rows = await loadObligations('emp1');
        const ids = rows.flatMap(r => r.schedule ?? []).map(s => s.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(rows.find(r => r.number === 'SL-000001')!.schedule!.every(s => s.id.startsWith('ls'))).toBe(true);
        expect(rows.find(r => r.number === 'SA-000001')!.schedule!.every(s => s.id.startsWith('as'))).toBe(true);
    });
});

describe('loadObligations - closed (early settled) loans and advances', () => {
    // SL-000003 shape: 3 installments of 3000 principal + 300 interest; the early settlement paid the principal and
    // waived all the future interest, so nothing was allocated to interest.
    const settledLoan = {
        id: 'loan3', loanNumber: 'SL-000003', status: 'CLOSED', approvedAmount: d(9000), requestedAmount: d(9000), tenureMonths: 3,
        interestType: 'FLAT', annualInterestRate: d(10), createdAt: new Date('2026-05-01T00:00:00Z'), closedAt: new Date('2026-06-01T00:00:00Z'),
        schedules: [1, 2, 3].map(n => ({
            id: `cs${n}`, installmentNo: n, dueDate: new Date(`2999-0${n}-05T00:00:00Z`), principalDue: d(3000), interestDue: d(300), interestWaived: d(300),
            allocations: [{ principal: d(3000), interest: d(0), transaction: { transactionDate: new Date('2026-06-01T00:00:00Z') } }],
        })),
    };

    it('shows every installment of an early-settled loan as PAID with nothing outstanding (the recorded waived interest is not owed)', async () => {
        db.staffLoan.findMany.mockResolvedValue([settledLoan]);
        db.staffAdvance.findMany.mockResolvedValue([]);
        const [row] = await loadObligations('emp1');
        expect(row.schedule!.map(s => s.status)).toEqual(['PAID', 'PAID', 'PAID']);
        expect(row.schedule!.every(s => s.outstanding === 0)).toBe(true);
        expect(row.outstandingAmount).toBe(0);
        expect(row.paidInstallments).toBe(3);
        expect(row.remainingInstallments).toBe(0);
    });

    it('still shows an installment with unpaid interest that was NOT waived as PARTIAL', async () => {
        db.staffLoan.findMany.mockResolvedValue([{ ...settledLoan, status: 'ACTIVE', closedAt: null, schedules: settledLoan.schedules.map(s => ({ ...s, interestWaived: d(0) })) }]);
        db.staffAdvance.findMany.mockResolvedValue([]);
        const [row] = await loadObligations('emp1');
        expect(row.schedule!.map(s => s.status)).toEqual(['PARTIAL', 'PARTIAL', 'PARTIAL']);
        expect(row.outstandingAmount).toBe(900);
    });

    it('shows a completed (settled) advance as PAID with nothing outstanding', async () => {
        db.staffLoan.findMany.mockResolvedValue([]);
        db.staffAdvance.findMany.mockResolvedValue([{
            id: 'adv9', advanceNumber: 'SA-000009', status: 'COMPLETED', amount: d(10000), repaymentMonths: 2, createdAt: new Date('2026-08-01T00:00:00Z'), completedAt: new Date('2026-09-01T00:00:00Z'),
            schedules: [1, 2].map(n => ({ id: `ss${n}`, installmentNo: n, dueDate: new Date('2999-10-10T00:00:00Z'), amountDue: d(5000), allocations: [{ amount: d(5000), transaction: { postedAt: new Date('2026-09-01T00:00:00Z') } }] })),
        }]);
        const [row] = await loadObligations('emp1');
        expect(row.schedule!.map(s => s.status)).toEqual(['PAID', 'PAID']);
        expect(row.outstandingAmount).toBe(0);
        expect(row.paidInstallments).toBe(2);
    });
});
