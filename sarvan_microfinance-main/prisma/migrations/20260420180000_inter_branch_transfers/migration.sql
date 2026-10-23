-- CreateEnum (Safe)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'InterBranchTransferMode') THEN
        CREATE TYPE "InterBranchTransferMode" AS ENUM ('CASH', 'BANK');
    END IF;
END$$;

-- CreateEnum (Safe)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'InterBranchTransferStatus') THEN
        CREATE TYPE "InterBranchTransferStatus" AS ENUM ('POSTED', 'REVERSED', 'CANCELLED');
    END IF;
END$$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "inter_branch_transfers" (
    "id" TEXT NOT NULL,
    "fromBranchId" TEXT NOT NULL,
    "toBranchId" TEXT NOT NULL,
    "mode" "InterBranchTransferMode" NOT NULL,
    "status" "InterBranchTransferStatus" NOT NULL DEFAULT 'POSTED',
    "transferDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "narration" TEXT,
    "fromTransactionId" TEXT NOT NULL,
    "toTransactionId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "inter_branch_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "inter_branch_transfers_fromTransactionId_key"
ON "inter_branch_transfers"("fromTransactionId");

CREATE UNIQUE INDEX IF NOT EXISTS "inter_branch_transfers_toTransactionId_key"
ON "inter_branch_transfers"("toTransactionId");

CREATE INDEX IF NOT EXISTS "inter_branch_transfers_fromBranchId_transferDate_idx"
ON "inter_branch_transfers"("fromBranchId", "transferDate");

CREATE INDEX IF NOT EXISTS "inter_branch_transfers_toBranchId_transferDate_idx"
ON "inter_branch_transfers"("toBranchId", "transferDate");

-- AddForeignKeys (Safe)
ALTER TABLE "inter_branch_transfers"
    ADD CONSTRAINT "inter_branch_transfers_fromBranchId_fkey"
    FOREIGN KEY ("fromBranchId") REFERENCES "branches"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inter_branch_transfers"
    ADD CONSTRAINT "inter_branch_transfers_toBranchId_fkey"
    FOREIGN KEY ("toBranchId") REFERENCES "branches"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inter_branch_transfers"
    ADD CONSTRAINT "inter_branch_transfers_fromTransactionId_fkey"
    FOREIGN KEY ("fromTransactionId") REFERENCES "financial_transactions"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inter_branch_transfers"
    ADD CONSTRAINT "inter_branch_transfers_toTransactionId_fkey"
    FOREIGN KEY ("toTransactionId") REFERENCES "financial_transactions"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inter_branch_transfers"
    ADD CONSTRAINT "inter_branch_transfers_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;