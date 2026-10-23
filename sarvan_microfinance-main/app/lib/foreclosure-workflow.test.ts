import { describe, expect, it } from 'vitest';
import type { Prisma } from '@prisma/client';
import {
  computeOutstandingForForeclosure,
  computeOutstandingTotalsForApproval,
  finalizeClosureCoveredLoan,
  unwindForeclosureFinalization,
} from './foreclosure-workflow';

type FakeSchedule = {
  id: string;
  installmentNo: number;
  principalDue: number;
  principalPaid: number;
  interestDue: number;
  interestPaid: number;
  penaltiesDue: number;
  penaltiesPaid: number;
  feesDue: number;
  feesPaid: number;
  totalDue: number;
  totalPaid: number;
  status: string;
  paidAt: Date | null;
};

type FakeLoan = {
  id: string;
  amount: number;
  principalPaid: number;
  interestPaid: number;
  penaltiesPaid: number;
  isActive: boolean;
  disbursementStatus: string;
  closureReason: string | null;
  closedDate: Date | null;
  lastPaymentDate: Date | null;
  isDead: boolean;
  deathMarkedDate: Date | null;
};

function applyUpdate(target: Record<string, unknown>, data: Record<string, unknown>) {
  for (const [key, val] of Object.entries(data)) {
    if (val && typeof val === 'object' && 'increment' in (val as Record<string, unknown>)) {
      target[key] = Number(target[key] ?? 0) + Number((val as { increment: number }).increment);
    } else if (val && typeof val === 'object' && 'decrement' in (val as Record<string, unknown>)) {
      target[key] = Number(target[key] ?? 0) - Number((val as { decrement: number }).decrement);
    } else {
      target[key] = val;
    }
  }
}

// Minimal in-memory mock of the handful of Prisma delegates finalizeClosureCoveredLoan /
// unwindForeclosureFinalization actually call — not a full Prisma client.
function createFakeTx(loan: FakeLoan, schedules: FakeSchedule[], closureRecord: { reason: string; penaltyPaid: number; isReversed: boolean }) {
  const state = { loan, schedules, closureRecord };

  const tx = {
    loanClosureRecord: {
      findFirst: async () => (state.closureRecord.isReversed ? null : state.closureRecord),
    },
    loan: {
      findUnique: async (args: { include?: { schedules?: { where?: { status?: { not?: string } }; orderBy?: { installmentNo?: 'asc' | 'desc' } } } }) => {
        const notStatus = args.include?.schedules?.where?.status?.not;
        let scheds = notStatus ? state.schedules.filter((s) => s.status !== notStatus) : [...state.schedules];
        const order = args.include?.schedules?.orderBy?.installmentNo;
        if (order) scheds = scheds.sort((a, b) => (order === 'desc' ? b.installmentNo - a.installmentNo : a.installmentNo - b.installmentNo));
        return { ...state.loan, schedules: scheds };
      },
      update: async (args: { data: Record<string, unknown> }) => {
        applyUpdate(state.loan as unknown as Record<string, unknown>, args.data);
        return state.loan;
      },
    },
    loanSchedule: {
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        const sched = state.schedules.find((s) => s.id === args.where.id);
        if (sched) applyUpdate(sched as unknown as Record<string, unknown>, args.data);
        return sched;
      },
      updateMany: async (args: { where: { status: { in: string[] } }; data: Record<string, unknown> }) => {
        for (const s of state.schedules) {
          if (args.where.status.in.includes(s.status)) applyUpdate(s as unknown as Record<string, unknown>, args.data);
        }
      },
    },
    loanTransaction: {
      findFirst: async () => null,
    },
  };

  return { tx: tx as unknown as Prisma.TransactionClient, state };
}

function makeSchedule(overrides: Partial<FakeSchedule> & { id: string; installmentNo: number; principalDue: number; interestDue: number }): FakeSchedule {
  return {
    principalPaid: 0,
    interestPaid: 0,
    penaltiesDue: 0,
    penaltiesPaid: 0,
    feesDue: 0,
    feesPaid: 0,
    totalPaid: 0,
    status: 'PENDING',
    paidAt: null,
    totalDue: overrides.principalDue + overrides.interestDue,
    ...overrides,
  };
}

