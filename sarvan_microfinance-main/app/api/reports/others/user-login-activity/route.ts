import { NextRequest } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/app/lib/db';
import { withRole, errorResponse, successResponse, handleCorsPreflight } from '@/app/lib/api-utils';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const querySchema = z.object({
    fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'From Date is required'),
    toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'To Date is required'),
    groupBy: z.enum(['DAY', 'MONTH', 'YEAR']).default('DAY'),
    branchId: z.string().default('ALL'),
});

export type LoginActivityPeriodRow = {
    period: string; // YYYY-MM-DD | YYYY-MM | YYYY
    webUsers: number;
    mobileUsers: number;
    bothUsers: number;
    totalUsers: number;
    webLogins: number;
    mobileLogins: number;
};

export type LoginActivityUserRow = {
    userId: string;
    employeeId: string | null;
    name: string;
    role: string;
    branchName: string;
    isActive: boolean;
    status: 'BOTH' | 'WEB' | 'MOBILE' | 'NOT_USED';
    webDays: number;
    mobileDays: number;
    webLogins: number;
    mobileLogins: number;
    firstSeenAt: string | null;
    lastWebAt: string | null;
    lastMobileAt: string | null;
    lastDevice: string | null;
    lastIp: string | null;
};

export type LoginActivityReport = {
    summary: {
        totalEmployees: number;
        activeUsers: number;
        webUsers: number;
        mobileUsers: number;
        bothUsers: number;
        notUsed: number;
        webLogins: number;
        mobileLogins: number;
    };
    periods: LoginActivityPeriodRow[];
    users: LoginActivityUserRow[];
};

/**
 * GET /api/reports/others/user-login-activity
 * Who used the software on Web / Mobile, grouped by day, month or year.
 * Source: user_login_activities (app/lib/services/user-activity-tracker.ts).
 */
