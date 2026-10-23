import { Prisma } from '@prisma/client';
import { prisma } from '@/app/lib/prisma';
import { BRANCH_LOCK_TIMEZONE, getKolkataDayEndExclusiveUtc } from '@/app/lib/branch-lock';
import {
  getBranchCalendarDayHalfOpenUtc,
  getWeekdayNameInTimeZone,
  parseDenominationEntryDateUtc,
} from '@/app/lib/branch-financial-day';
import { EOD_DENOMINATION_CHECKLIST_CODE } from '@/app/lib/denomination-money';
import {
  getDenominationValidation,
} from '@/app/lib/denomination-entry';
import {
  evaluateEodCollectionError,
  scheduleNotCoveredByAdvanceSql,
  repaymentPostedTodayWhere,
  unattemptedInstallmentScheduleWhere,
} from '@/app/lib/eod-collection-gates';
import {
  evaluateEodDisbursementChecklist,
  indexedTodayUndisbursedWhere,
  unindexedEligibleForIndexationWhere,
} from '@/app/lib/eod-disbursement-gates';
import {
  buildFdoMarkedPresentUserIds,
  eodDemandRepaymentCollectionTypeWhere,
  evaluateEodCenterMeeting,
} from '@/app/lib/eod-center-meeting-gates';

/**
 * Evaluates the full EOD checklist for a branch's working date. Shared by the BM/Admin
 * EOD-status GET, the BM submit-for-approval route, and the AM approve route — all three
 * need the exact same gate evaluation so an approval can never be granted against a
 * checklist state the submit step didn't also require.
 */
