import { PrismaClient } from '@prisma/client';

// PrismaClient is attached to the `global` object (in every environment) to
// guarantee exactly one instance — and therefore one bounded connection pool
// — per process, regardless of which module (this file or app/lib/db.ts,
// which just re-exports this) gets imported first. The underlying Postgres
// instance has a very low max_connections, so an uncapped/default pool size
// here is what exhausts it.
//
// Learn more:
// https://pris.ly/d/help/next-js-best-practices

const DEFAULT_CONNECTION_LIMIT = Number(process.env.DB_CONNECTION_LIMIT) || 5;
// Seconds a query waits for a free pooled connection before failing.
const DEFAULT_POOL_TIMEOUT = Number(process.env.DB_POOL_TIMEOUT) || 20;

function resolveDatabaseUrl(): string {
    const raw = process.env.DATABASE_URL;
    if (!raw) {
        throw new Error('DATABASE_URL environment variable is not set.');
    }
    if (process.env.PRISMA_DISABLE_POOL_CAP === '1') {
        return raw;
    }
    if (raw.startsWith('prisma://') || raw.startsWith('prisma+')) {
        return raw;
    }
    try {
        const u = new URL(raw);
        if (u.protocol !== 'postgresql:' && u.protocol !== 'postgres:') {
            return raw;
        }
        if (!u.searchParams.has('connection_limit')) {
            u.searchParams.set('connection_limit', String(DEFAULT_CONNECTION_LIMIT));
        }
        if (!u.searchParams.has('pool_timeout')) {
            u.searchParams.set('pool_timeout', String(DEFAULT_POOL_TIMEOUT));
        }
        return u.toString();
    } catch {
        return raw;
    }
}

const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma =
    globalForPrisma.prisma ||
    new PrismaClient({
        datasources: { db: { url: resolveDatabaseUrl() } },
        log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    });

globalForPrisma.prisma = prisma;

export default prisma;
