import { differenceInCalendarDays, format } from 'date-fns';
import { splitRepaymentForDcb, isLegacyNonDemandCollection } from '@/app/lib/dcb-advance-amount';
import { scheduleDueKolkataYmd, type DcbIstReportWindow } from '@/app/lib/dcb-report-ist';
import { parseKolkataAttendanceDateYmd, getKolkataCalendarYmd } from '@/app/lib/branch-lock';

// ─── Utility ─────────────────────────────────────────────────────────────────

const safeNum = (v: unknown): number => {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : 0;
};

function istCalendarDaysLaterMinusEarlier(laterYmd: string, earlierYmd: string): number {
    return differenceInCalendarDays(
        parseKolkataAttendanceDateYmd(laterYmd),
        parseKolkataAttendanceDateYmd(earlierYmd)
    );
}

// ─── Public Types ─────────────────────────────────────────────────────────────

export type DcbScheduleInput = {
    /** Schedule row primary key — used for accurate opening-arrear computation. */
    id?: string;
    dueDate: Date;
    principalDue: unknown;
    principalPaid: unknown;
    interestDue: unknown;
    interestPaid: unknown;
    savingsDue?: unknown;
    savingsPaid?: unknown;
};

export type DcbTransactionLineInput = {
    principalAmount?: unknown;
    interestAmount?: unknown;
    lineTotal?: unknown;
    schedule: { dueDate: Date } | null | undefined;
};

export type DcbTransactionInput = {
    type: string;
    transactionDate: Date;
    principalAmount: unknown;
    interestAmount: unknown;
    amount: unknown;
    collectionType: string | null | undefined;
    openingArrearsPrincipal?: unknown;
    openingArrearsInterest?: unknown;
    currentDemandPrincipal?: unknown;
    currentDemandInterest?: unknown;
    lines: DcbTransactionLineInput[];
};

export type DcbCenterRef = {
    id: string;
    code: string | null;
    name: string | null;
    meetingDay: string | null;
    nextMeetingDate: Date | null;
    branch: { name: string | null; code: string | null } | null;
    fdo: { firstName: string; lastName: string } | null;
};

export type DcbLoanForAggregation = {
    schedules: DcbScheduleInput[];
    transactions: DcbTransactionInput[];
    client: { center: DcbCenterRef | null };
};

export type DcbCenterMetrics = {
    centerId: string;
    branchCode: string;
    branchName: string;
    meetingDate: string;
    centerCode: string;
    centerName: string;
    fdoName: string;
    /** Unpaid P+I on schedules due *before* the report period start (opening stock of arrear). */
    openingArr: number;
    /** Gross scheduled P+I due within [fromYmd, tillYmd]. */
    demand: number;
    /**
     * Total collections applied to current-period demand (on-time + late).
     * Drives Rec % as per PDF: Rec % = currCollection / demand.
     */
    currCollection: number;
    /**
     * Subset of currCollection paid *after* the due date but still within the report window.
     * Per PDF: "collection made towards arrears during current period".
     */
    currArrColl: number;
    /** Collections applied to opening arrears (dues from before the report period). */
    opnArrColl: number;
    /** Collections paid before the installment due date (future installments prepaid). */
    advanceColl: number;
    /** Preclosure / foreclosure amounts. */
    preclosure: number;
    /** currCollection + opnArrColl + advanceColl + preclosure. */
    totalColl: number;
    /**
     * Demand from report-period days that have ALREADY PASSED and were not collected.
     * These are genuine arrears (due date < today).
     */
    currArrear: number;
    /**
     * Demand for TODAY's date within the report period that has not been collected yet.
     * This is NOT an arrear — the collection window is still open. Shown separately in UI.
     */
    todayPending: number;
    /**
     * Total arrear carried forward.
     * Per PDF: Opening Arrear + Current Arrear (includes todayPending for balance accuracy).
     */
    closingArr: number;
    /** (currCollection / demand) × 100, capped at 100. */
    recPercentage: number;
    /** Unpaid savings on schedules due before the report period. */
    savingsOpeningArr: number;
    /** Gross savings due within [fromYmd, tillYmd]. */
    savingsDemand: number;
    /** Savings collected via SAVINGS_COLLECTION transactions within the period. */
    savingsColl: number;
    /** savingsDemand − savingsColl (current period unpaid savings). */
    savingsCurrArrear: number;
    /** savingsOpeningArr + savingsCurrArrear. */
    savingsClosingArr: number;
};

// ─── Internal Classification ──────────────────────────────────────────────────

/**
 * How a single transaction line is classified relative to the report window.
 *
 *  'curr_ontime' — due within window, payment on or before due date   → currCollection
 *  'curr_late'   — due within window, payment after  due date          → currCollection + currArrColl
 *  'opn_arr'     — due before window start (opening arrear installment) → opnArrColl
 *
 *  Returns null when the line is an advance (payment before due date on a future installment).
 */
type DemandLineTier = 'curr_ontime' | 'curr_late' | 'opn_arr';

function classifyLine(
    txDate: Date,
    dueYmd: string,
    fromYmd: string,
    tillYmd: string
): DemandLineTier | null {
    const txYmd = getKolkataCalendarYmd(txDate);

    // Paid before due date → advance (skip demand side)
    if (txYmd < dueYmd) return null;

    // Due before the report window → opening arrear
    if (dueYmd < fromYmd) return 'opn_arr';

    // Due within the report window
    if (dueYmd >= fromYmd && dueYmd <= tillYmd) {
        return txYmd > dueYmd ? 'curr_late' : 'curr_ontime';
    }

    // Due after the window but txYmd >= dueYmd is impossible (txYmd ≤ tillYmd < dueYmd).
    // This edge case doesn't arise in practice; treat as current if it does.
    return 'curr_ontime';
}

type ClassifiedLine = {
    linePi: number;
    tier: DemandLineTier;
};

function buildClassifiedLines(
    tx: DcbTransactionInput,
    fromYmd: string,
    tillYmd: string
): ClassifiedLine[] {
    const out: ClassifiedLine[] = [];

    for (const line of tx.lines) {
        if (!line.schedule?.dueDate) continue;
        const dueYmd = scheduleDueKolkataYmd(new Date(line.schedule.dueDate));
        const tier = classifyLine(tx.transactionDate, dueYmd, fromYmd, tillYmd);
        if (tier === null) continue; // advance line — handled by splitRepaymentForDcb
        const linePi = safeNum(line.principalAmount) + safeNum(line.interestAmount);
        if (linePi <= 0) continue;
        out.push({ linePi, tier });
    }

    // Process current demand before opening arrear so priority is correct
    out.sort((a, b) => {
        const order: Record<DemandLineTier, number> = {
            curr_ontime: 0,
            curr_late: 1,
            opn_arr: 2,
        };
        return order[a.tier] - order[b.tier];
    });

    return out;
}

