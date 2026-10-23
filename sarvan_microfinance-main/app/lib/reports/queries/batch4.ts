import { prisma } from '@/app/lib/prisma';
import { buildMemberSearchWhere, getMemberContacts } from '@/app/lib/reports/member-contacts';

/**
 * Shared query functions for reports whose API route previously had the
 * Prisma query inlined — each function here is called by BOTH the report's
 * own API route (paginated/on-screen view) and its app/lib/reports/report-registry.ts
 * async-export adapter, so the two can never silently diverge.
 */

// ── Future Report ────────────────────────────────────────────────

export type FutureReportFilters = {
    fromDate: string;
    toDate: string;
    branchIds: string[] | null;
    centerId?: string | null;
    page?: number;
    pageSize?: number;
    search?: string | null; // member name / ID / Aadhaar / mobile / co-applicant mobile
};

export async function getFutureReportRows(filters: FutureReportFilters) {
    const fromDateStart = new Date(`${filters.fromDate}T00:00:00.000Z`);
    const toDateEnd = new Date(`${filters.toDate}T23:59:59.999Z`);
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 20;

    const branchFilter = filters.branchIds === null
        ? {}
        : { branchId: filters.branchIds.length === 1 ? filters.branchIds[0] : { in: filters.branchIds } };

    const scheduleWhere: Record<string, unknown> = {
        dueDate: { gte: fromDateStart, lte: toDateEnd },
        status: { in: ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] },
        loan: {
            disbursementStatus: 'DISBURSED',
            isActive: true,
            isDead: false,
            ...branchFilter,
            ...(filters.centerId ? { centerId: filters.centerId } : {}),
            ...(buildMemberSearchWhere(filters.search) ? { client: buildMemberSearchWhere(filters.search) } : {}),
        },
    };

    const [totalCount, schedules] = await Promise.all([
        prisma.loanSchedule.count({ where: scheduleWhere }),
        prisma.loanSchedule.findMany({
            where: scheduleWhere,
            include: {
                loan: {
                    include: {
                        schedules: {
                            select: { installmentNo: true, status: true, dueDate: true, interestDue: true, interestPaid: true },
                            orderBy: { installmentNo: 'asc' },
                        },
                        branch: { select: { code: true, name: true } },
                        center: {
                            select: {
                                code: true, name: true, meetingTime: true,
                                fdo: { select: { firstName: true, lastName: true } },
                            },
                        },
                        client: {
                            select: { clientId: true, firstName: true, lastName: true, mobileNumber: true, phone: true, otherIdNo: true },
                        },
                        funder: { select: { funderName: true } },
                    },
                },
            },
            orderBy: [
                { loan: { branchId: 'asc' } },
                { loan: { centerId: 'asc' } },
                { dueDate: 'asc' },
                { id: 'asc' },
            ],
            skip: (page - 1) * pageSize,
            take: pageSize,
        }),
    ]);

    const contactOf = await getMemberContacts({ clientIds: schedules.map((s) => s.loan.clientId), loanIds: schedules.map((s) => s.loanId) });
    const data = schedules.map((schedule, idx) => {
        const loan = schedule.loan;
        const allSchedules = loan.schedules;
        const totalInstallments = allSchedules.length;
        const pendingSchedules = allSchedules.filter(
            (s) => s.status === 'PENDING' || s.status === 'PARTIALLY_PAID' || s.status === 'OVERDUE'
        );
        const outstandingPrincipal = Math.max(0, Number(loan.amount) - Number(loan.principalPaid));
        const outstandingInterest = pendingSchedules.reduce((sum, s) => sum + Math.max(0, Number(s.interestDue) - Number(s.interestPaid)), 0);
        const outstandingTotal = outstandingPrincipal + outstandingInterest;
        const lastScheduleDueDate = allSchedules.length > 0 ? allSchedules[allSchedules.length - 1].dueDate : null;
        const disbursementDate = loan.disbursedByBMAt ?? loan.disbursedLevel1At ?? null;

        return {
            sNo: (page - 1) * pageSize + idx + 1,
            branchId: loan.branch?.code ?? 'N/A',
            branchName: loan.branch?.name ?? 'N/A',
            centreId: loan.center?.code ?? 'N/A',
            centerName: loan.center?.name ?? 'N/A',
            fdoName: loan.center?.fdo ? `${loan.center.fdo.firstName} ${loan.center.fdo.lastName}` : 'N/A',
            loanId: loan.loanNumber,
            memberUniqueId: loan.client.clientId,
            memberName: `${loan.client.firstName} ${loan.client.lastName}`,
            memberPhone: loan.client.mobileNumber || loan.client.phone || 'N/A',
            memberAadhar: loan.client.otherIdNo || 'N/A',
            meetupTime: loan.center?.meetingTime ?? 'N/A',
            disbursementDate: disbursementDate ? disbursementDate.toISOString().split('T')[0] : 'N/A',
            firstEmiDate: loan.firstDueDate ? loan.firstDueDate.toISOString().split('T')[0] : 'N/A',
            loanMaturityDate: lastScheduleDueDate ? new Date(lastScheduleDueDate).toISOString().split('T')[0] : 'N/A',
            loanAmount: Number(loan.amount),
            outstandingPrincipal,
            outstandingInterest,
            outstandingTotal,
            dueDate: schedule.dueDate.toISOString().split('T')[0],
            dueNo: `${schedule.installmentNo} - ${totalInstallments}`,
            duePrincipal: Number(schedule.principalDue),
            dueInterest: Number(schedule.interestDue),
            totalDueAmount: Number(schedule.totalDue),
            funderName: loan.funder?.funderName ?? 'Own Fund',
            coApplicantMobile: contactOf(loan.clientId, schedule.loanId).coApplicantMobile,
        };
    });

    const totals = {
        loanAmount: data.reduce((s, r) => s + r.loanAmount, 0),
        outstandingPrincipal: data.reduce((s, r) => s + r.outstandingPrincipal, 0),
        outstandingInterest: data.reduce((s, r) => s + r.outstandingInterest, 0),
        outstandingTotal: data.reduce((s, r) => s + r.outstandingTotal, 0),
        duePrincipal: data.reduce((s, r) => s + r.duePrincipal, 0),
        dueInterest: data.reduce((s, r) => s + r.dueInterest, 0),
        totalDueAmount: data.reduce((s, r) => s + r.totalDueAmount, 0),
    };

    return { data, totalCount, totalPages: Math.ceil(totalCount / pageSize), page, pageSize, totals };
}

