-- Maker–Checker workflow for foreclosure collections (BM -> AM).
-- Additive schema: new enum + foreclosure_requests table.

DO $$ BEGIN
  CREATE TYPE "ForeclosureRequestStatus" AS ENUM ('INITIATED', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "foreclosure_requests" (
  "id" TEXT NOT NULL,
  "loanId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "centerId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "transactionId" TEXT,
  "status" "ForeclosureRequestStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
  "amountCollected" DECIMAL(15, 2) NOT NULL,
  "principalAmount" DECIMAL(15, 2) NOT NULL,
  "interestAmount" DECIMAL(15, 2) NOT NULL,
  "penaltyAmount" DECIMAL(15, 2) NOT NULL,
  "feesAmount" DECIMAL(15, 2) NOT NULL DEFAULT 0,
  "remarks" TEXT,
  "initiatedById" TEXT NOT NULL,
  "initiatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedById" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "reviewRemarks" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "foreclosure_requests_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "foreclosure_requests"
    ADD CONSTRAINT "foreclosure_requests_loanId_fkey"
    FOREIGN KEY ("loanId") REFERENCES "loans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "foreclosure_requests"
    ADD CONSTRAINT "foreclosure_requests_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "foreclosure_requests"
    ADD CONSTRAINT "foreclosure_requests_centerId_fkey"
    FOREIGN KEY ("centerId") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "foreclosure_requests"
    ADD CONSTRAINT "foreclosure_requests_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "foreclosure_requests"
    ADD CONSTRAINT "foreclosure_requests_transactionId_fkey"
    FOREIGN KEY ("transactionId") REFERENCES "loan_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "foreclosure_requests"
    ADD CONSTRAINT "foreclosure_requests_initiatedById_fkey"
    FOREIGN KEY ("initiatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "foreclosure_requests"
    ADD CONSTRAINT "foreclosure_requests_reviewedById_fkey"
    FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE UNIQUE INDEX "foreclosure_requests_transactionId_key" ON "foreclosure_requests"("transactionId");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "foreclosure_requests_status_createdAt_idx" ON "foreclosure_requests"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "foreclosure_requests_branchId_status_createdAt_idx" ON "foreclosure_requests"("branchId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "foreclosure_requests_centerId_status_createdAt_idx" ON "foreclosure_requests"("centerId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "foreclosure_requests_initiatedById_status_createdAt_idx" ON "foreclosure_requests"("initiatedById", "status", "createdAt");

