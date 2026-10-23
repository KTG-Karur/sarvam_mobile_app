-- Staff Loan and Staff Advance now keep separate workflow configurations on the same master page.
-- Existing rows are loan workflows, so they default to LOAN and keep working unchanged.

-- CreateEnum
CREATE TYPE "StaffWorkflowKind" AS ENUM ('LOAN', 'ADVANCE');

-- AlterTable
ALTER TABLE "staff_loan_workflow_configs" ADD COLUMN     "kind" "StaffWorkflowKind" NOT NULL DEFAULT 'LOAN';

-- CreateIndex
CREATE INDEX "staff_loan_workflow_configs_kind_createdAt_idx" ON "staff_loan_workflow_configs"("kind", "createdAt");