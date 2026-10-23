import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { scheduleNotCoveredByAdvanceSql, scheduleNetPrincipalDueSql, scheduleNetInterestDueSql } from '@/app/lib/eod-collection-gates';
import { Prisma } from '@prisma/client';
import { JWTPayload } from '@/app/lib/auth';
import {
    handleCorsPreflight,
    successResponse,
    withAuth,
    errorResponse,
} from '@/app/lib/api-utils';
import { getKolkataMonthHalfOpenUtc, getCalendarYmdInTimeZone } from '@/app/lib/branch-financial-day';
import { computeOpeningArrearsByLoan, computeOutstandingBalance } from '@/app/lib/dashboard/arrears';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';

export async function OPTIONS() {
    return handleCorsPreflight();
}

function toNum(v: unknown): number {
    if (v === null || v === undefined) return 0;
    if (typeof v === 'bigint') return Number(v);
    if (v instanceof Prisma.Decimal) return Number(v);
    return Number(v) || 0;
}

function ymd(d: Date | null | undefined): string | null {
    if (!d) return null;
    return new Date(d).toISOString().split('T')[0];
}

function formatIstTime(d: Date | null | undefined): string {
    if (!d) return '-';
    return new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
    }).format(new Date(d));
}

// ── Scope resolution (mirrors app/api/dashboard/v2/route.ts, kept inline for
//    consistency with this route family rather than app/lib/permissions/branch-scope.ts) ──

type Scope = { bIds: string[] | null; centerId: string | null };

async function resolveScope(user: JWTPayload, searchParams: URLSearchParams): Promise<Scope> {
    const branchIdParam = searchParams.get('branchId');
    const centerIdParam = searchParams.get('centerId');
    const regionId = searchParams.get('regionId');
    const divisionId = searchParams.get('divisionId');
    const areaId = searchParams.get('areaId');

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
        // Role-agnostic: any non-ADMIN role is scoped to their assigned branches
        // (covers custom RBAC roles, not just BM/AM/FDO).
        effectiveBranchIds = await getPermittedBranchIds(user);
    }

    if (branchIdParam) {
        if (effectiveBranchIds) {
            effectiveBranchIds = effectiveBranchIds.includes(branchIdParam) ? [branchIdParam] : effectiveBranchIds;
        } else {
            effectiveBranchIds = [branchIdParam];
        }
    }

    return { bIds: effectiveBranchIds, centerId: centerIdParam };
}

// ── Shared row fetchers (group-loans + group-members both key off the same
//    per-schedule row set, so the two modals can never silently diverge) ──

type ScheduleRow = {
    group_id: string;
    group_name: string;
    group_code: string | null;
    center_code: string;
    center_name: string;
    meeting_time: string | null;
    branch_code: string;
    branch_name: string;
    fdo_code: string | null;
    fdo_first_name: string | null;
    fdo_last_name: string | null;
    fdo_phone: string | null;
    client_pk: string;
    client_code: string;
    client_first_name: string;
    client_last_name: string;
    client_phone: string | null;
    loan_id: string;
    installment_no: number;
    principal_due: unknown;
    interest_due: unknown;
    total_due: unknown;
};

async function fetchGroupDemandRows(
    bIds: string[] | null,
    centerId: string | null,
    groupId: string | null,
    dayStartUtc: Date,
    dayEndExclusiveUtc: Date
): Promise<ScheduleRow[]> {
    const branchSql = bIds && bIds.length > 0 ? Prisma.sql`AND l."branchId" IN (${Prisma.join(bIds)})` : Prisma.sql``;
    const centerSql = centerId ? Prisma.sql`AND l."centerId" = ${centerId}` : Prisma.sql``;
    const groupSql = groupId ? Prisma.sql`AND g."id" = ${groupId}` : Prisma.sql``;

    return prisma.$queryRaw<ScheduleRow[]>(Prisma.sql`
        SELECT
            g."id" AS group_id, g."name" AS group_name, g."code" AS group_code,
            c."code" AS center_code, c."name" AS center_name, c."meetingTime" AS meeting_time,
            b."code" AS branch_code, b."name" AS branch_name,
            fdo."employeeId" AS fdo_code, fdo."firstName" AS fdo_first_name, fdo."lastName" AS fdo_last_name, fdo."mobileNumber" AS fdo_phone,
            cl."id" AS client_pk, cl."clientId" AS client_code, cl."firstName" AS client_first_name, cl."lastName" AS client_last_name, cl."phone" AS client_phone,
            l."id" AS loan_id,
            s."installmentNo" AS installment_no,
            -- NOT s."totalDue" — legacy/migrated loans can carry a totalDue copied from the
            -- import source, which may already include savings; principalDue+interestDue is
            -- the only reliably loan-only figure across both new and imported loans.
            ${scheduleNetPrincipalDueSql} AS principal_due, ${scheduleNetInterestDueSql} AS interest_due, (${scheduleNetPrincipalDueSql} + ${scheduleNetInterestDueSql}) AS total_due
        FROM "loan_schedules" s
        JOIN "loans" l ON l."id" = s."loanId"
        JOIN "clients" cl ON cl."id" = l."clientId"
        JOIN "group_members" gm ON gm."clientId" = l."clientId"
        JOIN "groups" g ON g."id" = gm."groupId"
        JOIN "centers" c ON c."id" = g."centerId"
        JOIN "branches" b ON b."id" = c."branchId"
        LEFT JOIN "users" fdo ON fdo."id" = c."fdoId"
        WHERE s."dueDate" >= ${dayStartUtc} AND s."dueDate" < ${dayEndExclusiveUtc}
            AND l."isActive" = true
            ${branchSql}
            ${centerSql}
            ${groupSql}
        ORDER BY b."code", c."code", g."name", cl."clientId"
    `);
}

