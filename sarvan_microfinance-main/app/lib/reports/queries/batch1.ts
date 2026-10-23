import { prisma } from '@/app/lib/prisma';
import { startOfDay, endOfDay } from 'date-fns';
import { getPersonLabel } from '@/app/lib/person-label';
import { getMemberContacts } from '@/app/lib/reports/member-contacts';
import { getUtcBoundsForBranchCalendarDay, parseKolkataAttendanceDateYmd } from '@/app/lib/branch-lock';

/**
 * Shared query functions for reports whose API route previously had the
 * Prisma query inlined — each function here is called by BOTH the report's
 * own API route (paginated/on-screen view) and its app/lib/reports/report-registry.ts
 * async-export adapter, so the two can never silently diverge.
 */

// ── Addition / Deletion ──────────────────────────────────────────

export type AdditionDeletionFilters = {
    fromDate: string;
    toDate: string;
    branchIds: string[] | null;
    centerId?: string | null;
};

export async function getAdditionDeletionRows(filters: AdditionDeletionFilters) {
    const fromDate = startOfDay(new Date(filters.fromDate));
    const tillDate = endOfDay(new Date(filters.toDate));

    const centers = await prisma.center.findMany({
        where: {
            isActive: true,
            ...(filters.branchIds ? { branchId: { in: filters.branchIds } } : {}),
            ...(filters.centerId && filters.centerId !== 'all' ? { id: filters.centerId } : {}),
        },
        include: {
            fdo: { select: { id: true, firstName: true, lastName: true } },
            branch: { select: { name: true } },
        },
        orderBy: { code: 'asc' },
    });

    const clients = await prisma.client.findMany({
        where: {
            OR: [{ createdAt: { lte: tillDate } }, { inactiveDate: { gte: fromDate } }],
        },
        select: {
            id: true,
            centerId: true,
            createdAt: true,
            inactiveDate: true,
            isActive: true,
            admissionFees: true,
        },
    });

    return centers.map((center) => {
        const centerClients = clients.filter((c) => c.centerId === center.id);
        let opening = 0, induction = 0, dropped = 0, admissionFees = 0;

        for (const client of centerClients) {
            if (client.createdAt < fromDate) {
                if (client.isActive || (client.inactiveDate && client.inactiveDate >= fromDate)) opening++;
            }
            if (client.createdAt >= fromDate && client.createdAt <= tillDate) {
                induction++;
                admissionFees += Number(client.admissionFees || 0);
            }
            if (client.inactiveDate && client.inactiveDate >= fromDate && client.inactiveDate <= tillDate) dropped++;
        }

        return {
            centerId: center.id,
            fdo: center.fdo ? `${center.fdo.firstName} ${center.fdo.lastName}` : 'Unassigned',
            centerName: `${center.code} - ${center.name}`,
            opening,
            induction,
            dropped,
            closing: opening + induction - dropped,
            admissionFees,
        };
    });
}

// ── Attendance Summary ───────────────────────────────────────────

export type AttendanceFilters = {
    fromDate: string;
    toDate: string;
    branchIds: string[] | null;
};

function buildAttendanceWhere({ fromDate, toDate, branchIds }: AttendanceFilters) {
    const fromDateStr = fromDate.split('T')[0];
    const tillDateStr = toDate.split('T')[0];
    // Attendance.date is stored as the IST day-start instant, so the range must be the exact
    // IST calendar days [from 00:00 IST, till 23:59:59.999 IST] — padding it by a day each
    // side pulled in rows from outside the selected dates.
    const from = getUtcBoundsForBranchCalendarDay(parseKolkataAttendanceDateYmd(fromDateStr)).dayStartUtc;
    const till = getUtcBoundsForBranchCalendarDay(parseKolkataAttendanceDateYmd(tillDateStr)).dayEndUtc;

    const branchCondition = branchIds === null
        ? {}
        : { OR: branchIds.flatMap((branchId) => [{ branchId }, { branchId: null, user: { branchId } }]) };

    return { where: { date: { gte: from, lte: till }, ...branchCondition } };
}

