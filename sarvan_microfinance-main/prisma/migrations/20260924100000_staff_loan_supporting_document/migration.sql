-- Supporting document (image/PDF) attached to a staff loan application.
ALTER TABLE "staff_loans"
  ADD COLUMN IF NOT EXISTS "documentKey" TEXT,
  ADD COLUMN IF NOT EXISTS "documentName" TEXT,
  ADD COLUMN IF NOT EXISTS "documentMimeType" TEXT,
  ADD COLUMN IF NOT EXISTS "documentSize" INTEGER;
