import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/db';
import { errorResponse, successResponse, withAuth, handleCorsPreflight } from '@/app/lib/api-utils';
import { getUserContext } from '@/app/lib/permissions/guards';
import { checkPermission } from '@/app/lib/permissions/engine';
import { buildBranchWhereClause } from '@/app/lib/permissions/branch-scope';

const assignSchema = z.object({
    employeeIds: z.array(z.string().min(1)).min(1, 'Select at least one employee'),
    locked: z.boolean(),
});

export async function OPTIONS() {
    return handleCorsPreflight();
}

// POST /api/hr/punch-radius/assign — bulk lock / unlock the punch-in radius rule. Requested
// employeeIds are narrowed to the caller's permitted branches server-side (same fail-safe scoping
// as /api/hr/shifts/assign); every actual change is written to PunchRadiusLog in the same transaction.
export async function POST(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const permCtx = await getUserContext(req);
            if (!permCtx || !checkPermission(permCtx, { moduleSlug: 'hr-attendance', actionSlug: 'edit' }).allowed) {
                return errorResponse('Permission denied', 403);
            }

            const validation = assignSchema.safeParse(await req.json());
            if (!validation.success) return errorResponse(validation.error.errors[0].message, 400);
            const { employeeIds, locked } = validation.data;

            const branchScope = await buildBranchWhereClause(user, null);
            const permitted = await prisma.user.findMany({
                where: { id: { in: employeeIds }, isActive: true, ...branchScope },
                select: { id: true, punchRadiusLocked: true },
            });
            const skipped = employeeIds.length - permitted.length;
            if (permitted.length === 0) {
                return errorResponse('None of the selected employees are within your permitted branches', 403);
            }

            // Only employees whose state actually changes are updated / logged.
            const changingIds = permitted.filter((e) => e.punchRadiusLocked !== locked).map((e) => e.id);
            if (changingIds.length > 0) {
                await prisma.$transaction([
                    prisma.user.updateMany({ where: { id: { in: changingIds } }, data: { punchRadiusLocked: locked } }),
                    prisma.punchRadiusLog.createMany({
                        data: changingIds.map((employeeId) => ({ employeeId, locked, changedById: user.userId })),
                    }),
                ]);
            }

            const verb = locked ? 'Locked' : 'Unlocked';
            return successResponse(
                { changedCount: changingIds.length, unchangedCount: permitted.length - changingIds.length, skippedCount: skipped },
                skipped > 0
                    ? `${verb} ${changingIds.length} employee(s); ${skipped} were outside your permitted branches and were skipped`
                    : `${verb} ${changingIds.length} employee(s)`,
            );
        } catch (error: unknown) {
            console.error('Error updating punch radius lock:', error);
            return errorResponse(error instanceof Error ? error.message : 'Failed to update punch radius lock', 500);
        }
    })(request);
}
