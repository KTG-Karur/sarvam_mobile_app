import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse, withAuth } from '@/app/lib/api-utils';
import { resolvePeriod } from '@/app/lib/period-resolver';
import { resolveReportEmployees, parsePaging, pageMeta, istDay, employeeLabel } from '@/app/lib/hr-report-scope';

export async function OPTIONS() {
    return handleCorsPreflight();
}

// GET /api/hr/reports/permission-detail — the record-level ledger behind permission-summary: one
// row per APPROVED permission taken. Same filters as the summary (employeeId, branchId, role,
// departmentId, designationId, permissionTypeId, period / fromDate / tillDate), plus
// ?page, ?pageSize, ?order. The rows' count and hours add up to permission-summary's totals.
// For every status (pending / rejected / cancelled) use GET /api/hr/permission.
export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const params = new URL(req.url).searchParams;
            const permissionTypeId = params.get('permissionTypeId');
            const period = resolvePeriod({ period: params.get('period'), fromDate: params.get('fromDate'), tillDate: params.get('tillDate') });

            const scope = await resolveReportEmployees(user, params);
            if (scope instanceof NextResponse) return scope;
            const { employees, employeeMode } = scope;
            const { page, pageSize, skip, order } = parsePaging(params);

            const where = {
                employeeId: { in: employees.map((e) => e.id) },
                status: 'APPROVED' as const,
                date: { gte: period.fromDateUtc, lt: period.tillDateExclusiveUtc },
                ...(permissionTypeId ? { permissionTypeId } : {}),
            };
            const byId = new Map(employees.map((e) => [e.id, e]));

            const [total, rows] = employees.length
                ? await prisma.$transaction([
                    prisma.permissionRequest.count({ where }),
                    prisma.permissionRequest.findMany({
                        where,
                        // employeeId + id are tie-breakers so paging is stable (see attendance-detail).
                        orderBy: [{ date: order }, { fromTime: 'asc' }, { employeeId: 'asc' }, { id: 'asc' }],
                        skip,
                        take: pageSize,
                        select: {
                            id: true, employeeId: true, date: true, fromTime: true, toTime: true, hours: true, reason: true, status: true,
                            approvedAt: true,
                            permissionType: { select: { permissionType: true } },
                            approvedBy: { select: { firstName: true, lastName: true } },
                        },
                    }),
                ])
                : [0, []];

            const records = rows.map((r) => {
                const e = byId.get(r.employeeId)!;
                return {
                    id: r.id,
                    ...istDay(r.date),
                    employeeId: e.employeeId,
                    employeeName: employeeLabel(e),
                    role: e.role,
                    branch: e.branch ? `${e.branch.code} - ${e.branch.name}` : null,
                    permissionType: r.permissionType.permissionType,
                    fromTime: r.fromTime,
                    toTime: r.toTime,
                    hours: Number(r.hours),
                    reason: r.reason,
                    status: r.status,
                    approvedBy: r.approvedBy ? employeeLabel(r.approvedBy) : null,
                    approvedAt: r.approvedAt ? r.approvedAt.toISOString() : null,
                };
            });

            return successResponse({
                period: { type: period.type, fromDate: period.fromDateStr, tillDate: period.tillDateStr },
                ...(employeeMode ? { employee: { employeeId: employees[0].employeeId, employeeName: employeeLabel(employees[0]) } } : { totalEmployees: employees.length }),
                ...pageMeta(total, page, pageSize),
                records,
            }, 'Permission detail fetched successfully');
        } catch (error: any) {
            console.error('Error fetching permission detail:', error);
            const isValidation = /period|fromDate|tillDate/.test(error.message || '');
            return errorResponse(error.message || 'Failed to fetch permission detail', isValidation ? 400 : 500);
        }
    })(request);
}
