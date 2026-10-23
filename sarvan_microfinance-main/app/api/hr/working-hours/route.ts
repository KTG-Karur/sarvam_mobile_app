import { NextRequest } from 'next/server';
import { z } from 'zod';
import {
    errorResponse,
    successResponse,
    withAuth,
    handleCorsPreflight,
} from '@/app/lib/api-utils';
import { getWorkingHours, saveWorkingHours } from '@/app/lib/working-hours';
import { requirePermission, isUserContext } from '@/app/lib/permissions/guards';

export async function OPTIONS() {
    return handleCorsPreflight();
}

// Shift timing (start/end) and the Full Day / Half Day punch thresholds are set per-shift
// on the Shift Management page - see app/lib/employee-shift.ts. Only these company-wide
// Payroll settings remain editable here (`fullDayHours` is Payroll's day-length divisor,
// unrelated to which shift an employee punches under). The working_hours_settings row still
// stores shiftStart/shiftEnd/halfDayHours/graceMinutes as a last-resort fallback (see
// resolveDefaultShiftConfig) but they are not exposed here for editing.
// Weekly off schedule moved to the per-branch `WeekConfiguration` table/page — see
// app/lib/attendance-schedule.ts and components/hr/attendance/WeekConfigurationClient.tsx.
const workingHoursSchema = z.object({
    fullDayHours: z.number().min(0).max(24).optional(),
    permissionHoursLopThreshold: z.number().min(0).max(200).optional(),
    // HH:MM (Asia/Kolkata) — see attendance-config.ts's AutoCheckoutTime comment.
    autoCheckoutTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour)').optional(),
});

// GET /api/hr/working-hours — Payroll's day-length + permission-hours LOP threshold.
export async function GET(request: NextRequest) {
    return withAuth(async () => {
        try {
            return successResponse(await getWorkingHours(), 'Working hours fetched');
        } catch (error: any) {
            return errorResponse(error.message || 'Failed to fetch working hours', 500);
        }
    })(request);
}

// PUT /api/hr/working-hours — partial update of the Payroll-only settings above.
// RBAC-gated (hr-attendance:edit) rather than a hardcoded role list — whoever's
// role grants that module+action can change it. Same gate as Shift Management.
export async function PUT(request: NextRequest) {
    const ctx = await requirePermission(request, 'hr-attendance', 'edit');
    if (!isUserContext(ctx)) return ctx;

    try {
        const body = await request.json();
        const data = workingHoursSchema.parse(body);
        const updated = await saveWorkingHours(data, ctx.userId);
        return successResponse(updated, 'Working hours updated');
    } catch (error: any) {
        if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
        return errorResponse(error.message || 'Failed to update working hours', 500);
    }
}