async function fetchDemandCollectedClientIds(
    bIds: string[] | null,
    centerId: string | null,
    groupId: string | null,
    dayStartUtc: Date,
    dayEndExclusiveUtc: Date
): Promise<Set<string>> {
    const txBranchSql = bIds && bIds.length > 0 ? Prisma.sql`AND t."branchId" IN (${Prisma.join(bIds)})` : Prisma.sql``;
    const txCenterSql = centerId ? Prisma.sql`AND t."centerId" = ${centerId}` : Prisma.sql``;
    const groupJoin = groupId
        ? Prisma.sql`JOIN "group_members" gm ON gm."clientId" = t."clientId" AND gm."groupId" = ${groupId}`
        : Prisma.sql``;

    // t."transactionDate" is a "timestamp without time zone" column holding a UTC instant
    // (collections are stamped at the branch day's IST-midnight, written as naive UTC digits —
    // see app/api/collections/demand/route.ts). Comparing it directly against a JS Date param
    // binds the param as timestamptz, so Postgres casts the naive column using the *session*
    // timezone (here, Asia/Calcutta) before comparing — shifting every boundary by -5:30 and
    // pushing same-day collections (always at the day's exact edge) out of their own window.
    // `AT TIME ZONE 'UTC'` reinterprets the naive digits as UTC first, same fix already applied
    // to the sibling per-day chart in app/api/dashboard/v2/route.ts.
    const rows = await prisma.$queryRaw<{ client_id: string }[]>(Prisma.sql`
        SELECT DISTINCT t."clientId" AS client_id
        FROM "loan_transactions" t
        ${groupJoin}
        WHERE t."transactionDate" AT TIME ZONE 'UTC' >= ${dayStartUtc} AND t."transactionDate" AT TIME ZONE 'UTC' < ${dayEndExclusiveUtc}
            AND t."status" = 'APPROVED' AND t."isReversed" = false
            AND t."collectionType" = 'Demand Collection' AND t."type" = 'REPAYMENT'
            ${txBranchSql}
            ${txCenterSql}
    `);

    // A member whose installments due that day were ALL already paid ahead (advance) has nothing left to
    // collect, so they count as collected rather than "Yet to Collect".
    const lBranchSql = bIds && bIds.length > 0 ? Prisma.sql`AND l."branchId" IN (${Prisma.join(bIds)})` : Prisma.sql``;
    const lCenterSql = centerId ? Prisma.sql`AND l."centerId" = ${centerId}` : Prisma.sql``;
    const coveredRows = await prisma.$queryRaw<{ client_id: string }[]>(Prisma.sql`
        SELECT l."clientId" AS client_id
        FROM "loan_schedules" s
        JOIN "loans" l ON l."id" = s."loanId"
        WHERE s."dueDate" >= ${dayStartUtc} AND s."dueDate" < ${dayEndExclusiveUtc}
            AND l."isActive" = true
            ${lBranchSql}
            ${lCenterSql}
        GROUP BY l."clientId"
        HAVING bool_and(NOT (${scheduleNotCoveredByAdvanceSql}))
    `);
    return new Set([...rows, ...coveredRows].map((r) => r.client_id));
}

async function fetchGroupFirstCollectionTimes(
    bIds: string[] | null,
    centerId: string | null,
    dayStartUtc: Date,
    dayEndExclusiveUtc: Date
): Promise<Map<string, Date>> {
    const txBranchSql = bIds && bIds.length > 0 ? Prisma.sql`AND t."branchId" IN (${Prisma.join(bIds)})` : Prisma.sql``;
    const txCenterSql = centerId ? Prisma.sql`AND t."centerId" = ${centerId}` : Prisma.sql``;

    const rows = await prisma.$queryRaw<{ group_id: string; first_at: Date }[]>(Prisma.sql`
        SELECT g."id" AS group_id, MIN(t."createdAt") AS first_at
        FROM "loan_transactions" t
        JOIN "group_members" gm ON gm."clientId" = t."clientId"
        JOIN "groups" g ON g."id" = gm."groupId"
        WHERE t."transactionDate" AT TIME ZONE 'UTC' >= ${dayStartUtc} AND t."transactionDate" AT TIME ZONE 'UTC' < ${dayEndExclusiveUtc}
            AND t."status" = 'APPROVED' AND t."isReversed" = false
            AND t."type" IN ('REPAYMENT', 'PRECLOSURE')
            ${txBranchSql}
            ${txCenterSql}
        GROUP BY g."id"
    `);
    return new Map(rows.map((r) => [r.group_id, r.first_at]));
}

// ── Modal 1: Group Loan Details - Demand ──

async function getGroupLoanDetails(params: {
    bIds: string[] | null;
    centerId: string | null;
    dayStartUtc: Date;
    dayEndExclusiveUtc: Date;
    dateParam: string;
}) {
    const { bIds, centerId, dayStartUtc, dayEndExclusiveUtc, dateParam } = params;
    const [scheduleRows, collectedClientIds, firstCollectionTimes] = await Promise.all([
        fetchGroupDemandRows(bIds, centerId, null, dayStartUtc, dayEndExclusiveUtc),
        fetchDemandCollectedClientIds(bIds, centerId, null, dayStartUtc, dayEndExclusiveUtc),
        fetchGroupFirstCollectionTimes(bIds, centerId, dayStartUtc, dayEndExclusiveUtc),
    ]);

    type GroupAgg = {
        groupId: string;
        groupName: string;
        groupCode: string | null;
        centerCode: string;
        centerName: string;
        meetingTime: string | null;
        branchCode: string;
        branchName: string;
        fdoCode: string | null;
        fdoFirstName: string | null;
        fdoLastName: string | null;
        fdoPhone: string | null;
        clientIds: Set<string>;
        installmentNos: Set<number>;
        principal: number;
        interest: number;
        total: number;
    };

    const groups = new Map<string, GroupAgg>();
    for (const r of scheduleRows) {
        let g = groups.get(r.group_id);
        if (!g) {
            g = {
                groupId: r.group_id,
                groupName: r.group_name,
                groupCode: r.group_code,
                centerCode: r.center_code,
                centerName: r.center_name,
                meetingTime: r.meeting_time,
                branchCode: r.branch_code,
                branchName: r.branch_name,
                fdoCode: r.fdo_code,
                fdoFirstName: r.fdo_first_name,
                fdoLastName: r.fdo_last_name,
                fdoPhone: r.fdo_phone,
                clientIds: new Set(),
                installmentNos: new Set(),
                principal: 0,
                interest: 0,
                total: 0,
            };
            groups.set(r.group_id, g);
        }
        g.clientIds.add(r.client_pk);
        g.installmentNos.add(r.installment_no);
        g.principal += toNum(r.principal_due);
        g.interest += toNum(r.interest_due);
        g.total += toNum(r.total_due);
    }

    const rows = Array.from(groups.values()).map((g) => {
        const totalMembers = g.clientIds.size;
        let collected = 0;
        for (const cid of g.clientIds) {
            if (collectedClientIds.has(cid)) collected += 1;
        }
        const dueInstallments = Array.from(g.installmentNos).sort((a, b) => b - a);
        const officerName = g.fdoCode
            ? `${g.fdoCode} - ${g.fdoFirstName ?? ''} ${g.fdoLastName ?? ''}`.trim()
            : g.fdoFirstName
            ? `${g.fdoFirstName} ${g.fdoLastName ?? ''}`.trim()
            : '-';

        return {
            groupId: g.groupId,
            branchName: `${g.branchCode}-${g.branchName}`,
            centerName: `${g.centerCode} - ${g.centerName}`,
            groupName: g.groupCode ? `${g.groupCode} - ${g.groupName}` : g.groupName,
            officerName,
            officerPhone: g.fdoPhone ?? '-',
            meetupTime: g.meetingTime ?? '-',
            collectionTime: formatIstTime(firstCollectionTimes.get(g.groupId)),
            dueCount: dueInstallments.join(','),
            collectedMembers: collected,
            totalMembers,
            demandPrincipal: g.principal,
            demandInterest: g.interest,
            demandTotal: g.total,
            status: collected === totalMembers ? 'Collection Done' : 'Few Pending Collection',
        };
    });

    rows.sort(
        (a, b) =>
            a.branchName.localeCompare(b.branchName) ||
            a.centerName.localeCompare(b.centerName) ||
            a.groupName.localeCompare(b.groupName)
    );

    const totals = rows.reduce(
        (acc, r) => ({
            collectedMembers: acc.collectedMembers + r.collectedMembers,
            totalMembers: acc.totalMembers + r.totalMembers,
            demandPrincipal: acc.demandPrincipal + r.demandPrincipal,
            demandInterest: acc.demandInterest + r.demandInterest,
            demandTotal: acc.demandTotal + r.demandTotal,
        }),
        { collectedMembers: 0, totalMembers: 0, demandPrincipal: 0, demandInterest: 0, demandTotal: 0 }
    );

    return { date: dateParam, rows, totals };
}

