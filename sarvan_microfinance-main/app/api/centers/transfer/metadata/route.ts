import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import {
    handleCorsPreflight,
    errorResponse,
    resolveOperationalBranchId,
    successResponse,
    withAuth,
} from '@/app/lib/api-utils';

/**
 * @swagger
 * /api/centers/transfer/metadata:
 *   get:
 *     tags:
 *       - Center Transfer
 *     summary: Get Transfer Metadata
 *     description: |
 *       Get metadata for center transfers:
 *       - Available meeting days from centers
 *       - FDOs currently assigned to centers
 *       - All FDOs available for transfer
 *     parameters:
 *       - in: query
 *         name: branchId
 *         schema:
 *           type: string
 *         description: Branch ID (required for Admin, auto-detected for BM)
 *     responses:
 *       200:
 *         description: Metadata fetched successfully
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
 *                     meetingDays:
 *                       type: array
 *                       items:
 *                         type: string
 *                     assignedFDOs:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                           firstName:
 *                             type: string
 *                           lastName:
 *                             type: string
 *                           fullName:
 *                             type: string
 *                     availableFDOs:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                           firstName:
 *                             type: string
 *                           lastName:
 *                             type: string
 *                           fullName:
 *                             type: string
 *       400:
 *         description: Branch ID required for Admin
 */

/**
 * OPTIONS /api/centers/transfer/metadata
 * Handle CORS preflight
 */
export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/centers/transfer/metadata
 * Get metadata for center transfer:
 * - Available meeting days from centers
 * - Current FDOs assigned to centers
 * - All FDOs available for transfer
 */
export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const branchIdParam = searchParams.get('branchId');

            const userRecord = await prisma.user.findUnique({
                where: { id: user.userId },
                select: { branchId: true },
            });
            const resolvedBranch = resolveOperationalBranchId(user, userRecord?.branchId);

            let targetBranchId: string | null = null;

            if (user.role === 'BRANCH_MANAGER') {
                if (!resolvedBranch) {
                    return successResponse(
                        {
                            meetingDays: [],
                            assignedFDOs: [],
                            availableFDOs: [],
                        },
                        'No branch found for user'
                    );
                }
                targetBranchId = resolvedBranch;
            } else if (user.role === 'ADMIN' || user.role === 'AREA_MANAGER') {
                targetBranchId = branchIdParam ?? resolvedBranch;
                if (!targetBranchId) {
                    return errorResponse('Branch ID is required', 400);
                }
            } else if (branchIdParam) {
                targetBranchId = branchIdParam;
            } else {
                return errorResponse('Branch ID is required', 400);
            }

            // Fetch centers for the branch
            const centers = await prisma.center.findMany({
                where: {
                    branchId: targetBranchId,
                    isActive: true,
                },
                select: {
                    meetingDay: true,
                    fdoId: true,
                    fdo: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            email: true,
                        },
                    },
                },
            });

            // Get unique meeting days (excluding null/empty)
            const meetingDays = Array.from(
                new Set(
                    centers
                        .map((c) => c.meetingDay)
                        .filter((day): day is string => Boolean(day))
                )
            ).sort();

            // Get unique assigned FDOs (FDOs that are currently assigned to centers)
            const assignedFdoIds = Array.from(
                new Set(
                    centers
                        .map((c) => c.fdoId)
                        .filter((id): id is string => Boolean(id))
                )
            );

            const assignedFDOs = await prisma.user.findMany({
                where: {
                    id: { in: assignedFdoIds },
                    isActive: true,
                },
                select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    email: true,
                },
                orderBy: {
                    firstName: 'asc',
                },
            });

            // Get all FDOs for the branch (available for transfer)
            const availableFDOs = await prisma.user.findMany({
                where: {
                    role: 'FDO',
                    branchId: targetBranchId,
                    isActive: true,
                },
                select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    email: true,
                },
                orderBy: {
                    firstName: 'asc',
                },
            });

            return successResponse(
                {
                    meetingDays,
                    assignedFDOs: assignedFDOs.map((fdo) => ({
                        id: fdo.id,
                        firstName: fdo.firstName,
                        lastName: fdo.lastName,
                        email: fdo.email,
                        fullName: `${fdo.firstName} ${fdo.lastName}`,
                    })),
                    availableFDOs: availableFDOs.map((fdo) => ({
                        id: fdo.id,
                        firstName: fdo.firstName,
                        lastName: fdo.lastName,
                        email: fdo.email,
                        fullName: `${fdo.firstName} ${fdo.lastName}`,
                    })),
                },
                'Transfer metadata fetched successfully'
            );
        } catch (error) {
            console.error('Error fetching transfer metadata:', error);
            return errorResponse('Failed to fetch transfer metadata', 500);
        }
    })(request);
}

