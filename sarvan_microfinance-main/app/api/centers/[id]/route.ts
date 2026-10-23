import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/db';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
    withRole,
} from '@/app/lib/api-utils';
import { findConflictingCenterSchedule } from '@/app/lib/services/center-schedule.service';
import { bumpMasterDataVersion } from '@/app/lib/cache/master-data-cache';
import { isSubAdminUser } from '@/app/lib/permissions/sub-admin';

/**
 * Update center schema
 */
const updateCenterSchema = z.object({
    name: z.string().min(1, 'Center name is required').max(200, 'Center name is too long').optional(),
    code: z.string().min(1, 'Center ID is required').optional(), // numeric-only enforced on create only
    /** Required when `code` changes — stored in CenterIdChangeLog (Super Control audit history). */
    codeChangeReason: z.string().trim().optional(),
    address: z.string().optional().nullable(),
    localArea: z.string().optional().nullable(),
    fdoId: z.string().min(1, 'FDO ID is required').optional(),
    formationDate: z.string().optional(),
    meetingDay: z.string().optional(),
    meetingTime: z.string().optional(),
    meetingPlace: z.string().optional().nullable(),
    latitude: z.number().optional().nullable(),
    longitude: z.number().optional().nullable(),
    isActive: z.boolean().optional(),
    centerLeaderId: z.string().optional().nullable(),
    kmFromBranch: z.number().optional().nullable(),
    contactPerson: z.string().optional().nullable(),
    contactNumber: z.string().optional().nullable(),
});

/**
 * @swagger
 * /api/centers/{id}:
 *   get:
 *     tags:
 *       - Centers
 *     summary: Get Center by ID
 *     description: |
 *       Fetch a specific center.
 *       - **Branch Managers**: Only their branch's centers
 *       - **Admin**: Any center
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Center fetched successfully
 *       403:
 *         description: Cannot access center from other branch
 *       404:
 *         description: Center not found
 *   patch:
 *     tags:
 *       - Centers
 *     summary: Update Center
 *     description: Update center details. Branch Managers can update their branch's centers.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               code:
 *                 type: string
 *               address:
 *                 type: string
 *                 nullable: true
 *               fdoId:
 *                 type: string
 *               meetingDay:
 *                 type: string
 *               meetingTime:
 *                 type: string
 *               isActive:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Center updated successfully
 *       404:
 *         description: Center not found
 *   delete:
 *     tags:
 *       - Centers
 *     summary: Delete Center
 *     description: Soft delete a center. Cannot delete with active clients or loans.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Center deleted successfully
 *       400:
 *         description: Cannot delete center with active clients/loans
 *       404:
 *         description: Center not found
 */

/**
 * OPTIONS handler for CORS preflight
 */
export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/centers/[id]
 * Get center by ID
 * - Branch Managers can only fetch centers from their branch
 * - Admins can fetch any center
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    return withAuth(async (req, user) => {
        try {
            const center = await prisma.center.findUnique({
                where: { id },
                select: {
                    id: true,
                    name: true,
                    code: true,
                    address: true,
                    localArea: true,
                    branchId: true,
                    status: true,
                    fdoId: true,
                    formationDate: true,
                    nextMeetingDate: true,
                    meetingDay: true,
                    meetingTime: true,
                    meetingPlace: true,
                    latitude: true,
                    longitude: true,
                    kmFromBranch: true,
                    contactPerson: true,
                    contactNumber: true,
                    rejectionReason: true,
                    approvedById: true,
                    approvedAt: true,
                    centerLeaderId: true,
                    isActive: true,
                    createdAt: true,
                    updatedAt: true,
                    approvedBy: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            email: true,
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
                    branch: {
                        select: {
                            id: true,
                            name: true,
                            code: true,
                        },
                    },
                    centerLeader: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            clientId: true,
                        },
                    },
                },
            });

            if (!center) {
                return errorResponse('Center not found', 404);
            }

            // Branch Managers can only see centers from their branch
            if (user.role === 'BRANCH_MANAGER') {
                const userRecord = await prisma.user.findUnique({
                    where: { id: user.userId },
                    select: { branchId: true },
                });

                if (!userRecord || userRecord.branchId !== center.branchId) {
                    return errorResponse('Insufficient permissions', 403);
                }
            }

            return successResponse(center, 'Center fetched successfully');
        } catch (error) {
            console.error('Error fetching center:', error);
            return errorResponse('Failed to fetch center', 500);
        }
    })(request);
}

