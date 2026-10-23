-- Migration: Redesign LoanProduct and add ProductScheduleTemplate
-- Date: 2026-02-25
-- Description: 
--   1. Remove instance-specific fields from LoanProduct (fromDue, tillDue, principal, interest, scheduleOption)
--   2. Rename loginStatus -> status
--   3. Add interestMethod column (FLAT/REDUCING)
--   4. Make interestRate NOT NULL with default 0
--   5. Create ProductScheduleTemplate table for custom per-installment schedules

-- Step 1: Add new columns first
ALTER TABLE "loan_products" ADD COLUMN IF NOT EXISTS "interestMethod" TEXT NOT NULL DEFAULT 'FLAT';

-- Step 2: Rename loginStatus to status (copy data)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='loan_products' AND column_name='loginStatus') THEN
        ALTER TABLE "loan_products" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'enabled';
        UPDATE "loan_products" SET "status" = "loginStatus";
    END IF;
END $$;

-- Step 3: Make interestRate NOT NULL (set any nulls to 0 first)
UPDATE "loan_products" SET "interestRate" = 0 WHERE "interestRate" IS NULL;
ALTER TABLE "loan_products" ALTER COLUMN "interestRate" SET NOT NULL;
ALTER TABLE "loan_products" ALTER COLUMN "interestRate" SET DEFAULT 0;

-- Step 4: Drop removed columns safely
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='loan_products' AND column_name='scheduleOption') THEN
        ALTER TABLE "loan_products" DROP COLUMN "scheduleOption";
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='loan_products' AND column_name='fromDue') THEN
        ALTER TABLE "loan_products" DROP COLUMN "fromDue";
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='loan_products' AND column_name='tillDue') THEN
        ALTER TABLE "loan_products" DROP COLUMN "tillDue";
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='loan_products' AND column_name='principal') THEN
        ALTER TABLE "loan_products" DROP COLUMN "principal";
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='loan_products' AND column_name='interest') THEN
        ALTER TABLE "loan_products" DROP COLUMN "interest";
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='loan_products' AND column_name='loginStatus') THEN
        ALTER TABLE "loan_products" DROP COLUMN "loginStatus";
    END IF;
END $$;

-- Step 5: Create ProductScheduleTemplate table
CREATE TABLE IF NOT EXISTS "product_schedule_templates" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "installmentNo" INTEGER NOT NULL,
    "principalAmount" DECIMAL(15,2) NOT NULL,
    "interestAmount" DECIMAL(15,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_schedule_templates_pkey" PRIMARY KEY ("id")
);

-- Step 6: Add unique constraint and index
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_schedule_templates_productId_installmentNo_key') THEN
        ALTER TABLE "product_schedule_templates" ADD CONSTRAINT "product_schedule_templates_productId_installmentNo_key" UNIQUE ("productId", "installmentNo");
    END IF;
END $$;

-- Step 7: Add foreign key
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_schedule_templates_productId_fkey') THEN
        ALTER TABLE "product_schedule_templates" ADD CONSTRAINT "product_schedule_templates_productId_fkey" 
        FOREIGN KEY ("productId") REFERENCES "loan_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
