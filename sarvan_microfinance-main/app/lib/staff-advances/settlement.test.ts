import { beforeEach, describe, expect, it, vi } from 'vitest';

const { db } = vi.hoisted(() => {
    const db: any = {
        staffAdvance: { findUnique: vi.fn(), updateMany: vi.fn() },
        staffAdvanceTransaction: { create: vi.fn() },
        staffAdvanceRepaymentAllocation: { createMany: vi.fn() },
        staffAdvanceDecision: { createMany: vi.fn() },
        $transaction: vi.fn(),
    };
    return { db };
});

vi.mock('@/app/lib/db', () => ({ prisma: db }));
vi.mock('@/app/lib/branch-lock', () => ({ getKolkataCalendarYmd: () => '2026-09-25' }));

import { advanceSettlementSchema, settleAdvance } from './settlement';

const actor = (over: Record<string, unknown> = {}) => ({
    userId: 'mgr1', isAdmin: false, isHR: false, branchIds: ['b1'], assignments: [], ...over,
}) as any;

const advance = (over: Record<string, unknown> = {}) => ({
    id: 'adv1', advanceNumber: 'SA-000001', employeeId: 'emp1', branchId: 'b1', status: 'ACTIVE', version: 3, amount: '10000',
    transactions: [],
    schedules: [
        { id: 's1', installmentNo: 1, amountDue: '5000', allocations: [{ amount: '5000' }] },
        { id: 's2', installmentNo: 2, amountDue: '5000', allocations: [] },
    ],
    ...over,
});

const input = { advanceId: 'adv1', paymentMode: 'CASH' as const, reference: null, remarks: null, expectedVersion: 3 };

beforeEach(() => {
    vi.clearAllMocks();
    db.$transaction.mockImplementation(async (cb: (tx: any) => unknown) => cb(db));
    db.staffAdvance.findUnique.mockResolvedValue(advance());
    db.staffAdvance.updateMany.mockResolvedValue({ count: 1 });
    db.staffAdvanceTransaction.create.mockResolvedValue({ id: 'tx1' });
});

describe('advanceSettlementSchema', () => {
    it('allows only Cash and Bank Transfer', () => {
        expect(advanceSettlementSchema.safeParse(input).success).toBe(true);
        expect(advanceSettlementSchema.safeParse({ ...input, paymentMode: 'CHEQUE' }).success).toBe(false);
        expect(advanceSettlementSchema.safeParse({ ...input, paymentMode: 'UPI' }).success).toBe(false);
    });

    it('requires a reference for a bank transfer', () => {
        expect(advanceSettlementSchema.safeParse({ ...input, paymentMode: 'BANK_TRANSFER' }).success).toBe(false);
        expect(advanceSettlementSchema.safeParse({ ...input, paymentMode: 'BANK_TRANSFER', reference: 'UTR1' }).success).toBe(true);
    });

    it('does not accept an amount or a date from the caller', () => {
        expect(advanceSettlementSchema.safeParse({ ...input, amount: 1 }).success).toBe(false);
        expect(advanceSettlementSchema.safeParse({ ...input, settlementDate: '2026-09-01' }).success).toBe(false);
    });
});

describe('settleAdvance', () => {
    it('settles the unpaid principal only (no interest), allocates it to the unpaid installment and completes the advance', async () => {
        const result = await settleAdvance(actor(), { ...input, paymentMode: 'BANK_TRANSFER', reference: 'UTR9', expectedAmount: 5000 });

        expect(result).toMatchObject({ advanceNumber: 'SA-000001', settlementAmount: 5000 });
        expect(db.staffAdvanceTransaction.create.mock.calls[0][0].data).toMatchObject({
            advanceId: 'adv1', status: 'POSTED', paymentMode: 'BANK_TRANSFER', reference: 'UTR9', createdById: 'mgr1', idempotencyKey: 'ADVSETTLE-adv1',
        });
        expect(Number(db.staffAdvanceTransaction.create.mock.calls[0][0].data.amount)).toBe(5000);
        const allocations = db.staffAdvanceRepaymentAllocation.createMany.mock.calls[0][0].data;
        expect(allocations).toHaveLength(1);
        expect(allocations[0]).toMatchObject({ scheduleId: 's2', transactionId: 'tx1' });
        expect(db.staffAdvance.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'adv1', version: 3, status: 'ACTIVE' }, data: expect.objectContaining({ status: 'COMPLETED' }),
        }));
        expect(db.staffAdvanceDecision.createMany.mock.calls[0][0].data.map((d: any) => d.action)).toEqual(['REPAYMENT', 'COMPLETE']);
    });

    it('refuses an advance that is not ACTIVE (no duplicate settlement)', async () => {
        db.staffAdvance.findUnique.mockResolvedValue(advance({ status: 'COMPLETED' }));
        await expect(settleAdvance(actor(), input)).rejects.toMatchObject({ status: 400 });
        expect(db.staffAdvanceTransaction.create).not.toHaveBeenCalled();
    });

    it('refuses a stale version', async () => {
        await expect(settleAdvance(actor(), { ...input, expectedVersion: 2 })).rejects.toMatchObject({ status: 409 });
    });

    it('refuses while a payroll deduction is pending (it would be collected twice)', async () => {
        db.staffAdvance.findUnique.mockResolvedValue(advance({ transactions: [{ id: 'pending1' }] }));
        await expect(settleAdvance(actor(), input)).rejects.toMatchObject({ status: 409 });
        expect(db.staffAdvanceTransaction.create).not.toHaveBeenCalled();
    });

    it('refuses when the quoted amount no longer matches the ledger', async () => {
        await expect(settleAdvance(actor(), { ...input, expectedAmount: 10000 })).rejects.toMatchObject({ status: 409 });
        expect(db.staffAdvanceTransaction.create).not.toHaveBeenCalled();
    });

    it('refuses an advance of another branch', async () => {
        await expect(settleAdvance(actor({ branchIds: ['b9'] }), input)).rejects.toMatchObject({ status: 403 });
    });

    it('refuses a fully repaid advance', async () => {
        db.staffAdvance.findUnique.mockResolvedValue(advance({
            schedules: [{ id: 's1', installmentNo: 1, amountDue: '5000', allocations: [{ amount: '5000' }] }],
        }));
        await expect(settleAdvance(actor(), input)).rejects.toMatchObject({ status: 400 });
    });

    it('turns a duplicate idempotency key into a "already settled" conflict', async () => {
        db.staffAdvanceTransaction.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));
        await expect(settleAdvance(actor(), input)).rejects.toMatchObject({ status: 409, message: expect.stringContaining('already been settled') });
    });
});
