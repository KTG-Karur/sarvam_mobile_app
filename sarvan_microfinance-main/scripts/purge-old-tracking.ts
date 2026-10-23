// Deletes old live-tracking rows in small chunks so it never holds a long lock.
//   npm run db:purge:tracking            -> keep 90 days
//   TRACKING_RETENTION_DAYS=60 npm run db:purge:tracking
import { prisma } from '../app/lib/prisma';

const RETENTION_DAYS = Number(process.env.TRACKING_RETENTION_DAYS) || 90;
const CHUNK = 50_000;

async function purge(table: 'employee_location_pings' | 'employee_tracking_events', cutoff: Date): Promise<number> {
    let total = 0;
    for (;;) {
        const deleted = await prisma.$executeRawUnsafe(
            `DELETE FROM "${table}" WHERE "id" IN (SELECT "id" FROM "${table}" WHERE "capturedAt" < $1 LIMIT ${CHUNK})`,
            cutoff
        );
        total += deleted;
        console.log(`[purge-tracking] ${table}: deleted ${deleted} (total ${total})`);
        if (deleted < CHUNK) return total;
        await new Promise((r) => setTimeout(r, 200)); // let the DB breathe between chunks
    }
}

async function main() {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    console.log(`[purge-tracking] removing rows older than ${cutoff.toISOString()} (${RETENTION_DAYS} days)`);
    await purge('employee_location_pings', cutoff);
    await purge('employee_tracking_events', cutoff);
}

main()
    .catch((e) => {
        console.error(e);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
