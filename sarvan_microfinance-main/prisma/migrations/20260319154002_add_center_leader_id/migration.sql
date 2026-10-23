-- CreateEnum
DO $$
BEGIN
    CREATE TYPE "ClientApprovalStatus" AS ENUM ('SUBMITTED', 'PENDING_BM_REVIEW', 'BM_RETAKE_REQUIRED', 'PENDING_AM_REVIEW', 'AM_RETAKE_REQUIRED', 'APPROVED', 'REJECTED');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END
$$;

-- CreateEnum
DO $$
BEGIN
    CREATE TYPE "KYCDocumentDecision" AS ENUM ('PENDING', 'VERIFIED', 'RETAKE_REQUIRED', 'DELETED', 'REJECTED');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END
$$;

-- CreateEnum
DO $$
BEGIN
    CREATE TYPE "ApprovalAction" AS ENUM ('SUBMITTED', 'BM_VERIFIED_DOCUMENT', 'BM_RETAKE_DOCUMENT', 'BM_DELETED_DOCUMENT', 'BM_REJECTED_DOCUMENT', 'BM_COMPLETED_REVIEW', 'BM_REJECTED_CLIENT', 'AM_VERIFIED_DOCUMENT', 'AM_RETAKE_DOCUMENT', 'AM_DELETED_DOCUMENT', 'AM_REJECTED_DOCUMENT', 'AM_APPROVED_CLIENT', 'AM_REJECTED_CLIENT', 'FDO_RESUBMITTED', 'FDO_REUPLOADED_DOCUMENT', 'PROFILE_EDIT_RESET');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END
$$;

-- CreateEnum
DO $$
BEGIN
    CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END
$$;

-- AlterTable
ALTER TABLE "centers" ADD COLUMN     "centerLeaderId" TEXT;

-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "amRemarks" TEXT,
ADD COLUMN     "amReviewedAt" TIMESTAMP(3),
ADD COLUMN     "amReviewedById" TEXT,
ADD COLUMN     "approvalStatus" "ClientApprovalStatus" NOT NULL DEFAULT 'SUBMITTED',
ADD COLUMN     "bmRemarks" TEXT,
ADD COLUMN     "bmReviewedAt" TIMESTAMP(3),
ADD COLUMN     "bmReviewedById" TEXT;

-- AlterTable
ALTER TABLE "kyc_documents" ADD COLUMN     "amDecision" "KYCDocumentDecision" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "amRemark" TEXT,
ADD COLUMN     "amReviewedAt" TIMESTAMP(3),
ADD COLUMN     "amReviewerId" TEXT,
ADD COLUMN     "bmDecision" "KYCDocumentDecision" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "bmRemark" TEXT,
ADD COLUMN     "bmReviewedAt" TIMESTAMP(3),
ADD COLUMN     "bmReviewerId" TEXT,
ADD COLUMN     "deleteReason" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedById" TEXT,
ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "parentKycId" TEXT,
ADD COLUMN     "retakeReason" TEXT,
ADD COLUMN     "revisionNo" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "loan_transactions" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "collectionBatchId" TEXT,
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING';

-- CreateTable
CREATE TABLE "loan_schedule_collection_stats" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "installmentNo" INTEGER NOT NULL,
    "approvedPrincipalPaid" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "approvedInterestPaid" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "approvedFeesPaid" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "approvedPenaltiesPaid" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "approvedTotalPaid" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "pendingPrincipalAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "pendingInterestAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "pendingFeesAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "pendingPenaltyAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "pendingTotalAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "totalInProcess" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "lastApprovedAt" TIMESTAMP(3),
    "lastPendingAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loan_schedule_collection_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_transaction_lines" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "installmentNo" INTEGER NOT NULL,
    "principalAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "interestAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "feesAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "penaltyAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(15,2) NOT NULL DEFAULT 0,

    CONSTRAINT "loan_transaction_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_transfers" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "oldCenterId" TEXT NOT NULL,
    "newCenterId" TEXT NOT NULL,
    "oldClientId" TEXT NOT NULL,
    "newClientId" TEXT NOT NULL,
    "oldGroupId" TEXT,
    "newGroupId" TEXT,
    "transferredById" TEXT NOT NULL,
    "transferDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "remarks" TEXT,

    CONSTRAINT "client_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_approval_history" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "action" "ApprovalAction" NOT NULL,
    "performedById" TEXT NOT NULL,
    "remarks" TEXT,
    "kycDocumentId" TEXT,
    "previousState" TEXT,
    "newState" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_approval_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "loan_schedule_collection_stats_scheduleId_key" ON "loan_schedule_collection_stats"("scheduleId");

