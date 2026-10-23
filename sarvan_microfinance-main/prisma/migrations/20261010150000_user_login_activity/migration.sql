-- User Login Activity report: one row per user per IST day per platform (WEB / MOBILE).
-- Idempotent so it is safe whether the table was already created via `prisma db push`.
DO $$ BEGIN
  CREATE TYPE "LoginPlatform" AS ENUM ('WEB', 'MOBILE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "user_login_activities" (
  "id"           TEXT NOT NULL,
  "userId"       TEXT NOT NULL,
  "activityDate" DATE NOT NULL,
  "platform"     "LoginPlatform" NOT NULL,
  "branchId"     TEXT,
  "loginCount"   INTEGER NOT NULL DEFAULT 0,
  "firstSeenAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastLoginAt"  TIMESTAMP(3),
  "ipAddress"    TEXT,
  "deviceName"   TEXT,
  CONSTRAINT "user_login_activities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_login_activities_userId_activityDate_platform_key"
  ON "user_login_activities"("userId", "activityDate", "platform");
CREATE INDEX IF NOT EXISTS "user_login_activities_activityDate_platform_idx"
  ON "user_login_activities"("activityDate", "platform");

DO $$ BEGIN
  ALTER TABLE "user_login_activities"
    ADD CONSTRAINT "user_login_activities_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
