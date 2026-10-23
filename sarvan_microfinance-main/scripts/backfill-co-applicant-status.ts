/**
 * One-time script to migrate existing (legacy 1:1) CoApplicant rows into the
 * new multi-co-applicant model: each existing row becomes the client's
 * Primary co-applicant, fully approved at every stage, and ACTIVE — so
 * nothing changes for existing clients/loans after this ships.
 * Run with: npx tsx scripts/backfill-co-applicant-status.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('🔍 Finding co-applicants still in default (unmigrated) state...');

    const coApplicants = await prisma.coApplicant.findMany({
        where: { status: 'PENDING_APPROVAL', isPrimary: false },
        select: { id: true, clientId: true, name: true },
    });

    if (coApplicants.length === 0) {
        console.log('✅ No co-applicants need migrating. Nothing to do.');
        return;
    }

    console.log(`📋 Found ${coApplicants.length} co-applicant(s) to migrate.`);

    const systemUser = await prisma.user.findFirst({
        where: { role: 'ADMIN', isActive: true },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
    });

    const now = new Date();

    for (const co of coApplicants) {
        await prisma.$transaction(async (tx) => {
            await tx.coApplicant.update({
                where: { id: co.id },
                data: {
                    isPrimary: true,
                    status: 'ACTIVE',
                    currentStage: null,
                    bmDecision: 'APPROVED',
                    amDecision: 'APPROVED',
                    qcDecision: 'APPROVED',
                    adminDecision: 'APPROVED',
                    activatedAt: now,
                    activatedById: systemUser?.id ?? null,
                },
            });

            if (systemUser) {
                await tx.coApplicantHistory.create({
                    data: {
                        coApplicantId: co.id,
                        action: 'MIGRATED',
                        performedById: systemUser.id,
                        remarks: 'Migrated from legacy single-co-applicant model — marked Primary, fully approved, and Active.',
                    },
                });
            }
        });
        console.log(`   ✓ ${co.name} (client ${co.clientId})`);
    }

    if (!systemUser) {
        console.warn('⚠️  No active ADMIN user found — CoApplicantHistory entries were skipped (co-applicant rows were still migrated).');
    }

    console.log(`\n✅ Migrated ${coApplicants.length} co-applicant(s) successfully.`);
}

main()
    .catch((error) => {
        console.error('❌ Error:', error);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
