import { prisma } from '@/app/lib/prisma';
import { format } from 'date-fns';
import { parseKolkataAttendanceDateYmd, getKolkataDayEndExclusiveUtc } from '@/app/lib/branch-lock';
import { getWeekdayNameInTimeZone } from '@/app/lib/branch-financial-day';
import { getMemberContacts } from '@/app/lib/reports/member-contacts';
import { matchesMemberSearch, type MemberContactFields } from '@/app/lib/reports/member-contact-columns';

export type FutureDemandParams = {
    fromDate: string;
    toDate: string;
    reportType: 'OFFICERWISE' | 'CENTERWISE' | 'CLIENTWISE' | 'BRANCHWISE'; // Added BRANCHWISE as it was in select options
    page?: number;
    pageSize?: number;
    branchId?: string | string[];
    centerId?: string;
    /** CLIENTWISE only: member name / Aadhaar / mobile / co-applicant mobile. */
    search?: string | null;
};

export type FutureDemandRow = {
    demandDate: string;
    demandDay: string;
    fdo: string;
    centerName?: string;
    clientName?: string;
    noOfCenters?: number;
    noOfClients?: number;
    demandPri: number;
    demandInt: number;
    demandSavings: number;
    totalDemand: number;
} & MemberContactFields; // CLIENTWISE rows only

export type FutureDemandResult = {
    data: FutureDemandRow[];
    totalPages: number;
    totalRecords: number;
    totals: {
        noOfCenters: number;
        noOfClients: number;
        demandPri: number;
        demandInt: number;
        demandSavings: number;
        totalDemand: number;
    };
};

