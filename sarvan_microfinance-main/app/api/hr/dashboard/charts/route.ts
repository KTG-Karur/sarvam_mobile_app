import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse, withAuth } from '@/app/lib/api-utils';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';
import { getUtcBoundsForBranchCalendarDay } from '@/app/lib/branch-lock';

export async function OPTIONS() {
    return handleCorsPreflight();
}

// GET /api/hr/dashboard/charts — branch-scoped breakdowns + trends.
//
// Deliberately NOT charted: Region. Branch<->Area is an implicit many-to-many
// in this schema (no areaId scalar on Branch) — a branch can belong to more
// than one Area, so "count by Region" (via Branch -> Area -> Division ->
// Region) would double-count any employee whose branch sits under multiple
// areas. Department/Designation/Branch are all direct scalar FKs on User, so
// they're unambiguous and safe to chart.
export async function GET(request: NextRequest) {
    return withAuth(async (_req, user) => {
        try {
            const permittedBranchIds = await getPermittedBranchIds(user);
            const branchFilter = permittedBranchIds ? { branchId: { in: permittedBranchIds } } : {};

            const [byDepartment, byDesignation, byBranch] = await Promise.all([
                prisma.user.groupBy({
                    by: ['departmentId'],
                    where: { ...branchFilter, isActive: true, departmentId: { not: null } },
                    _count: { _all: true },
                }),
                prisma.user.groupBy({
                    by: ['designationId'],
                    where: { ...branchFilter, isActive: true, designationId: { not: null } },
                    _count: { _all: true },
                }),
                prisma.user.groupBy({
                    by: ['branchId'],
                    where: { ...branchFilter, isActive: true, branchId: { not: null } },
                    _count: { _all: true },
                }),
            ]);

            const [departments, designations, branches] = await Promise.all([
                prisma.department.findMany({ where: { id: { in: byDepartment.map((d) => d.departmentId!) } } }),
                prisma.designation.findMany({ where: { id: { in: byDesignation.map((d) => d.designationId!) } } }),
                prisma.branch.findMany({ where: { id: { in: byBranch.map((d) => d.branchId!) } } }),
            ]);

            const departmentMap = new Map(departments.map((d) => [d.id, d.name]));
            const designationMap = new Map(designations.map((d) => [d.id, d.name]));
            const branchMap = new Map(branches.map((b) => [b.id, b.name]));

            // ── Attendance trend: last 14 calendar days ──
            const today = new Date();
            const days: { date: string; dayStart: Date; dayEnd: Date }[] = [];
            for (let i = 13; i >= 0; i--) {
                const d = new Date(today);
                d.setDate(d.getDate() - i);
                const { dayStartUtc, dayEndUtc } = getUtcBoundsForBranchCalendarDay(d);
                days.push({ date: dayStartUtc.toISOString().slice(0, 10), dayStart: dayStartUtc, dayEnd: dayEndUtc });
            }
            const attendanceRows = await prisma.attendance.findMany({
                where: { ...branchFilter, date: { gte: days[0].dayStart, lte: days[days.length - 1].dayEnd } },
                select: { date: true, status: true },
            });
            const attendanceTrend = days.map(({ date, dayStart }) => {
                const rowsForDay = attendanceRows.filter((r) => r.date.getTime() === dayStart.getTime());
                return {
                    date,
                    present: rowsForDay.filter((r) => r.status === 'PRESENT' || r.status === 'HALF_DAY').length,
                    absent: rowsForDay.filter((r) => r.status === 'ABSENT').length,
                };
            });

            // ── Joining & leave trend: last 6 months ──
            const sixMonthsAgo = new Date(today.getFullYear(), today.getMonth() - 5, 1);
            const [joinings, leaveApplications] = await Promise.all([
                prisma.user.findMany({
                    where: { ...branchFilter, dateOfJoining: { gte: sixMonthsAgo } },
                    select: { dateOfJoining: true },
                }),
                prisma.leaveApplication.findMany({
                    where: { employee: branchFilter, appliedAt: { gte: sixMonthsAgo } },
                    select: { appliedAt: true },
                }),
            ]);

            const months: { key: string; label: string }[] = [];
            for (let i = 5; i >= 0; i--) {
                const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
                months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }) });
            }
            const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            const joiningTrend = months.map(({ key, label }) => ({
                month: label,
                count: joinings.filter((j) => j.dateOfJoining && monthKey(j.dateOfJoining) === key).length,
            }));
            const leaveTrend = months.map(({ key, label }) => ({
                month: label,
                count: leaveApplications.filter((l) => monthKey(l.appliedAt) === key).length,
            }));

            return successResponse({
                byDepartment: byDepartment.map((d) => ({ name: departmentMap.get(d.departmentId!) ?? 'Unknown', count: d._count._all })),
                byDesignation: byDesignation.map((d) => ({ name: designationMap.get(d.designationId!) ?? 'Unknown', count: d._count._all })),
                byBranch: byBranch.map((d) => ({ name: branchMap.get(d.branchId!) ?? 'Unknown', count: d._count._all })),
                attendanceTrend,
                joiningTrend,
                leaveTrend,
            }, 'HR dashboard charts fetched successfully');
        } catch (error: any) {
            console.error('Error fetching HR dashboard charts:', error);
            return errorResponse(error.message || 'Failed to fetch HR dashboard charts', 500);
        }
    })(request);
}
