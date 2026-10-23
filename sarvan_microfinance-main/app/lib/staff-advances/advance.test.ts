import { describe, expect, it } from 'vitest';
import {
    ADVANCE_REPAYMENT_MONTHS,
    advanceApplicationSchema,
    advanceCancelSchema,
    advanceEditSchema,
    advanceReviewSchema,
    formatStaffAdvanceNumber,
    projectInHand,
    splitAdvanceInstallments,
    ADVANCE_REPAYMENT_OPTIONS,
} from './advance';

describe('formatStaffAdvanceNumber', () => {
    it('pads to the SA-000001 style', () => {
        expect(formatStaffAdvanceNumber(1)).toBe('SA-000001');
        expect(formatStaffAdvanceNumber(BigInt(123456))).toBe('SA-123456');
    });
});

describe('splitAdvanceInstallments', () => {
    it('defaults to two installments, and offers one or two', () => {
        expect(ADVANCE_REPAYMENT_MONTHS).toBe(2);
        expect([...ADVANCE_REPAYMENT_OPTIONS]).toEqual([1, 2]);
    });

    it('a one-month advance is a single installment of the whole amount, a two-month one is split', () => {
        expect(splitAdvanceInstallments(10000, 1)).toEqual([10000]);
        expect(splitAdvanceInstallments(10000, 2)).toEqual([5000, 5000]);
        expect(splitAdvanceInstallments(10000.01, 1)).toEqual([10000.01]);
        expect(splitAdvanceInstallments(10000)).toEqual([5000, 5000]);
    });

    it('splits an even amount in half with no interest', () => {
        expect(splitAdvanceInstallments(10000)).toEqual([5000, 5000]);
    });

    it('distributes every paisa - installments add back to exactly the advance amount', () => {
        for (const amount of [1, 1.01, 999.99, 5001, 12345.67, 33333.33]) {
            const [a, b] = splitAdvanceInstallments(amount);
            expect(Math.round((a + b) * 100)).toBe(Math.round(amount * 100));
            expect(a).toBeGreaterThanOrEqual(b); // an odd paisa goes to the first installment
        }
    });
});

describe('projectInHand', () => {
    it('subtracts the first installment from the current in-hand salary', () => {
        expect(projectInHand(30000, 2500)).toEqual({ currentInHand: 30000, monthlyRepayment: 2500, projectedInHand: 27500 });
    });

    it('can go negative so the caller can block it', () => {
        expect(projectInHand(1000, 1500.5).projectedInHand).toBe(-500.5);
    });
});

describe('advanceApplicationSchema', () => {
    const valid = { amount: 5000, purpose: 'Medical', remarks: '', document: { fileKey: 'org/employee-e1/staff-advance/slip.jpg', fileName: 'slip.jpg' } };

    it('requires the supporting document, like a staff loan', () => {
        const { document: _omit, ...withoutDocument } = valid;
        expect(advanceApplicationSchema.safeParse(withoutDocument).success).toBe(false);
        expect(advanceApplicationSchema.safeParse({ ...valid, document: { fileKey: '', fileName: 'slip.jpg' } }).success).toBe(false);
    });

    it('accepts a valid application and an explicit 2 month period', () => {
        expect(advanceApplicationSchema.safeParse(valid).success).toBe(true);
        expect(advanceApplicationSchema.safeParse({ ...valid, repaymentMonths: 2 }).success).toBe(true);
    });

    it('accepts a one-month repayment and defaults to two months when none is sent', () => {
        expect(advanceApplicationSchema.safeParse({ ...valid, repaymentMonths: 1 }).success).toBe(true);
        expect(advanceApplicationSchema.parse(valid).repaymentMonths).toBeUndefined();
    });

    it('rejects any repayment period other than 1 or 2 months', () => {
        for (const months of [0, 3, 6, 12, -1, 1.5, '2' as unknown as number]) {
            expect(advanceApplicationSchema.safeParse({ ...valid, repaymentMonths: months }).success).toBe(false);
        }
    });

    it('rejects zero, negative, non-numeric and 3-decimal amounts', () => {
        for (const amount of [0, -100, 0.5, 100.123, Number.NaN, '5000' as unknown as number]) {
            expect(advanceApplicationSchema.safeParse({ ...valid, amount }).success).toBe(false);
        }
    });

    it('requires a reason', () => {
        expect(advanceApplicationSchema.safeParse({ ...valid, purpose: '   ' }).success).toBe(false);
    });

    it('does not let a caller smuggle in an interest rate or other fields', () => {
        expect(advanceApplicationSchema.safeParse({ ...valid, interestRate: 5 }).success).toBe(false);
        expect(advanceApplicationSchema.safeParse({ ...valid, status: 'ACTIVE' }).success).toBe(false);
    });
});

describe('advanceReviewSchema', () => {
    it('approves without remarks but requires a reason to reject', () => {
        expect(advanceReviewSchema.safeParse({ id: 'a1', expectedVersion: 1, action: 'APPROVE', remarks: '' }).success).toBe(true);
        expect(advanceReviewSchema.safeParse({ id: 'a1', expectedVersion: 1, action: 'REJECT', remarks: '' }).success).toBe(false);
        expect(advanceReviewSchema.safeParse({ id: 'a1', expectedVersion: 1, action: 'REJECT', remarks: 'Not eligible' }).success).toBe(true);
    });

    it('has no Return action', () => {
        expect(advanceReviewSchema.safeParse({ id: 'a1', expectedVersion: 1, action: 'RETURN', remarks: 'x' }).success).toBe(false);
    });
});

describe('advanceEditSchema / advanceCancelSchema', () => {
    it('does not allow the repayment period or interest to be edited', () => {
        const base = { expectedVersion: 1, amount: 4000, purpose: 'Rent', remarks: '', reason: 'Reduced' };
        expect(advanceEditSchema.safeParse(base).success).toBe(true);
        expect(advanceEditSchema.safeParse({ ...base, repaymentMonths: 3 }).success).toBe(false);
        expect(advanceEditSchema.safeParse({ ...base, interestRate: 2 }).success).toBe(false);
    });

    it('requires an expected version for optimistic locking', () => {
        expect(advanceCancelSchema.safeParse({ id: 'a1' }).success).toBe(false);
        expect(advanceCancelSchema.safeParse({ id: 'a1', expectedVersion: 2 }).success).toBe(true);
    });
});
