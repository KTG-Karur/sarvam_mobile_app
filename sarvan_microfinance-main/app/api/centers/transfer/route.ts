import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/db';
import {
    handleCorsPreflight,
    errorResponse,
    resolveOperationalBranchId,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';
import { bumpMasterDataVersion } from '@/app/lib/cache/master-data-cache';

/**
 * Bulk transfer schema
 */
const bulkTransferSchema = z.object({
    transfers: z.array(
        z.object({
            centerId: z.string().min(1, 'Center ID is required'),
            fdoId: z.string().min(1, 'FDO ID is required'),
        })
    ),
    meetingDay: z.string().optional().nullable(),
    fromFdoId: z.string().optional(),
});

/**
 * @swagger
 * /api/centers/transfer:
 *   post:
 *     tags:
 *       - Center Transfer
 *     summary: Bulk Transfer Centers
 *     description: |
 *       Transfer multiple centers to different FDOs in a single operation. **Branch Manager only.**
 *       - Centers must belong to the manager's branch
 *       - Target FDOs must belong to the same branch
 *       - Creates transfer history for each center
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - transfers
 *             properties:
 *               transfers:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required:
 *                     - centerId
 *                     - fdoId
 *                   properties:
 *                     centerId:
 *                       type: string
 *                       description: Center ID to transfer
 *                     fdoId:
 *                       type: string
 *                       description: Target FDO ID
 *               meetingDay:
 *                 type: string
 *                 nullable: true
 *                 description: Optional meeting day to record
 *               fromFdoId:
 *                 type: string
 *                 description: Source FDO (for validation)
 *     responses:
 *       200:
 *         description: Transfer completed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                     successful:
 *                       type: integer
 *                     failed:
 *                       type: integer
 *       400:
 *         description: Invalid centers or FDOs
 *       403:
 *         description: Branch Manager access required
 */

/**
 * OPTIONS /api/centers/transfer
 * Handle CORS preflight
 */
export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * POST /api/centers/transfer
 * Bulk transfer centers to FDOs
 * - Only Branch Managers can transfer centers
 * - Centers must belong to the manager's branch
 * - FDOs must belong to the same branch
 */
export async function POST(request: NextRequest) {
    return withRole(['BRANCH_MANAGER'], async (req, user) => {
        try {
            const body = await request.json();
            const validatedData = bulkTransferSchema.parse(body);

            // Get user's branch first
            const userRecord = await prisma.user.findUnique({
                where: { id: user.userId },
                select: { branchId: true },
            });

            const userBranchId = resolveOperationalBranchId(user, userRecord?.branchId);
            if (!userBranchId) {
                return errorResponse('User branch not found', 400);
            }

            // If fromFdoId is provided, validate that all centers belong to that FDO
            if (validatedData.fromFdoId) {
                const centerIds = validatedData.transfers.map((t) => t.centerId);
                const centers = await prisma.center.findMany({
                    where: {
                        id: { in: centerIds },
                        branchId: userBranchId,
                    },
                    select: {
                        id: true,
                        fdoId: true,
                        meetingDay: true,
                    },
                });

                if (centers.length !== centerIds.length) {
                    return errorResponse(
                        'Some centers not found or do not belong to your branch',
                        400
                    );
                }

                // Check if all centers belong to the specified FDO
                const invalidCenters = centers.filter((c) => c.fdoId !== validatedData.fromFdoId);
                if (invalidCenters.length > 0) {
                    return errorResponse(
                        'Some centers do not belong to the specified Current Officer',
                        400
                    );
                }
            }

            // Validate all centers belong to user's branch and get their current FDOs
            const centerIds = validatedData.transfers.map((t) => t.centerId);
            const centers = await prisma.center.findMany({
                where: {
                    id: { in: centerIds },
                    branchId: userBranchId,
                },
                select: {
                    id: true,
                    name: true,
                    code: true,
                    fdoId: true,
                },
            });

            if (centers.length !== centerIds.length) {
                return errorResponse(
                    'Some centers not found or do not belong to your branch',
                    400
                );
            }

            // Validate all FDOs belong to the same branch
            const fdoIds = Array.from(
                new Set(validatedData.transfers.map((t) => t.fdoId))
            );
            const fdos = await prisma.user.findMany({
                where: {
                    id: { in: fdoIds },
                    role: 'FDO',
                    branchId: userBranchId,
                    isActive: true,
                },
                select: {
                    id: true,
                },
            });

            if (fdos.length !== fdoIds.length) {
                return errorResponse(
                    'Some FDOs not found or do not belong to your branch',
                    400
                );
            }

            // Get center details with current FDOs for history
            const centersWithDetails = await prisma.center.findMany({
                where: {
                    id: { in: centerIds },
                    branchId: userBranchId,
                },
                select: {
                    id: true,
                    name: true,
                    code: true,
                    fdoId: true,
                    meetingDay: true,
                },
            });

            // Perform bulk transfer with history tracking in a transaction
            const transferResults = await Promise.allSettled(
                validatedData.transfers.map(async (transfer) => {
                    const center = centersWithDetails.find((c) => c.id === transfer.centerId);
                    if (!center) {
                        throw new Error(`Center ${transfer.centerId} not found`);
                    }

                    const previousFdoId = center.fdoId;

                    // Update center and create transfer history in a transaction
                    return await prisma.$transaction(async (tx) => {
                        // Update center FDO
                        const updatedCenter = await tx.center.update({
                            where: { id: transfer.centerId },
                            data: { fdoId: transfer.fdoId },
                            select: {
                                id: true,
                                name: true,
                                code: true,
                                fdoId: true,
                            },
                        });

                        // Create transfer history record
                        await tx.centerTransfer.create({
                            data: {
                                centerId: transfer.centerId,
                                previousFdoId: previousFdoId,
                                transferredToFdoId: transfer.fdoId,
                                meetingDay: validatedData.meetingDay || center.meetingDay,
                                transferredById: user.userId,
                            },
                        });

                        return updatedCenter;
                    });
                })
            );

            const successful = transferResults.filter(
                (r) => r.status === 'fulfilled'
            ).length;
            const failed = transferResults.filter((r) => r.status === 'rejected')
                .length;

            if (failed > 0) {
                console.error('Some transfers failed:', transferResults);
            }

            if (successful > 0) await bumpMasterDataVersion('centers:minimal'); // fdoId changed — moves centers between FDO-scoped lists
            return successResponse(
                {
                    total: validatedData.transfers.length,
                    successful,
                    failed,
                },
                `Successfully transferred ${successful} center(s)`
            );
        } catch (error) {
            if (error instanceof z.ZodError) {
                return errorResponse(
                    `Validation error: ${error.errors.map((e) => e.message).join(', ')}`,
                    400
                );
            }

            console.error('Error performing bulk transfer:', error);
            if (error instanceof Error) {
                console.error('Error message:', error.message);
                console.error('Error stack:', error.stack);

                // Handle Prisma errors
                if ('code' in error) {
                    const prismaError = error as { code: string; meta?: unknown };
                    console.error('Prisma error code:', prismaError.code);
                    console.error('Prisma error meta:', prismaError.meta);

                    if (prismaError.code === 'P2003') {
                        return errorResponse('Invalid FDO ID provided. The FDO may not exist or belong to a different branch.', 400);
                    }
                    if (prismaError.code === 'P2025') {
                        return errorResponse('One or more centers not found', 404);
                    }
                }
            }

            return errorResponse(
                error instanceof Error ? `Failed to perform bulk transfer: ${error.message}` : 'Failed to perform bulk transfer',
                500
            );
        }
    })(request);
}

