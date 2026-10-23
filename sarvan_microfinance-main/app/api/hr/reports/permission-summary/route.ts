
import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse, withAuth } from '@/app/lib/api-utils';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';
import { resolvePeriod } from '@/app/lib/period-resolver';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// GET /api/hr/reports/permission-summary — employee-wise (?employeeId=) or
// overall (RBAC-scoped) count + hours of APPROVED permissions for a resolved
// period, with permission-type-wise breakdown. Pending/rejected/cancelled
// requests are never counted as "taken".
export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const employeeId = searchParams.get('employeeId');
            const permissionTypeId = searchParams.get('permissionTypeId');
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

            const requests = employeeIds.length
                ? await prisma.permissionRequest.findMany({
                    where: {
                        employeeId: { in: employeeIds },
                        status: 'APPROVED',
                        date: { gte: period.fromDateUtc, lt: period.tillDateExclusiveUtc },
                        ...(permissionTypeId ? { permissionTypeId } : {}),
                    },
                    select: { hours: true, permissionType: { select: { permissionType: true } } },
                })
                : [];

            let totalHours = 0;
            const byType = new Map<string, { permissionType: string; count: number; hours: number }>();
            for (const r of requests) {
                const hours = Number(r.hours);
                totalHours += hours;
                const name = r.permissionType.permissionType;
                const entry = byType.get(name) ?? { permissionType: name, count: 0, hours: 0 };
                entry.count++;
                entry.hours += hours;
                byType.set(name, entry);
            }
            const permissionTypes = Array.from(byType.values()).map((t) => ({ ...t, hours: round2(t.hours) }));
            const periodBlock = { type: period.type, fromDate: period.fromDateStr, tillDate: period.tillDateStr };

            if (employeeId) {
                const e = scopedEmployees[0];
                return successResponse({
                    employeeId: e.employeeId,
                    employeeName: `${e.firstName} ${e.lastName}`,
                    period: periodBlock,
                    permission: { totalPermissions: requests.length, totalPermissionHours: round2(totalHours) },
                    permissionTypes,
                }, 'Permission summary fetched successfully');
            }

            return successResponse({
                period: periodBlock,
                totalEmployees: scopedEmployees.length,
                totalPermissions: requests.length,
                totalPermissionHours: round2(totalHours),
                permissionTypes,
            }, 'Permission overview fetched successfully');
        } catch (error: any) {
            console.error('Error fetching permission summary:', error);
            const isValidation = /period|fromDate|tillDate/.test(error.message || '');
            return errorResponse(error.message || 'Failed to fetch permission summary', isValidation ? 400 : 500);
        }
    })(request);
}
