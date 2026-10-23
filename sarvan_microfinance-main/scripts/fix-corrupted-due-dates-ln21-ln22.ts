/**
 * One-off repair for LN26000021 and LN26000022, installments #3-40: same
 * day/month-transposition corruption already fixed for LN26000024/LN26000025
 * (see scripts/fix-corrupted-due-dates-ln24-ln25.ts for the full writeup and
 * app/lib/services/uploan-loan-history.service.ts for the live-upload fix).
 *
 * Installments #1 and #2 on these two loans are corrupted in a different,
 * non-swap way (and their imported transaction records inherited the same
 * wrong dates), so there's no reliable source to derive their correct value
 * from — deliberately left untouched here pending manual confirmation.
 *
 * Regenerates dueDate for installments #3(unchanged, used as anchor)-40 from
 * installment #3's (confirmed-correct, clean Monday cadence) date using the
 * same weekly-cadence (+7 days, Sunday-skip) rule the app itself uses. Only
 * the `dueDate` column is touched — principal/interest/paid amounts/status
 * are untouched.
 */
import { prisma } from '../app/lib/prisma';

const TARGET_LOAN_NUMBERS = ['LN26000021', 'LN26000022'];

function addDays(d: Date, days: number): Date {
    const nd = new Date(d);
    nd.setUTCDate(nd.getUTCDate() + days);
    return nd;
}

function nextValidDate(d: Date): Date {
    if (d.getUTCDay() === 0) return addDays(d, 1);
    return d;
}

async function main() {
    const dryRun = process.argv.includes('--dry-run');

    const loans = await prisma.loan.findMany({
        where: { loanNumber: { in: TARGET_LOAN_NUMBERS } },
        select: {
            id: true,
            loanNumber: true,
            schedules: {
                orderBy: { installmentNo: 'asc' },
                select: { id: true, installmentNo: true, dueDate: true, status: true },
            },
        },
    });

    for (const loan of loans) {
        const anchorRow = loan.schedules.find((s) => s.installmentNo === 3);
        if (!anchorRow) {
            console.log(`SKIP ${loan.loanNumber}: no installment #3 found to anchor on`);
            continue;
        }

        console.log(`\n=== ${loan.loanNumber} (anchor: #3 = ${anchorRow.dueDate.toISOString().slice(0, 10)}) ===`);
        console.log(`  #1, #2 left untouched (need manual confirmation)`);

        let currentDate = anchorRow.dueDate;
        for (const row of loan.schedules) {
            if (row.installmentNo <= 3) continue;

            currentDate = nextValidDate(addDays(currentDate, 7));
            const oldYmd = row.dueDate.toISOString().slice(0, 10);
            const newYmd = currentDate.toISOString().slice(0, 10);

            if (oldYmd === newYmd) continue; // already correct, no-op

            console.log(`  #${row.installmentNo}: ${oldYmd} -> ${newYmd} (status=${row.status})`);

            if (!dryRun) {
                await prisma.loanSchedule.update({
                    where: { id: row.id },
                    data: { dueDate: currentDate },
                });
            }
        }
    }

    console.log(dryRun ? '\nDry run complete — no writes made.' : '\nDone — dueDate columns updated (installments #3-40 only).');
}

main().finally(() => prisma.$disconnect());
