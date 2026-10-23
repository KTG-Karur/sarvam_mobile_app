import { describe, it, expect } from 'vitest';
import { applyPendingToSchedule } from './effective-schedule';

describe('applyPendingToSchedule', () => {
  const schedule = {
    principalPaid: 100,
    interestPaid: 20,
    feesPaid: 5,
    penaltiesPaid: 1,
  };

  it('returns the schedule unchanged when there is no pending amount', () => {
    const result = applyPendingToSchedule(schedule);
    expect(result).toEqual(schedule);
  });

  it('bumps each *Paid field by the matching pending component', () => {
    const result = applyPendingToSchedule(schedule, {
      principal: 50,
      interest: 10,
      fees: 2,
      penalty: 1,
      total: 63,
    });
    expect(result).toEqual({
      principalPaid: 150,
      interestPaid: 30,
      feesPaid: 7,
      penaltiesPaid: 2,
    });
  });

  it('never mutates the input schedule', () => {
    const original = { ...schedule };
    applyPendingToSchedule(schedule, { principal: 50, interest: 0, fees: 0, penalty: 0, total: 50 });
    expect(schedule).toEqual(original);
  });

  it('preserves extra fields on the input object', () => {
    const withExtra = { ...schedule, id: 'sched-1', dueDate: new Date('2026-01-01') };
    const result = applyPendingToSchedule(withExtra, { principal: 10, interest: 0, fees: 0, penalty: 0, total: 10 });
    expect(result.id).toBe('sched-1');
    expect(result.dueDate).toEqual(new Date('2026-01-01'));
    expect(result.principalPaid).toBe(110);
  });
});