export async function computeEodChecklist(
  branchId: string,
  processDate: Date,
  branchCalendarTimeZone: string = BRANCH_LOCK_TIMEZONE
) {
  const { dayStartUtc, dayEndExclusiveUtc, workingDateYmd } =
    getBranchCalendarDayHalfOpenUtc(processDate, branchCalendarTimeZone);
  const dayName = getWeekdayNameInTimeZone(processDate, branchCalendarTimeZone);
  const attendanceDayEndExclusiveUtc = getKolkataDayEndExclusiveUtc(dayStartUtc);

  const [
    branchUsers,
    scheduledCenters,
    txnsCount,
    preclosureTxnsCount,
    disbursedLoansCount,
    indexedTodayUndisbursedCount,
    unindexedPipelineLoansCount,
    dueTodayLoanIds,
    scheduledInstallmentsToday,
    repaymentsPostedTodayLoanIds,
    collectedTodayAggregate,
  ] = await Promise.all([
    prisma.user.findMany({
      where: { branchId, isActive: true },
      select: { id: true, firstName: true, lastName: true, role: true },
    }),
    prisma.center.findMany({
      where: {
        branchId,
        meetingDay: dayName,
        isActive: true,
        status: 'APPROVED',
      },
      select: { id: true, name: true, fdoId: true },
    }),
    prisma.loanTransaction.count({
      where: {
        branchId,
        transactionDate: { gte: dayStartUtc, lt: dayEndExclusiveUtc },
        type: 'REPAYMENT',
        isReversed: false,
      },
    }),
    prisma.loanTransaction.count({
      where: {
        branchId,
        transactionDate: { gte: dayStartUtc, lt: dayEndExclusiveUtc },
        type: 'PRECLOSURE',
        isReversed: false,
      },
    }),
    prisma.loan.count({
      where: {
        branchId,
        disbursedLevel1At: { gte: dayStartUtc, lt: dayEndExclusiveUtc },
        disbursementStatus: 'DISBURSED',
      },
    }),
    prisma.loan.count({
      where: indexedTodayUndisbursedWhere(branchId, dayStartUtc, dayEndExclusiveUtc),
    }),
    prisma.loan.count({
      where: unindexedEligibleForIndexationWhere(branchId),
    }),
    // Code 6: the day's demand — loans with an installment due today (any status)
    // Net of advance: members whose installment due today was already paid in full on an earlier day
    // owe nothing today, so they are not counted as due (same filter as installmentsDueOnDayWhere otherwise).
    prisma.$queryRaw<{ loanId: string; centerId: string | null }[]>(Prisma.sql`
      SELECT DISTINCT s."loanId" AS "loanId", l."centerId" AS "centerId"
      FROM "loan_schedules" s
      JOIN "loans" l ON l."id" = s."loanId"
      WHERE s."dueDate" >= ${dayStartUtc} AND s."dueDate" < ${dayEndExclusiveUtc}
        AND l."branchId" = ${branchId}
        AND l."disbursementStatus" = 'DISBURSED'
        AND (l."closedDate" IS NULL OR l."closedDate" >= ${dayStartUtc})
        AND ${scheduleNotCoveredByAdvanceSql}
    `),
    // Code 9: installments due today (still PENDING/PARTIALLY_PAID/OVERDUE)
    prisma.loanSchedule.findMany({
      where: unattemptedInstallmentScheduleWhere(branchId, dayStartUtc, dayEndExclusiveUtc),
      select: { loanId: true },
    }),
    // Code 9: loans that DO have a repayment posted today (even if still PENDING approval)
    prisma.loanTransaction.findMany({
      where: repaymentPostedTodayWhere(branchId, dayStartUtc, dayEndExclusiveUtc),
      select: { loanId: true },
      distinct: ['loanId'],
    }),
    // Code 6: total repayment amount collected today (pending + approved)
    prisma.loanTransaction.aggregate({
      where: repaymentPostedTodayWhere(branchId, dayStartUtc, dayEndExclusiveUtc),
      _sum: { amount: true },
    }),
  ]);

  const activeBranchEmployees = branchUsers.map(({ id, firstName, lastName }) => ({
    id,
    firstName,
    lastName,
  }));
  const activeFDOs = branchUsers.filter((u) => u.role === 'FDO');
  const branchEmployeeIds = activeBranchEmployees.map((u) => u.id);

  let attendanceRecords: Array<{ userId: string; status: string; checkOut: Date | null }> = [];
  if (branchEmployeeIds.length > 0) {
    try {
      attendanceRecords = await prisma.attendance.findMany({
        where: {
          userId: { in: branchEmployeeIds },
          date: { gte: dayStartUtc, lt: attendanceDayEndExclusiveUtc },
        },
        select: { userId: true, status: true, checkOut: true },
      });
    } catch (error) {
      console.error('[EOD] Attendance query failed:', error);
    }
  }

  const denominationStatus = await getDenominationValidation(
    branchId,
    processDate,
    branchCalendarTimeZone
  );

  const activeFDOIds = new Set(activeFDOs.map((fdo) => fdo.id));
  const missingAttendance = activeBranchEmployees.filter(
    (emp) => !attendanceRecords.some((record) => record.userId === emp.id)
  );
  const attendanceIssue = missingAttendance.length > 0;

  const fdoAttendance = attendanceRecords.filter((record) =>
    activeFDOIds.has(record.userId)
  );
  const presentRecords = fdoAttendance.filter(
    (record) => record.status === 'PRESENT' || record.status === 'HALF_DAY'
  );
  const activeSessions = presentRecords.filter((record) => !record.checkOut);

  const centerIds = scheduledCenters.map((center) => center.id);
  let centersWithNoCollection = 0;
  const centersWithAnyTxn = new Set<string>();
  const centersWithDemandRepayment = new Set<string>();

  if (centerIds.length > 0) {
    const transactionsToday = await prisma.loanTransaction.findMany({
      where: {
        branchId,
        centerId: { in: centerIds },
        transactionDate: { gte: dayStartUtc, lt: dayEndExclusiveUtc },
        isReversed: false,
      },
      select: { centerId: true },
      distinct: ['centerId'],
    });
    for (const item of transactionsToday) {
      if (item.centerId) {
        centersWithAnyTxn.add(item.centerId);
      }
    }

    const demandRepaymentCenters = await prisma.loanTransaction.findMany({
      where: {
        branchId,
        centerId: { in: centerIds },
        transactionDate: { gte: dayStartUtc, lt: dayEndExclusiveUtc },
        AND: [eodDemandRepaymentCollectionTypeWhere()],
      },
      select: { centerId: true },
      distinct: ['centerId'],
    });
    for (const row of demandRepaymentCenters) {
      if (row.centerId) {
        centersWithDemandRepayment.add(row.centerId);
      }
    }

    const repaymentCenterIds = await prisma.loanTransaction.findMany({
      where: {
        branchId,
        centerId: { in: centerIds },
        transactionDate: { gte: dayStartUtc, lt: dayEndExclusiveUtc },
        type: 'REPAYMENT',
        isReversed: false,
      },
      select: { centerId: true },
      distinct: ['centerId'],
    });
    const centersWithRepayment = new Set(repaymentCenterIds.map((t) => t.centerId));
    // A center whose members all paid ahead has nothing to collect today, so it is not "no collection".
    const centersWithDueToday = new Set(dueTodayLoanIds.map((d) => d.centerId));
    centersWithNoCollection = scheduledCenters.filter(
      (center) => !centersWithRepayment.has(center.id) && centersWithDueToday.has(center.id)
    ).length;
  }

  const zeroRepaymentDay = txnsCount === 0;

  // Code 9: compute unattempted count — scheduled today but zero repayment today
  const repaymentsPostedTodayLoanIdSet = new Set(repaymentsPostedTodayLoanIds.map((t) => t.loanId));
  const unattemptedInstallmentCount = scheduledInstallmentsToday.filter(
    (s) => !repaymentsPostedTodayLoanIdSet.has(s.loanId)
  ).length;
  const collectionErrorGate = evaluateEodCollectionError({ unattemptedCount: unattemptedInstallmentCount });

  const meetingGate = evaluateEodCenterMeeting({
    zeroRepaymentDay,
    scheduledCenters: scheduledCenters.map((c) => ({
      id: c.id,
      fdoId: c.fdoId ?? null,
    })),
    centersWithAnyTxn,
    centersWithDemandRepayment,
    fdoMarkedPresentUserIds: buildFdoMarkedPresentUserIds(attendanceRecords),
  });
  const meetingDetailsText = meetingGate.details;

  const collectedTodayAmount = Number(collectedTodayAggregate._sum.amount ?? 0);
  const collectedTodayText = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
  }).format(collectedTodayAmount);
  const collectedLoanCount = repaymentsPostedTodayLoanIds.length;
  const collectionDetailsText =
    `${dueTodayLoanIds.length} member(s) due today; ${collectedLoanCount} member(s) collected (${collectedTodayText}).` +
    (centersWithNoCollection > 0
      ? ` ${centersWithNoCollection} scheduled center(s) have no collection recorded.`
      : '');

  const disbursementGate = evaluateEodDisbursementChecklist({
    indexedTodayUndisbursedCount,
    unindexedPipelineCount: unindexedPipelineLoansCount,
    disbursedTodayCount: disbursedLoansCount,
  });
  const disbursementDetailsText = disbursementGate.details;

  // Codes 1, 5, 6, 7, 8 and 9 are informational only — `status` is a short summary of
  // the day (counts), never a pass/fail label, and they never block EOD close. Only
  // Attendance (2), Denomination (10) and EOD Allocation (11) gate the close.
  const checklist: Array<{
    code: number;
    description: string;
    status: string;
    issue: boolean;
    informational: boolean;
    details: string;
  }> = [
    {
      code: 1,
      description: 'Session Out',
      status: activeSessions.length === 0 ? 'All sessions closed' : `${activeSessions.length} session(s) open`,
      issue: false,
      informational: true,
      details: activeSessions.length === 0 ? 'All sessions closed' : `${activeSessions.length} active sessions`,
    },
    {
      code: 2,
      description: 'Employee Attendance',
      status: attendanceIssue ? 'Yet to Update' : 'Approved',
      issue: attendanceIssue,
      informational: false,
      details: attendanceIssue
        ? `Missing attendance (${missingAttendance.length}): ${missingAttendance
            .map((e) => `${e.firstName} ${e.lastName}`.trim())
            .join(', ')}`
        : 'All branch employees marked',
    },
    {
      code: 5,
      description: 'Center Meeting',
      status: `${scheduledCenters.length} center(s) scheduled`,
      issue: false,
      informational: true,
      details: meetingDetailsText,
    },
    {
      code: 6,
      description: 'Collection',
      status: `${dueTodayLoanIds.length} due · ${collectedLoanCount} collected`,
      issue: false,
      informational: true,
      details: collectionDetailsText,
    },
    {
      code: 7,
      description: 'Preclosure',
      status: `${preclosureTxnsCount} preclosed`,
      issue: false,
      informational: true,
      details: `${preclosureTxnsCount} preclosure(s) processed on this day.`,
    },
    {
      code: 8,
      description: 'Loan Disbursement',
      status: `${disbursedLoansCount} disbursed`,
      issue: false,
      informational: true,
      details: disbursementDetailsText,
    },
    {
      code: 9,
      description: 'Collection Error',
      status: unattemptedInstallmentCount === 0 ? 'All collected' : `${unattemptedInstallmentCount} not collected`,
      issue: false,
      informational: true,
      details: collectionErrorGate.details,
    },
    {
      code: 10,
      description: 'Denomination Entry',
      informational: false,
      status: !denominationStatus.entry
        ? 'Yet to Update'
        : denominationStatus.matchesExpected
          ? 'Approved'
          : 'Amount Mismatch',
      issue: !denominationStatus.matchesExpected,
      details: !denominationStatus.entry
        ? `Expected denomination total: ${denominationStatus.expectedAmount.toFixed(2)} (Opening Bal: ${(denominationStatus.openingBalance ?? 0).toFixed(2)} + Today's Collection: ${(denominationStatus.todayCollection ?? 0).toFixed(2)})`
        : `Expected ${denominationStatus.expectedAmount.toFixed(2)} (Opening: ${(denominationStatus.openingBalance ?? 0).toFixed(2)} + Collection: ${(denominationStatus.todayCollection ?? 0).toFixed(2)}), entered ${denominationStatus.enteredAmount.toFixed(2)}`,
    },
    {
      code: 11,
      description: 'EOD Allocation',
      informational: false,
      // Blocking: approved collection cash that has not been run through
      // "Allocate for EOD" is not yet booked to GL / the Daybook, so it is left
      // out of the expected denomination total. Closing EOD now would drop that
      // cash. The branch must allocate it first (Collections → Approval →
      // Allocate for EOD).
      status: (denominationStatus.pendingEodAllocation ?? 0) > 0 ? 'Allocation Pending' : 'Approved',
      issue: (denominationStatus.pendingEodAllocation ?? 0) > 0,
      details:
        (denominationStatus.pendingEodAllocation ?? 0) > 0
          ? `Pending EOD allocation: ${(denominationStatus.pendingEodAllocation ?? 0).toFixed(2)} — allocate in Collections → Approval (Allocate for EOD) before closing.`
          : 'All approved collections allocated.',
    },
  ];

  const canCompleteEod = !checklist.some((item) => item.issue);
  const canProceedToDenominationStep = !checklist.some(
    (item) => item.issue && item.code !== EOD_DENOMINATION_CHECKLIST_CODE
  );

  return {
    processDate: parseDenominationEntryDateUtc(workingDateYmd),
    branchId,
    workingDateYmd,
    branchCalendarTimeZone,
    expectedCashCreditTotal: denominationStatus.expectedAmount,
    checklist,
    canCompleteEod,
    canProceedToDenominationStep,
  };
}
