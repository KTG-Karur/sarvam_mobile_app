-- Add MPIN fields to users table for mobile MPIN authentication
ALTER TABLE "users" ADD COLUMN "mpinHash" TEXT;
ALTER TABLE "users" ADD COLUMN "mpinFailedAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN "mpinLastFailedAt" TIMESTAMP(3);
