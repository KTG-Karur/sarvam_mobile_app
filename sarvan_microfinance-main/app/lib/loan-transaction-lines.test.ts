import { describe, expect, it } from 'vitest';
import {
    allocateTransactionLines,
    allocateTransactionLinesFromComponentBudgets,
    transactionDateIsBeforeDueDate,
} from './loan-transaction-lines';

const schedules = [
    {
        id: 's1',
        installmentNo: 1,
        dueDate: new Date('2026-04-10T00:00:00.000Z'),
        principalDue: 80,
        interestDue: 20,
        feesDue: 5,
        penaltiesDue: 0,
        principalPaid: 0,
        interestPaid: 0,
        feesPaid: 0,
        penaltiesPaid: 0,
    },
    {
        id: 's2',
        installmentNo: 2,
        dueDate: new Date('2026-04-17T00:00:00.000Z'),
        principalDue: 90,
        interestDue: 10,
        feesDue: 0,
        penaltiesDue: 0,
        principalPaid: 0,
        interestPaid: 0,
        feesPaid: 0,
        penaltiesPaid: 0,
    },
];

describe('allocateTransactionLines', () => {
    it('allocates partial default payments within the earliest schedule first', () => {
        const result = allocateTransactionLines(schedules, 50, 'default');

        expect(result.summary).toEqual({
            principalAmount: 25,
            interestAmount: 20,
            feesAmount: 5,
            penaltyAmount: 0,
            lineTotal: 50,
        });
        expect(result.lines).toHaveLength(1);
        expect(result.lines[0].scheduleId).toBe('s1');
    });

    it('spreads full payments across multiple schedules', () => {
        const result = allocateTransactionLines(schedules, 115, 'default');

        expect(result.lines).toHaveLength(2);
        expect(result.lines[0].scheduleId).toBe('s1');
        expect(result.lines[0].lineTotal).toBe(105);
        expect(result.lines[1].scheduleId).toBe('s2');
        expect(result.lines[1].lineTotal).toBe(10);
        expect(result.summary.principalAmount).toBe(80);
        expect(result.summary.interestAmount).toBe(30);
        expect(result.summary.feesAmount).toBe(5);
    });

    it('respects principal-only allocations', () => {
        const result = allocateTransactionLines(schedules, 60, 'principal');

        expect(result.lines).toHaveLength(1);
        expect(result.summary).toEqual({
            principalAmount: 60,
            interestAmount: 0,
            feesAmount: 0,
            penaltyAmount: 0,
            lineTotal: 60,
        });
    });
});

describe('allocateTransactionLinesFromComponentBudgets', () => {
    it('rebuilds lines from stored header components', () => {
        const result = allocateTransactionLinesFromComponentBudgets(schedules, {
            principalAmount: 80,
            interestAmount: 20,
            feesAmount: 5,
            penaltyAmount: 0,
        });

        expect(result.lines).toHaveLength(1);
        expect(result.lines[0]).toMatchObject({
            scheduleId: 's1',
            principalAmount: 80,
            interestAmount: 20,
            feesAmount: 5,
            penaltyAmount: 0,
            lineTotal: 105,
        });
    });
});

describe('transactionDateIsBeforeDueDate', () => {
    it('treats only strictly earlier dates as advance', () => {
        expect(
            transactionDateIsBeforeDueDate(
                new Date('2026-04-09T23:59:59.000Z'),
                new Date('2026-04-10T00:00:00.000Z')
            )
        ).toBe(true);

        expect(
            transactionDateIsBeforeDueDate(
                new Date('2026-04-10T00:00:00.000Z'),
                new Date('2026-04-10T12:00:00.000Z')
            )
        ).toBe(false);
    });
});
