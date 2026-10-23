import { NextRequest } from 'next/server';
import { handleCorsPreflight, errorResponse, successResponse, withAuth } from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';
import {
    buildMeetingAttendanceWhere,
    meetingAttendanceInclude,
    meetingAttendanceOrderBy,
    mapMeetingAttendanceRecord,
} from '@/app/lib/reports/queries/meeting-attendance';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/reports/client/meeting-attendance
 * Query params: centerId, fromDate, tillDate
 */
export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const centerId = searchParams.get('centerId');
            const branchId = searchParams.get('branchId') || undefined;
            const fromDateStr = searchParams.get('fromDate');
            const tillDateStr = searchParams.get('tillDate');

            if (!fromDateStr || !tillDateStr) {
                return errorResponse('Date range is required', 400);
            }
            if (isNaN(new Date(fromDateStr).getTime()) || isNaN(new Date(tillDateStr).getTime())) {
                return errorResponse('Invalid date format', 400);
            }

            // Scope to the caller's permitted branch(es), narrowed by any requested branchId
            const scopedBranchIds = await resolveScopedBranchIds(user, branchId);

            const whereClause = buildMeetingAttendanceWhere({
                fromDate: fromDateStr,
                toDate: tillDateStr,
                branchIds: scopedBranchIds,
                centerId,
                search: searchParams.get('search'),
            });

            const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
            const pageSize = Math.min(5000, Math.max(1, parseInt(searchParams.get('pageSize') ?? '25', 10)));

            // Lightweight, unpaginated fetch used only for the summary counts + totalCount —
            // decoupled from the paginated detail rows below so the summary always reflects
            // the full filtered set, not just the current page.
            const summaryRows = await prisma.clientAttendance.findMany({
                where: whereClause,
                select: { centerId: true, attendanceDate: true, isPresent: true },
            });
            const totalMeetings = new Set(summaryRows.map(r => `${r.centerId}-${r.attendanceDate.toISOString().split('T')[0]}`)).size;
            const totalClients = summaryRows.length;
            const presentCount = summaryRows.filter(r => r.isPresent).length;
            const absentCount = totalClients - presentCount;
            const attendancePercentage = totalClients > 0 ? (presentCount / totalClients) * 100 : 0;

            // Fetch attendance data (current page only)
            const attendanceRecords = await prisma.clientAttendance.findMany({
                where: whereClause,
                include: meetingAttendanceInclude,
                orderBy: meetingAttendanceOrderBy,
                skip: (page - 1) * pageSize,
                take: pageSize,
            });

            const formattedData = attendanceRecords.map(mapMeetingAttendanceRecord);

            return successResponse(
                {
                    data: formattedData,
                    summary: {
                        totalMeetings,
                        totalClients,
                        presentCount,
                        absentCount,
                        attendancePercentage: Number(attendancePercentage.toFixed(2))
                    },
                    totalCount: totalClients,
                    totalPages: Math.ceil(totalClients / pageSize),
                    page,
                    pageSize,
                },
                'Attendance data fetched successfully'
            );

        } catch (error) {
            console.error('[Meeting Attendance API] Error:', error);
            return errorResponse('Failed to fetch attendance data', 500);
        }
    })(request);
}
