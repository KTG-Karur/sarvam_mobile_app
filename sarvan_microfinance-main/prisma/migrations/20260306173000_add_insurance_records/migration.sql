-- CreateTable
CREATE TABLE "insurance_records" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "loanId" TEXT,
    "providerName" TEXT NOT NULL,
    "policyNumber" TEXT NOT NULL,
    "policyType" TEXT NOT NULL DEFAULT 'CREDIT_LIFE',
    "coverageAmount" DECIMAL(15,2) NOT NULL,
    "premiumAmount" DECIMAL(15,2) NOT NULL,
    "premiumFrequency" TEXT NOT NULL DEFAULT 'ONE_TIME',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "nomineeName" TEXT NOT NULL,
    "nomineeRelationship" TEXT NOT NULL,
    "nomineeAge" INTEGER,
    "documentUrl" TEXT,
    "documentKey" TEXT,
    "documentName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "claimDate" TIMESTAMP(3),
    "claimAmount" DECIMAL(15,2),
    "remarks" TEXT,
    "createdById" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "insurance_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "insurance_records_policyNumber_key" ON "insurance_records"("policyNumber");

-- CreateIndex
CREATE INDEX "insurance_records_clientId_idx" ON "insurance_records"("clientId");

-- CreateIndex
CREATE INDEX "insurance_records_branchId_idx" ON "insurance_records"("branchId");

-- CreateIndex
CREATE INDEX "insurance_records_status_idx" ON "insurance_records"("status");

-- AddForeignKey
ALTER TABLE "insurance_records" ADD CONSTRAINT "insurance_records_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_records" ADD CONSTRAINT "insurance_records_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_records" ADD CONSTRAINT "insurance_records_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
