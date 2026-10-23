/**
 * One-time script for the EmployeeTrackingEvent/EmployeeLocationPing split
 * (see attendance-hr/architecture-live-tracking.md).
 *
 * Historically, PUNCH_IN/PUNCH_OUT/CLIENT_VISIT rows were written into
 * EmployeeLocationPing alongside the continuous EN_ROUTE/IDLE_PING
 * background breadcrumbs. New code (app/api/hr/tracking/ping/route.ts and
 * both punch routes) now writes those three event types to the new
 * EmployeeTrackingEvent table instead — but existing historical rows are
 * still sitting in employee_location_pings until this script moves them.
 *
 * RUN ORDER (this is Phase 1 of a two-phase rollout — schema.prisma's
 * EmployeeLocationPing/EmployeeActivityType are DELIBERATELY still in their
 * original, unnarrowed shape for this phase):
 *   1. `npm run db:push` + `npm run db:generate` (adds EmployeeTrackingEvent;
 *      does NOT touch EmployeeLocationPing's existing columns/enum — purely
 *      additive, so nothing here can be lost by this step).
 *   2. Run this script: `npx tsx scripts/backfill-tracking-events.ts`
 *      (add `--dry-run` first to preview counts with zero writes).
 *   3. Verify counts look right (spot-check a few employees' tracking
 *      history still shows punches/visits correctly via the tracking pages).
 *   4. Only THEN — as a separate follow-up change, once you've confirmed
 *      step 3 — should EmployeeLocationPing's activityType enum be narrowed
 *      to EN_ROUTE|IDLE_PING and its clientId column dropped (Phase 2). Ask
 *      me to make that schema edit once you're ready; I will not do it
 *      automatically as part of this script.
 *
 * Idempotent: rows already present in EmployeeTrackingEvent are not
 * detected/de-duped by this script (there's no natural unique key shared
 * between the two tables), so only run this ONCE. If you need to re-run it
 * after a partial failure, clear out any partially-migrated rows in
 * employee_tracking_events first (or filter this script's source query by
 * capturedAt range to only touch what wasn't migrated yet).
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
    console.log(DRY_RUN ? '🔍 Dry run — no writes will happen.' : '🚚 Backfilling EmployeeTrackingEvent from legacy EmployeeLocationPing rows...');

    const legacyRows = await prisma.employeeLocationPing.findMany({
        where: { activityType: { in: ['PUNCH_IN', 'PUNCH_OUT', 'CLIENT_VISIT'] } },
        select: {
            employeeId: true,
            activityType: true,
            latitude: true,
            longitude: true,
            accuracyMeters: true,
            batteryPercent: true,
            capturedAt: true,
            clientId: true,
            branchId: true,
        },
        orderBy: { capturedAt: 'asc' },
    });

    console.log(`📋 Found ${legacyRows.length} legacy event row(s) to migrate.`);
    if (legacyRows.length === 0) {
        console.log('✅ Nothing to backfill.');
        return;
    }

    if (DRY_RUN) {
        console.log('Sample (first 5):', legacyRows.slice(0, 5));
        return;
    }

    let migrated = 0;
    for (const row of legacyRows) {
        await prisma.employeeTrackingEvent.create({
            data: {
                employeeId: row.employeeId,
                eventType: row.activityType as 'PUNCH_IN' | 'PUNCH_OUT' | 'CLIENT_VISIT',
                latitude: row.latitude,
                longitude: row.longitude,
                accuracyMeters: row.accuracyMeters,
                batteryPercent: row.batteryPercent,
                capturedAt: row.capturedAt,
                clientId: row.clientId,
                branchId: row.branchId,
            },
        });
        migrated++;
    }
    console.log(`✅ Migrated ${migrated} row(s) into employee_tracking_events.`);
    console.log('ℹ️  Old rows left in place in employee_location_pings — narrowing that table (Phase 2) is a separate follow-up step, not part of this script.');
}

main()
    .catch((e) => {
        console.error('❌ Backfill failed:', e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
