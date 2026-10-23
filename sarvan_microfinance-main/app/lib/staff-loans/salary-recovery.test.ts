import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSalaryRecoveryDue, postSalaryRecoveryForPayroll, markSalaryRecoveryPosted } from './salary-recovery';

function makeDb() {
    return {
        staffLoan: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
        staffLoanTransaction: { create: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
        staffLoanRepaymentAllocation: { create: vi.fn() },
    } as any;
}

describe('getSalaryRecoveryDue', () => {
    it('picks the single next unpaid installment per loan, not a catch-up of every overdue one', async () => {
        const db = makeDb();
        db.staffLoan.findMany.mockResolvedValue([
            {
                id: 'loan1', loanNumber: 'SL-1',
                schedules: [
                    { id: 'sch1', installmentNo: 1, principalDue: 1000, interestDue: 0, dueDate: new Date('2026-07-01'), allocations: [{ principal: 1000, interest: 0 }] }, // fully paid
                    { id: 'sch2', installmentNo: 2, principalDue: 1000, interestDue: 0, dueDate: new Date('2026-08-01'), allocations: [] }, // overdue, unpaid
                    { id: 'sch3', installmentNo: 3, principalDue: 1000, interestDue: 0, dueDate: new Date('2026-09-01'), allocations: [] }, // this month, unpaid
                ],
            },
        ]);
        const result = await getSalaryRecoveryDue('emp1', 9, 2026, db);
        expect(result.breakdown).toHaveLength(1);
        expect(result.breakdown[0].scheduleId).toBe('sch2'); // the oldest unpaid, not sch3
        expect(result.breakdown[0].amount).toBe(1000);
        expect(result.totalAmount).toBe(1000);
    });

    it('only counts an installment\'s remaining balance, not its full original due amount', async () => {
        const db = makeDb();
        db.staffLoan.findMany.mockResolvedValue([
            {
                id: 'loan1', loanNumber: 'SL-1',
                schedules: [
                    { id: 'sch1', installmentNo: 1, principalDue: 1000, interestDue: 100, dueDate: new Date('2026-09-01'), allocations: [{ principal: 400, interest: 100 }] },
                ],
            },
        ]);
        const result = await getSalaryRecoveryDue('emp1', 9, 2026, db);
        expect(result.breakdown[0].principal).toBe(600);
        expect(result.breakdown[0].interest).toBe(0);
        expect(result.breakdown[0].amount).toBe(600);
    });

    it('excludes a loan whose only schedules due so far are already fully paid', async () => {
        const db = makeDb();
        db.staffLoan.findMany.mockResolvedValue([
            {
                id: 'loan1', loanNumber: 'SL-1',
                schedules: [{ id: 'sch1', installmentNo: 1, principalDue: 1000, interestDue: 0, dueDate: new Date('2026-09-01'), allocations: [{ principal: 1000, interest: 0 }] }],
            },
        ]);
        const result = await getSalaryRecoveryDue('emp1', 9, 2026, db);
        expect(result.breakdown).toHaveLength(0);
        expect(result.totalAmount).toBe(0);
    });

    it('combines multiple active SALARY-recovery loans for the same employee', async () => {
        const db = makeDb();
        db.staffLoan.findMany.mockResolvedValue([
            { id: 'loan1', loanNumber: 'SL-1', schedules: [{ id: 'sch1', installmentNo: 1, principalDue: 500, interestDue: 0, dueDate: new Date('2026-09-01'), allocations: [] }] },
            { id: 'loan2', loanNumber: 'SL-2', schedules: [{ id: 'sch2', installmentNo: 1, principalDue: 700, interestDue: 0, dueDate: new Date('2026-09-01'), allocations: [] }] },
        ]);
        const result = await getSalaryRecoveryDue('emp1', 9, 2026, db);
        expect(result.totalAmount).toBe(1200);
        expect(result.breakdown.map((b) => b.loanId).sort()).toEqual(['loan1', 'loan2']);
        expect(db.staffLoan.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { employeeId: 'emp1', status: 'ACTIVE', recoveryMethod: 'SALARY' },
        }));
    });
});