export async function getAttendanceSummaryRows(filters: AttendanceFilters) {
    const { where } = buildAttendanceWhere(filters);

    const records = await prisma.attendance.findMany({
        where,
        select: {
            userId: true,
            status: true,
            branchId: true,
            user: {
                select: {
                    id: true, employeeId: true, firstName: true, lastName: true, role: true, branchId: true,
                    branch: { select: { name: true, code: true } },
                },
            },
            branch: { select: { name: true, code: true } },
        },
    });

    const employeeMap = new Map<string, { employeeName: string; branchName: string; present: number; absent: number; halfDay: number; fullDay: number }>();

    for (const record of records) {
        if (!employeeMap.has(record.userId)) {
            const branch = record.branch || record.user.branch;
            employeeMap.set(record.userId, {
                employeeName: record.user.employeeId
                    ? `${record.user.employeeId} - ${record.user.firstName} ${record.user.lastName}`
                    : `${record.user.firstName} ${record.user.lastName}`,
                branchName: branch ? `${branch.code} - ${branch.name}` : 'Unassigned',
                present: 0, absent: 0, halfDay: 0, fullDay: 0,
            });
        }
        const summary = employeeMap.get(record.userId)!;
        if (record.status === 'PRESENT') {
            summary.present++;
            summary.fullDay++;
        } else if (record.status === 'HALF_DAY') {
            summary.halfDay++;
            summary.present++;
        } else if (record.status === 'ABSENT') {
            summary.absent++;
        }
    }

    return Array.from(employeeMap.values()).sort((a, b) => a.employeeName.localeCompare(b.employeeName));
}

// ── Attendance Detailed ──────────────────────────────────────────

export async function getAttendanceDetailedRows(filters: AttendanceFilters) {
    const { where } = buildAttendanceWhere(filters);

    const records = await prisma.attendance.findMany({
        where,
        include: {
            user: {
                select: {
                    id: true,
                    employeeId: true,
                    firstName: true,
                    lastName: true,
                    role: true,
                    branch: { select: { name: true, code: true } },
                    shift: { select: { name: true, shiftStart: true, shiftEnd: true } },
                },
            },
            branch: { select: { name: true, code: true } },
        },
        orderBy: [{ date: 'desc' }, { user: { firstName: 'asc' } }],
    });

    return records.map((record) => {
        const branch = record.branch || record.user.branch;
        return {
            id: record.id,
            attendanceDate: record.date.toISOString(),
            branchName: branch ? `${branch.code} - ${branch.name}` : 'Unassigned',
            employeeName: record.user.employeeId
                ? `${record.user.employeeId} - ${record.user.firstName} ${record.user.lastName}`
                : `${record.user.firstName} ${record.user.lastName}`,
            shift: record.user.shift ? `${record.user.shift.name} (${record.user.shift.shiftStart} - ${record.user.shift.shiftEnd})` : 'Default',
            attendance: record.status,
            checkIn: record.checkIn ? record.checkIn.toISOString() : null,
            checkOut: record.checkOut ? record.checkOut.toISOString() : null,
        };
    });
}

// ── Dropouts ──────────────────────────────────────────────────────

export type DropoutsFilters = {
    fromDate: string;
    toDate: string;
    branchIds: string[] | null;
    centerId?: string | null;
};

