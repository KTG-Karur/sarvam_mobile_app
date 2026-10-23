-- Add missing fields to loans table
-- Migration: add_loan_fields
-- Created: 2026-01-16

-- Add loanProductId column
ALTER TABLE "loans" ADD COLUMN IF NOT EXISTS "loanProductId" TEXT;

-- Add frequency column
ALTER TABLE "loans" ADD COLUMN IF NOT EXISTS "frequency" TEXT;

-- Add purpose column
ALTER TABLE "loans" ADD COLUMN IF NOT EXISTS "purpose" TEXT;

-- Add comments for documentation
COMMENT ON COLUMN "loans"."loanProductId" IS 'Product ID from the loan products';
COMMENT ON COLUMN "loans"."frequency" IS 'Loan repayment frequency: daily, weekly, forthnight, monthly, quarterly';
COMMENT ON COLUMN "loans"."purpose" IS 'Loan purpose: business, agriculture, education, health, housing, other';
