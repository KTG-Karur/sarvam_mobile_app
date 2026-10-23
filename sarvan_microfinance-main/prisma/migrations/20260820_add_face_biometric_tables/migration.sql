-- CreateTable
CREATE TABLE "face_templates" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "encryptedTemplate" TEXT NOT NULL,
    "hmacSignature" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL,
    "vectorSize" INTEGER NOT NULL,
    "featureVector" JSONB NOT NULL,
    "qualityScore" DOUBLE PRECISION NOT NULL,
    "livenessVerified" BOOLEAN NOT NULL DEFAULT false,
    "photoKey" TEXT,
    "deviceId" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "face_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "face_verification_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "matched" BOOLEAN NOT NULL,
    "scorePercent" DOUBLE PRECISION NOT NULL,
    "deviceId" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "face_verification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "face_templates_userId_key" ON "face_templates"("userId");

-- CreateIndex
CREATE INDEX "face_verification_logs_userId_createdAt_idx" ON "face_verification_logs"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "face_templates" ADD CONSTRAINT "face_templates_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "face_verification_logs" ADD CONSTRAINT "face_verification_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