// ── Modal 2: Group Member Details - Demand ──

async function getGroupMemberDetails(params: {
    groupId: string;
    dayStartUtc: Date;
    dayEndExclusiveUtc: Date;
    dateParam: string;
}) {
    const { groupId, dayStartUtc, dayEndExclusiveUtc, dateParam } = params;
    const [scheduleRows, collectedClientIds] = await Promise.all([
        fetchGroupDemandRows(null, null, groupId, dayStartUtc, dayEndExclusiveUtc),
        fetchDemandCollectedClientIds(null, null, groupId, dayStartUtc, dayEndExclusiveUtc),
    ]);

    if (scheduleRows.length === 0) {
        return { date: dateParam, groupName: '', rows: [], totals: { principal: 0, interest: 0, total: 0 } };
    }

    const groupName = scheduleRows[0].group_code
        ? `${scheduleRows[0].group_code} - ${scheduleRows[0].group_name}`
        : scheduleRows[0].group_name;

    type ClientAgg = {
        clientPk: string;
        clientCode: string;
        firstName: string;
        lastName: string;
        phone: string | null;
        // Displayed installment uses the first loan/installment encountered for that client that
        // day — a documented simplification for the rare case of >1 loan due the same day,
        // matching the same "pick one representative line" approach used in the collection modal.
        loanId: string;
        installmentNo: number;
        principal: number;
        interest: number;
        total: number;
    };

    const clients = new Map<string, ClientAgg>();
    for (const r of scheduleRows) {
        let c = clients.get(r.client_pk);
        if (!c) {
            c = {
                clientPk: r.client_pk,
                clientCode: r.client_code,
                firstName: r.client_first_name,
                lastName: r.client_last_name,
                phone: r.client_phone,
                loanId: r.loan_id,
                installmentNo: r.installment_no,
                principal: 0,
                interest: 0,
                total: 0,
            };
            clients.set(r.client_pk, c);
        }
        c.principal += toNum(r.principal_due);
        c.interest += toNum(r.interest_due);
        c.total += toNum(r.total_due);
    }

    const loanIds = Array.from(new Set(Array.from(clients.values()).map((c) => c.loanId)));
    const scheduleCounts = await prisma.loanSchedule.groupBy({
        by: ['loanId'],
        where: { loanId: { in: loanIds } },
        _count: { _all: true },
    });
    const scheduleCountMap = new Map(scheduleCounts.map((r) => [r.loanId, r._count._all]));

    const { monthStartUtc, monthEndExclusiveUtc } = getKolkataMonthHalfOpenUtc(dateParam);
    const clientPks = Array.from(clients.keys());
    const absentCounts = await prisma.clientAttendance.groupBy({
        by: ['clientId'],
        where: {
            clientId: { in: clientPks },
            isPresent: false,
            attendanceDate: { gte: monthStartUtc, lt: monthEndExclusiveUtc },
        },
        _count: { _all: true },
    });
    const absentMap = new Map(absentCounts.map((r) => [r.clientId, r._count._all]));

    const rows = Array.from(clients.values()).map((c) => ({
        groupName,
        memberId: c.clientCode,
        memberName: `${c.firstName} ${c.lastName}`,
        memberPhone: c.phone ?? '-',
        absentCount: absentMap.get(c.clientPk) ?? 0,
        installment: `${c.installmentNo}/${scheduleCountMap.get(c.loanId) ?? '-'}`,
        principal: c.principal,
        interest: c.interest,
        total: c.total,
        status: collectedClientIds.has(c.clientPk) ? 'Collection Done' : 'Yet to Collect',
    }));

    rows.sort((a, b) => a.memberName.localeCompare(b.memberName));

    const totals = rows.reduce(
        (acc, r) => ({ principal: acc.principal + r.principal, interest: acc.interest + r.interest, total: acc.total + r.total }),
        { principal: 0, interest: 0, total: 0 }
    );

    return { date: dateParam, groupName, rows, totals };
}

// ── Center-scoped row fetchers (mirror the group fetchers above, but joined directly off
//    "centers" — no group_members join, so clients without a group membership are still
//    counted here, unlike the group-loans view). ──

type CenterScheduleRow = {
    center_id: string;
    center_code: string;
    center_name: string;
    meeting_time: string | null;
    branch_code: string;
    branch_name: string;
    fdo_code: string | null;
    fdo_first_name: string | null;
    fdo_last_name: string | null;
    fdo_phone: string | null;
    client_pk: string;
    client_code: string;
    client_first_name: string;
    client_last_name: string;
    client_phone: string | null;
    loan_id: string;
    installment_no: number;
    principal_due: unknown;
    interest_due: unknown;
    total_due: unknown;
};

