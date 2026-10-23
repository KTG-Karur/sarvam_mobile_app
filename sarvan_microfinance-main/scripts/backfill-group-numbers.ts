/**
 * One-time script to backfill Group.groupNumber for existing groups whose
 * names already follow the auto-naming convention "<Center Name> - N".
 *
 * Names are never modified — only the new nullable groupNumber column is
 * populated, so fill-ordering and future numbering stay continuous for
 * centers that already follow the convention.
 *
 * Run with: npx tsx scripts/backfill-group-numbers.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function main() {
    console.log('🔍 Scanning centers for groups matching "<Center Name> - N"...');

    const centers = await prisma.center.findMany({
        select: {
            id: true,
            name: true,
            groups: {
                select: { id: true, name: true, groupNumber: true },
                orderBy: { createdAt: 'asc' },
            },
        },
    });

    let assigned = 0;
    let skipped = 0;

    for (const center of centers) {
        const pattern = new RegExp(`^${escapeRegExp(center.name.trim())} - (\\d+)$`);
        const claimed = new Set(
            center.groups
                .map((g) => g.groupNumber)
                .filter((n): n is number => n !== null)
        );

        const updates: { id: string; name: string; groupNumber: number }[] = [];

        for (const group of center.groups) {
            if (group.groupNumber !== null) continue;
            const match = group.name.trim().match(pattern);
            if (!match) continue;

            const n = parseInt(match[1], 10);
            if (n < 1 || claimed.has(n)) {
                console.log(
                    `⚠️  Skipping "${group.name}" in center "${center.name}" — number ${n} is ${n < 1 ? 'invalid' : 'already claimed'}`
                );
                skipped++;
                continue;
            }

            claimed.add(n);
            updates.push({ id: group.id, name: group.name, groupNumber: n });
        }

        if (updates.length === 0) continue;

        await prisma.$transaction(
            updates.map((u) =>
                prisma.group.update({
                    where: { id: u.id },
                    data: { groupNumber: u.groupNumber },
                })
            )
        );

        for (const u of updates) {
            console.log(`✅ "${u.name}" → groupNumber ${u.groupNumber}`);
        }
        assigned += updates.length;
    }

    console.log(`\nDone. Assigned ${assigned} group number(s), skipped ${skipped}.`);
}

main()
    .catch((e) => {
        console.error('❌ Backfill failed:', e);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
