-- Minimum monthly-salary eligibility criterion on staff loan schemes.
ALTER TABLE "staff_loan_schemes"
  ADD COLUMN IF NOT EXISTS "minimumSalaryPerMonth" DECIMAL(15,2) NOT NULL DEFAULT 0;

-- Allow MONTHLY (like FLAT: a positive rate) through the interest-consistency
-- checks on both the scheme master and the loan itself.
ALTER TABLE "staff_loan_schemes"
  DROP CONSTRAINT IF EXISTS "staff_loan_scheme_interest_check";
ALTER TABLE "staff_loan_schemes"
  ADD CONSTRAINT "staff_loan_scheme_interest_check" CHECK (
    ("interestType" = 'INTEREST_FREE' AND "annualInterestRate" = 0)
    OR ("interestType" = 'FLAT' AND "annualInterestRate" > 0)
    OR ("interestType" = 'MONTHLY' AND "annualInterestRate" > 0)
  );

ALTER TABLE "staff_loans"
  DROP CONSTRAINT IF EXISTS "staff_loan_interest_check";
ALTER TABLE "staff_loans"
  ADD CONSTRAINT "staff_loan_interest_check" CHECK (
    ("interestType" = 'INTEREST_FREE' AND "annualInterestRate" = 0)
    OR ("interestType" = 'FLAT' AND "annualInterestRate" > 0)
    OR ("interestType" = 'MONTHLY' AND "annualInterestRate" > 0)
  );
