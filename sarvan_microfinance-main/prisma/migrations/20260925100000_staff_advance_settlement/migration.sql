-- Early settlement of a Staff Advance is paid directly (Cash / Bank Transfer) instead of through payroll,
-- so its transaction records how it was paid. Both columns are null for every existing salary deduction.
ALTER TABLE "staff_advance_transactions"
  ADD COLUMN IF NOT EXISTS "paymentMode" "PaymentMode",
  ADD COLUMN IF NOT EXISTS "reference" TEXT;
