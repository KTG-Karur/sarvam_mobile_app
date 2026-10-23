import { prisma } from '@/app/lib/prisma';
import { getKolkataDayEndExclusiveUtc, getKolkataCalendarYmd } from '@/app/lib/branch-lock';
import {
    getBranchCalendarDayHalfOpenUtc,
    getWeekdayNameInTimeZone,
} from '@/app/lib/branch-financial-day';
import { DENOMINATION_VALUES } from '@/app/lib/denomination-money';
import { getDenominationValidation } from '@/app/lib/denomination-entry';
import { getLedgerPaidByScheduleBatched } from '@/app/lib/ledger/schedule-paid-amounts';
import {
    installmentsDueOnDayWhere,
    repaymentPostedTodayWhere,
    unattemptedInstallmentScheduleWhere,
} from '@/app/lib/eod-collection-gates';
import {
    indexedTodayUndisbursedWhere,
    unindexedEligibleForIndexationWhere,
} from '@/app/lib/eod-disbursement-gates';
import {
    buildFdoMarkedPresentUserIds,
    eodDemandRepaymentCollectionTypeWhere,
} from '@/app/lib/eod-center-meeting-gates';
import type {
    EodChecklistDetailsPayload,
    EodDetailRow,
    EodDetailSection,
} from '@/app/types/eod-checklist-details';

export type {
    EodChecklistDetailsPayload,
    EodDetailColumn,
    EodDetailRow,
    EodDetailSection,
    EodRowAccent,
} from '@/app/types/eod-checklist-details';

const MAX_COLLECTION_ROWS = 2500;

function fullName(first?: string | null, last?: string | null): string {
    const s = `${first ?? ''} ${last ?? ''}`.trim();
    return s.length > 0 ? s : '—';
}

function formatDdMmYyyy(d: Date | null | undefined): string {
    if (!d) return '—';
    try {
        // Use IST calendar date \u2014 date-fns format() uses server-local TZ and would
        // return the wrong day on UTC servers for dates stored as +05:30 midnight.
        const ymd = getKolkataCalendarYmd(d); // 'YYYY-MM-DD' in IST
        const [y, m, day] = ymd.split('-');
        return `${day}/${m}/${y}`;
    } catch {
        return '—';
    }
}


function formatUtcDateTime(d: Date | null | undefined): string {
    if (!d) return '—';
    // Format in IST (Asia/Kolkata) — display the branch-local date + time, not UTC.
    const parts = new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    }).formatToParts(d);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
    return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

function formatInr(amount: number): string {
    return new Intl.NumberFormat('en-IN', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
    }).format(amount);
}

function collectorLabel(u: { firstName: string | null; lastName: string | null; role: string }): string {
    const name = fullName(u.firstName, u.lastName);
    return `${u.role} — ${name}`;
}

function centerLabel(c: { code: string; name: string } | null | undefined): string {
    if (!c) return '—';
    return `${c.code} — ${c.name}`;
}

function clientLabel(cl: {
    clientId: string;
    firstName: string | null;
    lastName: string | null;
}): string {
    return `${cl.clientId} — ${fullName(cl.firstName, cl.lastName)}`;
}

/**
 * Row-level data for every EOD checklist code, using the same calendar window as `computeChecklist`.
 */
