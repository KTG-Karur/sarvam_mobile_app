import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/db';
import { withRole, errorResponse, successResponse, handleCorsPreflight } from '@/app/lib/api-utils';
import { getKolkataCalendarYmd } from '@/app/lib/branch-lock';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const querySchema = z.object({
    windowMinutes: z.coerce.number().int().min(1).max(60).default(10),
    branchId: z.string().default('ALL'),
});

export type LiveOnlineUser = {
    userId: string;
    employeeId: string | null;
    name: string;
    role: string;
    branchName: string;
    platforms: ('WEB' | 'MOBILE')[];
    lastSeenAt: string;
    device: string | null;
    ip: string | null;
};

export type LiveReport = {
    asOf: string;
    windowMinutes: number;
    online: { web: number; mobile: number; both: number; total: number };
    users: LiveOnlineUser[];
    traffic: {
        /** Requests in the last COMPLETED minute / last 5 min / today, all platforms. */
        perMinuteNow: number;
        last5Minutes: number;
        today: number;
        peakPerMinuteToday: number;
        avgPerMinuteLastHour: number;
        webToday: number;
        mobileToday: number;
        minutes: { minute: string; web: number; mobile: number }[]; // last 60 min, oldest first
        hourly: { hour: string; requests: number; peakPerMinute: number }[]; // today (IST)
        daily: { day: string; requests: number; peakPerMinute: number }[]; // last 30 days
        topEndpoints: { path: string; web: number; mobile: number; total: number }[];
        trackingStartedAt: string | null;
    };
};

type MinuteRow = { bucket: Date; platform: 'WEB' | 'MOBILE'; requests: number };

/**
 * GET /api/reports/others/user-login-activity/live
 * Who is using the software right now (Web / Mobile) and how many API calls are coming in —
 * the numbers needed to size server cores / RAM / DB.
 * Sources: user_login_activities.lastSeenAt (written at most every 5 min per user, so the
 * default 10 min window is the smallest that never misses an active user) and
 * api_traffic_minutes / api_traffic_endpoint_days (api-traffic-tracker.ts).
 */