export async function GET(request: NextRequest) {
    return withRole(['ADMIN'], async (req) => {
        try {
            const sp = req.nextUrl.searchParams;
            const q = querySchema.parse({
                fromDate: sp.get('fromDate') ?? undefined,
                toDate: sp.get('toDate') ?? undefined,
                groupBy: sp.get('groupBy') ?? undefined,
                branchId: sp.get('branchId') ?? undefined,
            });
            if (q.fromDate > q.toDate) return errorResponse('From Date cannot be after To Date', 400);

            const from = new Date(`${q.fromDate}T00:00:00.000Z`);
            const to = new Date(`${q.toDate}T00:00:00.000Z`);
            const inRange = { activityDate: { gte: from, lte: to } };

            // Employees in scope: everyone active, plus anyone (even since-deactivated)
            // who actually used the software in the range. Branch = home branch, or any
            // assigned branch for Area Managers.
            const branchWhere: Prisma.UserWhereInput =
                q.branchId === 'ALL'
                    ? {}
                    : { OR: [{ branchId: q.branchId }, { areaManagerBranches: { some: { branchId: q.branchId } } }] };
            const users = await prisma.user.findMany({
                where: {
                    AND: [branchWhere, { OR: [{ isActive: true }, { loginActivities: { some: inRange } }] }],
                },
                select: {
                    id: true,
                    employeeId: true,
                    firstName: true,
                    lastName: true,
                    role: true,
                    isActive: true,
                    branch: { select: { code: true, name: true } },
                    areaManagerBranches: {
                        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
                        take: 1,
                        select: { branch: { select: { code: true, name: true } } },
                    },
                    userRoles: {
                        where: { isActive: true },
                        orderBy: { createdAt: 'desc' },
                        take: 1,
                        select: { role: { select: { name: true } } },
                    },
                },
            });
            const userIds = users.map((u) => u.id);
            if (userIds.length === 0) {
                return successResponse<LoginActivityReport>({
                    summary: { totalEmployees: 0, activeUsers: 0, webUsers: 0, mobileUsers: 0, bothUsers: 0, notUsed: 0, webLogins: 0, mobileLogins: 0 },
                    periods: [],
                    users: [],
                });
            }

            const unit = q.groupBy === 'DAY' ? 'day' : q.groupBy === 'MONTH' ? 'month' : 'year';
            const fmt = q.groupBy === 'DAY' ? 'YYYY-MM-DD' : q.groupBy === 'MONTH' ? 'YYYY-MM' : 'YYYY';

            const [periodRows, userAgg, lastSeen] = await Promise.all([
                prisma.$queryRaw<Array<{
                    period: string; webUsers: number; mobileUsers: number; bothUsers: number;
                    totalUsers: number; webLogins: number; mobileLogins: number;
                }>>`
                    WITH per_user AS (
                        SELECT to_char(date_trunc(${unit}, "activityDate"), ${fmt}) AS period,
                               "userId",
                               bool_or(platform = 'WEB')    AS used_web,
                               bool_or(platform = 'MOBILE') AS used_mobile,
                               COALESCE(SUM("loginCount") FILTER (WHERE platform = 'WEB'), 0)    AS web_logins,
                               COALESCE(SUM("loginCount") FILTER (WHERE platform = 'MOBILE'), 0) AS mobile_logins
                        FROM user_login_activities
                        WHERE "activityDate" BETWEEN ${from} AND ${to}
                          AND "userId" = ANY(${userIds}::text[])
                        GROUP BY 1, 2
                    )
                    SELECT period,
                           COUNT(*) FILTER (WHERE used_web)::int                    AS "webUsers",
                           COUNT(*) FILTER (WHERE used_mobile)::int                 AS "mobileUsers",
                           COUNT(*) FILTER (WHERE used_web AND used_mobile)::int    AS "bothUsers",
                           COUNT(*)::int                                            AS "totalUsers",
                           SUM(web_logins)::int                                     AS "webLogins",
                           SUM(mobile_logins)::int                                  AS "mobileLogins"
                    FROM per_user
                    GROUP BY period
                    ORDER BY period`,
                prisma.$queryRaw<Array<{
                    userId: string; webDays: number; mobileDays: number; webLogins: number; mobileLogins: number;
                    firstSeenAt: Date | null; lastWebAt: Date | null; lastMobileAt: Date | null;
                }>>`
                    SELECT "userId",
                           COUNT(*) FILTER (WHERE platform = 'WEB')::int                          AS "webDays",
                           COUNT(*) FILTER (WHERE platform = 'MOBILE')::int                       AS "mobileDays",
                           COALESCE(SUM("loginCount") FILTER (WHERE platform = 'WEB'), 0)::int    AS "webLogins",
                           COALESCE(SUM("loginCount") FILTER (WHERE platform = 'MOBILE'), 0)::int AS "mobileLogins",
                           MIN("firstSeenAt")                                                     AS "firstSeenAt",
                           MAX("lastSeenAt") FILTER (WHERE platform = 'WEB')                      AS "lastWebAt",
                           MAX("lastSeenAt") FILTER (WHERE platform = 'MOBILE')                   AS "lastMobileAt"
                    FROM user_login_activities
                    WHERE "activityDate" BETWEEN ${from} AND ${to}
                      AND "userId" = ANY(${userIds}::text[])
                    GROUP BY "userId"`,
                prisma.$queryRaw<Array<{ userId: string; deviceName: string | null; ipAddress: string | null }>>`
                    SELECT DISTINCT ON ("userId") "userId", "deviceName", "ipAddress"
                    FROM user_login_activities
                    WHERE "activityDate" BETWEEN ${from} AND ${to}
                      AND "userId" = ANY(${userIds}::text[])
                    ORDER BY "userId", "lastSeenAt" DESC`,
            ]);

            const aggByUser = new Map(userAgg.map((a) => [a.userId, a]));
            const lastByUser = new Map(lastSeen.map((l) => [l.userId, l]));
            const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);

            const userRows: LoginActivityUserRow[] = users.map((u) => {
                const a = aggByUser.get(u.id);
                const webDays = a?.webDays ?? 0;
                const mobileDays = a?.mobileDays ?? 0;
                const status: LoginActivityUserRow['status'] =
                    webDays > 0 && mobileDays > 0 ? 'BOTH' : webDays > 0 ? 'WEB' : mobileDays > 0 ? 'MOBILE' : 'NOT_USED';
                const branch = u.branch ?? u.areaManagerBranches[0]?.branch ?? null;
                return {
                    userId: u.id,
                    employeeId: u.employeeId,
                    name: `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || (u.employeeId ?? '-'),
                    role: u.userRoles[0]?.role.name ?? u.role,
                    branchName: branch ? `${branch.code} - ${branch.name}` : '-',
                    isActive: u.isActive,
                    status,
                    webDays,
                    mobileDays,
                    webLogins: a?.webLogins ?? 0,
                    mobileLogins: a?.mobileLogins ?? 0,
                    firstSeenAt: iso(a?.firstSeenAt),
                    lastWebAt: iso(a?.lastWebAt),
                    lastMobileAt: iso(a?.lastMobileAt),
                    lastDevice: lastByUser.get(u.id)?.deviceName ?? null,
                    lastIp: lastByUser.get(u.id)?.ipAddress ?? null,
                };
            });

            // Most recently active first; never-used employees last, by Emp ID.
            const lastAt = (r: LoginActivityUserRow) => Math.max(r.lastWebAt ? Date.parse(r.lastWebAt) : 0, r.lastMobileAt ? Date.parse(r.lastMobileAt) : 0);
            userRows.sort((x, y) => lastAt(y) - lastAt(x) || (x.employeeId ?? '').localeCompare(y.employeeId ?? ''));

            const count = (s: LoginActivityUserRow['status'][]) => userRows.filter((r) => s.includes(r.status)).length;
            const report: LoginActivityReport = {
                summary: {
                    totalEmployees: userRows.length,
                    activeUsers: count(['BOTH', 'WEB', 'MOBILE']),
                    webUsers: count(['BOTH', 'WEB']),
                    mobileUsers: count(['BOTH', 'MOBILE']),
                    bothUsers: count(['BOTH']),
                    notUsed: count(['NOT_USED']),
                    webLogins: userRows.reduce((s, r) => s + r.webLogins, 0),
                    mobileLogins: userRows.reduce((s, r) => s + r.mobileLogins, 0),
                },
                periods: periodRows,
                users: userRows,
            };
            return successResponse(report, 'User login activity fetched');
        } catch (error) {
            if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
            console.error('[user-login-activity] Error:', error);
            return errorResponse(error instanceof Error ? error.message : 'Failed to fetch user login activity', 500);
        }
    })(request);
}
