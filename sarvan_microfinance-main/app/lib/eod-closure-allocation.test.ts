import { describe, expect, it } from 'vitest';
import {
  buildEodClosureMarker,
  pendingClosureAllocationLoanCondition,
  pendingClosureAllocationWhere,
  excludePendingClosureAllocationWhere,
} from './eod-closure-allocation';

describe('eod-closure-allocation', () => {
  describe('buildEodClosureMarker', () => {
    it('produces distinct markers for PRECLOSURE vs WRITEOFF', () => {
      const preclosure = buildEodClosureMarker('branch1', '2026-01-01', 'funder1', 'PRECLOSURE');
      const writeoff = buildEodClosureMarker('branch1', '2026-01-01', 'funder1', 'WRITEOFF');

      expect(preclosure).toBe('[POSTING:EOD_PRECLOSURE:branch1:2026-01-01:funder1]');
      expect(writeoff).toBe('[POSTING:EOD_WRITEOFF:branch1:2026-01-01:funder1]');
      expect(preclosure).not.toBe(writeoff);
    });

    it('is distinct from the existing EOD_COLLECTION / EOD_LOAN_ADVANCE marker prefixes', () => {
      const preclosure = buildEodClosureMarker('branch1', '2026-01-01', 'funder1', 'PRECLOSURE');
      const writeoff = buildEodClosureMarker('branch1', '2026-01-01', 'funder1', 'WRITEOFF');

      expect(preclosure.startsWith('[POSTING:EOD_COLLECTION:')).toBe(false);
      expect(preclosure.startsWith('[POSTING:EOD_LOAN_ADVANCE:')).toBe(false);
      expect(writeoff.startsWith('[POSTING:EOD_COLLECTION:')).toBe(false);
      expect(writeoff.startsWith('[POSTING:EOD_LOAN_ADVANCE:')).toBe(false);
    });

    it('carries no Gold/Normal split — a gold loan and a normal loan for the same funder share one bucket', () => {
      // Gold is a loan-type flag, not a separate funder (see gl-config.ts's buildFunderLabel).
      const marker = buildEodClosureMarker('branch1', '2026-01-01', 'funder1', 'PRECLOSURE');

      expect(marker).toBe('[POSTING:EOD_PRECLOSURE:branch1:2026-01-01:funder1]');
      expect(marker).not.toContain('GOLD');
      expect(marker).not.toContain('NORMAL');
    });
  });

  describe('pendingClosureAllocationWhere', () => {
    const dayStart = new Date('2026-01-01T00:00:00.000Z');
    const dayEnd = new Date('2026-01-02T00:00:00.000Z');

    it('scopes to approved, non-reversed, unallocated, un-synced rows of the given type', () => {
      const where = pendingClosureAllocationWhere('branch1', 'PRECLOSURE', dayStart, dayEnd, null);

      expect(where).toMatchObject({
        branchId: 'branch1',
        type: 'PRECLOSURE',
        status: 'APPROVED',
        isReversed: false,
        eodAllocatedAt: null,
        isGlSynced: false,
        transactionDate: { gte: dayStart, lt: dayEnd },
        loan: { funderId: null },
      });
    });

    it('does not filter on loan.isActive — the loan is already closed by the time a row is genuinely pending', () => {
      const where = pendingClosureAllocationWhere('branch1', 'WRITEOFF', dayStart, dayEnd, null);
      expect((where.loan as { isActive?: boolean })?.isActive).toBeUndefined();
    });

    it('does not coalesce PRECLOSURE and WRITEOFF into one filter', () => {
      const preclosureWhere = pendingClosureAllocationWhere('branch1', 'PRECLOSURE', dayStart, dayEnd, 'funder1');
      const writeoffWhere = pendingClosureAllocationWhere('branch1', 'WRITEOFF', dayStart, dayEnd, 'funder1');

      expect(preclosureWhere.type).toBe('PRECLOSURE');
      expect(writeoffWhere.type).toBe('WRITEOFF');
    });

    it('scopes to a specific funder when provided', () => {
      const where = pendingClosureAllocationWhere('branch1', 'WRITEOFF', dayStart, dayEnd, 'funder1');
      expect(where.loan).toEqual({ funderId: 'funder1' });
    });
  });

  describe('pendingClosureAllocationLoanCondition / excludePendingClosureAllocationWhere', () => {
    it('covers both PRECLOSURE and WRITEOFF in the raw condition', () => {
      const condition = pendingClosureAllocationLoanCondition();
      expect(condition).toEqual({
        transactions: {
          some: {
            type: { in: ['PRECLOSURE', 'WRITEOFF'] },
            status: 'APPROVED',
            isReversed: false,
            eodAllocatedAt: null,
          },
        },
      });
    });

    it('wraps the raw condition in NOT for the convenience helper', () => {
      const excluded = excludePendingClosureAllocationWhere();
      expect(excluded).toEqual({ NOT: pendingClosureAllocationLoanCondition() });
    });
  });
});
