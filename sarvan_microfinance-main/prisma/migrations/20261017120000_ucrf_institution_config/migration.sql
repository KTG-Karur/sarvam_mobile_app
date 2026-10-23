-- UCRF/CDF export: singleton row holding the CIC member ID / institution name the file header
-- and trailer need. Idempotent so it is safe whether the table was already created via `prisma db push`.
CREATE TABLE IF NOT EXISTS "ucrf_institution_config" (
  "id"                 TEXT NOT NULL DEFAULT 'singleton',
  "memberId"           TEXT NOT NULL,
  "institutionName"    TEXT NOT NULL,
  "submittingBranchId" TEXT NOT NULL DEFAULT '',
  "fileFrequency"      TEXT NOT NULL DEFAULT 'ME',
  "oldMemberId"        TEXT NOT NULL DEFAULT '',
  "loanCategory"       TEXT NOT NULL DEFAULT 'T02',
  "updatedById"        TEXT NOT NULL,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ucrf_institution_config_pkey" PRIMARY KEY ("id")
);
