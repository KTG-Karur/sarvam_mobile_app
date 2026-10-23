-- Salary day of the month: staff loan installments fall due on it (the day before if it is a Sunday).
-- Nullable so configurations saved before this setting existed remain valid.
ALTER TABLE "staff_loan_workflow_configs"
  ADD COLUMN IF NOT EXISTS "salaryDay" INTEGER;

ALTER TABLE "staff_loan_workflow_configs"
  DROP CONSTRAINT IF EXISTS "staff_loan_workflow_salary_day_check";
ALTER TABLE "staff_loan_workflow_configs"
  ADD CONSTRAINT "staff_loan_workflow_salary_day_check" CHECK ("salaryDay" IS NULL OR ("salaryDay" BETWEEN 1 AND 31));