describe('foreclosure-workflow', () => {
  it('computes foreclosure outstanding totals from schedules', () => {
    const result = computeOutstandingForForeclosure({
      loanAmount: 10000,
      principalPaid: 2000,
      schedules: [
        {
          status: 'PAID',
          principalDue: 1000,
          principalPaid: 1000,
          interestDue: 100,
          interestPaid: 100,
          penaltiesDue: 0,
          penaltiesPaid: 0,
          dueDate: new Date('2026-01-01T00:00:00.000Z'),
        },
        {
          status: 'PENDING',
          principalDue: 1500,
          principalPaid: 500,
          interestDue: 200,
          interestPaid: 50,
          penaltiesDue: 10,
          penaltiesPaid: 2,
          dueDate: new Date('2026-02-01T00:00:00.000Z'),
        },
      ],
    });

    expect(result.osPrincipal).toBe(8000);
    expect(result.osInterest).toBe(150);
    expect(result.osPenalties).toBe(8);
    expect(result.totalOutstanding).toBe(8158);
    expect(result.principalPayment).toBe(8000);
    expect(result.interestPayment).toBe(150);
    expect(result.penaltyPayment).toBe(8);
  });

  it('still counts a genuine remaining balance on a schedule mismarked PAID (regression)', () => {
    // Mirrors a real production case: a reversal recomputed a schedule's status
    // against a stale `totalDue` and flipped it to PAID even though it still
    // carries real outstanding principal/interest. The status label must not
    // be trusted over the actual due-vs-paid amounts.
    const result = computeOutstandingForForeclosure({
      loanAmount: 30000,
      principalPaid: 26680,
      schedules: [
        {
          status: 'PAID', // mismarked — still owes 360 principal
          principalDue: 440,
          principalPaid: 80,
          interestDue: 80,
          interestPaid: 80,
          penaltiesDue: 0,
          penaltiesPaid: 0,
          dueDate: new Date('2026-08-04T00:00:00.000Z'),
        },
        {
          status: 'PENDING',
          principalDue: 440,
          principalPaid: 0,
          interestDue: 80,
          interestPaid: 0,
          penaltiesDue: 0,
          penaltiesPaid: 0,
          dueDate: new Date('2026-08-18T00:00:00.000Z'),
        },
      ],
    });

    expect(result.arrearPrincipal).toBe(360 + 440);
    expect(result.arrearInterest).toBe(0 + 80);
  });

  it('does not double-count a genuinely-settled PAID schedule', () => {
    const result = computeOutstandingForForeclosure({
      loanAmount: 1000,
      principalPaid: 500,
      schedules: [
        {
          status: 'PAID',
          principalDue: 500,
          principalPaid: 500,
          interestDue: 50,
          interestPaid: 50,
          penaltiesDue: 0,
          penaltiesPaid: 0,
          dueDate: new Date('2020-01-01T00:00:00.000Z'),
        },
      ],
    });

    expect(result.arrearPrincipal).toBe(0);
    expect(result.arrearInterest).toBe(0);
    expect(result.osInterest).toBe(0);
  });

  it('computes approval totals without dates', () => {
    const result = computeOutstandingTotalsForApproval({
      loanAmount: 5000,
      principalPaid: 1000,
      schedules: [
        {
          status: 'PENDING',
          principalDue: 1000,
          principalPaid: 250,
          interestDue: 120,
          interestPaid: 20,
          penaltiesDue: 10,
          penaltiesPaid: 0,
        },
        {
          status: 'PAID',
          principalDue: 1000,
          principalPaid: 1000,
          interestDue: 100,
          interestPaid: 100,
          penaltiesDue: 0,
          penaltiesPaid: 0,
        },
      ],
    });

    expect(result.osPrincipal).toBe(4000);
    expect(result.osInterest).toBe(100);
    expect(result.osPenalties).toBe(10);
    expect(result.total).toBe(4110);
  });
});

