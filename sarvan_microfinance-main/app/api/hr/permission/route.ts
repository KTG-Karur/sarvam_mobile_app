import { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse, withAuth } from '@/app/lib/api-utils';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';
import { requireEmployeeAccess, isUserContext, getUserContext } from '@/app/lib/permissions/guards';
import { describePendingApprovals } from '@/app/lib/approval/record-approval';
import { resolvePeriod } from '@/app/lib/period-resolver';

export async function OPTIONS() {
    return handleCorsPreflight();
}

// GET /api/hr/permission — own history by default, or a team-wide view
// (branch-scoped) when ?scope=team is passed, or a single employee's history
// via ?employeeId=.
// Optional date filter (IST), same as GET /api/hr/leave: ?period=TODAY|THIS_WEEK|
// THIS_MONTH|THIS_YEAR|CUSTOM, or ?fromDate=&tillDate= (treated as CUSTOM). A permission
// is a single-day request, so it is returned when its date falls inside the range.
// No filter params = unchanged behaviour (full history).
export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const scope = searchParams.get('scope');
            const employeeId = searchParams.get('employeeId');
            const periodParam = searchParams.get('period');
            const fromDateParam = searchParams.get('fromDate');
            const tillDateParam = searchParams.get('tillDate');

            let dateFilter: Prisma.PermissionRequestWhereInput = {};
            if (periodParam || fromDateParam || tillDateParam) {
                let resolved;
                try {
                    resolved = resolvePeriod({
                        period: periodParam || 'CUSTOM',
                        fromDate: fromDateParam,
                        tillDate: tillDateParam,
                    });
                } catch (e: any) {
                    return errorResponse(e.message || 'Invalid period', 400);
                }
                dateFilter = { date: { gte: resolved.fromDateUtc, lt: resolved.tillDateExclusiveUtc } };
            }

            let where: Prisma.PermissionRequestWhereInput = { employeeId: user.userId };
            if (employeeId && employeeId !== user.userId) {
                const ctx = await requireEmployeeAccess(req, employeeId);
                if (!isUserContext(ctx)) return ctx;
                where = { employeeId };
            } else if (employeeId) {
                where = { employeeId };
            } else if (scope === 'team') {
                const permittedBranchIds = await getPermittedBranchIds(user);
                where = permittedBranchIds ? { employee: { branchId: { in: permittedBranchIds } } } : {};
            }

            const requests = await prisma.permissionRequest.findMany({
                where: { AND: [where, dateFilter] },
                include: {
                    employee: { select: { id: true, firstName: true, lastName: true, employeeId: true, branchId: true } },
                    permissionType: { select: { id: true, permissionType: true } },
                    approvedBy: { select: { id: true, firstName: true, lastName: true } },
                },
                orderBy: { appliedAt: 'desc' },
            });

            const viewer = await getUserContext(req);
            const approvals = viewer
                ? await describePendingApprovals(
                    'hr-permission',
                    'PermissionRequest',
                    requests.filter((r) => r.status === 'PENDING').map((r) => ({ id: r.id, branchId: r.employee.branchId })),
                    viewer
                )
                : new Map();

            return successResponse(
                requests.map((r) => ({ ...r, approval: approvals.get(r.id) ?? null })),
                'Permission requests fetched successfully'
            );
        } catch (error: unknown) {
            console.error('Error fetching permission requests:', error);
            const message = error instanceof Error ? error.message : 'Failed to fetch permission requests';
            return errorResponse(message, 500);
        }
    })(request);
}
