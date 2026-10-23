import { prisma } from '@/app/lib/prisma';
import { Prisma } from '@prisma/client';

function toNum(v: unknown): number {
    if (v === null || v === undefined) return 0;
    if (typeof v === 'bigint') return Number(v);
    if (v instanceof Prisma.Decimal) return Number(v);
    return Number(v) || 0;
}

const ARREAR_SCHEDULE_STATUSES = ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] as const;

/**
 * Opening arrears strictly BEFORE `cutoffDayStartUtc`: unpaid principal/interest on schedules
 * whose dueDate falls before the cutoff. Same-day schedules are today's demand, not arrears —
 * matches the "daysPastDue < 1 is not yet an arrear" rule in getAgewiseArrearData
 * (app/lib/actions/reports.ts) and getArrearDemandSheetData (app/lib/actions/demand.ts).
 */
export async function computeOpeningArrearsByLoan(
    loanIds: string[],
    cutoffDayStartUtc: Date
): Promise<Map<string, { principal: number; interest: number }>> {
    const result = new Map<string, { principal: number; interest: number }>();
    if (loanIds.length === 0) return result;

    const schedules = await prisma.loanSchedule.findMany({
        where: {
            loanId: { in: loanIds },
            dueDate: { lt: cutoffDayStartUtc },
            status: { in: [...ARREAR_SCHEDULE_STATUSES] },
        },
        select: { loanId: true, principalDue: true, principalPaid: true, interestDue: true, interestPaid: true },
    });

    for (const s of schedules) {
        const entry = result.get(s.loanId) ?? { principal: 0, interest: 0 };
        entry.principal += Math.max(0, toNum(s.principalDue) - toNum(s.principalPaid));
        entry.interest += Math.max(0, toNum(s.interestDue) - toNum(s.interestPaid));
        result.set(s.loanId, entry);
    }
    return result;
}

/**
 * Full remaining loan balance — NOT date-windowed. Principal comes straight off the Loan
 * row; interest is summed across ALL of that loan's schedules (past, current due, and
 * not-yet-due future installments), unlike the arrears helper above which only looks
 * strictly before a cutoff.
 */
export async function computeOutstandingBalance(
    loans: { id: string; amount: Prisma.Decimal | number; principalPaid: Prisma.Decimal | number }[]
): Promise<Map<string, { principal: number; interest: number }>> {
    const result = new Map<string, { principal: number; interest: number }>();
    if (loans.length === 0) return result;

    for (const loan of loans) {
        result.set(loan.id, {
            principal: Math.max(0, toNum(loan.amount) - toNum(loan.principalPaid)),
            interest: 0,
        });
    }

    type InterestRow = { loan_id: string; interest: unknown };
    const loanIds = loans.map((l) => l.id);
    const interestRows = await prisma.$queryRaw<InterestRow[]>(Prisma.sql`
        SELECT
            s."loanId" AS loan_id,
            COALESCE(SUM(GREATEST(s."interestDue" - s."interestPaid", 0)), 0) AS interest
        FROM "loan_schedules" s
        WHERE s."loanId" IN (${Prisma.join(loanIds)})
        GROUP BY s."loanId"
    `);

    for (const row of interestRows) {
        const entry = result.get(row.loan_id);
        if (entry) entry.interest = toNum(row.interest);
    }
    return result;
}

/**
 * Per-day opening-arrears time series for a displayed date range, as ONE grouped raw-SQL
 * query (bucketed by IST calendar day) plus an ascending cumulative-sum pass in JS — avoids
 * issuing one arrears query per displayed day. `rangeDays` must be ascending YYYY-MM-DD keys.
 * arrearDue(day) = sum of all unpaid-schedule buckets with a dueDate strictly before
 * min(day, todayYmd) — capped at today's real calendar date, matching
 * computeOpeningArrearsByLoan's cutoff semantics. Without the cap, a row for a future date
 * (e.g. tomorrow) would treat an even-later row's own not-yet-due demand as if it had already
 * gone unpaid and become an arrear, when in reality nothing can be "overdue" before it's even
 * due — the schedule's PENDING status alone (used by the underlying query) doesn't distinguish
 * "not yet due" from "missed."
 */
export async function computeArrearDueTimeSeries(
    bIds: string[] | null,
    centerId: string | null,
    rangeDays: string[],
    todayYmd: string
): Promise<Map<string, { principal: number; interest: number }>> {
    const resultMap = new Map<string, { principal: number; interest: number }>();
    if (rangeDays.length === 0) return resultMap;

    const lastDay = rangeDays[rangeDays.length - 1];
    // Nothing past todayYmd ever gets included (capped below), so there's no need to
    // fetch bucket rows beyond it — this also keeps a future-only displayed range
    // (lastDay > todayYmd) from querying schedules that aren't relevant yet.
    const queryCutoffYmd = lastDay < todayYmd ? lastDay : todayYmd;
    const cutoffUtc = new Date(`${queryCutoffYmd}T00:00:00+05:30`);

    const branchSql = bIds && bIds.length > 0
        ? Prisma.sql`AND l."branchId" IN (${Prisma.join(bIds)})`
        : Prisma.sql``;
    const centerSql = centerId
        ? Prisma.sql`AND l."centerId" = ${centerId}`
        : Prisma.sql``;

    type BucketRow = { date: Date; principal: unknown; interest: unknown };
    const buckets = await prisma.$queryRaw<BucketRow[]>(Prisma.sql`
        SELECT
            -- NOT "AT TIME ZONE 'Asia/Kolkata'": s."dueDate" is a plain calendar date stored
            -- at UTC midnight, not a real instant — converting it as if it were IST wall-clock
            -- shifts it back a day, which pulled schedules into "arrear" a day before they were
            -- actually overdue (see app/api/dashboard/v2/route.ts for the matching fix).
            DATE(s."dueDate") AS date,
            COALESCE(SUM(GREATEST(s."principalDue" - s."principalPaid", 0)), 0) AS principal,
            COALESCE(SUM(GREATEST(s."interestDue" - s."interestPaid", 0)), 0) AS interest
        FROM "loan_schedules" s
        JOIN "loans" l ON l."id" = s."loanId"
        WHERE s."dueDate" < ${cutoffUtc}
            AND l."isActive" = true
            AND s."status" IN ('PENDING', 'PARTIALLY_PAID', 'OVERDUE')
            ${branchSql}
            ${centerSql}
        GROUP BY DATE(s."dueDate")
        ORDER BY 1
    `);

    const sortedBuckets = buckets
        .map((b) => ({
            key: new Date(b.date).toISOString().split('T')[0],
            principal: toNum(b.principal),
            interest: toNum(b.interest),
        }))
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

    let bucketIdx = 0;
    let cumPrincipal = 0;
    let cumInterest = 0;
    for (const day of rangeDays) {
        // Cap at today: a row for a future date must not treat an earlier future
        // row's own not-yet-due demand as an arrear just because it precedes this
        // row chronologically in the table — only genuinely past-due (real
        // calendar today or earlier) amounts count.
        const cutoffForDay = day > todayYmd ? todayYmd : day;
        while (bucketIdx < sortedBuckets.length && sortedBuckets[bucketIdx].key < cutoffForDay) {
            cumPrincipal += sortedBuckets[bucketIdx].principal;
            cumInterest += sortedBuckets[bucketIdx].interest;
            bucketIdx += 1;
        }
        resultMap.set(day, { principal: cumPrincipal, interest: cumInterest });
    }

    return resultMap;
}
