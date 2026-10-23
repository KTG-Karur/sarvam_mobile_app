import { describe, it, expect } from 'vitest';
import {
  netScheduleComponents,
  applySavingsBudget,
  netCurrentDemand,
  resolveDemandSheetEffectiveCutoffYmd,
  NON_OUTSTANDING_SCHEDULE_STATUSES,
} from './demand-calculation';

describe('netScheduleComponents', () => {
  const base = {
    principalDue: 800,
    principalPaid: 0,
    interestDue: 200,
    interestPaid: 0,
    feesDue: 50,
    feesPaid: 0,
    penaltiesDue: 20,
    penaltiesPaid: 0,
    pendingPrincipal: 0,
    pendingInterest: 0,
    pendingFees: 0,
    pendingPenalty: 0,
  };

  it('returns gross remaining when nothing is pending today', () => {
    const result = netScheduleComponents(base);
    expect(result).toEqual({
      netPrincipal: 800,
      netInterest: 200,
      netFees: 50,
      netPenalties: 20,
    });
  });

  it('nets a partial same-day pending collection', () => {
    const result = netScheduleComponents({
      ...base,
      pendingInterest: 200,
      pendingPrincipal: 400,
    });
    expect(result.netInterest).toBe(0);
    expect(result.netPrincipal).toBe(400);
  });

  it('clamps to zero when pending fully covers gross (never goes negative)', () => {
    const result = netScheduleComponents({
      ...base,
      pendingPrincipal: 800,
      pendingInterest: 200,
      pendingFees: 50,
      pendingPenalty: 20,
    });
    expect(result).toEqual({ netPrincipal: 0, netInterest: 0, netFees: 0, netPenalties: 0 });
  });

  it('clamps to zero when pending exceeds gross remaining', () => {
    const result = netScheduleComponents({
      ...base,
      pendingPrincipal: 10000,
    });
    expect(result.netPrincipal).toBe(0);
  });

  it('accounts for historically-approved payments via *Paid before netting today-pending', () => {
    const result = netScheduleComponents({
      ...base,
      principalPaid: 300,
      pendingPrincipal: 200,
    });
    // gross remaining = 800 - 300 = 500; net = 500 - 200 = 300
    expect(result.netPrincipal).toBe(300);
  });
});

describe('applySavingsBudget', () => {
  it('leaves schedules untouched when budget is zero', () => {
    const result = applySavingsBudget(
      [
        { scheduleId: 's1', savingsDue: 100, savingsPaid: 0, isOverdue: true },
        { scheduleId: 's2', savingsDue: 100, savingsPaid: 0, isOverdue: false },
      ],
      0,
    );
    expect(result.schedules).toEqual([
      { scheduleId: 's1', netSavingsArrear: 100, netSavingsCurrent: 0 },
      { scheduleId: 's2', netSavingsArrear: 0, netSavingsCurrent: 100 },
    ]);
    expect(result.remainingBudget).toBe(0);
  });

  it('applies budget across an overdue then a current schedule in ascending dueDate order', () => {
    const result = applySavingsBudget(
      [
        { scheduleId: 's1', savingsDue: 100, savingsPaid: 0, isOverdue: true },
        { scheduleId: 's2', savingsDue: 100, savingsPaid: 0, isOverdue: false },
      ],
      150,
    );
    expect(result.schedules).toEqual([
      { scheduleId: 's1', netSavingsArrear: 0, netSavingsCurrent: 0 },
      { scheduleId: 's2', netSavingsArrear: 0, netSavingsCurrent: 50 },
    ]);
    expect(result.remainingBudget).toBe(0);
  });

  it('reports leftover budget when it exceeds total savings due', () => {
    const result = applySavingsBudget(
      [{ scheduleId: 's1', savingsDue: 100, savingsPaid: 0, isOverdue: false }],
      250,
    );
    expect(result.schedules).toEqual([{ scheduleId: 's1', netSavingsArrear: 0, netSavingsCurrent: 0 }]);
    expect(result.remainingBudget).toBe(150);
  });

  it('respects already-approved savingsPaid before applying today\'s budget', () => {
    const result = applySavingsBudget(
      [{ scheduleId: 's1', savingsDue: 100, savingsPaid: 60, isOverdue: false }],
      30,
    );
    // gross = 100 - 60 = 40; net = 40 - 30 = 10
    expect(result.schedules).toEqual([{ scheduleId: 's1', netSavingsArrear: 0, netSavingsCurrent: 10 }]);
    expect(result.remainingBudget).toBe(0);
  });
});

