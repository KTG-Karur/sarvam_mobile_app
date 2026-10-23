import { daysBetweenYmd, paiseToRupeesTrunc, toPaise } from './format';
import type { UcrfLoanInput } from './types';

/**
 * Schedules in these states are not part of the live demand (mirrors
 * app/lib/collections/demand-calculation.ts NON_OUTSTANDING_SCHEDULE_STATUSES — an exclude
 * list on purpose, because the PENDING/PAID label can drift from the ledger).
 */
const NON_OUTSTANDING = new Set(['WAIVED', 'CLOSED']);

export interface LoanFinancials {
    outstandingPaise: number;
    overduePaise: number;
    dpd: number;
    installmentPaise: number;
    installments: number;
}

/**
 * Overdue / DPD / outstanding as of `reportYmd`, using the same ledger approach as
 * getMISDetailedAgewiseArrearData (app/lib/actions/reports.ts): paid amounts come from approved,
 * non-reversed transaction lines (supplied on each schedule), never the drift-prone cumulative
 * columns.
 *
 * - A schedule is past due only when its due date is strictly before the report date.
 * - Overdue = Σ max(0, principalDue − principalPaid) + max(0, interestDue − interestPaid).
 * - DPD = days between the oldest unpaid past-due installment and the report date (capped 999).
 * - Outstanding = loan principal − Σ principal paid (never negative).
 */
export function computeLoanFinancials(
    amount: number,
    schedules: UcrfLoanInput['schedules'],
    reportYmd: string,
    opts: { ignoreScheduleStatus?: boolean } = {}
): LoanFinancials {
    let overdue = 0;
    let maxDpd = 0;
    let principalPaid = 0;

    for (const s of schedules) {
        principalPaid += toPaise(s.principalPaid);
        if (!opts.ignoreScheduleStatus && NON_OUTSTANDING.has(s.status)) continue;
        if (s.dueYmd >= reportYmd) continue;
        const unpaidP = Math.max(0, toPaise(s.principalDue) - toPaise(s.principalPaid));
        const unpaidI = Math.max(0, toPaise(s.interestDue) - toPaise(s.interestPaid));
        if (unpaidP + unpaidI <= 0) continue;
        overdue += unpaidP + unpaidI;
        maxDpd = Math.max(maxDpd, daysBetweenYmd(s.dueYmd, reportYmd));
    }

    const first = schedules[0];
    return {
        outstandingPaise: Math.max(0, toPaise(amount) - principalPaid),
        overduePaise: overdue,
        dpd: Math.min(999, maxDpd),
        installmentPaise: first ? toPaise(first.principalDue) + toPaise(first.interestDue) : 0,
        installments: schedules.length,
    };
}

export interface AccountState {
    status: string;
    closedYmd: string | null;
    outstandingRupees: number;
    overdueRupees: number;
    dpd: number;
    writeOffRupees: number | null;
    writeOffYmd: string | null;
    writeOffReason: string | null;
    installmentRupees: number;
    installments: number;
}

/**
 * Account Status (field 75) and the balance fields that depend on it, from the app's real loan
 * states: DISBURSED → S04/S05; CLOSED (closedDate ≤ report date) → S07, or S06 when closed by
 * write-off. Loans closed *after* the report date are reported as they stood on that date.
 */
export function deriveAccountState(input: UcrfLoanInput, reportYmd: string): AccountState {
    const closedByReportDate =
        input.disbursementStatus === 'CLOSED' && !!input.closedYmd && input.closedYmd <= reportYmd;

    const live = computeLoanFinancials(input.amount, input.schedules, reportYmd);
    const base = {
        installmentRupees: paiseToRupeesTrunc(live.installmentPaise),
        installments: live.installments,
    };

    const wroteOff =
        closedByReportDate &&
        input.writeOff !== null &&
        input.writeOff.ymd <= reportYmd &&
        (input.closureReason === 'WRITEOFF' || input.closureReason === 'DEAD');

    if (wroteOff && input.writeOff) {
        const asOfWriteOff = computeLoanFinancials(input.amount, input.schedules, reportYmd, {
            ignoreScheduleStatus: true,
        });
        return {
            ...base,
            status: 'S06',
            closedYmd: input.closedYmd,
            outstandingRupees: 0,
            overdueRupees: paiseToRupeesTrunc(asOfWriteOff.overduePaise),
            dpd: asOfWriteOff.dpd,
            writeOffRupees: paiseToRupeesTrunc(toPaise(input.writeOff.amount)),
            writeOffYmd: input.writeOff.ymd,
            writeOffReason: input.closureReason === 'DEAD' ? 'X02' : 'X09',
        };
    }

    if (closedByReportDate) {
        return {
            ...base,
            status: 'S07',
            closedYmd: input.closedYmd,
            outstandingRupees: 0,
            overdueRupees: 0,
            dpd: 0,
            writeOffRupees: null,
            writeOffYmd: null,
            writeOffReason: null,
        };
    }

    return {
        ...base,
        status: live.dpd > 0 ? 'S05' : 'S04',
        closedYmd: null,
        outstandingRupees: paiseToRupeesTrunc(live.outstandingPaise),
        overdueRupees: paiseToRupeesTrunc(live.overduePaise),
        dpd: live.dpd,
        writeOffRupees: null,
        writeOffYmd: null,
        writeOffReason: null,
    };
}
