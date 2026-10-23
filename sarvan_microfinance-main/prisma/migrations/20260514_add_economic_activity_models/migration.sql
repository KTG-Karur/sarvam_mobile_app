-- CreateTable economic_activity_types
CREATE TABLE "economic_activity_types" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "typeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

-- CreateTable economic_activities
CREATE TABLE "economic_activities" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "activityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "economicActivityTypeId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "economic_activities_economicActivityTypeId_fkey" FOREIGN KEY ("economicActivityTypeId") REFERENCES "economic_activity_types" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- AddColumn economicActivityId to clients
ALTER TABLE "clients" ADD COLUMN "economicActivityId" TEXT;

-- AddForeignKey clients to economic_activities
ALTER TABLE "clients" ADD CONSTRAINT "clients_economicActivityId_fkey" FOREIGN KEY ("economicActivityId") REFERENCES "economic_activities" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE UNIQUE INDEX "economic_activity_types_typeId_key" ON "economic_activity_types"("typeId");

-- CreateIndex
CREATE UNIQUE INDEX "economic_activity_types_name_key" ON "economic_activity_types"("name");

-- CreateIndex
CREATE UNIQUE INDEX "economic_activities_activityId_key" ON "economic_activities"("activityId");

-- CreateIndex
CREATE INDEX "economic_activities_economicActivityTypeId_idx" ON "economic_activities"("economicActivityTypeId");