describe('NON_OUTSTANDING_SCHEDULE_STATUSES', () => {
  it('excludes only the truly final statuses, never PAID', () => {
    // Every collection route's schedule query filters on this list (as
    // `status: { notIn: NON_OUTSTANDING_SCHEDULE_STATUSES }`) instead of an
    // include-list of PENDING/OVERDUE/PARTIALLY_PAID — a schedule's `status`
    // column can drift out of sync with its real due-vs-paid amounts (e.g. a
    // reversal recomputing status against a stale totalDue), so excluding PAID
    // at the query level would silently drop a mismarked row's genuine
    // outstanding balance from every arrear/demand total.
    expect(NON_OUTSTANDING_SCHEDULE_STATUSES).toEqual(['WAIVED', 'CLOSED']);
    expect(NON_OUTSTANDING_SCHEDULE_STATUSES).not.toContain('PAID');
  });
});

describe('netScheduleComponents — arrear scenarios across installments', () => {
  // Mirrors how demand/route.ts, arrear/route.ts, and single-collection/route.ts
  // aggregate arrear across every previous unpaid/partially-paid installment: sum
  // netScheduleComponents(...) per schedule, in ascending dueDate order.
  const zeroPending = { pendingPrincipal: 0, pendingInterest: 0, pendingFees: 0, pendingPenalty: 0 };

  it('sums full arrears across multiple wholly-unpaid installments', () => {
    const installments = [
      { principalDue: 440, principalPaid: 0, interestDue: 80, interestPaid: 0 },
      { principalDue: 440, principalPaid: 0, interestDue: 80, interestPaid: 0 },
      { principalDue: 440, principalPaid: 0, interestDue: 80, interestPaid: 0 },
    ];
    const totals = installments
      .map((s) => netScheduleComponents({ ...s, feesDue: 0, feesPaid: 0, penaltiesDue: 0, penaltiesPaid: 0, ...zeroPending }))
      .reduce((acc, n) => ({ principal: acc.principal + n.netPrincipal, interest: acc.interest + n.netInterest }), { principal: 0, interest: 0 });

    expect(totals.principal).toBe(1320);
    expect(totals.interest).toBe(240);
  });

  it('nets out a partial payment on one of several missed installments (the reported bug case)', () => {
    // installment 41: principal partially paid (80 of 440), interest fully paid.
    // installment 42 & 43: wholly unpaid. Expected arrear = 360 + 440 + 440 = 1240
    // principal, 0 + 80 + 80 = 160 interest → total 1400, matching the reported
    // "PUSPHARANI ANTON CRISTY / LN26000055" case (₹1,040 shown, ₹1,400 correct).
    const installments = [
      { principalDue: 440, principalPaid: 80, interestDue: 80, interestPaid: 80 },
      { principalDue: 440, principalPaid: 0, interestDue: 80, interestPaid: 0 },
      { principalDue: 440, principalPaid: 0, interestDue: 80, interestPaid: 0 },
    ];
    const totals = installments
      .map((s) => netScheduleComponents({ ...s, feesDue: 0, feesPaid: 0, penaltiesDue: 0, penaltiesPaid: 0, ...zeroPending }))
      .reduce((acc, n) => ({ principal: acc.principal + n.netPrincipal, interest: acc.interest + n.netInterest }), { principal: 0, interest: 0 });

    expect(totals.principal).toBe(1240);
    expect(totals.interest).toBe(160);
    expect(totals.principal + totals.interest).toBe(1400);
  });

  it('handles a principal-only payment (interest still fully outstanding)', () => {
    const result = netScheduleComponents({
      principalDue: 440, principalPaid: 440,
      interestDue: 80, interestPaid: 0,
      feesDue: 0, feesPaid: 0, penaltiesDue: 0, penaltiesPaid: 0,
      ...zeroPending,
    });
    expect(result.netPrincipal).toBe(0);
    expect(result.netInterest).toBe(80);
  });

  it('handles an interest-only payment (principal still fully outstanding)', () => {
    const result = netScheduleComponents({
      principalDue: 440, principalPaid: 0,
      interestDue: 80, interestPaid: 80,
      feesDue: 0, feesPaid: 0, penaltiesDue: 0, penaltiesPaid: 0,
      ...zeroPending,
    });
    expect(result.netPrincipal).toBe(440);
    expect(result.netInterest).toBe(0);
  });

  it('handles a mixed partial principal + partial interest payment', () => {
    const result = netScheduleComponents({
      principalDue: 440, principalPaid: 200,
      interestDue: 80, interestPaid: 30,
      feesDue: 0, feesPaid: 0, penaltiesDue: 0, penaltiesPaid: 0,
      ...zeroPending,
    });
    expect(result.netPrincipal).toBe(240);
    expect(result.netInterest).toBe(50);
  });

  it('never counts an already fully-paid installment again', () => {
    const result = netScheduleComponents({
      principalDue: 440, principalPaid: 440,
      interestDue: 80, interestPaid: 80,
      feesDue: 0, feesPaid: 0, penaltiesDue: 0, penaltiesPaid: 0,
      ...zeroPending,
    });
    expect(result.netPrincipal).toBe(0);
    expect(result.netInterest).toBe(0);
  });
});

