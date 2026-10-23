import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { allocateAcrossSchedules, totalOutstanding, type AllocatableSchedule } from './allocation';

function makeTx() {
    return { staffLoanRepaymentAllocation: { create: vi.fn() } } as any;
}

describe('allocateAcrossSchedules', () => {
    it('allocates interest-first then principal within a single schedule row', async () => {
        const tx = makeTx();
        const schedules: AllocatableSchedule[] = [
            { id: 's1', principalDue: 1000, interestDue: 100, allocations: [] },
        ];
        await allocateAcrossSchedules(tx, 'loan1', schedules, 'txn1', new Prisma.Decimal(150));
        expect(tx.staffLoanRepaymentAllocation.create).toHaveBeenCalledExactlyOnceWith({
            data: { loanId: 'loan1', transactionId: 'txn1', scheduleId: 's1', principal: expect.any(Prisma.Decimal), interest: expect.any(Prisma.Decimal) },
        });
        const call = tx.staffLoanRepaymentAllocation.create.mock.calls[0][0].data;
        expect(call.interest.toNumber()).toBe(100);
        expect(call.principal.toNumber()).toBe(50);
    });

    it('walks oldest-installment-first and stops once the amount is exhausted', async () => {
        const tx = makeTx();
        const schedules: AllocatableSchedule[] = [
            { id: 's1', principalDue: 500, interestDue: 50, allocations: [] },
            { id: 's2', principalDue: 500, interestDue: 50, allocations: [] },
            { id: 's3', principalDue: 500, interestDue: 50, allocations: [] },
        ];
        // Enough to fully pay s1 (550) and partially pay s2 (interest only, 50), nothing for s3.
        await allocateAcrossSchedules(tx, 'loan1', schedules, 'txn1', new Prisma.Decimal(600));
        expect(tx.staffLoanRepaymentAllocation.create).toHaveBeenCalledTimes(2);
        const [first, second] = tx.staffLoanRepaymentAllocation.create.mock.calls.map((c: any) => c[0].data);
        expect(first.scheduleId).toBe('s1');
        expect(first.principal.toNumber()).toBe(500);
        expect(first.interest.toNumber()).toBe(50);
        expect(second.scheduleId).toBe('s2');
        expect(second.principal.toNumber()).toBe(0);
        expect(second.interest.toNumber()).toBe(50);
    });

    it('skips schedules already fully paid and does not write a zero allocation', async () => {
        const tx = makeTx();
        const schedules: AllocatableSchedule[] = [
            { id: 's1', principalDue: 500, interestDue: 50, allocations: [{ principal: 500, interest: 50 }] },
            { id: 's2', principalDue: 300, interestDue: 0, allocations: [] },
        ];
        await allocateAcrossSchedules(tx, 'loan1', schedules, 'txn1', new Prisma.Decimal(300));
        expect(tx.staffLoanRepaymentAllocation.create).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ data: expect.objectContaining({ scheduleId: 's2' }) })
        );
    });

    it('writes nothing when the amount is zero', async () => {
        const tx = makeTx();
        const schedules: AllocatableSchedule[] = [{ id: 's1', principalDue: 500, interestDue: 50, allocations: [] }];
        await allocateAcrossSchedules(tx, 'loan1', schedules, 'txn1', new Prisma.Decimal(0));
        expect(tx.staffLoanRepaymentAllocation.create).not.toHaveBeenCalled();
    });
});

describe('totalOutstanding', () => {
    it('sums remaining principal/interest across schedules net of POSTED allocations', () => {
        const schedules: AllocatableSchedule[] = [
            { id: 's1', principalDue: 500, interestDue: 50, allocations: [{ principal: 200, interest: 50 }] },
            { id: 's2', principalDue: 500, interestDue: 50, allocations: [] },
        ];
        const result = totalOutstanding(schedules);
        expect(result.principal.toNumber()).toBe(800);
        expect(result.interest.toNumber()).toBe(50);
        expect(result.total.toNumber()).toBe(850);
    });

    it('never goes negative for an over-allocated schedule row', () => {
        const schedules: AllocatableSchedule[] = [
            { id: 's1', principalDue: 500, interestDue: 50, allocations: [{ principal: 600, interest: 60 }] },
        ];
        const result = totalOutstanding(schedules);
        expect(result.principal.toNumber()).toBe(0);
        expect(result.interest.toNumber()).toBe(0);
    });
});

describe('waived interest (early settlement)', () => {
    const waived = { id: 's1', principalDue: 1000, interestDue: 100, interestWaived: 100, allocations: [{ principal: 1000, interest: 0 }] };

    it('is not outstanding: a fully settled installment with waived interest owes nothing', () => {
        const out = totalOutstanding([waived]);
        expect(out.interest.toNumber()).toBe(0);
        expect(out.total.toNumber()).toBe(0);
    });

    it('only the un-waived part of the interest stays outstanding', () => {
        const out = totalOutstanding([{ ...waived, interestWaived: 40 }]);
        expect(out.interest.toNumber()).toBe(60);
    });

    it('is the same as before when nothing was waived', () => {
        expect(totalOutstanding([{ ...waived, interestWaived: 0 }]).interest.toNumber()).toBe(100);
        expect(totalOutstanding([{ id: 's2', principalDue: 1000, interestDue: 100, allocations: [] }]).total.toNumber()).toBe(1100);
    });
});
