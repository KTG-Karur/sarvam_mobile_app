/**
 * Diagnostic (read-only) for EOD checklist codes 9 (Unattempted Collections) and
 * Denomination Entry mismatch, business date 2026-07-27.
 *
 * Usage: npx tsx scripts/diagnose-eod-2026-07-27.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { getBranchCalendarDayHalfOpenUtc } from '@/app/lib/branch-financial-day';
import {
    unattemptedInstallmentScheduleWhere,
    repaymentPostedTodayWhere,
} from '@/app/lib/eod-collection-gates';
import { getExpectedDenominationTotal } from '@/app/lib/denomination-entry';

const LOAN_NUMBERS = ['LN26000007', 'LN26000017', 'LN26000006', 'LN26000005', 'LN26000018', '000010'];
const BUSINESS_DATE = '2026-07-27';

async function main() {
    const prisma = new PrismaClient();
    try {
        const processDate = new Date(`${BUSINESS_DATE}T00:00:00.000Z`);

        const loans = await prisma.loan.findMany({
            where: { loanNumber: { in: LOAN_NUMBERS } },
            select: {
                id: true,
                loanNumber: true,
                branchId: true,
                isActive: true,
                disbursementStatus: true,
                closedDate: true,
                branch: { select: { code: true, name: true } },
            },
        });
        console.log('=== Loans found ===');
        for (const l of loans) {
            console.log(
                `${l.loanNumber} | id=${l.id} | branch=${l.branch?.code} (${l.branchId}) | active=${l.isActive} | status=${l.disbursementStatus} | closed=${l.closedDate}`
            );
        }
        const missing = LOAN_NUMBERS.filter((n) => !loans.some((l) => l.loanNumber === n));
        if (missing.length) console.log('MISSING loan numbers:', missing);

        const branchIds = [...new Set(loans.map((l) => l.branchId))];
        console.log('\nDistinct branch ids involved:', branchIds);

        for (const branchId of branchIds) {
            const branch = loans.find((l) => l.branchId === branchId)?.branch;
            const tz = 'Asia/Kolkata';
            const { dayStartUtc, dayEndExclusiveUtc, workingDateYmd } = getBranchCalendarDayHalfOpenUtc(processDate, tz);
            console.log(`\n=== Branch ${branch?.code} (${branchId}) — working date ${workingDateYmd} ===`);
            console.log('Window:', dayStartUtc.toISOString(), '-', dayEndExclusiveUtc.toISOString());

            const dueSchedules = await prisma.loanSchedule.findMany({
                where: unattemptedInstallmentScheduleWhere(branchId, dayStartUtc, dayEndExclusiveUtc),
                include: { loan: { select: { loanNumber: true } } },
            });
            const repayments = await prisma.loanTransaction.findMany({
                where: repaymentPostedTodayWhere(branchId, dayStartUtc, dayEndExclusiveUtc),
                select: { loanId: true, status: true, amount: true, paymentMode: true },
            });
            const repaidLoanIds = new Set(repayments.map((r) => r.loanId));
            const unattempted = dueSchedules.filter((s) => !repaidLoanIds.has(s.loanId));

            console.log(`Due schedules today: ${dueSchedules.length}`);
            console.log(`Existing REPAYMENT txns today: ${repayments.length}`);
            console.log(`UNATTEMPTED (code 9 offenders): ${unattempted.length}`);
            for (const s of unattempted) {
                console.log(
                    `  - ${s.loan.loanNumber} | scheduleId=${s.id} | installment#${s.installmentNo} | status=${s.status} | totalDue=${s.totalDue} | totalPaid=${s.totalPaid}`
                );
            }

            const expected = await getExpectedDenominationTotal(branchId, processDate, tz);
            console.log('\nExpected denomination total breakdown:', expected);

            const existingEntry = await prisma.denominationEntry.findUnique({
                where: { branchId_entryDate: { branchId, entryDate: new Date(`${workingDateYmd}T00:00:00.000Z`) } },
            });
            console.log('Existing DenominationEntry row:', existingEntry);
        }
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
