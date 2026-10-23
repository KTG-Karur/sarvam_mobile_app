import { addDays } from 'date-fns';

/**
 * Mirrors the arrears/current-due windowing arithmetic in
 * `app/api/collections/bulk-collection/route.ts` GET (lines ~88-171) exactly:
 * raw-accumulate remaining principal/interest across schedules, round once at
 * the end. Intentionally uses server-local `Date` (not IST-aware) to match
 * Bulk bit-for-bit. Do NOT route this through `classifyDemandBreakdown` in
 * `demand-calculation.ts` — that function rounds per-schedule (sum-then-round
 * vs round-then-sum diverge at the paisa level) and is IST-aware for a
 * different feature (Demand Collection). Keep these two helpers separate.
 */

export type DueWindowScheduleInput = {
    dueDate: Date;
    principalDue: number;
    principalPaid: number;
    interestDue: number;
    interestPaid: number;
};

export type DueWindowResult = {
    arrearsPrincipal: number;
    arrearsInterest: number;
    totalArrears: number;
    currentDuePrincipal: number;
    currentDueInterest: number;
    totalCurrentDue: number;
    totalDue: number;
};

/**
 * How many days past the collection date still count as "Current Due".
 * Non-daily loans keep the 5-day lookahead (a collection a few days ahead of the meeting
 * still covers that meeting's installment). A DAILY loan has an installment every working
 * day, so the same lookahead would pull in the next 5 installments and show a member who is
 * fully paid up to (or past) the collection date as owing — daily loans only owe up to the
 * collection date itself.
 */
export function upcomingWindowDays(frequency: string | null | undefined): number {
    return frequency?.trim().toUpperCase() === 'DAILY' ? 0 : 5;
}

export function computeDueWindow(
    schedules: DueWindowScheduleInput[],
    collectionDate: Date,
    frequency?: string | null
): DueWindowResult {
    const windowStart = new Date(collectionDate);
    windowStart.setHours(0, 0, 0, 0);
    const upcomingWindowEnd = addDays(windowStart, upcomingWindowDays(frequency));

    let arrearsPrincipal = 0;
    let arrearsInterest = 0;
    let currentDuePrincipal = 0;
    let currentDueInterest = 0;

    for (const schedule of schedules) {
        const scheduleDueDate = new Date(schedule.dueDate);
        scheduleDueDate.setHours(0, 0, 0, 0);

        const principalRemaining = schedule.principalDue - (schedule.principalPaid || 0);
        const interestRemaining = schedule.interestDue - (schedule.interestPaid || 0);

        if (scheduleDueDate < windowStart) {
            arrearsPrincipal += principalRemaining;
            arrearsInterest += interestRemaining;
        } else if (scheduleDueDate >= windowStart && scheduleDueDate <= upcomingWindowEnd) {
            currentDuePrincipal += principalRemaining;
            currentDueInterest += interestRemaining;
        }
    }

    const totalArrears = arrearsPrincipal + arrearsInterest;
    const totalCurrentDue = currentDuePrincipal + currentDueInterest;
    const totalDue = totalArrears + totalCurrentDue;

    return {
        arrearsPrincipal: Number(arrearsPrincipal.toFixed(2)),
        arrearsInterest: Number(arrearsInterest.toFixed(2)),
        totalArrears: Number(totalArrears.toFixed(2)),
        currentDuePrincipal: Number(currentDuePrincipal.toFixed(2)),
        currentDueInterest: Number(currentDueInterest.toFixed(2)),
        totalCurrentDue: Number(totalCurrentDue.toFixed(2)),
        totalDue: Number(totalDue.toFixed(2)),
    };
}
