/**
 * One-time script to backfill employeeId for all existing users.
 * Run with: npx tsx scripts/backfill-employee-ids.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('🔍 Checking for users without employeeId...');

    // Find the current highest employeeId to continue the sequence
    const lastUser = await prisma.user.findFirst({
        where: { employeeId: { not: null } },
        orderBy: { employeeId: 'desc' },
        select: { employeeId: true },
    });

    let nextSeq = 1;
    if (lastUser?.employeeId) {
        const match = lastUser.employeeId.match(/(\d+)$/);
        if (match) nextSeq = parseInt(match[1], 10) + 1;
    }

    // Fetch all users without an employeeId, ordered by creation date
    const usersWithoutId = await prisma.user.findMany({
        where: { employeeId: null },
        orderBy: { createdAt: 'asc' },
        select: { id: true, firstName: true, lastName: true },
    });

    if (usersWithoutId.length === 0) {
        console.log('✅ All users already have employeeId assigned. Nothing to do.');
        return;
    }

    console.log(`📋 Found ${usersWithoutId.length} users without employeeId. Assigning...`);

    // Batch update inside a transaction
    const updates = usersWithoutId.map((user, index) => {
        const empId = `EMP-${String(nextSeq + index).padStart(3, '0')}`;
        return prisma.user.update({
            where: { id: user.id },
            data: { employeeId: empId },
            select: { id: true, employeeId: true, firstName: true, lastName: true },
        });
    });

    const results = await prisma.$transaction(updates);

    console.log(`\n✅ Successfully assigned employeeId to ${results.length} users:\n`);
    results.forEach((r) => {
        console.log(`   ${r.employeeId} → ${r.firstName} ${r.lastName}`);
    });
}

main()
    .catch((error) => {
        console.error('❌ Error:', error);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
