-- The staff loan workflow allowed one active configuration in the whole table. Staff Loan and Staff Advance now
-- have separate workflows, so the rule becomes: one active configuration per kind.
DROP INDEX "staff_loan_workflow_single_active_key";
CREATE UNIQUE INDEX "staff_loan_workflow_single_active_per_kind_key"
  ON "staff_loan_workflow_configs" ("kind") WHERE "isActive" = true;