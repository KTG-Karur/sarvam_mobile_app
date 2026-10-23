import type { Prisma } from '@prisma/client';
import type { ClosureType } from '@/app/lib/eod-closure-allocation';

export const FORECLOSURE_MONEY_TOLERANCE = 0.01;

/**
 * Finalizes a single covered PRECLOSURE/WRITEOFF loan (marks schedules PAID/CLOSED, updates Loan
 * status) — called once, at approval time, by both the Foreclosure approve route
 * (app/api/foreclosures/[id]/approve/route.ts) and the Loan Write-Off/Death Closure creation route
 * (app/api/collections/loan-writeoff-closure/route.ts), so the two closure types can't drift out
 * of sync on what "finalize" actually does to the loan. Mirrors REPAYMENT's own approval-time
 * balance update (app/api/collections/approve/route.ts) — the loan closes immediately when the
 * closure is approved/created; "Allocate for EOD" only posts the GL voucher afterward (see
 * postEodClosureAllocation / postEodFunderAllocation in accounting-posting.service.ts), exactly
 * like a normal collection. No-op if the request/record backing the covered transaction can't be
 * found or isn't APPROVED — callers dedupe by loanId before calling, so this only runs once per loan.
 */
export async function finalizeClosureCoveredLoan(
  tx: Prisma.TransactionClient,
  closureType: ClosureType,
  coveredTransactionId: string,
  loanId: string,
  transactionDate: Date
): Promise<void> {
  if (closureType === 'PRECLOSURE') {
    // Keyed off this specific transaction's unique FK (not "most recent APPROVED request for
    // this loan") — delete-foreclosure never resets ForeclosureRequest.status back off
    // APPROVED on revert, so a loan that had a foreclosure fully reverted and later
    // re-foreclosed could otherwise have more than one APPROVED request on file.
    const request = await tx.foreclosureRequest.findUnique({ where: { transactionId: coveredTransactionId } });
    if (!request || request.status !== 'APPROVED') return;

    const loan = await tx.loan.findUnique({
      where: { id: loanId },
      include: { schedules: { where: { status: { not: 'PAID' } } } },
    });
    if (!loan) return;

    for (const schedule of loan.schedules) {
      await tx.loanSchedule.update({
        where: { id: schedule.id },
        data: {
          penaltiesPaid: schedule.penaltiesDue,
          interestPaid: schedule.interestDue,
          principalPaid: schedule.principalDue,
          totalPaid: schedule.totalDue,
          status: 'PAID',
          paidAt: transactionDate,
        },
      });
    }

    await tx.loan.update({
      where: { id: loanId },
      data: {
        principalPaid: loan.amount,
        interestPaid: { increment: Number(request.interestAmount) },
        penaltiesPaid: { increment: Number(request.penaltyAmount) },
        lastPaymentDate: transactionDate,
        closedDate: transactionDate,
        disbursementStatus: 'DISBURSED',
        isActive: false,
      },
    });
    return;
  }

  const record = await tx.loanClosureRecord.findFirst({ where: { loanId, isReversed: false }, orderBy: { createdAt: 'desc' } });
  if (!record) return;

  if (record.reason === 'DEAD' || record.reason === 'OTHERS') {
    // DEAD/OTHERS reuse Pre-Closure's full-payoff schedule logic (unlike WRITEOFF below,
    // which only flips schedule status) — principal/interest are always safe to force to
    // "fully due" here because the UI guarantees paid + waiver === outstanding for both
    // (LoanWriteoffClosureClient.tsx), exactly mirroring how Pre-Closure always collects
    // 100% of principal/interest. Penalty has no such waiver concept, so instead of forcing
    // penaltiesPaid to penaltiesDue (which would invent an unstored, unreversible implicit
    // waiver), the admin-entered record.penaltyPaid is distributed across schedules
    // oldest-first, capped by each schedule's own remaining penalty room — see
    // loan-writeoff-closure/revert/route.ts, which reverses using this same stored value.
    const loan = await tx.loan.findUnique({
      where: { id: loanId },
      include: { schedules: { where: { status: { not: 'PAID' } }, orderBy: { installmentNo: 'asc' } } },
    });
    if (!loan) return;

    let penaltyPool = Number(record.penaltyPaid);

    for (const schedule of loan.schedules) {
      const penaltyRoom = Math.max(0, Number(schedule.penaltiesDue) - Number(schedule.penaltiesPaid));
      const penaltyApplied = Math.min(penaltyPool, penaltyRoom);
      penaltyPool -= penaltyApplied;

      await tx.loanSchedule.update({
        where: { id: schedule.id },
        data: {
          principalPaid: schedule.principalDue,
          interestPaid: schedule.interestDue,
          penaltiesPaid: { increment: penaltyApplied },
          totalPaid: schedule.totalDue,
          status: 'PAID',
          paidAt: transactionDate,
        },
      });
    }

    await tx.loan.update({
      where: { id: loanId },
      data: {
        principalPaid: loan.amount,
        interestPaid: { increment: Number(record.paidInterest) + Number(record.interestWaiver) },
        penaltiesPaid: { increment: Number(record.penaltyPaid) },
        lastPaymentDate: transactionDate,
        closedDate: transactionDate,
        disbursementStatus: 'CLOSED',
        closureReason: record.reason,
        isActive: false,
        ...(record.reason === 'DEAD' ? { isDead: true, deathMarkedDate: transactionDate } : {}),
      },
    });
    return;
  }

  // record.reason === 'WRITEOFF' — unchanged: status-flip only, no paid-amount fields touched.
  await tx.loanSchedule.updateMany({
    where: { loanId, status: { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] } },
    data: { status: 'CLOSED' },
  });

  await tx.loan.update({
    where: { id: loanId },
    data: {
      disbursementStatus: 'CLOSED',
      isActive: false,
      closureReason: record.reason,
      closedDate: transactionDate,
    },
  });
}

