/*
  Warnings:

  - The values [PRESENT,LEAVE] on the enum `AttendanceStatus` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `fromDue` on the `loan_products` table. All the data in the column will be lost.
  - You are about to drop the column `interest` on the `loan_products` table. All the data in the column will be lost.
  - You are about to drop the column `loginStatus` on the `loan_products` table. All the data in the column will be lost.
  - You are about to drop the column `principal` on the `loan_products` table. All the data in the column will be lost.
  - You are about to drop the column `scheduleOption` on the `loan_products` table. All the data in the column will be lost.
  - You are about to drop the column `tillDue` on the `loan_products` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[employeeId]` on the table `users` will be added. If there are existing duplicate values, this will fail.
  - Made the column `interestRate` on table `loan_products` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "SalaryComponentType" AS ENUM ('EARNINGS', 'DEDUCTIONS');

-- AlterEnum
BEGIN;
CREATE TYPE "AttendanceStatus_new" AS ENUM ('PRESET', 'ABSENT', 'HALF_DAY', 'FULL_DAY', 'HOLIDAY');
ALTER TABLE "public"."attendance" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "attendance" ALTER COLUMN "status" TYPE "AttendanceStatus_new" USING ("status"::text::"AttendanceStatus_new");
ALTER TYPE "AttendanceStatus" RENAME TO "AttendanceStatus_old";
ALTER TYPE "AttendanceStatus_new" RENAME TO "AttendanceStatus";
DROP TYPE "public"."AttendanceStatus_old";
ALTER TABLE "attendance" ALTER COLUMN "status" SET DEFAULT 'PRESET';
COMMIT;

-- AlterTable
ALTER TABLE "attendance" ADD COLUMN     "branchId" TEXT,
ADD COLUMN     "isHoliday" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "leaveTypeId" TEXT,
ALTER COLUMN "status" SET DEFAULT 'PRESET';

-- AlterTable
ALTER TABLE "loan_products" DROP COLUMN "fromDue",
DROP COLUMN "interest",
DROP COLUMN "loginStatus",
DROP COLUMN "principal",
DROP COLUMN "scheduleOption",
DROP COLUMN "tillDue",
ADD COLUMN     "interestMethod" TEXT NOT NULL DEFAULT 'FLAT',
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'enabled',
ALTER COLUMN "interestRate" SET NOT NULL;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "employeeId" TEXT;

-- CreateTable
CREATE TABLE "product_schedule_templates" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "installmentNo" INTEGER NOT NULL,
    "principalAmount" DECIMAL(15,2) NOT NULL,
    "interestAmount" DECIMAL(15,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_schedule_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_leave_balances" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "openingBalance" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "remainingBalance" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_leave_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salary_components" (
    "id" TEXT NOT NULL,
    "salaryId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "type" "SalaryComponentType" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "salary_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_salary_masters" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "salaryComponentId" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_salary_masters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salary_pay_records" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "paymentType" TEXT NOT NULL,
    "totalEarnings" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "totalDeductions" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "netPayable" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PAID',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "salary_pay_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salary_pay_line_items" (
    "id" TEXT NOT NULL,
    "salaryPayRecordId" TEXT NOT NULL,
    "salaryComponentId" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "salary_pay_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_schedule_templates_productId_installmentNo_key" ON "product_schedule_templates"("productId", "installmentNo");

-- CreateIndex
CREATE UNIQUE INDEX "employee_leave_balances_employeeId_leaveTypeId_key" ON "employee_leave_balances"("employeeId", "leaveTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "salary_components_salaryId_key" ON "salary_components"("salaryId");

-- CreateIndex
CREATE UNIQUE INDEX "salary_components_name_key" ON "salary_components"("name");

-- CreateIndex
CREATE UNIQUE INDEX "employee_salary_masters_employeeId_salaryComponentId_key" ON "employee_salary_masters"("employeeId", "salaryComponentId");

-- CreateIndex
CREATE UNIQUE INDEX "salary_pay_records_employeeId_month_year_key" ON "salary_pay_records"("employeeId", "month", "year");

-- CreateIndex
CREATE UNIQUE INDEX "salary_pay_line_items_salaryPayRecordId_salaryComponentId_key" ON "salary_pay_line_items"("salaryPayRecordId", "salaryComponentId");

-- CreateIndex
CREATE INDEX "attendance_branchId_date_idx" ON "attendance"("branchId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "users_employeeId_key" ON "users"("employeeId");

-- AddForeignKey
ALTER TABLE "product_schedule_templates" ADD CONSTRAINT "product_schedule_templates_productId_fkey" FOREIGN KEY ("productId") REFERENCES "loan_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "leave_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_leave_balances" ADD CONSTRAINT "employee_leave_balances_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_leave_balances" ADD CONSTRAINT "employee_leave_balances_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "leave_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_salary_masters" ADD CONSTRAINT "employee_salary_masters_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_salary_masters" ADD CONSTRAINT "employee_salary_masters_salaryComponentId_fkey" FOREIGN KEY ("salaryComponentId") REFERENCES "salary_components"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_pay_records" ADD CONSTRAINT "salary_pay_records_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_pay_line_items" ADD CONSTRAINT "salary_pay_line_items_salaryPayRecordId_fkey" FOREIGN KEY ("salaryPayRecordId") REFERENCES "salary_pay_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_pay_line_items" ADD CONSTRAINT "salary_pay_line_items_salaryComponentId_fkey" FOREIGN KEY ("salaryComponentId") REFERENCES "salary_components"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
