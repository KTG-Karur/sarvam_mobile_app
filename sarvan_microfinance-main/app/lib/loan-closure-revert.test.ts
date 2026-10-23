import { describe, it, expect } from 'vitest';
import { recomputeScheduleStatus } from './loan-closure-revert';

describe('recomputeScheduleStatus', () => {
    it('returns PENDING when nothing has been paid', () => {
        expect(recomputeScheduleStatus(0, 500)).toBe('PENDING');
    });

    it('returns PENDING for a negative/zero-clamped paid amount', () => {
        expect(recomputeScheduleStatus(-10, 500)).toBe('PENDING');
    });

    it('returns PARTIALLY_PAID when paid is less than due', () => {
        expect(recomputeScheduleStatus(250, 500)).toBe('PARTIALLY_PAID');
    });

    it('returns PAID when paid equals due', () => {
        expect(recomputeScheduleStatus(500, 500)).toBe('PAID');
    });

    it('returns PAID when paid exceeds due', () => {
        expect(recomputeScheduleStatus(600, 500)).toBe('PAID');
    });
});
