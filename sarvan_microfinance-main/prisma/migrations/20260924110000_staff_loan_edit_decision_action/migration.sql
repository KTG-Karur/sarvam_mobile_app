-- Approver edits of loan terms are recorded in the decision history as EDIT.
-- Kept in its own migration: Postgres cannot reference a newly added enum value
-- in the same transaction that creates it.
ALTER TYPE "StaffLoanDecisionAction" ADD VALUE IF NOT EXISTS 'EDIT';