// ── FDO Performance ──────────────────────────────────────────────

export type FdoPerformanceFilters = {
    fromDate: string;
    toDate: string;
    branchIds: string[] | null;
};

export async function getFdoPerformanceRows(filters: FdoPerformanceFilters) {
    const fromDate = new Date(filters.fromDate);
    fromDate.setHours(0, 0, 0, 0);
    const tillDate = new Date(filters.toDate);
    tillDate.setHours(23, 59, 59, 999);

    const userFilter: any = { role: 'FDO', isActive: true };
    if (filters.branchIds) {
        userFilter.branchId = filters.branchIds.length === 1 ? filters.branchIds[0] : { in: filters.branchIds };
    }

    const fdos = await prisma.user.findMany({
        where: userFilter,
        select: {
            id: true,
            firstName: true,
            lastName: true,
            branch: { select: { id: true, name: true, code: true } },
            assignedCenters: {
                where: { status: 'APPROVED' },
                select: {
                    id: true,
                    clients: {
                        select: {
                            id: true,
                            isActive: true,
                            createdAt: true,
                            inactiveDate: true,
                            loanApplications: {
                                where: { disbursementStatus: 'DISBURSED' },
                                select: {
                                    id: true,
                                    amount: true,
                                    principalPaid: true,
                                    interestPaid: true,
                                    disbursedLevel1At: true,
                                    closedDate: true,
                                    schedules: {
                                        where: { dueDate: { lte: tillDate } },
                                        select: { totalDue: true, totalPaid: true, status: true, dueDate: true },
                                    },
                                    transactions: {
                                        where: {
                                            transactionDate: { gte: fromDate, lte: tillDate },
                                            type: { in: ['REPAYMENT', 'PRECLOSURE'] },
                                            isReversed: false,
                                        },
                                        select: { amount: true },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },
        orderBy: [{ branch: { code: 'asc' } }, { firstName: 'asc' }],
    });

    return fdos.map((fdo, index) => {
        const branch = fdo.branch;
        const centers = fdo.assignedCenters;
        const allClients = centers.flatMap((c) => c.clients);

        const totalMembers = allClients.length;
        const activeMembers = allClients.filter((c) => c.isActive).length;
        const waitingBorrowers = allClients.filter((c) =>
            c.isActive && c.loanApplications.filter((l) => !l.closedDate).length === 0
        ).length;
        const newMembers = allClients.filter((c) => c.createdAt >= fromDate && c.createdAt <= tillDate).length;
        const droppedMembers = allClients.filter((c) =>
            c.inactiveDate && c.inactiveDate >= fromDate && c.inactiveDate <= tillDate
        ).length;

        const allLoans = allClients.flatMap((c) => c.loanApplications);
        const disbursedInPeriod = allLoans.filter((l) =>
            l.disbursedLevel1At && l.disbursedLevel1At >= fromDate && l.disbursedLevel1At <= tillDate
        );
        const totalDisbursedAmt = disbursedInPeriod.reduce((s, l) => s + Number(l.amount), 0);
        const disbursedCount = disbursedInPeriod.length;
        const totalCollInPeriod = allLoans.reduce((s, l) =>
            s + l.transactions.reduce((ts, t) => ts + Number(t.amount), 0), 0
        );

        let periodDemand = 0, periodCollected = 0, totalHistoricalDemand = 0, totalHistoricalCollected = 0, overdueCount = 0, paidCount = 0;
        for (const loan of allLoans) {
            for (const sch of loan.schedules) {
                const dueDate = new Date(sch.dueDate);
                totalHistoricalDemand += Number(sch.totalDue);
                totalHistoricalCollected += Number(sch.totalPaid);
                if (dueDate >= fromDate && dueDate <= tillDate) {
                    periodDemand += Number(sch.totalDue);
                    periodCollected += Number(sch.totalPaid);
                }
                if (sch.status === 'OVERDUE' || (sch.status === 'PENDING' && dueDate < new Date())) overdueCount++;
                if (sch.status === 'PAID') paidCount++;
            }
        }

        const totalArrears = Math.max(0, totalHistoricalDemand - totalHistoricalCollected);
        const loanOs = allLoans.reduce((s, l) => {
            if (!l.closedDate || l.closedDate > tillDate) return s + (Number(l.amount) - Number(l.principalPaid));
            return s;
        }, 0);
        const closedInPeriod = allLoans.filter((l) => l.closedDate && l.closedDate >= fromDate && l.closedDate <= tillDate).length;

        return {
            sino: index + 1,
            branch: branch ? `${branch.code} - ${branch.name}` : 'N/A',
            fdo: `${fdo.firstName} ${fdo.lastName}`,
            totalCenters: centers.length,
            totalMembers,
            active: activeMembers,
            wb: waitingBorrowers,
            newMembers,
            dropped: droppedMembers,
            disbursedCount,
            totalDisbursedAmt,
            totalColl: totalCollInPeriod,
            totalDemand: periodDemand,
            totalCollected: periodCollected,
            totalArrears,
            loanOs: Math.max(0, loanOs),
            overdueCount,
            paidCount,
            closedLoans: closedInPeriod,
            activeLoans: allLoans.filter((l) => !l.closedDate || l.closedDate > tillDate).length,
        };
    });
}
