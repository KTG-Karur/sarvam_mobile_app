import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse, withAuth } from '@/app/lib/api-utils';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';
import { getKolkataCalendarYmd, getUtcBoundsForBranchCalendarDay } from '@/app/lib/branch-lock';

export async function OPTIONS() {
    return handleCorsPreflight();
}

// GET /api/hr/dashboard/kpis — branch-scoped HR dashboard KPI tiles.
export async function GET(request: NextRequest) {
    return withAuth(async (_req, user) => {
        try {
            const permittedBranchIds = await getPermittedBranchIds(user);
            const branchFilter = permittedBranchIds ? { branchId: { in: permittedBranchIds } } : {};

            const now = new Date();
            const { dayStartUtc: todayStart, dayEndUtc: todayEnd } = getUtcBoundsForBranchCalendarDay(now);
            const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

            const [
                totalEmployees,
                activeEmployees,
                newJoinings,
                pendingConfirmation,
                pendingPromotion,
                pendingTransfer,
                pendingExit,
                onLeaveToday,
                todayPresent,
                todayAbsent,
                checkedInNoCheckoutToday,
            ] = await Promise.all([
                prisma.user.count({ where: branchFilter }),
                prisma.user.count({ where: { ...branchFilter, isActive: true } }),
                prisma.user.count({ where: { ...branchFilter, dateOfJoining: { gte: monthStart } } }),
                prisma.employeeConfirmation.count({ where: { status: 'PENDING', employee: branchFilter } }),
                prisma.employeePromotion.count({ where: { status: 'PENDING', employee: branchFilter } }),
                prisma.employeeTransfer.count({ where: { status: { in: ['PENDING', 'IN_PROGRESS'] }, employee: branchFilter } }),
                prisma.employeeExitRequest.count({ where: { status: { in: ['IN_PROGRESS', 'HR_APPROVED'] }, employee: branchFilter } }),
                prisma.leaveApplication.count({
                    where: { status: 'APPROVED', fromDate: { lte: todayEnd }, toDate: { gte: todayStart }, employee: branchFilter },
                }),
                prisma.attendance.count({ where: { ...branchFilter, date: todayStart, status: { in: ['PRESENT', 'HALF_DAY'] } } }),
                prisma.attendance.count({ where: { ...branchFilter, date: todayStart, status: 'ABSENT' } }),
                prisma.attendance.count({ where: { ...branchFilter, date: todayStart, checkIn: { not: null }, checkOut: null } }),
            ]);

            return successResponse({
                asOf: getKolkataCalendarYmd(now),
                totalEmployees,
                activeEmployees,
                inactiveEmployees: totalEmployees - activeEmployees,
                newJoiningsThisMonth: newJoinings,
                pendingConfirmation,
                pendingPromotion,
                pendingTransfer,
                pendingExit,
                employeesOnLeaveToday: onLeaveToday,
                todayPresent,
                todayAbsent,
                // "Currently active" = punched in and not yet punched out today.
                // "Currently on field" needs live GPS tracking (HR Phase 7) — not
                // available yet, so intentionally omitted rather than guessed.
                employeesCurrentlyActive: checkedInNoCheckoutToday,
            }, 'HR dashboard KPIs fetched successfully');
        } catch (error: any) {
            console.error('Error fetching HR dashboard KPIs:', error);
            return errorResponse(error.message || 'Failed to fetch HR dashboard KPIs', 500);
        }
    })(request);
}
