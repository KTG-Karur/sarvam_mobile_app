import { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse, withAuth } from '@/app/lib/api-utils';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';
import { requireEmployeeAccess, isUserContext, getUserContext } from '@/app/lib/permissions/guards';
import { describePendingApprovals } from '@/app/lib/approval/record-approval';
import { getRemainingLeaveBalancesBatch } from '@/app/lib/attendance-leave-permission';
import { resolvePeriod } from '@/app/lib/period-resolver';

export async function OPTIONS() {
    return handleCorsPreflight();
}

// GET /api/hr/leave — own history by default, or a team-wide view (branch-scoped)
// when ?scope=team is passed, or a single employee's history via ?employeeId=.
// Optional date filter (IST): ?period=TODAY|THIS_WEEK|THIS_MONTH|THIS_YEAR|CUSTOM, or
// simply ?fromDate=&tillDate= (treated as CUSTOM). An application is returned when
// its leave dates OVERLAP the range, so a leave spanning the range boundary still shows.
// No filter params = unchanged behaviour (full history).
export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const scope = searchParams.get('scope');
            const employeeId = searchParams.get('employeeId');
            const periodParam = searchParams.get('period');
            const fromDateParam = searchParams.get('fromDate');
            const tillDateParam = searchParams.get('tillDate');

            let dateFilter: Prisma.LeaveApplicationWhereInput = {};
            if (periodParam || fromDateParam || tillDateParam) {
                let resolved;
                try {
                    resolved = resolvePeriod({
                        period: periodParam || 'CUSTOM',
                        fromDate: fromDateParam,
                        tillDate: tillDateParam,
                    });
                } catch (e: any) {
                    return errorResponse(e.message || 'Invalid period', 400);
                }
                dateFilter = {
                    fromDate: { lt: resolved.tillDateExclusiveUtc },
                    toDate: { gte: resolved.fromDateUtc },
                };
            }

            let where: Prisma.LeaveApplicationWhereInput = { employeeId: user.userId };
            if (employeeId && employeeId !== user.userId) {
                const ctx = await requireEmployeeAccess(req, employeeId);
                if (!isUserContext(ctx)) return ctx;
                where = { employeeId };
            } else if (scope === 'team') {
                const permittedBranchIds = await getPermittedBranchIds(user);
                where = permittedBranchIds ? { employee: { branchId: { in: permittedBranchIds } } } : {};
            }

            const applications = await prisma.leaveApplication.findMany({
                where: { AND: [where, dateFilter] },
                include: {
                    employee: { select: { id: true, firstName: true, lastName: true, employeeId: true, branchId: true } },
                    leaveType: { select: { id: true, leaveType: true, attachmentRequiredAboveDays: true } },
                    approvedBy: { select: { id: true, firstName: true, lastName: true } },
                    // fileKey is deliberately not selected — files are opened through the attachment view route.
                    attachments: { select: { id: true, fileName: true, mimeType: true, fileSize: true, createdAt: true } },
                },
                orderBy: { appliedAt: 'desc' },
            });

            // Which approval-chain stage each still-pending request is waiting on,
            // and whether this viewer may act on it.
            const viewer = await getUserContext(req);
            const approvals = viewer
                ? await describePendingApprovals(
                    'hr-leave',
                    'LeaveApplication',
                    applications.filter((a) => a.status === 'PENDING').map((a) => ({ id: a.id, branchId: a.employee.branchId })),
                    viewer
                )
                : new Map();

            // Balance-aware warning fields — only meaningful for PENDING rows, but
            // computed for all so the approver can also see it on ones they're
            // reviewing again. Batched rather than per-row, evaluated against each
            // application's calendar month for the Fixed Monthly Quota policy.
            const balances = await getRemainingLeaveBalancesBatch(
                applications.map((app) => ({
                    employeeId: app.employeeId,
                    leaveTypeId: app.leaveTypeId,
                    date: app.fromDate,
                })),
            );

            const serializedApplications = applications.map((app) => {
                // Do NOT round — a half-day leave's 0.5 would round up to a
                // misleading whole day and break its "no LOP needed" math below
                // (see attendance-hr/plan-half-day-leave.md).
                const numberOfDays = Number(app.numberOfDays) || 0;
                const remainingBalance = balances.get(`${app.employeeId}:${app.leaveTypeId}`) ?? 0;
                return {
                    ...app,
                    numberOfDays,
                    remainingBalance,
                    excessDaysIfApproved: Math.max(0, numberOfDays - remainingBalance),
                    approval: approvals.get(app.id) ?? null,
                };
            });

            return successResponse(serializedApplications, 'Leave applications fetched successfully');
        } catch (error: unknown) {
            console.error('Error fetching leave applications:', error);
            const message = error instanceof Error ? error.message : 'Failed to fetch leave applications';
            return errorResponse(message, 500);
        }
    })(request);
}
