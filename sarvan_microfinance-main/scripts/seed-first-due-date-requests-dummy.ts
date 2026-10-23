/**
 * Dev-only dummy data for the First Due Date Change Request feature
 * (/dashboard/loan-module/first-due-date-requests).
 *
 * Picks indexes whose loans are APPROVED_LEVEL2 (final disbursement) and creates
 * requests in a mix of statuses. Every row's reason starts with "[DUMMY]" so it
 * can be removed again. The LAST eligible index is deliberately left without any
 * request so the BM "Request date change" button can be tested on it.
 *
 *   npx tsx scripts/seed-first-due-date-requests-dummy.ts          # create
 *   npx tsx scripts/seed-first-due-date-requests-dummy.ts --clean  # delete the dummy rows
 *
 * Does NOT touch Loan.firstDueDate — approving a PENDING row in the UI does that.
 */
import { prisma } from '../app/lib/prisma';

const TAG = '[DUMMY]';

const PLAN: { status: 'PENDING' | 'REJECTED' | 'CANCELLED'; reason: string; daysAgo: number }[] = [
    { status: 'PENDING', reason: 'Center meeting day moved to Wednesday, members asked for later first due date', daysAgo: 0 },
    { status: 'PENDING', reason: 'Festival week - collection not possible on the original date', daysAgo: 1 },
    { status: 'PENDING', reason: 'Wrong first due date selected while creating the loan index', daysAgo: 2 },
    { status: 'REJECTED', reason: 'Members want one more week before first installment', daysAgo: 4 },
    { status: 'CANCELLED', reason: 'Raised by mistake for this index', daysAgo: 6 },
];

async function main() {
    if (process.argv.includes('--clean')) {
        const res = await prisma.firstDueDateChangeRequest.deleteMany({ where: { reason: { startsWith: TAG } } });
        console.log(`Deleted ${res.count} dummy request(s).`);
        return;
    }

    const grouped = await prisma.loan.groupBy({
        by: ['indexId'],
        where: { isActive: true, disbursementStatus: 'APPROVED_LEVEL2', indexId: { not: null } },
    });
    const indexes = await prisma.loanIndex.findMany({
        where: { id: { in: grouped.map((g) => g.indexId as string) }, isActive: true },
        orderBy: { createdAt: 'asc' },
        select: { id: true, indexNo: true, branchId: true, loans: { where: { disbursementStatus: 'APPROVED_LEVEL2' }, select: { firstDueDate: true }, take: 1 } },
    });
    if (indexes.length < 2) throw new Error('Need at least 2 indexes in final disbursement (APPROVED_LEVEL2).');

    const usable = indexes.slice(0, -1); // keep the last index request-free
    const admin = await prisma.user.findFirst({ where: { role: 'ADMIN', isActive: true }, select: { id: true } });

    let created = 0;
    for (let i = 0; i < Math.min(PLAN.length, usable.length); i++) {
        const idx = usable[i];
        const plan = PLAN[i];
        const bm =
            (await prisma.user.findFirst({ where: { role: 'BRANCH_MANAGER', isActive: true, branchId: idx.branchId }, select: { id: true } })) ??
            (await prisma.user.findFirst({ where: { role: 'BRANCH_MANAGER', isActive: true }, select: { id: true } }));
        if (!bm) throw new Error('No active BRANCH_MANAGER user found.');

        const requestedAt = new Date(Date.now() - plan.daysAgo * 24 * 60 * 60 * 1000);
        const decided = plan.status !== 'PENDING';
        await prisma.firstDueDateChangeRequest.create({
            data: {
                indexId: idx.id,
                branchId: idx.branchId,
                oldFirstDueDate: idx.loans[0]?.firstDueDate ?? null,
                reason: `${TAG} ${plan.reason}`,
                status: plan.status,
                requestedById: bm.id,
                requestedAt,
                ...(decided
                    ? {
                          decidedAt: new Date(requestedAt.getTime() + 3 * 60 * 60 * 1000),
                          decidedById: plan.status === 'REJECTED' ? admin?.id : null,
                          decisionRemarks: plan.status === 'REJECTED' ? 'Not needed, keep original date' : null,
                      }
                    : {}),
            },
        });
        console.log(`${plan.status.padEnd(9)} index ${idx.indexNo} (requested ${requestedAt.toISOString().slice(0, 10)})`);
        created++;
    }
    console.log(`\nCreated ${created} request(s). Index ${indexes[indexes.length - 1].indexNo} has none - use it to test the BM button.`);
}

main()
    .catch((e) => {
        console.error(e.message);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
