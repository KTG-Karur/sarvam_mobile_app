import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/db';
import { errorResponse, successResponse, withAuth, handleCorsPreflight } from '@/app/lib/api-utils';
import { getUserContext } from '@/app/lib/permissions/guards';
import { checkPermission } from '@/app/lib/permissions/engine';
import { buildBranchWhereClause } from '@/app/lib/permissions/branch-scope';

const assignSchema = z.object({
    shiftId: z.string().min(1),
    employeeIds: z.array(z.string().min(1)).min(1, 'Select at least one employee'),
});

export async function OPTIONS() {
    return handleCorsPreflight();
}

// POST /api/hr/shifts/assign — bulk-assign a shift to a set of employees. Requested
// employeeIds are narrowed to the caller's permitted branches server-side (same
// fail-safe scoping as GET /api/hr/employees, via the JWT-shaped `user` — not the
// separate UserContext permission check) rather than trusted from the client, so an
// Area Manager can't assign shifts outside their own branches.
export async function POST(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const permCtx = await getUserContext(req);
            if (!permCtx || !checkPermission(permCtx, { moduleSlug: 'hr-attendance', actionSlug: 'edit' }).allowed) {
                return errorResponse('Permission denied', 403);
            }

            const body = await req.json();
            const validation = assignSchema.safeParse(body);
            if (!validation.success) return errorResponse(validation.error.errors[0].message, 400);
            const { shiftId, employeeIds } = validation.data;

            const shift = await prisma.shift.findUnique({ where: { id: shiftId } });
            if (!shift || !shift.isActive) return errorResponse('Shift not found or disabled', 404);

            const branchScope = await buildBranchWhereClause(user, null);
            const permittedEmployees = await prisma.user.findMany({
                where: { id: { in: employeeIds }, ...branchScope },
                select: { id: true },
            });
            const permittedIds = permittedEmployees.map((e) => e.id);
            const skipped = employeeIds.length - permittedIds.length;

            if (permittedIds.length === 0) {
                return errorResponse('None of the selected employees are within your permitted branches', 403);
            }

            const result = await prisma.user.updateMany({
                where: { id: { in: permittedIds } },
                data: { shiftId },
            });

            return successResponse(
                { assignedCount: result.count, skippedCount: skipped },
                skipped > 0
                    ? `Assigned ${result.count} employee(s); ${skipped} were outside your permitted branches and were skipped`
                    : `Assigned ${result.count} employee(s) to ${shift.name}`,
            );
        } catch (error: any) {
            console.error('Error assigning shift:', error);
            return errorResponse(error.message || 'Failed to assign shift', 500);
        }
    })(request);
}
