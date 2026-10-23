/**
 * One-off data fix: resolve EOD checklist codes 9 (Unattempted Collections) and
 * Denomination Entry mismatch for branch "3" (cmq6bkmxr0061s6awjz9v2mg1), business
 * date 2026-07-27.
 *
 * For each of the 6 loans due today with no repayment recorded, creates a fully
 * APPROVED REPAYMENT transaction (bypassing the FDO->BM batch queue, since this is
 * an administrative backfill, not a live center-meeting collection) and applies it
 * to the schedule + loan totals exactly as app/api/collections/approve/route.ts does.
 *
 * Payment mode is BANK_TRANSFER (not CASH) so the branch's cash denomination expected
 * total (currently ₹100, from an unrelated existing cash collection) is unaffected —
 * see app/lib/denomination-entry.ts getBranchDayCreditTotal (CASH-only).
 *
 * Then upserts a DenominationEntry for the same branch/date with 1x ₹100 note.
 *
 * Usage: npx tsx scripts/fix-eod-2026-07-27.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { getBranchCalendarDayHalfOpenUtc, parseDenominationEntryDateUtc } from '@/app/lib/branch-financial-day';
import { getExpectedDenominationTotal } from '@/app/lib/denomination-entry';

const LOAN_NUMBERS = ['LN26000007', 'LN26000017', 'LN26000006', 'LN26000005', 'LN26000018', '000010'];
const BUSINESS_DATE = '2026-07-27';
const FDO_ID = 'cmq6bsdv8006ds6awnhjfkp0c'; // Rajasekaran M, FDO, branch 3
const BM_ID = 'cmq6bopdq0067s6awnpv38idu'; // Marimuthu P, BRANCH_MANAGER, branch 3

function genTransactionId(seq: number): string {
    const now = new Date();
    const pad = (n: number, l = 2) => String(n).padStart(l, '0');
    const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    const timeStr = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    return `TXN-${dateStr}-${timeStr}-EODFIX${seq}`;
}

async function main() {
    const prisma = new PrismaClient();
    try {
        const processDate = new Date(`${BUSINESS_DATE}T00:00:00.000Z`);

        const loans = await prisma.loan.findMany({
            where: { loanNumber: { in: LOAN_NUMBERS } },
            include: {
                schedules: { where: { status: { in: ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] } } },
            },
        });
        if (loans.length !== LOAN_NUMBERS.length) {
            throw new Error(`Expected ${LOAN_NUMBERS.length} loans, found ${loans.length}`);
        }
        const branchIds = new Set(loans.map((l) => l.branchId));
        if (branchIds.size !== 1) {
            throw new Error(`Loans span multiple branches: ${[...branchIds].join(', ')}`);
        }
        const branchId = [...branchIds][0];
        const tz = 'Asia/Kolkata';
        const { dayStartUtc, dayEndExclusiveUtc } = getBranchCalendarDayHalfOpenUtc(processDate, tz);
        const transactionDate = new Date(dayStartUtc.getTime() + 12 * 60 * 60 * 1000); // midday within the branch window

        console.log(`Branch: ${branchId}`);
        console.log(`Window: ${dayStartUtc.toISOString()} - ${dayEndExclusiveUtc.toISOString()}`);
        console.log(`Transaction date to use: ${transactionDate.toISOString()}`);

        let seq = 0;
        await prisma.$transaction(async (tx) => {
            for (const loan of loans) {
                const dueSchedule = loan.schedules.find(
                    (s) => s.dueDate >= dayStartUtc && s.dueDate < dayEndExclusiveUtc
                );
                if (!dueSchedule) {
                    console.log(`  SKIP ${loan.loanNumber}: no schedule due in window (already resolved?)`);
                    continue;
                }

                seq += 1;
                const transactionId = genTransactionId(seq);
                const principalAmount = Number(dueSchedule.principalDue);
                const interestAmount = Number(dueSchedule.interestDue);
                const feesAmount = Number(dueSchedule.feesDue || 0);
                const penaltyAmount = Number(dueSchedule.penaltiesDue || 0);
                const amount = Number(dueSchedule.totalDue);

                console.log(
                    `  ${loan.loanNumber}: creating REPAYMENT ${transactionId} amount=${amount} (P${principalAmount}/I${interestAmount}/F${feesAmount}/Pen${penaltyAmount})`
                );

                await tx.loanTransaction.create({
                    data: {
                        transactionId,
                        loanId: loan.id,
                        branchId: loan.branchId,
                        clientId: loan.clientId,
                        centerId: loan.centerId,
                        amount,
                        type: 'REPAYMENT',
                        paymentMode: 'BANK_TRANSFER',
                        transactionDate,
                        collectedById: FDO_ID,
                        status: 'APPROVED',
                        approvedById: BM_ID,
                        approvedAt: new Date(),
                        collectionType: 'Demand Collection',
                        remarks: `EOD reconciliation for ${BUSINESS_DATE}: manually recorded repayment for installment #${dueSchedule.installmentNo} to clear Unattempted Collections check.`,
                        principalAmount,
                        interestAmount,
                        feesAmount,
                        penaltyAmount,
                        lines: {
                            create: [
                                {
                                    scheduleId: dueSchedule.id,
                                    installmentNo: dueSchedule.installmentNo,
                                    principalAmount,
                                    interestAmount,
                                    feesAmount,
                                    penaltyAmount,
                                    lineTotal: amount,
                                },
                            ],
                        },
                    } as any,
                });

                const newPrincipalPaid = Number(dueSchedule.principalPaid) + principalAmount;
                const newInterestPaid = Number(dueSchedule.interestPaid) + interestAmount;
                const newFeesPaid = Number(dueSchedule.feesPaid || 0) + feesAmount;
                const newPenaltiesPaid = Number(dueSchedule.penaltiesPaid || 0) + penaltyAmount;
                const totalPaidNow = newPrincipalPaid + newInterestPaid + newFeesPaid + newPenaltiesPaid;

                await tx.loanSchedule.update({
                    where: { id: dueSchedule.id },
                    data: {
                        principalPaid: newPrincipalPaid,
                        interestPaid: newInterestPaid,
                        feesPaid: newFeesPaid,
                        penaltiesPaid: newPenaltiesPaid,
                        totalPaid: totalPaidNow,
                        status: 'PAID',
                        paidAt: transactionDate,
                    },
                });

                await tx.loan.update({
                    where: { id: loan.id },
                    data: {
                        principalPaid: { increment: principalAmount },
                        interestPaid: { increment: interestAmount },
                        penaltiesPaid: { increment: penaltyAmount },
                        lastPaymentDate: transactionDate,
                    },
                });
            }
        });

        console.log('\nAll 6 repayments recorded and approved.');

        // Step 2: Denomination entry — confirm expected total is still ₹100 (BANK_TRANSFER
        // payment mode used above so cash total is unaffected), then upsert 1x ₹100 note.
        const expected = await getExpectedDenominationTotal(branchId, processDate, tz);
        console.log('\nExpected denomination total after fix:', expected);
        if (expected.total !== 100) {
            throw new Error(`Expected denomination total is ${expected.total}, not 100 — aborting denomination entry write.`);
        }

        const entryDate = parseDenominationEntryDateUtc(BUSINESS_DATE);
        const entry = await prisma.denominationEntry.upsert({
            where: { branchId_entryDate: { branchId, entryDate } },
            create: {
                branchId,
                entryDate,
                d500: 0, d200: 0, d100: 1, d50: 0, d20: 0, d10: 0, d5: 0, d2: 0, d1: 0,
                upi: 0,
                totalAmount: 100,
                remarks: `EOD reconciliation for ${BUSINESS_DATE}: 1x ₹100 note matching expected total.`,
                createdById: BM_ID,
            },
            update: {
                d500: 0, d200: 0, d100: 1, d50: 0, d20: 0, d10: 0, d5: 0, d2: 0, d1: 0,
                upi: 0,
                totalAmount: 100,
                remarks: `EOD reconciliation for ${BUSINESS_DATE}: 1x ₹100 note matching expected total.`,
            },
        });
        console.log('\nDenomination entry saved:', entry);
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
