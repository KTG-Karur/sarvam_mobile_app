-- CreateEnum: Center Status
CREATE TYPE "CenterStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED');

-- CreateEnum: Client Verification Status
CREATE TYPE "ClientVerificationStatus" AS ENUM ('PENDING_VERIFICATION', 'VERIFIED', 'REJECTED');

-- CreateEnum: KYC Status
CREATE TYPE "KYCStatus" AS ENUM ('PENDING_VERIFICATION', 'VERIFIED', 'REJECTED');

-- CreateEnum: Loan Application Status
CREATE TYPE "LoanApplicationStatus" AS ENUM ('DRAFT', 'PENDING_VERIFICATION', 'VERIFIED', 'REJECTED');

-- CreateEnum: Loan Disbursement Status
CREATE TYPE "LoanDisbursementStatus" AS ENUM ('PENDING_LEVEL1', 'APPROVED_LEVEL1', 'PENDING_LEVEL2', 'DISBURSED', 'REJECTED');

-- AlterTable: Add role-based workflow fields to centers
-- First add columns as nullable
ALTER TABLE "centers" 
ADD COLUMN "status" "CenterStatus",
ADD COLUMN "createdById" TEXT,
ADD COLUMN "approvedById" TEXT,
ADD COLUMN "approvedAt" TIMESTAMP(3),
ADD COLUMN "rejectionReason" TEXT;

-- Set default values for existing records
UPDATE "centers" SET "status" = CASE WHEN "isActive" = true THEN 'APPROVED'::"CenterStatus" ELSE 'PENDING_APPROVAL'::"CenterStatus" END WHERE "status" IS NULL;
UPDATE "centers" SET "createdById" = (SELECT "id" FROM "users" WHERE "role" = 'ADMIN' LIMIT 1) WHERE "createdById" IS NULL;

-- Now make them NOT NULL
ALTER TABLE "centers" 
ALTER COLUMN "status" SET NOT NULL,
ALTER COLUMN "status" SET DEFAULT 'PENDING_APPROVAL',
ALTER COLUMN "createdById" SET NOT NULL;

-- AlterTable: Add role-based workflow fields to clients
-- First add columns as nullable
ALTER TABLE "clients"
ADD COLUMN "verificationStatus" "ClientVerificationStatus",
ADD COLUMN "enrolledById" TEXT,
ADD COLUMN "verifiedById" TEXT,
ADD COLUMN "verifiedAt" TIMESTAMP(3),
ADD COLUMN "rejectionReason" TEXT;

-- Set default values for existing records
UPDATE "clients" SET "verificationStatus" = CASE WHEN "isActive" = true THEN 'VERIFIED'::"ClientVerificationStatus" ELSE 'PENDING_VERIFICATION'::"ClientVerificationStatus" END WHERE "verificationStatus" IS NULL;
UPDATE "clients" SET "enrolledById" = (SELECT "id" FROM "users" WHERE "role" = 'ADMIN' LIMIT 1) WHERE "enrolledById" IS NULL;

-- Now make them NOT NULL
ALTER TABLE "clients"
ALTER COLUMN "verificationStatus" SET NOT NULL,
ALTER COLUMN "verificationStatus" SET DEFAULT 'PENDING_VERIFICATION',
ALTER COLUMN "enrolledById" SET NOT NULL;

-- CreateTable: KYC Documents
CREATE TABLE "kyc_documents" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "documentNumber" TEXT,
    "fileUrl" TEXT,
    "fileName" TEXT,
    "fileSize" INTEGER,
    "mimeType" TEXT,
    "status" "KYCStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "uploadedById" TEXT NOT NULL,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kyc_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Loans
CREATE TABLE "loans" (
    "id" TEXT NOT NULL,
    "loanNumber" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "applicationStatus" "LoanApplicationStatus" NOT NULL DEFAULT 'DRAFT',
    "disbursementStatus" "LoanDisbursementStatus" NOT NULL DEFAULT 'PENDING_LEVEL1',
    "amount" DECIMAL(15,2) NOT NULL,
    "interestRate" DECIMAL(5,2) NOT NULL,
    "tenureMonths" INTEGER NOT NULL,
    "createdById" TEXT NOT NULL,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "disbursedLevel1ById" TEXT,
    "disbursedLevel1At" TIMESTAMP(3),
    "approvedLevel2ById" TEXT,
    "approvedLevel2At" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: Unique loan number
CREATE UNIQUE INDEX "loans_loanNumber_key" ON "loans"("loanNumber");

-- AddForeignKey: Centers - createdBy (BM)
ALTER TABLE "centers" ADD CONSTRAINT "centers_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: Centers - approvedBy (AM)
ALTER TABLE "centers" ADD CONSTRAINT "centers_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: Clients - enrolledBy (FDO)
ALTER TABLE "clients" ADD CONSTRAINT "clients_enrolledById_fkey" FOREIGN KEY ("enrolledById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: Clients - verifiedBy (BM)
ALTER TABLE "clients" ADD CONSTRAINT "clients_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: KYC Documents - client
ALTER TABLE "kyc_documents" ADD CONSTRAINT "kyc_documents_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: KYC Documents - uploadedBy (FDO)
ALTER TABLE "kyc_documents" ADD CONSTRAINT "kyc_documents_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: KYC Documents - verifiedBy (BM)
ALTER TABLE "kyc_documents" ADD CONSTRAINT "kyc_documents_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: Loans - client
ALTER TABLE "loans" ADD CONSTRAINT "loans_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: Loans - center
ALTER TABLE "loans" ADD CONSTRAINT "loans_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: Loans - branch
ALTER TABLE "loans" ADD CONSTRAINT "loans_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: Loans - createdBy (FDO)
ALTER TABLE "loans" ADD CONSTRAINT "loans_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: Loans - verifiedBy (BM)
ALTER TABLE "loans" ADD CONSTRAINT "loans_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: Loans - disbursedLevel1By (BM)
ALTER TABLE "loans" ADD CONSTRAINT "loans_disbursedLevel1ById_fkey" FOREIGN KEY ("disbursedLevel1ById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: Loans - approvedLevel2By (AM)
ALTER TABLE "loans" ADD CONSTRAINT "loans_approvedLevel2ById_fkey" FOREIGN KEY ("approvedLevel2ById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Note: Default values have been set above during the ALTER TABLE operations
