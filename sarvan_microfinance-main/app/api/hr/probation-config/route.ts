import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse } from '@/app/lib/api-utils';
import { requirePermission, isUserContext } from '@/app/lib/permissions/guards';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const updateConfigSchema = z.object({
    probationMonths: z.number().int().min(1, 'Probation period must be at least 1 month').max(24, 'Probation period cannot exceed 24 months'),
});

// GET /api/hr/probation-config
export async function GET(request: NextRequest) {
    const ctx = await requirePermission(request, 'hr-confirmation', 'view');
    if (!isUserContext(ctx)) return ctx;

    try {
        // Singleton table with no unique constraint to enforce it — two
        // concurrent first-ever requests can each pass the "no row yet"
        // check and both call create(), leaving two rows behind. Ordering by
        // updatedAt desc means GET and PUT always agree on the same "most
        // recently touched" row as canonical even if that happens, and any
        // real save (which always bumps updatedAt) re-establishes a single
        // clear winner going forward.
        let config = await prisma.hrProbationConfig.findFirst({ orderBy: { updatedAt: 'desc' } });
        if (!config) {
            config = await prisma.hrProbationConfig.create({
                data: { probationMonths: 6 },
            });
        }
        return successResponse({ probationMonths: config.probationMonths }, 'Probation configuration fetched successfully');
    } catch (error: unknown) {
        console.error('Error fetching probation configuration:', error);
        const message = error instanceof Error ? error.message : 'Failed to fetch probation configuration';
        return errorResponse(message, 500);
    }
}

// PUT /api/hr/probation-config
export async function PUT(request: NextRequest) {
    const ctx = await requirePermission(request, 'admin', 'edit');
    if (!isUserContext(ctx)) return ctx;

    try {
        const body = await request.json();
        const data = updateConfigSchema.parse(body);

        // Same canonical-row selection as GET — see its comment.
        const existing = await prisma.hrProbationConfig.findFirst({ orderBy: { updatedAt: 'desc' } });
        const config = existing
            ? await prisma.hrProbationConfig.update({
                  where: { id: existing.id },
                  data: {
                      probationMonths: data.probationMonths,
                      updatedById: ctx.userId,
                  },
              })
            : await prisma.hrProbationConfig.create({
                  data: {
                      probationMonths: data.probationMonths,
                      updatedById: ctx.userId,
                  },
              });

        return successResponse(config, 'Probation configuration updated successfully');
    } catch (error: unknown) {
        if (error instanceof z.ZodError) {
            return errorResponse(error.errors[0].message, 400);
        }
        console.error('Error updating probation configuration:', error);
        const message = error instanceof Error ? error.message : 'Failed to update probation configuration';
        return errorResponse(message, 500);
    }
}

