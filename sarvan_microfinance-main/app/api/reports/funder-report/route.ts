import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/app/lib/db';
import { withRole } from '@/app/lib/api-utils';

export async function GET(req: NextRequest) {
    return withRole(
        ['ADMIN'],
        async (request) => {
            const { searchParams } = new URL(request.url);
            const fromDate = searchParams.get('fromDate');
            const toDate = searchParams.get('toDate');

            if (!fromDate || !toDate) {
                return NextResponse.json(
                    { success: false, message: 'fromDate and toDate are required.' },
                    { status: 400 }
                );
            }

            const periodStart = new Date(fromDate);
            periodStart.setHours(0, 0, 0, 0);

            const periodEnd = new Date(toDate);
            periodEnd.setHours(23, 59, 59, 999);

            // Step 1: Get all active funders with their principalGL name
            const funders = await prisma.funder.findMany({
                where: { isActive: true },
                include: {
                    principalGL: { select: { glName: true } },
                },
                orderBy: { funderName: 'asc' },
            });

            if (funders.length === 0) {
                return NextResponse.json({ success: true, data: { rows: [], totals: null } });
            }

            // Step 2: Find AccountLedger entries whose ledgerName matches the principal GL name.
            // In legacy microfinance systems the ledger name mirrors the GL account name.
            const glNames = [...new Set(funders.map((f) => f.principalGL.glName))];

            const ledgers = await prisma.accountLedger.findMany({
                where: {
                    ledgerName: { in: glNames },
                    isActive: true,
                },
                select: { id: true, ledgerName: true },
            });

            // Map: glName -> ledger
            const ledgerByGLName = new Map(ledgers.map((l) => [l.ledgerName, l]));

            // Step 3: Per funder-ledger calculate Opening, Debit, Credit, Closing
            const rows = await Promise.all(
                funders.map(async (funder) => {
                    const glName = funder.principalGL.glName;
                    const ledger = ledgerByGLName.get(glName);

                    if (!ledger) {
                        return {
                            funderId: funder.funderId,
                            // "Funder Name" column in the report = the ledger name (principal GL name)
                            funderName: glName,
                            openingBalance: 0,
                            debit: 0,
                            credit: 0,
                            closingBalance: 0,
                        };
                    }

                    const approvedOnly = { approvalStatus: 'APPROVED' as any };
                    const [priorDebits, priorCredits, periodDebits, periodCredits] = await Promise.all([
                        prisma.financialTransaction.aggregate({
                            where: { ledgerId: ledger.id, isActive: true, ...approvedOnly, transactionDate: { lt: periodStart } },
                            _sum: { amount: true },
                        }),
                        prisma.financialTransaction.aggregate({
                            where: { creditLedgerId: ledger.id, isActive: true, ...approvedOnly, transactionDate: { lt: periodStart } },
                            _sum: { amount: true },
                        }),
                        prisma.financialTransaction.aggregate({
                            where: { ledgerId: ledger.id, isActive: true, ...approvedOnly, transactionDate: { gte: periodStart, lte: periodEnd } },
                            _sum: { amount: true },
                        }),
                        prisma.financialTransaction.aggregate({
                            where: { creditLedgerId: ledger.id, isActive: true, ...approvedOnly, transactionDate: { gte: periodStart, lte: periodEnd } },
                            _sum: { amount: true },
                        }),
                    ]);

                    const openingDebitSum = Number(priorDebits._sum.amount ?? 0);
                    const openingCreditSum = Number(priorCredits._sum.amount ?? 0);
                    // For a liability/loan ledger: credits increase balance, debits decrease it
                    const openingBalance = openingCreditSum - openingDebitSum;
                    const debit = Number(periodDebits._sum.amount ?? 0);
                    const credit = Number(periodCredits._sum.amount ?? 0);
                    const closingBalance = openingBalance + credit - debit;

                    return {
                        funderId: funder.funderId,
                        funderName: glName,   // ledger name shown as "Funder Name" per legacy design
                        openingBalance,
                        debit,
                        credit,
                        closingBalance,
                    };
                })
            );

            const totals = rows.reduce(
                (acc, r) => ({
                    openingBalance: acc.openingBalance + r.openingBalance,
                    debit: acc.debit + r.debit,
                    credit: acc.credit + r.credit,
                    closingBalance: acc.closingBalance + r.closingBalance,
                }),
                { openingBalance: 0, debit: 0, credit: 0, closingBalance: 0 }
            );

            return NextResponse.json({
                success: true,
                data: { rows, totals },
            });
        }
    )(req);
}
