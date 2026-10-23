-- Business-facing staff loan numbers: SL-000001, SL-000002, ...
-- The internal key stays the cuid "id"; "loanNumber" is display-only.
CREATE SEQUENCE IF NOT EXISTS "staff_loan_number_seq";

-- Backfill rows still carrying the old SL-<uuid> value, oldest first, continuing after
-- any short numbers that already exist (idempotent: re-running changes nothing).
WITH base AS (
  SELECT COALESCE(MAX(substring("loanNumber" from 4)::bigint), 0) AS max_no
  FROM "staff_loans" WHERE "loanNumber" ~ '^SL-[0-9]+$'
), ordered AS (
  SELECT id, row_number() OVER (ORDER BY "createdAt", id) AS rn
  FROM "staff_loans" WHERE "loanNumber" !~ '^SL-[0-9]+$'
)
UPDATE "staff_loans" l
SET "loanNumber" = 'SL-' || lpad((o.rn + b.max_no)::text, 6, '0')
FROM ordered o, base b
WHERE l.id = o.id;

-- Next generated number continues after the highest one assigned.
SELECT setval(
  'staff_loan_number_seq',
  (SELECT COALESCE(MAX(substring("loanNumber" from 4)::bigint), 0) FROM "staff_loans" WHERE "loanNumber" ~ '^SL-[0-9]+$') + 1,
  false
);