async function fetchCenterDemandRows(
    bIds: string[] | null,
    centerId: string | null,
    dayStartUtc: Date,
    dayEndExclusiveUtc: Date
): Promise<CenterScheduleRow[]> {
    const branchSql = bIds && bIds.length > 0 ? Prisma.sql`AND l."branchId" IN (${Prisma.join(bIds)})` : Prisma.sql``;
    const centerSql = centerId ? Prisma.sql`AND l."centerId" = ${centerId}` : Prisma.sql``;

    return prisma.$queryRaw<CenterScheduleRow[]>(Prisma.sql`
        SELECT
            c."id" AS center_id, c."code" AS center_code, c."name" AS center_name, c."meetingTime" AS meeting_time,
            b."code" AS branch_code, b."name" AS branch_name,
            fdo."employeeId" AS fdo_code, fdo."firstName" AS fdo_first_name, fdo."lastName" AS fdo_last_name, fdo."mobileNumber" AS fdo_phone,
            cl."id" AS client_pk, cl."clientId" AS client_code, cl."firstName" AS client_first_name, cl."lastName" AS client_last_name, cl."phone" AS client_phone,
            l."id" AS loan_id,
            s."installmentNo" AS installment_no,
            -- NOT s."totalDue" — legacy/migrated loans can carry a totalDue copied from the
            -- import source, which may already include savings; principalDue+interestDue is
            -- the only reliably loan-only figure across both new and imported loans.
            ${scheduleNetPrincipalDueSql} AS principal_due, ${scheduleNetInterestDueSql} AS interest_due, (${scheduleNetPrincipalDueSql} + ${scheduleNetInterestDueSql}) AS total_due
        FROM "loan_schedules" s
        JOIN "loans" l ON l."id" = s."loanId"
        JOIN "clients" cl ON cl."id" = l."clientId"
        JOIN "centers" c ON c."id" = l."centerId"
        JOIN "branches" b ON b."id" = c."branchId"
        LEFT JOIN "users" fdo ON fdo."id" = c."fdoId"
        WHERE s."dueDate" >= ${dayStartUtc} AND s."dueDate" < ${dayEndExclusiveUtc}
            AND l."isActive" = true
            ${branchSql}
            ${centerSql}
        ORDER BY b."code", c."code", cl."clientId"
    `);
}

async function fetchCenterFirstCollectionTimes(
    bIds: string[] | null,
    centerId: string | null,
    dayStartUtc: Date,
    dayEndExclusiveUtc: Date
): Promise<Map<string, Date>> {
    const txBranchSql = bIds && bIds.length > 0 ? Prisma.sql`AND t."branchId" IN (${Prisma.join(bIds)})` : Prisma.sql``;
    const txCenterSql = centerId ? Prisma.sql`AND t."centerId" = ${centerId}` : Prisma.sql``;

    const rows = await prisma.$queryRaw<{ center_id: string; first_at: Date }[]>(Prisma.sql`
        SELECT t."centerId" AS center_id, MIN(t."createdAt") AS first_at
        FROM "loan_transactions" t
        WHERE t."transactionDate" AT TIME ZONE 'UTC' >= ${dayStartUtc} AND t."transactionDate" AT TIME ZONE 'UTC' < ${dayEndExclusiveUtc}
            AND t."status" = 'APPROVED' AND t."isReversed" = false
            AND t."type" IN ('REPAYMENT', 'PRECLOSURE')
            AND t."centerId" IS NOT NULL
            ${txBranchSql}
            ${txCenterSql}
        GROUP BY t."centerId"
    `);
    return new Map(rows.map((r) => [r.center_id, r.first_at]));
}

// ── Modal 1b: Center Loan Details - Demand (same shape as Group Loan Details, one row
//    per center instead of per group) ──

async function getCenterLoanDetails(params: {
    bIds: string[] | null;
    centerId: string | null;
    dayStartUtc: Date;
    dayEndExclusiveUtc: Date;
    dateParam: string;
}) {
    const { bIds, centerId, dayStartUtc, dayEndExclusiveUtc, dateParam } = params;
    const [scheduleRows, collectedClientIds, firstCollectionTimes] = await Promise.all([
        fetchCenterDemandRows(bIds, centerId, dayStartUtc, dayEndExclusiveUtc),
        fetchDemandCollectedClientIds(bIds, centerId, null, dayStartUtc, dayEndExclusiveUtc),
        fetchCenterFirstCollectionTimes(bIds, centerId, dayStartUtc, dayEndExclusiveUtc),
    ]);

    type CenterAgg = {
        centerId: string;
        centerCode: string;
        centerName: string;
        meetingTime: string | null;
        branchCode: string;
        branchName: string;
        fdoCode: string | null;
        fdoFirstName: string | null;
        fdoLastName: string | null;
        fdoPhone: string | null;
        clientIds: Set<string>;
        installmentNos: Set<number>;
        principal: number;
        interest: number;
        total: number;
    };

    const centers = new Map<string, CenterAgg>();
    for (const r of scheduleRows) {
        let c = centers.get(r.center_id);
        if (!c) {
            c = {
                centerId: r.center_id,
                centerCode: r.center_code,
                centerName: r.center_name,
                meetingTime: r.meeting_time,
                branchCode: r.branch_code,
                branchName: r.branch_name,
                fdoCode: r.fdo_code,
                fdoFirstName: r.fdo_first_name,
                fdoLastName: r.fdo_last_name,
                fdoPhone: r.fdo_phone,
                clientIds: new Set(),
                installmentNos: new Set(),
                principal: 0,
                interest: 0,
                total: 0,
            };
            centers.set(r.center_id, c);
        }
        c.clientIds.add(r.client_pk);
        c.installmentNos.add(r.installment_no);
        c.principal += toNum(r.principal_due);
        c.interest += toNum(r.interest_due);
        c.total += toNum(r.total_due);
    }

    const rows = Array.from(centers.values()).map((c) => {
        const totalMembers = c.clientIds.size;
        let collected = 0;
        for (const cid of c.clientIds) {
            if (collectedClientIds.has(cid)) collected += 1;
        }
        const dueInstallments = Array.from(c.installmentNos).sort((a, b) => b - a);
        const officerName = c.fdoCode
            ? `${c.fdoCode} - ${c.fdoFirstName ?? ''} ${c.fdoLastName ?? ''}`.trim()
            : c.fdoFirstName
            ? `${c.fdoFirstName} ${c.fdoLastName ?? ''}`.trim()
            : '-';

        return {
            centerId: c.centerId,
            branchName: `${c.branchCode}-${c.branchName}`,
            centerName: `${c.centerCode} - ${c.centerName}`,
            officerName,
            officerPhone: c.fdoPhone ?? '-',
            meetupTime: c.meetingTime ?? '-',
            collectionTime: formatIstTime(firstCollectionTimes.get(c.centerId)),
            dueCount: dueInstallments.join(','),
            collectedMembers: collected,
            totalMembers,
            demandPrincipal: c.principal,
            demandInterest: c.interest,
            demandTotal: c.total,
            status: collected === totalMembers ? 'Collection Done' : 'Few Pending Collection',
        };
    });

    rows.sort((a, b) => a.branchName.localeCompare(b.branchName) || a.centerName.localeCompare(b.centerName));

    const totals = rows.reduce(
        (acc, r) => ({
            collectedMembers: acc.collectedMembers + r.collectedMembers,
            totalMembers: acc.totalMembers + r.totalMembers,
            demandPrincipal: acc.demandPrincipal + r.demandPrincipal,
            demandInterest: acc.demandInterest + r.demandInterest,
            demandTotal: acc.demandTotal + r.demandTotal,
        }),
        { collectedMembers: 0, totalMembers: 0, demandPrincipal: 0, demandInterest: 0, demandTotal: 0 }
    );

    return { date: dateParam, rows, totals };
}

