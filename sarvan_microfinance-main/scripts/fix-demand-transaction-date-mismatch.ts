/**
 * One-off data fix: correct `LoanTransaction.transactionDate` for PENDING collections
 * that were stamped with the real server clock instant (bug in app/api/collections/
 * demand/route.ts and app/api/collections/arrear/route.ts, fixed in the same change
 * that added this script) instead of the submitted business day. This left them
 * invisible on /dashboard/collections/approval whenever the branch's EOD working day
 * lagged behind the real calendar day.
 *
 * For every CollectionMeetingRecord in scope, finds its PENDING LoanTransaction rows
 * (joined via the shared collectionBatchId) whose transactionDate falls outside that
 * record's collectionDate's Kolkata calendar day, and corrects transactionDate to the
 * start of that day — matching what a correct submission would have written.
 *
 * Scoped to the reported branch/date (Sattur, 2026-08-04) rather than a blanket sweep.
 *
 * Usage: npx tsx scripts/fix-demand-transaction-date-mismatch.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { parseKolkataAttendanceDateYmd, getKolkataDayEndExclusiveUtc } from '@/app/lib/branch-lock';

const BRANCH_NAME = 'Sattur';
const AFFECTED_YMD = '2026-08-04';

async function main() {
    const prisma = new PrismaClient();
    try {
        const branch = await prisma.branch.findFirst({ where: { name: BRANCH_NAME } });
        if (!branch) {
            throw new Error(`Branch not found: ${BRANCH_NAME}`);
        }

        const dayStartUtc = parseKolkataAttendanceDateYmd(AFFECTED_YMD);
        const dayEndExclusiveUtc = getKolkataDayEndExclusiveUtc(dayStartUtc);

        console.log(`Branch: ${branch.name} (${branch.id})`);
        console.log(`Target business day: ${AFFECTED_YMD}`);
        console.log(`Correct transactionDate window: ${dayStartUtc.toISOString()} - ${dayEndExclusiveUtc.toISOString()}`);

        const meetingRecords = await prisma.collectionMeetingRecord.findMany({
            where: {
                branchId: branch.id,
                collectionDate: new Date(`${AFFECTED_YMD}T00:00:00.000Z`),
            },
            select: { collectionBatchId: true, centerId: true },
        });

        if (meetingRecords.length === 0) {
            console.log('No CollectionMeetingRecord found for this branch/date — nothing to do.');
            return;
        }

        const batchIds = meetingRecords.map((m) => m.collectionBatchId);
        console.log(`Found ${batchIds.length} collection batch(es): ${batchIds.join(', ')}`);

        const transactions = await prisma.loanTransaction.findMany({
            where: {
                collectionBatchId: { in: batchIds },
                status: 'PENDING',
            },
            select: { id: true, transactionId: true, transactionDate: true, amount: true, type: true },
        });

        console.log(`Found ${transactions.length} PENDING transaction(s) in these batches.`);

        let fixed = 0;
        for (const txn of transactions) {
            const inWindow = txn.transactionDate >= dayStartUtc && txn.transactionDate < dayEndExclusiveUtc;
            if (inWindow) {
                console.log(`  SKIP ${txn.transactionId}: transactionDate already correct (${txn.transactionDate.toISOString()})`);
                continue;
            }

            console.log(
                `  FIX ${txn.transactionId} (${txn.type}, amount=${txn.amount}): ${txn.transactionDate.toISOString()} -> ${dayStartUtc.toISOString()}`
            );
            await prisma.loanTransaction.update({
                where: { id: txn.id },
                data: { transactionDate: dayStartUtc },
            });
            fixed += 1;
        }

        console.log(`\nDone. Corrected ${fixed} of ${transactions.length} transaction(s).`);
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
