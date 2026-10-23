import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/app/lib/db';
import { withRole } from '@/app/lib/api-utils';

const FY_MONTHS = ['apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec', 'jan', 'feb', 'mar'] as const;
type FYMonth = typeof FY_MONTHS[number];

function getFYDateRange(year: number) {
    // Indian FY: Apr 1 of `year` to Mar 31 of `year+1`
    const start = new Date(year, 3, 1, 0, 0, 0, 0);   // Apr 1
    const end = new Date(year + 1, 2, 31, 23, 59, 59, 999); // Mar 31
    return { start, end };
}

function getMonthKey(date: Date): FYMonth | null {
    const m = date.getMonth(); // 0=Jan ... 11=Dec
    const map: Record<number, FYMonth> = {
        3: 'apr', 4: 'may', 5: 'jun', 6: 'jul', 7: 'aug', 8: 'sep',
        9: 'oct', 10: 'nov', 11: 'dec', 0: 'jan', 1: 'feb', 2: 'mar',
    };
    return map[m] ?? null;
}

export async function GET(req: NextRequest) {
    return withRole(
        ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'],
        async (request) => {
            const { searchParams } = new URL(request.url);
            const yearParam = searchParams.get('year');

            if (!yearParam) {
                return NextResponse.json(
                    { success: false, message: 'year is required.' },
                    { status: 400 }
                );
            }

            const year = parseInt(yearParam);
            if (isNaN(year) || year < 2000 || year > 2100) {
                return NextResponse.json(
                    { success: false, message: 'Invalid year.' },
                    { status: 400 }
                );
            }

            const { start, end } = getFYDateRange(year);

            // Fetch all active funders with their interest GL
            const funders = await prisma.funder.findMany({
                where: { isActive: true },
                include: {
                    interestGL: { select: { glId: true, glName: true } },
                },
                orderBy: { funderName: 'asc' },
            });

            if (funders.length === 0) {
                return NextResponse.json({
                    success: true,
                    data: { rows: [], grandTotals: Object.fromEntries(FY_MONTHS.map(m => [m, 0])), grandTotal: 0 },
                });
            }

            // Fetch all interest-related financial transactions in the FY
            // Match by AccountLedger whose ledgerName matches the funder's interestGL glName
            const interestGLNames = funders.map(f => f.interestGL.glName);

            const transactions = await prisma.financialTransaction.findMany({
                where: {
                    isActive: true,
                    approvalStatus: 'APPROVED' as any,
                    transactionDate: { gte: start, lte: end },
                    type: { in: ['BANK_PAYMENT', 'CASH_PAYMENT'] },
                    ledger: {
                        ledgerName: { in: interestGLNames },
                    },
                },
                select: {
                    transactionDate: true,
                    amount: true,
                    ledger: { select: { ledgerName: true } },
                },
            });

            // Build a map: ledgerName -> month -> total amount
            const ledgerMonthMap: Record<string, Record<FYMonth, number>> = {};
            for (const tx of transactions) {
                const name = tx.ledger?.ledgerName;
                if (!name) continue;
                const monthKey = getMonthKey(new Date(tx.transactionDate));
                if (!monthKey) continue;
                if (!ledgerMonthMap[name]) {
                    ledgerMonthMap[name] = Object.fromEntries(FY_MONTHS.map(m => [m, 0])) as Record<FYMonth, number>;
                }
                ledgerMonthMap[name][monthKey] += Number(tx.amount);
            }

            // Build rows per funder
            const rows = funders.map(funder => {
                const glName = funder.interestGL.glName;
                const monthData = ledgerMonthMap[glName] ?? Object.fromEntries(FY_MONTHS.map(m => [m, 0]));
                const totalPayment = FY_MONTHS.reduce((s, m) => s + (monthData[m] ?? 0), 0);
                return {
                    funderId: funder.funderId,
                    funderName: funder.funderName,
                    interestGLName: glName,
                    ...monthData,
                    totalPayment,
                };
            });

            // Grand totals per month
            const grandTotals = Object.fromEntries(
                FY_MONTHS.map(m => [m, rows.reduce((s, r) => s + (r[m] ?? 0), 0)])
            ) as Record<FYMonth, number>;
            const grandTotal = rows.reduce((s, r) => s + r.totalPayment, 0);

            return NextResponse.json({
                success: true,
                data: { rows, grandTotals, grandTotal },
            });
        }
    )(req);
}