export type ForeclosureScheduleSnapshot = {
  status: string;
  principalDue: number;
  principalPaid: number;
  interestDue: number;
  interestPaid: number;
  penaltiesDue: number;
  penaltiesPaid: number;
  dueDate: Date;
};

export function computeOutstandingForForeclosure(input: {
  loanAmount: number;
  principalPaid: number;
  schedules: ForeclosureScheduleSnapshot[];
}) {
  const osPrincipal = input.loanAmount - input.principalPaid;

  const currentDate = new Date();
  currentDate.setHours(0, 0, 0, 0);

  let osInterest = 0;
  let osPenalties = 0;
  let arrearPrincipal = 0;
  let arrearInterest = 0;
  let totalDueWeeks = 0;
  let totalCollectedWeeks = 0;

  for (const schedule of input.schedules) {
    totalDueWeeks += 1;
    if (schedule.status === 'PAID') totalCollectedWeeks += 1;

    // Outstanding is decided by the actual due-vs-paid amounts, not the status
    // label — `status` is a cached/derived field that can drift out of sync
    // (e.g. a reversal recomputing it against a stale `totalDue`), which would
    // silently drop a mismarked-PAID schedule's real remaining balance from
    // both the payoff total and the arrear breakdown below. A genuinely-settled
    // schedule still nets to zero here, so this is a no-op for the common case.
    const interestOutstanding = schedule.interestDue - schedule.interestPaid;
    const penaltiesOutstanding = schedule.penaltiesDue - schedule.penaltiesPaid;
    const principalOutstanding = schedule.principalDue - schedule.principalPaid;
    const hasOutstanding = interestOutstanding > 0 || penaltiesOutstanding > 0 || principalOutstanding > 0;

    if (hasOutstanding) {
      osInterest += interestOutstanding;
      osPenalties += penaltiesOutstanding;
    }

    const scheduleDueDate = new Date(schedule.dueDate);
    scheduleDueDate.setHours(0, 0, 0, 0);
    if (scheduleDueDate < currentDate && hasOutstanding) {
      arrearPrincipal += principalOutstanding;
      arrearInterest += interestOutstanding;
    }
  }

  const totalOutstanding = osPrincipal + osInterest + osPenalties;

  return {
    osPrincipal,
    osInterest,
    osPenalties,
    arrearPrincipal,
    arrearInterest,
    dueWeeks: totalDueWeeks,
    collectedWeeks: totalCollectedWeeks,
    pendingWeeks: totalDueWeeks - totalCollectedWeeks,
    totalOutstanding,
    principalPayment: osPrincipal,
    interestPayment: osInterest,
    penaltyPayment: osPenalties,
  };
}

/**
 * Un-finalizes a single foreclosed loan — the inverse of the PRECLOSURE finalization
 * (`finalizeClosureCoveredLoan` in accounting-posting.service.ts / the legacy inline
 * finalize this predates). That finalization sets every not-yet-PAID schedule fully to
 * PAID and marks the loan closed; there's nothing to "restore" per schedule (the prior
 * partial-paid state was never recorded), so this instead subtracts the foreclosure
 * transaction's own principal/interest/fees/penalty amounts back out schedule-by-schedule,
 * LIFO (latest installment first), exactly undoing what finalization added.
 *
 * Shared by every caller that needs to reopen a foreclosed loan: EOD Allocation Revert's
 * PRECLOSURE bucket (`revertPreclosureAllocation`) and Delete Foreclosure's revert action
 * (for a foreclosure that was already allocated-and-then-reverted, so the loan is still
 * closed even though `eodAllocatedAt` is clear again). Callers are responsible for their
 * own transaction-level updates (clearing `eodAllocatedAt`, marking `isReversed`, etc.) —
 * this only touches `LoanSchedule` and `Loan`.
 */