/**
 * Allocates the demand-side P+I portion of a repayment into the three
 * mutually-exclusive DCB collection sub-buckets.
 *
 *  currCollection accumulates ALL current-demand payments (on-time + late).
 *  currArrColl    accumulates only the late subset.
 *  opnArrColl     accumulates payments against opening arrears.
 */
function allocateDemandSide(
    tx: DcbTransactionInput,
    demandSidePi: number,
    fromYmd: string,
    tillYmd: string
): { currCollection: number; currArrColl: number; opnArrColl: number } {
    let currCollection = 0;
    let currArrColl = 0;
    let opnArrColl = 0;

    if (demandSidePi <= 0) return { currCollection, currArrColl, opnArrColl };

    const lines = buildClassifiedLines(tx, fromYmd, tillYmd);
    let remaining = demandSidePi;

    for (const line of lines) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, line.linePi);

        if (line.tier === 'opn_arr') {
            opnArrColl += take;
        } else {
            // both 'curr_ontime' and 'curr_late' count toward currCollection
            currCollection += take;
            if (line.tier === 'curr_late') {
                // additional flag: this portion was paid after due date
                currArrColl += take;
            }
        }
        remaining -= take;
    }

    // ── Fallback for legacy transactions with no line records ────────────────
    if (remaining > 0 && tx.lines.length === 0) {
        const txOpn = safeNum(tx.openingArrearsPrincipal) + safeNum(tx.openingArrearsInterest);
        const txCur = safeNum(tx.currentDemandPrincipal) + safeNum(tx.currentDemandInterest);

        if (txOpn > 0) {
            const p = Math.min(remaining, txOpn);
            opnArrColl += p;
            remaining -= p;
        }
        if (txCur > 0 && remaining > 0) {
            const p = Math.min(remaining, txCur);
            currCollection += p;
            // Legacy rows don't have per-line timing info; we can't determine
            // on-time vs late, so do not add to currArrColl.
            remaining -= p;
        }
        if (remaining > 0) {
            currCollection += remaining;
        }
    } else if (remaining > 0) {
        // Lines existed but didn't fully absorb the amount — treat overflow as on-time
        currCollection += remaining;
    }

    return { currCollection, currArrColl, opnArrColl };
}

// ─── Schedule helpers ─────────────────────────────────────────────────────────

function unpaidSchedulePi(s: DcbScheduleInput): number {
    const up = Math.max(0, safeNum(s.principalDue) - safeNum(s.principalPaid));
    const ui = Math.max(0, safeNum(s.interestDue) - safeNum(s.interestPaid));
    return up + ui;
}

/**
 * Splits a PRECLOSURE transaction's principal/interest between the portion that settles
 * pre-existing arrear (schedules already overdue as of the closure date) and the portion
 * that closes out not-yet-due installments (the genuine early-closure balance).
 *
 * PRECLOSURE transactions carry no per-schedule `lines` — the whole outstanding balance is
 * collected as one lump sum (see app/api/collections/foreclosure/route.ts, which stores only
 * the total principalAmount/interestAmount) — and by report time every schedule has already
 * been forced to fully-PAID by finalizeClosureCoveredLoan, so schedule.principalPaid/interestPaid
 * can no longer tell us what was still outstanding at the moment of closure. Reconstruct it from
 * REPAYMENT history instead: sum what was paid on each schedule strictly BEFORE the closure
 * (pre-report-period payments via prePeriodPaidBySchedule, plus any in-period REPAYMENT lines
 * dated earlier), subtract from principalDue/interestDue to get what was still outstanding per
 * schedule at closure time, then classify each schedule's outstanding as arrear (due before the
 * closure date) or balance (due on/after) — mirroring computeOutstandingForForeclosure's own
 * arrear split at submission time, which is never persisted for later reporting.
 */
function splitPreclosureArrearVsBalance(
    loan: DcbLoanForAggregation,
    preclosureTx: DcbTransactionInput,
    prePeriodPaidBySchedule: PrePeriodPaidMap | undefined
): { arrearP: number; arrearI: number; balanceP: number; balanceI: number } {
    const closureTime = new Date(preclosureTx.transactionDate).getTime();
    const closureYmd = getKolkataCalendarYmd(new Date(preclosureTx.transactionDate));

    // Paid-before-closure, keyed by schedule due-date (ymd) — lines only carry the schedule's
    // dueDate, not its id, so join on that instead (due dates are unique per loan).
    const paidBeforeClosure = new Map<string, { P: number; I: number }>();
    const addPaid = (dueYmd: string, p: number, i: number) => {
        const cur = paidBeforeClosure.get(dueYmd) ?? { P: 0, I: 0 };
        cur.P += p;
        cur.I += i;
        paidBeforeClosure.set(dueYmd, cur);
    };

    if (prePeriodPaidBySchedule) {
        for (const schedule of loan.schedules) {
            if (!schedule.id) continue;
            const prePaid = prePeriodPaidBySchedule.get(schedule.id);
            if (!prePaid) continue;
            addPaid(scheduleDueKolkataYmd(new Date(schedule.dueDate)), prePaid.P, prePaid.I);
        }
    }

    for (const tx of loan.transactions) {
        if (tx.type !== 'REPAYMENT') continue;
        if (new Date(tx.transactionDate).getTime() >= closureTime) continue;
        for (const line of tx.lines) {
            if (!line.schedule?.dueDate) continue;
            addPaid(
                scheduleDueKolkataYmd(new Date(line.schedule.dueDate)),
                safeNum(line.principalAmount),
                safeNum(line.interestAmount)
            );
        }
    }

    let arrearOutstandingP = 0, arrearOutstandingI = 0;
    let balanceOutstandingP = 0, balanceOutstandingI = 0;
    for (const schedule of loan.schedules) {
        const dueYmd = scheduleDueKolkataYmd(new Date(schedule.dueDate));
        const paid = paidBeforeClosure.get(dueYmd) ?? { P: 0, I: 0 };
        const outstandingP = Math.max(0, safeNum(schedule.principalDue) - paid.P);
        const outstandingI = Math.max(0, safeNum(schedule.interestDue) - paid.I);
        if (dueYmd < closureYmd) {
            arrearOutstandingP += outstandingP;
            arrearOutstandingI += outstandingI;
        } else {
            balanceOutstandingP += outstandingP;
            balanceOutstandingI += outstandingI;
        }
    }

    const txP = safeNum(preclosureTx.principalAmount);
    const txI = safeNum(preclosureTx.interestAmount);
    const totalP = arrearOutstandingP + balanceOutstandingP;
    const totalI = arrearOutstandingI + balanceOutstandingI;

    const arrearP = totalP > 0 ? txP * (arrearOutstandingP / totalP) : 0;
    const arrearI = totalI > 0 ? txI * (arrearOutstandingI / totalI) : 0;

    return { arrearP, arrearI, balanceP: txP - arrearP, balanceI: txI - arrearI };
}

