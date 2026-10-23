import { NextRequest } from 'next/server';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/app/lib/db';
import { errorResponse, successResponse, handleCorsPreflight } from '@/app/lib/api-utils';
import { getUtcBoundsForBranchCalendarDay } from '@/app/lib/branch-lock';
import { requirePermission, isUserContext } from '@/app/lib/permissions/guards';
import { resolveLopLeaveType, getKolkataMonthBounds } from '@/app/lib/attendance-leave-permission';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const bodySchema = z.object({
    reason: z.string().min(1, 'A cancellation reason is required'),
});

// Same "used days" computation as GET /api/payroll/leave-balance and the approve
// route, scoped to the application's calendar month for Fixed Monthly Quota.
async function computeUsedDays(
    client: Prisma.TransactionClient,
    employeeId: string,
    leaveTypeId: string,
    referenceDate?: Date,
): Promise<number> {
    const { monthStartUtc, monthEndExclusiveUtc } = getKolkataMonthBounds(referenceDate);
    const attendances = await client.attendance.findMany({
        where: {
            userId: employeeId,
            leaveTypeId,
            status: { in: ['PRESENT', 'ABSENT', 'HALF_DAY'] },
            date: { gte: monthStartUtc, lt: monthEndExclusiveUtc },
        },
        select: { isHalfDayLeave: true },
    });
    return attendances.reduce((acc, curr) => acc + (curr.isHalfDayLeave ? 0.5 : 1), 0);
}

function eachDayInRange(fromDate: Date, toDate: Date): Date[] {
    const days: Date[] = [];
    const { dayStartUtc: from } = getUtcBoundsForBranchCalendarDay(fromDate);
    const { dayStartUtc: to } = getUtcBoundsForBranchCalendarDay(toDate);
    for (let t = from.getTime(); t <= to.getTime(); t += 24 * 60 * 60 * 1000) {
        days.push(new Date(t));
    }
    return days;
}

// POST /api/hr/leave/[id]/admin-cancel — cancels an already-APPROVED leave with
// a reason. RBAC-gated (hr-leave:override) rather than a hardcoded role — no
// role is granted it by default except ADMIN (who bypasses all checks), so this
// preserves today's admin-only behavior while letting an admin extend it to
// other roles from the Roles editor.
// Reverses the approval: clears the ABSENT/leave marking that approval stamped
// on Attendance for each day in range (so the employee can now mark present /
// punch in-out from the mobile app), and refreshes the cached
// EmployeeLeaveBalance snapshot.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const ctx = await requirePermission(request, 'hr-leave', 'override');
    if (!isUserContext(ctx)) return ctx;

    try {
        const { id } = await params;
        const body = await request.json();
        const { reason } = bodySchema.parse(body);

        const application = await prisma.leaveApplication.findUnique({
            where: { id },
            include: { employee: { select: { id: true, branchId: true } } },
        });
        if (!application) return errorResponse('Leave application not found', 404);
        if (application.status !== 'APPROVED') {
            return errorResponse(`Only an APPROVED leave can be admin-cancelled (this one is '${application.status}')`, 409);
        }

        const days = eachDayInRange(application.fromDate, application.toDate);

        // A multi-day application's *excess* days (beyond the employee's balance
        // at approval time) get stamped with the LOP type's id, not
        // `application.leaveTypeId` — re-resolve it so the reversal below can
        // recognize those rows too. Same underlying issue as half-day leave
        // going to LOP (see attendance-hr/plan-half-day-leave.md §9) — this
        // exact bug pre-dates half-day leave, in the original multi-day
        // insufficient-balance LOP-split feature.
        const lopType = await resolveLopLeaveType();

        const updated = await prisma.$transaction(async (tx) => {
            const fresh = await tx.leaveApplication.findUnique({ where: { id } });
            if (!fresh || fresh.status !== 'APPROVED') {
                throw new Error('Leave application status changed — please refresh and retry');
            }

            for (const date of days) {
                const row = await tx.attendance.findUnique({
                    where: { userId_date: { userId: application.employeeId, date } },
                });
                if (!row) continue;

                // A half-day leave that went to LOP stamps the LOP type's id, not
                // `application.leaveTypeId` — match on the `isHalfDayLeave` flag
                // this route's approval set instead. A whole-day (possibly
                // multi-day) leave normally stamps its own leaveTypeId, but its
                // excess days (if insufficient balance forced a partial LOP split)
                // stamp the LOP type instead — match either type for that case.
                // The overlap check on apply means no *other* approved leave could
                // have covered this date, so any LOP-stamped row inside this
                // application's own date range is safe to attribute to it.
                const isThisApplicationsRow = application.isHalfDay
                    ? row.isHalfDayLeave
                    : row.leaveTypeId === application.leaveTypeId || (lopType && row.leaveTypeId === lopType.id);
                if (!isThisApplicationsRow) continue;

                if (!row.checkIn && !row.checkOut) {
                    // Approval created this row purely to mark leave — drop it so a
                    // fresh mobile punch can create a clean Attendance record.
                    await tx.attendance.delete({ where: { id: row.id } });
                } else {
                    // Row already has a punch — just undo the leave marking. Also drop
                    // lopLocked defensively — a cancelled leave should never leave a
                    // stray permission-quota lock behind (see
                    // attendance-hr/plan-backdated-leave-removes-lop.md; the day just
                    // goes back to normal rather than restoring any prior LOP state).
                    await tx.attendance.update({
                        where: { id: row.id },
                        data: { status: 'PRESENT', leaveTypeId: null, lopLocked: false, isHalfDayLeave: false },
                    });
                }
            }

            const { month, year } = getKolkataMonthBounds(application.fromDate);
            const balance = await tx.employeeLeaveBalance.findUnique({
                where: { employeeId_leaveTypeId_month_year: { employeeId: application.employeeId, leaveTypeId: application.leaveTypeId, month, year } },
            });
            if (balance) {
                const totalAvailable = Math.round(Number(balance.openingBalance) + Number(balance.carriedForwardDays));
                const usedDays = await computeUsedDays(tx, application.employeeId, application.leaveTypeId, application.fromDate);
                await tx.employeeLeaveBalance.update({
                    where: { id: balance.id },
                    data: { remainingBalance: Math.max(0, totalAvailable - usedDays) },
                });
            }

            return tx.leaveApplication.update({
                where: { id },
                data: {
                    status: 'CANCELLED',
                    cancelledAt: new Date(),
                    cancelledById: ctx.userId,
                    cancelReason: reason,
                },
            });
        });

        return successResponse(updated, 'Approved leave cancelled; the employee can now mark attendance for those days.');
    } catch (error: unknown) {
        if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
        console.error('Error admin-cancelling leave application:', error);
        const message = error instanceof Error ? error.message : 'Failed to cancel approved leave';
        return errorResponse(message, 500);
    }
}