describe('finalizeClosureCoveredLoan', () => {
  const transactionDate = new Date('2026-03-01T00:00:00.000Z');

  function makeDeadLoan() {
    const loan: FakeLoan = {
      id: 'loan-1',
      amount: 10000,
      principalPaid: 2000,
      interestPaid: 0,
      penaltiesPaid: 0,
      isActive: true,
      disbursementStatus: 'DISBURSED',
      closureReason: null,
      closedDate: null,
      lastPaymentDate: null,
      isDead: false,
      deathMarkedDate: null,
    };
    const schedules: FakeSchedule[] = [
      makeSchedule({ id: 'a', installmentNo: 1, principalDue: 4000, interestDue: 400, penaltiesDue: 20 }),
      makeSchedule({ id: 'b', installmentNo: 2, principalDue: 4000, interestDue: 400, penaltiesDue: 30 }),
    ];
    const closureRecord = {
      reason: 'DEAD',
      paidPrincipal: 6000,
      principalWaiver: 2000,
      paidInterest: 800,
      interestWaiver: 0,
      penaltyPaid: 25,
      isReversed: false,
    };
    return { loan, schedules, closureRecord };
  }

  it('DEAD/OTHERS: pays schedules off in full and distributes penalty across schedules oldest-first', async () => {
    const { loan, schedules, closureRecord } = makeDeadLoan();
    const { tx, state } = createFakeTx(loan, schedules, closureRecord);

    await finalizeClosureCoveredLoan(tx, 'WRITEOFF', 'txn-1', 'loan-1', transactionDate);

    const [a, b] = state.schedules;
    expect(a.principalPaid).toBe(4000);
    expect(a.interestPaid).toBe(400);
    expect(a.penaltiesPaid).toBe(20); // fully absorbs its own 20 due first
    expect(a.status).toBe('PAID');
    expect(a.totalPaid).toBe(a.totalDue);

    expect(b.principalPaid).toBe(4000);
    expect(b.interestPaid).toBe(400);
    expect(b.penaltiesPaid).toBe(5); // only 5 left in the 25-wide pool after `a` took 20
    expect(b.status).toBe('PAID');

    expect(state.loan.principalPaid).toBe(10000); // full loan amount, not incremented
    expect(state.loan.interestPaid).toBe(800); // paidInterest + interestWaiver
    expect(state.loan.penaltiesPaid).toBe(25); // full stored penaltyPaid
    expect(state.loan.disbursementStatus).toBe('CLOSED');
    expect(state.loan.closureReason).toBe('DEAD');
    expect(state.loan.isActive).toBe(false);
    expect(state.loan.isDead).toBe(true);
    expect(state.loan.deathMarkedDate).toEqual(transactionDate);
  });

  it('DEAD/OTHERS close + revert round-trips exactly back to the pre-closure state', async () => {
    const { loan, schedules, closureRecord } = makeDeadLoan();
    const { tx, state } = createFakeTx(loan, schedules, closureRecord);

    await finalizeClosureCoveredLoan(tx, 'WRITEOFF', 'txn-1', 'loan-1', transactionDate);

    await unwindForeclosureFinalization(tx, {
      loanId: 'loan-1',
      transactionId: 'txn-1',
      principalAmount: closureRecord.paidPrincipal + closureRecord.principalWaiver,
      interestAmount: closureRecord.paidInterest + closureRecord.interestWaiver,
      feesAmount: 0,
      penaltyAmount: closureRecord.penaltyPaid,
    });

    expect(state.loan.principalPaid).toBe(2000); // original value
    expect(state.loan.interestPaid).toBe(0);
    expect(state.loan.penaltiesPaid).toBe(0);
    expect(state.loan.isActive).toBe(true);
    expect(state.loan.closedDate).toBeNull();

    for (const s of state.schedules) {
      expect(s.principalPaid).toBe(0);
      expect(s.interestPaid).toBe(0);
      expect(s.penaltiesPaid).toBe(0);
      expect(s.totalPaid).toBe(0);
      expect(s.status).toBe('PENDING');
      expect(s.paidAt).toBeNull();
    }
  });

  it('WRITEOFF: only flips schedule status, never touches paid-amount fields or Loan balances', async () => {
    const loan: FakeLoan = {
      id: 'loan-2',
      amount: 10000,
      principalPaid: 2000,
      interestPaid: 0,
      penaltiesPaid: 0,
      isActive: true,
      disbursementStatus: 'DISBURSED',
      closureReason: null,
      closedDate: null,
      lastPaymentDate: null,
      isDead: false,
      deathMarkedDate: null,
    };
    const schedules: FakeSchedule[] = [
      makeSchedule({ id: 'a', installmentNo: 1, principalDue: 4000, interestDue: 400, penaltiesDue: 20, status: 'PENDING' }),
      makeSchedule({ id: 'b', installmentNo: 2, principalDue: 4000, interestDue: 400, penaltiesDue: 30, status: 'OVERDUE' }),
    ];
    const closureRecord = { reason: 'WRITEOFF', paidPrincipal: 100, principalWaiver: 7900, paidInterest: 50, interestWaiver: 750, penaltyPaid: 10, isReversed: false };
    const { tx, state } = createFakeTx(loan, schedules, closureRecord);

    await finalizeClosureCoveredLoan(tx, 'WRITEOFF', 'txn-2', 'loan-2', transactionDate);

    for (const s of state.schedules) {
      expect(s.status).toBe('CLOSED');
      expect(s.principalPaid).toBe(0);
      expect(s.interestPaid).toBe(0);
      expect(s.penaltiesPaid).toBe(0);
    }
    expect(state.loan.principalPaid).toBe(2000); // untouched
    expect(state.loan.interestPaid).toBe(0); // untouched
    expect(state.loan.penaltiesPaid).toBe(0); // untouched
    expect(state.loan.disbursementStatus).toBe('CLOSED');
    expect(state.loan.closureReason).toBe('WRITEOFF');
    expect(state.loan.isActive).toBe(false);
  });
});

