-- CreateEnum
CREATE TYPE "FaceReRegistrationRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'COMPLETED');

-- CreateTable
CREATE TABLE "face_reregistration_requests" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT,
    "status" "FaceReRegistrationRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedById" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "face_reregistration_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "face_reregistration_requests_userId_status_idx" ON "face_reregistration_requests"("userId", "status");

-- CreateIndex
CREATE INDEX "face_reregistration_requests_status_createdAt_idx" ON "face_reregistration_requests"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "face_reregistration_requests" ADD CONSTRAINT "face_reregistration_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "face_reregistration_requests" ADD CONSTRAINT "face_reregistration_requests_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "face_reregistration_requests" ADD CONSTRAINT "face_reregistration_requests_rejectedById_fkey" FOREIGN KEY ("rejectedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
