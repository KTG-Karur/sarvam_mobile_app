import { describe, expect, it, vi } from 'vitest';
import {
    clearPendingAdvanceRecovery,
    getAdvanceRecoveryDue,
    markAdvanceRecoveryPosted,
    postAdvanceRecoveryForPayroll,
} from './salary-recovery';

function makeDb() {
    return {
        staffAdvance: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
        staffAdvanceTransaction: { create: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
        staffAdvanceRepaymentAllocation: { create: vi.fn(), deleteMany: vi.fn() },
        staffAdvanceDecision: { create: vi.fn() },
    } as any;
}

const sched = (id: string, installmentNo: number, amountDue: number, dueDate: string, paid: number[] = []) => ({
    id, installmentNo, amountDue, dueDate: new Date(dueDate), allocations: paid.map(amount => ({ amount })),
});

describe('getAdvanceRecoveryDue', () => {
    it('recovers only the next unpaid installment, never both in one month', async () => {
        const db = makeDb();
        db.staffAdvance.findMany.mockResolvedValue([
            { id: 'adv1', advanceNumber: 'SA-000001', schedules: [sched('s1', 1, 2500, '2026-08-25'), sched('s2', 2, 2500, '2026-09-25')] },
        ]);
        const result = await getAdvanceRecoveryDue('emp1', 9, 2026, db);
        expect(result.breakdown).toHaveLength(1);
        expect(result.breakdown[0]).toMatchObject({ scheduleId: 's1', installmentNo: 1, amount: 2500 });
        expect(result.totalAmount).toBe(2500);
    });

    it('moves on to installment 2 once installment 1 is fully paid', async () => {
        const db = makeDb();
        db.staffAdvance.findMany.mockResolvedValue([
            { id: 'adv1', advanceNumber: 'SA-000001', schedules: [sched('s1', 1, 2500, '2026-08-25', [2500]), sched('s2', 2, 2500, '2026-09-25')] },
        ]);
        const result = await getAdvanceRecoveryDue('emp1', 9, 2026, db);
        expect(result.breakdown[0].scheduleId).toBe('s2');
    });

    it('only counts the remaining balance of a partly recovered installment', async () => {
        const db = makeDb();
        db.staffAdvance.findMany.mockResolvedValue([
            { id: 'adv1', advanceNumber: 'SA-000001', schedules: [sched('s1', 1, 2500, '2026-09-25', [1000])] },
        ]);
        const result = await getAdvanceRecoveryDue('emp1', 9, 2026, db);
        expect(result.totalAmount).toBe(1500);
    });

    it('returns nothing when nothing is due or everything due is paid', async () => {
        const db = makeDb();
        db.staffAdvance.findMany.mockResolvedValue([
            { id: 'adv1', advanceNumber: 'SA-000001', schedules: [] },
            { id: 'adv2', advanceNumber: 'SA-000002', schedules: [sched('s1', 1, 100, '2026-09-25', [100])] },
        ]);
        const result = await getAdvanceRecoveryDue('emp1', 9, 2026, db);
        expect(result).toEqual({ totalAmount: 0, breakdown: [] });
    });

    it('only looks at ACTIVE advances of that employee', async () => {
        const db = makeDb();
        db.staffAdvance.findMany.mockResolvedValue([]);
        await getAdvanceRecoveryDue('emp1', 9, 2026, db);
        expect(db.staffAdvance.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { employeeId: 'emp1', status: 'ACTIVE' } }));
    });
});

describe('clearPendingAdvanceRecovery', () => {
    it('deletes only PENDING deductions of that payroll record, allocations first', async () => {
        const tx = makeDb();
        await clearPendingAdvanceRecovery(tx, 'pay1');
        expect(tx.staffAdvanceRepaymentAllocation.deleteMany).toHaveBeenCalledWith({ where: { transaction: { salaryPayRecordId: 'pay1', status: 'PENDING' } } });
        expect(tx.staffAdvanceTransaction.deleteMany).toHaveBeenCalledWith({ where: { salaryPayRecordId: 'pay1', status: 'PENDING' } });
    });
});

