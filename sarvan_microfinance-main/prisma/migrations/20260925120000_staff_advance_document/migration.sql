-- Supporting document (image / PDF) on a Staff Advance, same shape as the Staff Loan one.
-- Nullable: advances applied before the document became mandatory simply have none.
ALTER TABLE "staff_advances"
  ADD COLUMN IF NOT EXISTS "documentKey" TEXT,
  ADD COLUMN IF NOT EXISTS "documentName" TEXT,
  ADD COLUMN IF NOT EXISTS "documentMimeType" TEXT,
  ADD COLUMN IF NOT EXISTS "documentSize" INTEGER;
