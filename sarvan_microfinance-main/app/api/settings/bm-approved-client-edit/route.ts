import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/prisma';
import { withAuth, withRole, errorResponse, successResponse, handleCorsPreflight } from '@/app/lib/api-utils';
import {
    DEFAULT_ALLOW_BM_EDIT_APPROVED_CLIENT,
    invalidateBmApprovedClientEditConfigCache,
} from '@/app/lib/bm-approved-client-edit-config';

const configSchema = z.object({ enabled: z.boolean() });

export async function GET(request: NextRequest) {
    return withAuth(async () => {
        try {
            const config = await prisma.bmApprovedClientEditConfig.findFirst();
            return successResponse(
                { enabled: config?.enabled ?? DEFAULT_ALLOW_BM_EDIT_APPROVED_CLIENT },
                'BM approved-client edit setting retrieved'
            );
        } catch (error) {
            console.error('Error fetching BM approved-client edit setting:', error);
            return errorResponse('Failed to fetch setting', 500);
        }
    })(request);
}

export async function PUT(request: NextRequest) {
    return withRole(['ADMIN'], async (req) => {
        try {
            const body = await req.json();
            const validated = configSchema.parse(body);

            const existing = await prisma.bmApprovedClientEditConfig.findFirst();
            const result = existing
                ? await prisma.bmApprovedClientEditConfig.update({ where: { id: existing.id }, data: validated })
                : await prisma.bmApprovedClientEditConfig.create({ data: validated });

            invalidateBmApprovedClientEditConfigCache();

            return successResponse(result, 'BM approved-client edit setting saved');
        } catch (error: unknown) {
            if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
            return errorResponse((error as Error).message || 'Failed to save setting', 500);
        }
    })(request);
}

export async function OPTIONS() {
    return handleCorsPreflight();
}
