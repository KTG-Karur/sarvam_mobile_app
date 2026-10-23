import { prisma } from '@/app/lib/prisma';
import { endOfDay, differenceInWeeks } from 'date-fns';
import { getActiveBrandNames } from '@/app/lib/brand-server';
import { getMemberContacts } from '@/app/lib/reports/member-contacts';

/**
 * Shared query functions for reports whose API route previously had the
 * Prisma query inlined — each function here is called by BOTH the report's
 * own API route (paginated/on-screen view) and its app/lib/reports/report-registry.ts
 * async-export adapter, so the two can never silently diverge.
 */

// ── Center Master ─────────────────────────────────────────────────

export type CenterMasterFilters = {
    reportDate: string;
    branchIds: string[] | null;
};

export async function getCenterMasterRows(filters: CenterMasterFilters) {
    const reportDate = endOfDay(new Date(filters.reportDate));

    const centers = await prisma.center.findMany({
        where: {
            isActive: true,
            status: 'APPROVED',
            ...(filters.branchIds ? { branchId: { in: filters.branchIds } } : {}),
        },
        include: {
            branch: { select: { id: true, code: true, name: true } },
            fdo: { select: { id: true, firstName: true, lastName: true } },
            clients: {
                where: { isActive: true },
                include: {
                    loanApplications: {
                        where: {
                            isActive: true,
                            disbursementStatus: 'DISBURSED',
                            createdAt: { lte: reportDate },
                        },
                        include: {
                            schedules: { where: { dueDate: { lte: reportDate } } },
                        },
                    },
                },
            },
        },
        orderBy: { code: 'asc' },
    });

    return centers.map((center) => {
        let clientsCount = 0;
        let waitingBorrowers = 0;
        let portfolio = 0;
        let arrearAmount = 0;
        let advanceAmount = 0;
        let preclosureCount = 0;

        for (const client of center.clients) {
            const activeLoans = client.loanApplications.filter((l) =>
                !(l as any).closedDate || (l as any).closedDate > reportDate
            );

            if (activeLoans.length > 0) {
                clientsCount++;
            } else {
                waitingBorrowers++;
            }

            for (const loan of activeLoans) {
                const loanOS = Number(loan.amount) - Number(loan.principalPaid);
                portfolio += Math.max(0, loanOS);

                for (const schedule of loan.schedules) {
                    if (schedule.status !== 'PAID') {
                        const unpaidPri = Number(schedule.principalDue) - Number(schedule.principalPaid);
                        const unpaidInt = Number(schedule.interestDue) - Number(schedule.interestPaid);
                        if (unpaidPri > 0 || unpaidInt > 0) {
                            arrearAmount += Math.max(0, unpaidPri + unpaidInt);
                        }
                    }
                }
            }

            const preclosedToday = client.loanApplications.some((l) =>
                (l as any).closedDate &&
                (l as any).closedDate.toISOString().split('T')[0] === reportDate.toISOString().split('T')[0]
            );
            if (preclosedToday) preclosureCount++;
        }

        return {
            id: center.id,
            branchId: center.branch.code,
            centerId: center.code,
            centerName: center.name,
            localArea: (center as any).localArea || 'N/A',
            employeeName: center.fdo ? `${center.fdo.firstName} ${center.fdo.lastName}` : 'Unassigned',
            meetingDay: center.meetingDay || 'N/A',
            meetingTime: center.meetingTime || '00:00:00.0',
            kmFromBranch: center.kmFromBranch ?? null,
            contactPerson: center.contactPerson ?? '',
            contactPersonNumber: center.contactNumber ?? '',
            clients: clientsCount,
            waitingBorrowers,
            portfolio: Math.round(portfolio),
            arrear: Math.round(arrearAmount),
            advance: Math.round(advanceAmount),
            advAdjustment: 0,
            preclosure: preclosureCount,
        };
    });
}

// ── Daily Meeting Check ──────────────────────────────────────────

export type MeetingCheckFilters = {
    reportDate: string;
    branchIds: string[] | null;
    centerId?: string | null;
};

