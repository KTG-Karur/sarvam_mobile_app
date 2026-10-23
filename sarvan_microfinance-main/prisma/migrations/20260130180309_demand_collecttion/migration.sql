-- CreateEnum
CREATE TYPE "ScheduleStatus" AS ENUM ('PENDING', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'WAIVED');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('DISBURSEMENT', 'REPAYMENT', 'PRECLOSURE', 'WRITEOFF', 'ADJUSTMENT', 'INTEREST_POSTING', 'PENALTY', 'FEE');

-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('CASH', 'BANK_TRANSFER', 'CHEQUE', 'UPI', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "GroupStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- AlterEnum
ALTER TYPE "ClientVerificationStatus" ADD VALUE 'UNDER_REVIEW';

-- AlterTable
ALTER TABLE "centers" ADD COLUMN     "address" TEXT,
ADD COLUMN     "fdoId" TEXT,
ADD COLUMN     "formationDate" TIMESTAMP(3),
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION,
ADD COLUMN     "meetingDay" TEXT,
ADD COLUMN     "meetingPlace" TEXT,
ADD COLUMN     "meetingTime" TEXT,
ADD COLUMN     "mobileNumber" TEXT,
ADD COLUMN     "nextMeetingDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "address" TEXT,
ADD COLUMN     "admissionFees" DECIMAL(10,2),
ADD COLUMN     "age" INTEGER,
ADD COLUMN     "bankAcNo" TEXT,
ADD COLUMN     "bankBranch" TEXT,
ADD COLUMN     "bankName" TEXT,
ADD COLUMN     "caOtherIdNo" TEXT,
ADD COLUMN     "caPancardNo" TEXT,
ADD COLUMN     "caVoterIdNo" TEXT,
ADD COLUMN     "caste" TEXT,
ADD COLUMN     "community" TEXT,
ADD COLUMN     "country" TEXT DEFAULT 'India',
ADD COLUMN     "dateOfBirth" TIMESTAMP(3),
ADD COLUMN     "district" TEXT,
ADD COLUMN     "fatherName" TEXT,
ADD COLUMN     "gender" TEXT,
ADD COLUMN     "groupId" TEXT,
ADD COLUMN     "houseStatus" TEXT,
ADD COLUMN     "ifscCode" TEXT,
ADD COLUMN     "maritalStatus" TEXT,
ADD COLUMN     "mobileNumber" TEXT,
ADD COLUMN     "monthlyFamilyExpense" DECIMAL(15,2),
ADD COLUMN     "monthlyFamilyIncome" DECIMAL(15,2),
ADD COLUMN     "motherName" TEXT,
ADD COLUMN     "noOfChildren" INTEGER,
ADD COLUMN     "nomineeAge" INTEGER,
ADD COLUMN     "nomineeDateOfBirth" TIMESTAMP(3),
ADD COLUMN     "nomineeGender" TEXT,
ADD COLUMN     "nomineeName" TEXT,
ADD COLUMN     "nomineeRelation" TEXT,
ADD COLUMN     "occupation" TEXT,
ADD COLUMN     "otherIdNo" TEXT,
ADD COLUMN     "pancardNo" TEXT,
ADD COLUMN     "pincode" TEXT,
ADD COLUMN     "postOffice" TEXT,
ADD COLUMN     "qualification" TEXT,
ADD COLUMN     "religion" TEXT,
ADD COLUMN     "requestedAmount" DECIMAL(15,2),
ADD COLUMN     "smartCardNo" TEXT,
ADD COLUMN     "spouseName" TEXT,
ADD COLUMN     "spouseOccupation" TEXT,
ADD COLUMN     "state" TEXT,
ADD COLUMN     "votersIdNo" TEXT;

-- AlterTable
ALTER TABLE "loans" ADD COLUMN     "frequency" TEXT,
ADD COLUMN     "indexId" TEXT,
ADD COLUMN     "interestPaid" DECIMAL(15,2) NOT NULL DEFAULT 0,
ADD COLUMN     "lastPaymentDate" TIMESTAMP(3),
ADD COLUMN     "loanProductId" TEXT,
ADD COLUMN     "penaltiesPaid" DECIMAL(15,2) NOT NULL DEFAULT 0,
ADD COLUMN     "principalPaid" DECIMAL(15,2) NOT NULL DEFAULT 0,
ADD COLUMN     "purpose" TEXT;

-- CreateTable
CREATE TABLE "groups" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "status" "GroupStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_members" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "group_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_schedules" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "installmentNo" INTEGER NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "principalDue" DECIMAL(15,2) NOT NULL,
    "interestDue" DECIMAL(15,2) NOT NULL,
    "penaltiesDue" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "feesDue" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "totalDue" DECIMAL(15,2) NOT NULL,
    "principalPaid" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "interestPaid" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "penaltiesPaid" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "feesPaid" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "totalPaid" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "status" "ScheduleStatus" NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loan_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_transactions" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "centerId" TEXT,
    "branchId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "type" "TransactionType" NOT NULL,
    "paymentMode" "PaymentMode" NOT NULL DEFAULT 'CASH',
    "collectedById" TEXT NOT NULL,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "transactionDate" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "batchId" TEXT,
    "remarks" TEXT,
    "principalAmount" DECIMAL(15,2),
    "interestAmount" DECIMAL(15,2),
    "feesAmount" DECIMAL(15,2),
    "penaltyAmount" DECIMAL(15,2),
    "isReversed" BOOLEAN NOT NULL DEFAULT false,
    "revertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loan_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "center_transfers" (
    "id" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "previousFdoId" TEXT,
    "transferredToFdoId" TEXT NOT NULL,
    "meetingDay" TEXT,
    "transferredById" TEXT NOT NULL,
    "isReverted" BOOLEAN NOT NULL DEFAULT false,
    "revertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "center_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_products" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "loanAmount" DECIMAL(15,2) NOT NULL,
    "interestRate" DECIMAL(5,2),
    "insuranceFees" DECIMAL(10,2),
    "frequency" TEXT NOT NULL,
    "interestAmount" DECIMAL(15,2),
    "numberOfDues" INTEGER NOT NULL,
    "documentCharges" DECIMAL(10,2),
    "scheduleOption" TEXT,
    "fromDue" TIMESTAMP(3),
    "tillDue" TIMESTAMP(3),
    "principal" DECIMAL(15,2),
    "interest" DECIMAL(15,2),
    "loginStatus" TEXT NOT NULL DEFAULT 'enabled',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loan_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_product_mappings" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "frequency" TEXT,
    "loanAmount" DECIMAL(15,2),
    "totalDues" INTEGER,
    "interest" DECIMAL(15,2),
    "isAccessible" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branch_product_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_indexes" (
    "id" TEXT NOT NULL,
    "indexNo" TEXT NOT NULL,
    "indexDate" TIMESTAMP(3) NOT NULL,
    "centerId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "totalApps" INTEGER NOT NULL,
    "totalAmount" DECIMAL(15,2) NOT NULL,
    "createdById" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loan_indexes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_locks" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "currentWorkingDate" TIMESTAMP(3) NOT NULL,
    "lockTime" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branch_locks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "group_members_groupId_clientId_key" ON "group_members"("groupId", "clientId");

-- CreateIndex
CREATE INDEX "loan_schedules_dueDate_idx" ON "loan_schedules"("dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "loan_schedules_loanId_installmentNo_key" ON "loan_schedules"("loanId", "installmentNo");

-- CreateIndex
CREATE UNIQUE INDEX "loan_transactions_transactionId_key" ON "loan_transactions"("transactionId");

-- CreateIndex
CREATE INDEX "loan_transactions_loanId_idx" ON "loan_transactions"("loanId");

-- CreateIndex
CREATE INDEX "loan_transactions_transactionDate_idx" ON "loan_transactions"("transactionDate");

-- CreateIndex
CREATE UNIQUE INDEX "loan_products_productId_key" ON "loan_products"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "branch_product_mappings_branchId_productId_key" ON "branch_product_mappings"("branchId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "loan_indexes_indexNo_key" ON "loan_indexes"("indexNo");

-- CreateIndex
CREATE UNIQUE INDEX "branch_locks_branchId_key" ON "branch_locks"("branchId");

-- AddForeignKey
ALTER TABLE "centers" ADD CONSTRAINT "centers_fdoId_fkey" FOREIGN KEY ("fdoId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "groups" ADD CONSTRAINT "groups_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "centers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "groups" ADD CONSTRAINT "groups_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_loanProductId_fkey" FOREIGN KEY ("loanProductId") REFERENCES "loan_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_indexId_fkey" FOREIGN KEY ("indexId") REFERENCES "loan_indexes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_schedules" ADD CONSTRAINT "loan_schedules_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "loans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_transactions" ADD CONSTRAINT "loan_transactions_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "loans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_transactions" ADD CONSTRAINT "loan_transactions_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_transactions" ADD CONSTRAINT "loan_transactions_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_transactions" ADD CONSTRAINT "loan_transactions_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_transactions" ADD CONSTRAINT "loan_transactions_collectedById_fkey" FOREIGN KEY ("collectedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "center_transfers" ADD CONSTRAINT "center_transfers_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "centers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "center_transfers" ADD CONSTRAINT "center_transfers_previousFdoId_fkey" FOREIGN KEY ("previousFdoId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "center_transfers" ADD CONSTRAINT "center_transfers_transferredToFdoId_fkey" FOREIGN KEY ("transferredToFdoId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "center_transfers" ADD CONSTRAINT "center_transfers_transferredById_fkey" FOREIGN KEY ("transferredById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_product_mappings" ADD CONSTRAINT "branch_product_mappings_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_indexes" ADD CONSTRAINT "loan_indexes_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_indexes" ADD CONSTRAINT "loan_indexes_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_indexes" ADD CONSTRAINT "loan_indexes_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_locks" ADD CONSTRAINT "branch_locks_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
