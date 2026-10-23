-- Add MONTHLY as a valid StaffLoanInterestType value. Must land in its own
-- migration/transaction — Postgres forbids referencing a newly added enum
-- value in the same transaction that created it.
ALTER TYPE "StaffLoanInterestType" ADD VALUE IF NOT EXISTS 'MONTHLY';
