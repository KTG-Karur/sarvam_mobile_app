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
    getCalendarYmdInTimeZone,
    getWeekdayNameInTimeZone,
    addCalendarDaysToYmd,
    parseDenominationEntryDateUtc,
} from '@/app/lib/branch-financial-day';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export async function OPTIONS() {
    return handleCorsPreflight();
}

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

            const view = (searchParams.get('view') ?? 'group') as 'group' | 'center';
            const branchIdParam = searchParams.get('branchId');
            const centerIdParam = searchParams.get('centerId');
            const fromDateParam = searchParams.get('fromDate');
            const toDateParam = searchParams.get('toDate');
            const regionId = searchParams.get('regionId');
            const divisionId = searchParams.get('divisionId');
            const areaId = searchParams.get('areaId');

            // Role-based branch scoping (same pattern as main dashboard API)
            let effectiveBranchIds: string[] | null = null;

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
                // Role-agnostic: any non-ADMIN role is scoped to their assigned
                // branches (covers custom RBAC roles, not just BM/AM/FDO).
                effectiveBranchIds = await getPermittedBranchIds(user);
            }

            if (branchIdParam) {
                if (effectiveBranchIds) {
                    effectiveBranchIds = effectiveBranchIds.includes(branchIdParam)
                        ? [branchIdParam]
                        : effectiveBranchIds;
                } else {
                    effectiveBranchIds = [branchIdParam];
                }
            }

            const bIds = effectiveBranchIds;

            // Date range — computed in the branch business timezone (Asia/Kolkata) via
            // calendar-safe string arithmetic, matching /api/dashboard/v2. Avoids local
            // Date methods (getDay/setHours/setDate), which depend on the server's OS
            // timezone and previously caused the sibling route's per-day table to show
            // the wrong weekday next to each date.
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

            // SQL filter fragments
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

            if (view === 'center') {
                type CDemandRow = { center_id: string; center_code: string; center_name: string; members: bigint; p_due: unknown; i_due: unknown; total_due: unknown };
                type CTxRow = { center_id: string; members: bigint; demand_coll: unknown; advance_coll: unknown; preclose_amt: unknown; arrear_coll: unknown; total_coll: unknown };
                type CZeroRow = { center_id: string; zero_count: bigint };

                const [demandRows, txRows, zeroRows] = await Promise.all([
                    prisma.$queryRaw<CDemandRow[]>(Prisma.sql`
                        SELECT
                            c."id" AS center_id,
                            c."code" AS center_code,
                            c."name" AS center_name,
                            COUNT(DISTINCT l."clientId")::bigint AS members,
                            COALESCE(SUM(${scheduleNetPrincipalDueSql}), 0) AS p_due,
                            COALESCE(SUM(${scheduleNetInterestDueSql}), 0) AS i_due,
                            -- NOT s."totalDue" — legacy/migrated loans can carry a totalDue copied
                            -- from the import source, which may already include savings.
                            COALESCE(SUM(${scheduleNetPrincipalDueSql} + ${scheduleNetInterestDueSql}), 0) AS total_due
                        FROM "loan_schedules" s
                        JOIN "loans" l ON l."id" = s."loanId"
                        JOIN "centers" c ON c."id" = l."centerId"
                        WHERE s."dueDate" >= ${fromDate}
                            AND s."dueDate" < ${toDateExclusive}
                            AND l."isActive" = true
                            ${branchSql}
                            ${centerSql}
                        GROUP BY c."id", c."code", c."name"
                        ORDER BY c."code"
                    `),
                    prisma.$queryRaw<CTxRow[]>(Prisma.sql`
                        SELECT
                            t."centerId" AS center_id,
                            COUNT(DISTINCT t."clientId")::bigint AS members,
                            -- Loan (P+I) portion only — t."amount" also carries any savings/loan-advance
                            -- collected alongside the EMI, which must not inflate these loan-demand figures.
                            COALESCE(SUM(CASE WHEN t."collectionType" = 'Demand Collection'     AND t."type" = 'REPAYMENT' THEN COALESCE(t."principalAmount", 0) + COALESCE(t."interestAmount", 0) ELSE 0 END), 0) AS demand_coll,
                            COALESCE(SUM(CASE WHEN t."collectionType" = 'Non Demand Collection' AND t."type" = 'REPAYMENT' THEN COALESCE(t."principalAmount", 0) + COALESCE(t."interestAmount", 0) ELSE 0 END), 0) AS advance_coll,
                            COALESCE(SUM(CASE WHEN t."type" = 'PRECLOSURE' THEN COALESCE(t."principalAmount", 0) + COALESCE(t."interestAmount", 0) ELSE 0 END), 0) AS preclose_amt,
                            COALESCE(SUM(CASE WHEN t."openingArrearsPrincipal" > 0 AND t."type" = 'REPAYMENT' THEN COALESCE(t."principalAmount", 0) + COALESCE(t."interestAmount", 0) ELSE 0 END), 0) AS arrear_coll,
                            COALESCE(SUM(COALESCE(t."principalAmount", 0) + COALESCE(t."interestAmount", 0)), 0) AS total_coll
                        -- t."transactionDate" is "timestamp without time zone" holding a UTC
                        -- instant (collections are stamped at the branch day's IST-midnight,
                        -- written as naive UTC digits). Comparing it directly against a JS Date
                        -- param binds the param as timestamptz, so Postgres casts the naive
                        -- column using the *session* timezone (Asia/Calcutta) before comparing —
                        -- shifting every boundary by -5:30 and dropping same-day collections
                        -- (always at the day's exact edge) out of their own window. AT TIME
                        -- ZONE 'UTC' reinterprets the naive digits as UTC first, same fix
                        -- already applied in app/api/dashboard/v2/route.ts.
                        FROM "loan_transactions" t
                        WHERE t."transactionDate" AT TIME ZONE 'UTC' >= ${fromDate}
                            AND t."transactionDate" AT TIME ZONE 'UTC' < ${toDateExclusive}
                            AND t."status" = 'APPROVED'
                            AND t."isReversed" = false
                            AND t."type" IN ('REPAYMENT', 'PRECLOSURE')
                            ${txBranchSql}
                            ${txCenterSql}
                        GROUP BY t."centerId"
                    `),
                    prisma.$queryRaw<CZeroRow[]>(Prisma.sql`
                        SELECT
                            l."centerId" AS center_id,
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
                                    AND t2."transactionDate" AT TIME ZONE 'UTC' >= ${fromDate}
                                    AND t2."transactionDate" AT TIME ZONE 'UTC' < ${toDateExclusive}
                                    AND t2."status" = 'APPROVED'
                                    AND t2."isReversed" = false
                            )
                        GROUP BY l."centerId"
                    `),
                ]);

                const txMap = new Map(txRows.map((r) => [r.center_id, r]));
                const zeroMap = new Map(zeroRows.map((r) => [r.center_id, r.zero_count]));

                const rows = demandRows.map((d) => {
                    const t = txMap.get(d.center_id);
                    const pDue = toNum(d.p_due);
                    const iDue = toNum(d.i_due);
                    const totalDue = toNum(d.total_due);
                    const demandColl = toNum(t?.demand_coll);
                    const yetToCollect = Math.max(0, totalDue - demandColl);
                    return {
                        id: d.center_id,
                        name: d.center_name,
                        code: d.center_code,
                        parentName: undefined,
                        members: Number(d.members),
                        demandPrincipal: pDue,
                        demandInterest: iDue,
                        demandTotal: totalDue,
                        collectionDemand: demandColl,
                        collectionAdvance: toNum(t?.advance_coll),
                        collectionArrear: toNum(t?.arrear_coll),
                        collectionPreclose: toNum(t?.preclose_amt),
                        collectionTotal: toNum(t?.total_coll),
                        yetToCollect,
                        zeroCollectionMembers: Number(zeroMap.get(d.center_id) ?? 0),
                    };
                });

                return successResponse({ rows });
            }

            // ── GROUP VIEW ──────────────────────────────────────────────────────────
            type GDemandRow = { group_id: string; group_name: string; center_id: string; center_code: string; center_name: string; members: bigint; p_due: unknown; i_due: unknown; total_due: unknown };
            type GTxRow = { group_id: string; members: bigint; demand_coll: unknown; advance_coll: unknown; preclose_amt: unknown; arrear_coll: unknown; total_coll: unknown };
            type GZeroRow = { group_id: string; zero_count: bigint };

            const [demandRows, txRows, zeroRows] = await Promise.all([
                prisma.$queryRaw<GDemandRow[]>(Prisma.sql`
                    SELECT
                        g."id" AS group_id,
                        g."name" AS group_name,
                        c."id" AS center_id,
                        c."code" AS center_code,
                        c."name" AS center_name,
                        COUNT(DISTINCT l."clientId")::bigint AS members,
                        COALESCE(SUM(${scheduleNetPrincipalDueSql}), 0) AS p_due,
                        COALESCE(SUM(${scheduleNetInterestDueSql}), 0) AS i_due,
                        -- NOT s."totalDue" — legacy/migrated loans can carry a totalDue copied
                        -- from the import source, which may already include savings.
                        COALESCE(SUM(${scheduleNetPrincipalDueSql} + ${scheduleNetInterestDueSql}), 0) AS total_due
                    FROM "loan_schedules" s
                    JOIN "loans" l ON l."id" = s."loanId"
                    JOIN "group_members" gm ON gm."clientId" = l."clientId"
                    JOIN "groups" g ON g."id" = gm."groupId"
                    JOIN "centers" c ON c."id" = g."centerId"
                    WHERE s."dueDate" >= ${fromDate}
                        AND s."dueDate" < ${toDateExclusive}
                        AND l."isActive" = true
                        ${branchSql}
                        ${centerSql}
                    GROUP BY g."id", g."name", c."id", c."code", c."name"
                    ORDER BY c."code", g."name"
                `),
                prisma.$queryRaw<GTxRow[]>(Prisma.sql`
                    SELECT
                        g."id" AS group_id,
                        COUNT(DISTINCT t."clientId")::bigint AS members,
                        -- Loan (P+I) portion only — t."amount" also carries any savings/loan-advance
                        -- collected alongside the EMI, which must not inflate these loan-demand figures.
                        COALESCE(SUM(CASE WHEN t."collectionType" = 'Demand Collection'     AND t."type" = 'REPAYMENT' THEN COALESCE(t."principalAmount", 0) + COALESCE(t."interestAmount", 0) ELSE 0 END), 0) AS demand_coll,
                        COALESCE(SUM(CASE WHEN t."collectionType" = 'Non Demand Collection' AND t."type" = 'REPAYMENT' THEN COALESCE(t."principalAmount", 0) + COALESCE(t."interestAmount", 0) ELSE 0 END), 0) AS advance_coll,
                        COALESCE(SUM(CASE WHEN t."type" = 'PRECLOSURE' THEN COALESCE(t."principalAmount", 0) + COALESCE(t."interestAmount", 0) ELSE 0 END), 0) AS preclose_amt,
                        COALESCE(SUM(CASE WHEN t."openingArrearsPrincipal" > 0 AND t."type" = 'REPAYMENT' THEN COALESCE(t."principalAmount", 0) + COALESCE(t."interestAmount", 0) ELSE 0 END), 0) AS arrear_coll,
                        COALESCE(SUM(COALESCE(t."principalAmount", 0) + COALESCE(t."interestAmount", 0)), 0) AS total_coll
                    FROM "loan_transactions" t
                    JOIN "group_members" gm ON gm."clientId" = t."clientId"
                    JOIN "groups" g ON g."id" = gm."groupId"
                    WHERE t."transactionDate" AT TIME ZONE 'UTC' >= ${fromDate}
                        AND t."transactionDate" AT TIME ZONE 'UTC' < ${toDateExclusive}
                        AND t."status" = 'APPROVED'
                        AND t."isReversed" = false
                        AND t."type" IN ('REPAYMENT', 'PRECLOSURE')
                        ${txBranchSql}
                        ${txCenterSql}
                    GROUP BY g."id"
                `),
                prisma.$queryRaw<GZeroRow[]>(Prisma.sql`
                    SELECT
                        g."id" AS group_id,
                        COUNT(DISTINCT s."loanId")::bigint AS zero_count
                    FROM "loan_schedules" s
                    JOIN "loans" l ON l."id" = s."loanId"
                    JOIN "group_members" gm ON gm."clientId" = l."clientId"
                    JOIN "groups" g ON g."id" = gm."groupId"
                    WHERE s."dueDate" >= ${fromDate}
                        AND s."dueDate" < ${toDateExclusive}
                        AND l."isActive" = true
                        ${branchSql}
                        ${centerSql}
                        AND ${scheduleNotCoveredByAdvanceSql}
                        AND NOT EXISTS (
                            SELECT 1 FROM "loan_transactions" t2
                            WHERE t2."loanId" = l."id"
                                AND t2."transactionDate" AT TIME ZONE 'UTC' >= ${fromDate}
                                AND t2."transactionDate" AT TIME ZONE 'UTC' < ${toDateExclusive}
                                AND t2."status" = 'APPROVED'
                                AND t2."isReversed" = false
                        )
                    GROUP BY g."id"
                `),
            ]);

            const txMap = new Map(txRows.map((r) => [r.group_id, r]));
            const zeroMap = new Map(zeroRows.map((r) => [r.group_id, r.zero_count]));

            const rows = demandRows.map((d) => {
                const t = txMap.get(d.group_id);
                const pDue = toNum(d.p_due);
                const iDue = toNum(d.i_due);
                const totalDue = toNum(d.total_due);
                const demandColl = toNum(t?.demand_coll);
                const yetToCollect = Math.max(0, totalDue - demandColl);
                return {
                    id: d.group_id,
                    name: d.group_name,
                    code: undefined,
                    parentName: `${d.center_code} - ${d.center_name}`,
                    members: Number(d.members),
                    demandPrincipal: pDue,
                    demandInterest: iDue,
                    demandTotal: totalDue,
                    collectionDemand: demandColl,
                    collectionAdvance: toNum(t?.advance_coll),
                    collectionArrear: toNum(t?.arrear_coll),
                    collectionPreclose: toNum(t?.preclose_amt),
                    collectionTotal: toNum(t?.total_coll),
                    yetToCollect,
                    zeroCollectionMembers: Number(zeroMap.get(d.group_id) ?? 0),
                };
            });

            return successResponse({ rows });
        } catch (error) {
            console.error('Demand detail API error:', error);
            return errorResponse(
                error instanceof Error ? error.message : 'Failed to fetch demand detail',
                500
            );
        }
    })(request);
}