export async function getMeetingCheckRows(filters: MeetingCheckFilters) {
    const reportDate = new Date(filters.reportDate);
    reportDate.setHours(0, 0, 0, 0);
    const endOfDayDate = new Date(filters.reportDate);
    endOfDayDate.setHours(23, 59, 59, 999);

    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const meetingDayStr = days[reportDate.getDay()];

    const centerWhereClause: any = { isActive: true, meetingDay: meetingDayStr };
    if (filters.branchIds !== null) {
        centerWhereClause.branchId = filters.branchIds.length === 1 ? filters.branchIds[0] : { in: filters.branchIds };
    }
    if (filters.centerId && filters.centerId !== 'all') {
        centerWhereClause.id = filters.centerId;
    }

    const meetingCenters = await prisma.center.findMany({
        where: centerWhereClause,
        include: {
            fdo: { select: { firstName: true, lastName: true } },
            clients: { where: { isActive: true }, select: { id: true } },
        },
        orderBy: { name: 'asc' },
    });

    if (meetingCenters.length === 0) {
        return {
            data: [] as Array<{
                id: string; centerCode: string; centerName: string; fdoName: string; clientCount: number;
                meetingTime: string; meetingStatus: string; expectedCollection: number; actualCollection: number; collectionVariance: number;
            }>,
            summary: { totalCenters: 0, meetingsCompleted: 0, meetingsPending: 0, totalExpectedCollection: 0, totalCollected: 0 },
        };
    }

    const centerIds = meetingCenters.map((c) => c.id);

    const attendances = await prisma.clientAttendance.groupBy({
        by: ['centerId'],
        where: { centerId: { in: centerIds }, attendanceDate: { gte: reportDate, lte: endOfDayDate } },
        _count: { clientId: true },
    });
    const centersWithAttendance = new Set(attendances.map((a) => a.centerId));

    const collections = await prisma.loanTransaction.groupBy({
        by: ['centerId'],
        where: {
            centerId: { in: centerIds },
            transactionDate: { gte: reportDate, lte: endOfDayDate },
            type: { in: ['REPAYMENT', 'PRECLOSURE'] },
            isReversed: false,
        },
        _sum: { amount: true },
    });
    const collectionMap = new Map(collections.map((c) => [c.centerId, c._sum.amount?.toNumber() || 0]));

    const activeLoans = await prisma.loan.findMany({
        where: { centerId: { in: centerIds }, isActive: true, disbursementStatus: 'DISBURSED' },
        select: { id: true, centerId: true },
    });
    const activeLoanIds = activeLoans.map((l) => l.id);

    const dueSchedules = await prisma.loanSchedule.groupBy({
        by: ['loanId'],
        where: { loanId: { in: activeLoanIds }, status: { in: ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] }, dueDate: { lte: endOfDayDate } },
        _sum: { totalDue: true, totalPaid: true },
    });

    const expectedMap = new Map<string, number>();
    const loanCenterMap = new Map(activeLoans.map((l) => [l.id, l.centerId]));
    for (const schedule of dueSchedules) {
        const centerId = loanCenterMap.get(schedule.loanId);
        const due = schedule._sum.totalDue?.toNumber() || 0;
        const paid = schedule._sum.totalPaid?.toNumber() || 0;
        const remaining = Math.max(0, due - paid);
        if (centerId && remaining > 0) {
            expectedMap.set(centerId, (expectedMap.get(centerId) || 0) + remaining);
        }
    }

    const formattedData = meetingCenters.map((center) => {
        const isMeetingCompleted = centersWithAttendance.has(center.id);
        const collectedAmount = collectionMap.get(center.id) || 0;
        const expectedAmount = expectedMap.get(center.id) || 0;
        return {
            id: center.id,
            centerCode: center.code,
            centerName: center.name,
            fdoName: center.fdo ? `${center.fdo.firstName} ${center.fdo.lastName}` : 'Unassigned',
            clientCount: center.clients.length,
            meetingTime: center.meetingTime || 'N/A',
            meetingStatus: isMeetingCompleted ? 'COMPLETED' : 'PENDING',
            expectedCollection: expectedAmount,
            actualCollection: collectedAmount,
            collectionVariance: collectedAmount - expectedAmount,
        };
    });

    const summary = {
        totalCenters: formattedData.length,
        meetingsCompleted: formattedData.filter((d) => d.meetingStatus === 'COMPLETED').length,
        meetingsPending: formattedData.filter((d) => d.meetingStatus === 'PENDING').length,
        totalExpectedCollection: formattedData.reduce((sum, d) => sum + d.expectedCollection, 0),
        totalCollected: formattedData.reduce((sum, d) => sum + d.actualCollection, 0),
    };

    return { data: formattedData, summary };
}

// ── Waiting Borrowers ────────────────────────────────────────────

export type WaitingBorrowersFilters = {
    branchIds: string[] | null;
    centerId?: string | null;
};

