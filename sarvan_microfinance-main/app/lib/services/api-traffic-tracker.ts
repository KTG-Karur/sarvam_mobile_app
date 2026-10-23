import { prisma } from '@/app/lib/db';
import { getKolkataCalendarYmd } from '@/app/lib/branch-lock';
import type { LoginPlatform } from '@/app/lib/services/user-activity-tracker';

/**
 * Counts authenticated API requests for capacity planning (User Login Activity → Current (Live)).
 *
 * Requests are tallied in memory per UTC minute + platform and per IST day + endpoint, then
 * flushed to `api_traffic_minutes` / `api_traffic_endpoint_days` every FLUSH_MS. Nothing here may
 * slow down or fail a request: recordApiCall only bumps a Map, and flush errors are swallowed.
 * With several Node processes (pm2 cluster) each flushes its own increments, so totals add up.
 */

const FLUSH_MS = 30_000;
const MAX_ENDPOINTS_PER_FLUSH = 400;
const RETENTION_DAYS = 120;

type Store = {
    minutes: Map<string, number>; // `${minuteIso}|${platform}`
    endpoints: Map<string, number>; // `${ymd}|${platform}|${path}`
    timer?: ReturnType<typeof setInterval>;
    lastCleanupDay?: string;
};

// globalThis so dev-mode module re-evaluation doesn't spawn a second flush timer.
const g = globalThis as typeof globalThis & { __apiTraffic?: Store };

function store(): Store {
    if (!g.__apiTraffic) {
        g.__apiTraffic = { minutes: new Map(), endpoints: new Map() };
        const timer = setInterval(() => {
            flush().catch((err) => console.error('[ApiTraffic] flush failed:', err));
        }, FLUSH_MS);
        timer.unref?.();
        g.__apiTraffic.timer = timer;
    }
    return g.__apiTraffic;
}

/** `/api/loans/cmab12…/schedule` → `/loans/:id/schedule` */
export function normalizeApiPath(pathname: string): string {
    const trimmed = pathname.replace(/^\/api/, '').split('?')[0] || '/';
    return trimmed
        .split('/')
        .map((seg) => (/^\d+$/.test(seg) || /^[0-9a-f]{8,}$/i.test(seg) || /^c[a-z0-9]{20,}$/i.test(seg) ? ':id' : seg))
        .join('/')
        .slice(0, 160);
}

export function recordApiCall(platform: LoginPlatform, pathname: string): void {
    try {
        const s = store();
        const now = new Date();
        const minute = new Date(Math.floor(now.getTime() / 60_000) * 60_000).toISOString();
        const mk = `${minute}|${platform}`;
        s.minutes.set(mk, (s.minutes.get(mk) ?? 0) + 1);
        if (pathname) {
            const ek = `${getKolkataCalendarYmd(now)}|${platform}|${normalizeApiPath(pathname)}`;
            s.endpoints.set(ek, (s.endpoints.get(ek) ?? 0) + 1);
        }
    } catch {
        // tracking must never affect a request
    }
}

async function flush(): Promise<void> {
    const s = store();
    if (s.minutes.size === 0 && s.endpoints.size === 0) return;
    const minutes = [...s.minutes.entries()];
    const endpoints = [...s.endpoints.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_ENDPOINTS_PER_FLUSH);
    s.minutes.clear();
    s.endpoints.clear();

    for (const [key, requests] of minutes) {
        const [bucketIso, platform] = key.split('|');
        const bucket = new Date(bucketIso);
        await prisma.apiTrafficMinute.upsert({
            where: { bucket_platform: { bucket, platform: platform as LoginPlatform } },
            create: { bucket, platform: platform as LoginPlatform, requests },
            update: { requests: { increment: requests } },
        });
    }
    for (const [key, requests] of endpoints) {
        const [ymd, platform, ...rest] = key.split('|');
        const path = rest.join('|');
        const day = new Date(`${ymd}T00:00:00.000Z`);
        await prisma.apiTrafficEndpointDay.upsert({
            where: { day_path_platform: { day, path, platform: platform as LoginPlatform } },
            create: { day, path, platform: platform as LoginPlatform, requests },
            update: { requests: { increment: requests } },
        });
    }

    const today = getKolkataCalendarYmd(new Date());
    if (s.lastCleanupDay !== today) {
        s.lastCleanupDay = today;
        const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000);
        await prisma.apiTrafficMinute.deleteMany({ where: { bucket: { lt: cutoff } } });
        await prisma.apiTrafficEndpointDay.deleteMany({ where: { day: { lt: cutoff } } });
    }
}
