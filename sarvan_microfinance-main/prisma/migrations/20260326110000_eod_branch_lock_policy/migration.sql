ALTER TABLE "branch_locks"
ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
ADD COLUMN "defaultOpenMinutes" INTEGER NOT NULL DEFAULT 540,
ADD COLUMN "defaultCloseMinutes" INTEGER NOT NULL DEFAULT 1080,
ADD COLUMN "effectiveWindowStartAt" TIMESTAMP(3),
ADD COLUMN "effectiveWindowEndAt" TIMESTAMP(3),
ADD COLUMN "isManuallyExtended" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "manualOverrideUntil" TIMESTAMP(3),
ADD COLUMN "manualOverrideReason" TEXT,
ADD COLUMN "manualOverrideByUserId" TEXT,
ADD COLUMN "lastEodClosedAt" TIMESTAMP(3),
ADD COLUMN "lastEodClosedByUserId" TEXT;

UPDATE "branch_locks"
SET
  "effectiveWindowStartAt" = date_trunc('day', "currentWorkingDate") + interval '9 hour',
  "effectiveWindowEndAt" = date_trunc('day', "currentWorkingDate") + interval '18 hour',
  "manualOverrideUntil" = CASE
    WHEN "lockTime" > date_trunc('day', "currentWorkingDate") + interval '18 hour' THEN "lockTime"
    ELSE NULL
  END,
  "isManuallyExtended" = CASE
    WHEN "lockTime" > date_trunc('day', "currentWorkingDate") + interval '18 hour' THEN true
    ELSE false
  END;
