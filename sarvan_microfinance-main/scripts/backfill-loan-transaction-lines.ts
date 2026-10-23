import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { allocateTransactionLinesFromComponentBudgets } from '@/app/lib/loan-transaction-lines';

const prisma = new PrismaClient();

function toNumber(value: unknown): number {
    const amount = Number(value ?? 0);
    return Number.isFinite(amount) ? amount : 0;
}

async function main() {
    const apply = process.argv.includes('--apply');

    const loans = await prisma.loan.findMany({
        where: {
            transactions: {
                some: {
                    type: 'REPAYMENT',
                    lines: {
                        none: {},
                    },
                },
            },
        },
        include: {
            schedules: {
                orderBy: [
                    { dueDate: 'asc' },
                    { installmentNo: 'asc' },
                ],
            },
            transactions: {
                where: {
                    type: 'REPAYMENT',
                    isReversed: false,
                },
                include: {
                    lines: true,
                },
                orderBy: [
                    { transactionDate: 'asc' },
                    { createdAt: 'asc' },
                ],
            },
        },
    });

    let transactionsMissingLines = 0;
    let transactionsBackfilled = 0;
    let lineCount = 0;

    for (const loan of loans) {
        const simulatedSchedules = loan.schedules.map((schedule) => ({
            id: schedule.id,
            installmentNo: schedule.installmentNo,
            dueDate: schedule.dueDate,
            principalDue: toNumber(schedule.principalDue),
            interestDue: toNumber(schedule.interestDue),
            feesDue: toNumber(schedule.feesDue),
            penaltiesDue: toNumber(schedule.penaltiesDue),
            principalPaid: 0,
            interestPaid: 0,
            feesPaid: 0,
            penaltiesPaid: 0,
        }));

        for (const transaction of loan.transactions) {
            let lines = transaction.lines.map((line) => ({
                scheduleId: line.scheduleId,
                installmentNo: line.installmentNo,
                principalAmount: toNumber(line.principalAmount),
                interestAmount: toNumber(line.interestAmount),
                feesAmount: toNumber(line.feesAmount),
                penaltyAmount: toNumber(line.penaltyAmount),
                lineTotal: toNumber(line.lineTotal),
            }));

            if (lines.length === 0) {
                transactionsMissingLines += 1;

                const rebuilt = allocateTransactionLinesFromComponentBudgets(
                    simulatedSchedules,
                    {
                        principalAmount: toNumber(transaction.principalAmount),
                        interestAmount: toNumber(transaction.interestAmount),
                        feesAmount: toNumber(transaction.feesAmount),
                        penaltyAmount: toNumber(transaction.penaltyAmount),
                    }
                );

                lines = rebuilt.lines;

                if (lines.length > 0) {
                    transactionsBackfilled += 1;
                    lineCount += lines.length;

                    if (apply) {
                        await prisma.loanTransactionLine.createMany({
                            data: lines.map((line) => ({
                                transactionId: transaction.id,
                                scheduleId: line.scheduleId,
                                installmentNo: line.installmentNo,
                                principalAmount: line.principalAmount,
                                interestAmount: line.interestAmount,
                                feesAmount: line.feesAmount,
                                penaltyAmount: line.penaltyAmount,
                                lineTotal: line.lineTotal,
                            })),
                        });
                    }
                }
            }

            for (const line of lines) {
                const schedule = simulatedSchedules.find((item) => item.id === line.scheduleId);
                if (!schedule) {
                    continue;
                }

                schedule.principalPaid += line.principalAmount;
                schedule.interestPaid += line.interestAmount;
                schedule.feesPaid += line.feesAmount;
                schedule.penaltiesPaid += line.penaltyAmount;
            }
        }
    }

    console.log(JSON.stringify({
        mode: apply ? 'apply' : 'dry-run',
        loansScanned: loans.length,
        transactionsMissingLines,
        transactionsBackfilled,
        lineCount,
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