function centerDisplayFields(
    center: DcbCenterRef
): Pick<DcbCenterMetrics, 'branchCode' | 'branchName' | 'meetingDate' | 'centerCode' | 'centerName' | 'fdoName'> {
    return {
        branchCode: center.branch?.code || 'N/A',
        branchName: center.branch?.name || 'N/A',
        meetingDate: center.nextMeetingDate
            ? format(new Date(center.nextMeetingDate), 'dd/MM/yyyy')
            : center.meetingDay || 'N/A',
        centerCode: center.code || 'N/A',
        centerName: `${center.code || ''} - ${center.name || 'Unknown'}`,
        fdoName: center.fdo ? `${center.fdo.firstName} ${center.fdo.lastName}` : 'Unassigned',
    };
}

// ─── Main Aggregation ─────────────────────────────────────────────────────────

/**
 * Pure aggregation: produces per-center DCB metrics aligned to the client
 * DCB Definition document.
 *
 * Column semantics (per PDF):
 *   Opening Arr     = Unpaid P+I on schedules due BEFORE report period start
 *   Demand          = Gross scheduled P+I due within [fromYmd, tillYmd]
 *   Curr Collection = All collections against current-period demand (on-time + late)
 *   Rec %           = (Curr Collection / Demand) × 100, capped at 100
 *   Curr Arr Coll   = Subset of Curr Collection paid after the installment due date
 *   Opn Arr Coll    = Collections against opening arrear installments
 *   Advance Coll    = Collections paid before installment due date (future prepayment)
 *   Preclosure      = Foreclosure / loan preclosure amounts
 *   Total Coll      = Curr Collection + Opn Arr Coll + Advance Coll + Preclosure
 *   Curr Arrear     = Demand − Curr Collection
 *   Closing Arr     = Opening Arrear + Current Arrear  (per PDF formula)
 */
export function aggregateDcbLoansToCenterMetrics(
    loans: DcbLoanForAggregation[],
    ist: DcbIstReportWindow
): DcbCenterMetrics[] {
    const { fromYmd, tillYmd } = ist;
    const centerMap = new Map<string, DcbCenterMetrics>();

    const getRow = (center: DcbCenterRef): DcbCenterMetrics => {
        if (!centerMap.has(center.id)) {
            const meta = centerDisplayFields(center);
            centerMap.set(center.id, {
                centerId: center.id,
                ...meta,
                openingArr: 0,
                demand: 0,
                currCollection: 0,
                currArrColl: 0,
                opnArrColl: 0,
                advanceColl: 0,
                preclosure: 0,
                totalColl: 0,
                currArrear: 0,
                todayPending: 0,
                closingArr: 0,
                recPercentage: 0,
                savingsOpeningArr: 0,
                savingsDemand: 0,
                savingsColl: 0,
                savingsCurrArrear: 0,
                savingsClosingArr: 0,
                // internal-only tracking (removed during finalization)
                _todayScheduledDemand: 0,
            } as any);
        }
        return centerMap.get(center.id)!;
    };

    // ── Pass 1: Opening Arrear + Demand ───────────────────────────────────────
    const todayKolkataYmd = getKolkataCalendarYmd(new Date());
    for (const loan of loans) {
        const center = loan.client.center;
        if (!center) continue;
        const row = getRow(center);

        for (const schedule of loan.schedules) {
            const dueYmd = scheduleDueKolkataYmd(new Date(schedule.dueDate));

            if (dueYmd < fromYmd) {
                // Schedule was due before this period → contributes to Opening Arrear
                row.openingArr += unpaidSchedulePi(schedule);
                row.savingsOpeningArr += Math.max(0, safeNum(schedule.savingsDue) - safeNum(schedule.savingsPaid));
            } else if (dueYmd >= fromYmd && dueYmd <= tillYmd) {
                // Schedule due within this period → Demand (gross, regardless of payment status)
                const schedDemand = safeNum(schedule.principalDue) + safeNum(schedule.interestDue);
                row.demand += schedDemand;
                row.savingsDemand += safeNum(schedule.savingsDue);
                // Track today's scheduled demand separately — it is PENDING, not arrear
                if (dueYmd === todayKolkataYmd) {
                    (row as any)._todayScheduledDemand += schedDemand;
                }
            }
        }
    }

    // ── Pass 2: Collections ───────────────────────────────────────────────────
    for (const loan of loans) {
        const center = loan.client.center;
        if (!center) continue;
        const row = getRow(center);

        for (const tx of loan.transactions) {
            const txDate = new Date(tx.transactionDate);
            const txYmd = getKolkataCalendarYmd(txDate);

            // Only transactions that fall within the report period
            if (txYmd < fromYmd || txYmd > tillYmd) continue;

            // ── PRECLOSURE ────────────────────────────────────────────────────
            if (tx.type === 'PRECLOSURE') {
                const gross =
                    safeNum(tx.amount) > 0
                        ? safeNum(tx.amount)
                        : safeNum(tx.principalAmount) + safeNum(tx.interestAmount);
                row.preclosure += gross;
                continue;
            }

            // ── SAVINGS COLLECTION ────────────────────────────────────────────
            if (tx.type === 'SAVINGS_COLLECTION') {
                row.savingsColl += safeNum(tx.amount);
                continue;
            }

            if (tx.type !== 'REPAYMENT') continue;

            // ── ADVANCE vs DEMAND split ───────────────────────────────────────
            const split = splitRepaymentForDcb({
                transactionDate: tx.transactionDate,
                lines: tx.lines,
                principalAmount: tx.principalAmount,
                interestAmount: tx.interestAmount,
                amount: tx.amount,
                collectionType: tx.collectionType,
            });

            row.advanceColl += split.advanceFromEarlyInstallments;

            // ── Demand-side P+I classification ────────────────────────────────
            if (split.demandSidePrincipalInterest <= 0) continue;

            const alloc = allocateDemandSide(tx, split.demandSidePrincipalInterest, fromYmd, tillYmd);
            row.currCollection += alloc.currCollection;
            row.currArrColl += alloc.currArrColl;
            row.opnArrColl += alloc.opnArrColl;
        }
    }

    // ── Pass 3: Finalize metrics ──────────────────────────────────────────────
    const result = Array.from(centerMap.values()).map((row) => {
        row.openingArr = Math.round(row.openingArr);
        row.demand = Math.round(row.demand);

        // currCollection cannot exceed demand (schedule may have been partially paid
        // before the window opened; cap prevents reporting overcollection)
        row.currCollection = Math.min(Math.round(row.currCollection), row.demand);
        row.currArrColl = Math.min(Math.round(row.currArrColl), row.currCollection);
        row.opnArrColl = Math.round(row.opnArrColl);
        row.advanceColl = Math.round(row.advanceColl);
        row.preclosure = Math.round(row.preclosure);

        // Total unmet demand for the period
        const totalUnmet = Math.max(0, row.demand - row.currCollection);

        // Split unmet demand into:
        //   todayPending  = scheduled for TODAY that hasn't been collected yet (NOT yet arrear)
        //   currArrear    = scheduled for PAST days in the period that was missed (true arrear)
        const todayScheduledDemand = Math.round((row as any)._todayScheduledDemand ?? 0);
        row.todayPending = Math.max(0, Math.min(totalUnmet, todayScheduledDemand));
        row.currArrear   = Math.max(0, totalUnmet - row.todayPending);

        // Closing Arrear = Opening Arrear + all unmet demand − Preclosure
        // Preclosure fully settles outstanding dues so it must reduce closing arrear to 0.
        row.closingArr = Math.max(0, row.openingArr + totalUnmet - row.preclosure);

        // Remove internal tracking field
        delete (row as any)._todayScheduledDemand;

        // Recovery %: how much of demand was collected (capped at 100%)
        row.recPercentage =
            row.demand > 0 ? Math.min(100, (row.currCollection / row.demand) * 100) : 0;

        // Total Collection = all cash received (currArrColl is a subset of currCollection,
        // not added separately to avoid double-counting)
        row.totalColl = Math.round(
            row.currCollection + row.opnArrColl + row.advanceColl + row.preclosure
        );

        // Savings finalization
        row.savingsOpeningArr = Math.round(row.savingsOpeningArr);
        row.savingsDemand = Math.round(row.savingsDemand);
        row.savingsColl = Math.round(row.savingsColl);
        row.savingsCurrArrear = Math.max(0, row.savingsDemand - row.savingsColl);
        row.savingsClosingArr = row.savingsOpeningArr + row.savingsCurrArrear;

        return row;
    });

    // Only include rows with activity
    return result
        .filter(
            (row) =>
                row.openingArr > 0 ||
                row.demand > 0 ||
                row.totalColl > 0 ||
                row.currArrear > 0 ||
                row.savingsOpeningArr > 0 ||
                row.savingsDemand > 0
        )
        .sort((a, b) => a.centerName.localeCompare(b.centerName));
}
// app/lib/actions/reports.ts