export async function buildEodChecklistDetails(
    branchId: string,
    processDate: Date,
    branchCalendarTimeZone: string
): Promise<EodChecklistDetailsPayload> {
    const { dayStartUtc, dayEndExclusiveUtc, workingDateYmd } = getBranchCalendarDayHalfOpenUtc(
        processDate,
        branchCalendarTimeZone
    );
    const dayName = getWeekdayNameInTimeZone(processDate, branchCalendarTimeZone);
    const attendanceDayEndExclusiveUtc = getKolkataDayEndExclusiveUtc(dayStartUtc);

    const branchUsers = await prisma.user.findMany({
        where: { branchId, isActive: true },
        select: { id: true, firstName: true, lastName: true, role: true },
    });
    const branchEmployeeIds = branchUsers.map((u) => u.id);

    const [
        attendanceRows,
        scheduledCenters,
        installmentsDueToday,
        repayments,
        preclosures,
        disbursedLoans,
        foreclosureRequestsToday,
        indexedTodayUndisbursedLoans,
        unindexedPipelineLoans,
        denominationValidation,
        scheduledInstallmentsToday,
        repaymentsPostedTodayLoanIds,
    ] = await Promise.all([
        branchEmployeeIds.length === 0
            ? Promise.resolve([])
            : prisma.attendance.findMany({
                  where: {
                      userId: { in: branchEmployeeIds },
                      date: { gte: dayStartUtc, lt: attendanceDayEndExclusiveUtc },
                  },
                  include: {
                      user: { select: { id: true, firstName: true, lastName: true, role: true } },
                  },
              }),
        prisma.center.findMany({
            where: { branchId, meetingDay: dayName, isActive: true, status: 'APPROVED' },
            include: { fdo: { select: { firstName: true, lastName: true } } },
            orderBy: { code: 'asc' },
        }),
        // Code 6: the day's demand — every installment due today (any status)
        prisma.loanSchedule.findMany({
            where: installmentsDueOnDayWhere(branchId, dayStartUtc, dayEndExclusiveUtc),
            select: {
                id: true,
                loanId: true,
                totalDue: true,
                loan: {
                    select: {
                        loanNumber: true,
                        center: { select: { code: true, name: true } },
                        client: { select: { clientId: true, firstName: true, lastName: true } },
                    },
                },
            },
            orderBy: { dueDate: 'asc' },
            take: MAX_COLLECTION_ROWS,
        }),
        prisma.loanTransaction.findMany({
            where: {
                branchId,
                transactionDate: { gte: dayStartUtc, lt: dayEndExclusiveUtc },
                type: 'REPAYMENT',
                isReversed: false,
            },
            include: {
                loan: { select: { loanNumber: true } },
                center: { select: { code: true, name: true } },
                client: { select: { clientId: true, firstName: true, lastName: true } },
                collectedBy: { select: { firstName: true, lastName: true, role: true } },
            },
            orderBy: { transactionDate: 'asc' },
            take: MAX_COLLECTION_ROWS,
        }),
        prisma.loanTransaction.findMany({
            where: {
                branchId,
                transactionDate: { gte: dayStartUtc, lt: dayEndExclusiveUtc },
                type: 'PRECLOSURE',
                isReversed: false,
            },
            include: {
                loan: { select: { loanNumber: true } },
                center: { select: { code: true, name: true } },
                client: { select: { clientId: true, firstName: true, lastName: true } },
                collectedBy: { select: { firstName: true, lastName: true, role: true } },
            },
            orderBy: { transactionDate: 'asc' },
            take: MAX_COLLECTION_ROWS,
        }),
        prisma.loan.findMany({
            where: {
                branchId,
                disbursedLevel1At: { gte: dayStartUtc, lt: dayEndExclusiveUtc },
                disbursementStatus: 'DISBURSED',
            },
            include: {
                client: { select: { clientId: true, firstName: true, lastName: true } },
                center: { select: { code: true, name: true } },
            },
            orderBy: { disbursedLevel1At: 'asc' },
            take: MAX_COLLECTION_ROWS,
        }),
        // Preclosure: requests raised on this day that have not been processed yet
        // (a processed one already appears as its PRECLOSURE transaction).
        prisma.foreclosureRequest.findMany({
            where: {
                branchId,
                initiatedAt: { gte: dayStartUtc, lt: dayEndExclusiveUtc },
                status: { not: 'APPROVED' },
            },
            include: {
                loan: { select: { loanNumber: true } },
                client: { select: { clientId: true, firstName: true, lastName: true } },
                center: { select: { code: true, name: true } },
                initiatedBy: { select: { firstName: true, lastName: true, role: true } },
            },
            orderBy: { createdAt: 'asc' },
        }),
        prisma.loan.findMany({
            where: indexedTodayUndisbursedWhere(branchId, dayStartUtc, dayEndExclusiveUtc),
            include: {
                client: { select: { clientId: true, firstName: true, lastName: true } },
                center: { select: { code: true, name: true } },
                loanIndex: { select: { indexNo: true } },
                createdBy: { select: { firstName: true, lastName: true, role: true } },
            },
            orderBy: { createdAt: 'asc' },
            take: MAX_COLLECTION_ROWS,
        }),
        prisma.loan.findMany({
            where: unindexedEligibleForIndexationWhere(branchId),
            include: {
                client: { select: { clientId: true, firstName: true, lastName: true } },
                center: { select: { code: true, name: true } },
                createdBy: { select: { firstName: true, lastName: true, role: true } },
            },
            orderBy: { createdAt: 'asc' },
            take: MAX_COLLECTION_ROWS,
        }),
        getDenominationValidation(branchId, processDate, branchCalendarTimeZone),
        // Code 9: installments due today without any repayment today
        prisma.loanSchedule.findMany({
            where: unattemptedInstallmentScheduleWhere(branchId, dayStartUtc, dayEndExclusiveUtc),
            select: {
                loanId: true,
                dueDate: true,
                status: true,
                totalDue: true,
                loan: {
                    select: {
                        loanNumber: true,
                        center: { select: { code: true, name: true } },
                        client: { select: { clientId: true, firstName: true, lastName: true } },
                    },
                },
            },
            orderBy: { dueDate: 'asc' },
            take: MAX_COLLECTION_ROWS,
        }),
        // Code 9: loans with repayment today (to exclude from unattempted list)
        prisma.loanTransaction.findMany({
            where: repaymentPostedTodayWhere(branchId, dayStartUtc, dayEndExclusiveUtc),
            select: { loanId: true },
            distinct: ['loanId'],
        }),
    ]);

    const branchUserIds = new Set(branchUsers.map((u) => u.id));
    const attendanceByUserId = new Map(
        attendanceRows.filter((a) => branchUserIds.has(a.userId)).map((a) => [a.userId, a])
    );

    const activeFDOIds = new Set(branchUsers.filter((u) => u.role === 'FDO').map((u) => u.id));

    const openFdoSessions = attendanceRows.filter((a) => {
        if (!activeFDOIds.has(a.userId)) return false;
        if (a.status !== 'PRESENT' && a.status !== 'HALF_DAY') return false;
        return a.checkOut == null;
    });

    const centerIdsScheduled = scheduledCenters.map((c) => c.id);
    let centersWithActivityIds = new Set<string>();
    let centersWithDemandRepaymentIds = new Set<string>();
    if (centerIdsScheduled.length > 0) {
        const txDistinct = await prisma.loanTransaction.findMany({
            where: {
                branchId,
                centerId: { in: centerIdsScheduled },
                transactionDate: { gte: dayStartUtc, lt: dayEndExclusiveUtc },
                isReversed: false,
            },
            select: { centerId: true },
            distinct: ['centerId'],
        });
        centersWithActivityIds = new Set(
            txDistinct.map((t) => t.centerId).filter((id): id is string => Boolean(id))
        );
        const demandDistinct = await prisma.loanTransaction.findMany({
            where: {
                branchId,
                centerId: { in: centerIdsScheduled },
                transactionDate: { gte: dayStartUtc, lt: dayEndExclusiveUtc },
                AND: [eodDemandRepaymentCollectionTypeWhere()],
            },
            select: { centerId: true },
            distinct: ['centerId'],
        });
        centersWithDemandRepaymentIds = new Set(
            demandDistinct.map((t) => t.centerId).filter((id): id is string => Boolean(id))
        );
    }

    const fdoMarkedPresentUserIds = buildFdoMarkedPresentUserIds(
        attendanceRows.map((a) => ({ userId: a.userId, status: a.status }))
    );

    const section1: EodDetailSection = {
        code: 1,
        title: 'Session Out',
        columns: [
            { key: 'employee', label: 'Employee' },
            { key: 'role', label: 'Role' },
            { key: 'status', label: 'Attendance' },
            { key: 'checkIn', label: 'Check-in (UTC)' },
            { key: 'session', label: 'Session' },
        ],
        rows: openFdoSessions.map((a) => ({
            employee: fullName(a.user.firstName, a.user.lastName),
            role: a.user.role,
            status: a.status,
            checkIn: formatUtcDateTime(a.checkIn),
            session: 'Open — check out required',
        })),
        emptyMessage: 'All tracked field sessions are checked out for this branch day.',
    };

    const section2: EodDetailSection = {
        code: 2,
        title: 'Employee Attendance',
        columns: [
            { key: 'employee', label: 'Employee' },
            { key: 'role', label: 'Role' },
            { key: 'marked', label: 'Marked' },
            { key: 'status', label: 'Status' },
            { key: 'checkIn', label: 'Check-in (UTC)' },
            { key: 'checkOut', label: 'Check-out (UTC)' },
        ],
        rows: branchUsers.map((u) => {
            const rec = attendanceByUserId.get(u.id);
            return {
                employee: fullName(u.firstName, u.lastName),
                role: u.role,
                marked: rec ? 'Yes' : 'No',
                status: rec?.status ?? '—',
                checkIn: formatUtcDateTime(rec?.checkIn ?? null),
                checkOut: formatUtcDateTime(rec?.checkOut ?? null),
            };
        }),
        emptyMessage: 'No active employees found for this branch.',
    };

    const section5: EodDetailSection = {
        code: 5,
        title: 'Center Meeting',
        columns: [
            { key: 'centerId', label: 'Center ID' },
            { key: 'centerName', label: 'Center Name' },
            { key: 'fdo', label: 'FDO' },
            { key: 'fdoPresent', label: 'FDO Present' },
            { key: 'meetingTime', label: 'Meeting Time' },
            { key: 'collection', label: 'Collection' },
            { key: 'nextMeetingDate', label: 'Next Meeting' },
        ],
        rows: scheduledCenters.map((c) => {
            const fdoId = c.fdoId ?? null;
            return {
                centerId: c.code,
                centerName: c.name,
                fdo: c.fdo ? fullName(c.fdo.firstName, c.fdo.lastName).toUpperCase() : 'UNASSIGNED',
                fdoPresent:
                    fdoId != null && fdoMarkedPresentUserIds.has(fdoId) ? 'Yes' : fdoId != null ? 'No' : '—',
                meetingTime: c.meetingTime ?? '—',
                collection: centersWithDemandRepaymentIds.has(c.id)
                    ? 'Collected'
                    : centersWithActivityIds.has(c.id)
                      ? 'Other activity'
                      : 'No collection',
                nextMeetingDate: formatDdMmYyyy(c.nextMeetingDate),
            };
        }),
        emptyMessage: `No centers are scheduled for ${dayName} in this branch.`,
    };

    // Code 6: one row per member due today (with what was collected from them today),
    // then any other member who paid today without an installment due (arrear/advance).
    type CollectedToday = { amount: number; collectors: Set<string>; statuses: Set<string> };
    const collectedByLoanId = new Map<string, CollectedToday>();
    for (const t of repayments) {
        const entry = collectedByLoanId.get(t.loanId) ?? {
            amount: 0,
            collectors: new Set<string>(),
            statuses: new Set<string>(),
        };
        entry.amount += Number(t.amount);
        entry.collectors.add(collectorLabel(t.collectedBy));
        entry.statuses.add(
            t.status === 'PENDING' ? 'Awaiting BM approval' : t.status === 'APPROVED' ? 'Approved' : String(t.status)
        );
        collectedByLoanId.set(t.loanId, entry);
    }

    // Due today is net of advance: payments made on EARLIER days against today's installments.
    // (The exclusive bound of the ledger lookup is the day itself, so today's collections are not netted.)
    const advancePaidBySchedule = await getLedgerPaidByScheduleBatched(
        new Map([[getKolkataCalendarYmd(dayStartUtc), installmentsDueToday.map((s) => s.id)]])
    );
    const dueByLoanId = new Map<string, { due: number; schedule: (typeof installmentsDueToday)[number] }>();
    for (const sch of installmentsDueToday) {
        const advance = advancePaidBySchedule.get(sch.id);
        const netDue = Math.max(0, Number(sch.totalDue) - (advance ? advance.principal + advance.interest : 0));
        const existing = dueByLoanId.get(sch.loanId);
        if (existing) existing.due += netDue;
        else dueByLoanId.set(sch.loanId, { due: netDue, schedule: sch });
    }

    const collectionRows: EodDetailRow[] = [];
    for (const [loanId, { due, schedule }] of dueByLoanId) {
        const got = collectedByLoanId.get(loanId);
        const collected = got?.amount ?? 0;
        collectionRows.push({
            loanNo: schedule.loan.loanNumber,
            center: centerLabel(schedule.loan.center),
            client: clientLabel(schedule.loan.client),
            dueAmount: formatInr(due),
            collected: collected > 0 ? formatInr(collected) : '—',
            result:
                due <= 0.005 && collected <= 0
                    ? 'Paid in advance'
                    : collected <= 0
                      ? 'Not collected'
                      : collected + 0.005 < due
                        ? 'Partially collected'
                        : 'Collected',
            txnStatus: got ? [...got.statuses].join(', ') : '—',
            collectedBy: got ? [...got.collectors].join(', ') : '—',
        });
    }
    const extraCollectedLoanIds = new Set<string>();
    for (const t of repayments) {
        if (dueByLoanId.has(t.loanId) || extraCollectedLoanIds.has(t.loanId)) continue;
        extraCollectedLoanIds.add(t.loanId);
        const got = collectedByLoanId.get(t.loanId);
        collectionRows.push({
            loanNo: t.loan?.loanNumber ?? '—',
            center: centerLabel(t.center),
            client: clientLabel(t.client),
            dueAmount: 'Not due today',
            collected: formatInr(got?.amount ?? Number(t.amount)),
            result: 'Collected (arrear / advance)',
            txnStatus: got ? [...got.statuses].join(', ') : String(t.status),
            collectedBy: got ? [...got.collectors].join(', ') : collectorLabel(t.collectedBy),
        });
    }

    const section6: EodDetailSection = {
        code: 6,
        title: 'Collection',
        columns: [
            { key: 'loanNo', label: 'Loan No.' },
            { key: 'center', label: 'Center' },
            { key: 'client', label: 'Client' },
            { key: 'dueAmount', label: 'Due Today', align: 'right' },
            { key: 'collected', label: 'Collected', align: 'right' },
            { key: 'result', label: 'Collection' },
            { key: 'txnStatus', label: 'Txn Status' },
            { key: 'collectedBy', label: 'Collected By' },
        ],
        rows: collectionRows.slice(0, MAX_COLLECTION_ROWS),
        emptyMessage: 'No installments are due and no collections were recorded on this day.',
    };

    const section7: EodDetailSection = {
        code: 7,
        title: 'Preclosure',
        columns: [
            { key: 'loanNo', label: 'Loan No.' },
            { key: 'client', label: 'Client' },
            { key: 'center', label: 'Center' },
            { key: 'amount', label: 'Amount', align: 'right' },
            { key: 'status', label: 'Request Status' },
            { key: 'initiatedBy', label: 'Initiated by' },
            { key: 'initiatedAt', label: 'Initiated at' },
        ],
        rows: [
            // Requests raised this day that are not processed yet
            ...foreclosureRequestsToday.map((r) => ({
                loanNo: r.loan.loanNumber,
                client: clientLabel(r.client),
                center: centerLabel(r.center),
                amount: formatInr(Number(r.amountCollected)),
                status:
                    r.status === 'INITIATED'
                        ? 'Initiated'
                        : r.status === 'PENDING_APPROVAL'
                          ? 'Pending Approval'
                          : r.status === 'REJECTED'
                            ? 'Rejected'
                            : String(r.status),
                initiatedBy: collectorLabel(r.initiatedBy),
                initiatedAt: formatUtcDateTime(r.initiatedAt),
            })),
            // Completed preclosure transactions
            ...preclosures.map((t) => ({
                loanNo: t.loan?.loanNumber ?? '—',
                client: clientLabel(t.client),
                center: centerLabel(t.center),
                amount: formatInr(Number(t.amount)),
                status: 'Processed',
                initiatedBy: collectorLabel(t.collectedBy),
                initiatedAt: formatUtcDateTime(t.transactionDate),
            })),
        ],
        emptyMessage: 'No member was preclosed on this day.',
    };

    const disbursementDetailRows: EodDetailRow[] = [
        ...indexedTodayUndisbursedLoans.map((l) => ({
            _rowAccent: 'indexed-pending-disburse' as const,
            pipeline: "Indexed (today's window) — not disbursed",
            loanAc: l.loanNumber,
            client: clientLabel(l.client),
            center: centerLabel(l.center),
            indexNo: l.loanIndex?.indexNo ?? '—',
            application: l.applicationStatus,
            createdBy: collectorLabel(l.createdBy),
            amount: formatInr(Number(l.amount)),
            disbursedAt: '— NOT DISBURSED —',
            disbursementStatus: l.disbursementStatus,
        })),
        ...unindexedPipelineLoans.map((l) => ({
            _rowAccent: 'unindexed-pending-index' as const,
            pipeline: 'Unindexed — pending indexation',
            loanAc: l.loanNumber,
            client: clientLabel(l.client),
            center: centerLabel(l.center),
            indexNo: '—',
            application: l.applicationStatus,
            createdBy: collectorLabel(l.createdBy),
            amount: formatInr(Number(l.amount)),
            disbursedAt: '—',
            disbursementStatus: l.disbursementStatus,
        })),
        ...disbursedLoans.map((l) => ({
            pipeline: 'Disbursed (today)',
            loanAc: l.loanNumber,
            client: clientLabel(l.client),
            center: centerLabel(l.center),
            indexNo: '—',
            application: '—',
            createdBy: '—',
            amount: formatInr(Number(l.amount)),
            disbursedAt: l.disbursedLevel1At ? formatUtcDateTime(l.disbursedLevel1At) : '—',
            disbursementStatus: 'DISBURSED',
        })),
    ].slice(0, MAX_COLLECTION_ROWS);

    const section8: EodDetailSection = {
        code: 8,
        title: 'Loan Disbursement',
        columns: [
            { key: 'pipeline', label: 'Pipeline' },
            { key: 'loanAc', label: 'Loan A/C' },
            { key: 'client', label: 'Client' },
            { key: 'center', label: 'Center' },
            { key: 'indexNo', label: 'Index No.' },
            { key: 'application', label: 'Application' },
            { key: 'createdBy', label: 'Loan created by' },
            { key: 'amount', label: 'Amount', align: 'right' },
            { key: 'disbursedAt', label: 'Disbursed at (UTC)' },
            { key: 'disbursementStatus', label: 'Disburse status' },
        ],
        rows: disbursementDetailRows,
        emptyMessage:
            'No disbursement activity on this branch day and no indexation pipeline items for this branch.',
    };

    // Code 9: derive unattempted installments (due today, no repayment posted today)
    const repaymentsPostedTodayLoanIdSet = new Set(
        repaymentsPostedTodayLoanIds.map((t) => t.loanId)
    );
    const unattemptedInstallments = scheduledInstallmentsToday.filter(
        (s) => !repaymentsPostedTodayLoanIdSet.has(s.loanId)
    );

    const section9: EodDetailSection = {
        code: 9,
        title: 'Collection Error',
        columns: [
            { key: 'loanNo', label: 'Loan No.' },
            { key: 'client', label: 'Client' },
            { key: 'center', label: 'Center' },
            { key: 'dueDate', label: 'Due Date' },
            { key: 'scheduleStatus', label: 'Schedule Status' },
            { key: 'amountDue', label: 'Amount Due', align: 'right' },
        ],
        rows: unattemptedInstallments.map((s) => ({
            loanNo: s.loan.loanNumber,
            client: clientLabel(s.loan.client),
            center: centerLabel(s.loan.center),
            dueDate: formatDdMmYyyy(s.dueDate),
            scheduleStatus: s.status,
            amountDue: formatInr(Number(s.totalDue)),
        })),
        emptyMessage:
            'Every member due today has a collection recorded.',
    };

    const denom = denominationValidation;
    const entry = denom.entry;
    const denomRows: EodDetailRow[] = [
        {
            field: 'Expected cash total (whole ₹)',
            value: formatInr(denom.expectedAmount),
        },
        {
            field: 'Raw expected (before floor)',
            value: formatInr(denom.expectedAmountRaw),
        },
        {
            field: 'Denomination entry saved',
            value: entry ? 'Yes' : 'No',
        },
        {
            field: 'Entered total',
            value: formatInr(denom.enteredAmount),
        },
        {
            field: 'Matches expected',
            value: denom.matchesExpected ? 'Yes' : 'No',
        },
    ];

    if (entry) {
        denomRows.push(
            { field: 'Entry date', value: formatDdMmYyyy(entry.entryDate) },
            { field: 'Last updated', value: formatDdMmYyyy(entry.updatedAt) }
        );
        (Object.keys(DENOMINATION_VALUES) as (keyof typeof DENOMINATION_VALUES)[]).forEach((key) => {
            const noteValue = DENOMINATION_VALUES[key];
            const count = entry[key] as number;
            if (count > 0) {
                denomRows.push({
                    field: `₹${noteValue} × pieces`,
                    value: `${count}  (${formatInr(count * noteValue)})`,
                });
            }
        });
    }

    const section10: EodDetailSection = {
        code: 10,
        title: 'Denomination Entry',
        columns: [
            { key: 'field', label: 'Field' },
            { key: 'value', label: 'Value' },
        ],
        rows: denomRows,
        emptyMessage: 'Denomination summary unavailable.',
    };

    const pendingEodAllocation = denom.pendingEodAllocation ?? 0;
    const section11: EodDetailSection = {
        code: 11,
        title: 'EOD Allocation',
        columns: [
            { key: 'field', label: 'Field' },
            { key: 'value', label: 'Value' },
        ],
        rows: [
            {
                field: 'Pending EOD allocation (approved, not yet allocated)',
                value: formatInr(pendingEodAllocation),
            },
            {
                field: 'Blocks EOD close',
                value: pendingEodAllocation > 0 ? 'Yes' : 'No',
            },
        ],
        emptyMessage:
            'All approved collections have been run through Allocate for EOD.',
    };

    const sections: EodDetailSection[] = [
        section1,
        section2,
        section5,
        section6,
        section7,
        section8,
        section9,
        section10,
        section11,
    ];

    return {
        workingDateYmd,
        branchCalendarTimeZone,
        sections,
    };
}
