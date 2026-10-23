import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

/**
 * Seeds user_login_activities (User Login Activity report) from usage that was
 * recorded before the tracker existed. History is PARTIAL by nature:
 *  - device_login_histories: mobile logins since the device-binding feature, but
 *    only one row per device session (no row for repeat logins while one is open).
 *  - refresh_tokens: one row per web/mobile login or web token refresh, but rows are
 *    deleted on logout/rotation, so mostly only recent sessions survive. Mobile
 *    tokens are the ones with the far-future (year 9999) expiry.
 * Each surviving row proves that user used that platform on that IST day.
 * Idempotent: only adds a day/platform row when none exists (never overwrites live tracking).
 *
 *   npx tsx scripts/backfill-user-login-activity.ts           # dry-run
 *   npx tsx scripts/backfill-user-login-activity.ts --apply
 */
const prisma = new PrismaClient();

async function main() {
    const apply = process.argv.includes('--apply');

    const source = `
        WITH events AS (
            SELECT "userId", 'MOBILE'::"LoginPlatform" AS platform, "loginAt" AS at, "deviceName", "ipAddress", 1 AS is_login
            FROM device_login_histories
            UNION ALL
            SELECT "userId",
                   CASE WHEN "expiresAt" > TIMESTAMP '2100-01-01' THEN 'MOBILE' ELSE 'WEB' END::"LoginPlatform",
                   "createdAt", NULL, NULL, 0
            FROM refresh_tokens
        )
        SELECT "userId",
               (at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date AS "activityDate",
               platform,
               SUM(is_login)::int AS "loginCount",
               MIN(at) AS "firstSeenAt",
               MAX(at) AS "lastSeenAt",
               MAX(at) FILTER (WHERE is_login = 1) AS "lastLoginAt",
               (ARRAY_AGG("deviceName" ORDER BY at DESC) FILTER (WHERE "deviceName" IS NOT NULL))[1] AS "deviceName",
               (ARRAY_AGG("ipAddress" ORDER BY at DESC) FILTER (WHERE "ipAddress" IS NOT NULL))[1] AS "ipAddress"
        FROM events
        WHERE "userId" IN (SELECT id FROM users)
        GROUP BY 1, 2, 3`;

    const [{ candidates }] = await prisma.$queryRawUnsafe<Array<{ candidates: number }>>(
        `SELECT COUNT(*)::int AS candidates FROM (${source}) s
         WHERE NOT EXISTS (SELECT 1 FROM user_login_activities a
                           WHERE a."userId" = s."userId" AND a."activityDate" = s."activityDate" AND a.platform = s.platform)`
    );

    let inserted = 0;
    if (apply) {
        inserted = await prisma.$executeRawUnsafe(
            `INSERT INTO user_login_activities
                 (id, "userId", "activityDate", platform, "loginCount", "firstSeenAt", "lastSeenAt", "lastLoginAt", "deviceName", "ipAddress")
             SELECT 'bf_' || md5(s."userId" || s."activityDate"::text || s.platform::text),
                    s."userId", s."activityDate", s.platform, s."loginCount", s."firstSeenAt", s."lastSeenAt", s."lastLoginAt", s."deviceName", s."ipAddress"
             FROM (${source}) s
             ON CONFLICT ("userId", "activityDate", platform) DO NOTHING`
        );
    }

    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', userDayPlatformRowsToAdd: candidates, inserted }, null, 2));
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