import { prisma } from '@/app/lib/prisma';


export type DCBRow = {
  branchName: string;
  reportPeriodIst: string;
  meetingDate: string;
  centerName: string;
  fdoName: string;
  openingArr: number;
  demand: number;
  currCollection: number;
  recPercentage: number;
  currArrColl: number;
  opnArrColl: number;
  advanceColl: number;
  preclosure: number;
  totalColl: number;
  /** Past-period unmet demand (true arrear). */
  currArrear: number;
  /** Today's scheduled demand not yet collected — pending, NOT arrear. */
  todayPending: number;
  closingArr: number;
};

type DateWiseMetrics = {
  centerId: string;
  meetingDate: string;
  branchCode: string;
  branchName: string;
  centerCode: string;
  centerName: string;
  fdoName: string;

  // ── Opening Arrear (unpaid P+I on schedules due before this period) ────────
  openingArr: number;
  openingArrPrincipal: number;
  openingArrInterest: number;

  // ── Current Demand (scheduled P+I for this date/period) ───────────────────
  demand: number;
  demandPrincipal: number;
  demandInterest: number;

  // ── Collections — 5 categories, each with P+I split ───────────────────────
  /** Collected toward pre-period opening arrear (before loan maturity). */
  arrearCollPrincipal: number;
  arrearCollInterest: number;
  /** Collected toward current-period demand. */
  currDemandCollPrincipal: number;
  currDemandCollInterest: number;
  /** Collected toward future (not-yet-due) installments. */
  advanceCollPrincipal: number;
  advanceCollInterest: number;
  advanceColl: number;              // combined advance (backward compat)
  /** PRECLOSURE type transaction amounts. */
  preclosurePrincipal: number;
  preclosureInterest: number;
  preclosure: number;               // combined preclosure (backward compat)
  /** Collected toward arrear AFTER the loan's final maturity date. */
  odArrearCollPrincipal: number;
  odArrearCollInterest: number;
  /** Sum of all five collection categories. */
  totalCollPrincipal: number;
  totalCollInterest: number;
  totalColl: number;

  // ── Backward-compat aliases (used by aggregateDcbLoansByMeetingDate) ───────
  currCollection: number;            // = currDemandCollPrincipal + currDemandCollInterest
  currCollectionPrincipal: number;
  currCollectionInterest: number;
  currArrColl: number;               // = arrearCollP + arrearCollI
  opnArrColl: number;                // = odArrearCollP + odArrearCollI

  // ── Current Arrear (Current Demand − Current Demand Collection) ───────────
  currArrear: number;
  currArrearPrincipal: number;
  currArrearInterest: number;
  /** Today's unmet demand — pending, NOT an arrear (collection window still open). */
  todayPending: number;
  todayPendingPrincipal: number;
  todayPendingInterest: number;

  // ── Closing Arrear ────────────────────────────────────────────────────────
  closingArr: number;
  closingArrPrincipal: number;
  closingArrInterest: number;

  /** RR % = (Curr Demand Coll P + I) / (Curr Demand P + I) × 100. */
  recPercentage: number;
};



