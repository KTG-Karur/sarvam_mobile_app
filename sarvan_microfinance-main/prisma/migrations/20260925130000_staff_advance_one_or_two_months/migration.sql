-- A Staff Advance is repaid in one or two monthly installments, chosen on the application (it used to be exactly two).
-- Existing advances all have repaymentMonths = 2 and stay valid. The installment-number check (1..2) already fits.
ALTER TABLE "staff_advances" DROP CONSTRAINT IF EXISTS "staff_advance_terms_check";
ALTER TABLE "staff_advances"
  ADD CONSTRAINT "staff_advance_terms_check" CHECK ("amount" > 0 AND "repaymentMonths" IN (1, 2) AND "version" > 0);