export async function GET(request: NextRequest) {
    return withRole(['ADMIN'], async (req) => {
        try {
            const sp = req.nextUrl.searchParams;
            const q = querySchema.parse({
                windowMinutes: sp.get('windowMinutes') ?? undefined,
                branchId: sp.get('branchId') ?? undefined,
            });

            const now = new Date();
            const since = new Date(now.getTime() - q.windowMinutes * 60_000);
            const todayYmd = getKolkataCalendarYmd(now);
            const todayStart = new Date(`${todayYmd}T00:00:00+05:30`);
            const yesterday = new Date(`${todayYmd}T00:00:00.000Z`);
            yesterday.setUTCDate(yesterday.getUTCDate() - 1);
            const hourAgo = new Date(now.getTime() - 60 * 60_000);
            const thirtyDaysAgo = new Date(todayStart.getTime() - 29 * 86_400_000);

            // ── online users ──
            const activity = await prisma.userLoginActivity.findMany({
                where: {
                    activityDate: { gte: yesterday },
                    lastSeenAt: { gte: since },
                    ...(q.branchId !== 'ALL' ? { branchId: q.branchId } : {}),
                },
                select: { userId: true, platform: true, lastSeenAt: true, deviceName: true, ipAddress: true },
                orderBy: { lastSeenAt: 'desc' },
            });
            const userIds = [...new Set(activity.map((a) => a.userId))];
            const people = userIds.length
                ? await prisma.user.findMany({
                      where: { id: { in: userIds } },
                      select: {
                          id: true,
                          employeeId: true,
                          firstName: true,
                          lastName: true,
                          role: true,
                          branch: { select: { code: true, name: true } },
                          userRoles: { where: { isActive: true }, orderBy: { createdAt: 'desc' }, take: 1, select: { role: { select: { name: true } } } },
                      },
                  })
                : [];
            const personById = new Map(people.map((p) => [p.id, p]));
            const byUser = new Map<string, LiveOnlineUser>();
            for (const a of activity) {
                const p = personById.get(a.userId);
                const existing = byUser.get(a.userId);
                if (existing) {
                    if (!existing.platforms.includes(a.platform)) existing.platforms.push(a.platform);
                    continue;
                }
                byUser.set(a.userId, {
                    userId: a.userId,
                    employeeId: p?.employeeId ?? null,
                    name: `${p?.firstName ?? ''} ${p?.lastName ?? ''}`.trim() || (p?.employeeId ?? '-'),
                    role: p?.userRoles[0]?.role.name ?? p?.role ?? '-',
                    branchName: p?.branch ? `${p.branch.code} - ${p.branch.name}` : '-',
                    platforms: [a.platform],
                    lastSeenAt: a.lastSeenAt.toISOString(),
                    device: a.deviceName,
                    ip: a.ipAddress,
                });
            }
            const users = [...byUser.values()];
            const web = users.filter((u) => u.platforms.includes('WEB')).length;
            const mobile = users.filter((u) => u.platforms.includes('MOBILE')).length;
            const both = users.filter((u) => u.platforms.length > 1).length;

            // ── API traffic ──
            const [lastHourRows, todayAgg, hourlyRows, dailyRows, endpointRows, firstRow] = await Promise.all([
                prisma.$queryRaw<MinuteRow[]>`
                    SELECT bucket, platform::text AS platform, requests
                    FROM api_traffic_minutes WHERE bucket >= ${hourAgo} ORDER BY bucket`,
                prisma.$queryRaw<{ total: number; web: number; mobile: number; peak: number }[]>`
                    SELECT COALESCE(SUM(requests),0)::int AS total,
                           COALESCE(SUM(requests) FILTER (WHERE platform = 'WEB'),0)::int AS web,
                           COALESCE(SUM(requests) FILTER (WHERE platform = 'MOBILE'),0)::int AS mobile,
                           COALESCE((SELECT MAX(t) FROM (SELECT SUM(requests) AS t FROM api_traffic_minutes
                                     WHERE bucket >= ${todayStart} GROUP BY bucket) m),0)::int AS peak
                    FROM api_traffic_minutes WHERE bucket >= ${todayStart}`,
                prisma.$queryRaw<{ hour: string; requests: number; peak: number }[]>`
                    SELECT hour, SUM(t)::int AS requests, MAX(t)::int AS peak FROM (
                        SELECT to_char(bucket AT TIME ZONE 'Asia/Kolkata', 'HH24') AS hour, bucket, SUM(requests) AS t
                        FROM api_traffic_minutes WHERE bucket >= ${todayStart} GROUP BY 1, 2
                    ) x GROUP BY hour ORDER BY hour`,
                prisma.$queryRaw<{ day: string; requests: number; peak: number }[]>`
                    SELECT day, SUM(t)::int AS requests, MAX(t)::int AS peak FROM (
                        SELECT to_char(bucket AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS day, bucket, SUM(requests) AS t
                        FROM api_traffic_minutes WHERE bucket >= ${thirtyDaysAgo} GROUP BY 1, 2
                    ) x GROUP BY day ORDER BY day`,
                prisma.$queryRaw<{ path: string; web: number; mobile: number }[]>`
                    SELECT path,
                           COALESCE(SUM(requests) FILTER (WHERE platform = 'WEB'),0)::int AS web,
                           COALESCE(SUM(requests) FILTER (WHERE platform = 'MOBILE'),0)::int AS mobile
                    FROM api_traffic_endpoint_days WHERE day = ${new Date(`${todayYmd}T00:00:00.000Z`)}
                    GROUP BY path ORDER BY SUM(requests) DESC LIMIT 15`,
                prisma.$queryRaw<{ first: Date | null }[]>`SELECT MIN(bucket) AS first FROM api_traffic_minutes`,
            ]);

            // last 60 minutes, filled with zeros so gaps show as gaps
            const perMinute = new Map<string, { web: number; mobile: number }>();
            for (const r of lastHourRows) {
                const k = new Date(r.bucket).toISOString();
                const cur = perMinute.get(k) ?? { web: 0, mobile: 0 };
                if (r.platform === 'WEB') cur.web += r.requests;
                else cur.mobile += r.requests;
                perMinute.set(k, cur);
            }
            const minutes: LiveReport['traffic']['minutes'] = [];
            const thisMinute = Math.floor(now.getTime() / 60_000) * 60_000;
            for (let i = 59; i >= 0; i--) {
                const iso = new Date(thisMinute - i * 60_000).toISOString();
                const v = perMinute.get(iso) ?? { web: 0, mobile: 0 };
                minutes.push({ minute: iso, ...v });
            }
            const tot = (m: { web: number; mobile: number }) => m.web + m.mobile;
            const lastComplete = minutes[minutes.length - 2];
            const agg = todayAgg[0] ?? { total: 0, web: 0, mobile: 0, peak: 0 };

            const report: LiveReport = {
                asOf: now.toISOString(),
                windowMinutes: q.windowMinutes,
                online: { web, mobile, both, total: users.length },
                users,
                traffic: {
                    perMinuteNow: lastComplete ? tot(lastComplete) : 0,
                    last5Minutes: minutes.slice(-6, -1).reduce((s, m) => s + tot(m), 0),
                    today: agg.total,
                    peakPerMinuteToday: agg.peak,
                    avgPerMinuteLastHour: Math.round(minutes.reduce((s, m) => s + tot(m), 0) / 60),
                    webToday: agg.web,
                    mobileToday: agg.mobile,
                    minutes,
                    hourly: hourlyRows.map((h) => ({ hour: h.hour, requests: h.requests, peakPerMinute: h.peak })),
                    daily: dailyRows.map((d) => ({ day: d.day, requests: d.requests, peakPerMinute: d.peak })),
                    topEndpoints: endpointRows.map((e) => ({ path: e.path, web: e.web, mobile: e.mobile, total: e.web + e.mobile })),
                    trackingStartedAt: firstRow[0]?.first ? new Date(firstRow[0].first).toISOString() : null,
                },
            };
            return successResponse(report, 'Live usage fetched');
        } catch (error) {
            if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
            console.error('[user-login-activity/live] Error:', error);
            return errorResponse(error instanceof Error ? error.message : 'Failed to fetch live usage', 500);
        }
    })(request);
}
