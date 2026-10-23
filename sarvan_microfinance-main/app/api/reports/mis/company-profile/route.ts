import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { withRole } from '@/app/lib/api-utils';

/**
 * Cookie-free core, split out of the GET handler below so the Request Report queue's
 * PDF renderer (app/lib/reports/company-profile-pdf-queue.ts) can call it directly
 * without a request/session context. This report is system-wide (ADMIN-only, no branch
 * scoping), so unlike some other reports there's no user/role parameter to carry over.
 */
export async function computeCompanyProfile(dateParam: string | null) {
    const systemDate = dateParam ? new Date(dateParam) : new Date();

    // Ensure date comparison includes the full day up to 23:59:59
    const eodDate = new Date(systemDate);
    eodDate.setHours(23, 59, 59, 999);

    const currentYear = systemDate.getMonth() >= 3 ? systemDate.getFullYear() : systemDate.getFullYear() - 1;
    const fyStart = new Date(currentYear, 3, 1); // April 1st of current financial year

    // ================= OPERATIONAL DATA =================

    const noOfCenters = await prisma.center.count({ where: { isActive: true, createdAt: { lte: eodDate } } });
    const noOfGroups = await prisma.group.count({ where: { isActive: true, createdAt: { lte: eodDate } } });
    const noOfFdo = await prisma.user.count({ where: { role: 'FDO', isActive: true, createdAt: { lte: eodDate } } });

    const allClients = await prisma.client.findMany({
        where: { createdAt: { lte: eodDate } },
        select: { createdAt: true, isActive: true, inactiveDate: true, id: true, verificationStatus: true }
    });

    let openingClients = 0;
    let newClients = 0;
    let dropouts = 0;
    let activeClients = 0;
    const openingIds: string[] = [];
    const newIds: string[] = [];
    const dropoutIds: string[] = [];

    for (const client of allClients) {
        if (client.verificationStatus !== 'VERIFIED') continue;

        const isBeforeFY = client.createdAt < fyStart;
        const dropDate = client.inactiveDate;

        // Is Active exactly at eodDate?
        const isActiveAtDate = !dropDate || dropDate > eodDate;

        // Opening: created before April 1st, and active on April 1st
        if (isBeforeFY) {
            if (!dropDate || dropDate >= fyStart) {
                openingClients++;
                openingIds.push(client.id);
            }
        }

        // New: created strictly >= April 1st and <= eodDate
        if (client.createdAt >= fyStart && client.createdAt <= eodDate) {
            newClients++;
            newIds.push(client.id);
        }

        // Dropouts: became inactive strictly >= April 1st and <= eodDate
        if (dropDate && dropDate >= fyStart && dropDate <= eodDate) {
            dropouts++;
            dropoutIds.push(client.id);
        }

        // Finally, active precisely at eodDate
        if (isActiveAtDate) {
            activeClients++;
        }
    }

    const closingClients = activeClients;

    // Waiting borrowers: active clients without a DISBURSED active loan
    const activeLoansClients = await prisma.loan.groupBy({
        by: ['clientId'],
        where: {
            disbursementStatus: 'DISBURSED',
            createdAt: { lte: eodDate },
            OR: [
                { isActive: true },
                { closedDate: { gt: eodDate } }
            ]
        }
    });
    const clientsWithLoans = new Set(activeLoansClients.map(l => l.clientId));

    let waitingBorrowers = 0;
    for (const c of allClients) {
        const isActiveAtDate = !c.inactiveDate || c.inactiveDate > eodDate;
        if (isActiveAtDate && c.verificationStatus === 'VERIFIED' && !clientsWithLoans.has(c.id)) {
            waitingBorrowers++;
        }
    }

    // Member (no disbursed loan) vs Client (has a disbursed loan) split for each headcount bucket
    const countWithLoan = (ids: string[]) => ids.filter((id) => clientsWithLoans.has(id)).length;
    const openingClientsWithLoan = countWithLoan(openingIds);
    const newClientsWithLoan = countWithLoan(newIds);
    const dropoutClientsWithLoan = countWithLoan(dropoutIds);

    // ================= FUNCTIONAL DATA =================

    // Loan Disbursement Since April
    const loansSinceApril = await prisma.loan.aggregate({
        where: {
            disbursementStatus: 'DISBURSED',
            createdAt: { gte: fyStart, lte: eodDate }
        },
        _sum: { amount: true }
    });
    const loanDisbursementSinceApril = Number(loansSinceApril._sum.amount || 0);

    // Portfolio Outstanding Calculation (As of eodDate)
    const allDisbursedLoansToDate = await prisma.loan.findMany({
        where: {
            disbursementStatus: 'DISBURSED',
            createdAt: { lte: eodDate }
        },
        select: { amount: true, id: true }
    });
    const totalDisbursedToDate = allDisbursedLoansToDate.reduce((acc, l) => acc + Number(l.amount), 0);

    const txsToDate = await prisma.loanTransaction.aggregate({
        where: { transactionDate: { lte: eodDate }, type: 'REPAYMENT' },
        _sum: { principalAmount: true }
    });
    const totalPrincipalCollectedToDate = Number(txsToDate._sum.principalAmount || 0);

    const portfolioOutstanding = totalDisbursedToDate - totalPrincipalCollectedToDate;

    // Opening Portfolio
    const loansBeforeApril = await prisma.loan.findMany({
        where: { createdAt: { lt: fyStart }, disbursementStatus: 'DISBURSED' },
        select: { amount: true }
    });
    const disbursedBeforeApril = loansBeforeApril.reduce((acc, l) => acc + Number(l.amount), 0);

    const txsBeforeApril = await prisma.loanTransaction.aggregate({
        where: { transactionDate: { lt: fyStart }, type: 'REPAYMENT' },
        _sum: { principalAmount: true }
    });
    const collectedBeforeApril = Number(txsBeforeApril._sum.principalAmount || 0);

    const openingPortfolio = disbursedBeforeApril - collectedBeforeApril;

    // Collection (Since April)
    const fyCollection = await prisma.loanTransaction.aggregate({
        where: { transactionDate: { gte: fyStart, lte: eodDate }, type: 'REPAYMENT' },
        _sum: { amount: true }
    });
    const collection = Number(fyCollection._sum.amount || 0);

    // Preclosure (Since April up to eodDate)
    const preclosureCount = await prisma.loan.count({
        where: { isActive: false, closedDate: { gte: fyStart, lte: eodDate } }
    });

    // Current Demand logic mock (Requires actual demand generation snapshot usually)
    // Here we just use collection to match simple demo logic or a mock demand
    const demand = collection > 0 ? collection : 0;
    const recoveryRate = demand > 0 ? (collection / demand) * 100 : 0;

    return {
        identification: {
            reportDate: systemDate.toISOString(),
        },
        functionalData: {
            openingPortfolio: Math.max(0, openingPortfolio),
            loanDisbursementSinceApril,
            portfolioOutstanding: Math.max(0, portfolioOutstanding),
            demand,
            collection,
            recoveryRate: Number(recoveryRate.toFixed(2)),
            advance: 0,
            preclosure: preclosureCount,
            openingArrear: 0,
            currentArrear: 0,
            closingArrear: 0,
        },
        operationalData: {
            noOfCenters,
            noOfGroups,
            noOfFdo,
            openingClients,
            openingMembers: openingClients - openingClientsWithLoan,
            openingClientsWithLoan,
            newClients,
            newMembers: newClients - newClientsWithLoan,
            newClientsWithLoan,
            dropouts,
            dropoutMembers: dropouts - dropoutClientsWithLoan,
            dropoutClientsWithLoan,
            closingClients,
            closingMembers: waitingBorrowers,
            closingClientsWithLoan: closingClients - waitingBorrowers,
            waitingBorrowers,
            activeClients
        }
    };
}

export async function GET(request: NextRequest) {
    return withRole(['ADMIN'], async (req) => {
    try {
        const { searchParams } = new URL(req.url);
        const dateParam = searchParams.get('date');
        const responseData = await computeCompanyProfile(dateParam);

        return NextResponse.json({ success: true, data: responseData });

    } catch (error: any) {
        console.error('Error generating company profile:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
    })(request);
}
