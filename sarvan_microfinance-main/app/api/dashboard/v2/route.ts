import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { scheduleNotCoveredByAdvanceSql, scheduleNetPrincipalDueSql, scheduleNetInterestDueSql } from '@/app/lib/eod-collection-gates';
import { Prisma } from '@prisma/client';
import {
    handleCorsPreflight,
    successResponse,
    withAuth,
    errorResponse,
} from '@/app/lib/api-utils';
import {
    getBranchCalendarDayHalfOpenUtc,
    isWorkingDateAheadOfBranchCalendarToday,
    getCalendarYmdInTimeZone,
    getWeekdayNameInTimeZone,
    addCalendarDaysToYmd,
    parseDenominationEntryDateUtc,
} from '@/app/lib/branch-financial-day';
import { computeArrearDueTimeSeries } from '@/app/lib/dashboard/arrears';
import { getPortfolioOutstanding } from '@/app/lib/actions/reports';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function toNum(v: unknown): number {
    if (v === null || v === undefined) return 0;
    if (typeof v === 'bigint') return Number(v);
    if (v instanceof Prisma.Decimal) return Number(v);
    return Number(v) || 0;
}

export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const { searchParams } = new URL(request.url);

            const branchIdParam = searchParams.get('branchId');
            const centerIdParam = searchParams.get('centerId');
            const funderIdParam = searchParams.get('funderId');
            const fromDateParam = searchParams.get('fromDate');
            const toDateParam = searchParams.get('toDate');
            // Admin-only hierarchical filters
            const regionId = searchParams.get('regionId');
            const divisionId = searchParams.get('divisionId');
            const areaId = searchParams.get('areaId');

            // Resolve effective branch IDs per role
            let effectiveBranchIds: string[] | null = null;

            // Admin: resolve branches from area/division/region hierarchy first
            if (user.role === 'ADMIN' && (areaId || divisionId || regionId)) {
                const scopedBranches = await prisma.branch.findMany({
                    where: {
                        isActive: true,
                        ...(areaId
                            ? { areas: { some: { id: areaId } } }
                            : divisionId
                            ? { areas: { some: { division: { id: divisionId } } } }
                            : { areas: { some: { division: { region: { id: regionId! } } } } }),
                    },
                    select: { id: true },
                });
                effectiveBranchIds = scopedBranches.map((b) => b.id);
            } else if (user.role !== 'ADMIN') {
                // All branches this user is assigned to (UserBranchAssignment for
                // BM/FDO/any other role, AreaManagerBranch for AM) — not just their
                // primary/active branch. Role-agnostic: covers custom RBAC roles too.
                // (getPermittedBranchIds returns null — unrestricted — for an
                // HO-based user of any role, same as plain ADMIN falls through to below.)
                effectiveBranchIds = await getPermittedBranchIds(user);
            }

            // Further narrow by explicit branchId param
            if (branchIdParam) {
                if (effectiveBranchIds) {
                    effectiveBranchIds = effectiveBranchIds.includes(branchIdParam)
                        ? [branchIdParam]
                        : effectiveBranchIds;
                } else {
                    effectiveBranchIds = [branchIdParam];
                }
            }

            // Default date range = current week (Mon–Sun), computed in the branch business
            // timezone (Asia/Kolkata) using calendar-safe string arithmetic. Deliberately
            // avoids local Date methods (getDay/setHours/setDate) here — those depend on
            // the server process's OS timezone and previously disagreed with the UTC-based
            // date keys (toISOString) used below, which showed the wrong weekday name next
            // to each date whenever the server ran in a non-UTC timezone (e.g. IST).
            const todayYmd = getCalendarYmdInTimeZone(new Date(), 'Asia/Kolkata');
            const todayDayName = getWeekdayNameInTimeZone(parseDenominationEntryDateUtc(todayYmd), 'UTC');
            const todayDow = DAYS.indexOf(todayDayName);
            const mondayOffset = todayDow === 0 ? -6 : 1 - todayDow;
            const weekStartYmd = addCalendarDaysToYmd(todayYmd, mondayOffset);
            const weekEndYmd = addCalendarDaysToYmd(weekStartYmd, 6);

            const fromYmd = fromDateParam || weekStartYmd;
            const toYmd = toDateParam || weekEndYmd;

            const { dayStartUtc: fromDate } = getBranchCalendarDayHalfOpenUtc(
                parseDenominationEntryDateUtc(fromYmd),
                'Asia/Kolkata'
            );
            const { dayEndExclusiveUtc: toDateExclusive } = getBranchCalendarDayHalfOpenUtc(
                parseDenominationEntryDateUtc(toYmd),
                'Asia/Kolkata'
            );

            // Prisma filter objects
            const bIds = effectiveBranchIds;
            const branchWhere = bIds ? { branchId: { in: bIds } } : {};
            const clientBranchWhere = bIds ? { center: { branchId: { in: bIds } } } : {};
            const centerWhere = centerIdParam ? { centerId: centerIdParam } : {};
            const clientCenterWhere = centerIdParam ? { centerId: centerIdParam } : {};
            const funderWhere = funderIdParam ? { funderId: funderIdParam } : {};

            // ── STATS ──────────────────────────────────────────────────────────────
            const [
                centersCount,
                groupsCount,
                totalMembers,
                activeMembers,
                rejectedMembers,
                totalStaff,
                totalFunders,
                loanDisbAgg,
            ] = await Promise.all([
                prisma.center.count({ where: { isActive: true, ...branchWhere } }),
                prisma.group.count({
                    where: {
                        isActive: true,
                        center: bIds ? { branchId: { in: bIds } } : {},
                    },
                }),
                prisma.client.count({ where: { ...clientBranchWhere, ...clientCenterWhere } }),
                prisma.client.count({
                    where: {
                        isActive: true,
                        verificationStatus: 'VERIFIED',
                        ...clientBranchWhere,
                        ...clientCenterWhere,
                    },
                }),
                prisma.client.count({
                    where: { approvalStatus: 'REJECTED', ...clientBranchWhere, ...clientCenterWhere },
                }),
                prisma.user.count({
                    where: {
                        isActive: true,
                        ...(bIds ? { branchId: { in: bIds } } : {}),
                    },
                }),
                prisma.funder.count({ where: { isActive: true } }),
                prisma.loan.aggregate({
                    where: {
                        disbursementStatus: 'DISBURSED',
                        isActive: true,
                        ...branchWhere,
                        ...centerWhere,
                        ...funderWhere,
                    },
                    _sum: { amount: true },
                }),
            ]);

            const loanDisbursement = toNum(loanDisbAgg._sum.amount);
            // Same schedule-based calc as the OS Branchwise report (getOSBranchwiseData) —
            // deliberately not "disbursed amount of active loans minus all-time repayments":
            // that undercounts (and can floor to 0) once loans start closing, since a closed
            // loan's principal drops out of the "disbursed" side while its repayment history
            // stays in the "repaid" side.
            const portfolioOS = await getPortfolioOutstanding(
                todayYmd,
                bIds ?? undefined,
                centerIdParam ?? undefined,
                funderIdParam ?? undefined
            );
            const outstandingBalance = portfolioOS.osPrincipal;

            // ── DEMAND COLLECTION (weekly) ─────────────────────────────────────────
            type DemandRow = { date: Date; centers: bigint; group_count: bigint; members: bigint; p_due: unknown; i_due: unknown; total_due: unknown };
            type TxRow = { date: Date; cg: bigint; cm: bigint; demand_coll: unknown; advance_coll: unknown; preclose_amt: unknown; arrear_coll: unknown; total_coll: unknown };
            type ZeroRow = { date: Date; zero_count: bigint };

            const branchSql = bIds && bIds.length > 0
                ? Prisma.sql`AND l."branchId" IN (${Prisma.join(bIds)})`
                : Prisma.sql``;
            const centerSql = centerIdParam
                ? Prisma.sql`AND l."centerId" = ${centerIdParam}`
                : Prisma.sql``;
            const txBranchSql = bIds && bIds.length > 0
                ? Prisma.sql`AND t."branchId" IN (${Prisma.join(bIds)})`
                : Prisma.sql``;
            const txCenterSql = centerIdParam
                ? Prisma.sql`AND t."centerId" = ${centerIdParam}`
                : Prisma.sql``;

            const [demandRows, txRows, zeroRows] = await Promise.all([
                prisma.$queryRaw<DemandRow[]>(Prisma.sql`
                    SELECT
                        -- NOT "AT TIME ZONE 'Asia/Kolkata'" (nor the double-conversion used for
                        -- t."transactionDate" below): s."dueDate" is a calendar-date-only value —
                        -- the date as written is already the intended due date, with no instant to
                        -- convert — so DATE() alone is correct here.
                        DATE(s."dueDate") AS date,
                        COUNT(DISTINCT l."centerId")::bigint AS centers,
                        COUNT(DISTINCT g."id")::bigint AS group_count,
                        COUNT(DISTINCT l."clientId")::bigint AS members,
                        COALESCE(SUM(${scheduleNetPrincipalDueSql}), 0) AS p_due,
                        COALESCE(SUM(${scheduleNetInterestDueSql}), 0) AS i_due,
                        -- NOT s."totalDue": legacy/migrated loans (Ongoing Loan Backup import)
                        -- can carry a totalDue copied straight from the source spreadsheet,
                        -- which may already include savings — principalDue+interestDue is the
                        -- only reliably loan-only figure across both new and imported loans.
                        COALESCE(SUM(${scheduleNetPrincipalDueSql} + ${scheduleNetInterestDueSql}), 0) AS total_due
                    FROM "loan_schedules" s
                    JOIN "loans" l ON l."id" = s."loanId"
                    LEFT JOIN "group_members" gm ON gm."clientId" = l."clientId"
                    LEFT JOIN "groups" g ON g."id" = gm."groupId"
                    WHERE s."dueDate" >= ${fromDate}
                        AND s."dueDate" < ${toDateExclusive}
                        AND l."isActive" = true
                        ${branchSql}
                        ${centerSql}
                    GROUP BY DATE(s."dueDate")
                    ORDER BY 1
                `),
                prisma.$queryRaw<TxRow[]>(Prisma.sql`
                    SELECT
                        -- t."transactionDate" is a "timestamp without time zone" column holding
                        -- a UTC instant (branch-day start or migrated-import midnight — both are
                        -- UTC-anchored, never already-local). A bare AT TIME ZONE 'Asia/Kolkata'
                        -- on a naive column does the opposite of what's needed here: Postgres
                        -- treats the naive value AS IF it were already IST wall-clock time and
                        -- converts it to UTC (subtracting 5:30), pushing every row into the
                        -- previous day's bucket. The double conversion below first asserts the
                        -- naive value is UTC (a no-op on the instant), then converts that instant
                        -- to real IST wall-clock (adding 5:30) — the same math getKolkataCalendarYmd
                        -- does in JS elsewhere in this codebase.
                        DATE(t."transactionDate" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata') AS date,
                        COUNT(DISTINCT t."centerId")::bigint AS cg,
                        COUNT(DISTINCT t."clientId")::bigint AS cm,
                        -- Loan (P+I) portion only — t."amount" also carries any savings/loan-advance
                        -- collected alongside the EMI, which must not inflate these loan-demand figures
                        -- (the due side, s."totalDue", never includes savings either — see LoanSchedule generation).
                        COALESCE(SUM(CASE WHEN t."collectionType" = 'Demand Collection'     AND t."type" = 'REPAYMENT'  THEN COALESCE(t."principalAmount", 0) + COALESCE(t."interestAmount", 0) ELSE 0 END), 0) AS demand_coll,
                        COALESCE(SUM(CASE WHEN t."collectionType" = 'Non Demand Collection' AND t."type" = 'REPAYMENT'  THEN COALESCE(t."principalAmount", 0) + COALESCE(t."interestAmount", 0) ELSE 0 END), 0) AS advance_coll,
                        COALESCE(SUM(CASE WHEN t."type" = 'PRECLOSURE'                                                  THEN COALESCE(t."principalAmount", 0) + COALESCE(t."interestAmount", 0) ELSE 0 END), 0) AS preclose_amt,
                        COALESCE(SUM(CASE WHEN t."openingArrearsPrincipal" > 0               AND t."type" = 'REPAYMENT'  THEN COALESCE(t."principalAmount", 0) + COALESCE(t."interestAmount", 0) ELSE 0 END), 0) AS arrear_coll,
                        COALESCE(SUM(COALESCE(t."principalAmount", 0) + COALESCE(t."interestAmount", 0)), 0) AS total_coll
                    FROM "loan_transactions" t
                    WHERE t."transactionDate" >= ${fromDate}
                        AND t."transactionDate" < ${toDateExclusive}
                        AND t."status" = 'APPROVED'
                        AND t."isReversed" = false
                        AND t."type" IN ('REPAYMENT', 'PRECLOSURE')
                        ${txBranchSql}
                        ${txCenterSql}
                    GROUP BY DATE(t."transactionDate" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')
                    ORDER BY 1
                `),
                // Zero collection members = have schedule due that day but no approved transaction that day
                prisma.$queryRaw<ZeroRow[]>(Prisma.sql`
                    SELECT
                        DATE(s."dueDate") AS date,
                        COUNT(DISTINCT s."loanId")::bigint AS zero_count
                    FROM "loan_schedules" s
                    JOIN "loans" l ON l."id" = s."loanId"
                    WHERE s."dueDate" >= ${fromDate}
                        AND s."dueDate" < ${toDateExclusive}
                        AND l."isActive" = true
                        ${branchSql}
                        ${centerSql}
                        AND ${scheduleNotCoveredByAdvanceSql}
                        AND NOT EXISTS (
                            SELECT 1 FROM "loan_transactions" t2
                            WHERE t2."loanId" = l."id"
                                AND DATE(t2."transactionDate" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata') = DATE(s."dueDate")
                                AND t2."status" = 'APPROVED'
                                AND t2."isReversed" = false
                        )
                    GROUP BY DATE(s."dueDate")
                    ORDER BY 1
                `),
            ]);

            // Build map by ISO date string
            const demandMap = new Map<string, DemandRow>();
            for (const r of demandRows) {
                const key = new Date(r.date).toISOString().split('T')[0];
                demandMap.set(key, r);
            }
            const txMap = new Map<string, TxRow>();
            for (const r of txRows) {
                const key = new Date(r.date).toISOString().split('T')[0];
                txMap.set(key, r);
            }
            const zeroMap = new Map<string, bigint>();
            for (const r of zeroRows) {
                const key = new Date(r.date).toISOString().split('T')[0];
                zeroMap.set(key, r.zero_count);
            }

            // Ascending day keys for the displayed range, used to compute opening arrears
            // per day in a single grouped query (see computeArrearDueTimeSeries). Built via
            // pure YMD-string arithmetic (addCalendarDaysToYmd), not a Date cursor — keeps
            // this independent of the server's local timezone.
            const rangeDayKeys: string[] = [];
            for (let ymd = fromYmd; ymd <= toYmd; ymd = addCalendarDaysToYmd(ymd, 1)) {
                rangeDayKeys.push(ymd);
            }
            const arrearDueMap = await computeArrearDueTimeSeries(bIds, centerIdParam, rangeDayKeys, todayYmd);

            const demandCollection: object[] = [];
            for (const key of rangeDayKeys) {
                const d = demandMap.get(key);
                const t = txMap.get(key);
                const zeroCount = Number(zeroMap.get(key) ?? 0);

                const pDue = toNum(d?.p_due);
                const iDue = toNum(d?.i_due);
                const totalDue = toNum(d?.total_due);
                const demandColl = toNum(t?.demand_coll);
                const advanceColl = toNum(t?.advance_coll);
                const precloseColl = toNum(t?.preclose_amt);
                const arrearColl = toNum(t?.arrear_coll);
                const totalColl = toNum(t?.total_coll);
                // A day that hasn't happened yet can't have anything "yet to collect" or
                // "zero collection" — those statuses only make sense once the due date has
                // arrived and the branch has had a chance to collect. Otherwise every future
                // due date shows its full demand as overdue before the day even starts.
                const isFutureDay = key > todayYmd;
                const yetToCollect = isFutureDay ? 0 : Math.max(0, totalDue - demandColl);
                const arrearDueForDay = arrearDueMap.get(key);
                const arrearDue = (arrearDueForDay?.principal ?? 0) + (arrearDueForDay?.interest ?? 0);

                demandCollection.push({
                    date: key,
                    day: getWeekdayNameInTimeZone(parseDenominationEntryDateUtc(key), 'UTC'),
                    totalGroups: Number(d?.group_count ?? 0),
                    totalCenters: Number(d?.centers ?? 0),
                    totalMembers: Number(d?.members ?? 0),
                    demandPrincipal: pDue,
                    demandInterest: iDue,
                    demandTotal: totalDue,
                    collectionGroups: Number(t?.cg ?? 0),
                    collectionMembers: Number(t?.cm ?? 0),
                    collectionDemand: demandColl,
                    collectionAdvance: advanceColl,
                    collectionArrear: arrearColl,
                    collectionPreclose: precloseColl,
                    collectionTotal: totalColl,
                    yetToCollect,
                    arrearDue,
                    zeroCollectionMembers: isFutureDay ? 0 : zeroCount,
                });
            }

            // ── LOAN INDEXES ───────────────────────────────────────────────────────
            const loanIndexes = await prisma.loanIndex.findMany({
                where: {
                    isActive: true,
                    ...(bIds ? { branchId: { in: bIds } } : {}),
                    ...(centerIdParam ? { centerId: centerIdParam } : {}),
                },
                orderBy: { indexDate: 'desc' },
                take: 20,
                select: {
                    id: true,
                    indexNo: true,
                    indexDate: true,
                    totalApps: true,
                    totalAmount: true,
                    frequency: true,
                    branch: { select: { name: true, code: true } },
                    center: { select: { name: true, code: true } },
                    loans: {
                        where: { disbursementStatus: 'DISBURSED' },
                        select: { amount: true, principalPaid: true, interestPaid: true },
                    },
                },
            });

            const loanIndexData = loanIndexes.map((li) => {
                const principal = li.loans.reduce((s, l) => s + toNum(l.amount), 0);
                const principalPaid = li.loans.reduce((s, l) => s + toNum(l.principalPaid), 0);
                const interestPaid = li.loans.reduce((s, l) => s + toNum(l.interestPaid), 0);
                const disbursedCount = li.loans.length;
                return {
                    indexNo: li.indexNo,
                    disbursementDate: li.indexDate.toISOString().split('T')[0],
                    branch: `${li.branch.code} - ${li.branch.name}`,
                    center: `${li.center.code} - ${li.center.name}`,
                    loanAmount: toNum(li.totalAmount),
                    membersCount: li.totalApps,
                    disbursedCount,
                    principal,
                    principalPaid,
                    interest: interestPaid,
                    frequency: li.frequency,
                    status: disbursedCount === li.totalApps ? 'Fully Disbursed' : disbursedCount > 0 ? 'Partially Disbursed' : 'Pending',
                };
            });

            // ── EOD STATUS ─────────────────────────────────────────────────────────
            const branches = await prisma.branch.findMany({
                where: { isActive: true, ...(bIds ? { id: { in: bIds } } : {}) },
                include: {
                    lock: {
                        select: {
                            currentWorkingDate: true,
                            timezone: true,
                            lastEodClosedAt: true,
                        },
                    },
                    users: {
                        where: { role: 'BRANCH_MANAGER', isActive: true },
                        select: { firstName: true, lastName: true },
                        take: 1,
                    },
                },
                orderBy: { code: 'asc' },
            });

            const nowUtc = new Date();
            const eodStatus = await Promise.all(
                branches.map(async (b) => {
                    const tz = b.lock?.timezone || 'Asia/Kolkata';
                    const workingInstant = b.lock?.currentWorkingDate || nowUtc;
                    const { workingDateYmd, dayStartUtc, dayEndExclusiveUtc } =
                        getBranchCalendarDayHalfOpenUtc(workingInstant, tz);

                    type MoneyRow = { cash_opening: unknown; cash_closing: unknown; bank_opening: unknown; bank_closing: unknown };
                    const moneyRows = await prisma.$queryRaw<MoneyRow[]>(Prisma.sql`
                        SELECT
                            COALESCE(SUM(CASE WHEN ft."transactionDate" < ${dayStartUtc} AND ft."type" = 'CASH_RECEIPT'  THEN ft."amount"
                                             WHEN ft."transactionDate" < ${dayStartUtc} AND ft."type" = 'CASH_PAYMENT'  THEN -ft."amount" ELSE 0 END), 0) AS cash_opening,
                            COALESCE(SUM(CASE WHEN ft."transactionDate" >= ${dayStartUtc} AND ft."transactionDate" < ${dayEndExclusiveUtc} AND ft."type" = 'CASH_RECEIPT'  THEN ft."amount"
                                             WHEN ft."transactionDate" >= ${dayStartUtc} AND ft."transactionDate" < ${dayEndExclusiveUtc} AND ft."type" = 'CASH_PAYMENT'  THEN -ft."amount" ELSE 0 END), 0) AS cash_closing_delta,
                            COALESCE(SUM(CASE WHEN ft."transactionDate" < ${dayStartUtc} AND ft."type" = 'BANK_RECEIPT'  THEN ft."amount"
                                             WHEN ft."transactionDate" < ${dayStartUtc} AND ft."type" = 'BANK_PAYMENT'  THEN -ft."amount" ELSE 0 END), 0) AS bank_opening,
                            COALESCE(SUM(CASE WHEN ft."transactionDate" >= ${dayStartUtc} AND ft."transactionDate" < ${dayEndExclusiveUtc} AND ft."type" = 'BANK_RECEIPT'  THEN ft."amount"
                                             WHEN ft."transactionDate" >= ${dayStartUtc} AND ft."transactionDate" < ${dayEndExclusiveUtc} AND ft."type" = 'BANK_PAYMENT'  THEN -ft."amount" ELSE 0 END), 0) AS bank_closing_delta
                        FROM "financial_transactions" ft
                        JOIN "users" u ON u."id" = ft."createdById"
                        WHERE ft."isActive" = true
                            AND u."branchId" = ${b.id}
                            AND ft."transactionDate" < ${dayEndExclusiveUtc}
                    `);

                    const m = moneyRows[0];
                    const cashOpening = toNum(m?.cash_opening);
                    const cashDelta = toNum((m as any)?.cash_closing_delta);
                    const bankOpening = toNum(m?.bank_opening);
                    const bankDelta = toNum((m as any)?.bank_closing_delta);

                    const isCompleted = isWorkingDateAheadOfBranchCalendarToday(workingInstant, nowUtc, tz);
                    const hasActivity = Math.abs(cashDelta) > 0 || Math.abs(bankDelta) > 0;
                    const eodStatusVal: 'Completed' | 'In Progress' | 'Pending' = isCompleted
                        ? 'Completed'
                        : hasActivity
                        ? 'In Progress'
                        : 'Pending';

                    const manager = b.users[0];
                    const doneAtLabel =
                        eodStatusVal === 'Completed' && b.lock?.lastEodClosedAt
                            ? new Intl.DateTimeFormat('en-US', {
                                  timeZone: tz,
                                  hour: '2-digit',
                                  minute: '2-digit',
                              }).format(b.lock.lastEodClosedAt)
                            : '';

                    return {
                        branch: `${b.code} - ${b.name}`,
                        eodDate: workingDateYmd,
                        doneAt: doneAtLabel,
                        status: eodStatusVal,
                        cashOpening: Number(cashOpening.toFixed(2)),
                        cashClosing: Number((cashOpening + cashDelta).toFixed(2)),
                        bankOpening: Number(bankOpening.toFixed(2)),
                        bankClosing: Number((bankOpening + bankDelta).toFixed(2)),
                        managerName: manager ? `${manager.firstName} ${manager.lastName}` : '',
                        managerContact: '',
                    };
                })
            );

            // ── OFFICER LOAN DETAILS ───────────────────────────────────────────────
            const fdoWhere: any = { role: 'FDO', isActive: true };
            if (bIds) fdoWhere.branchId = { in: bIds };

            const fdos = await prisma.user.findMany({
                where: fdoWhere,
                select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    assignedCenters: {
                        where: { isActive: true },
                        select: {
                            id: true,
                            groups: {
                                where: { isActive: true },
                                select: { id: true },
                            },
                            clients: {
                                select: { id: true, isActive: true, verificationStatus: true },
                            },
                            loans: {
                                where: { isActive: true, disbursementStatus: 'DISBURSED' },
                                select: {
                                    amount: true,
                                    principalPaid: true,
                                    interestPaid: true,
                                    indexId: true,
                                    disbursedLevel1At: true,
                                    // Total contracted interest for the loan (sum of every
                                    // installment's interestDue, which stays fixed regardless of
                                    // collection progress) — needed because Loan itself has no
                                    // stored "total interest" field.
                                    schedules: { select: { interestDue: true } },
                                },
                            },
                        },
                    },
                },
            });

            const officerLoanDetails = fdos.map((fdo) => {
                let totalGroups = 0;
                let totalMembers = 0;
                let activeMembers = 0;
                let publishedPrincipal = 0;
                let publishedInterest = 0;
                let unpublishedPrincipal = 0;
                let unpublishedInterest = 0;
                let olbPrincipal = 0;
                let olbInterest = 0;

                for (const center of fdo.assignedCenters) {
                    totalGroups += center.groups.length;
                    totalMembers += center.clients.length;
                    activeMembers += center.clients.filter(
                        (c) => c.isActive && c.verificationStatus === 'VERIFIED'
                    ).length;

                    for (const loan of center.loans) {
                        const amount = toNum(loan.amount);
                        const intPaid = toNum(loan.interestPaid);
                        const prinPaid = toNum(loan.principalPaid);
                        const remainingPrincipal = Math.max(0, amount - prinPaid);
                        // Total contracted interest for the loan — sum of every installment's
                        // interestDue, which stays fixed regardless of how much has been
                        // collected (unlike loan.interestPaid, which only grows over time).
                        const totalInterest = loan.schedules.reduce((s, sch) => s + toNum(sch.interestDue), 0);
                        const remainingInterest = Math.max(0, totalInterest - intPaid);

                        olbPrincipal += remainingPrincipal;
                        olbInterest += remainingInterest;

                        if (loan.indexId) {
                            publishedPrincipal += amount;
                            publishedInterest += totalInterest;
                        } else {
                            unpublishedPrincipal += amount;
                            unpublishedInterest += totalInterest;
                        }
                    }
                }

                return {
                    officerName: `${fdo.firstName} ${fdo.lastName}`,
                    groups: totalGroups,
                    members: totalMembers,
                    activeMembers,
                    publishedPrincipal,
                    publishedInterest,
                    publishedTotal: publishedPrincipal + publishedInterest,
                    unpublishedPrincipal,
                    unpublishedInterest,
                    unpublishedTotal: unpublishedPrincipal + unpublishedInterest,
                    olbPrincipal,
                    olbInterest,
                    olbTotal: olbPrincipal + olbInterest,
                };
            });

            return successResponse({
                stats: {
                    centers: centersCount,
                    groups: groupsCount,
                    totalMembers,
                    activeMembers,
                    rejectedMembers,
                    totalStaff,
                    totalFunders,
                    loanDisbursement,
                    outstandingBalance,
                    highmarkChecked: 0,
                    highmarkBalance: 0,
                },
                demandCollection,
                loanIndexes: loanIndexData,
                eodStatus,
                officerLoanDetails,
            });
        } catch (error) {
            console.error('Dashboard V2 API Error:', error);
            return errorResponse(
                error instanceof Error ? error.message : 'Failed to fetch dashboard data',
                500
            );
        }
    })(request);
}
