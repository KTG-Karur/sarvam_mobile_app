-- Payment details captured at disbursement.
ALTER TABLE "staff_advances"
  ADD COLUMN "disbursedAt" TIMESTAMP(3),
  ADD COLUMN "paymentMode" "PaymentMode",
  ADD COLUMN "paymentReference" TEXT;

-- An approved-but-not-yet-disbursed advance is still an open advance: one per employee.
DROP INDEX "staff_advance_one_open_per_employee_key";
CREATE UNIQUE INDEX "staff_advance_one_open_per_employee_key"
  ON "staff_advances" ("employeeId") WHERE "status" IN ('SUBMITTED', 'APPROVED', 'ACTIVE');