export async function getFutureDemandData({
    fromDate,
    toDate,
    reportType,
    page = 1,
    pageSize = 20,
    branchId,
    centerId,
    search,
}: FutureDemandParams): Promise<FutureDemandResult> {
    // 1. Fetch Schedules
    // We select schedules within the date range from active loans
    const schedules = await prisma.loanSchedule.findMany({
        where: {
            dueDate: {
                gte: parseKolkataAttendanceDateYmd(fromDate),
                // IST-aware exclusive end: next day's IST midnight in UTC
                lt: getKolkataDayEndExclusiveUtc(parseKolkataAttendanceDateYmd(toDate)),
            },
            loan: {
                // Ensure loan is relevant (e.g. active or not fully closed/written off)
                // For future demand, usually just check if loan is not REJECTED or DRAFT
                isActive: true, // Assuming isActive covers it
                ...(branchId
                    ? { branchId: Array.isArray(branchId) ? { in: branchId } : branchId }
                    : {}),
                ...(centerId && centerId !== 'all' ? { client: { centerId } } : {}),
            },
            // We want what is due, regardless of payment status?
            // "Future Demand" implies projected.
            // But if checking past dates, it might show what was due.
            // We take the scheduled amounts.
        },
        include: {
            loan: {
                select: {
                    id: true,
                    amount: true,
                    client: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            center: {
                                select: {
                                    id: true,
                                    name: true,
                                    code: true,
                                    fdo: {
                                        select: {
                                            id: true,
                                            firstName: true,
                                            lastName: true,
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },
        orderBy: {
            dueDate: 'asc',
        },
    });

    // Advance: approved payments made BEFORE an installment's due date reduce that installment's demand.
    const dueById = new Map(schedules.map(s => [s.id, s.dueDate]));
    const advanceLines = schedules.length === 0 ? [] : await prisma.loanTransactionLine.findMany({
        where: {
            scheduleId: { in: [...dueById.keys()] },
            transaction: { status: 'APPROVED', isReversed: false, type: { in: ['REPAYMENT', 'PRECLOSURE'] } },
        },
        select: { scheduleId: true, principalAmount: true, interestAmount: true, transaction: { select: { transactionDate: true } } },
    });
    const advanceBySchedule = new Map<string, { principal: number; interest: number }>();
    for (const ln of advanceLines) {
        const due = dueById.get(ln.scheduleId);
        if (!due || !(ln.transaction.transactionDate < due)) continue;
        const cur = advanceBySchedule.get(ln.scheduleId) ?? { principal: 0, interest: 0 };
        cur.principal += Number(ln.principalAmount);
        cur.interest += Number(ln.interestAmount);
        advanceBySchedule.set(ln.scheduleId, cur);
    }

    // 2. Grouping Logic
    const groupedData: Record<string, FutureDemandRow> = {};

    for (const schedule of schedules) {
        const dateStr = format(schedule.dueDate, 'yyyy-MM-dd');
        // Derive weekday in IST — server-locale toLocaleDateString is unsafe on UTC servers.
        const dayStr = getWeekdayNameInTimeZone(schedule.dueDate, 'Asia/Kolkata');

        const fdo = schedule.loan.client.center?.fdo;
        const fdoName = fdo ? `${fdo.firstName} ${fdo.lastName}`.trim() : 'Unassigned';
        const center = schedule.loan.client.center;
        const centerName = center ? `${center.code} - ${center.name}` : 'Unassigned';
        const client = schedule.loan.client;
        const clientName = `${client.firstName} ${client.lastName}`.trim();

        let key = '';

        if (reportType === 'OFFICERWISE') {
            // Group by Date + FDO
            key = `${dateStr}_${fdo?.id || 'unassigned'}`;
        } else if (reportType === 'CENTERWISE') {
            key = `${dateStr}_${center?.id || "unassigned"}`;
        } else if (reportType === 'CLIENTWISE') {
            key = `${dateStr}_${client.id}`; // One row per client per day?
        } else if (reportType === 'BRANCHWISE') {
            key = `${dateStr}_BRANCH`; // Simplistic branchwise (all in one if single branch context)
        }

        if (!groupedData[key]) {
            groupedData[key] = {
                demandDate: dateStr,
                demandDay: dayStr,
                fdo: fdoName,
                centerName: reportType === 'CENTERWISE' || reportType === 'CLIENTWISE' ? centerName : undefined,
                clientName: reportType === 'CLIENTWISE' ? clientName : undefined,
                noOfCenters: 0, // Calculated via Set later
                noOfClients: 0,
                demandPri: 0,
                demandInt: 0,
                demandSavings: 0,
                totalDemand: 0,
            };
            // Temporary storage for unique counting
            (groupedData[key] as any)._centerIds = new Set<string>();
            (groupedData[key] as any)._clientIds = new Set<string>();
            (groupedData[key] as any)._loanIds = new Set<string>(); // To ensure we don't double count if multiple schedules match same day (unlikely but possible with multiple loans)
        }

        const group = groupedData[key];
        (group as any)._centerIds.add(center?.id || "unassigned");
        (group as any)._clientIds.add(client.id);

        const adv = advanceBySchedule.get(schedule.id) ?? { principal: 0, interest: 0 };
        const netPri = Math.max(0, Number(schedule.principalDue) - adv.principal);
        const netInt = Math.max(0, Number(schedule.interestDue) - adv.interest);
        group.demandPri += netPri;
        group.demandInt += netInt;
        group.demandSavings += Math.max(0, Number(schedule.savingsDue || 0) - Number(schedule.savingsPaid || 0));
        // Net of advance; keep any non-P&I remainder (savings/fees) of totalDue exactly as before.
        group.totalDemand += Math.max(0, Number(schedule.totalDue) - adv.principal - adv.interest);
    }

    // 3. Transform to Array and Finalize Counts
    // CLIENTWISE rows are one member each — attach Aadhaar / mobile / co-applicant mobile.
    const contactOf = reportType === 'CLIENTWISE'
        ? await getMemberContacts({ clientIds: Object.values(groupedData).flatMap((row) => [...((row as any)._clientIds as Set<string>)]) })
        : null;
    let results: FutureDemandRow[] = Object.values(groupedData).map(row => {
        const r = row as any;
        const clientInternalId = contactOf ? ([...(r._clientIds as Set<string>)][0] as string | undefined) : undefined;
        return {
            ...(contactOf && clientInternalId ? contactOf(clientInternalId) : {}),
            demandDate: r.demandDate,
            demandDay: r.demandDay,
            fdo: r.fdo,
            centerName: r.centerName,
            clientName: r.clientName,
            demandPri: r.demandPri,
            demandInt: r.demandInt,
            demandSavings: r.demandSavings,
            totalDemand: r.totalDemand,
            noOfCenters: r._centerIds.size,
            noOfClients: r._clientIds.size,
        };
    });

    if (reportType === 'CLIENTWISE' && search?.trim()) {
        results = results.filter((r) => matchesMemberSearch(search, r, r.clientName, r.centerName));
    }

    // Sort
    results.sort((a, b) => {
        const dateA = new Date(a.demandDate).getTime();
        const dateB = new Date(b.demandDate).getTime();
        if (dateA !== dateB) return dateA - dateB;
        return a.fdo.localeCompare(b.fdo);
    });

    // Calculate Grand Totals
    const grandTotals = results.reduce((acc, curr) => ({
        noOfCenters: acc.noOfCenters + (curr.noOfCenters || 0),
        noOfClients: acc.noOfClients + (curr.noOfClients || 0),
        demandPri: acc.demandPri + curr.demandPri,
        demandInt: acc.demandInt + curr.demandInt,
        demandSavings: acc.demandSavings + (curr.demandSavings || 0),
        totalDemand: acc.totalDemand + curr.totalDemand
    }), { noOfCenters: 0, noOfClients: 0, demandPri: 0, demandInt: 0, demandSavings: 0, totalDemand: 0 });

    // Pagination
    const totalRecords = results.length;
    const totalPages = Math.ceil(totalRecords / pageSize);
    const startIndex = (page - 1) * pageSize;
    const paginatedData = results.slice(startIndex, startIndex + pageSize);

    return {
        data: paginatedData,
        totalPages,
        totalRecords,
        totals: grandTotals
    };
}