export async function unwindForeclosureFinalization(
  tx: Prisma.TransactionClient,
  params: {
    loanId: string;
    transactionId: string;
    principalAmount: number;
    interestAmount: number;
    feesAmount: number;
    penaltyAmount: number;
  }
): Promise<void> {
  const loan = await tx.loan.findUnique({
    where: { id: params.loanId },
    include: { schedules: { orderBy: { installmentNo: 'desc' } } },
  });
  if (!loan) return;

  let principalToReverse = Number(params.principalAmount || 0);
  let interestToReverse = Number(params.interestAmount || 0);
  let feesToReverse = Number(params.feesAmount || 0);
  let penaltyToReverse = Number(params.penaltyAmount || 0);

  for (const schedule of loan.schedules) {
    if (principalToReverse <= 0 && interestToReverse <= 0 && feesToReverse <= 0 && penaltyToReverse <= 0) break;

    const schPrincipalPaid = Number(schedule.principalPaid || 0);
    const schInterestPaid = Number(schedule.interestPaid || 0);
    const schFeesPaid = Number(schedule.feesPaid || 0);
    const schPenaltiesPaid = Number(schedule.penaltiesPaid || 0);

    const revPrincipal = Math.min(principalToReverse, schPrincipalPaid);
    const revInterest = Math.min(interestToReverse, schInterestPaid);
    const revFees = Math.min(feesToReverse, schFeesPaid);
    const revPenalty = Math.min(penaltyToReverse, schPenaltiesPaid);

    if (revPrincipal > 0 || revInterest > 0 || revFees > 0 || revPenalty > 0) {
      const newPrincipalPaid = schPrincipalPaid - revPrincipal;
      const newInterestPaid = schInterestPaid - revInterest;
      const newFeesPaid = schFeesPaid - revFees;
      const newPenaltiesPaid = schPenaltiesPaid - revPenalty;
      const newTotalPaid = newPrincipalPaid + newInterestPaid + newFeesPaid + newPenaltiesPaid;
      const totalDue = Number(schedule.totalDue);

      await tx.loanSchedule.update({
        where: { id: schedule.id },
        data: {
          principalPaid: newPrincipalPaid,
          interestPaid: newInterestPaid,
          feesPaid: newFeesPaid,
          penaltiesPaid: newPenaltiesPaid,
          totalPaid: newTotalPaid,
          status: newTotalPaid <= 0 ? 'PENDING' : (newTotalPaid < totalDue ? 'PARTIALLY_PAID' : 'PAID'),
          paidAt: newTotalPaid >= totalDue ? schedule.paidAt : null,
        },
      });

      principalToReverse -= revPrincipal;
      interestToReverse -= revInterest;
      feesToReverse -= revFees;
      penaltyToReverse -= revPenalty;
    }
  }

  const previousTxn = await tx.loanTransaction.findFirst({
    where: { loanId: loan.id, id: { not: params.transactionId }, isReversed: false },
    orderBy: { transactionDate: 'desc' },
  });

  await tx.loan.update({
    where: { id: loan.id },
    data: {
      principalPaid: { decrement: Number(params.principalAmount || 0) },
      interestPaid: { decrement: Number(params.interestAmount || 0) },
      penaltiesPaid: { decrement: Number(params.penaltyAmount || 0) },
      isActive: true,
      closedDate: null,
      lastPaymentDate: previousTxn ? previousTxn.transactionDate : null,
    },
  });
}

export function computeOutstandingTotalsForApproval(input: {
  loanAmount: number;
  principalPaid: number;
  schedules: Array<{
    status: string;
    principalDue: number;
    principalPaid: number;
    interestDue: number;
    interestPaid: number;
    penaltiesDue: number;
    penaltiesPaid: number;
  }>;
}) {
  const osPrincipal = input.loanAmount - input.principalPaid;
  let osInterest = 0;
  let osPenalties = 0;

  for (const schedule of input.schedules) {
    // See computeOutstandingForForeclosure above — the actual due-vs-paid
    // amounts decide outstanding, not the (possibly stale) status label.
    const interestOutstanding = schedule.interestDue - schedule.interestPaid;
    const penaltiesOutstanding = schedule.penaltiesDue - schedule.penaltiesPaid;
    if (interestOutstanding <= 0 && penaltiesOutstanding <= 0) continue;
    osInterest += interestOutstanding;
    osPenalties += penaltiesOutstanding;
  }

  return {
    osPrincipal,
    osInterest,
    osPenalties,
    total: osPrincipal + osInterest + osPenalties,
  };
}

