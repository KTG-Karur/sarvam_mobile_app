-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "nomineePhone" TEXT;

-- CreateTable
CREATE TABLE "client_attendance" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "attendanceDate" TIMESTAMP(3) NOT NULL,
    "isPresent" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_transfers" (
    "id" TEXT NOT NULL,
    "transferDate" TIMESTAMP(3) NOT NULL,
    "fromBranchId" TEXT NOT NULL,
    "toBranchId" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "toAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "narration" TEXT,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branch_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_types" (
    "id" TEXT NOT NULL,
    "typeId" INTEGER NOT NULL,
    "leaveType" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_types_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_attendance_centerId_attendanceDate_idx" ON "client_attendance"("centerId", "attendanceDate");

-- CreateIndex
CREATE UNIQUE INDEX "client_attendance_clientId_attendanceDate_key" ON "client_attendance"("clientId", "attendanceDate");

-- CreateIndex
CREATE UNIQUE INDEX "leave_types_typeId_key" ON "leave_types"("typeId");

-- CreateIndex
CREATE UNIQUE INDEX "leave_types_leaveType_key" ON "leave_types"("leaveType");

-- AddForeignKey
ALTER TABLE "client_attendance" ADD CONSTRAINT "client_attendance_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_attendance" ADD CONSTRAINT "client_attendance_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_attendance" ADD CONSTRAINT "client_attendance_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_attendance" ADD CONSTRAINT "client_attendance_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_transfers" ADD CONSTRAINT "branch_transfers_fromBranchId_fkey" FOREIGN KEY ("fromBranchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_transfers" ADD CONSTRAINT "branch_transfers_toBranchId_fkey" FOREIGN KEY ("toBranchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_transfers" ADD CONSTRAINT "branch_transfers_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
