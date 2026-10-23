/**
 * One-off repair for LN26000024 and LN26000025: installments #1-3 on both loans
 * have correct dueDate values (verified against paid transaction history), but
 * every installment from #4 onward was imported with day/month transposed
 * (e.g. "06-08-2026" / 6-Aug read as 8-June), scattering due dates across the
 * wrong months — including some landing in the past, which trips the
 * arrear-detection logic in app/api/loans/[loanId]/schedule/route.ts into
 * flagging not-yet-due installments as arrears.
 *
 * This regenerates dueDate for installments #4-40 on both loans from
 * installment #3's (confirmed-correct) date using the same weekly-cadence
 * (+7 days, Sunday-skip) rule the app itself uses when generating new
 * schedules. Only the `dueDate` column is touched — principal/interest/paid
 * amounts/status are untouched.
 */
import { prisma } from '../app/lib/prisma';

const TARGET_LOAN_NUMBERS = ['LN26000024', 'LN26000025'];

function addDays(d: Date, days: number): Date {
    const nd = new Date(d);
    nd.setUTCDate(nd.getUTCDate() + days);
    return nd;
}

// Mirrors getNextValidDate() in app/api/disbursements/bm-disburse/route.ts —
// the schedule day itself is stored as a UTC instant whose IST calendar date
// is what matters; the loan's due-day-of-week never lands on Sunday in this
// batch, but keep the same skip rule for correctness/parity with live-loan generation.
function nextValidDate(d: Date): Date {
    // dueDate is stored as `<IST date> 18:30 UTC` (i.e. midnight IST) — read
    // the IST weekday via the UTC instant's day-of-week directly since the
    // stored instant already represents the correct IST calendar day at 00:00.
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

    console.log(dryRun ? '\nDry run complete — no writes made.' : '\nDone — dueDate columns updated.');
}

main().finally(() => prisma.$disconnect());
