import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse, withAuth } from '@/app/lib/api-utils';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';
import { resolvePeriod } from '@/app/lib/period-resolver';
import { resolveLopLeaveType, getRemainingLeaveBalancesBatch } from '@/app/lib/attendance-leave-permission';

export async function OPTIONS() {
    return handleCorsPreflight();
}

// "Remaining" is only meaningful within a single calendar month (Fixed
// Monthly Quota, no carryover) — see attendance-hr/plan-attendance-leave-permission-analytics.md §4.
// For THIS_WEEK it reflects the month the week is in (today's month).
function remainingIsMeaningful(periodType: string): boolean {
    return periodType === 'TODAY' || periodType === 'THIS_WEEK' || periodType === 'THIS_MONTH';
}

// GET /api/hr/reports/leave-summary — employee-wise (?employeeId=) or overall
// (RBAC-scoped) leave totals (taken, LOP, half-day) for a resolved period,
// plus leave-type-wise breakdown. Days are counted from Attendance rows
// (0.5 for isHalfDayLeave, else 1) — the same weighting as
// getRemainingLeaveBalance() — never from LeaveApplication.numberOfDays.
// Only APPROVED leave ever writes Attendance rows, so pending/rejected/
// cancelled leave is excluded by construction.
export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const employeeId = searchParams.get('employeeId');
            const leaveTypeIdFilter = searchParams.get('leaveTypeId');
            const branchIdParam = searchParams.get('branchId') !== 'all' ? searchParams.get('branchId') : null;
            const departmentId = searchParams.get('departmentId');
            const designationId = searchParams.get('designationId');
            const roleParam = searchParams.get('role');

            const period = resolvePeriod({
                period: searchParams.get('period'),
                fromDate: searchParams.get('fromDate'),
                tillDate: searchParams.get('tillDate'),
            });
            const dateRange = { gte: period.fromDateUtc, lt: period.tillDateExclusiveUtc };

            const permittedBranchIds = await getPermittedBranchIds(user);

            let scopedEmployees: { id: string; employeeId: string | null; firstName: string; lastName: string }[];
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
                scopedEmployees = [employee];
            } else {
                const effectiveBranchIds = permittedBranchIds
                    ? (branchIdParam && permittedBranchIds.includes(branchIdParam) ? [branchIdParam] : permittedBranchIds)
                    : (branchIdParam ? [branchIdParam] : null);
                scopedEmployees = await prisma.user.findMany({
                    where: {
                        isActive: true,
                        ...(effectiveBranchIds ? { branchId: { in: effectiveBranchIds } } : {}),
                        ...(departmentId ? { departmentId } : {}),
                        ...(designationId ? { designationId } : {}),
                        ...(roleParam ? { role: { equals: roleParam, mode: 'insensitive' as const } } : {}),
                    },
                    select: { id: true, employeeId: true, firstName: true, lastName: true },
                });
            }
            const employeeIds = scopedEmployees.map((e) => e.id);

            const [lopType, leaveTypes, leaveRows, presentDays, absentDays] = await Promise.all([
                resolveLopLeaveType(),
                prisma.leaveType.findMany({
                    where: { isActive: true, ...(leaveTypeIdFilter ? { id: leaveTypeIdFilter } : {}) },
                    select: { id: true, leaveType: true },
                }),
                employeeIds.length
                    ? prisma.attendance.findMany({
                        where: {
                            userId: { in: employeeIds },
                            leaveTypeId: leaveTypeIdFilter ? leaveTypeIdFilter : { not: null },
                            date: dateRange,
                        },
                        select: { userId: true, leaveTypeId: true, isHalfDayLeave: true },
                    })
                    : Promise.resolve([]),
                employeeIds.length
                    ? prisma.attendance.count({ where: { userId: { in: employeeIds }, status: { in: ['PRESENT', 'HALF_DAY'] }, date: dateRange } })
                    : Promise.resolve(0),
                // Same definition as attendance-summary: ABSENT with no leave attached (leave-covered absence is counted under leave, not here).
                employeeIds.length
                    ? prisma.attendance.count({ where: { userId: { in: employeeIds }, status: 'ABSENT', leaveTypeId: null, date: dateRange } })
                    : Promise.resolve(0),
            ]);

            let totalLeaveDays = 0, totalLOPDays = 0, totalHalfDayLeave = 0;
            const takenByType = new Map<string, { taken: number; lop: number }>();
            for (const row of leaveRows) {
                const weight = row.isHalfDayLeave ? 0.5 : 1;
                const isLop = !!(lopType && row.leaveTypeId === lopType.id);
                totalLeaveDays += weight;
                if (row.isHalfDayLeave) totalHalfDayLeave += weight;
                if (isLop) totalLOPDays += weight;
                const entry = takenByType.get(row.leaveTypeId!) ?? { taken: 0, lop: 0 };
                entry.taken += weight;
                if (isLop) entry.lop += weight;
                takenByType.set(row.leaveTypeId!, entry);
            }

            // One batched query for every employee×leave-type remaining balance — each employee's
            // own quota is summed (never one quota × headcount). LOP has no quota, so it's skipped.
            const showRemaining = remainingIsMeaningful(period.type);
            const remainingByEmployeeType = new Map<string, number>();
            if (showRemaining && employeeIds.length) {
                const quotaTypes = leaveTypes.filter((lt) => lt.id !== lopType?.id);
                const pairs = employeeIds.flatMap((eid) => quotaTypes.map((lt) => ({ employeeId: eid, leaveTypeId: lt.id, date: new Date() })));
                const batch = await getRemainingLeaveBalancesBatch(pairs);
                for (const p of pairs) remainingByEmployeeType.set(`${p.employeeId}:${p.leaveTypeId}`, batch.get(`${p.employeeId}:${p.leaveTypeId}`) ?? 0);
            }
            const remainingForType = (leaveTypeId: string): number | null => {
                if (!showRemaining || leaveTypeId === lopType?.id) return null;
                return employeeIds.reduce((sum, eid) => sum + (remainingByEmployeeType.get(`${eid}:${leaveTypeId}`) ?? 0), 0);
            };
            const totalRemaining = showRemaining
                ? leaveTypes.reduce((sum, lt) => sum + (remainingForType(lt.id) ?? 0), 0)
                : null;

            const periodBlock = { type: period.type, fromDate: period.fromDateStr, tillDate: period.tillDateStr };

            if (employeeId) {
                const e = scopedEmployees[0];
                return successResponse({
                    employeeId: e.employeeId,
                    employeeName: `${e.firstName} ${e.lastName}`,
                    period: periodBlock,
                    leave: {
                        totalLeaveDays,
                        remainingLeaveDays: totalRemaining,
                        totalAbsentDays: absentDays,
                        totalPresentDays: presentDays,
                        totalLOPDays,
                        totalHalfDayLeave,
                    },
                    leaveTypes: leaveTypes.map((lt) => ({
                        leaveType: lt.leaveType,
                        taken: takenByType.get(lt.id)?.taken ?? 0,
                        remaining: remainingForType(lt.id),
                    })),
                }, 'Leave summary fetched successfully');
            }

            return successResponse({
                period: periodBlock,
                totalEmployees: scopedEmployees.length,
                leave: {
                    totalLeaveDays,
                    totalRemainingLeaveDays: totalRemaining,
                    totalPresentDays: presentDays,
                    totalAbsentDays: absentDays,
                    totalLOPDays,
                    totalHalfDayLeaves: totalHalfDayLeave,
                },
                leaveTypes: leaveTypes.map((lt) => ({
                    leaveType: lt.leaveType,
                    totalTaken: takenByType.get(lt.id)?.taken ?? 0,
                    totalLOP: takenByType.get(lt.id)?.lop ?? 0,
                })),
            }, 'Leave overview fetched successfully');
        } catch (error: any) {
            console.error('Error fetching leave summary:', error);
            const isValidation = /period|fromDate|tillDate/.test(error.message || '');
            return errorResponse(error.message || 'Failed to fetch leave summary', isValidation ? 400 : 500);
        }
    })(request);
}
