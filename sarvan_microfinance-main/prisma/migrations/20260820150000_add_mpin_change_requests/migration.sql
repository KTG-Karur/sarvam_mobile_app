-- Mobile MPIN change (forgot-MPIN) maker-checker workflow
CREATE TYPE "MpinChangeRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'COMPLETED');

CREATE TABLE "mpin_change_requests" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "status" "MpinChangeRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedById" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mpin_change_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "mpin_change_requests_status_createdAt_idx" ON "mpin_change_requests"("status", "createdAt");
CREATE INDEX "mpin_change_requests_employeeId_status_idx" ON "mpin_change_requests"("employeeId", "status");

ALTER TABLE "mpin_change_requests" ADD CONSTRAINT "mpin_change_requests_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mpin_change_requests" ADD CONSTRAINT "mpin_change_requests_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mpin_change_requests" ADD CONSTRAINT "mpin_change_requests_rejectedById_fkey" FOREIGN KEY ("rejectedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
