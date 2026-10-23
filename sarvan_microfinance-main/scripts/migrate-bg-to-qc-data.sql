-- ============================================================
-- Migrate BG_* → QC_* in PostgreSQL enums and existing data
-- ============================================================

-- Step 1: Add QC_* values to ApprovalAction enum (safe — no data loss)
ALTER TYPE "ApprovalAction" ADD VALUE IF NOT EXISTS 'QC_VERIFIED_CLIENT';
ALTER TYPE "ApprovalAction" ADD VALUE IF NOT EXISTS 'QC_REJECTED_CLIENT';
ALTER TYPE "ApprovalAction" ADD VALUE IF NOT EXISTS 'QC_RETAKE_CLIENT';
ALTER TYPE "ApprovalAction" ADD VALUE IF NOT EXISTS 'QC_VERIFIED_DOCUMENT';
ALTER TYPE "ApprovalAction" ADD VALUE IF NOT EXISTS 'QC_RETAKE_DOCUMENT';
ALTER TYPE "ApprovalAction" ADD VALUE IF NOT EXISTS 'QC_REJECTED_DOCUMENT';

-- Step 2: Add QC_* values to ClientApprovalStatus enum (safe — no data loss)
ALTER TYPE "ClientApprovalStatus" ADD VALUE IF NOT EXISTS 'PENDING_QC_VERIFICATION';
ALTER TYPE "ClientApprovalStatus" ADD VALUE IF NOT EXISTS 'QC_VERIFICATION_RETAKE_REQUIRED';

-- Step 3: Migrate existing ClientApprovalHistory rows
UPDATE "client_approval_history" SET "action" = 'QC_VERIFIED_CLIENT'   WHERE "action" = 'BG_VERIFIED_CLIENT';
UPDATE "client_approval_history" SET "action" = 'QC_REJECTED_CLIENT'   WHERE "action" = 'BG_REJECTED_CLIENT';
UPDATE "client_approval_history" SET "action" = 'QC_RETAKE_CLIENT'     WHERE "action" = 'BG_RETAKE_CLIENT';
UPDATE "client_approval_history" SET "action" = 'QC_VERIFIED_DOCUMENT' WHERE "action" = 'BG_VERIFIED_DOCUMENT';
UPDATE "client_approval_history" SET "action" = 'QC_RETAKE_DOCUMENT'   WHERE "action" = 'BG_RETAKE_DOCUMENT';
UPDATE "client_approval_history" SET "action" = 'QC_REJECTED_DOCUMENT' WHERE "action" = 'BG_REJECTED_DOCUMENT';

-- Step 4: Migrate existing clients approvalStatus
UPDATE "clients" SET "approvalStatus" = 'PENDING_QC_VERIFICATION'       WHERE "approvalStatus" = 'PENDING_BG_VERIFICATION';
UPDATE "clients" SET "approvalStatus" = 'QC_VERIFICATION_RETAKE_REQUIRED' WHERE "approvalStatus" = 'BG_VERIFICATION_RETAKE_REQUIRED';