// ── Modal 2b: Center Member Details - Demand (same shape as Group Member Details, all
//    members with a schedule due that day in the given center) ──

async function getCenterMemberDetails(params: {
    centerId: string;
    dayStartUtc: Date;
    dayEndExclusiveUtc: Date;
    dateParam: string;
}) {
    const { centerId, dayStartUtc, dayEndExclusiveUtc, dateParam } = params;
    const [scheduleRows, collectedClientIds] = await Promise.all([
        fetchCenterDemandRows(null, centerId, dayStartUtc, dayEndExclusiveUtc),
        fetchDemandCollectedClientIds(null, centerId, null, dayStartUtc, dayEndExclusiveUtc),
    ]);

    if (scheduleRows.length === 0) {
        return { date: dateParam, centerName: '', rows: [], totals: { principal: 0, interest: 0, total: 0 } };
    }

    const centerName = `${scheduleRows[0].center_code} - ${scheduleRows[0].center_name}`;

    type ClientAgg = {
        clientPk: string;
        clientCode: string;
        firstName: string;
        lastName: string;
        phone: string | null;
        loanId: string;
        installmentNo: number;
        principal: number;
        interest: number;
        total: number;
    };

    const clients = new Map<string, ClientAgg>();
    for (const r of scheduleRows) {
        let c = clients.get(r.client_pk);
        if (!c) {
            c = {
                clientPk: r.client_pk,
                clientCode: r.client_code,
                firstName: r.client_first_name,
                lastName: r.client_last_name,
                phone: r.client_phone,
                loanId: r.loan_id,
                installmentNo: r.installment_no,
                principal: 0,
                interest: 0,
                total: 0,
            };
            clients.set(r.client_pk, c);
        }
        c.principal += toNum(r.principal_due);
        c.interest += toNum(r.interest_due);
        c.total += toNum(r.total_due);
    }

    const loanIds = Array.from(new Set(Array.from(clients.values()).map((c) => c.loanId)));
    const scheduleCounts = await prisma.loanSchedule.groupBy({
        by: ['loanId'],
        where: { loanId: { in: loanIds } },
        _count: { _all: true },
    });
    const scheduleCountMap = new Map(scheduleCounts.map((r) => [r.loanId, r._count._all]));

    const { monthStartUtc, monthEndExclusiveUtc } = getKolkataMonthHalfOpenUtc(dateParam);
    const clientPks = Array.from(clients.keys());
    const absentCounts = await prisma.clientAttendance.groupBy({
        by: ['clientId'],
        where: {
            clientId: { in: clientPks },
            isPresent: false,
            attendanceDate: { gte: monthStartUtc, lt: monthEndExclusiveUtc },
        },
        _count: { _all: true },
    });
    const absentMap = new Map(absentCounts.map((r) => [r.clientId, r._count._all]));

    const rows = Array.from(clients.values()).map((c) => ({
        centerName,
        memberId: c.clientCode,
        memberName: `${c.firstName} ${c.lastName}`,
        memberPhone: c.phone ?? '-',
        absentCount: absentMap.get(c.clientPk) ?? 0,
        installment: `${c.installmentNo}/${scheduleCountMap.get(c.loanId) ?? '-'}`,
        principal: c.principal,
        interest: c.interest,
        total: c.total,
        status: collectedClientIds.has(c.clientPk) ? 'Collection Done' : 'Yet to Collect',
    }));

    rows.sort((a, b) => a.memberName.localeCompare(b.memberName));

    const totals = rows.reduce(
        (acc, r) => ({ principal: acc.principal + r.principal, interest: acc.interest + r.interest, total: acc.total + r.total }),
        { principal: 0, interest: 0, total: 0 }
    );

    return { date: dateParam, centerName, rows, totals };
}

// ── Modal 3: Today Collection Details ──

type CollectionMode = 'Demand' | 'Advance' | 'Arrear' | 'Preclose';

