import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { successResponse, errorResponse, withAuth, handleCorsPreflight } from '@/app/lib/api-utils';
import { getPermittedBranchIds, resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';
import { cachedMasterData, stableParamsKey } from '@/app/lib/cache/master-data-cache';

// Employees change more often than the other master data (joins, transfers,
// role/status changes) — most write sites are covered by an explicit
// bumpMasterDataVersion('employees') call, but the User model has ~25 write
// sites across the app (attendance, payroll, HR flows, etc.), so a short TTL
// is the primary safety net here rather than chasing every one of them.
const EMPLOYEES_CACHE_TTL_SECONDS = 3 * 60;

export async function OPTIONS() {
    return handleCorsPreflight();
}

export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const branchScoped = searchParams.get('branchScoped') === 'true';
            const roleFilter = searchParams.get('role');
            const requestedBranchId = searchParams.get('branchId');

            // Multi-tenancy boundary — non-admin roles are ALWAYS scoped to their
            // own branch (or an AM's assigned branches), regardless of the
            // `branchScoped` flag. That flag only lets ADMIN opt into narrowing
            // to their currently active branch; omitting it must never leak
            // every employee company-wide to a BM/FDO/AM.
            // `branchId` (an explicit report filter dropdown selection) is honored
            // via resolveScopedBranchIds, which narrows within — never escapes —
            // whatever the caller's role already permits.
            let branchWhere: { branchId?: string | { in: string[] } } = {};
            if (user.role !== 'ADMIN') {
                const permittedBranchIds = await resolveScopedBranchIds(user, requestedBranchId);
                if (!permittedBranchIds || permittedBranchIds.length === 0) {
                    return successResponse([], 'No employees found');
                }
                branchWhere = permittedBranchIds.length === 1
                    ? { branchId: permittedBranchIds[0] }
                    : { branchId: { in: permittedBranchIds } };
            } else if (branchScoped || requestedBranchId) {
                const permittedBranchIds = requestedBranchId
                    ? await resolveScopedBranchIds(user, requestedBranchId)
                    : await getPermittedBranchIds(user);
                if (permittedBranchIds && permittedBranchIds.length > 0) {
                    branchWhere = permittedBranchIds.length === 1
                        ? { branchId: permittedBranchIds[0] }
                        : { branchId: { in: permittedBranchIds } };
                }
            }

            const where = {
                isActive: true,
                ...branchWhere,
                ...(roleFilter ? { role: roleFilter as never } : {}),
            };

            // Keyed on the fully-resolved `where` (post role-scoping), same safety
            // rule as centers' minimal cache — two callers only share an entry when
            // their effective filter is identical, so this can never leak another
            // branch/role's employees.
            const employees = await cachedMasterData(
                'employees',
                stableParamsKey(where as Record<string, unknown>),
                () => prisma.user.findMany({
                    where,
                    select: {
                        id: true,
                        employeeId: true,
                        firstName: true,
                        lastName: true,
                        role: true,
                    },
                    orderBy: { firstName: 'asc' },
                }),
                EMPLOYEES_CACHE_TTL_SECONDS
            );

            const formattedEmployees = employees.map(emp => ({
                id: emp.id,
                name: `${emp.firstName} ${emp.lastName} (${emp.role})`.toUpperCase(),
                employeeId: emp.employeeId,
                role: emp.role,
            }));

            return successResponse(formattedEmployees, 'Employees fetched successfully');
        } catch (error: any) {
            console.error('[Employees GET] Error:', error);
            return successResponse([], 'No employees found');
        }
    })(request);
}
