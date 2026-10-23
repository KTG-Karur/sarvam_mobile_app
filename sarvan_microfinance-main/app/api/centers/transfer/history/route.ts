import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/db';
import {
    handleCorsPreflight,
    errorResponse,
    resolveOperationalBranchId,
    successResponse,
    withAuth,
    withRole,
} from '@/app/lib/api-utils';
import { bumpMasterDataVersion } from '@/app/lib/cache/master-data-cache';

/**
 * Revert transfer schema
 */
const revertTransferSchema = z.object({
    transferId: z.string().min(1, 'Transfer ID is required'),
    centerId: z.string().min(1, 'Center ID is required'),
});

/**
 * @swagger
 * /api/centers/transfer/history:
 *   get:
 *     tags:
 *       - Center Transfer
 *     summary: Get Transfer History
 *     description: Fetch non-reverted transfer history for centers in the manager's branch. **Branch Manager only.**
 *     responses:
 *       200:
 *         description: Transfer history fetched
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       name:
 *                         type: string
 *                       code:
 *                         type: string
 *                       meetingDay:
 *                         type: string
 *                       previousFdoId:
 *                         type: string
 *                       previousFdoName:
 *                         type: string
 *                       transferredToFdoId:
 *                         type: string
 *                       transferredToFdoName:
 *                         type: string
 *                       transferId:
 *                         type: string
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *       403:
 *         description: Branch Manager access required
 *   delete:
 *     tags:
 *       - Center Transfer
 *     summary: Revert Transfer
 *     description: Revert a center transfer, moving the center back to its previous FDO. **Branch Manager only.**
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - transferId
 *               - centerId
 *             properties:
 *               transferId:
 *                 type: string
 *                 description: ID of the transfer record to revert
 *               centerId:
 *                 type: string
 *                 description: ID of the center being reverted
 *     responses:
 *       200:
 *         description: Transfer reverted successfully
 *       400:
 *         description: Already reverted or ID mismatch
 *       403:
 *         description: Not authorized for this branch
 *       404:
 *         description: Transfer record not found
 */

/**
 * OPTIONS /api/centers/transfer/history
 * Handle CORS preflight
 */
export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/centers/transfer/history
 * Fetches transfer history for centers in the user's branch
 * Only shows non-reverted transfers
 *
 * Only accessible by BRANCH_MANAGER.
 */
export async function GET(request: NextRequest) {
    return withRole(['BRANCH_MANAGER'], async (req, user) => {
        try {
            // Get user's branch
            const userRecord = await prisma.user.findUnique({
                where: { id: user.userId },
                select: { branchId: true },
            });

            const userBranchId = resolveOperationalBranchId(user, userRecord?.branchId);
            if (!userBranchId) {
                return errorResponse('User branch not found', 400);
            }

            // Fetch non-reverted transfers for centers in the user's branch
            const transfers = await prisma.centerTransfer.findMany({
                where: {
                    center: {
                        branchId: userBranchId,
                    },
                    isReverted: false,
                },
                include: {
                    center: {
                        select: {
                            id: true,
                            name: true,
                            code: true,
                            meetingDay: true,
                        },
                    },
                    previousFdo: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                        },
                    },
                    transferredToFdo: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                        },
                    },
                },
                orderBy: {
                    createdAt: 'desc',
                },
            });

            const formattedTransfers = transfers.map((transfer) => ({
                id: transfer.center.id,
                name: transfer.center.name,
                code: transfer.center.code,
                meetingDay: transfer.center.meetingDay,
                previousFdoId: transfer.previousFdoId,
                previousFdoName: transfer.previousFdo
                    ? `${transfer.previousFdo.firstName} ${transfer.previousFdo.lastName}`
                    : null,
                transferredToFdoId: transfer.transferredToFdoId,
                transferredToFdoName: `${transfer.transferredToFdo.firstName} ${transfer.transferredToFdo.lastName}`,
                transferId: transfer.id,
                createdAt: transfer.createdAt,
            }));

            return successResponse(
                formattedTransfers,
                'Transfer history fetched successfully'
            );
        } catch (error) {
            console.error('Error fetching transfer history:', error);
            return errorResponse('Failed to fetch transfer history', 500);
        }
    })(request);
}

/**
 * DELETE /api/centers/transfer/history
 * Reverts a center transfer by:
 * 1. Marking the transfer as reverted
 * 2. Moving the center back to its previous FDO
 *
 * Only accessible by BRANCH_MANAGER.
 */
export async function DELETE(request: NextRequest) {
    return withRole(['BRANCH_MANAGER'], async (req, user) => {
        try {
            const body = await request.json();
            const validatedData = revertTransferSchema.parse(body);

            // Get user's branch
            const userRecord = await prisma.user.findUnique({
                where: { id: user.userId },
                select: { branchId: true },
            });

            const userBranchId = resolveOperationalBranchId(user, userRecord?.branchId);
            if (!userBranchId) {
                return errorResponse('User branch not found', 400);
            }

            // Fetch the transfer record
            const transfer = await prisma.centerTransfer.findUnique({
                where: { id: validatedData.transferId },
                include: {
                    center: {
                        select: {
                            id: true,
                            name: true,
                            branchId: true,
                        },
                    },
                },
            });

            if (!transfer) {
                return errorResponse('Transfer record not found', 404);
            }

            // Verify center belongs to user's branch
            if (transfer.center.branchId !== userBranchId) {
                return errorResponse('Center does not belong to your branch', 403);
            }

            // Verify transfer hasn't been reverted
            if (transfer.isReverted) {
                return errorResponse('Transfer has already been reverted', 400);
            }

            // Verify center ID matches
            if (transfer.centerId !== validatedData.centerId) {
                return errorResponse('Center ID mismatch', 400);
            }

            // Perform revert in a transaction
            await prisma.$transaction(async (tx) => {
                // Mark transfer as reverted
                await tx.centerTransfer.update({
                    where: { id: validatedData.transferId },
                    data: {
                        isReverted: true,
                        revertedAt: new Date(),
                    },
                });

                // Revert center's FDO back to previous FDO
                await tx.center.update({
                    where: { id: validatedData.centerId },
                    data: {
                        fdoId: transfer.previousFdoId,
                    },
                });
            });

            await bumpMasterDataVersion('centers:minimal'); // fdoId reverted — moves center between FDO-scoped lists
            return successResponse(
                { centerId: validatedData.centerId },
                'Transfer reverted successfully'
            );
        } catch (error) {
            if (error instanceof z.ZodError) {
                console.error('Validation error:', error.errors);
                return errorResponse(
                    `Validation error: ${error.errors.map((e) => e.message).join(', ')}`,
                    400
                );
            }

            console.error('Error reverting transfer:', error);
            return errorResponse('Failed to revert transfer', 500);
        }
    })(request);
}

