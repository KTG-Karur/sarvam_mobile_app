import { describe, it, expect } from 'vitest';
import { withdrawSavingsDescending } from './savings-revert';

describe('withdrawSavingsDescending', () => {
    it('undoes a single-schedule fill completely', () => {
        const schedules = [
            { id: 's1', installmentNo: 1, savingsPaid: 60 },
        ];
        const updates = withdrawSavingsDescending(schedules, 60);
        expect(updates).toEqual([{ id: 's1', newSavingsPaid: 0 }]);
    });

    it('unwinds a multi-schedule ascending fill in exact reverse (LIFO)', () => {
        // Txn A filled sched1=60, sched2=40 (amount 100).
        // Txn B (being reverted) then filled sched2 40->60 (+20), sched3 0->30 (+30) (amount 50).
        const schedulesAfterAAndB = [
            { id: 's1', installmentNo: 1, savingsPaid: 60 },
            { id: 's2', installmentNo: 2, savingsPaid: 60 },
            { id: 's3', installmentNo: 3, savingsPaid: 30 },
        ];
        const updates = withdrawSavingsDescending(schedulesAfterAAndB, 50);

        // Should remove exactly B's contribution: 30 from s3, 20 from s2, nothing from s1.
        expect(updates).toEqual([
            { id: 's3', newSavingsPaid: 0 },
            { id: 's2', newSavingsPaid: 40 },
        ]);
    });

    it('skips schedules with nothing paid and stops once the amount is exhausted', () => {
        const schedules = [
            { id: 's1', installmentNo: 1, savingsPaid: 60 },
            { id: 's2', installmentNo: 2, savingsPaid: 0 },
            { id: 's3', installmentNo: 3, savingsPaid: 20 },
        ];
        const updates = withdrawSavingsDescending(schedules, 20);
        expect(updates).toEqual([{ id: 's3', newSavingsPaid: 0 }]);
    });

    it('handles an amount larger than total paid by stopping at zero (defensive floor)', () => {
        const schedules = [
            { id: 's1', installmentNo: 1, savingsPaid: 10 },
        ];
        const updates = withdrawSavingsDescending(schedules, 50);
        expect(updates).toEqual([{ id: 's1', newSavingsPaid: 0 }]);
    });
});