export async function getDropoutsRows(filters: DropoutsFilters) {
    const fromDate = startOfDay(new Date(filters.fromDate));
    const tillDate = endOfDay(new Date(filters.toDate));

    const clients = await prisma.client.findMany({
        where: {
            isActive: false,
            inactiveDate: { gte: fromDate, lte: tillDate },
            ...(filters.branchIds ? { center: { branchId: { in: filters.branchIds } } } : {}),
            ...(filters.centerId && filters.centerId !== 'all' ? { centerId: filters.centerId } : {}),
        },
        include: {
            center: { include: { fdo: true } },
            loanApplications: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
        orderBy: { createdAt: 'desc' },
    });
    const contactOf = await getMemberContacts({
        clientIds: clients.map((c) => c.id),
        loanIds: clients.map((c) => c.loanApplications[0]?.id),
    });

    return clients.map((client) => {
        const lastLoan = client.loanApplications[0];
        return {
            centerId: client.center?.code || 'N/A',
            centerName: client.center?.name || 'N/A',
            clientId: client.clientId,
            hasLoan: client.loanApplications.length > 0,
            clientName: `${client.firstName} ${client.lastName}`.trim(),
            joinedDate: client.createdAt.toISOString(),
            lastLoanDisbursedDate: lastLoan?.disbursedLevel1At?.toISOString() || null,
            loanAc: lastLoan?.loanNumber || 'N/A',
            lastLoanClosedDate: (lastLoan?.closedDate || lastLoan?.lastPaymentDate)?.toISOString() || null,
            inactiveDate: client.inactiveDate?.toISOString() || null,
            reason: client.dropoutReason || client.rejectionReason || 'N/A',
            fdoName: client.center?.fdo ? `${client.center.fdo.firstName} ${client.center.fdo.lastName}` : 'N/A',
            ...contactOf(client.id, lastLoan?.id),
        };
    });
}

// ── Double Clients ────────────────────────────────────────────────

export type DoubleClientsFilters = {
    branchIds: string[] | null;
    centerId?: string | null;
    idType?: string | null; // SMART_CARD_NO | PAN_NO | VOTER_ID_NO | OTHER_ID_NO | MOBILE_NO
};

const DOUBLE_CLIENT_FIELD_MAP: Record<string, string> = {
    SMART_CARD_NO: 'smartCardNo',
    PAN_NO: 'pancardNo',
    VOTER_ID_NO: 'votersIdNo',
    OTHER_ID_NO: 'otherIdNo',
    MOBILE_NO: 'mobileNumber',
};

export async function getDoubleClientsRows(filters: DoubleClientsFilters) {
    const fieldName = DOUBLE_CLIENT_FIELD_MAP[filters.idType || 'SMART_CARD_NO'];
    if (!fieldName) throw new Error('Invalid selection type');

    const branchScope = filters.branchIds
        ? { center: { branchId: { in: filters.branchIds }, ...(filters.centerId ? { id: filters.centerId } : {}) } }
        : filters.centerId ? { center: { id: filters.centerId } } : {};

    const duplicates = await prisma.client.groupBy({
        by: [fieldName as any],
        where: { [fieldName]: { not: null }, isActive: true, ...branchScope },
        _count: { [fieldName]: true },
        having: { [fieldName]: { _count: { gt: 1 } } },
    });

    if (duplicates.length === 0) return [];

    const duplicateValues = duplicates.map((d: any) => d[fieldName]);

    const clients = await prisma.client.findMany({
        where: { [fieldName]: { in: duplicateValues }, isActive: true, ...branchScope },
        select: {
            id: true, clientId: true, firstName: true, lastName: true,
            smartCardNo: true, pancardNo: true, votersIdNo: true, otherIdNo: true, mobileNumber: true,
            loanApplications: {
                where: { disbursementStatus: 'DISBURSED', isActive: true },
                select: { loanNumber: true, amount: true, disbursedLevel1At: true, principalPaid: true, interestPaid: true },
            },
        },
        orderBy: { [fieldName]: 'asc' },
    });
    const contactOf = await getMemberContacts({ clientIds: clients.map((c) => c.id) });

    return clients.map((client, index) => {
        const activeLoan = client.loanApplications[0] || null;
        return {
            id: client.id,
            slNo: index + 1,
            hasLoan: !!activeLoan,
            clientName: `${client.clientId} - ${client.firstName} ${client.lastName}`.trim(),
            smartCardNo: client.smartCardNo || 'N/A',
            pancardNo: client.pancardNo || 'N/A',
            votersIdNo: client.votersIdNo || 'N/A',
            otherIdNo: client.otherIdNo || 'N/A',
            mobileNo: client.mobileNumber || 'N/A',
            loanAcNo: activeLoan ? activeLoan.loanNumber : 'No Active Loan',
            disbursalDate: activeLoan?.disbursedLevel1At ? activeLoan.disbursedLevel1At.toISOString() : null,
            loanBalance: activeLoan ? Number(activeLoan.amount) - Number(activeLoan.principalPaid) : 0,
            matchValue: (client as any)[fieldName],
            ...contactOf(client.id),
        };
    });
}

// ── Balance Information ──────────────────────────────────────────

export type BalanceInformationFilters = {
    centerId: string;
    asOnDate: string;
};

export async function getBalanceInformationRows(filters: BalanceInformationFilters) {
    const asOnDate = endOfDay(new Date(filters.asOnDate));
    const startOfAsOnDate = new Date(filters.asOnDate);
    startOfAsOnDate.setHours(0, 0, 0, 0);

    const loans = await prisma.loan.findMany({
        where: {
            centerId: filters.centerId,
            disbursementStatus: 'DISBURSED',
            isActive: true,
            disbursedLevel1At: { lte: asOnDate },
        },
        include: {
            client: { select: { id: true, firstName: true, lastName: true, mobileNumber: true, clientId: true } },
            center: {
                select: {
                    name: true, code: true, meetingDay: true,
                    fdo: { select: { firstName: true, lastName: true, id: true } },
                },
            },
            branch: { select: { name: true, code: true } },
            schedules: { orderBy: { installmentNo: 'asc' } },
        },
    });
    const contactOf = await getMemberContacts({ clientIds: loans.map((l) => l.client.id), loanIds: loans.map((l) => l.id) });

    return loans.map((loan) => {
        let osPrinciple = Number(loan.amount);
        let osInterest = loan.schedules.reduce((acc, s) => acc + Number(s.interestDue), 0);
        let arrearPri = 0, arrearInt = 0;

        for (const schedule of loan.schedules) {
            const dueDate = new Date(schedule.dueDate);
            const paidAt = schedule.paidAt ? new Date(schedule.paidAt) : null;
            const principalPaidByDate = (paidAt && paidAt <= asOnDate) ? Number(schedule.principalPaid) : 0;
            const interestPaidByDate = (paidAt && paidAt <= asOnDate) ? Number(schedule.interestPaid) : 0;

            osPrinciple -= principalPaidByDate;
            osInterest -= interestPaidByDate;

            if (dueDate < startOfAsOnDate) {
                const unpaidPri = Number(schedule.principalDue) - principalPaidByDate;
                const unpaidInt = Number(schedule.interestDue) - interestPaidByDate;
                if (unpaidPri > 0) arrearPri += unpaidPri;
                if (unpaidInt > 0) arrearInt += unpaidInt;
            }
        }

        return {
            branchName: `${loan.branch.code} - ${loan.branch.name}`,
            centerName: `${loan.center.code} - ${loan.center.name}`,
            fdo: loan.center.fdo ? `${loan.center.fdo.firstName} ${loan.center.fdo.lastName}` : 'Unassigned',
            meetingDay: loan.center.meetingDay || 'N/A',
            clientName: `${loan.client.clientId} - ${loan.client.firstName} ${loan.client.lastName}`,
            accountId: loan.loanNumber,
            osPrinciple: Math.round(osPrinciple),
            osInterest: Math.round(osInterest),
            arrearPri: Math.round(arrearPri),
            arrearInt: Math.round(arrearInt),
            mobile: loan.client.mobileNumber || 'N/A',
            ...contactOf(loan.client.id, loan.id),
        };
    });
}

export { getPersonLabel };
