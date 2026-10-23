import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { errorResponse, successResponse, withAuth, handleCorsPreflight } from '@/app/lib/api-utils';
import { z } from 'zod';
import { getUserContext } from '@/app/lib/permissions/guards';
import { checkPermission } from '@/app/lib/permissions/engine';

const leaveTypeSchema = z.object({
    leaveType: z.string().min(1, 'Leave Type name is required').optional(),
    isLop: z.boolean().optional(),
    // Proof rule: null = never required, N = required when the leave is MORE THAN N days, 0 = always.
    attachmentRequiredAboveDays: z.number().min(0).max(365).nullable().optional(),
    isActive: z.boolean().optional(),
    // Carry-forward: see attendance-hr/plan-leave-carry-forward.md. When
    // allowCarryForward is true, carryForwardMaxDays must be a non-negative
    // number (the cap on how much unused balance rolls into the next month).
    allowCarryForward: z.boolean().optional(),
    carryForwardMaxDays: z.number().min(0).max(365).nullable().optional(),
}).refine((data) => !data.allowCarryForward || (data.carryForwardMaxDays != null && data.carryForwardMaxDays >= 0), {
    message: 'Carry-forward max days is required when carry-forward is enabled',
    path: ['carryForwardMaxDays'],
});

export async function OPTIONS() {
    return handleCorsPreflight();
}

// Helper to safely get the LeaveType model
function getLeaveTypeModel() {
    const model = (prisma as any).leaveType;
    if (!model) {
        console.error('LeaveType model is MISSING from prisma client. This usually requires a server restart after schema changes.');
        throw new Error('Database client sync error. Please restart the server.');
    }
    return model;
}

export async function GET(request: NextRequest) {
    return withAuth(async (req) => {
        try {
            const { searchParams } = new URL(req.url);
            const wantsInactive = searchParams.get('includeInactive') === 'true' || searchParams.get('all') === 'true';
            // Disabled types are for the master screen only. Employees / the mobile app always get
            // active types, even if they pass the flag — only approvers/admins may ask for inactive ones.
            let includeInactive = false;
            if (wantsInactive) {
                const ctx = await getUserContext(req);
                includeInactive = !!ctx && checkPermission(ctx, { moduleSlug: 'hr-leave', actionSlug: 'approve' }).allowed;
            }
            const model = getLeaveTypeModel();
            const whereClause = includeInactive ? {} : { isActive: true };
            const leaveTypes = await model.findMany({
                where: whereClause,
                orderBy: { typeId: 'asc' },
            });
            return successResponse(leaveTypes, 'Leave types fetched successfully');
        } catch (error: any) {
            console.error('Error fetching leave types:', error);
            return errorResponse(error.message || 'Failed to fetch leave types', 500);
        }
    })(request);
}

export async function POST(request: NextRequest) {
    return withAuth(async (req) => {
        try {
            const model = getLeaveTypeModel();
            const body = await req.json();
            const validation = leaveTypeSchema.safeParse(body);
            if (!validation.success) {
                return errorResponse(validation.error.errors[0].message, 400);
            }

            const { leaveType, isLop, isActive, attachmentRequiredAboveDays, allowCarryForward, carryForwardMaxDays } = validation.data;
            if (!leaveType) {
                return errorResponse('Leave Type name is required', 400);
            }

            // Check if already exists
            const existing = await model.findFirst({
                where: { leaveType: { equals: leaveType, mode: 'insensitive' } },
            });

            if (existing) {
                return errorResponse('Leave Type already exists', 400);
            }

            // Only one leave type may be flagged as the system Loss-of-Pay type at
            // a time — clear any previous holder before assigning it here.
            if (isLop) {
                await model.updateMany({ where: { isLop: true }, data: { isLop: false } });
            }

            // Get next typeId
            const lastType = await model.findFirst({
                orderBy: { typeId: 'desc' },
            });
            const nextTypeId = (lastType?.typeId || 0) + 1;

            const newLeaveType = await model.create({
                data: {
                    typeId: nextTypeId,
                    leaveType: leaveType.toUpperCase(),
                    isLop: !!isLop,
                    isActive: isActive !== undefined ? isActive : true,
                    attachmentRequiredAboveDays: attachmentRequiredAboveDays ?? null,
                    allowCarryForward: !!allowCarryForward,
                    carryForwardMaxDays: allowCarryForward ? carryForwardMaxDays : null,
                },
            });

            return successResponse(newLeaveType, 'Leave type created successfully', 201);
        } catch (error: any) {
            console.error('Error creating leave type:', error);
            return errorResponse(error.message || 'Failed to create leave type', 500);
        }
    })(request);
}

export async function PUT(request: NextRequest) {
    return withAuth(async (req) => {
        try {
            const model = getLeaveTypeModel();
            const { searchParams } = new URL(req.url);
            const id = searchParams.get('id');
            if (!id) return errorResponse('ID is required', 400);

            const body = await req.json();
            const validation = leaveTypeSchema.safeParse(body);
            if (!validation.success) {
                return errorResponse(validation.error.errors[0].message, 400);
            }

            const { leaveType, isLop, isActive, attachmentRequiredAboveDays, allowCarryForward, carryForwardMaxDays } = validation.data;

            if (leaveType) {
                const existing = await model.findFirst({
                    where: {
                        leaveType: { equals: leaveType, mode: 'insensitive' },
                        NOT: { id },
                    },
                });
                if (existing) {
                    return errorResponse('Leave Type name already exists', 400);
                }
            }

            if (isLop) {
                await model.updateMany({ where: { isLop: true, NOT: { id } }, data: { isLop: false } });
            }

            const updateData: any = {};
            if (leaveType !== undefined) updateData.leaveType = leaveType.toUpperCase();
            if (isLop !== undefined) updateData.isLop = isLop;
            if (isActive !== undefined) updateData.isActive = isActive;
            if (attachmentRequiredAboveDays !== undefined) updateData.attachmentRequiredAboveDays = attachmentRequiredAboveDays;
            if (allowCarryForward !== undefined) {
                updateData.allowCarryForward = allowCarryForward;
                updateData.carryForwardMaxDays = allowCarryForward ? carryForwardMaxDays : null;
            }

            const updatedLeaveType = await model.update({
                where: { id },
                data: updateData,
            });

            return successResponse(updatedLeaveType, 'Leave type updated successfully');
        } catch (error: any) {
            console.error('Error updating leave type:', error);
            return errorResponse(error.message || 'Failed to update leave type', 500);
        }
    })(request);
}

export async function DELETE(request: NextRequest) {
    return withAuth(async (req) => {
        try {
            const model = getLeaveTypeModel();
            const { searchParams } = new URL(req.url);
            const id = searchParams.get('id');
            if (!id) return errorResponse('ID is required', 400);

            // Soft delete
            await model.update({
                where: { id },
                data: { isActive: false },
            });

            return successResponse(null, 'Leave type deleted successfully');
        } catch (error: any) {
            console.error('Error deleting leave type:', error);
            return errorResponse(error.message || 'Failed to delete leave type', 500);
        }
    })(request);
}