// ========== MAIN AGGREGATION FUNCTION ==========
export function aggregateDcbLoansByMeetingDate(
  loans: DcbLoanForAggregation[],
  fromYmd: string,
  tillYmd: string
): DateWiseMetrics[] {
  // Map to store metrics by center + meeting date
  const dateWiseMap = new Map<string, DateWiseMetrics>();
  const getKey = (centerId: string, meetingDate: string) => `${centerId}|${meetingDate}`;
  
  // Collect all meeting dates for each center within the range
  const centerMeetingDates = new Map<string, string[]>();
  
  for (const loan of loans) {
    const center = loan.client.center;
    if (!center || !center.meetingDay) continue;
    
    if (!centerMeetingDates.has(center.id)) {
      const meetings: string[] = [];
      let currentDate = new Date(fromYmd);
      const endDate = new Date(tillYmd);
      
      // Map meeting day string to day number
      const dayMap: Record<string, number> = {
        'Sunday': 0, 'Monday': 1, 'Tuesday': 2, 'Wednesday': 3,
        'Thursday': 4, 'Friday': 5, 'Saturday': 6
      };
      const targetDay = dayMap[center.meetingDay];
      
      if (targetDay !== undefined) {
        // Find first meeting date
        while (currentDate <= endDate) {
          if (currentDate.getDay() === targetDay) {
            meetings.push(format(currentDate, 'yyyy-MM-dd'));
          }
          currentDate.setDate(currentDate.getDate() + 1);
        }
      }
      
      centerMeetingDates.set(center.id, meetings);
      
      // Initialize metrics for each meeting date
      const meta = centerDisplayFields(center);
      for (const meetingDate of meetings) {
        const key = getKey(center.id, meetingDate);
        dateWiseMap.set(key, {
          centerId: center.id,
          meetingDate: format(new Date(meetingDate), 'dd/MM/yyyy'),
          branchCode: meta.branchCode,
          branchName: meta.branchName,
          centerCode: meta.centerCode,
          centerName: meta.centerName,
          fdoName: meta.fdoName,
          openingArr: 0, openingArrPrincipal: 0, openingArrInterest: 0,
          demand: 0, demandPrincipal: 0, demandInterest: 0,
          arrearCollPrincipal: 0, arrearCollInterest: 0,
          currDemandCollPrincipal: 0, currDemandCollInterest: 0,
          advanceCollPrincipal: 0, advanceCollInterest: 0, advanceColl: 0,
          preclosurePrincipal: 0, preclosureInterest: 0, preclosure: 0,
          odArrearCollPrincipal: 0, odArrearCollInterest: 0,
          totalCollPrincipal: 0, totalCollInterest: 0, totalColl: 0,
          currCollection: 0, currCollectionPrincipal: 0, currCollectionInterest: 0,
          currArrColl: 0, opnArrColl: 0,
          currArrear: 0, currArrearPrincipal: 0, currArrearInterest: 0,
          todayPending: 0, todayPendingPrincipal: 0, todayPendingInterest: 0,
          closingArr: 0, closingArrPrincipal: 0, closingArrInterest: 0,
          recPercentage: 0,
        });
      }
    }
  }
  
  // Process each loan
  for (const loan of loans) {
    const center = loan.client.center;
    if (!center) continue;
    
    const meetingDates = centerMeetingDates.get(center.id);
    if (!meetingDates || meetingDates.length === 0) continue;
    
    // For each schedule, find which meeting period it belongs to
    for (const schedule of loan.schedules) {
      const dueDate = new Date(schedule.dueDate);
      const dueYmd = format(dueDate, 'yyyy-MM-dd');
      
      // Find the meeting date for this schedule
      let targetMeetingDate: string | null = null;
      for (let i = 0; i < meetingDates.length; i++) {
        const meetingDate = meetingDates[i];
        const nextMeetingDate = meetingDates[i + 1] || tillYmd;
        
        if (dueYmd >= meetingDate && dueYmd < nextMeetingDate) {
          targetMeetingDate = meetingDate;
          break;
        }
      }
      
      if (!targetMeetingDate) continue;
      
      const key = getKey(center.id, targetMeetingDate);
      const row = dateWiseMap.get(key);
      if (!row) continue;
      
      if (dueYmd < targetMeetingDate) {
        // Due before meeting → opening arrear
        row.openingArr += unpaidSchedulePi(schedule);
      } else if (dueYmd >= targetMeetingDate) {
        // Due in this period → demand
        row.demand += safeNum(schedule.principalDue) + safeNum(schedule.interestDue);
      }
    }
    
    // Process transactions
    for (const tx of loan.transactions) {
      const txDate = new Date(tx.transactionDate);
      const txYmd = format(txDate, 'yyyy-MM-dd');
      
      // Find which meeting period this transaction belongs to
      let targetMeetingDate: string | null = null;
      for (let i = 0; i < meetingDates.length; i++) {
        const meetingDate = meetingDates[i];
        const nextMeetingDate = meetingDates[i + 1] || tillYmd;
        
        if (txYmd >= meetingDate && txYmd < nextMeetingDate) {
          targetMeetingDate = meetingDate;
          break;
        }
      }
      
      if (!targetMeetingDate) continue;
      
      const key = getKey(center.id, targetMeetingDate);
      const row = dateWiseMap.get(key);
      if (!row) continue;
      
      if (tx.type === 'PRECLOSURE') {
        const gross = safeNum(tx.amount) > 0 ? safeNum(tx.amount) : safeNum(tx.principalAmount) + safeNum(tx.interestAmount);
        row.preclosure += gross;
        continue;
      }
      
      if (tx.type !== 'REPAYMENT') continue;
      
      const periodEnd = meetingDates[meetingDates.indexOf(targetMeetingDate) + 1] || tillYmd;
      
      const split = splitRepaymentForDcb({
        transactionDate: tx.transactionDate,
        lines: tx.lines.map(line => ({
          principalAmount: line.principalAmount,
          interestAmount: line.interestAmount,
          schedule: line.schedule
        })),
        principalAmount: tx.principalAmount,
        interestAmount: tx.interestAmount,
        amount: tx.amount,
        collectionType: tx.collectionType,
      });
      
      row.advanceColl += split.advanceFromEarlyInstallments;
      
      if (split.demandSidePrincipalInterest > 0) {
        const alloc = allocateDemandSide(tx, split.demandSidePrincipalInterest, targetMeetingDate, periodEnd);
        row.currCollection += alloc.currCollection;
        row.currArrColl += alloc.currArrColl;
        row.opnArrColl += alloc.opnArrColl;
      }
    }
  }
  
  // Finalize metrics
  const todayKolkataYmdMeeting = getKolkataCalendarYmd(new Date());
  const result = Array.from(dateWiseMap.values()).map((row) => {
    row.openingArr = Math.round(row.openingArr);
    row.demand = Math.round(row.demand);
    row.currCollection = Math.min(Math.round(row.currCollection), row.demand);
    row.currArrColl = Math.min(Math.round(row.currArrColl), row.currCollection);
    row.opnArrColl = Math.round(row.opnArrColl);
    row.advanceColl = Math.round(row.advanceColl);
    row.preclosure = Math.round(row.preclosure);
    const totalUnmet = Math.max(0, row.demand - row.currCollection);
    // For meeting-date rows: if the meeting date IS today, all unmet = today's pending
    // (the meeting hasn't ended). If it's a past date, all unmet = true arrear.
    const meetingYmd = row.meetingDate.split('/').reverse().join('-'); // dd/MM/yyyy → yyyy-MM-dd
    if (meetingYmd === todayKolkataYmdMeeting) {
      row.todayPending = totalUnmet;
      row.currArrear   = 0;
    } else {
      row.todayPending = 0;
      row.currArrear   = totalUnmet;
    }
    row.closingArr = row.openingArr + totalUnmet; // total unsettled balance
    row.recPercentage = row.demand > 0 ? Math.min(100, (row.currCollection / row.demand) * 100) : 0;
    row.totalColl = Math.round(row.currCollection + row.opnArrColl + row.advanceColl + row.preclosure);
    return row;
  });

  return result.filter(row =>
    row.openingArr > 0 || row.demand > 0 || row.totalColl > 0 || row.currArrear > 0 || row.todayPending > 0
  ).sort((a, b) => {
    const dateCompare = a.meetingDate.localeCompare(b.meetingDate);
    if (dateCompare !== 0) return dateCompare;
    return a.centerName.localeCompare(b.centerName);
  });
}


