-- Staff-loan foundation only. No data inserts or existing-table alterations.
-- Generated offline from the before/after Prisma datamodels; NOT applied.

-- CreateEnum
CREATE TYPE "StaffLoanInterestType" AS ENUM ('INTEREST_FREE', 'FLAT');

-- CreateEnum
CREATE TYPE "StaffLoanAmountBasis" AS ENUM ('FIXED_AMOUNT', 'SALARY_MULTIPLE');

-- CreateEnum
CREATE TYPE "StaffLoanLimitScope" AS ENUM ('PER_SCHEME', 'ALL_STAFF_LOANS');

-- CreateEnum
CREATE TYPE "StaffLoanRecoveryMethod" AS ENUM ('SALARY', 'CASH_BANK');

-- CreateEnum
CREATE TYPE "StaffLoanStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED', 'ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "StaffLoanDecisionAction" AS ENUM ('SUBMIT', 'APPROVE', 'REJECT', 'RETURN', 'RESUBMIT', 'CANCEL');

-- CreateEnum
CREATE TYPE "StaffLoanTransactionType" AS ENUM ('DISBURSEMENT', 'SALARY_RECOVERY', 'CASH_BANK_RECOVERY', 'EARLY_SETTLEMENT', 'FINAL_SETTLEMENT_RECOVERY', 'REVERSAL');

-- CreateEnum
CREATE TYPE "StaffLoanTransactionStatus" AS ENUM ('PENDING', 'POSTED', 'REJECTED');

