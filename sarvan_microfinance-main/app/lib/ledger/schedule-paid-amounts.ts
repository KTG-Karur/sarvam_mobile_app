import { prisma } from '@/app/lib/prisma';
import { parseKolkataAttendanceDateYmd } from '@/app/lib/branch-lock';

export type SchedulePaidAmount = {
  principal: number;
  interest: number;
};

/**
 * Ledger-derived "paid as of" amounts per schedule, from LoanTransactionLine (the source of
 * truth) rather than LoanSchedule.principalPaid/interestPaid — those live cumulative fields
 * can drift from the actual transaction-line history (confirmed on real data, see
 * app/lib/actions/reports.ts's getMISDetailedAgewiseArrearData). One groupBy per distinct
 * cutoff key so callers spanning many branches/schedules still batch cleanly instead of
 * querying per-schedule.
 *
 * `scheduleIdsByCutoffExclusiveYmd` keys are the Kolkata-calendar-day YMD string
 * immediately AFTER the last day a payment should count (i.e. the exclusive upper bound) —
 * callers typically pass `addCalendarDaysToYmd(effectiveCutoffYmd, 1)` as the key.
 */
export async function getLedgerPaidByScheduleBatched(
  scheduleIdsByCutoffExclusiveYmd: Map<string, string[]>
): Promise<Map<string, SchedulePaidAmount>> {
  const ledgerPaidBySchedule = new Map<string, SchedulePaidAmount>();

  for (const [cutoffExclusiveYmd, scheduleIds] of scheduleIdsByCutoffExclusiveYmd) {
    if (scheduleIds.length === 0) continue;
    const cutoffExclusiveUtc = parseKolkataAttendanceDateYmd(cutoffExclusiveYmd);
    const lineSums = await prisma.loanTransactionLine.groupBy({
      by: ['scheduleId'],
      where: {
        scheduleId: { in: scheduleIds },
        transaction: {
          transactionDate: { lt: cutoffExclusiveUtc },
          status: 'APPROVED',
          isReversed: false,
          type: { in: ['REPAYMENT', 'PRECLOSURE'] },
        },
      },
      _sum: { principalAmount: true, interestAmount: true },
    });
    for (const r of lineSums) {
      if (!r.scheduleId) continue;
      ledgerPaidBySchedule.set(r.scheduleId, {
        principal: Number(r._sum.principalAmount ?? 0),
        interest: Number(r._sum.interestAmount ?? 0),
      });
    }
  }

  return ledgerPaidBySchedule;
}
