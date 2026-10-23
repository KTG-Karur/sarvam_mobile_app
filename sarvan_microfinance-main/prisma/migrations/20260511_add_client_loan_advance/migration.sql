-- Add loanAdvance field to clients table for client-wise loan advance tracking
ALTER TABLE "clients" ADD COLUMN "loanAdvance" DECIMAL(15,2) NOT NULL DEFAULT 0;
