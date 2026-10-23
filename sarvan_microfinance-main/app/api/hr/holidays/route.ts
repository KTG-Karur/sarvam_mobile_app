import { NextRequest } from 'next/server';
import { z } from 'zod';
import {
    errorResponse,
    successResponse,
    withAuth,
    handleCorsPreflight,
} from '@/app/lib/api-utils';
import { deleteHoliday, getHolidaysForBranch, upsertHoliday } from '@/app/lib/attendance-schedule';
import { getKolkataCalendarYmd } from '@/app/lib/branch-lock';
import { syncHolidayAttendance } from '@/app/lib/holiday-attendance-sync';
import { prisma } from '@/app/lib/prisma';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';
import { requirePermission, isUserContext } from '@/app/lib/permissions/guards';
import { getWritableBranchIds } from '@/app/lib/attendance-branch-access';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const ymdSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

const holidaySchema = z.object({
    branchId: z.string().min(1).optional(),
    date: ymdSchema,
    isWorkingDay: z.boolean().default(false),
    reason: z.string().trim().max(200).optional(),
    allBranches: z.boolean().optional(),
}).refine((d) => !!d.reason, {
    message: 'A reason is required',
    path: ['reason'],
});

const toStartUtc = (ymd: string) => new Date(`${ymd}T00:00:00+05:30`);

// GET /api/hr/holidays?branchId=&from=YYYY-MM-DD&to=YYYY-MM-DD
export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const params = new URL(req.url).searchParams;
            const requested = params.get('branchId');
            if (requested) {
                const permitted = await getPermittedBranchIds(user);
                if (permitted !== null && !permitted.includes(requested)) {
                    return errorResponse('You do not have access to this branch', 403);
                }
            }
            const branchId = requested ?? user.branchId;
            if (!branchId) return errorResponse('Branch is required', 400);

            const from = params.get('from');
            const to = params.get('to');
            if ((from && !ymdSchema.safeParse(from).success) || (to && !ymdSchema.safeParse(to).success)) {
                return errorResponse('from/to must be YYYY-MM-DD', 400);
            }

            const rows = await getHolidaysForBranch(branchId, {
                from: from ? toStartUtc(from) : undefined,
                to: to ? toStartUtc(to) : undefined,
            });
            return successResponse(
                rows.map((r) => ({
                    id: r.id,
                    branchId: r.branchId,
                    date: getKolkataCalendarYmd(r.date),
                    isWorkingDay: r.isWorkingDay,
                    reason: r.reason,
                })),
                'Holidays fetched',
            );
        } catch (error: any) {
            return errorResponse(error.message || 'Failed to fetch holidays', 500);
        }
    })(request);
}

// POST /api/hr/holidays — create or update the holiday / working-day override for a date.
export async function POST(request: NextRequest) {
    const ctx = await requirePermission(request, 'hr-attendance', 'edit');
    if (!isUserContext(ctx)) return ctx;

    try {
        const data = holidaySchema.parse(await request.json());
        const branchId = data.branchId ?? ctx.branchId;
        if (!branchId) return errorResponse('Branch is required', 400);
        const writable = await getWritableBranchIds(request, ctx);
        if (writable !== null && !writable.includes(branchId)) {
            return errorResponse('You do not have access to this branch', 403);
        }

        let targetBranchIds = [branchId];
        if (data.allBranches) {
            targetBranchIds = writable ?? (await prisma.branch.findMany({ where: { isActive: true }, select: { id: true } })).map((b) => b.id);
        }

        let saved!: Awaited<ReturnType<typeof upsertHoliday>>;
        for (const id of targetBranchIds) {
            const row = await upsertHoliday(id, data.date, data.isWorkingDay, data.reason || undefined, ctx.userId);
            await syncHolidayAttendance(id, data.date, !data.isWorkingDay);
            if (id === branchId || !saved) saved = row;
        }
        return successResponse(
            {
                id: saved.id,
                branchId,
                date: data.date,
                isWorkingDay: saved.isWorkingDay,
                reason: saved.reason,
            },
            'Holiday saved',
        );
    } catch (error: any) {
        if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
        return errorResponse(error.message || 'Failed to save holiday', 500);
    }
}

// DELETE /api/hr/holidays?branchId=&date=YYYY-MM-DD
export async function DELETE(request: NextRequest) {
    const ctx = await requirePermission(request, 'hr-attendance', 'edit');
    if (!isUserContext(ctx)) return ctx;

    try {
        const params = new URL(request.url).searchParams;
        const date = ymdSchema.parse(params.get('date'));
        const branchId = params.get('branchId') ?? ctx.branchId;
        if (!branchId) return errorResponse('Branch is required', 400);
        const writable = await getWritableBranchIds(request, ctx);
        if (writable !== null && !writable.includes(branchId)) {
            return errorResponse('You do not have access to this branch', 403);
        }

        await deleteHoliday(branchId, date);
        await syncHolidayAttendance(branchId, date, false);
        return successResponse({ branchId, date }, 'Holiday removed');
    } catch (error: any) {
        if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
        return errorResponse(error.message || 'Failed to remove holiday', 500);
    }
}
