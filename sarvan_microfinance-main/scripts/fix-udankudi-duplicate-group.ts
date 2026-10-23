/**
 * One-off data fix for branch 31 (Udankudi), center "2-MUNTHIRI THOTTAM(PARAMANKURICHI)":
 *
 * 1. Re-code the center from "1" to "2" to match the legacy source system's own
 *    number (embedded as the "2-" prefix in the center name).
 * 2. Merge the two duplicate groups created by two separate uploan-import batches
 *    for the same legacy group ("1-MUTHIRI THOTTAM 01") into one — move Jenitha's
 *    GroupMember/Client.groupId into Punitha's group, delete the orphaned group,
 *    and stamp the surviving group's legacySourceName + groupNumber "1" so future
 *    imports recognize it instead of creating another duplicate.
 *
 *    Also cleans up a stray extra GroupMember row the botched retry batch created
 *    for Punitha in the orphan group (her real membership/Client.groupId already
 *    correctly points at the surviving group — this is pure orphan-group junk from
 *    a `groupMember.upsert` that didn't know to remove her old membership, since
 *    matching an existing client by mobile isn't a "transfer").
 *
 * 3. Reorder GroupMember.joinedAt so the group's person sequence matches the
 *    known source order (Jenitha = 1, Punitha = 2) — createdAt/joinedAt from the
 *    split import batches doesn't reflect the original file row order.
 *
 * Confirmed via direct DB inspection before running: no duplicate Client or Loan
 * rows exist for either person — the retry's loan-creation transaction rolled
 * back entirely on the "Invalid Date" bug, before any Loan/LoanTransaction for
 * either of them committed. Only the GroupMember rows need cleanup.
 *
 * Usage: npx tsx scripts/fix-udankudi-duplicate-group.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const CENTER_ID = 'cms49zgbu0028svv8nlo56lyu';
const SURVIVING_GROUP_ID = 'cms49zge8002asvv84581yonh'; // "...- 1", groupNumber 1 — Punitha's real group
const ORPHAN_GROUP_ID = 'cms4bps2e006gsvv8s1w3htvx'; // "...- 2", groupNumber 2 — retry-batch duplicate
const LEGACY_GROUP_NAME = '1-MUTHIRI THOTTAM 01';
const PUNITHA_CLIENT_ID = 'cms49zgff002csvv8hhv1zysq';
const JENITHA_CLIENT_ID = 'cms4bps3h006isvv8v9nvi4vu';
const PUNITHA_STRAY_MEMBER_ID = 'cms4bpsa7007ssvv8k0043qhb'; // Punitha's extra row in the orphan group

async function main() {
    const prisma = new PrismaClient();
    try {
        await prisma.$transaction(async (tx) => {
            // 1. Re-code the center to match the legacy "2-" prefix.
            const center = await tx.center.findUniqueOrThrow({ where: { id: CENTER_ID } });
            console.log(`Center ${center.name}: code "${center.code}" -> "2"`);
            await tx.center.update({ where: { id: CENTER_ID }, data: { code: '2' } });

            // 2. Merge: move Jenitha into the surviving group.
            const survivingGroup = await tx.group.findUniqueOrThrow({ where: { id: SURVIVING_GROUP_ID } });
            const orphanGroup = await tx.group.findUniqueOrThrow({ where: { id: ORPHAN_GROUP_ID } });
            console.log(`Surviving group: ${survivingGroup.name} (groupNumber ${survivingGroup.groupNumber})`);
            console.log(`Orphan group: ${orphanGroup.name} (groupNumber ${orphanGroup.groupNumber})`);

            const orphanMembers = await tx.groupMember.findMany({ where: { groupId: ORPHAN_GROUP_ID } });
            const expectedIds = new Set([JENITHA_CLIENT_ID, PUNITHA_CLIENT_ID]);
            if (orphanMembers.length !== 2 || orphanMembers.some((m) => !expectedIds.has(m.clientId))) {
                throw new Error(
                    `Orphan group members don't match the expected [Jenitha, Punitha] pair — aborting. Found: ${JSON.stringify(orphanMembers.map((m) => m.clientId))}`
                );
            }

            // Remove Punitha's stray extra membership — her real membership (in the
            // surviving group) and Client.groupId are untouched.
            await tx.groupMember.delete({ where: { id: PUNITHA_STRAY_MEMBER_ID } });

            // Move Jenitha into the surviving group.
            await tx.client.update({ where: { id: JENITHA_CLIENT_ID }, data: { groupId: SURVIVING_GROUP_ID } });
            await tx.groupMember.deleteMany({ where: { groupId: ORPHAN_GROUP_ID, clientId: JENITHA_CLIENT_ID } });

            // Rank Jenitha before Punitha within the surviving group, per the known
            // source file order — joinedAt from the split import batches doesn't
            // reflect it (Jenitha's batch ran ~48min after Punitha's). Punitha's
            // real, original GroupMember row (joinedAt 06:29:11.033Z) is left as-is;
            // Jenitha's new row gets an earlier timestamp so she ranks first.
            const jenithaJoinedAt = new Date('2026-07-28T06:29:10.000Z');
            await tx.groupMember.create({
                data: { groupId: SURVIVING_GROUP_ID, clientId: JENITHA_CLIENT_ID, joinedAt: jenithaJoinedAt },
            });

            // Delete the now-empty orphan group.
            const remaining = await tx.groupMember.count({ where: { groupId: ORPHAN_GROUP_ID } });
            if (remaining > 0) throw new Error('Orphan group still has members — aborting delete.');
            await tx.group.delete({ where: { id: ORPHAN_GROUP_ID } });
            console.log('Deleted orphan group.');

            // Stamp legacySourceName on the surviving group so future re-imports of
            // this legacy group name match it instead of creating another duplicate.
            await tx.group.update({
                where: { id: SURVIVING_GROUP_ID },
                data: { legacySourceName: LEGACY_GROUP_NAME },
            });
            console.log(`Stamped legacySourceName = "${LEGACY_GROUP_NAME}" on surviving group.`);
        });

        console.log('\nDone.');
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
