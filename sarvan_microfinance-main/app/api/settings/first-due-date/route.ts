import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/prisma';
import { withAuth, withRole, errorResponse, successResponse, handleCorsPreflight } from '@/app/lib/api-utils';
import {
    DEFAULT_FIRST_DUE_DATE_ENABLED,
    DEFAULT_FIRST_DUE_DATE_MAX_DAYS,
    invalidateFirstDueDateConfigCache,
} from '@/app/lib/first-due-date-config';

const configSchema = z.object({
    enabled: z.boolean(),
    maxDays: z.number().int().min(1).max(365),
});

// GET is withAuth (not admin-only) — Loan Indexation reads this to bound the
// First Due Date input for every role, not just ADMIN.
export async function GET(request: NextRequest) {
    return withAuth(async () => {
        try {
            const config = await prisma.firstDueDateConfig.findFirst();
            return successResponse(
                {
                    enabled: config?.enabled ?? DEFAULT_FIRST_DUE_DATE_ENABLED,
                    maxDays: config?.maxDays ?? DEFAULT_FIRST_DUE_DATE_MAX_DAYS,
                },
                'First due date setting retrieved'
            );
        } catch (error) {
            console.error('Error fetching first due date setting:', error);
            return errorResponse('Failed to fetch setting', 500);
        }
    })(request);
}

export async function PUT(request: NextRequest) {
    return withRole(['ADMIN'], async (req) => {
        try {
            const body = await req.json();
            const validated = configSchema.parse(body);

            const existing = await prisma.firstDueDateConfig.findFirst();
            const result = existing
                ? await prisma.firstDueDateConfig.update({ where: { id: existing.id }, data: validated })
                : await prisma.firstDueDateConfig.create({ data: validated });

            invalidateFirstDueDateConfigCache();

            return successResponse(result, 'First due date setting saved');
        } catch (error: unknown) {
            if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
            return errorResponse((error as Error).message || 'Failed to save setting', 500);
        }
    })(request);
}

export async function OPTIONS() {
    return handleCorsPreflight();
}
