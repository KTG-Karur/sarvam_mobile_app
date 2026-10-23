import { prisma } from '@/app/lib/db';
import { getKolkataCalendarYmd } from '@/app/lib/branch-lock';

/**
 * Records who used the software, per IST day and platform (WEB / MOBILE), into
 * `user_login_activities` for the User Login Activity report.
 *
 * Two entry points:
 *  - recordUserLogin()      — on every successful web / mobile login (counted).
 *  - trackRequestActivity() — on every authenticated API request, throttled in
 *    memory to at most one DB write per user/platform per THROTTLE_MS. Needed
 *    because web tokens live 72h and mobile tokens never expire, so most days a
 *    user works without logging in at all.
 *
 * Both are fire-and-forget: tracking must never slow down or fail a request.
 */

export type LoginPlatform = 'WEB' | 'MOBILE';

const THROTTLE_MS = 5 * 60 * 1000;

// globalThis so dev-mode module re-evaluation doesn't reset the throttle map.
const globalForTracker = globalThis as typeof globalThis & {
    __userActivityLastWrite?: Map<string, number>;
    __userActivityDay?: string;
};

function throttleMap(today: string): Map<string, number> {
    if (!globalForTracker.__userActivityLastWrite || globalForTracker.__userActivityDay !== today) {
        // New IST day — start fresh (also keeps the map from growing forever).
        globalForTracker.__userActivityLastWrite = new Map();
        globalForTracker.__userActivityDay = today;
    }
    return globalForTracker.__userActivityLastWrite;
}

/** `@db.Date` value for an IST calendar day. */
function toDateOnly(ymd: string): Date {
    return new Date(`${ymd}T00:00:00.000Z`);
}

/** Mobile tokens are issued without `exp` (never expire) and, from now on, with platform: 'MOBILE'. */
export function detectPlatformFromToken(payload: { exp?: number; platform?: string }): LoginPlatform {
    if (payload.platform === 'MOBILE') return 'MOBILE';
    if (payload.platform === 'WEB') return 'WEB';
    return payload.exp === undefined ? 'MOBILE' : 'WEB';
}

export function getClientIp(headers: Headers): string | null {
    const forwarded = headers.get('x-forwarded-for');
    if (forwarded) return forwarded.split(',')[0]?.trim() || null;
    return headers.get('x-real-ip');
}

async function upsertActivity(input: {
    userId: string;
    platform: LoginPlatform;
    branchId?: string | null;
    ipAddress?: string | null;
    deviceName?: string | null;
    isLogin: boolean;
}): Promise<void> {
    const now = new Date();
    const activityDate = toDateOnly(getKolkataCalendarYmd(now));
    const optional = {
        ...(input.branchId ? { branchId: input.branchId } : {}),
        ...(input.ipAddress ? { ipAddress: input.ipAddress } : {}),
        ...(input.deviceName ? { deviceName: input.deviceName } : {}),
    };
    await prisma.userLoginActivity.upsert({
        where: { userId_activityDate_platform: { userId: input.userId, activityDate, platform: input.platform } },
        create: {
            userId: input.userId,
            activityDate,
            platform: input.platform,
            loginCount: input.isLogin ? 1 : 0,
            firstSeenAt: now,
            lastSeenAt: now,
            lastLoginAt: input.isLogin ? now : null,
            ...optional,
        },
        update: {
            lastSeenAt: now,
            ...(input.isLogin ? { loginCount: { increment: 1 }, lastLoginAt: now } : {}),
            ...optional,
        },
    });
}

export function recordUserLogin(input: {
    userId: string;
    platform: LoginPlatform;
    branchId?: string | null;
    ipAddress?: string | null;
    deviceName?: string | null;
}): void {
    try {
        const today = getKolkataCalendarYmd(new Date());
        throttleMap(today).set(`${input.userId}|${input.platform}`, Date.now());
        upsertActivity({ ...input, isLogin: true }).catch((err) =>
            console.error('[UserActivityTracker] Failed to record login:', err)
        );
    } catch (err) {
        console.error('[UserActivityTracker] Login tracking skipped:', err);
    }
}

export function trackRequestActivity(input: {
    userId: string;
    platform: LoginPlatform;
    branchId?: string | null;
    ipAddress?: string | null;
}): void {
    // Called from getAuthenticatedUser on every API request — a throw here would turn
    // into a 401 for the user, so nothing may escape.
    try {
        const today = getKolkataCalendarYmd(new Date());
        const map = throttleMap(today);
        const key = `${input.userId}|${input.platform}`;
        const last = map.get(key);
        if (last !== undefined && Date.now() - last < THROTTLE_MS) return;
        map.set(key, Date.now());
        upsertActivity({ ...input, isLogin: false }).catch((err) =>
            console.error('[UserActivityTracker] Failed to record activity:', err)
        );
    } catch (err) {
        console.error('[UserActivityTracker] Tracking skipped:', err);
    }
}
