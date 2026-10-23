-- CreateEnum
CREATE TYPE "AuditType" AS ENUM ('CENTER_AUDIT', 'GROUP_AUDIT');

-- CreateEnum
CREATE TYPE "AuditProposalStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateTable: audit_proposals
CREATE TABLE "audit_proposals" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "groupId" TEXT,
    "meetingLocation" TEXT NOT NULL,
    "proposalDate" TIMESTAMP(3) NOT NULL,
    "auditType" "AuditType" NOT NULL DEFAULT 'CENTER_AUDIT',
    "status" "AuditProposalStatus" NOT NULL DEFAULT 'PENDING',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "audit_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable: audit_proposal_clients
CREATE TABLE "audit_proposal_clients" (
    "id" TEXT NOT NULL,
    "auditProposalId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "isAudited" BOOLEAN NOT NULL DEFAULT false,
    "auditedAt" TIMESTAMP(3),
    "isRemoved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audit_proposal_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable: audit_proposal_days
CREATE TABLE "audit_proposal_days" (
    "id" TEXT NOT NULL,
    "auditProposalId" TEXT NOT NULL,
    "dayNumber" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "officerId" TEXT NOT NULL,
    "questionnaireId" TEXT NOT NULL,
    "isFinalDay" BOOLEAN NOT NULL DEFAULT false,
    "supervisorId" TEXT,
    "supervisorQuestionnaireId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audit_proposal_days_pkey" PRIMARY KEY ("id")
);

-- Unique constraints
CREATE UNIQUE INDEX "audit_proposals_proposalId_key" ON "audit_proposals"("proposalId");
CREATE UNIQUE INDEX "audit_proposal_clients_auditProposalId_clientId_key" ON "audit_proposal_clients"("auditProposalId", "clientId");

-- Indexes
CREATE INDEX "audit_proposals_branchId_idx" ON "audit_proposals"("branchId");
CREATE INDEX "audit_proposals_centerId_idx" ON "audit_proposals"("centerId");
CREATE INDEX "audit_proposals_groupId_idx" ON "audit_proposals"("groupId");
CREATE INDEX "audit_proposal_clients_auditProposalId_idx" ON "audit_proposal_clients"("auditProposalId");
CREATE INDEX "audit_proposal_days_auditProposalId_idx" ON "audit_proposal_days"("auditProposalId");

-- Foreign keys: audit_proposals
ALTER TABLE "audit_proposals" ADD CONSTRAINT "audit_proposals_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "audit_proposals" ADD CONSTRAINT "audit_proposals_centerId_fkey"
    FOREIGN KEY ("centerId") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "audit_proposals" ADD CONSTRAINT "audit_proposals_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "audit_proposals" ADD CONSTRAINT "audit_proposals_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Foreign keys: audit_proposal_clients
ALTER TABLE "audit_proposal_clients" ADD CONSTRAINT "audit_proposal_clients_auditProposalId_fkey"
    FOREIGN KEY ("auditProposalId") REFERENCES "audit_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "audit_proposal_clients" ADD CONSTRAINT "audit_proposal_clients_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Foreign keys: audit_proposal_days
ALTER TABLE "audit_proposal_days" ADD CONSTRAINT "audit_proposal_days_auditProposalId_fkey"
    FOREIGN KEY ("auditProposalId") REFERENCES "audit_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "audit_proposal_days" ADD CONSTRAINT "audit_proposal_days_officerId_fkey"
    FOREIGN KEY ("officerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "audit_proposal_days" ADD CONSTRAINT "audit_proposal_days_questionnaireId_fkey"
    FOREIGN KEY ("questionnaireId") REFERENCES "questionnaires"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "audit_proposal_days" ADD CONSTRAINT "audit_proposal_days_supervisorId_fkey"
    FOREIGN KEY ("supervisorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "audit_proposal_days" ADD CONSTRAINT "audit_proposal_days_supervisorQuestionnaireId_fkey"
    FOREIGN KEY ("supervisorQuestionnaireId") REFERENCES "questionnaires"("id") ON DELETE SET NULL ON UPDATE CASCADE;
