import Redis from 'ioredis';

// Attached to the `global` object (same trick as app/lib/prisma.ts) to
// guarantee exactly one ioredis connection per process, regardless of how
// many times/places this module gets imported — Next.js dev hot-reload and
// route-module re-imports would otherwise each open a fresh connection.
//
// The client is created LAZILY on first use, never at import: `next build`
// imports every route module while collecting page data, so throwing (or
// opening a socket) at module load would fail the build whenever REDIS_URL
// isn't set. Every caller already wraps its redis calls in try/catch and
// falls back to the DB, so a missing REDIS_URL just means "no cache".

function resolveRedisUrl(): string {
    const raw = process.env.REDIS_URL;
    if (!raw) {
        throw new Error('REDIS_URL environment variable is not set.');
    }
    return raw;
}

const globalForRedis = global as unknown as { redis?: Redis };

function getRedisClient(): Redis {
    if (globalForRedis.redis) return globalForRedis.redis;

    const client = new Redis(resolveRedisUrl(), {
        // Fail fast, not forever: every caller already wraps redis.* calls in
        // try/catch and falls back to the DB, so a command should reject
        // quickly when Redis is unreachable (e.g. no local Redis in dev)
        // rather than queue and hang indefinitely — maxRetriesPerRequest:
        // null + the default offline queue meant a single request would hang
        // forever waiting for a connection that may never come.
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        connectTimeout: 2000,
        enableReadyCheck: true,
        retryStrategy(attempt: number) {
            return Math.min(attempt * 200, 5000);
        },
    });
    client.on('connect', () => {
        console.log('[redis] connected');
    });
    client.on('reconnecting', (delay: number) => {
        console.warn(`[redis] reconnecting in ${delay}ms`);
    });
    client.on('error', (err: Error) => {
        console.error('[redis] connection error:', err.message);
    });

    globalForRedis.redis = client;
    return client;
}

// Proxy so existing `redis.get(...)` call sites keep working unchanged while
// the real connection is only opened on the first property access.
export const redis = new Proxy({} as Redis, {
    get(_target, prop) {
        const client = getRedisClient();
        const value = Reflect.get(client, prop, client);
        return typeof value === 'function' ? value.bind(client) : value;
    },
});

export default redis;
