import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/prisma';
import { withAuth, withRole, errorResponse, successResponse, handleCorsPreflight } from '@/app/lib/api-utils';
import {
    DEFAULT_MAX_MEMBERS_PER_GROUP,
    MIN_MAX_MEMBERS_PER_GROUP,
    MAX_MAX_MEMBERS_PER_GROUP,
    invalidateGroupAssignmentConfigCache,
} from '@/app/lib/group-assignment-config';

const groupAssignmentConfigSchema = z.object({
    maxMembersPerGroup: z
        .number()
        .int('Maximum members per group must be a whole number')
        .min(MIN_MAX_MEMBERS_PER_GROUP, `Maximum members per group must be at least ${MIN_MAX_MEMBERS_PER_GROUP}`)
        .max(MAX_MAX_MEMBERS_PER_GROUP, `Maximum members per group cannot exceed ${MAX_MAX_MEMBERS_PER_GROUP}`),
});

export async function GET(request: NextRequest) {
    return withAuth(async () => {
        try {
            const config = await prisma.groupAssignmentConfig.findFirst();
            return successResponse(
                config ?? { maxMembersPerGroup: DEFAULT_MAX_MEMBERS_PER_GROUP },
                'Group assignment config retrieved'
            );
        } catch (error) {
            console.error('Error fetching group assignment config:', error);
            return errorResponse('Failed to fetch group assignment config', 500);
        }
    })(request);
}

export async function PUT(request: NextRequest) {
    return withRole(['ADMIN'], async (req) => {
        try {
            const body = await req.json();
            const validated = groupAssignmentConfigSchema.parse(body);

            const existing = await prisma.groupAssignmentConfig.findFirst();
            const result = existing
                ? await prisma.groupAssignmentConfig.update({ where: { id: existing.id }, data: validated })
                : await prisma.groupAssignmentConfig.create({ data: validated });

            invalidateGroupAssignmentConfigCache();

            return successResponse(result, 'Group assignment settings saved');
        } catch (error: unknown) {
            if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
            return errorResponse((error as Error).message || 'Failed to save group assignment settings', 500);
        }
    })(request);
}

export async function OPTIONS() {
    return handleCorsPreflight();
}