-- CreateTable
CREATE TABLE "staff_loan_schemes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "minimumServiceMonths" INTEGER NOT NULL,
    "amountBasis" "StaffLoanAmountBasis" NOT NULL,
    "maximumAmount" DECIMAL(15,2),
    "salaryMultiplier" DECIMAL(10,4),
    "maximumTenureMonths" INTEGER NOT NULL,
    "maximumActiveLoans" INTEGER NOT NULL,
    "activeLoanLimitScope" "StaffLoanLimitScope" NOT NULL,
    "interestType" "StaffLoanInterestType" NOT NULL,
    "annualInterestRate" DECIMAL(7,4) NOT NULL,
    "allowedRecoveryMethods" "StaffLoanRecoveryMethod"[],
    "recoveryPolicy" JSONB NOT NULL,
    "settlementPolicy" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_loan_schemes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_loan_workflow_configs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_loan_workflow_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_loan_workflow_stages" (
    "id" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "levelOrder" INTEGER NOT NULL,
    "stageName" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_loan_workflow_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_loans" (
    "id" TEXT NOT NULL,
    "loanNumber" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "schemeId" TEXT NOT NULL,
    "schemeVersion" INTEGER NOT NULL,
    "schemeSnapshot" JSONB NOT NULL,
    "workflowConfigId" TEXT,
    "currentApprovalLevel" INTEGER,
    "status" "StaffLoanStatus" NOT NULL DEFAULT 'DRAFT',
    "purpose" TEXT NOT NULL,
    "remarks" TEXT,
    "requestedAmount" DECIMAL(15,2) NOT NULL,
    "approvedAmount" DECIMAL(15,2),
    "tenureMonths" INTEGER NOT NULL,
    "interestType" "StaffLoanInterestType" NOT NULL,
    "annualInterestRate" DECIMAL(7,4) NOT NULL,
    "recoveryMethod" "StaffLoanRecoveryMethod" NOT NULL,
    "eligibilitySnapshot" JSONB,
    "proposedDisbursementDate" DATE,
    "firstDueDate" DATE,
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "disbursedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "exitReviewRequired" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_loans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_loan_decisions" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "action" "StaffLoanDecisionAction" NOT NULL,
    "stageOrder" INTEGER,
    "stageName" TEXT,
    "actedById" TEXT NOT NULL,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_loan_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_loan_schedules" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "installmentNo" INTEGER NOT NULL,
    "dueDate" DATE NOT NULL,
    "principalDue" DECIMAL(15,2) NOT NULL,
    "interestDue" DECIMAL(15,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_loan_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_loan_transactions" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "type" "StaffLoanTransactionType" NOT NULL,
    "status" "StaffLoanTransactionStatus" NOT NULL DEFAULT 'PENDING',
    "transactionDate" DATE NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "paymentMode" "PaymentMode",
    "reference" TEXT,
    "remarks" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "salaryPayRecordId" TEXT,
    "reversalOfId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "postedAt" TIMESTAMP(3),

    CONSTRAINT "staff_loan_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_loan_repayment_allocations" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "principal" DECIMAL(15,2) NOT NULL,
    "interest" DECIMAL(15,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_loan_repayment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_loan_vouchers" (
    "transactionId" TEXT NOT NULL,
    "financialTransactionId" TEXT NOT NULL,

    CONSTRAINT "staff_loan_vouchers_pkey" PRIMARY KEY ("transactionId","financialTransactionId")
);

-- CreateTable
CREATE TABLE "_StaffLoanSchemeBranches" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_StaffLoanSchemeBranches_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_StaffLoanSchemeDepartments" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_StaffLoanSchemeDepartments_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_StaffLoanSalaryBasis" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_StaffLoanSalaryBasis_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_StaffLoanSchemeRoles" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_StaffLoanSchemeRoles_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_StaffLoanDisbursementRoles" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_StaffLoanDisbursementRoles_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "staff_loan_schemes_code_key" ON "staff_loan_schemes"("code");

-- CreateIndex
CREATE INDEX "staff_loan_schemes_isActive_idx" ON "staff_loan_schemes"("isActive");

-- CreateIndex
CREATE INDEX "staff_loan_workflow_stages_roleId_idx" ON "staff_loan_workflow_stages"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "staff_loan_workflow_stages_configId_levelOrder_key" ON "staff_loan_workflow_stages"("configId", "levelOrder");

-- CreateIndex
CREATE UNIQUE INDEX "staff_loans_loanNumber_key" ON "staff_loans"("loanNumber");

-- CreateIndex
CREATE INDEX "staff_loans_employeeId_status_idx" ON "staff_loans"("employeeId", "status");

-- CreateIndex
CREATE INDEX "staff_loans_branchId_status_createdAt_idx" ON "staff_loans"("branchId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "staff_loans_schemeId_status_idx" ON "staff_loans"("schemeId", "status");

-- CreateIndex
CREATE INDEX "staff_loans_workflowConfigId_currentApprovalLevel_status_idx" ON "staff_loans"("workflowConfigId", "currentApprovalLevel", "status");

-- CreateIndex
CREATE INDEX "staff_loan_decisions_loanId_createdAt_idx" ON "staff_loan_decisions"("loanId", "createdAt");

-- CreateIndex
CREATE INDEX "staff_loan_decisions_actedById_idx" ON "staff_loan_decisions"("actedById");

-- CreateIndex
CREATE INDEX "staff_loan_schedules_dueDate_idx" ON "staff_loan_schedules"("dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "staff_loan_schedules_loanId_installmentNo_key" ON "staff_loan_schedules"("loanId", "installmentNo");

-- CreateIndex
CREATE UNIQUE INDEX "staff_loan_schedules_id_loanId_key" ON "staff_loan_schedules"("id", "loanId");

-- CreateIndex
CREATE UNIQUE INDEX "staff_loan_transactions_idempotencyKey_key" ON "staff_loan_transactions"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "staff_loan_transactions_reversalOfId_key" ON "staff_loan_transactions"("reversalOfId");

-- CreateIndex
CREATE INDEX "staff_loan_transactions_loanId_transactionDate_idx" ON "staff_loan_transactions"("loanId", "transactionDate");

-- CreateIndex
CREATE INDEX "staff_loan_transactions_salaryPayRecordId_idx" ON "staff_loan_transactions"("salaryPayRecordId");

-- CreateIndex
CREATE INDEX "staff_loan_transactions_status_transactionDate_idx" ON "staff_loan_transactions"("status", "transactionDate");

-- CreateIndex
CREATE UNIQUE INDEX "staff_loan_transactions_id_loanId_key" ON "staff_loan_transactions"("id", "loanId");

-- CreateIndex
CREATE UNIQUE INDEX "staff_loan_transactions_reversalOfId_loanId_key" ON "staff_loan_transactions"("reversalOfId", "loanId");

-- CreateIndex
CREATE INDEX "staff_loan_repayment_allocations_scheduleId_loanId_idx" ON "staff_loan_repayment_allocations"("scheduleId", "loanId");

-- CreateIndex
CREATE UNIQUE INDEX "staff_loan_repayment_allocations_transactionId_scheduleId_key" ON "staff_loan_repayment_allocations"("transactionId", "scheduleId");

-- CreateIndex
CREATE INDEX "staff_loan_vouchers_financialTransactionId_idx" ON "staff_loan_vouchers"("financialTransactionId");

-- CreateIndex
CREATE INDEX "_StaffLoanSchemeBranches_B_index" ON "_StaffLoanSchemeBranches"("B");

-- CreateIndex
CREATE INDEX "_StaffLoanSchemeDepartments_B_index" ON "_StaffLoanSchemeDepartments"("B");

-- CreateIndex
CREATE INDEX "_StaffLoanSalaryBasis_B_index" ON "_StaffLoanSalaryBasis"("B");

-- CreateIndex
CREATE INDEX "_StaffLoanSchemeRoles_B_index" ON "_StaffLoanSchemeRoles"("B");

-- CreateIndex
CREATE INDEX "_StaffLoanDisbursementRoles_B_index" ON "_StaffLoanDisbursementRoles"("B");

-- AddForeignKey
ALTER TABLE "staff_loan_schemes" ADD CONSTRAINT "staff_loan_schemes_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_loan_workflow_configs" ADD CONSTRAINT "staff_loan_workflow_configs_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_loan_workflow_stages" ADD CONSTRAINT "staff_loan_workflow_stages_configId_fkey" FOREIGN KEY ("configId") REFERENCES "staff_loan_workflow_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_loan_workflow_stages" ADD CONSTRAINT "staff_loan_workflow_stages_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_loans" ADD CONSTRAINT "staff_loans_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_loans" ADD CONSTRAINT "staff_loans_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_loans" ADD CONSTRAINT "staff_loans_schemeId_fkey" FOREIGN KEY ("schemeId") REFERENCES "staff_loan_schemes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_loans" ADD CONSTRAINT "staff_loans_workflowConfigId_fkey" FOREIGN KEY ("workflowConfigId") REFERENCES "staff_loan_workflow_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_loan_decisions" ADD CONSTRAINT "staff_loan_decisions_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "staff_loans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_loan_decisions" ADD CONSTRAINT "staff_loan_decisions_actedById_fkey" FOREIGN KEY ("actedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_loan_schedules" ADD CONSTRAINT "staff_loan_schedules_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "staff_loans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_loan_transactions" ADD CONSTRAINT "staff_loan_transactions_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "staff_loans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_loan_transactions" ADD CONSTRAINT "staff_loan_transactions_salaryPayRecordId_fkey" FOREIGN KEY ("salaryPayRecordId") REFERENCES "salary_pay_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_loan_transactions" ADD CONSTRAINT "staff_loan_transactions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_loan_transactions" ADD CONSTRAINT "staff_loan_transactions_reversalOfId_loanId_fkey" FOREIGN KEY ("reversalOfId", "loanId") REFERENCES "staff_loan_transactions"("id", "loanId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "staff_loan_repayment_allocations" ADD CONSTRAINT "staff_loan_repayment_allocations_transactionId_loanId_fkey" FOREIGN KEY ("transactionId", "loanId") REFERENCES "staff_loan_transactions"("id", "loanId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "staff_loan_repayment_allocations" ADD CONSTRAINT "staff_loan_repayment_allocations_scheduleId_loanId_fkey" FOREIGN KEY ("scheduleId", "loanId") REFERENCES "staff_loan_schedules"("id", "loanId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "staff_loan_vouchers" ADD CONSTRAINT "staff_loan_vouchers_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "staff_loan_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_loan_vouchers" ADD CONSTRAINT "staff_loan_vouchers_financialTransactionId_fkey" FOREIGN KEY ("financialTransactionId") REFERENCES "financial_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_StaffLoanSchemeBranches" ADD CONSTRAINT "_StaffLoanSchemeBranches_A_fkey" FOREIGN KEY ("A") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_StaffLoanSchemeBranches" ADD CONSTRAINT "_StaffLoanSchemeBranches_B_fkey" FOREIGN KEY ("B") REFERENCES "staff_loan_schemes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_StaffLoanSchemeDepartments" ADD CONSTRAINT "_StaffLoanSchemeDepartments_A_fkey" FOREIGN KEY ("A") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_StaffLoanSchemeDepartments" ADD CONSTRAINT "_StaffLoanSchemeDepartments_B_fkey" FOREIGN KEY ("B") REFERENCES "staff_loan_schemes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_StaffLoanSalaryBasis" ADD CONSTRAINT "_StaffLoanSalaryBasis_A_fkey" FOREIGN KEY ("A") REFERENCES "salary_components"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_StaffLoanSalaryBasis" ADD CONSTRAINT "_StaffLoanSalaryBasis_B_fkey" FOREIGN KEY ("B") REFERENCES "staff_loan_schemes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_StaffLoanSchemeRoles" ADD CONSTRAINT "_StaffLoanSchemeRoles_A_fkey" FOREIGN KEY ("A") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_StaffLoanSchemeRoles" ADD CONSTRAINT "_StaffLoanSchemeRoles_B_fkey" FOREIGN KEY ("B") REFERENCES "staff_loan_schemes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_StaffLoanDisbursementRoles" ADD CONSTRAINT "_StaffLoanDisbursementRoles_A_fkey" FOREIGN KEY ("A") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_StaffLoanDisbursementRoles" ADD CONSTRAINT "_StaffLoanDisbursementRoles_B_fkey" FOREIGN KEY ("B") REFERENCES "staff_loan_workflow_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Financial invariants and workflow constraints unsupported by Prisma schema syntax.
-- These apply only to the newly created staff-loan tables.
ALTER TABLE "staff_loan_schemes"
  ADD CONSTRAINT "staff_loan_scheme_limits_check" CHECK (
    "minimumServiceMonths" >= 0 AND "maximumTenureMonths" > 0
    AND "maximumActiveLoans" > 0 AND "version" > 0
  ),
  ADD CONSTRAINT "staff_loan_scheme_amount_basis_check" CHECK (
    ("amountBasis" = 'FIXED_AMOUNT' AND "maximumAmount" IS NOT NULL
      AND "maximumAmount" > 0 AND "salaryMultiplier" IS NULL)
    OR
    ("amountBasis" = 'SALARY_MULTIPLE' AND "salaryMultiplier" IS NOT NULL
      AND "salaryMultiplier" > 0 AND "maximumAmount" IS NULL)
  ),
  ADD CONSTRAINT "staff_loan_scheme_interest_check" CHECK (
    ("interestType" = 'INTEREST_FREE' AND "annualInterestRate" = 0)
    OR ("interestType" = 'FLAT' AND "annualInterestRate" > 0)
  ),
  ADD CONSTRAINT "staff_loan_scheme_recovery_methods_check" CHECK (
    "allowedRecoveryMethods" IS NOT NULL
    AND cardinality("allowedRecoveryMethods") > 0
    AND array_position("allowedRecoveryMethods", NULL) IS NULL
  ),
  ADD CONSTRAINT "staff_loan_scheme_policy_objects_check" CHECK (
    jsonb_typeof("recoveryPolicy") = 'object'
    AND jsonb_typeof("settlementPolicy") = 'object'
  );

-- One global active configuration; historical configurations remain referenced.
CREATE UNIQUE INDEX "staff_loan_workflow_single_active_key"
  ON "staff_loan_workflow_configs" ("isActive") WHERE "isActive" = true;

ALTER TABLE "staff_loan_workflow_stages"
  ADD CONSTRAINT "staff_loan_stage_order_check" CHECK ("levelOrder" > 0);

ALTER TABLE "staff_loans"
  ADD CONSTRAINT "staff_loan_terms_check" CHECK (
    "requestedAmount" > 0 AND ("approvedAmount" IS NULL OR "approvedAmount" > 0)
    AND "tenureMonths" > 0 AND "schemeVersion" > 0 AND "version" > 0
  ),
  ADD CONSTRAINT "staff_loan_interest_check" CHECK (
    ("interestType" = 'INTEREST_FREE' AND "annualInterestRate" = 0)
    OR ("interestType" = 'FLAT' AND "annualInterestRate" > 0)
  ),
  ADD CONSTRAINT "staff_loan_review_stage_check" CHECK (
    "currentApprovalLevel" IS NULL
    OR ("currentApprovalLevel" > 0 AND "workflowConfigId" IS NOT NULL)
  ),
  ADD CONSTRAINT "staff_loan_current_workflow_stage_fkey"
    FOREIGN KEY ("workflowConfigId", "currentApprovalLevel")
    REFERENCES "staff_loan_workflow_stages" ("configId", "levelOrder")
    ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "staff_loan_schedules"
  ADD CONSTRAINT "staff_loan_schedule_amounts_check" CHECK (
    "installmentNo" > 0 AND "principalDue" >= 0 AND "interestDue" >= 0
    AND "principalDue" + "interestDue" > 0
  );

ALTER TABLE "staff_loan_transactions"
  ADD CONSTRAINT "staff_loan_transaction_amount_check" CHECK ("amount" > 0),
  ADD CONSTRAINT "staff_loan_transaction_reversal_check" CHECK (
    ("type" = 'REVERSAL' AND "reversalOfId" IS NOT NULL AND "reversalOfId" <> "id")
    OR ("type" <> 'REVERSAL' AND "reversalOfId" IS NULL)
  ),
  ADD CONSTRAINT "staff_loan_salary_recovery_link_check" CHECK (
    "type" <> 'SALARY_RECOVERY' OR "salaryPayRecordId" IS NOT NULL
  ),
  ADD CONSTRAINT "staff_loan_transaction_posted_check" CHECK (
    ("status" = 'POSTED' AND "postedAt" IS NOT NULL)
    OR ("status" <> 'POSTED' AND "postedAt" IS NULL)
  );

ALTER TABLE "staff_loan_repayment_allocations"
  ADD CONSTRAINT "staff_loan_allocation_amounts_check" CHECK (
    "principal" >= 0 AND "interest" >= 0 AND "principal" + "interest" > 0
  );
