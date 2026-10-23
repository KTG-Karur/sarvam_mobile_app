-- CreateEnum
CREATE TYPE "GLType" AS ENUM ('PRINCIPLE', 'INTEREST');

-- CreateEnum
CREATE TYPE "FinancialTransactionType" AS ENUM ('BANK_RECEIPT', 'BANK_PAYMENT', 'CASH_RECEIPT', 'CASH_PAYMENT', 'CONTRA', 'JOURNAL');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'HALF_DAY', 'LEAVE');

-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "dropoutReason" TEXT,
ADD COLUMN     "inactiveDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "loan_transactions" ADD COLUMN     "collectionType" TEXT,
ADD COLUMN     "currentDemandInterest" DECIMAL(15,2) NOT NULL DEFAULT 0,
ADD COLUMN     "currentDemandPrincipal" DECIMAL(15,2) NOT NULL DEFAULT 0,
ADD COLUMN     "openingArrearsInterest" DECIMAL(15,2) NOT NULL DEFAULT 0,
ADD COLUMN     "openingArrearsPrincipal" DECIMAL(15,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "loans" ADD COLUMN     "closedDate" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "co_applicants" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gender" TEXT NOT NULL,
    "dateOfBirth" TIMESTAMP(3) NOT NULL,
    "age" INTEGER NOT NULL,
    "relationWithClient" TEXT NOT NULL,
    "mobileNumber" TEXT NOT NULL,
    "voterIdNo" TEXT,
    "otherIdNo" TEXT,
    "pancardNo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "co_applicants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_groups" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "groupName" TEXT NOT NULL,
    "parentGroupId" TEXT,
    "allowSubGroups" BOOLEAN NOT NULL DEFAULT true,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isSystemGroup" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_ledgers" (
    "id" TEXT NOT NULL,
    "ledgerId" TEXT NOT NULL,
    "ledgerName" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "allowAccessTo" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_ledgers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gl_accounts" (
    "id" TEXT NOT NULL,
    "glId" TEXT NOT NULL,
    "glName" TEXT NOT NULL,
    "glType" "GLType" NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gl_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "funders" (
    "id" TEXT NOT NULL,
    "funderId" TEXT NOT NULL,
    "funderName" TEXT NOT NULL,
    "principalGLId" TEXT NOT NULL,
    "interestGLId" TEXT NOT NULL,
    "interestPercent" DECIMAL(10,2) NOT NULL,
    "tdsPercent" DECIMAL(10,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "funders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "self_accounts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "self_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_transactions" (
    "id" TEXT NOT NULL,
    "voucherNo" TEXT NOT NULL,
    "transactionDate" TIMESTAMP(3) NOT NULL,
    "type" "FinancialTransactionType" NOT NULL,
    "selfAccountId" TEXT,
    "contraAccountId" TEXT,
    "ledgerId" TEXT,
    "creditLedgerId" TEXT,
    "amount" DECIMAL(15,2) NOT NULL,
    "description" TEXT,
    "instrumentNo" TEXT,
    "instrumentDate" TIMESTAMP(3),
    "bankName" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "status" "AttendanceStatus" NOT NULL DEFAULT 'PRESENT',
    "checkIn" TIMESTAMP(3),
    "checkOut" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "co_applicants_clientId_key" ON "co_applicants"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "account_groups_groupId_key" ON "account_groups"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "account_groups_groupName_key" ON "account_groups"("groupName");

-- CreateIndex
CREATE UNIQUE INDEX "account_ledgers_ledgerId_key" ON "account_ledgers"("ledgerId");

-- CreateIndex
CREATE UNIQUE INDEX "gl_accounts_glId_key" ON "gl_accounts"("glId");

-- CreateIndex
CREATE UNIQUE INDEX "funders_funderId_key" ON "funders"("funderId");

-- CreateIndex
CREATE UNIQUE INDEX "financial_transactions_voucherNo_key" ON "financial_transactions"("voucherNo");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_userId_date_key" ON "attendance"("userId", "date");

-- AddForeignKey
ALTER TABLE "co_applicants" ADD CONSTRAINT "co_applicants_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_groups" ADD CONSTRAINT "account_groups_parentGroupId_fkey" FOREIGN KEY ("parentGroupId") REFERENCES "account_groups"("groupId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_ledgers" ADD CONSTRAINT "account_ledgers_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "account_groups"("groupId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funders" ADD CONSTRAINT "funders_principalGLId_fkey" FOREIGN KEY ("principalGLId") REFERENCES "gl_accounts"("glId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funders" ADD CONSTRAINT "funders_interestGLId_fkey" FOREIGN KEY ("interestGLId") REFERENCES "gl_accounts"("glId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_selfAccountId_fkey" FOREIGN KEY ("selfAccountId") REFERENCES "self_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_contraAccountId_fkey" FOREIGN KEY ("contraAccountId") REFERENCES "self_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_ledgerId_fkey" FOREIGN KEY ("ledgerId") REFERENCES "account_ledgers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_creditLedgerId_fkey" FOREIGN KEY ("creditLedgerId") REFERENCES "account_ledgers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
