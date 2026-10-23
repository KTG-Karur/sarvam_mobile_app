import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse, withAuth } from '@/app/lib/api-utils';
import { resolvePeriod } from '@/app/lib/period-resolver';
import { resolveLopLeaveType } from '@/app/lib/attendance-leave-permission';
import { resolveReportEmployees, parsePaging, pageMeta, istDay, employeeLabel } from '@/app/lib/hr-report-scope';

export async function OPTIONS() {
    return handleCorsPreflight();
}

// GET /api/hr/reports/leave-detail — the record-level ledger behind leave-summary: one row per
// approved leave DAY (a half-day counts 0.5). Same filters as the summary (employeeId, branchId,
// role, departmentId, designationId, leaveTypeId, period / fromDate / tillDate), plus
// ?page, ?pageSize, ?order. Built from the same Attendance rows the summary counts, so the
// `days` here add up exactly to leave-summary's totalLeaveDays (and `isLop` days to totalLOPDays).
// For the applications themselves (reason, approver, status) use GET /api/hr/leave.
export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const params = new URL(req.url).searchParams;
            const leaveTypeId = params.get('leaveTypeId');
            const period = resolvePeriod({ period: params.get('period'), fromDate: params.get('fromDate'), tillDate: params.get('tillDate') });

            const scope = await resolveReportEmployees(user, params);
            if (scope instanceof NextResponse) return scope;
            const { employees, employeeMode } = scope;
            const { page, pageSize, skip, order } = parsePaging(params);

            const where = {
                userId: { in: employees.map((e) => e.id) },
                leaveTypeId: leaveTypeId ? leaveTypeId : { not: null },
                date: { gte: period.fromDateUtc, lt: period.tillDateExclusiveUtc },
            };
            const byId = new Map(employees.map((e) => [e.id, e]));
            const lopType = await resolveLopLeaveType();

            const [total, rows] = employees.length
                ? await prisma.$transaction([
                    prisma.attendance.count({ where }),
                    prisma.attendance.findMany({
                        where,
                        // userId + id are tie-breakers so paging is stable (see attendance-detail).
                        orderBy: [{ date: order }, { user: { firstName: 'asc' } }, { userId: 'asc' }, { id: 'asc' }],
                        skip,
                        take: pageSize,
                        select: {
                            id: true, userId: true, date: true, status: true, leaveTypeId: true, isHalfDayLeave: true,
                            leaveType: { select: { leaveType: true } },
                        },
                    }),
                ])
                : [0, []];

            const records = rows.map((r) => {
                const e = byId.get(r.userId)!;
                return {
                    id: r.id,
                    ...istDay(r.date),
                    employeeId: e.employeeId,
                    employeeName: employeeLabel(e),
                    role: e.role,
                    branch: e.branch ? `${e.branch.code} - ${e.branch.name}` : null,
                    leaveType: r.leaveType?.leaveType ?? null,
                    days: r.isHalfDayLeave ? 0.5 : 1,
                    isHalfDay: r.isHalfDayLeave,
                    isLop: !!(lopType && r.leaveTypeId === lopType.id),
                    attendanceStatus: r.status,
                };
            });

            return successResponse({
                period: { type: period.type, fromDate: period.fromDateStr, tillDate: period.tillDateStr },
                ...(employeeMode ? { employee: { employeeId: employees[0].employeeId, employeeName: employeeLabel(employees[0]) } } : { totalEmployees: employees.length }),
                ...pageMeta(total, page, pageSize),
                records,
            }, 'Leave detail fetched successfully');
        } catch (error: any) {
            console.error('Error fetching leave detail:', error);
            const isValidation = /period|fromDate|tillDate/.test(error.message || '');
            return errorResponse(error.message || 'Failed to fetch leave detail', isValidation ? 400 : 500);
        }
    })(request);
}