/**
 * Date-wise DCB aggregation: one row per (center, calendar date) where that date
 * has scheduled demand OR actual collections.
 *
 * Column semantics (per DCB spec):
 *   Opening Arr P+I     = Unpaid P+I rolled forward from previous row's Closing Arrear
 *   Current Demand P+I  = Gross P+I scheduled due on this specific date
 *   Total Demand P+I    = Opening Arrear + Current Demand  (computed in UI)
 *   Arrear Coll P+I     = Collected toward pre-period dues (before loan maturity)
 *   Curr Demand Coll P+I= Collected toward this date's demand
 *   Advance Coll P+I    = Collected toward future (not-yet-due) installments
 *   Preclosure P+I      = PRECLOSURE transaction amounts
 *   OD Arrear Coll P+I  = Collected toward arrear AFTER the loan's maturity date
 *   Total Coll P+I      = Sum of all five collection categories
 *   Current Arrear P+I  = Current Demand − Curr Demand Collection
 *   Closing Arr P+I     = Opening Arrear + Curr Arrear − Arrear Coll − OD Arrear Coll
 *   RR %                = (Curr Demand Coll P+I) / (Current Demand P+I) × 100
 */
/**
 * Pre-period paid amounts keyed by schedule ID.
 * Tells us how much was paid toward each schedule BEFORE the report period started.
 * Used to compute the correct opening arrear (schedule.principalPaid is contaminated
 * by payments made during the report period, so we can't use it directly).
 */
export type PrePeriodPaidMap = Map<string, { P: number; I: number }>;