async function getCollectionDetails(params: {
    bIds: string[] | null;
    centerId: string | null;
    mode: CollectionMode;
    dayStartUtc: Date;
    dayEndExclusiveUtc: Date;
}) {
    const { bIds, centerId, mode, dayStartUtc, dayEndExclusiveUtc } = params;

    const modePredicate =
        mode === 'Demand'
            ? Prisma.sql`t."collectionType" = 'Demand Collection' AND t."type" = 'REPAYMENT'`
            : mode === 'Advance'
            ? Prisma.sql`t."collectionType" = 'Non Demand Collection' AND t."type" = 'REPAYMENT'`
            : mode === 'Arrear'
            ? Prisma.sql`t."openingArrearsPrincipal" > 0 AND t."type" = 'REPAYMENT'`
            : Prisma.sql`t."type" = 'PRECLOSURE'`;

    const branchSql = bIds && bIds.length > 0 ? Prisma.sql`AND t."branchId" IN (${Prisma.join(bIds)})` : Prisma.sql``;
    const centerSql = centerId ? Prisma.sql`AND t."centerId" = ${centerId}` : Prisma.sql``;

    type Row = {
        client_code: string;
        client_first_name: string;
        client_last_name: string;
        client_phone: string | null;
        amount: unknown;
        principal_amount: unknown;
        interest_amount: unknown;
        transaction_date: Date;
        min_installment_no: number | null;
        min_due_date: Date | null;
        min_line_total: unknown;
    };

    const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
        SELECT
            cl."clientId" AS client_code, cl."firstName" AS client_first_name, cl."lastName" AS client_last_name, cl."phone" AS client_phone,
            t."amount" AS amount, t."principalAmount" AS principal_amount, t."interestAmount" AS interest_amount,
            t."transactionDate" AS transaction_date,
            minline."installmentNo" AS min_installment_no, minsched."dueDate" AS min_due_date, minline."lineTotal" AS min_line_total
        FROM "loan_transactions" t
        JOIN "clients" cl ON cl."id" = t."clientId"
        LEFT JOIN LATERAL (
            SELECT ltl."installmentNo", ltl."scheduleId", ltl."lineTotal"
            FROM "loan_transaction_lines" ltl
            WHERE ltl."transactionId" = t."id"
            ORDER BY ltl."installmentNo" ASC
            LIMIT 1
        ) minline ON true
        LEFT JOIN "loan_schedules" minsched ON minsched."id" = minline."scheduleId"
        WHERE t."transactionDate" AT TIME ZONE 'UTC' >= ${dayStartUtc} AND t."transactionDate" AT TIME ZONE 'UTC' < ${dayEndExclusiveUtc}
            AND t."status" = 'APPROVED' AND t."isReversed" = false
            AND ${modePredicate}
            ${branchSql}
            ${centerSql}
        ORDER BY t."createdAt" ASC
    `);

    const dataRows = rows.map((r) => ({
        memberId: r.client_code,
        memberName: `${r.client_first_name} ${r.client_last_name}`,
        memberPhone: r.client_phone ?? '-',
        dueNo: r.min_installment_no ?? '-',
        dueDate: ymd(r.min_due_date) ?? '-',
        paidDate: ymd(r.transaction_date) ?? '-',
        principal: toNum(r.principal_amount),
        interest: toNum(r.interest_amount),
        emi: toNum(r.min_line_total),
        // Loan (P+I) portion only — r.amount also carries any savings/loan-advance collected
        // alongside the EMI, which would make this modal's total disagree with the (loan-only)
        // cell it was opened from.
        totalAmount: toNum(r.principal_amount) + toNum(r.interest_amount),
        collectionMode: mode,
    }));

    const totals = dataRows.reduce(
        (acc, r) => ({
            principal: acc.principal + r.principal,
            interest: acc.interest + r.interest,
            total: acc.total + r.totalAmount,
        }),
        { principal: 0, interest: 0, total: 0 }
    );

    return { mode, rows: dataRows, totals };
}

// ── Modal 4: Overdue (Yet To Collect) ──

async function getOverdue(params: {
    bIds: string[] | null;
    centerId: string | null;
    dayStartUtc: Date;
    dayEndExclusiveUtc: Date;
}) {
    const { bIds, centerId, dayStartUtc, dayEndExclusiveUtc } = params;
    const branchSql = bIds && bIds.length > 0 ? Prisma.sql`AND l."branchId" IN (${Prisma.join(bIds)})` : Prisma.sql``;
    const centerSql = centerId ? Prisma.sql`AND l."centerId" = ${centerId}` : Prisma.sql``;
    const txBranchSql = bIds && bIds.length > 0 ? Prisma.sql`AND t."branchId" IN (${Prisma.join(bIds)})` : Prisma.sql``;
    const txCenterSql = centerId ? Prisma.sql`AND t."centerId" = ${centerId}` : Prisma.sql``;

    type Row = {
        client_code: string;
        client_first_name: string;
        client_last_name: string;
        client_phone: string | null;
        branch_code: string;
        branch_name: string;
        center_code: string;
        center_name: string;
        group_name: string | null;
        fdo_code: string | null;
        fdo_first_name: string | null;
        fdo_last_name: string | null;
        fdo_phone: string | null;
        p_due: unknown;
        i_due: unknown;
        coll_principal: unknown;
        coll_interest: unknown;
    };

    const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
        WITH due AS (
            SELECT
                l."clientId" AS client_id, l."centerId" AS center_id, l."branchId" AS branch_id,
                COALESCE(SUM(${scheduleNetPrincipalDueSql}), 0) AS p_due,
                COALESCE(SUM(${scheduleNetInterestDueSql}), 0) AS i_due
            FROM "loan_schedules" s
            JOIN "loans" l ON l."id" = s."loanId"
            WHERE s."dueDate" >= ${dayStartUtc} AND s."dueDate" < ${dayEndExclusiveUtc}
                AND l."isActive" = true
                ${branchSql}
                ${centerSql}
            GROUP BY l."clientId", l."centerId", l."branchId"
        ),
        coll AS (
            SELECT
                t."clientId" AS client_id,
                COALESCE(SUM(t."principalAmount"), 0) AS coll_principal,
                COALESCE(SUM(t."interestAmount"), 0) AS coll_interest
            FROM "loan_transactions" t
            WHERE t."transactionDate" AT TIME ZONE 'UTC' >= ${dayStartUtc} AND t."transactionDate" AT TIME ZONE 'UTC' < ${dayEndExclusiveUtc}
                AND t."status" = 'APPROVED' AND t."isReversed" = false
                AND t."collectionType" = 'Demand Collection' AND t."type" = 'REPAYMENT'
                ${txBranchSql}
                ${txCenterSql}
            GROUP BY t."clientId"
        )
        SELECT
            cl."clientId" AS client_code, cl."firstName" AS client_first_name, cl."lastName" AS client_last_name, cl."phone" AS client_phone,
            b."code" AS branch_code, b."name" AS branch_name,
            c."code" AS center_code, c."name" AS center_name,
            g."name" AS group_name,
            fdo."employeeId" AS fdo_code, fdo."firstName" AS fdo_first_name, fdo."lastName" AS fdo_last_name, fdo."mobileNumber" AS fdo_phone,
            due.p_due, due.i_due,
            COALESCE(coll.coll_principal, 0) AS coll_principal,
            COALESCE(coll.coll_interest, 0) AS coll_interest
        FROM due
        JOIN "clients" cl ON cl."id" = due.client_id
        JOIN "centers" c ON c."id" = due.center_id
        JOIN "branches" b ON b."id" = due.branch_id
        LEFT JOIN "users" fdo ON fdo."id" = c."fdoId"
        LEFT JOIN "group_members" gm ON gm."clientId" = due.client_id
        LEFT JOIN "groups" g ON g."id" = gm."groupId"
        LEFT JOIN coll ON coll.client_id = due.client_id
    `);

    const dataRows = rows
        .map((r) => {
            const officerName = r.fdo_code
                ? `${r.fdo_code} - ${r.fdo_first_name ?? ''} ${r.fdo_last_name ?? ''}`.trim()
                : r.fdo_first_name
                ? `${r.fdo_first_name} ${r.fdo_last_name ?? ''}`.trim()
                : '-';
            const principal = Math.max(0, toNum(r.p_due) - toNum(r.coll_principal));
            const interest = Math.max(0, toNum(r.i_due) - toNum(r.coll_interest));
            // Loan (P+I) portion only — deliberately not totalDue-based, so any savings/
            // loan-advance collected alongside the EMI can't mask a real P+I shortfall.
            const total = principal + interest;
            return {
                memberId: r.client_code,
                memberName: `${r.client_first_name} ${r.client_last_name}`,
                memberPhone: r.client_phone ?? '-',
                branchName: `${r.branch_code}-${r.branch_name}`,
                centerName: `${r.center_code} - ${r.center_name}`,
                groupName: r.group_name ?? '-',
                officerName,
                officerPhone: r.fdo_phone ?? '-',
                principal,
                interest,
                total,
                status: 'Yet to Collect' as const,
            };
        })
        .filter((r) => r.total > 0);

    const totals = dataRows.reduce(
        (acc, r) => ({ principal: acc.principal + r.principal, interest: acc.interest + r.interest, total: acc.total + r.total }),
        { principal: 0, interest: 0, total: 0 }
    );

    return { rows: dataRows, totals };
}

