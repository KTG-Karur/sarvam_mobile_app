import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/prisma';
import { withAuth, withRole, errorResponse, successResponse, handleCorsPreflight } from '@/app/lib/api-utils';
import {
    DEFAULT_ALLOW_FDO_EDIT_APPROVED_CLIENT,
    invalidateFdoApprovedClientEditConfigCache,
} from '@/app/lib/fdo-approved-client-edit-config';

const configSchema = z.object({ enabled: z.boolean() });

export async function GET(request: NextRequest) {
    return withAuth(async () => {
        try {
            const config = await prisma.fdoApprovedClientEditConfig.findFirst();
            return successResponse(
                { enabled: config?.enabled ?? DEFAULT_ALLOW_FDO_EDIT_APPROVED_CLIENT },
                'FDO approved-client edit setting retrieved'
            );
        } catch (error) {
            console.error('Error fetching FDO approved-client edit setting:', error);
            return errorResponse('Failed to fetch setting', 500);
        }
    })(request);
}

export async function PUT(request: NextRequest) {
    return withRole(['ADMIN'], async (req) => {
        try {
            const body = await req.json();
            const validated = configSchema.parse(body);

            const existing = await prisma.fdoApprovedClientEditConfig.findFirst();
            const result = existing
                ? await prisma.fdoApprovedClientEditConfig.update({ where: { id: existing.id }, data: validated })
                : await prisma.fdoApprovedClientEditConfig.create({ data: validated });

            invalidateFdoApprovedClientEditConfigCache();

            return successResponse(result, 'FDO approved-client edit setting saved');
        } catch (error: unknown) {
            if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
            return errorResponse((error as Error).message || 'Failed to save setting', 500);
        }
    })(request);
}

export async function OPTIONS() {
    return handleCorsPreflight();
}
