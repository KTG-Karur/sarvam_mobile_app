import { NextRequest } from 'next/server';
import { z } from 'zod';
import { IncentiveConfigType } from '@prisma/client';
import { prisma } from '@/app/lib/prisma';
import { handleCorsPreflight, errorResponse, successResponse, withRole } from '@/app/lib/api-utils';
import { DEFAULT_INCENTIVE_SLABS } from '@/prisma/seeders/incentive-config.seeder';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const configTypeSchema = z.nativeEnum(IncentiveConfigType);

const slabInputSchema = z.object({
    slabOrder: z.number().int().min(1),
    label: z.string().optional().nullable(),
    category: z.string().optional().nullable(),
    minValue: z.number().optional().nullable(),
    maxValue: z.number().optional().nullable(),
    rate: z.number(),
});

const putBodySchema = z.object({
    configType: configTypeSchema,
    slabs: z.array(slabInputSchema).min(1),
});

/**
 * GET /api/admin/incentive-config?configType=...
 * Returns the active config+slabs for a single configType, or all configTypes when omitted.
 * @access ADMIN
 */
export async function GET(request: NextRequest) {
    return withRole(['ADMIN'], async (req) => {
        try {
            const { searchParams } = new URL(req.url);
            const configTypeParam = searchParams.get('configType');

            if (configTypeParam) {
                const parsed = configTypeSchema.safeParse(configTypeParam);
                if (!parsed.success) return errorResponse('Invalid configType', 400);

                const config = await prisma.incentiveConfig.findFirst({
                    where: { configType: parsed.data, isActive: true },
                    include: { slabs: { orderBy: { slabOrder: 'asc' } } },
                });
                return successResponse({ config });
            }

            const configs = await prisma.incentiveConfig.findMany({
                where: { isActive: true },
                include: { slabs: { orderBy: { slabOrder: 'asc' } } },
            });
            return successResponse({ configs });
        } catch (error) {
            return errorResponse(error instanceof Error ? error.message : 'Failed to fetch incentive config', 500);
        }
    })(request);
}

/**
 * PUT /api/admin/incentive-config
 * Body: { configType, slabs: [{ slabOrder, label?, category?, minValue?, maxValue?, rate }] }
 * Versioned replace — deactivates the previous active config for that configType and creates a new one.
 * @access ADMIN
 */
export async function PUT(request: NextRequest) {
    return withRole(['ADMIN'], async (req, user) => {
        try {
            const body = await req.json();
            const parsed = putBodySchema.safeParse(body);
            if (!parsed.success) return errorResponse(parsed.error.errors[0].message, 400);
            const { configType, slabs } = parsed.data;

            const orders = [...slabs.map((s) => s.slabOrder)].sort((a, b) => a - b);
            for (let i = 0; i < orders.length; i++) {
                if (orders[i] !== i + 1) {
                    return errorResponse('slabOrder must be sequential starting from 1', 400);
                }
            }

            const config = await prisma.$transaction(async (tx) => {
                await tx.incentiveConfig.updateMany({
                    where: { configType, isActive: true },
                    data: { isActive: false },
                });

                return tx.incentiveConfig.create({
                    data: {
                        configType,
                        isActive: true,
                        updatedById: user.userId,
                        slabs: {
                            create: slabs.map((s) => ({
                                slabOrder: s.slabOrder,
                                label: s.label ?? null,
                                category: s.category ?? null,
                                minValue: s.minValue ?? null,
                                maxValue: s.maxValue ?? null,
                                rate: s.rate,
                            })),
                        },
                    },
                    include: { slabs: { orderBy: { slabOrder: 'asc' } } },
                });
            });

            return successResponse({ config }, 'Incentive config saved successfully');
        } catch (error) {
            return errorResponse(error instanceof Error ? error.message : 'Failed to save incentive config', 500);
        }
    })(request);
}

/**
 * DELETE /api/admin/incentive-config?configType=...
 * Resets a configType back to the seeded defaults (deactivates current, creates a fresh default version).
 * @access ADMIN
 */
export async function DELETE(request: NextRequest) {
    return withRole(['ADMIN'], async (req) => {
        try {
            const { searchParams } = new URL(req.url);
            const parsed = configTypeSchema.safeParse(searchParams.get('configType'));
            if (!parsed.success) return errorResponse('Invalid configType', 400);
            const configType = parsed.data;

            const defaults = DEFAULT_INCENTIVE_SLABS[configType];

            const config = await prisma.$transaction(async (tx) => {
                await tx.incentiveConfig.updateMany({
                    where: { configType, isActive: true },
                    data: { isActive: false },
                });

                return tx.incentiveConfig.create({
                    data: {
                        configType,
                        isActive: true,
                        slabs: { create: defaults },
                    },
                    include: { slabs: { orderBy: { slabOrder: 'asc' } } },
                });
            });

            return successResponse({ config }, 'Incentive config reset to defaults');
        } catch (error) {
            return errorResponse(error instanceof Error ? error.message : 'Failed to reset incentive config', 500);
        }
    })(request);
}
