import { NextResponse } from 'next/server';
import { prisma } from '@/app/lib/db';
import { errorResponse } from '@/app/lib/api-utils';
import { getPermittedBranchIds, type BranchScopeUser } from '@/app/lib/permissions/branch-scope';
import { getKolkataCalendarYmd } from '@/app/lib/branch-lock';

export type ReportEmployee = {
    id: string;
    employeeId: string | null;
    firstName: string;
    lastName: string;
    role: string;
    branch: { code: string; name: string } | null;
};

/**
 * Employee scoping shared by the /api/hr/reports/*-detail routes — the same rules as the
 * *-summary routes: employeeId => that employee (404 if unknown, 403 unless it is the caller
 * or in a permitted branch); otherwise every active employee in the caller's permitted
 * branches, narrowed by branchId (never widened), departmentId, designationId and role.
 */
export async function resolveReportEmployees(
    user: BranchScopeUser,
    params: URLSearchParams,
): Promise<{ employees: ReportEmployee[]; employeeMode: boolean } | NextResponse> {
    const employeeId = params.get('employeeId');
    const branchIdParam = params.get('branchId') && params.get('branchId') !== 'all' ? params.get('branchId') : null;
    const departmentId = params.get('departmentId');
    const designationId = params.get('designationId');
    const roleParam = params.get('role');

    const permittedBranchIds = await getPermittedBranchIds(user);
    const select = {
        id: true, employeeId: true, firstName: true, lastName: true, role: true, branchId: true,
        branch: { select: { code: true, name: true } },
    } as const;

    if (employeeId) {
        const employee = await prisma.user.findUnique({ where: { id: employeeId }, select });
        if (!employee) return errorResponse('Employee not found', 404);
        const isSelf = employeeId === user.userId;
        if (!isSelf && permittedBranchIds && (!employee.branchId || !permittedBranchIds.includes(employee.branchId))) {
            return errorResponse('You do not have access to this employee', 403);
        }
        return { employees: [employee], employeeMode: true };
    }

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
        select,
        orderBy: { firstName: 'asc' },
    });
    return { employees, employeeMode: false };
}

/** ?page (1-based, default 1), ?pageSize (default 100, clamped to 1..500), ?order=asc|desc (default desc). */
export function parsePaging(params: URLSearchParams) {
    const page = Math.max(1, Math.floor(Number(params.get('page'))) || 1);
    const pageSize = Math.min(500, Math.max(1, Math.floor(Number(params.get('pageSize'))) || 100));
    const order: 'asc' | 'desc' = (params.get('order') || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
    return { page, pageSize, skip: (page - 1) * pageSize, order };
}

export function pageMeta(total: number, page: number, pageSize: number) {
    return { totalRecords: total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Stored day-start instant -> IST calendar date + weekday name. */
export function istDay(date: Date): { date: string; dayOfWeek: string } {
    const ymd = getKolkataCalendarYmd(date);
    const dayOfWeek = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'Asia/Kolkata' }).format(new Date(`${ymd}T12:00:00+05:30`));
    return { date: ymd, dayOfWeek };
}

export function employeeLabel(e: { firstName: string; lastName: string }) {
    return `${e.firstName} ${e.lastName}`.trim();
}
