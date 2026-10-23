import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { errorResponse, successResponse, withAuth, handleCorsPreflight } from '@/app/lib/api-utils';
import { z } from 'zod';
import { getUserContext, requirePermission, isUserContext } from '@/app/lib/permissions/guards';
import { checkPermission } from '@/app/lib/permissions/engine';

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

const shiftSchema = z.object({
    name: z.string().min(1, 'Shift name is required').optional(),
    shiftStart: z.string().regex(HHMM, 'shiftStart must be HH:MM').optional(),
    shiftEnd: z.string().regex(HHMM, 'shiftEnd must be HH:MM').optional(),
    fullDayHours: z.number().min(0).max(24).optional(),
    halfDayHours: z.number().min(0).max(24).optional(),
    graceMinutes: z.number().int().min(0).max(240).optional(),
    isDefault: z.boolean().optional(),
    isActive: z.boolean().optional(),
}).refine((v) => !(v.shiftStart && v.shiftEnd) || v.shiftEnd > v.shiftStart, {
    message: 'shiftEnd must be after shiftStart',
    path: ['shiftEnd'],
}).refine((v) => v.halfDayHours === undefined || v.fullDayHours === undefined || v.halfDayHours <= v.fullDayHours, {
    message: 'Half-day hours cannot exceed full-day hours',
    path: ['halfDayHours'],
});

export async function OPTIONS() {
    return handleCorsPreflight();
}

function getShiftModel() {
    const model = (prisma as any).shift;
    if (!model) {
        console.error('Shift model is MISSING from prisma client. This usually requires a server restart after schema changes.');
        throw new Error('Database client sync error. Please restart the server.');
    }
    return model;
}

// GET /api/hr/shifts — active shifts for everyone; ?includeInactive=true / ?all=true
// (Shift Management screen only) requires hr-attendance:edit, same gate as Working Hours.
export async function GET(request: NextRequest) {
    return withAuth(async (req) => {
        try {
            const { searchParams } = new URL(req.url);
            const wantsInactive = searchParams.get('includeInactive') === 'true' || searchParams.get('all') === 'true';
            let includeInactive = false;
            if (wantsInactive) {
                const ctx = await getUserContext(req);
                includeInactive = !!ctx && checkPermission(ctx, { moduleSlug: 'hr-attendance', actionSlug: 'edit' }).allowed;
            }
            const model = getShiftModel();
            const shifts = await model.findMany({
                where: includeInactive ? {} : { isActive: true },
                orderBy: { name: 'asc' },
            });
            return successResponse(shifts, 'Shifts fetched successfully');
        } catch (error: any) {
            console.error('Error fetching shifts:', error);
            return errorResponse(error.message || 'Failed to fetch shifts', 500);
        }
    })(request);
}

export async function POST(request: NextRequest) {
    const ctx = await requirePermission(request, 'hr-attendance', 'edit');
    if (!isUserContext(ctx)) return ctx;
    try {
        const model = getShiftModel();
        const body = await request.json();
        const validation = shiftSchema.safeParse(body);
        if (!validation.success) return errorResponse(validation.error.errors[0].message, 400);

        const { name, shiftStart, shiftEnd, fullDayHours, halfDayHours, graceMinutes, isDefault, isActive } = validation.data;
        if (!name || !shiftStart || !shiftEnd) {
            return errorResponse('name, shiftStart and shiftEnd are required', 400);
        }

        const existing = await model.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } });
        if (existing) return errorResponse('A shift with this name already exists', 400);

        // Only one shift may be the default (fallback for unassigned employees) at a time —
        // same single-holder pattern as LeaveType.isLop.
        if (isDefault) {
            await model.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
        }

        const shift = await model.create({
            data: {
                name, shiftStart, shiftEnd,
                fullDayHours: fullDayHours ?? 8,
                halfDayHours: halfDayHours ?? 0,
                graceMinutes: graceMinutes ?? 15,
                isDefault: !!isDefault,
                isActive: isActive !== undefined ? isActive : true,
            },
        });
        return successResponse(shift, 'Shift created successfully', 201);
    } catch (error: any) {
        console.error('Error creating shift:', error);
        return errorResponse(error.message || 'Failed to create shift', 500);
    }
}

export async function PUT(request: NextRequest) {
    const ctx = await requirePermission(request, 'hr-attendance', 'edit');
    if (!isUserContext(ctx)) return ctx;
    try {
        const model = getShiftModel();
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');
        if (!id) return errorResponse('ID is required', 400);

        const body = await request.json();
        const validation = shiftSchema.safeParse(body);
        if (!validation.success) return errorResponse(validation.error.errors[0].message, 400);

        const { name, shiftStart, shiftEnd, fullDayHours, halfDayHours, graceMinutes, isDefault, isActive } = validation.data;
        if (name) {
            const existing = await model.findFirst({ where: { name: { equals: name, mode: 'insensitive' }, NOT: { id } } });
            if (existing) return errorResponse('A shift with this name already exists', 400);
        }
        if (isDefault === false) {
            const current = await model.findUnique({ where: { id } });
            if (current?.isDefault) return errorResponse('At least one shift must be marked as the default — assign a different shift as default first', 400);
        }
        if (isActive === false) {
            const current = await model.findUnique({ where: { id } });
            if (current?.isDefault) return errorResponse('Cannot disable the default shift — assign a different shift as default first', 409);
        }

        if (isDefault) {
            await model.updateMany({ where: { isDefault: true, NOT: { id } }, data: { isDefault: false } });
        }

        const updateData: Record<string, unknown> = {};
        if (name !== undefined) updateData.name = name;
        if (shiftStart !== undefined) updateData.shiftStart = shiftStart;
        if (shiftEnd !== undefined) updateData.shiftEnd = shiftEnd;
        if (fullDayHours !== undefined) updateData.fullDayHours = fullDayHours;
        if (halfDayHours !== undefined) updateData.halfDayHours = halfDayHours;
        if (graceMinutes !== undefined) updateData.graceMinutes = graceMinutes;
        if (isDefault !== undefined) updateData.isDefault = isDefault;
        if (isActive !== undefined) updateData.isActive = isActive;

        const updated = await model.update({ where: { id }, data: updateData });
        return successResponse(updated, 'Shift updated successfully');
    } catch (error: any) {
        console.error('Error updating shift:', error);
        return errorResponse(error.message || 'Failed to update shift', 500);
    }
}

export async function DELETE(request: NextRequest) {
    const ctx = await requirePermission(request, 'hr-attendance', 'edit');
    if (!isUserContext(ctx)) return ctx;
    try {
        const model = getShiftModel();
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');
        if (!id) return errorResponse('ID is required', 400);

        const shift = await model.findUnique({ where: { id } });
        if (shift?.isDefault) {
            return errorResponse('Cannot disable the default shift — assign a different shift as default first', 409);
        }

        const assignedCount = await prisma.user.count({ where: { shiftId: id } });
        if (assignedCount > 0) {
            return errorResponse(`Cannot disable — ${assignedCount} employee(s) are still assigned to this shift`, 409);
        }

        await model.update({ where: { id }, data: { isActive: false } });
        return successResponse(null, 'Shift disabled successfully');
    } catch (error: any) {
        console.error('Error deleting shift:', error);
        return errorResponse(error.message || 'Failed to delete shift', 500);
    }
}
