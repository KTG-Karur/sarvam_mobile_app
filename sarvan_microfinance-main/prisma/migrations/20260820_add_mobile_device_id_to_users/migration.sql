-- Add mobileDeviceId column to users table for mobile device binding (one employee = one device)
ALTER TABLE "users" ADD COLUMN "mobileDeviceId" TEXT;
CREATE UNIQUE INDEX "users_mobileDeviceId_key" ON "users"("mobileDeviceId");