export function aggregateDcbByCalendarDate(
  loans: DcbLoanForAggregation[],
  fromYmd: string,
  tillYmd: string,
  prePeriodPaidBySchedule?: PrePeriodPaidMap
): DateWiseMetrics[] {
  const map = new Map<string, DateWiseMetrics>(); // key: centerId|dateYmd

  // ── Step 1: Opening Arrear P+I per center (unpaid before fromYmd) ─────────
  // IMPORTANT: schedule.principalPaid is a running total that includes payments
  // made WITHIN the report period. We must use the pre-period paid map when
  // available to get the true arrear as of the START of fromYmd.
  const centerOpeningArrP = new Map<string, number>();
  const centerOpeningArrI = new Map<string, number>();
  for (const loan of loans) {
    const center = loan.client.center;
    if (!center) continue;
    for (const schedule of loan.schedules) {
      const dueYmd = scheduleDueKolkataYmd(new Date(schedule.dueDate));
      if (dueYmd < fromYmd) {
        let unp: number;
        let uni: number;
        if (prePeriodPaidBySchedule && schedule.id) {
          // Use exact pre-period payments — accurate even when period payments
          // toward this schedule exist (e.g., arrear collected on the fromYmd date)
          const prePaid = prePeriodPaidBySchedule.get(schedule.id);
          unp = Math.max(0, safeNum(schedule.principalDue) - (prePaid?.P ?? 0));
          uni = Math.max(0, safeNum(schedule.interestDue)  - (prePaid?.I ?? 0));
        } else {
          // Fallback: schedule.principalPaid (includes period payments → may understate)
          unp = Math.max(0, safeNum(schedule.principalDue) - safeNum(schedule.principalPaid));
          uni = Math.max(0, safeNum(schedule.interestDue)  - safeNum(schedule.interestPaid));
        }
        centerOpeningArrP.set(center.id, (centerOpeningArrP.get(center.id) ?? 0) + unp);
        centerOpeningArrI.set(center.id, (centerOpeningArrI.get(center.id) ?? 0) + uni);
      }
    }
  }

  const getOrCreate = (center: DcbCenterRef, dateYmd: string): DateWiseMetrics => {
    const key = `${center.id}|${dateYmd}`;
    if (!map.has(key)) {
      const meta = centerDisplayFields(center);
      const oaP = Math.round(centerOpeningArrP.get(center.id) ?? 0);
      const oaI = Math.round(centerOpeningArrI.get(center.id) ?? 0);
      map.set(key, {
        centerId: center.id,
        meetingDate: format(parseKolkataAttendanceDateYmd(dateYmd), 'dd/MM/yyyy'),
        branchCode: meta.branchCode,
        branchName: meta.branchName,
        centerCode: meta.centerCode,
        centerName: meta.centerName,
        fdoName: meta.fdoName,
        openingArr: oaP + oaI, openingArrPrincipal: oaP, openingArrInterest: oaI,
        demand: 0, demandPrincipal: 0, demandInterest: 0,
        arrearCollPrincipal: 0, arrearCollInterest: 0,
        currDemandCollPrincipal: 0, currDemandCollInterest: 0,
        advanceCollPrincipal: 0, advanceCollInterest: 0, advanceColl: 0,
        preclosurePrincipal: 0, preclosureInterest: 0, preclosure: 0,
        odArrearCollPrincipal: 0, odArrearCollInterest: 0,
        totalCollPrincipal: 0, totalCollInterest: 0, totalColl: 0,
        currCollection: 0, currCollectionPrincipal: 0, currCollectionInterest: 0,
        currArrColl: 0, opnArrColl: 0,
        currArrear: 0, currArrearPrincipal: 0, currArrearInterest: 0,
        todayPending: 0, todayPendingPrincipal: 0, todayPendingInterest: 0,
        closingArr: 0, closingArrPrincipal: 0, closingArrInterest: 0,
        recPercentage: 0,
      });
    }
    return map.get(`${center.id}|${dateYmd}`)!;
  };

  // ── Step 2: Current Demand from schedules due within [fromYmd, tillYmd] ───
  for (const loan of loans) {
    const center = loan.client.center;
    if (!center) continue;
    for (const schedule of loan.schedules) {
      const dueYmd = scheduleDueKolkataYmd(new Date(schedule.dueDate));
      if (dueYmd >= fromYmd && dueYmd <= tillYmd) {
        const row = getOrCreate(center, dueYmd);
        const schedP = safeNum(schedule.principalDue);
        const schedI = safeNum(schedule.interestDue);
        row.demandPrincipal += schedP;
        row.demandInterest  += schedI;
        row.demand          += schedP + schedI;
      }
    }
  }

  // ── Step 3: Collections (keyed by transaction date) ───────────────────────
  for (const loan of loans) {
    const center = loan.client.center;
    if (!center) continue;

    // Loan maturity = last schedule's due date (used to identify OD Arrear collections)
    const maturityYmd = loan.schedules.length > 0
      ? loan.schedules.reduce((mx, s) => {
          const y = scheduleDueKolkataYmd(new Date(s.dueDate));
          return y > mx ? y : mx;
        }, '0000-00-00')
      : '9999-12-31';

    for (const tx of loan.transactions) {
      const txYmd = getKolkataCalendarYmd(new Date(tx.transactionDate));
      if (txYmd < fromYmd || txYmd > tillYmd) continue;

      const row = getOrCreate(center, txYmd);
      const isPostMaturity = txYmd > maturityYmd;

      // ── Any loan closure (Foreclosure/Pre-Closure, or Close Loans tab — DEAD/WRITEOFF/
      // OTHERS alike) ─────────────────────────────────────────────────────────────────
      // Whatever cash was actually collected (tx.principalAmount/interestAmount — never
      // includes the waiver, which lives only on LoanClosureRecord.principalWaiver/
      // interestWaiver) is split between arrear settled (schedules already overdue at
      // closure — counted as Arrear Coll) and the remaining early-closure balance
      // (Preclosure column) — see splitPreclosureArrearVsBalance. This applies regardless
      // of closure reason: the waiver portion (never part of this transaction's amount)
      // still shows separately via getDCBData's Write-Off waiver columns.
      const isCashClosure = tx.type === 'PRECLOSURE' || tx.type === 'WRITEOFF';
      if (isCashClosure) {
        const txP = safeNum(tx.principalAmount);
        const txI = safeNum(tx.interestAmount);
        // If only `amount` is stored (no P/I breakdown), there's nothing to split against
        // schedules — treat entire amount as principal, same as before this fix.
        if (txP + txI > 0) {
          const split = splitPreclosureArrearVsBalance(loan, tx, prePeriodPaidBySchedule);
          row.arrearCollPrincipal += split.arrearP;
          row.arrearCollInterest  += split.arrearI;
          row.preclosurePrincipal += split.balanceP;
          row.preclosureInterest  += split.balanceI;
        } else {
          row.preclosurePrincipal += safeNum(tx.amount);
        }
        continue;
      }

      if (tx.type !== 'REPAYMENT') continue;

      // ── REPAYMENT — per-line classification ─────────────────────────────────
      if (tx.lines.length > 0) {
        for (const line of tx.lines) {
          if (!line.schedule?.dueDate) continue;
          const schedDueYmd = scheduleDueKolkataYmd(new Date(line.schedule.dueDate));
          const lP = safeNum(line.principalAmount);
          const lI = safeNum(line.interestAmount);
          if (lP + lI <= 0) continue;

          if (schedDueYmd > txYmd) {
            // Future installment paid early → Advance Collection
            row.advanceCollPrincipal += lP;
            row.advanceCollInterest  += lI;
          } else if (schedDueYmd === txYmd) {
            // Paid on the installment's own due date → Current Demand Collection
            row.currDemandCollPrincipal += lP;
            row.currDemandCollInterest  += lI;
          } else {
            // Paid after the due date (past installment)
            if (isPostMaturity) {
              // Transaction date is beyond the loan's last scheduled installment → OD Arrear
              row.odArrearCollPrincipal += lP;
              row.odArrearCollInterest  += lI;
            } else {
              // Normal arrear collection (before maturity, toward a past-due installment)
              row.arrearCollPrincipal += lP;
              row.arrearCollInterest  += lI;
            }
          }
        }
      } else {
        // ── Legacy transactions without line records ──────────────────────────
        const txP = safeNum(tx.principalAmount);
        const txI = safeNum(tx.interestAmount);
        const pi  = txP + txI;
        if (pi <= 0) continue;

        if (isLegacyNonDemandCollection(tx.collectionType)) {
          row.advanceCollPrincipal += txP;
          row.advanceCollInterest  += txI;
        } else if (isPostMaturity) {
          row.odArrearCollPrincipal += txP;
          row.odArrearCollInterest  += txI;
        } else {
          // Use snapshot fields to distinguish arrear vs current demand
          const hasOpeningArrear =
            safeNum(tx.openingArrearsPrincipal) + safeNum(tx.openingArrearsInterest) > 0;
          if (hasOpeningArrear) {
            row.arrearCollPrincipal += txP;
            row.arrearCollInterest  += txI;
          } else {
            row.currDemandCollPrincipal += txP;
            row.currDemandCollInterest  += txI;
          }
        }
      }
    }
  }

  // dd/MM/yyyy → yyyy-MM-dd helper for sorting / today comparison
  const toYmd = (dmy: string) => {
    const [d, m, y] = dmy.split('/');
    return `${y}-${m}-${d}`;
  };

  // ── Step 4: Finalize per-row computed fields ──────────────────────────────
  const todayYmd = getKolkataCalendarYmd(new Date());

  for (const row of map.values()) {
    row.openingArrPrincipal = Math.round(row.openingArrPrincipal);
    row.openingArrInterest  = Math.round(row.openingArrInterest);
    row.openingArr          = row.openingArrPrincipal + row.openingArrInterest;

    row.demandPrincipal = Math.round(row.demandPrincipal);
    row.demandInterest  = Math.round(row.demandInterest);
    row.demand          = row.demandPrincipal + row.demandInterest;

    row.arrearCollPrincipal     = Math.round(row.arrearCollPrincipal);
    row.arrearCollInterest      = Math.round(row.arrearCollInterest);
    // Cap current demand collection to demand amount
    row.currDemandCollPrincipal = Math.min(Math.round(row.currDemandCollPrincipal), row.demandPrincipal);
    row.currDemandCollInterest  = Math.min(Math.round(row.currDemandCollInterest),  row.demandInterest);
    row.advanceCollPrincipal    = Math.round(row.advanceCollPrincipal);
    row.advanceCollInterest     = Math.round(row.advanceCollInterest);
    row.preclosurePrincipal     = Math.round(row.preclosurePrincipal);
    row.preclosureInterest      = Math.round(row.preclosureInterest);
    row.odArrearCollPrincipal   = Math.round(row.odArrearCollPrincipal);
    row.odArrearCollInterest    = Math.round(row.odArrearCollInterest);

    // Combined backward-compat fields
    row.advanceColl  = row.advanceCollPrincipal + row.advanceCollInterest;
    row.preclosure   = row.preclosurePrincipal  + row.preclosureInterest;
    row.currArrColl  = row.arrearCollPrincipal  + row.arrearCollInterest;
    row.opnArrColl   = row.odArrearCollPrincipal + row.odArrearCollInterest;
    row.currCollection          = row.currDemandCollPrincipal + row.currDemandCollInterest;
    row.currCollectionPrincipal = row.currDemandCollPrincipal;
    row.currCollectionInterest  = row.currDemandCollInterest;

    // Total Collection = all five categories
    row.totalCollPrincipal = row.arrearCollPrincipal + row.currDemandCollPrincipal
      + row.advanceCollPrincipal + row.preclosurePrincipal + row.odArrearCollPrincipal;
    row.totalCollInterest  = row.arrearCollInterest  + row.currDemandCollInterest
      + row.advanceCollInterest  + row.preclosureInterest  + row.odArrearCollInterest;
    row.totalColl = row.totalCollPrincipal + row.totalCollInterest;

    // Current Arrear = Current Demand − Current Demand Collection (per spec)
    const rawCurrArrP = Math.max(0, row.demandPrincipal - row.currDemandCollPrincipal);
    const rawCurrArrI = Math.max(0, row.demandInterest  - row.currDemandCollInterest);

    const rowDateYmd = toYmd(row.meetingDate);
    if (rowDateYmd === todayYmd) {
      // Today's unmet demand is "pending" — collection window still open
      row.todayPendingPrincipal = rawCurrArrP;
      row.todayPendingInterest  = rawCurrArrI;
      row.todayPending          = rawCurrArrP + rawCurrArrI;
      row.currArrearPrincipal   = 0;
      row.currArrearInterest    = 0;
      row.currArrear            = 0;
    } else {
      row.todayPendingPrincipal = 0;
      row.todayPendingInterest  = 0;
      row.todayPending          = 0;
      row.currArrearPrincipal   = rawCurrArrP;
      row.currArrearInterest    = rawCurrArrI;
      row.currArrear            = rawCurrArrP + rawCurrArrI;
    }

    // RR % = Curr Demand Collection / Current Demand × 100
    const currDmdTotal     = row.demandPrincipal + row.demandInterest;
    const currDmdCollTotal = row.currDemandCollPrincipal + row.currDemandCollInterest;
    row.recPercentage = currDmdTotal > 0
      ? Math.min(100, (currDmdCollTotal / currDmdTotal) * 100)
      : 0;
  }

  // ── Step 5: Rolling Opening Arrear = previous row's Closing Arrear (per center) ──
  const centerRowMap = new Map<string, DateWiseMetrics[]>();
  for (const row of map.values()) {
    if (row.openingArr > 0 || row.demand > 0 || row.totalColl > 0) {
      const bucket = centerRowMap.get(row.centerId) ?? [];
      bucket.push(row);
      centerRowMap.set(row.centerId, bucket);
    }
  }

  const result: DateWiseMetrics[] = [];
  for (const rows of centerRowMap.values()) {
    rows.sort((a, b) => toYmd(a.meetingDate).localeCompare(toYmd(b.meetingDate)));

    let rollingP = rows[0].openingArrPrincipal;
    let rollingI = rows[0].openingArrInterest;

    for (const row of rows) {
      row.openingArrPrincipal = Math.round(rollingP);
      row.openingArrInterest  = Math.round(rollingI);
      row.openingArr          = row.openingArrPrincipal + row.openingArrInterest;

      // Closing Arrear (per spec):
      //   = Opening Arrear + Current Arrear − Arrear Coll − OD Arrear Coll − Preclosure
      // Preclosure fully settles outstanding dues (arrear + demand + advance), so it must
      // be subtracted here — otherwise closing arrear stays non-zero after foreclosure.
      // Include todayPending in the total unmet (it will be arrear if uncollected by EOD)
      const totalUnmetP = row.currArrearPrincipal + row.todayPendingPrincipal;
      const totalUnmetI = row.currArrearInterest  + row.todayPendingInterest;
      row.closingArrPrincipal = Math.max(0, Math.round(
        row.openingArrPrincipal + totalUnmetP
        - row.arrearCollPrincipal - row.odArrearCollPrincipal
        - row.preclosurePrincipal
      ));
      row.closingArrInterest = Math.max(0, Math.round(
        row.openingArrInterest  + totalUnmetI
        - row.arrearCollInterest  - row.odArrearCollInterest
        - row.preclosureInterest
      ));
      row.closingArr = row.closingArrPrincipal + row.closingArrInterest;

      rollingP = row.closingArrPrincipal;
      rollingI = row.closingArrInterest;
      result.push(row);
    }
  }

  return result.sort((a, b) => {
    const keyA = `${toYmd(a.meetingDate)}_${a.centerName}`;
    const keyB = `${toYmd(b.meetingDate)}_${b.centerName}`;
    return keyA.localeCompare(keyB);
  });
}