// ── Modal 5: Arrear Overdue ──

async function getArrearOverdue(params: { bIds: string[] | null; centerId: string | null; dayStartUtc: Date }) {
    const { bIds, centerId, dayStartUtc } = params;

    const loans = await prisma.loan.findMany({
        where: {
            isActive: true,
            disbursementStatus: 'DISBURSED',
            ...(bIds ? { branchId: { in: bIds } } : {}),
            ...(centerId ? { centerId } : {}),
        },
        select: {
            id: true,
            clientId: true,
            client: { select: { clientId: true, firstName: true, lastName: true, phone: true } },
            branch: { select: { code: true, name: true } },
            center: {
                select: {
                    code: true,
                    name: true,
                    fdo: { select: { employeeId: true, firstName: true, lastName: true, mobileNumber: true } },
                },
            },
        },
    });

    if (loans.length === 0) {
        return { rows: [], totals: { principal: 0, interest: 0, total: 0 } };
    }

    const loanIds = loans.map((l) => l.id);
    const [arrearMap, groupMembers] = await Promise.all([
        computeOpeningArrearsByLoan(loanIds, dayStartUtc),
        prisma.groupMember.findMany({
            where: { clientId: { in: loans.map((l) => l.clientId) } },
            select: { clientId: true, group: { select: { name: true } } },
        }),
    ]);
    const groupNameByClient = new Map(groupMembers.map((gm) => [gm.clientId, gm.group.name]));

    const dataRows = loans
        .map((l) => {
            const arrears = arrearMap.get(l.id);
            const principal = arrears?.principal ?? 0;
            const interest = arrears?.interest ?? 0;
            const officerName = l.center.fdo?.employeeId
                ? `${l.center.fdo.employeeId} - ${l.center.fdo.firstName} ${l.center.fdo.lastName}`
                : l.center.fdo
                ? `${l.center.fdo.firstName} ${l.center.fdo.lastName}`
                : '-';
            return {
                memberId: l.client.clientId,
                memberName: `${l.client.firstName} ${l.client.lastName}`,
                memberPhone: l.client.phone ?? '-',
                branchName: `${l.branch.code}-${l.branch.name}`,
                centerName: `${l.center.code} - ${l.center.name}`,
                groupName: groupNameByClient.get(l.clientId) ?? '-',
                officerName,
                officerPhone: l.center.fdo?.mobileNumber ?? '-',
                principal,
                interest,
                total: principal + interest,
                status: 'Arrear Yet to Collect' as const,
            };
        })
        .filter((r) => r.total > 0);

    const totals = dataRows.reduce(
        (acc, r) => ({ principal: acc.principal + r.principal, interest: acc.interest + r.interest, total: acc.total + r.total }),
        { principal: 0, interest: 0, total: 0 }
    );

    return { rows: dataRows, totals };
}

// ── Modal 6: Zero Collection Details ──

