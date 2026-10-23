import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/db';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';
import { createNextGroupForCenter } from '@/app/lib/services/group-assignment.service';

/**
 * Approval action schema
 */
const approvalSchema = z.object({
    action: z.enum(['APPROVE', 'REJECT'], {
        required_error: 'Action is required',
        invalid_type_error: 'Action must be either APPROVE or REJECT',
    }),
    comments: z.string().optional().nullable(),
    rejectionReason: z.string().optional().nullable(),
}).refine(
    (data) => {
        // If action is REJECT, rejectionReason is required
        if (data.action === 'REJECT' && !data.rejectionReason?.trim()) {
            return false;
        }
        return true;
    },
    {
        message: 'Rejection reason is required when rejecting a center',
        path: ['rejectionReason'],
    }
);

/**
 * @swagger
 * /api/centers/{id}/approve:
 *   post:
 *     tags:
 *       - Centers
 *     summary: Approve or Reject Center
 *     description: |
 *       Area Manager approves or rejects a center created by Branch Manager.
 *       - **AREA_MANAGER role only**
 *       - Can approve pending, or re-approve rejected centers
 *       - Can reject pending, or re-reject approved centers
 *       - Rejection requires a reason
 *       - Comments are optional for both actions
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Center ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - action
 *             properties:
 *               action:
 *                 type: string
 *                 enum: [APPROVE, REJECT]
 *                 example: APPROVE
 *               comments:
 *                 type: string
 *                 nullable: true
 *                 example: "Center looks good, approved for operations"
 *               rejectionReason:
 *                 type: string
 *                 nullable: true
 *                 example: "Incomplete documentation"
 *                 description: Required when action is REJECT
 *     responses:
 *       200:
 *         description: Center approved/rejected successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Center approved successfully"
 *                 data:
 *                   $ref: '#/components/schemas/Center'
 *       400:
 *         description: Invalid request data or center not in pending status
 *       403:
 *         description: Area Manager access required
 *       404:
 *         description: Center not found
 */

export async function OPTIONS() {
    return handleCorsPreflight();
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    return withRole(['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN'], async (req, user) => {
        try {
            // Await params in Next.js 15+ App Router
            const { id: centerId } = await params;

            // Parse and validate request body
            const body = await req.json();
            const validationResult = approvalSchema.safeParse(body);

            if (!validationResult.success) {
                const errorMessage = validationResult.error.errors[0]?.message || 'Invalid request data';
                return errorResponse(errorMessage, 400);
            }

            const { action, comments, rejectionReason } = validationResult.data;

            // Check if center exists
            const center = await prisma.center.findUnique({
                where: { id: centerId },
                include: {
                    branch: {
                        select: {
                            id: true,
                            name: true,
                            code: true,
                        },
                    },
                    createdBy: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            email: true,
                        },
                    },
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

            if (!center) {
                return errorResponse('Center not found', 404);
            }

            // Branch Managers can only approve/reject centers in their own branch
            if (user.role === 'BRANCH_MANAGER') {
                const userRecord = await prisma.user.findUnique({
                    where: { id: user.userId },
                    select: { branchId: true },
                });
                if (!userRecord?.branchId || center.branchId !== userRecord.branchId) {
                    return errorResponse('You can only approve centers in your branch', 403);
                }
            }

            // Note: Removed status check to allow re-approval or re-rejection

            // Update center based on action
            const updateData: {
                status: 'APPROVED' | 'REJECTED';
                approvedById: string;
                approvedAt: Date;
                rejectionReason?: string | null;
            } = {
                status: action === 'APPROVE' ? 'APPROVED' : 'REJECTED',
                approvedById: user.userId,
                approvedAt: new Date(),
            };

            // Add rejection reason if rejecting
            if (action === 'REJECT' && rejectionReason) {
                updateData.rejectionReason = rejectionReason.trim();
            }

            // Update the center, and — on first approval only — auto-create
            // the center's first group ("<Center Name> - 1"). The zero-groups
            // guard keeps this safe under re-approval (status check above is
            // intentionally absent to allow re-approve/re-reject).
            const updatedCenter = await prisma.$transaction(async (tx) => {
                const result = await tx.center.update({
                    where: { id: centerId },
                    data: updateData,
                    include: {
                        branch: {
                            select: {
                                id: true,
                                name: true,
                                code: true,
                            },
                        },
                        createdBy: {
                            select: {
                                id: true,
                                firstName: true,
                                lastName: true,
                                email: true,
                            },
                        },
                        fdo: {
                            select: {
                                id: true,
                                firstName: true,
                                lastName: true,
                                email: true,
                            },
                        },
                        approvedBy: {
                            select: {
                                id: true,
                                firstName: true,
                                lastName: true,
                                email: true,
                            },
                        },
                    },
                });

                if (action === 'APPROVE') {
                    const existingGroupCount = await tx.group.count({ where: { centerId } });
                    if (existingGroupCount === 0) {
                        await createNextGroupForCenter(tx, {
                            centerId,
                            createdById: user.userId,
                        });
                    }
                }

                return result;
            });

            const message = action === 'APPROVE'
                ? 'Center approved successfully'
                : 'Center rejected successfully';

            // Log the action for audit trail
            console.log(`[CENTER_APPROVAL] Center ${centerId} ${action.toLowerCase()}ed by AM ${user.userId}`, {
                centerId,
                action,
                approvedBy: user.userId,
                comments: comments || 'No comments',
                rejectionReason: rejectionReason || 'N/A',
            });

            return successResponse(updatedCenter, message, 200);
        } catch (error) {
            console.error('Error processing center approval:', error);

            if (error instanceof Error) {
                return errorResponse(`Failed to process center: ${error.message}`, 500);
            }

            return errorResponse('Failed to process center approval', 500);
        }
    })(request);
}