describe('postSalaryRecoveryForPayroll', () => {
    it('creates a PENDING SALARY_RECOVERY transaction and allocates it, for each loan with a due amount', async () => {
        const tx = makeDb();
        tx.staffLoan.findMany.mockResolvedValue([
            { id: 'loan1', loanNumber: 'SL-1', schedules: [{ id: 'sch1', installmentNo: 1, principalDue: 900, interestDue: 100, dueDate: new Date('2026-09-01'), allocations: [] }] },
        ]);
        tx.staffLoanTransaction.create.mockResolvedValue({ id: 'txn1' });

        const result = await postSalaryRecoveryForPayroll(tx, 'actor1', 'emp1', 9, 2026, 'payrec1');

        expect(tx.staffLoanTransaction.create).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
            data: expect.objectContaining({ loanId: 'loan1', type: 'SALARY_RECOVERY', status: 'PENDING', salaryPayRecordId: 'payrec1', amount: 1000, createdById: 'actor1' }),
        }));
        expect(tx.staffLoanRepaymentAllocation.create).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
            data: expect.objectContaining({ loanId: 'loan1', transactionId: 'txn1', scheduleId: 'sch1' }),
        }));
        expect(result.totalAmount).toBe(1000);
        expect(result.transactionIds).toEqual(['txn1']);
    });

    it('does nothing when no loan has a due amount', async () => {
        const tx = makeDb();
        tx.staffLoan.findMany.mockResolvedValue([]);
        const result = await postSalaryRecoveryForPayroll(tx, 'actor1', 'emp1', 9, 2026, 'payrec1');
        expect(tx.staffLoanTransaction.create).not.toHaveBeenCalled();
        expect(result.totalAmount).toBe(0);
        expect(result.transactionIds).toEqual([]);
    });
});

describe('markSalaryRecoveryPosted', () => {
    let tx: ReturnType<typeof makeDb>;
    beforeEach(() => {
        tx = makeDb();
    });

    it('does nothing when there are no PENDING SALARY_RECOVERY transactions for this record', async () => {
        tx.staffLoanTransaction.findMany.mockResolvedValue([]);
        await markSalaryRecoveryPosted(tx, 'payrec1');
        expect(tx.staffLoanTransaction.updateMany).not.toHaveBeenCalled();
        expect(tx.staffLoan.update).not.toHaveBeenCalled();
    });

    it('flips PENDING to POSTED and closes a loan that is now fully repaid', async () => {
        tx.staffLoanTransaction.findMany.mockResolvedValue([{ id: 'txn1', loanId: 'loan1' }]);
        tx.staffLoan.findUnique.mockResolvedValue({
            version: 1, status: 'ACTIVE',
            schedules: [{ id: 'sch1', principalDue: 1000, interestDue: 0, allocations: [{ principal: 1000, interest: 0 }] }],
        });

        await markSalaryRecoveryPosted(tx, 'payrec1');

        expect(tx.staffLoanTransaction.updateMany).toHaveBeenCalledExactlyOnceWith({
            where: { id: { in: ['txn1'] } },
            data: { status: 'POSTED', postedAt: expect.any(Date) },
        });
        expect(tx.staffLoan.update).toHaveBeenCalledExactlyOnceWith({
            where: { id: 'loan1' },
            data: { status: 'CLOSED', closedAt: expect.any(Date), version: { increment: 1 } },
        });
    });

    it('keeps the loan ACTIVE when there is still an outstanding balance', async () => {
        tx.staffLoanTransaction.findMany.mockResolvedValue([{ id: 'txn1', loanId: 'loan1' }]);
        tx.staffLoan.findUnique.mockResolvedValue({
            version: 1, status: 'ACTIVE',
            schedules: [
                { id: 'sch1', principalDue: 1000, interestDue: 0, allocations: [{ principal: 1000, interest: 0 }] },
                { id: 'sch2', principalDue: 1000, interestDue: 0, allocations: [] },
            ],
        });

        await markSalaryRecoveryPosted(tx, 'payrec1');

        expect(tx.staffLoan.update).toHaveBeenCalledExactlyOnceWith({
            where: { id: 'loan1' },
            data: { status: 'ACTIVE', closedAt: null, version: { increment: 1 } },
        });
    });

    it('deduplicates loanIds when the same loan has more than one pending transaction', async () => {
        tx.staffLoanTransaction.findMany.mockResolvedValue([
            { id: 'txn1', loanId: 'loan1' },
            { id: 'txn2', loanId: 'loan1' },
        ]);
        tx.staffLoan.findUnique.mockResolvedValue({
            version: 1, status: 'ACTIVE',
            schedules: [{ id: 'sch1', principalDue: 1000, interestDue: 0, allocations: [] }],
        });

        await markSalaryRecoveryPosted(tx, 'payrec1');

        expect(tx.staffLoan.findUnique).toHaveBeenCalledTimes(1);
        expect(tx.staffLoan.update).toHaveBeenCalledTimes(1);
    });
});
