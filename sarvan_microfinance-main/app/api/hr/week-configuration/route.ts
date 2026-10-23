import { NextRequest } from 'next/server';
import { z } from 'zod';
import {
    errorResponse,
    successResponse,
    withAuth,
    handleCorsPreflight,
} from '@/app/lib/api-utils';
import { getWeekConfiguration, upsertWeekConfiguration, upsertWeekConfigurationForBranches } from '@/app/lib/attendance-schedule';
import { prisma } from '@/app/lib/prisma';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';
import { requirePermission, isUserContext } from '@/app/lib/permissions/guards';
import { getWritableBranchIds } from '@/app/lib/attendance-branch-access';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const weekSchema = z.object({
    branchId: z.string().min(1).optional(),
    allBranches: z.boolean().optional(),
    sunday: z.boolean(),
    monday: z.boolean(),
    tuesday: z.boolean(),
    wednesday: z.boolean(),
    thursday: z.boolean(),
    friday: z.boolean(),
    saturday: z.boolean(),
});

// GET /api/hr/week-configuration?branchId= — the branch's weekly off schedule
// (defaults to the caller's own branch; a branchId override must be permitted).
export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const requested = new URL(req.url).searchParams.get('branchId');
            if (requested) {
                const permitted = await getPermittedBranchIds(user);
                if (permitted !== null && !permitted.includes(requested)) {
                    return errorResponse('You do not have access to this branch', 403);
                }
            }
            const branchId = requested ?? user.branchId;
            if (!branchId) return errorResponse('Branch is required', 400);

            const schedule = await getWeekConfiguration(branchId);
            return successResponse({ branchId, ...schedule }, 'Week configuration fetched');
        } catch (error: any) {
            return errorResponse(error.message || 'Failed to fetch week configuration', 500);
        }
    })(request);
}

// PUT /api/hr/week-configuration — upsert the branch's weekly off schedule.
// RBAC-gated (hr-attendance:edit), same gate as Working Hours / Shift Management.
export async function PUT(request: NextRequest) {
    const ctx = await requirePermission(request, 'hr-attendance', 'edit');
    if (!isUserContext(ctx)) return ctx;

    try {
        const { branchId: requested, allBranches, ...schedule } = weekSchema.parse(await request.json());
        const writable = await getWritableBranchIds(request, ctx);

        if (allBranches) {
            const targets = writable ?? (await prisma.branch.findMany({ where: { isActive: true }, select: { id: true } })).map((b) => b.id);
            if (targets.length === 0) return errorResponse('No branches available', 400);
            await upsertWeekConfigurationForBranches(targets, schedule, ctx.userId);
            return successResponse({ allBranches: true, appliedTo: targets.length, ...schedule }, `Week configuration applied to ${targets.length} branch(es)`);
        }

        const branchId = requested ?? ctx.branchId;
        if (!branchId) return errorResponse('Branch is required', 400);
        if (writable !== null && !writable.includes(branchId)) {
            return errorResponse('You do not have access to this branch', 403);
        }

        const saved = await upsertWeekConfiguration(branchId, schedule, ctx.userId);
        return successResponse({ branchId, ...saved }, 'Week configuration updated');
    } catch (error: any) {
        if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
        return errorResponse(error.message || 'Failed to update week configuration', 500);
    }
}