-- CreateIndex
CREATE INDEX "loan_schedule_collection_stats_loanId_idx" ON "loan_schedule_collection_stats"("loanId");

-- CreateIndex
CREATE INDEX "loan_schedule_collection_stats_scheduleId_idx" ON "loan_schedule_collection_stats"("scheduleId");

-- CreateIndex
CREATE UNIQUE INDEX "loan_schedule_collection_stats_loanId_installmentNo_key" ON "loan_schedule_collection_stats"("loanId", "installmentNo");

-- CreateIndex
CREATE INDEX "loan_transaction_lines_transactionId_idx" ON "loan_transaction_lines"("transactionId");

-- CreateIndex
CREATE INDEX "loan_transaction_lines_scheduleId_idx" ON "loan_transaction_lines"("scheduleId");

-- CreateIndex
CREATE INDEX "client_approval_history_clientId_idx" ON "client_approval_history"("clientId");

-- CreateIndex
CREATE INDEX "client_approval_history_performedById_idx" ON "client_approval_history"("performedById");

-- CreateIndex
CREATE INDEX "client_approval_history_createdAt_idx" ON "client_approval_history"("createdAt");

-- CreateIndex
CREATE INDEX "kyc_documents_clientId_isDeleted_idx" ON "kyc_documents"("clientId", "isDeleted");

-- AddForeignKey
ALTER TABLE "centers" ADD CONSTRAINT "centers_centerLeaderId_fkey" FOREIGN KEY ("centerLeaderId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_bmReviewedById_fkey" FOREIGN KEY ("bmReviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_amReviewedById_fkey" FOREIGN KEY ("amReviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_documents" ADD CONSTRAINT "kyc_documents_bmReviewerId_fkey" FOREIGN KEY ("bmReviewerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_documents" ADD CONSTRAINT "kyc_documents_amReviewerId_fkey" FOREIGN KEY ("amReviewerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_documents" ADD CONSTRAINT "kyc_documents_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_documents" ADD CONSTRAINT "kyc_documents_parentKycId_fkey" FOREIGN KEY ("parentKycId") REFERENCES "kyc_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_schedule_collection_stats" ADD CONSTRAINT "loan_schedule_collection_stats_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "loan_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_schedule_collection_stats" ADD CONSTRAINT "loan_schedule_collection_stats_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "loans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_transactions" ADD CONSTRAINT "loan_transactions_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_transaction_lines" ADD CONSTRAINT "loan_transaction_lines_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "loan_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_transaction_lines" ADD CONSTRAINT "loan_transaction_lines_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "loan_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_transfers" ADD CONSTRAINT "client_transfers_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_transfers" ADD CONSTRAINT "client_transfers_oldCenterId_fkey" FOREIGN KEY ("oldCenterId") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_transfers" ADD CONSTRAINT "client_transfers_newCenterId_fkey" FOREIGN KEY ("newCenterId") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_transfers" ADD CONSTRAINT "client_transfers_transferredById_fkey" FOREIGN KEY ("transferredById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_approval_history" ADD CONSTRAINT "client_approval_history_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_approval_history" ADD CONSTRAINT "client_approval_history_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
