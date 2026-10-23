'use server';

import { prisma } from '@/app/lib/prisma';
import { format } from 'date-fns';
import { Decimal } from '@prisma/client/runtime/library';
import { parseKolkataAttendanceDateYmd, getKolkataDayEndExclusiveUtc } from '@/app/lib/branch-lock';
import { getWeekdayNameInTimeZone } from '@/app/lib/branch-financial-day';
import { getServerActionUser } from '@/app/lib/permissions/server-action-auth';
import { resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';

export type BranchDemandRow = {
    fdo: string;
    fdoId: string;
    center: string;
    centerId: string;
    meetingTime: string;
    noOfClients: number;
    wb: number;
    osPri: number;
    osInt: number;
    arrearPri: number;
    arrearInt: number;
    arrearSavings: number;
    demandPri: number;
    demandInt: number;
    demandSavings: number;
    totalDemand: number;
};

export type BranchDemandResponse = {
    data: BranchDemandRow[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
};

/**
 * Get Branch Demand data for a specific date with pagination
 * @param demandDate - Date string in YYYY-MM-DD format
 * @param page - Page number (1-indexed)
 * @param pageSize - Number of records per page
 */
export async function getBranchDemandData(
    demandDate: string,
    page: number = 1,
    pageSize: number = 10,
    branchId?: string,
    centerId?: string
): Promise<BranchDemandResponse> {
    // Server Action — called directly from a client component with no API
    // route / withAuth wrapper in front of it, so auth + branch scoping
    // must happen here.
    const user = await getServerActionUser();
    if (!user) throw new Error('Authentication required');
    const branchIds = await resolveScopedBranchIds(user, branchId ?? null);
    return getBranchDemandDataCore(demandDate, page, pageSize, branchIds, centerId);
}

/**
 * Cookie-free core, split out of getBranchDemandData() above so the Request Report queue
 * adapter (app/lib/reports/report-registry.ts) — which has no cookie/session context — can
 * call it directly with already-resolved branchIds. The live page's action above still does
 * its own auth + resolveScopedBranchIds() before delegating here.
 */
export async function getBranchDemandDataCore(
    demandDate: string,
    page: number = 1,
    pageSize: number = 10,
    branchIds: string[] | null,
    centerId?: string
): Promise<BranchDemandResponse> {
    try {
        // Parse date as IST midnight — explicit +05:30 offset, server-TZ-independent.
        // Using `new Date(year, month-1, day)` creates a local-midnight date which is
        // wrong on UTC servers (e.g. 2026-05-06T00:00:00Z ≠ 2026-05-06T00:00:00+05:30).
        const date = parseKolkataAttendanceDateYmd(demandDate);

        // Resolve day of week in IST, not server-local.
        const dayName = getWeekdayNameInTimeZone(date, 'Asia/Kolkata');

        console.log(`Generating Branch Demand for Date: ${demandDate}, Day: ${dayName}`);

        // Get all centers meeting on this day with active loans
        const centers = await prisma.center.findMany({
            where: {
                isActive: true,
                status: 'APPROVED',
                meetingDay: {
                    equals: dayName,
                    mode: 'insensitive'
                },
                ...(branchIds ? { branchId: { in: branchIds } } : {}),
                ...(centerId && centerId !== 'all' ? { id: centerId } : {}),
            },
            include: {
                fdo: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true
                    }
                },
                clients: {
                    where: {
                        isActive: true,
                    },
                    include: {
                        loanApplications: {
                            where: {
                                isActive: true,
                                disbursementStatus: 'DISBURSED',
                            },
                            include: {
                                schedules: {
                                    where: {
                                        dueDate: {
                                            // Use half-open IST range: [dayStart, dayEndExclusive)
                                            // dayStart IST = demandDate T00:00:00+05:30 = T18:30:00Z prev day
                                            // dayEnd  IST = next day T00:00:00+05:30  = T18:30:00Z demandDate
                                            lt: getKolkataDayEndExclusiveUtc(
                                                parseKolkataAttendanceDateYmd(demandDate)
                                            ),
                                        },
                                        status: {
                                            not: 'PAID',
                                        }
                                    },
                                    orderBy: {
                                        dueDate: 'asc'
                                    }
                                }
                            }
                        }
                    }
                }
            },
            orderBy: [
                { fdoId: 'asc' },
                { code: 'asc' },
                { id: 'asc' }
            ]
        });

        console.log(`Found ${centers.length} centers for Branch Demand.`);

        // Process each center to calculate demand metrics
        const allRows: BranchDemandRow[] = centers.map(center => {
            const fdoName = center.fdo
                ? `${center.fdo.firstName} ${center.fdo.lastName}`
                : 'UNASSIGNED';
            const fdoId = center.fdo?.id || 'UNASSIGNED';

            let noOfClients = 0;
            let wb = 0;
            let osPri = 0;
            let osInt = 0;
            let arrearPri = 0;
            let arrearInt = 0;
            let arrearSavings = 0;
            let demandPri = 0;
            let demandInt = 0;
            let demandSavings = 0;

            // Count clients with active loans
            const clientsWithLoans = new Set<string>();

            for (const client of center.clients) {
                const activeLoans = client.loanApplications.filter(l =>
                    l.isActive && l.disbursementStatus === 'DISBURSED'
                );

                if (activeLoans.length > 0) {
                    clientsWithLoans.add(client.id);
                }

                for (const loan of activeLoans) {
                    // Calculate outstanding principal and interest
                    const principalOS = Number(loan.amount) - Number(loan.principalPaid);
                    const interestOS = Number(loan.interestRate) * Number(loan.amount) / 100 - Number(loan.interestPaid);

                    osPri += principalOS;
                    osInt += Math.max(0, interestOS);

                    // Process schedules
                    for (const schedule of loan.schedules) {
                        const dueDate = new Date(schedule.dueDate);
                        const isToday = format(dueDate, 'yyyy-MM-dd') === demandDate;

                        const pendingPrincipal = Number(schedule.principalDue) - Number(schedule.principalPaid);
                        const pendingInterest = Number(schedule.interestDue) - Number(schedule.interestPaid);
                        const pendingSavings = Math.max(0, Number(schedule.savingsDue || 0) - Number(schedule.savingsPaid || 0));

                        if (isToday) {
                            // Today's demand
                            demandPri += pendingPrincipal;
                            demandInt += pendingInterest;
                            demandSavings += pendingSavings;
                        } else if (dueDate < date) {
                            // Arrears (overdue)
                            arrearPri += pendingPrincipal;
                            arrearInt += pendingInterest;
                            arrearSavings += pendingSavings;

                            // Calculate weeks behind
                            const daysDiff = Math.floor((date.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
                            wb += Math.ceil(daysDiff / 7);
                        }
                    }
                }
            }

            noOfClients = clientsWithLoans.size;

            const totalDemand = demandPri + demandInt + demandSavings;

            return {
                fdo: fdoName,
                fdoId,
                center: `${center.code} - ${center.name}`,
                centerId: center.id,
                meetingTime: center.meetingTime || '',
                noOfClients,
                wb,
                osPri: Math.round(osPri),
                osInt: Math.round(osInt),
                arrearPri: Math.round(arrearPri),
                arrearInt: Math.round(arrearInt),
                arrearSavings: Math.round(arrearSavings),
                demandPri: Math.round(demandPri),
                demandInt: Math.round(demandInt),
                demandSavings: Math.round(demandSavings),
                totalDemand: Math.round(totalDemand),
            };
        });

        // Calculate total count
        const total = allRows.length;
        const totalPages = Math.ceil(total / pageSize);

        // Apply pagination
        const skip = (page - 1) * pageSize;
        const paginatedData = allRows.slice(skip, skip + pageSize);

        return {
            data: paginatedData,
            total,
            page,
            pageSize,
            totalPages
        };
    } catch (error) {
        console.error('Error fetching branch demand data:', error);
        throw new Error('Failed to fetch branch demand data');
    }
}

/**
 * Get totals for all data (not just current page)
 */
export async function getBranchDemandTotals(demandDate: string, branchId?: string, centerId?: string) {
    const fullData = await getBranchDemandData(demandDate, 1, 999999, branchId, centerId);

    const totals = fullData.data.reduce(
        (acc, row) => ({
            noOfClients: acc.noOfClients + row.noOfClients,
            wb: acc.wb + row.wb,
            osPri: acc.osPri + row.osPri,
            osInt: acc.osInt + row.osInt,
            arrearPri: acc.arrearPri + row.arrearPri,
            arrearInt: acc.arrearInt + row.arrearInt,
            arrearSavings: acc.arrearSavings + (row.arrearSavings || 0),
            demandPri: acc.demandPri + row.demandPri,
            demandInt: acc.demandInt + row.demandInt,
            demandSavings: acc.demandSavings + (row.demandSavings || 0),
            totalDemand: acc.totalDemand + row.totalDemand,
        }),
        {
            noOfClients: 0,
            wb: 0,
            osPri: 0,
            osInt: 0,
            arrearPri: 0,
            arrearInt: 0,
            arrearSavings: 0,
            demandPri: 0,
            demandInt: 0,
            demandSavings: 0,
            totalDemand: 0,
        }
    );

    return totals;
}
