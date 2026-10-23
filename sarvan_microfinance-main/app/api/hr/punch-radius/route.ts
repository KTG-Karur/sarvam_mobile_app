import { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/app/lib/db';
import { errorResponse, successResponse, withAuth, handleCorsPreflight } from '@/app/lib/api-utils';
import { getUserContext } from '@/app/lib/permissions/guards';
import { checkPermission } from '@/app/lib/permissions/engine';
import { buildBranchWhereClause } from '@/app/lib/permissions/branch-scope';

export async function OPTIONS() {
    return handleCorsPreflight();
}

// GET /api/hr/punch-radius — active employees in the caller's permitted branches with their Punch
// Radius lock state, for the HR → Attendance → Punch Radius page.
// ?branchId= (or 'all'), ?departmentId=, ?locked=true|false|all, ?search=
export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const permCtx = await getUserContext(req);
            if (!permCtx || !checkPermission(permCtx, { moduleSlug: 'hr-attendance', actionSlug: 'view' }).allowed) {
                return errorResponse('Permission denied', 403);
            }

            const { searchParams } = new URL(req.url);
            const branchId = searchParams.get('branchId');
            const departmentId = searchParams.get('departmentId');
            const locked = searchParams.get('locked');
            const search = searchParams.get('search')?.trim();

            // A requested branch can only narrow the caller's permitted branches, never widen them.
            const where: Prisma.UserWhereInput = {
                isActive: true,
                ...(await buildBranchWhereClause(user, branchId && branchId !== 'all' ? branchId : null)),
                ...(departmentId && departmentId !== 'all' ? { departmentId } : {}),
                ...(locked === 'true' ? { punchRadiusLocked: true } : locked === 'false' ? { punchRadiusLocked: false } : {}),
                ...(search
                    ? {
                        OR: [
                            { firstName: { contains: search, mode: 'insensitive' } },
                            { lastName: { contains: search, mode: 'insensitive' } },
                            { employeeId: { contains: search, mode: 'insensitive' } },
                        ],
                    }
                    : {}),
            };

            const employees = await prisma.user.findMany({
                where,
                select: {
                    id: true,
                    employeeId: true,
                    firstName: true,
                    lastName: true,
                    role: true,
                    punchRadiusLocked: true,
                    branch: { select: { id: true, name: true, code: true, latitude: true, longitude: true } },
                    department: { select: { id: true, name: true } },
                    shift: { select: { id: true, name: true, shiftStart: true, shiftEnd: true } },
                },
                orderBy: [{ branch: { name: 'asc' } }, { firstName: 'asc' }],
            });

            return successResponse(
                employees.map(({ branch, ...e }) => ({
                    ...e,
                    branch: branch ? { id: branch.id, name: branch.name, code: branch.code } : null,
                    branchHasLocation: branch?.latitude != null && branch?.longitude != null,
                })),
                'Punch radius employees fetched successfully',
            );
        } catch (error: unknown) {
            console.error('Error fetching punch radius employees:', error);
            return errorResponse(error instanceof Error ? error.message : 'Failed to fetch employees', 500);
        }
    })(request);
}
