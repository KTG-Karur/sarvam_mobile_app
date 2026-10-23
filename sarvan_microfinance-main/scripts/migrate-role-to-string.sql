-- Safe migration: convert UserRole enum columns to plain TEXT
-- This preserves all existing data (FDO, ADMIN, BRANCH_MANAGER, AREA_MANAGER, etc.)

-- 1. Convert User.role from enum to text
ALTER TABLE "users" ALTER COLUMN "role" TYPE TEXT USING "role"::TEXT;
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'FDO';

-- 2. Convert Role.legacyRole from enum to text
ALTER TABLE "roles" ALTER COLUMN "legacyRole" TYPE TEXT USING "legacyRole"::TEXT;
ALTER TABLE "roles" ALTER COLUMN "legacyRole" SET DEFAULT 'FDO';

-- 3. Drop the now-unused PostgreSQL enum type
DROP TYPE IF EXISTS "UserRole";