async function getZeroCollection(params: {
    bIds: string[] | null;
    centerId: string | null;
    dayStartUtc: Date;
    dayEndExclusiveUtc: Date;
}) {
    const { bIds, centerId, dayStartUtc, dayEndExclusiveUtc } = params;
    const branchSql = bIds && bIds.length > 0 ? Prisma.sql`AND l."branchId" IN (${Prisma.join(bIds)})` : Prisma.sql``;
    const centerSql = centerId ? Prisma.sql`AND l."centerId" = ${centerId}` : Prisma.sql``;

    type Row = {
        loan_id: string;
        client_id: string;
        loan_amount: unknown;
        loan_principal_paid: unknown;
        client_code: string;
        client_first_name: string;
        client_last_name: string;
        client_phone: string | null;
        branch_code: string;
        branch_name: string;
        center_code: string;
        center_name: string;
        p_due: unknown;
        i_due: unknown;
        total_due: unknown;
    };

    // Identical day-wise NOT EXISTS predicate as v2/route.ts's zeroRows query, so the
    // modal's row count reconciles exactly with the day-row's zeroCollectionMembers cell.
    const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
        SELECT
            l."id" AS loan_id, l."clientId" AS client_id, l."amount" AS loan_amount, l."principalPaid" AS loan_principal_paid,
            cl."clientId" AS client_code, cl."firstName" AS client_first_name, cl."lastName" AS client_last_name, cl."phone" AS client_phone,
            b."code" AS branch_code, b."name" AS branch_name, c."code" AS center_code, c."name" AS center_name,
            -- NOT s."totalDue" — legacy/migrated loans can carry a totalDue copied from the
            -- import source, which may already include savings.
            COALESCE(SUM(${scheduleNetPrincipalDueSql}), 0) AS p_due, COALESCE(SUM(${scheduleNetInterestDueSql}), 0) AS i_due, COALESCE(SUM(${scheduleNetPrincipalDueSql} + ${scheduleNetInterestDueSql}), 0) AS total_due
        FROM "loan_schedules" s
        JOIN "loans" l ON l."id" = s."loanId"
        JOIN "clients" cl ON cl."id" = l."clientId"
        JOIN "centers" c ON c."id" = l."centerId"
        JOIN "branches" b ON b."id" = l."branchId"
        WHERE s."dueDate" >= ${dayStartUtc} AND s."dueDate" < ${dayEndExclusiveUtc}
            AND l."isActive" = true
            ${branchSql}
            ${centerSql}
            AND ${scheduleNotCoveredByAdvanceSql}
            AND NOT EXISTS (
                SELECT 1 FROM "loan_transactions" t2
                WHERE t2."loanId" = l."id"
                    AND t2."transactionDate" AT TIME ZONE 'UTC' >= ${dayStartUtc} AND t2."transactionDate" AT TIME ZONE 'UTC' < ${dayEndExclusiveUtc}
                    AND t2."status" = 'APPROVED'
                    AND t2."isReversed" = false
            )
        GROUP BY l."id", l."clientId", l."amount", l."principalPaid", cl."clientId", cl."firstName", cl."lastName", cl."phone", b."code", b."name", c."code", c."name"
        ORDER BY b."code", c."code"
    `);

    if (rows.length === 0) {
        return { rows: [], totals: { due: { principal: 0, interest: 0, total: 0 }, arrear: { principal: 0, interest: 0, total: 0 }, outstanding: { principal: 0, interest: 0, total: 0 } } };
    }

    const loanIds = rows.map((r) => r.loan_id);
    const [arrearMap, outstandingMap, lastCollectedRows] = await Promise.all([
        computeOpeningArrearsByLoan(loanIds, dayStartUtc),
        computeOutstandingBalance(rows.map((r) => ({ id: r.loan_id, amount: r.loan_amount as Prisma.Decimal, principalPaid: r.loan_principal_paid as Prisma.Decimal }))),
        prisma.$queryRaw<{ loan_id: string; last_date: Date }[]>(Prisma.sql`
            SELECT "loanId" AS loan_id, MAX("transactionDate") AS last_date
            FROM "loan_transactions"
            WHERE "loanId" IN (${Prisma.join(loanIds)})
                AND "status" = 'APPROVED' AND "isReversed" = false
                AND "transactionDate" AT TIME ZONE 'UTC' < ${dayStartUtc}
            GROUP BY "loanId"
        `),
    ]);
    const lastCollectedMap = new Map(lastCollectedRows.map((r) => [r.loan_id, r.last_date]));

    const dataRows = rows.map((r, idx) => {
        const arrears = arrearMap.get(r.loan_id) ?? { principal: 0, interest: 0 };
        const outstanding = outstandingMap.get(r.loan_id) ?? { principal: 0, interest: 0 };
        const duePrincipal = toNum(r.p_due);
        const dueInterest = toNum(r.i_due);
        return {
            sNo: idx + 1,
            memberId: r.client_code,
            memberName: `${r.client_first_name} ${r.client_last_name}`,
            memberPhone: r.client_phone ?? '-',
            branchName: `${r.branch_code}-${r.branch_name}`,
            centerName: `${r.center_code} - ${r.center_name}`,
            duePrincipal,
            dueInterest,
            dueTotal: toNum(r.total_due),
            arrearPrincipal: arrears.principal,
            arrearInterest: arrears.interest,
            arrearTotal: arrears.principal + arrears.interest,
            outstandingPrincipal: outstanding.principal,
            outstandingInterest: outstanding.interest,
            outstandingTotal: outstanding.principal + outstanding.interest,
            collectedDate: ymd(lastCollectedMap.get(r.loan_id)) ?? '-',
        };
    });

    const totals = dataRows.reduce(
        (acc, r) => ({
            due: { principal: acc.due.principal + r.duePrincipal, interest: acc.due.interest + r.dueInterest, total: acc.due.total + r.dueTotal },
            arrear: { principal: acc.arrear.principal + r.arrearPrincipal, interest: acc.arrear.interest + r.arrearInterest, total: acc.arrear.total + r.arrearTotal },
            outstanding: {
                principal: acc.outstanding.principal + r.outstandingPrincipal,
                interest: acc.outstanding.interest + r.outstandingInterest,
                total: acc.outstanding.total + r.outstandingTotal,
            },
        }),
        {
            due: { principal: 0, interest: 0, total: 0 },
            arrear: { principal: 0, interest: 0, total: 0 },
            outstanding: { principal: 0, interest: 0, total: 0 },
        }
    );

    return { rows: dataRows, totals };
}

// ── Entry point ──

export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const { searchParams } = new URL(request.url);
            const modal = searchParams.get('modal');
            const dateParam = searchParams.get('date');

            if (!dateParam || !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
                return errorResponse('A valid date (YYYY-MM-DD) is required', 400);
            }

            const { bIds, centerId } = await resolveScope(user, searchParams);

            const dayStartUtc = new Date(`${dateParam}T00:00:00+05:30`);
            const dayEndExclusiveUtc = new Date(dayStartUtc.getTime() + 24 * 60 * 60 * 1000);

            switch (modal) {
                case 'group-loans':
                    return successResponse(await getGroupLoanDetails({ bIds, centerId, dayStartUtc, dayEndExclusiveUtc, dateParam }));

                case 'group-members': {
                    const groupId = searchParams.get('groupId');
                    if (!groupId) return errorResponse('groupId is required', 400);
                    return successResponse(await getGroupMemberDetails({ groupId, dayStartUtc, dayEndExclusiveUtc, dateParam }));
                }

                case 'center-loans':
                    return successResponse(await getCenterLoanDetails({ bIds, centerId, dayStartUtc, dayEndExclusiveUtc, dateParam }));

                case 'center-members': {
                    const targetCenterId = searchParams.get('centerId');
                    if (!targetCenterId) return errorResponse('centerId is required', 400);
                    return successResponse(await getCenterMemberDetails({ centerId: targetCenterId, dayStartUtc, dayEndExclusiveUtc, dateParam }));
                }

                case 'collection': {
                    const mode = searchParams.get('mode') as CollectionMode | null;
                    if (!mode || !['Demand', 'Advance', 'Arrear', 'Preclose'].includes(mode)) {
                        return errorResponse('A valid mode (Demand|Advance|Arrear|Preclose) is required', 400);
                    }
                    return successResponse(await getCollectionDetails({ bIds, centerId, mode, dayStartUtc, dayEndExclusiveUtc }));
                }

                case 'overdue':
                    // A day that hasn't happened yet can't have anything "yet to collect" —
                    // mirrors the same-day guard in app/api/dashboard/v2/route.ts.
                    if (dateParam > getCalendarYmdInTimeZone(new Date(), 'Asia/Kolkata')) {
                        return successResponse({ rows: [], totals: { principal: 0, interest: 0, total: 0 } });
                    }
                    return successResponse(await getOverdue({ bIds, centerId, dayStartUtc, dayEndExclusiveUtc }));

                case 'arrear-overdue':
                    return successResponse(await getArrearOverdue({ bIds, centerId, dayStartUtc }));

                case 'zero-collection':
                    // Same future-day guard — a due date that hasn't arrived yet has no
                    // "zero collection" members, it simply hasn't been collected against yet.
                    if (dateParam > getCalendarYmdInTimeZone(new Date(), 'Asia/Kolkata')) {
                        return successResponse({ rows: [], totals: { due: { principal: 0, interest: 0, total: 0 }, arrear: { principal: 0, interest: 0, total: 0 }, outstanding: { principal: 0, interest: 0, total: 0 } } });
                    }
                    return successResponse(await getZeroCollection({ bIds, centerId, dayStartUtc, dayEndExclusiveUtc }));

                default:
                    return errorResponse('Invalid modal', 400);
            }
        } catch (error) {
            console.error('Demand drilldown API error:', error);
            return errorResponse(error instanceof Error ? error.message : 'Failed to fetch drilldown data', 500);
        }
    })(request);
}