export async function getWaitingBorrowersDetailedRows(filters: WaitingBorrowersFilters) {
    const { companyNameShort } = await getActiveBrandNames();
    const clients = await prisma.client.findMany({
        where: {
            isActive: true,
            ...(filters.branchIds ? { center: { branchId: { in: filters.branchIds } } } : {}),
            ...(filters.centerId ? { centerId: filters.centerId } : {}),
        },
        include: {
            center: { select: { name: true, code: true } },
            loanApplications: {
                where: { isActive: true },
                orderBy: { createdAt: 'desc' },
                take: 1,
                include: { schedules: { orderBy: { installmentNo: 'desc' }, take: 1 } },
            },
        },
    });
    const contactOf = await getMemberContacts({
        clientIds: clients.map((c) => c.id),
        loanIds: clients.map((c) => c.loanApplications[0]?.id),
    });

    return clients.map((client) => {
        const activeLoan = client.loanApplications[0] || null;
        let principalBalance = 0;
        let disbursalDate = 'NEW';
        let loanAmount = 0;
        let repaidAmount = 0;
        let maturityDate: string | null = null;
        let loanCycle = 0;

        if (activeLoan) {
            loanCycle = 1;
            loanAmount = Number(activeLoan.amount);
            principalBalance = loanAmount - Number(activeLoan.principalPaid);
            repaidAmount = Number(activeLoan.principalPaid);
            const activeLoanDisbursedAt = activeLoan.disbursedByBMAt ?? activeLoan.disbursedLevel1At;
            disbursalDate = activeLoanDisbursedAt ? activeLoanDisbursedAt.toISOString() : 'PENDING';

            if (activeLoan.schedules && activeLoan.schedules.length > 0) {
                maturityDate = activeLoan.schedules[0].dueDate.toISOString();
            } else if (activeLoanDisbursedAt) {
                const maturity = new Date(activeLoanDisbursedAt);
                maturity.setMonth(maturity.getMonth() + (activeLoan.tenureMonths || 12));
                maturityDate = maturity.toISOString();
            }
        }

        return {
            branch: `001 - ${companyNameShort} MAIN`,
            center: `${client.center?.code} - ${client.center?.name}`,
            accountId: activeLoan ? activeLoan.loanNumber : 'N/A',
            hasLoan: !!activeLoan,
            clientName: `${client.clientId} - ${client.firstName} ${client.lastName}`,
            phone: client.mobileNumber || 'N/A',
            dateOfJoining: client.createdAt.toISOString(),
            disbursalDate,
            maturityDate,
            lastPaidDate: null,
            loanCycle,
            loanAmount,
            repaidAmount,
            principleBalance: principalBalance,
            closingArrPri: 0,
            arrearType: principalBalance > 0 ? 'ACTIVE' : 'NO OS',
            balanceDues: principalBalance,
            ...contactOf(client.id, activeLoan?.id),
        };
    });
}

export async function getWaitingBorrowersSummaryRows(filters: WaitingBorrowersFilters) {
    const today = endOfDay(new Date());
    const centers = await prisma.center.findMany({
        where: {
            isActive: true,
            ...(filters.branchIds ? { branchId: { in: filters.branchIds } } : {}),
            ...(filters.centerId ? { id: filters.centerId } : {}),
        },
        include: {
            branch: { select: { name: true, code: true } },
            clients: {
                where: { isActive: true },
                include: { loanApplications: { where: { isActive: true }, orderBy: { createdAt: 'desc' }, take: 1 } },
            },
        },
    });

    return centers.map((center) => {
        let noOsNewClient = 0, client4Weeks = 0, os4Weeks = 0, client10Weeks = 0, os10Weeks = 0, defaultClients = 0, osAmount = 0;

        for (const client of center.clients) {
            const activeLoan = client.loanApplications[0] || null;
            if (!activeLoan) {
                noOsNewClient++;
                continue;
            }
            const balance = Number(activeLoan.amount) - Number(activeLoan.principalPaid);
            osAmount += balance;
            if (balance <= 0) {
                noOsNewClient++;
                continue;
            }
            const lastActivity = activeLoan.disbursedByBMAt || activeLoan.disbursedLevel1At || activeLoan.createdAt;
            const weeksSinceActivity = differenceInWeeks(today, lastActivity);
            if (weeksSinceActivity >= 10) {
                client10Weeks++; os10Weeks += balance; defaultClients++;
            } else if (weeksSinceActivity >= 4) {
                client4Weeks++; os4Weeks += balance; defaultClients++;
            }
        }

        return {
            branchName: `${center.branch.code} - ${center.branch.name}`,
            center: `${center.code} - ${center.name}`,
            noOsNewClient, client4Weeks, os4Weeks, client10Weeks, os10Weeks, defaultClients, osAmount,
        };
    });
}
