import { Prisma } from '@prisma/client';
import { buildMemberSearchWhere, memberContactClientSelect, memberContactFromClient } from '@/app/lib/reports/member-contacts';

/**
 * Shared between app/api/reports/client/meeting-attendance/route.ts (the live
 * report page — paginated) and app/lib/reports/report-registry.ts's async
 * export adapter (unpaginated) so the two can never silently diverge on what
 * counts as "matching" data — same where clause, same field mapping.
 */

export type MeetingAttendanceFilters = {
    fromDate: string; // YYYY-MM-DD
    toDate: string; // YYYY-MM-DD
    branchIds: string[] | null; // null = no branch restriction
    centerId?: string | null; // null/undefined/'all' = no center restriction
    search?: string | null; // member name / ID / Aadhaar / mobile / co-applicant mobile
};

export function buildMeetingAttendanceWhere(filters: MeetingAttendanceFilters): Prisma.ClientAttendanceWhereInput {
    const from = new Date(filters.fromDate);
    from.setHours(0, 0, 0, 0);
    const to = new Date(filters.toDate);
    to.setHours(23, 59, 59, 999);

    const where: Prisma.ClientAttendanceWhereInput = {
        attendanceDate: { gte: from, lte: to },
    };

    if (filters.centerId && filters.centerId !== 'all') {
        where.centerId = filters.centerId;
    }

    if (filters.branchIds && filters.branchIds.length > 0) {
        where.branchId = filters.branchIds.length === 1 ? filters.branchIds[0] : { in: filters.branchIds };
    }

    const memberSearch = buildMemberSearchWhere(filters.search);
    if (memberSearch) where.client = memberSearch;

    return where;
}

export const meetingAttendanceInclude = {
    client: {
        select: {
            clientId: true,
            firstName: true,
            lastName: true,
            phone: true,
            ...memberContactClientSelect,
            _count: { select: { loanApplications: true } },
        },
    },
    center: { select: { code: true, name: true } },
    createdBy: { select: { firstName: true, lastName: true } },
} satisfies Prisma.ClientAttendanceInclude;

export const meetingAttendanceOrderBy: Prisma.ClientAttendanceOrderByWithRelationInput[] = [
    { attendanceDate: 'desc' },
    { center: { name: 'asc' } },
    { client: { firstName: 'asc' } },
    { id: 'asc' },
];

export type MeetingAttendanceRecord = Prisma.ClientAttendanceGetPayload<{ include: typeof meetingAttendanceInclude }>;

export function mapMeetingAttendanceRecord(record: MeetingAttendanceRecord) {
    return {
        id: record.id,
        date: record.attendanceDate.toISOString(),
        centerCode: record.center.code,
        centerName: record.center.name,
        clientId: record.client.clientId,
        clientName: `${record.client.firstName} ${record.client.lastName}`,
        hasLoan: (record.client._count?.loanApplications ?? 0) > 0,
        phone: record.client.phone || 'N/A',
        isPresent: record.isPresent,
        markedBy: `${record.createdBy.firstName} ${record.createdBy.lastName}`,
        ...memberContactFromClient(record.client),
    };
}