describe('resolveDemandSheetEffectiveCutoffYmd', () => {
  it('bumps the cutoff forward when viewing today and EOD has already advanced the branch past it', () => {
    const result = resolveDemandSheetEffectiveCutoffYmd('2026-08-26', '2026-08-26', '2026-08-27');
    expect(result).toBe('2026-08-27');
  });

  it('leaves the cutoff unchanged when viewing today and EOD has not run yet', () => {
    const result = resolveDemandSheetEffectiveCutoffYmd('2026-08-26', '2026-08-26', '2026-08-26');
    expect(result).toBe('2026-08-26');
  });

  it('leaves the cutoff unchanged for a past dateStr regardless of the branch working date', () => {
    const result = resolveDemandSheetEffectiveCutoffYmd('2026-08-01', '2026-08-26', '2026-08-26');
    expect(result).toBe('2026-08-01');
  });

  it('leaves the cutoff unchanged for a future dateStr', () => {
    const result = resolveDemandSheetEffectiveCutoffYmd('2026-09-01', '2026-08-26', '2026-08-26');
    expect(result).toBe('2026-09-01');
  });

  it('falls back to dateStr when the branch has no working-date resolution (e.g. no BranchLock row yet)', () => {
    const result = resolveDemandSheetEffectiveCutoffYmd('2026-08-26', '2026-08-26', null);
    expect(result).toBe('2026-08-26');
  });
});

describe('netCurrentDemand', () => {
  const due = { principalDue: 800, interestDue: 200 };
  it('keeps the full installment when nothing was paid ahead', () => {
    expect(netCurrentDemand(due, { principal: 0, interest: 0 })).toEqual({ principal: 800, interest: 200 });
  });
  it('reduces by a partial advance', () => {
    expect(netCurrentDemand(due, { principal: 300, interest: 200 })).toEqual({ principal: 500, interest: 0 });
  });
  it('is zero when fully paid ahead and never negative', () => {
    expect(netCurrentDemand(due, { principal: 900, interest: 250 })).toEqual({ principal: 0, interest: 0 });
  });
});
