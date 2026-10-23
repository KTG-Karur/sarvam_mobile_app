import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse, withAuth } from '@/app/lib/api-utils';
import { resolvePeriod } from '@/app/lib/period-resolver';
import { resolveReportEmployees, parsePaging, pageMeta, istDay, employeeLabel } from '@/app/lib/hr-report-scope';

export async function OPTIONS() {
    return handleCorsPreflight();
}

// GET /api/hr/reports/attendance-detail — the record-level ledger behind attendance-summary:
// one row per employee per marked day in the period. Same filters as the summary
// (employeeId, branchId, role, departmentId, designationId, period / fromDate / tillDate),
// plus ?page, ?pageSize, ?order=asc|desc. Rows use the same status rules as the summary,
// so the counts of PRESENT / HALF_DAY / ABSENT rows here add up to the summary totals.
export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const params = new URL(req.url).searchParams;
            const period = resolvePeriod({ period: params.get('period'), fromDate: params.get('fromDate'), tillDate: params.get('tillDate') });

            const scope = await resolveReportEmployees(user, params);
            if (scope instanceof NextResponse) return scope;
            const { employees, employeeMode } = scope;
            const { page, pageSize, skip, order } = parsePaging(params);

            const where = {
                userId: { in: employees.map((e) => e.id) },
                date: { gte: period.fromDateUtc, lt: period.tillDateExclusiveUtc },
            };
            const byId = new Map(employees.map((e) => [e.id, e]));

            const [total, rows] = employees.length
                ? await prisma.$transaction([
                    prisma.attendance.count({ where }),
                    prisma.attendance.findMany({
                        where,
                        // userId + id are tie-breakers: without a total order, rows sharing a date and
                        // first name can repeat or vanish across page boundaries.
                        orderBy: [{ date: order }, { user: { firstName: 'asc' } }, { userId: 'asc' }, { id: 'asc' }],
                        skip,
                        take: pageSize,
                        select: {
                            id: true, userId: true, date: true, status: true, isHoliday: true, isHalfDayLeave: true,
                            checkIn: true, checkOut: true, workingHours: true,
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
                    status: r.status,
                    isHoliday: r.isHoliday,
                    checkIn: r.checkIn ? r.checkIn.toISOString() : null,
                    checkOut: r.checkOut ? r.checkOut.toISOString() : null,
                    workingHours: r.workingHours == null ? null : Number(r.workingHours),
                    leaveType: r.leaveType?.leaveType ?? null,
                    isHalfDayLeave: r.isHalfDayLeave,
                };
            });

            return successResponse({
                period: { type: period.type, fromDate: period.fromDateStr, tillDate: period.tillDateStr },
                ...(employeeMode ? { employee: { employeeId: employees[0].employeeId, employeeName: employeeLabel(employees[0]) } } : { totalEmployees: employees.length }),
                ...pageMeta(total, page, pageSize),
                records,
            }, 'Attendance detail fetched successfully');
        } catch (error: any) {
            console.error('Error fetching attendance detail:', error);
            const isValidation = /period|fromDate|tillDate/.test(error.message || '');
            return errorResponse(error.message || 'Failed to fetch attendance detail', isValidation ? 400 : 500);
        }
    })(request);
}
