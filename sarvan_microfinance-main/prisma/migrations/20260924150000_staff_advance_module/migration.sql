-- CreateEnum
CREATE TYPE "StaffAdvanceStatus" AS ENUM ('SUBMITTED', 'ACTIVE', 'COMPLETED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StaffAdvanceDecisionAction" AS ENUM ('SUBMIT', 'EDIT', 'APPROVE', 'REJECT', 'CANCEL', 'REPAYMENT', 'COMPLETE');

-- CreateEnum
CREATE TYPE "StaffAdvanceTransactionStatus" AS ENUM ('PENDING', 'POSTED');

-- CreateTable
CREATE TABLE "staff_advances" (
    "id" TEXT NOT NULL,
    "advanceNumber" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "status" "StaffAdvanceStatus" NOT NULL DEFAULT 'SUBMITTED',
    "amount" DECIMAL(15,2) NOT NULL,
    "repaymentMonths" INTEGER NOT NULL DEFAULT 2,
    "purpose" TEXT NOT NULL,
    "remarks" TEXT,
    "workflowConfigId" TEXT,
    "currentApprovalLevel" INTEGER,
    "salarySnapshot" JSONB,
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_advances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_advance_decisions" (
    "id" TEXT NOT NULL,
    "advanceId" TEXT NOT NULL,
    "action" "StaffAdvanceDecisionAction" NOT NULL,
    "stageOrder" INTEGER,
    "stageName" TEXT,
    "actedById" TEXT NOT NULL,
    "remarks" TEXT,
    "changes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_advance_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_advance_schedules" (
    "id" TEXT NOT NULL,
    "advanceId" TEXT NOT NULL,
    "installmentNo" INTEGER NOT NULL,
    "dueDate" DATE NOT NULL,
    "amountDue" DECIMAL(15,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_advance_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_advance_transactions" (
    "id" TEXT NOT NULL,
    "advanceId" TEXT NOT NULL,
    "status" "StaffAdvanceTransactionStatus" NOT NULL DEFAULT 'PENDING',
    "transactionDate" DATE NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "remarks" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "salaryPayRecordId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "postedAt" TIMESTAMP(3),

    CONSTRAINT "staff_advance_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_advance_repayment_allocations" (
    "id" TEXT NOT NULL,
    "advanceId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_advance_repayment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "staff_advances_advanceNumber_key" ON "staff_advances"("advanceNumber");

-- CreateIndex
CREATE INDEX "staff_advances_employeeId_status_idx" ON "staff_advances"("employeeId", "status");

-- CreateIndex
CREATE INDEX "staff_advances_branchId_status_createdAt_idx" ON "staff_advances"("branchId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "staff_advances_workflowConfigId_currentApprovalLevel_status_idx" ON "staff_advances"("workflowConfigId", "currentApprovalLevel", "status");

-- CreateIndex
CREATE INDEX "staff_advance_decisions_advanceId_createdAt_idx" ON "staff_advance_decisions"("advanceId", "createdAt");

-- CreateIndex
CREATE INDEX "staff_advance_decisions_actedById_idx" ON "staff_advance_decisions"("actedById");

-- CreateIndex
CREATE INDEX "staff_advance_schedules_dueDate_idx" ON "staff_advance_schedules"("dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "staff_advance_schedules_advanceId_installmentNo_key" ON "staff_advance_schedules"("advanceId", "installmentNo");

-- CreateIndex
CREATE UNIQUE INDEX "staff_advance_schedules_id_advanceId_key" ON "staff_advance_schedules"("id", "advanceId");

-- CreateIndex
CREATE UNIQUE INDEX "staff_advance_transactions_idempotencyKey_key" ON "staff_advance_transactions"("idempotencyKey");

-- CreateIndex
CREATE INDEX "staff_advance_transactions_advanceId_transactionDate_idx" ON "staff_advance_transactions"("advanceId", "transactionDate");

-- CreateIndex
CREATE INDEX "staff_advance_transactions_salaryPayRecordId_idx" ON "staff_advance_transactions"("salaryPayRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "staff_advance_transactions_id_advanceId_key" ON "staff_advance_transactions"("id", "advanceId");

-- CreateIndex
CREATE INDEX "staff_advance_repayment_allocations_scheduleId_advanceId_idx" ON "staff_advance_repayment_allocations"("scheduleId", "advanceId");

-- CreateIndex
CREATE UNIQUE INDEX "staff_advance_repayment_allocations_transactionId_scheduleI_key" ON "staff_advance_repayment_allocations"("transactionId", "scheduleId");

-- AddForeignKey
ALTER TABLE "staff_advances" ADD CONSTRAINT "staff_advances_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_advances" ADD CONSTRAINT "staff_advances_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_advances" ADD CONSTRAINT "staff_advances_workflowConfigId_fkey" FOREIGN KEY ("workflowConfigId") REFERENCES "staff_loan_workflow_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_advance_decisions" ADD CONSTRAINT "staff_advance_decisions_advanceId_fkey" FOREIGN KEY ("advanceId") REFERENCES "staff_advances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_advance_decisions" ADD CONSTRAINT "staff_advance_decisions_actedById_fkey" FOREIGN KEY ("actedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_advance_schedules" ADD CONSTRAINT "staff_advance_schedules_advanceId_fkey" FOREIGN KEY ("advanceId") REFERENCES "staff_advances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_advance_transactions" ADD CONSTRAINT "staff_advance_transactions_advanceId_fkey" FOREIGN KEY ("advanceId") REFERENCES "staff_advances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_advance_transactions" ADD CONSTRAINT "staff_advance_transactions_salaryPayRecordId_fkey" FOREIGN KEY ("salaryPayRecordId") REFERENCES "salary_pay_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_advance_transactions" ADD CONSTRAINT "staff_advance_transactions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_advance_repayment_allocations" ADD CONSTRAINT "staff_advance_repayment_allocations_transactionId_advanceI_fkey" FOREIGN KEY ("transactionId", "advanceId") REFERENCES "staff_advance_transactions"("id", "advanceId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "staff_advance_repayment_allocations" ADD CONSTRAINT "staff_advance_repayment_allocations_scheduleId_advanceId_fkey" FOREIGN KEY ("scheduleId", "advanceId") REFERENCES "staff_advance_schedules"("id", "advanceId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ── Business rules enforced in the database, not only in the app ────────────────────────────────────
-- Interest-free advance repaid in exactly two installments.
ALTER TABLE "staff_advances"
  ADD CONSTRAINT "staff_advance_terms_check" CHECK ("amount" > 0 AND "repaymentMonths" = 2 AND "version" > 0);
-- No third installment can ever exist, and every installment carries an amount.
ALTER TABLE "staff_advance_schedules"
  ADD CONSTRAINT "staff_advance_installment_no_check" CHECK ("installmentNo" BETWEEN 1 AND 2),
  ADD CONSTRAINT "staff_advance_installment_amount_check" CHECK ("amountDue" > 0);
ALTER TABLE "staff_advance_transactions"
  ADD CONSTRAINT "staff_advance_transaction_amount_check" CHECK ("amount" > 0);
ALTER TABLE "staff_advance_repayment_allocations"
  ADD CONSTRAINT "staff_advance_allocation_amount_check" CHECK ("amount" > 0);
-- One open (under review or being repaid) advance per employee at a time.
CREATE UNIQUE INDEX "staff_advance_one_open_per_employee_key"
  ON "staff_advances" ("employeeId") WHERE "status" IN ('SUBMITTED', 'ACTIVE');

-- Business-facing advance numbers: SA-000001, SA-000002, ...
CREATE SEQUENCE IF NOT EXISTS "staff_advance_number_seq";
