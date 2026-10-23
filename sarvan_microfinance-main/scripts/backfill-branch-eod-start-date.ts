import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// One-time backfill: branches created before `eodStartDate` became a required
// field on branch creation have it as null. For any such branch that already
// has a BranchLock, fill eodStartDate from that lock's currentWorkingDate —
// the EOD date it's already effectively running on. Branches with no
// BranchLock at all (never touched an EOD screen) are left null; there's no
// "current EOD date" yet to backfill from.
async function main() {
    const apply = process.argv.includes('--apply');

    const branches = await prisma.branch.findMany({
        where: { eodStartDate: null },
        select: {
            id: true,
            name: true,
            code: true,
            lock: { select: { currentWorkingDate: true } },
        },
    });

    const toBackfill = branches.filter((b) => b.lock !== null);
    const noLockYet = branches.filter((b) => b.lock === null);

    if (apply) {
        for (const branch of toBackfill) {
            await prisma.branch.update({
                where: { id: branch.id },
                data: { eodStartDate: branch.lock!.currentWorkingDate },
            });
        }
    }

    console.log(JSON.stringify({
        mode: apply ? 'apply' : 'dry-run',
        backfilled: toBackfill.map((b) => ({
            id: b.id,
            code: b.code,
            name: b.name,
            eodStartDate: b.lock!.currentWorkingDate,
        })),
        skippedNoBranchLockYet: noLockYet.map((b) => ({ id: b.id, code: b.code, name: b.name })),
    }, null, 2));
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
