import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse, withAuth } from '@/app/lib/api-utils';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';
import { resolvePeriod } from '@/app/lib/period-resolver';

export async function OPTIONS() {
    return handleCorsPreflight();
}

type Bucket = { presentDays: number; halfDays: number; absentDays: number; holidays: number };

function emptyBucket(): Bucket {
    return { presentDays: 0, halfDays: 0, absentDays: 0, holidays: 0 };
}

function tally(bucket: Bucket, row: { status: string; leaveTypeId: string | null; isHoliday: boolean }) {
    if (row.status === 'HOLIDAY' || row.isHoliday) bucket.holidays++;
    else if (row.status === 'PRESENT') bucket.presentDays++;
    else if (row.status === 'HALF_DAY') bucket.halfDays++;
    else if (row.status === 'ABSENT' && !row.leaveTypeId) bucket.absentDays++;
}

// GET /api/hr/reports/attendance-summary — employee-wise (?employeeId=) or
// overall (RBAC-scoped) attendance totals for a TODAY/THIS_WEEK/THIS_MONTH/
// THIS_YEAR/CUSTOM period. See attendance-hr/plan-attendance-leave-permission-analytics.md.
export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const employeeId = searchParams.get('employeeId');
            const branchIdParam = searchParams.get('branchId') !== 'all' ? searchParams.get('branchId') : null;
            const departmentId = searchParams.get('departmentId');
            const designationId = searchParams.get('designationId');
            const roleParam = searchParams.get('role');

            const period = resolvePeriod({
                period: searchParams.get('period'),
                fromDate: searchParams.get('fromDate'),
                tillDate: searchParams.get('tillDate'),
            });

            const permittedBranchIds = await getPermittedBranchIds(user);

            if (employeeId) {
                const employee = await prisma.user.findUnique({
                    where: { id: employeeId },
                    select: { id: true, employeeId: true, firstName: true, lastName: true, branchId: true },
                });
                if (!employee) return errorResponse('Employee not found', 404);

                const isSelf = employeeId === user.userId;
                if (!isSelf && permittedBranchIds && (!employee.branchId || !permittedBranchIds.includes(employee.branchId))) {
                    return errorResponse('You do not have access to this employee', 403);
                }

                const rows = await prisma.attendance.findMany({
                    where: { userId: employeeId, date: { gte: period.fromDateUtc, lt: period.tillDateExclusiveUtc } },
                    select: { status: true, leaveTypeId: true, isHoliday: true },
                });
                const bucket = emptyBucket();
                for (const row of rows) tally(bucket, row);

                return successResponse({
                    employeeId: employee.employeeId,
                    employeeName: `${employee.firstName} ${employee.lastName}`,
                    period: { type: period.type, fromDate: period.fromDateStr, tillDate: period.tillDateStr },
                    presentDays: bucket.presentDays,
                    halfDays: bucket.halfDays,
                    absentDays: bucket.absentDays,
                    holidays: bucket.holidays,
                }, 'Attendance summary fetched successfully');
            }

            // Overall mode — RBAC-scoped, never trust a raw branchId outside the caller's permitted set.
            const effectiveBranchIds = permittedBranchIds
                ? (branchIdParam && permittedBranchIds.includes(branchIdParam) ? [branchIdParam] : permittedBranchIds)
                : (branchIdParam ? [branchIdParam] : null);

            const employees = await prisma.user.findMany({
                where: {
                    isActive: true,
                    ...(effectiveBranchIds ? { branchId: { in: effectiveBranchIds } } : {}),
                    ...(departmentId ? { departmentId } : {}),
                    ...(designationId ? { designationId } : {}),
                    ...(roleParam ? { role: { equals: roleParam, mode: 'insensitive' as const } } : {}),
                },
                select: { id: true, employeeId: true, firstName: true, lastName: true },
            });
            const employeeIds = employees.map((e) => e.id);

            const rows = employeeIds.length
                ? await prisma.attendance.findMany({
                    where: { userId: { in: employeeIds }, date: { gte: period.fromDateUtc, lt: period.tillDateExclusiveUtc } },
                    select: { userId: true, status: true, leaveTypeId: true, isHoliday: true },
                })
                : [];

            const perEmployee = new Map<string, Bucket>();
            for (const e of employees) perEmployee.set(e.id, emptyBucket());
            const overall = emptyBucket();
            for (const row of rows) {
                const bucket = perEmployee.get(row.userId);
                if (bucket) tally(bucket, row);
                tally(overall, row);
            }

            return successResponse({
                period: { type: period.type, fromDate: period.fromDateStr, tillDate: period.tillDateStr },
                totalEmployees: employees.length,
                attendance: {
                    presentDays: overall.presentDays,
                    halfDays: overall.halfDays,
                    absentDays: overall.absentDays,
                    holidays: overall.holidays,
                },
                employees: employees.map((e) => {
                    const b = perEmployee.get(e.id)!;
                    return {
                        employeeId: e.employeeId,
                        employeeName: `${e.firstName} ${e.lastName}`,
                        presentDays: b.presentDays,
                        halfDays: b.halfDays,
                        absentDays: b.absentDays,
                        holidays: b.holidays,
                    };
                }),
            }, 'Attendance overview fetched successfully');
        } catch (error: any) {
            console.error('Error fetching attendance summary:', error);
            const isValidation = /period|fromDate|tillDate/.test(error.message || '');
            return errorResponse(error.message || 'Failed to fetch attendance summary', isValidation ? 400 : 500);
        }
    })(request);
}
