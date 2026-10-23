import { describe, expect, it } from 'vitest';
import { computeScheduleRepair, statusFromAmounts, type ScheduleForRepair } from './paid-ledger-repair';

const paidAt = new Date('2026-09-21T18:30:00.000Z');
const base: ScheduleForRepair = {
  principalDue: 700, interestDue: 50, feesDue: 0, penaltiesDue: 0,
  principalPaid: 700, interestPaid: 50, feesPaid: 0, penaltiesPaid: 0, paidAt,
};

describe('computeScheduleRepair', () => {
  it('loan 50109 installment 54: doubled 1400/100 vs ledger 700/50 is brought back, stays PAID', () => {
    const r = computeScheduleRepair(
      { ...base, principalPaid: 1400, interestPaid: 100 },
      { principal: 700, interest: 50, fees: 0, penalty: 0 }
    );
    expect(r).not.toBeNull();
    expect(r!.principalPaid).toBe(700);
    expect(r!.interestPaid).toBe(50);
    expect(r!.totalPaid).toBe(750);
    expect(r!.status).toBe('PAID');
    expect(r!.paidAt).toBe(paidAt);
    expect(r!.removed).toEqual({ principal: 700, interest: 50, fees: 0, penalty: 0 });
  });

  it('returns null when the schedule already matches the ledger', () => {
    expect(computeScheduleRepair(base, { principal: 700, interest: 50, fees: 0, penalty: 0 })).toBeNull();
  });

  it('never raises a component: paid below the ledger (or no ledger) is left alone', () => {
    expect(computeScheduleRepair({ ...base, principalPaid: 300, interestPaid: 0 }, { principal: 700, interest: 50, fees: 0, penalty: 0 })).toBeNull();
  });

  it('only the over component is lowered; status drops to PARTIALLY_PAID when no longer fully paid', () => {
    const r = computeScheduleRepair(
      { ...base, principalPaid: 700, interestPaid: 100 },
      { principal: 700, interest: 20, fees: 0, penalty: 0 }
    );
    expect(r!.principalPaid).toBe(700);
    expect(r!.interestPaid).toBe(20);
    expect(r!.status).toBe('PARTIALLY_PAID');
    expect(r!.paidAt).toBeNull();
    expect(r!.removed.interest).toBe(80);
  });

  it('goes back to PENDING when the ledger recorded nothing', () => {
    const r = computeScheduleRepair(base, { principal: 0, interest: 0, fees: 0, penalty: 0 });
    expect(r!.status).toBe('PENDING');
    expect(r!.totalPaid).toBe(0);
  });
});

describe('statusFromAmounts', () => {
  it('matches the approve route rule', () => {
    expect(statusFromAmounts(750, 750)).toBe('PAID');
    expect(statusFromAmounts(100, 750)).toBe('PARTIALLY_PAID');
    expect(statusFromAmounts(0, 750)).toBe('PENDING');
  });
});
