import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse } from '@/app/lib/api-utils';
import { requirePermission, isUserContext } from '@/app/lib/permissions/guards';

export async function OPTIONS() {
    return handleCorsPreflight();
}

// GET /api/hr/transfers/replacement-candidates?employeeId=... — for the Employee
// Transfer create form: what does this employee currently hold (Centers for an
// FDO, branches for an AREA_MANAGER), and which active same-role employees could
// take it over. Only these two roles have a one-employee-to-many-locations table
// in the schema (Center.fdoId, AreaManagerBranch) — every other role returns no
// positions and no required replacement.
export async function GET(request: NextRequest) {
    const ctx = await requirePermission(request, 'hr-transfer', 'create');
    if (!isUserContext(ctx)) return ctx;

    try {
        const { searchParams } = new URL(request.url);
        const employeeId = searchParams.get('employeeId');
        if (!employeeId) return errorResponse('employeeId is required', 400);

        const employee = await prisma.user.findUnique({
            where: { id: employeeId },
            select: { id: true, role: true, branchId: true, isActive: true },
        });
        if (!employee) return errorResponse('Employee not found', 404);

        if (employee.role === 'FDO') {
            const centers = await prisma.center.findMany({
                where: { fdoId: employeeId, isActive: true },
                select: { id: true, name: true, code: true, branchId: true, branch: { select: { name: true } } },
                orderBy: { name: 'asc' },
            });

            const candidates = employee.branchId
                ? await prisma.user.findMany({
                    where: { role: 'FDO', branchId: employee.branchId, isActive: true, id: { not: employeeId } },
                    select: {
                        id: true,
                        employeeId: true,
                        firstName: true,
                        lastName: true,
                        email: true,
                        profilePhotoUrl: true,
                        branch: { select: { name: true } },
                        _count: { select: { assignedCenters: true } },
                    },
                    orderBy: { firstName: 'asc' },
                })
                : [];

            return successResponse(
                {
                    role: employee.role,
                    requiresReplacement: centers.length > 0,
                    positions: centers.map((c) => ({
                        type: 'CENTER' as const,
                        id: c.id,
                        name: c.name,
                        code: c.code,
                        branchName: c.branch.name,
                    })),
                    candidates: candidates.map((u) => ({
                        id: u.id,
                        employeeCode: u.employeeId,
                        fullName: `${u.firstName} ${u.lastName}`,
                        email: u.email,
                        profilePhotoUrl: u.profilePhotoUrl,
                        currentAssignment: `${u.branch?.name ?? '—'} · ${u._count.assignedCenters} center${u._count.assignedCenters === 1 ? '' : 's'}`,
                        alreadyAtLocation: true,
                    })),
                },
                'Replacement candidates fetched successfully'
            );
        }

        if (employee.role === 'AREA_MANAGER') {
            const branches = await prisma.areaManagerBranch.findMany({
                where: { userId: employeeId },
                select: { branchId: true, isPrimary: true, branch: { select: { name: true } } },
                orderBy: { isPrimary: 'desc' },
            });
            const branchIds = branches.map((b) => b.branchId);

            const otherAMs = await prisma.user.findMany({
                where: { role: 'AREA_MANAGER', isActive: true, id: { not: employeeId } },
                select: {
                    id: true,
                    employeeId: true,
                    firstName: true,
                    lastName: true,
                    email: true,
                    profilePhotoUrl: true,
                    areaManagerBranches: { select: { branchId: true, branch: { select: { name: true } } } },
                },
                orderBy: { firstName: 'asc' },
            });
            const candidates = otherAMs
                .map((u) => ({
                    id: u.id,
                    employeeCode: u.employeeId,
                    fullName: `${u.firstName} ${u.lastName}`,
                    email: u.email,
                    profilePhotoUrl: u.profilePhotoUrl,
                    currentAssignment: u.areaManagerBranches.length > 0
                        ? u.areaManagerBranches.map((b) => b.branch.name).join(', ')
                        : 'No branches assigned',
                    alreadyAtLocation: u.areaManagerBranches.some((b) => branchIds.includes(b.branchId)),
                }))
                .sort((a, b) => (a.alreadyAtLocation === b.alreadyAtLocation ? 0 : a.alreadyAtLocation ? -1 : 1));

            return successResponse(
                {
                    role: employee.role,
                    requiresReplacement: branches.length > 0,
                    positions: branches.map((b) => ({
                        type: 'BRANCH' as const,
                        id: b.branchId,
                        name: b.branch.name,
                        isPrimary: b.isPrimary,
                    })),
                    candidates,
                },
                'Replacement candidates fetched successfully'
            );
        }

        return successResponse(
            { role: employee.role, requiresReplacement: false, positions: [], candidates: [] },
            'Replacement candidates fetched successfully'
        );
    } catch (error: unknown) {
        console.error('Error fetching replacement candidates:', error);
        const message = error instanceof Error ? error.message : 'Failed to fetch replacement candidates';
        return errorResponse(message, 500);
    }
}
