-- Rename bg* columns to qc* in kyc_documents and clients tables
-- All data is preserved; only column names change.

-- kyc_documents table
ALTER TABLE "kyc_documents" RENAME COLUMN "bgDecision"   TO "qcDecision";
ALTER TABLE "kyc_documents" RENAME COLUMN "bgRemark"     TO "qcRemark";
ALTER TABLE "kyc_documents" RENAME COLUMN "bgReviewerId" TO "qcReviewerId";
ALTER TABLE "kyc_documents" RENAME COLUMN "bgReviewedAt" TO "qcReviewedAt";

-- clients table
ALTER TABLE "clients" RENAME COLUMN "bgVerifiedById" TO "qcVerifiedById";
ALTER TABLE "clients" RENAME COLUMN "bgVerifiedAt"   TO "qcVerifiedAt";
ALTER TABLE "clients" RENAME COLUMN "bgRemarks"      TO "qcRemarks";
