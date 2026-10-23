import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { errorResponse, successResponse, handleCorsPreflight } from '@/app/lib/api-utils';
import { requirePermission, isUserContext, isEmployeeInCallerScope } from '@/app/lib/permissions/guards';
import { getUtcBoundsForBranchCalendarDay } from '@/app/lib/branch-lock';
import { processStageAction } from '@/app/lib/approval/engine';
import { getRemainingLeaveBalance, resolveLopLeaveType, getKolkataMonthBounds } from '@/app/lib/attendance-leave-permission';

export async function OPTIONS() {
    return handleCorsPreflight();
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

// POST /api/hr/leave/[id]/approve
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const ctx = await requirePermission(request, 'hr-leave', 'approve');
    if (!isUserContext(ctx)) return ctx;

    try {
        const { id } = await params;
        const application = await prisma.leaveApplication.findUnique({
            where: { id },
            include: { employee: { select: { id: true, branchId: true } } },
        });
        if (!application) return errorResponse('Leave application not found', 404);
        if (!(await isEmployeeInCallerScope(ctx, application.employee.branchId))) {
            return errorResponse('You do not have access to this employee', 403);
        }
        if (application.status === 'APPROVED') {
            return successResponse(application, 'Leave application already approved');
        }
        if (application.status !== 'PENDING') {
            return errorResponse(`Cannot approve an application in '${application.status}' status`, 409);
        }

        let approvalInstanceId = application.approvalInstanceId;
        if (!approvalInstanceId) {
            const existingInstance = await prisma.approvalInstance.findFirst({
                where: {
                    recordType: 'LeaveApplication',
                    recordId: id,
                    status: { in: ['PENDING', 'IN_PROGRESS'] },
                },
                select: { id: true },
            });
            if (existingInstance) {
                approvalInstanceId = existingInstance.id;
                await prisma.leaveApplication.update({
                    where: { id },
                    data: { approvalInstanceId: existingInstance.id },
                });
            }
        }

        // Half-day leave (single date, 0.5 of balance)
        if (application.isHalfDay) {
            const remainingBalance = await getRemainingLeaveBalance(application.employeeId, application.leaveTypeId, application.fromDate);
            const coveredByBalance = remainingBalance >= 0.5;
            let lopType: { id: string; leaveType: string } | null = null;
            if (!coveredByBalance) {
                lopType = await resolveLopLeaveType();
                if (!lopType) {
                    return errorResponse(
                        'Cannot approve: no balance remains for this half-day leave, and no "Loss of Pay" leave type is configured to cover it. Add one in Leave Type master, or reject this application.',
                        409,
                    );
                }
            }
            const leaveTypeIdForDay = coveredByBalance ? application.leaveTypeId : lopType!.id;

            const executeHalfDayApprovalSideEffects = async () => {
                return prisma.$transaction(async (tx) => {
                    const fresh = await tx.leaveApplication.findUnique({ where: { id } });
                    if (!fresh || fresh.status !== 'PENDING') {
                        throw new Error('Leave application status changed — please refresh and retry');
                    }

                    const existingAttendance = await tx.attendance.findUnique({
                        where: { userId_date: { userId: application.employeeId, date: application.fromDate } },
                    });
                    if (existingAttendance?.checkIn) {
                        await tx.attendance.update({
                            where: { id: existingAttendance.id },
                            data: { leaveTypeId: leaveTypeIdForDay, lopLocked: false, isHalfDayLeave: true },
                        });
                    } else {
                        await tx.attendance.upsert({
                            where: { userId_date: { userId: application.employeeId, date: application.fromDate } },
                            update: { status: 'HALF_DAY', leaveTypeId: leaveTypeIdForDay, lopLocked: false, isHalfDayLeave: true },
                            create: {
                                userId: application.employeeId, date: application.fromDate, status: 'HALF_DAY',
                                leaveTypeId: leaveTypeIdForDay, branchId: application.employee.branchId, lopLocked: false,
                                isHalfDayLeave: true,
                            },
                        });
                    }

                    if (coveredByBalance) {
                        const { month, year } = getKolkataMonthBounds(application.fromDate);
                        await tx.employeeLeaveBalance.upsert({
                            where: { employeeId_leaveTypeId_month_year: { employeeId: application.employeeId, leaveTypeId: application.leaveTypeId, month, year } },
                            update: { remainingBalance: Math.max(0, remainingBalance - 0.5) },
                            create: { employeeId: application.employeeId, leaveTypeId: application.leaveTypeId, month, year, openingBalance: 0, remainingBalance: 0 },
                        });
                    }

                    return tx.leaveApplication.update({
                        where: { id },
                        data: { status: 'APPROVED', approvedById: ctx.userId, approvedAt: new Date() },
                    });
                });
            };

            // ENGINE PATH: Row has an approvalInstanceId
            if (approvalInstanceId) {
                const outcome = await processStageAction(
                    {
                        instanceId: approvalInstanceId,
                        actorUserId: ctx.userId,
                        action: 'approve',
                    },
                    ctx
                );

                if (outcome.newStatus === 'APPROVED') {
                    const updated = await executeHalfDayApprovalSideEffects();
                    const message = coveredByBalance
                        ? 'Half-day leave approved successfully'
                        : `Approved — no balance remained, marked Loss of Pay (${lopType!.leaveType})`;
                    return successResponse(updated, message);
                }

                // Intermediate stage approved: remain PENDING awaiting next stage
                return successResponse(
                    application,
                    `Approved at this level — now awaiting ${outcome.nextStage ?? 'the next approval level'}`
                );
            }

            // LEGACY PATH: Legacy row with approvalInstanceId = null
            const isAdmin = ctx.roles.some((r) => r.roleSlug === 'admin');
            if (application.employeeId === ctx.userId && !isAdmin) {
                return errorResponse('Self-approval is not allowed', 400);
            }

            const updated = await executeHalfDayApprovalSideEffects();
            const message = coveredByBalance
                ? 'Half-day leave approved successfully'
                : `Approved — no balance remained, marked Loss of Pay (${lopType!.leaveType})`;
            return successResponse(updated, message);
        }

        // Multi-day leave
        const days = eachDayInRange(application.fromDate, application.toDate);
        const remainingBalance = await getRemainingLeaveBalance(application.employeeId, application.leaveTypeId, application.fromDate);
        const excessDays = Math.max(0, days.length - remainingBalance);

        let lopType: { id: string; leaveType: string } | null = null;
        if (excessDays > 0) {
            lopType = await resolveLopLeaveType();
            if (!lopType) {
                return errorResponse(
                    `Cannot approve: requested ${days.length} day(s) but only ${remainingBalance} day(s) of balance remain, and no "Loss of Pay" leave type is configured to cover the difference. Add one in Leave Type master, or reject this application.`,
                    409,
                );
            }
        }

        const executeMultiDayApprovalSideEffects = async () => {
            return prisma.$transaction(async (tx) => {
                const fresh = await tx.leaveApplication.findUnique({ where: { id } });
                if (!fresh || fresh.status !== 'PENDING') {
                    throw new Error('Leave application status changed — please refresh and retry');
                }

                const splitIndex = days.length - excessDays;
                for (let i = 0; i < days.length; i++) {
                    const date = days[i];
                    const isLop = i >= splitIndex;
                    const leaveTypeIdForDay = isLop ? lopType!.id : application.leaveTypeId;
                    await tx.attendance.upsert({
                        where: { userId_date: { userId: application.employeeId, date } },
                        update: { status: 'ABSENT', leaveTypeId: leaveTypeIdForDay, lopLocked: false },
                        create: {
                            userId: application.employeeId,
                            date,
                            status: 'ABSENT',
                            leaveTypeId: leaveTypeIdForDay,
                            branchId: application.employee.branchId,
                            lopLocked: false,
                        },
                    });
                }

                const { month, year } = getKolkataMonthBounds(application.fromDate);
                await tx.employeeLeaveBalance.upsert({
                    where: { employeeId_leaveTypeId_month_year: { employeeId: application.employeeId, leaveTypeId: application.leaveTypeId, month, year } },
                    update: { remainingBalance: Math.max(0, remainingBalance - days.length) },
                    create: {
                        employeeId: application.employeeId,
                        leaveTypeId: application.leaveTypeId,
                        month, year,
                        openingBalance: 0,
                        remainingBalance: 0,
                    },
                });

                return tx.leaveApplication.update({
                    where: { id },
                    data: { status: 'APPROVED', approvedById: ctx.userId, approvedAt: new Date() },
                });
            });
        };

        // ENGINE PATH: Row has an approvalInstanceId
        if (approvalInstanceId) {
            const outcome = await processStageAction(
                {
                    instanceId: approvalInstanceId,
                    actorUserId: ctx.userId,
                    action: 'approve',
                },
                ctx
            );

            if (outcome.newStatus === 'APPROVED') {
                const updated = await executeMultiDayApprovalSideEffects();
                const message = excessDays > 0
                    ? `Approved — ${days.length - excessDays} day(s) covered by balance, ${excessDays} day(s) marked Loss of Pay (${lopType!.leaveType}) due to insufficient balance.`
                    : 'Leave application approved successfully';
                return successResponse(updated, message);
            }

            // Intermediate stage approved: remain PENDING awaiting next stage
            return successResponse(
                application,
                `Approved at this level — now awaiting ${outcome.nextStage ?? 'the next approval level'}`
            );
        }

        // LEGACY PATH: Legacy row with approvalInstanceId = null
        const isAdmin = ctx.roles.some((r) => r.roleSlug === 'admin');
        if (application.employeeId === ctx.userId && !isAdmin) {
            return errorResponse('Self-approval is not allowed', 400);
        }

        const updated = await executeMultiDayApprovalSideEffects();
        const message = excessDays > 0
            ? `Approved — ${days.length - excessDays} day(s) covered by balance, ${excessDays} day(s) marked Loss of Pay (${lopType!.leaveType}) due to insufficient balance.`
            : 'Leave application approved successfully';

        return successResponse(updated, message);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to approve leave application';
        if (message === 'Self-approval is not allowed') {
            return errorResponse('Self-approval is not allowed', 400);
        }
        if (message.startsWith('Action requires role') || message.startsWith('You do not have access')) {
            return errorResponse(message, 403);
        }
        if (message.includes('already ') || message.includes('cannot process')) {
            return errorResponse(message, 409);
        }
        console.error('Error approving leave application:', error);
        return errorResponse(message, 500);
    }
}