/**
 * PATCH /api/centers/[id]
 * Update center (Branch Manager can update their own centers, Admin can update any)
 */
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    return withAuth(async (req, user) => {
        try {
            // Check if center exists
            const existingCenter = await prisma.center.findUnique({
                where: { id },
                select: {
                    id: true,
                    code: true,
                    branchId: true,
                    createdById: true,
                    fdoId: true,
                    meetingDay: true,
                    meetingTime: true,
                },
            });

            if (!existingCenter) {
                return errorResponse('Center not found', 404);
            }

            // Branch Managers can only update centers from their branch
            if (user.role === 'BRANCH_MANAGER') {
                const userRecord = await prisma.user.findUnique({
                    where: { id: user.userId },
                    select: { branchId: true },
                });

                if (!userRecord || userRecord.branchId !== existingCenter.branchId) {
                    return errorResponse('Insufficient permissions', 403);
                }
            }

            const body = await req.json();

            // Validate request body
            const validationResult = updateCenterSchema.safeParse(body);
            if (!validationResult.success) {
                return errorResponse(
                    validationResult.error.errors[0]?.message || 'Invalid request data',
                    400
                );
            }

            const data = validationResult.data;

            // Verify FDO if being updated
            if (data.fdoId) {
                const fdo = await prisma.user.findUnique({
                    where: { id: data.fdoId },
                    select: { id: true, role: true, branchId: true },
                });

                if (!fdo) {
                    return errorResponse('FDO not found', 404);
                }

                if (fdo.role !== 'FDO') {
                    return errorResponse('Selected user is not an FDO', 400);
                }

                if (fdo.branchId !== existingCenter.branchId) {
                    return errorResponse('FDO does not belong to the same branch', 400);
                }
            }

            // Block assigning this FDO to a second center at the same meeting day + time
            const effectiveFdoId = data.fdoId !== undefined ? data.fdoId : existingCenter.fdoId;
            const effectiveMeetingDay = data.meetingDay !== undefined ? data.meetingDay : existingCenter.meetingDay;
            const effectiveMeetingTime = data.meetingTime !== undefined ? data.meetingTime : existingCenter.meetingTime;

            if (effectiveFdoId && effectiveMeetingDay && effectiveMeetingTime) {
                const scheduleConflict = await findConflictingCenterSchedule({
                    fdoId: effectiveFdoId,
                    meetingDay: effectiveMeetingDay,
                    meetingTime: effectiveMeetingTime,
                    excludeCenterId: id,
                });

                if (scheduleConflict) {
                    return errorResponse(
                        'This FDO already has a meeting time assigned for this meeting day. Please choose another meeting time or meeting day.',
                        409
                    );
                }
            }

            // Check code uniqueness if code is being updated
            let codeChange: { oldCode: string; newCode: string; reason: string } | null = null;
            if (data.code) {
                const normalizedNewCode = data.code.trim();
                const normalizedExistingCode = existingCenter.code?.trim();

                if (normalizedNewCode !== normalizedExistingCode) {
                    // Changing an existing Center ID is Admin/Sub Admin only
                    const canEditCode = user.role === 'ADMIN' || await isSubAdminUser(user.userId);
                    if (!canEditCode) {
                        return errorResponse('Only Admin or Sub Admin can change the Center ID', 403);
                    }

                    const codeExists = await prisma.center.findFirst({
                        where: { branchId: existingCenter.branchId, code: normalizedNewCode },
                    });

                    if (codeExists) {
                        return errorResponse(`Center ID ${normalizedNewCode} already exists in this branch`, 409);
                    }

                    const reason = data.codeChangeReason ?? '';
                    if (reason.length < 5) {
                        return errorResponse('Reason for changing the Center ID is required (min 5 characters)', 400);
                    }
                    codeChange = { oldCode: existingCenter.code, newCode: normalizedNewCode, reason };
                }
            }

            // Build update data
            const updateData: {
                name?: string;
                code?: string;
                address?: string | null;
                localArea?: string | null;
                fdoId?: string | null;
                formationDate?: Date | null;
                meetingDay?: string | null;
                meetingTime?: string | null;
                meetingPlace?: string | null;
                latitude?: number | null;
                longitude?: number | null;
                isActive?: boolean;
                centerLeaderId?: string | null;
                kmFromBranch?: number | null;
                contactPerson?: string | null;
                contactNumber?: string | null;
            } = {};

            if (data.name) updateData.name = data.name.trim();
            if (data.code) updateData.code = data.code.trim();
            if (data.address !== undefined) updateData.address = data.address?.trim() || null;
            if (data.localArea !== undefined) updateData.localArea = data.localArea?.trim() || null;
            if (data.fdoId !== undefined) updateData.fdoId = data.fdoId || null;
            if (data.formationDate !== undefined) updateData.formationDate = data.formationDate ? new Date(data.formationDate) : null;
            if (data.meetingDay !== undefined) updateData.meetingDay = data.meetingDay?.trim() || null;
            if (data.meetingTime !== undefined) updateData.meetingTime = data.meetingTime?.trim() || null;
            if (data.meetingPlace !== undefined) updateData.meetingPlace = data.meetingPlace?.trim() || null;
            if (data.latitude !== undefined) updateData.latitude = data.latitude || null;
            if (data.longitude !== undefined) updateData.longitude = data.longitude || null;
            if (data.isActive !== undefined) updateData.isActive = data.isActive;
            if (data.centerLeaderId !== undefined) updateData.centerLeaderId = data.centerLeaderId || null;
            if (data.kmFromBranch !== undefined) updateData.kmFromBranch = data.kmFromBranch ?? null;
            if (data.contactPerson !== undefined) updateData.contactPerson = data.contactPerson?.trim() || null;
            if (data.contactNumber !== undefined) updateData.contactNumber = data.contactNumber?.trim() || null;

            // Update center (+ Center ID audit row in the same transaction)
            const center = await prisma.$transaction(async (tx) => {
                if (codeChange) {
                    await tx.centerIdChangeLog.create({
                        data: {
                            centerDbId: id,
                            oldCode: codeChange.oldCode,
                            newCode: codeChange.newCode,
                            changedById: user.userId,
                            reason: codeChange.reason,
                        },
                    });
                }
                return tx.center.update({
                    where: { id },
                    data: updateData,
                    select: {
                        id: true,
                        name: true,
                        code: true,
                        address: true,
                        localArea: true,
                        branchId: true,
                        status: true,
                        fdoId: true,
                        formationDate: true,
                        nextMeetingDate: true,
                        meetingDay: true,
                        meetingTime: true,
                        meetingPlace: true,
                        latitude: true,
                        longitude: true,
                        kmFromBranch: true,
                        contactPerson: true,
                        contactNumber: true,
                        rejectionReason: true,
                        approvedById: true,
                        approvedAt: true,
                        isActive: true,
                        createdAt: true,
                        updatedAt: true,
                        approvedBy: {
                            select: {
                                id: true,
                                firstName: true,
                                lastName: true,
                                email: true,
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
                        branch: {
                            select: {
                                id: true,
                                name: true,
                                code: true,
                            },
                        },
                        centerLeader: {
                            select: {
                                id: true,
                                firstName: true,
                                lastName: true,
                                clientId: true,
                            },
                        },
                    },
                });
            });

            await bumpMasterDataVersion('centers:minimal');
            return successResponse(center, 'Center updated successfully');
        } catch (error) {
            console.error('Error updating center:', error);
            // Handle Prisma unique constraint error
            if (error instanceof Error && error.message.includes('Unique constraint')) {
                return errorResponse('Center code must be unique', 409);
            }
            return errorResponse('Failed to update center', 500);
        }
    })(request);
}

/**
 * DELETE /api/centers/[id]
 * Delete center (Branch Manager can delete their own centers, Admin can delete any)
 * Soft delete by setting isActive to false
 */
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    return withAuth(async (req, user) => {
        try {
            // Check if center exists
            const center = await prisma.center.findUnique({
                where: { id },
                include: {
                    clients: {
                        where: { isActive: true },
                        select: { id: true },
                    },
                    loans: {
                        where: { isActive: true },
                        select: { id: true },
                    },
                },
            });

            if (!center) {
                return errorResponse('Center not found', 404);
            }

            // Branch Managers can only delete centers from their branch
            if (user.role === 'BRANCH_MANAGER') {
                const userRecord = await prisma.user.findUnique({
                    where: { id: user.userId },
                    select: { branchId: true },
                });

                if (!userRecord || userRecord.branchId !== center.branchId) {
                    return errorResponse('Insufficient permissions', 403);
                }
            }

            if (!center.isActive) {
                return errorResponse('Center is already deleted', 400);
            }

            // Check if center has active clients or loans
            if (center.clients.length > 0) {
                return errorResponse(
                    'Cannot delete center with active clients. Please deactivate clients first.',
                    400
                );
            }

            if (center.loans.length > 0) {
                return errorResponse(
                    'Cannot delete center with active loans. Please deactivate loans first.',
                    400
                );
            }

            // Soft delete by setting isActive to false
            await prisma.center.update({
                where: { id },
                data: { isActive: false },
            });

            await bumpMasterDataVersion('centers:minimal');
            return successResponse(null, 'Center deleted successfully');
        } catch (error) {
            console.error('Error deleting center:', error);
            return errorResponse('Failed to delete center', 500);
        }
    })(request);
}