describe('postAdvanceRecoveryForPayroll', () => {
    it('writes a PENDING transaction + allocation with a deterministic idempotency key', async () => {
        const tx = makeDb();
        tx.staffAdvance.findMany.mockResolvedValue([
            { id: 'adv1', advanceNumber: 'SA-000001', schedules: [sched('s1', 1, 2500, '2026-09-25')] },
        ]);
        tx.staffAdvanceTransaction.create.mockResolvedValue({ id: 'txn1' });

        const result = await postAdvanceRecoveryForPayroll(tx, 'actor1', 'emp1', 9, 2026, 'pay1');

        expect(tx.staffAdvanceTransaction.create).toHaveBeenCalledExactlyOnceWith({
            data: expect.objectContaining({
                advanceId: 'adv1', status: 'PENDING', amount: 2500, salaryPayRecordId: 'pay1',
                idempotencyKey: 'ADVREC-adv1-s1-pay1', createdById: 'actor1',
            }),
        });
        expect(tx.staffAdvanceRepaymentAllocation.create).toHaveBeenCalledExactlyOnceWith({
            data: { advanceId: 'adv1', transactionId: 'txn1', scheduleId: 's1', amount: 2500 },
        });
        expect(result).toEqual({ totalAmount: 2500, transactionIds: ['txn1'] });
    });

    it('posts nothing when no installment is due', async () => {
        const tx = makeDb();
        tx.staffAdvance.findMany.mockResolvedValue([]);
        const result = await postAdvanceRecoveryForPayroll(tx, 'actor1', 'emp1', 9, 2026, 'pay1');
        expect(tx.staffAdvanceTransaction.create).not.toHaveBeenCalled();
        expect(result.totalAmount).toBe(0);
    });
});

describe('markAdvanceRecoveryPosted', () => {
    const pending = [{ id: 'txn1', advanceId: 'adv1', amount: 2500, remarks: 'Payroll 9/2026 - installment #2', createdById: 'actor1' }];

    it('does nothing when the payroll record has no pending deductions', async () => {
        const tx = makeDb();
        tx.staffAdvanceTransaction.findMany.mockResolvedValue([]);
        await markAdvanceRecoveryPosted(tx, 'pay1');
        expect(tx.staffAdvanceTransaction.updateMany).not.toHaveBeenCalled();
    });

    it('completes the advance and records Repayment + Completion history once outstanding reaches zero', async () => {
        const tx = makeDb();
        tx.staffAdvanceTransaction.findMany.mockResolvedValue(pending);
        tx.staffAdvance.findUnique.mockResolvedValue({
            status: 'ACTIVE',
            schedules: [
                { amountDue: 2500, allocations: [{ amount: 2500 }] },
                { amountDue: 2500, allocations: [{ amount: 2500 }] },
            ],
        });

        await markAdvanceRecoveryPosted(tx, 'pay1');

        expect(tx.staffAdvanceTransaction.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'POSTED' }) }));
        const actions = tx.staffAdvanceDecision.create.mock.calls.map((c: any[]) => c[0].data.action);
        expect(actions).toEqual(['REPAYMENT', 'COMPLETE']);
        expect(tx.staffAdvance.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'adv1' },
            data: expect.objectContaining({ status: 'COMPLETED', completedAt: expect.any(Date) }),
        }));
    });

    it('keeps the advance ACTIVE while an installment is still outstanding', async () => {
        const tx = makeDb();
        tx.staffAdvanceTransaction.findMany.mockResolvedValue(pending);
        tx.staffAdvance.findUnique.mockResolvedValue({
            status: 'ACTIVE',
            schedules: [
                { amountDue: 2500, allocations: [{ amount: 2500 }] },
                { amountDue: 2500, allocations: [] },
            ],
        });

        await markAdvanceRecoveryPosted(tx, 'pay1');

        const actions = tx.staffAdvanceDecision.create.mock.calls.map((c: any[]) => c[0].data.action);
        expect(actions).toEqual(['REPAYMENT']);
        const data = tx.staffAdvance.update.mock.calls[0][0].data;
        expect(data.status).toBeUndefined();
        expect(data.completedAt).toBeUndefined();
    });

    it('does not touch an advance that is no longer ACTIVE', async () => {
        const tx = makeDb();
        tx.staffAdvanceTransaction.findMany.mockResolvedValue(pending);
        tx.staffAdvance.findUnique.mockResolvedValue({ status: 'COMPLETED', schedules: [] });
        await markAdvanceRecoveryPosted(tx, 'pay1');
        expect(tx.staffAdvance.update).not.toHaveBeenCalled();
        expect(tx.staffAdvanceDecision.create).not.toHaveBeenCalled();
    });
});
