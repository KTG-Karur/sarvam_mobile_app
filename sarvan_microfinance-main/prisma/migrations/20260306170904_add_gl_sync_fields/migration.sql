-- AlterTable
ALTER TABLE "loan_transactions" ADD COLUMN     "glSyncBatchId" TEXT,
ADD COLUMN     "glSyncedAt" TIMESTAMP(3),
ADD COLUMN     "isGlSynced" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "gl_sync_logs" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "syncDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "syncedById" TEXT NOT NULL,
    "totalDisbursements" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "totalCollections" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "totalPrincipal" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "totalInterest" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "totalFees" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "totalPenalties" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "txnCount" INTEGER NOT NULL DEFAULT 0,
    "vouchersCreated" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gl_sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gl_sync_logs_batchId_key" ON "gl_sync_logs"("batchId");

-- CreateIndex
CREATE INDEX "loan_transactions_isGlSynced_idx" ON "loan_transactions"("isGlSynced");
