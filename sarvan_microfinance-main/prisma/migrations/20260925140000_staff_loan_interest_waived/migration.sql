-- An early settlement waives the interest of installments that were not yet due. Until now that was only implied
-- (the settled loan is CLOSED with unpaid interest); it is now recorded per installment, so a settled loan is stored
-- as fully paid/waived and every screen and report agrees without guessing.
ALTER TABLE "staff_loan_schedules"
  ADD COLUMN IF NOT EXISTS "interestWaived" DECIMAL(15,2) NOT NULL DEFAULT 0;

-- Backfill the loans that were already settled early: whatever interest is still unpaid on a CLOSED loan that has a
-- posted EARLY_SETTLEMENT was waived by it. Loans closed by paying every installment have no unpaid interest, so
-- they stay at 0.
UPDATE "staff_loan_schedules" AS s
SET "interestWaived" = GREATEST(0, s."interestDue" - COALESCE((
  SELECT SUM(a."interest")
  FROM "staff_loan_repayment_allocations" a
  JOIN "staff_loan_transactions" t ON t."id" = a."transactionId"
  WHERE a."scheduleId" = s."id" AND t."status" = 'POSTED'
), 0))
FROM "staff_loans" l
WHERE l."id" = s."loanId"
  AND l."status" = 'CLOSED'
  AND EXISTS (
    SELECT 1 FROM "staff_loan_transactions" t
    WHERE t."loanId" = l."id" AND t."type" = 'EARLY_SETTLEMENT' AND t."status" = 'POSTED'
  );

ALTER TABLE "staff_loan_schedules"
  ADD CONSTRAINT "staff_loan_schedule_interest_waived_check" CHECK ("interestWaived" >= 0 AND "interestWaived" <= "interestDue");
