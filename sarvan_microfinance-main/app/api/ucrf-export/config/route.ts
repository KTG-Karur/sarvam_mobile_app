import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/db';
import { errorResponse, handleCorsPreflight, successResponse } from '@/app/lib/api-utils';
import { withUcrfAdmin } from '@/app/lib/ucrf/admin-guard';
import { getUcrfConfig, saveUcrfConfig } from '@/app/lib/ucrf/config.service';
import { ucrfConfigSchema } from '@/app/lib/ucrf/types';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/** GET /api/ucrf-export/config — saved institution identifiers (ADMIN only). */
export async function GET(request: NextRequest) {
    return withUcrfAdmin(async () => {
        try {
            const config = await getUcrfConfig();
            return successResponse({ config });
        } catch (error) {
            console.error('[ucrf-export] config load failed', error instanceof Error ? error.message : error);
            return errorResponse('Failed to load UCRF settings', 500);
        }
    })(request);
}

/** PUT /api/ucrf-export/config — save the identifiers the CDF header/trailer require (ADMIN only). */
export async function PUT(request: NextRequest) {
    return withUcrfAdmin(async (req, user) => {
        try {
            const body = ucrfConfigSchema.parse(await req.json());
            const before = await getUcrfConfig();
            const saved = await saveUcrfConfig(body, user.userId);
            await prisma.roleAuditLog.create({
                data: {
                    actedBy: user.userId,
                    action: 'UCRF_CONFIG_SAVED',
                    targetType: 'ucrf_config',
                    targetId: 'singleton',
                    before: before ? { memberId: before.memberId, fileFrequency: before.fileFrequency, loanCategory: before.loanCategory } : undefined,
                    after: { memberId: body.memberId, fileFrequency: body.fileFrequency, loanCategory: body.loanCategory },
                },
            });
            return successResponse({ config: saved }, 'UCRF settings saved');
        } catch (error) {
            if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
            console.error('[ucrf-export] config save failed', error instanceof Error ? error.message : error);
            return errorResponse('Failed to save UCRF settings', 500);
        }
    })(request);
}
