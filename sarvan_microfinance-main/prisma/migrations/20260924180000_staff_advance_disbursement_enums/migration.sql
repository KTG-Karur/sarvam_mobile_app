-- Staff Advance gets a disbursement step (same shape as Staff Loan): a fully approved advance waits as
-- APPROVED until a disbursement-authority holder pays it out. Enum values are added on their own so the next
-- migration can use them.
ALTER TYPE "StaffAdvanceStatus" ADD VALUE 'APPROVED';
ALTER TYPE "StaffAdvanceDecisionAction" ADD VALUE 'DISBURSE';