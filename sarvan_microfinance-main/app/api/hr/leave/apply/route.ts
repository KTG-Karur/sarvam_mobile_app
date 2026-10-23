import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse, withAuth } from '@/app/lib/api-utils';
import { getUtcBoundsForBranchCalendarDay } from '@/app/lib/branch-lock';
import { canActorApplyForEmployee, isUserContext } from '@/app/lib/permissions/guards';
import { LEAVE_PROOF_ALLOWED_MIME, LEAVE_PROOF_MAX_BYTES, LEAVE_PROOF_MAX_FILES, attachmentRequiredMessage, isAttachmentRequired } from '@/app/lib/leave-attachment-rule';
import { isLeaveProofKeyFor, readLeaveProof } from '@/app/lib/storage/leave-proof-storage';
import { startApprovalWorkflow, cancelApprovalForRecord } from '@/app/lib/approval/engine';
import { getRemainingLeaveBalance, resolveLopLeaveType, getKolkataMonthBounds } from '@/app/lib/attendance-leave-permission';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const applySchema = z.object({
    employeeId: z.string().optional().nullable(),
    leaveTypeId: z.string().min(1),
    fromDate: z.coerce.date(),
    toDate: z.coerce.date(),
    reason: z.string().optional().nullable(),
    // Half-day leave (see attendance-hr/plan-half-day-leave.md) — single-date
    // only, consumes 0.5 of the balance instead of a whole day.
    isHalfDay: z.boolean().optional(),
    halfDaySession: z.enum(['FIRST_HALF', 'SECOND_HALF']).optional(),
    // Proof files already uploaded via POST /api/hr/leave/attachments/upload (required for some leave types).
    attachments: z.array(z.object({ fileKey: z.string().min(1), fileName: z.string().min(1).max(255) })).max(LEAVE_PROOF_MAX_FILES, `At most ${LEAVE_PROOF_MAX_FILES} proof files are allowed`).optional(),
}).refine((v) => !v.isHalfDay || !!v.halfDaySession, {
    message: 'halfDaySession is required when isHalfDay is true',
    path: ['halfDaySession'],
});

function countCalendarDays(fromDate: Date, toDate: Date): number {
    const { dayStartUtc: from } = getUtcBoundsForBranchCalendarDay(fromDate);
    const { dayStartUtc: to } = getUtcBoundsForBranchCalendarDay(toDate);
    return Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)) + 1;
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

// POST /api/hr/leave/apply — self-service or authorized manager application.
export async function POST(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const body = await req.json();
            const data = applySchema.parse(body);

            let targetEmployeeId = user.userId;
            if (data.employeeId && data.employeeId !== user.userId) {
                const authRes = await canActorApplyForEmployee(req, data.employeeId, '/dashboard/hr/leave/apply');
                if (!isUserContext(authRes)) return authRes;
                targetEmployeeId = data.employeeId;
            }

            if (data.toDate < data.fromDate) {
                return errorResponse('To date cannot be before from date', 400);
            }

            if (data.isHalfDay) {
                const { dayStartUtc: fromDay } = getUtcBoundsForBranchCalendarDay(data.fromDate);
                const { dayStartUtc: toDay } = getUtcBoundsForBranchCalendarDay(data.toDate);
                if (fromDay.getTime() !== toDay.getTime()) {
                    return errorResponse('Half-day leave must be a single date', 400);
                }
            }

            const leaveType = await prisma.leaveType.findUnique({ where: { id: data.leaveTypeId, isActive: true } });
            if (!leaveType) return errorResponse('Invalid or inactive leave type', 400);

            const overlapping = await prisma.leaveApplication.findFirst({
                where: {
                    employeeId: targetEmployeeId,
                    status: { in: ['PENDING', 'APPROVED'] },
                    fromDate: { lte: data.toDate },
                    toDate: { gte: data.fromDate },
                },
            });
            if (overlapping) {
                return errorResponse(
                    targetEmployeeId === user.userId
                        ? 'You already have a leave application overlapping these dates'
                        : 'The selected employee already has a leave application overlapping these dates',
                    409
                );
            }

            const numberOfDays = data.isHalfDay ? 0.5 : countCalendarDays(data.fromDate, data.toDate);

            // Proof rule (LeaveType.attachmentRequiredAboveDays). Each referenced file must sit in THIS
            // employee's leave-proof folder and really exist; size/type recorded are read back from storage.
            const requested = data.attachments ?? [];
            const proofRows: { fileKey: string; fileName: string; mimeType: string; fileSize: number; uploadedById: string }[] = [];
            for (const a of requested) {
                if (!(await isLeaveProofKeyFor(targetEmployeeId, a.fileKey))) {
                    return errorResponse('An attached file does not belong to this employee', 400);
                }
                const stored = await readLeaveProof(a.fileKey);
                if (!stored) return errorResponse(`Attached file "${a.fileName}" was not found — upload it again`, 400);
                if (stored.buffer.byteLength > LEAVE_PROOF_MAX_BYTES || !(LEAVE_PROOF_ALLOWED_MIME as readonly string[]).includes(stored.contentType)) {
                    return errorResponse(`Attached file "${a.fileName}" is not an allowed proof file`, 400);
                }
                proofRows.push({ fileKey: a.fileKey, fileName: a.fileName, mimeType: stored.contentType, fileSize: stored.buffer.byteLength, uploadedById: user.userId });
            }
            if (isAttachmentRequired(leaveType.attachmentRequiredAboveDays, numberOfDays) && proofRows.length === 0) {
                return errorResponse(attachmentRequiredMessage(leaveType.leaveType, leaveType.attachmentRequiredAboveDays!), 400);
            }

            const application = await prisma.leaveApplication.create({
                data: {
                    employeeId: targetEmployeeId,
                    leaveTypeId: data.leaveTypeId,
                    fromDate: data.fromDate,
                    toDate: data.toDate,
                    numberOfDays,
                    reason: data.reason,
                    isHalfDay: !!data.isHalfDay,
                    halfDaySession: data.isHalfDay ? data.halfDaySession : null,
                    ...(proofRows.length ? { attachments: { create: proofRows } } : {}),
                },
                include: {
                    attachments: { select: { id: true, fileName: true, mimeType: true, fileSize: true, createdAt: true } },
                    leaveType: true,
                    employee: { select: { firstName: true, lastName: true, employeeId: true, branchId: true } },
                },
            });

            const executeLeaveFinalization = async (applicationId: string, approvalInstanceId?: string | null) => {
                if (data.isHalfDay) {
                    const remainingBalance = await getRemainingLeaveBalance(targetEmployeeId, data.leaveTypeId, data.fromDate);
                    const coveredByBalance = remainingBalance >= 0.5;
                    let lopType: { id: string; leaveType: string } | null = null;
                    if (!coveredByBalance) {
                        lopType = await resolveLopLeaveType();
                    }
                    const leaveTypeIdForDay = coveredByBalance ? data.leaveTypeId : lopType?.id ?? data.leaveTypeId;

                    return prisma.$transaction(async (tx) => {
                        const existingAttendance = await tx.attendance.findUnique({
                            where: { userId_date: { userId: targetEmployeeId, date: data.fromDate } },
                        });
                        if (existingAttendance?.checkIn) {
                            await tx.attendance.update({
                                where: { id: existingAttendance.id },
                                data: { leaveTypeId: leaveTypeIdForDay, lopLocked: false, isHalfDayLeave: true },
                            });
                        } else {
                            await tx.attendance.upsert({
                                where: { userId_date: { userId: targetEmployeeId, date: data.fromDate } },
                                update: { status: 'HALF_DAY', leaveTypeId: leaveTypeIdForDay, lopLocked: false, isHalfDayLeave: true },
                                create: {
                                    userId: targetEmployeeId, date: data.fromDate, status: 'HALF_DAY',
                                    leaveTypeId: leaveTypeIdForDay, branchId: application.employee.branchId, lopLocked: false,
                                    isHalfDayLeave: true,
                                },
                            });
                        }

                        if (coveredByBalance) {
                            const { month, year } = getKolkataMonthBounds(data.fromDate);
                            await tx.employeeLeaveBalance.upsert({
                                where: { employeeId_leaveTypeId_month_year: { employeeId: targetEmployeeId, leaveTypeId: data.leaveTypeId, month, year } },
                                update: { remainingBalance: Math.max(0, remainingBalance - 0.5) },
                                create: { employeeId: targetEmployeeId, leaveTypeId: data.leaveTypeId, month, year, openingBalance: 0, remainingBalance: 0 },
                            });
                        }

                        return tx.leaveApplication.update({
                            where: { id: applicationId },
                            data: {
                                status: 'APPROVED',
                                approvedById: user.userId,
                                approvedAt: new Date(),
                                ...(approvalInstanceId !== undefined ? { approvalInstanceId } : {}),
                            },
                            include: {
                                leaveType: true,
                                employee: { select: { firstName: true, lastName: true, employeeId: true, branchId: true } },
                            },
                        });
                    });
                }

                const days = eachDayInRange(data.fromDate, data.toDate);
                const remainingBalance = await getRemainingLeaveBalance(targetEmployeeId, data.leaveTypeId, data.fromDate);
                const excessDays = Math.max(0, days.length - remainingBalance);
                let lopType: { id: string; leaveType: string } | null = null;
                if (excessDays > 0) {
                    lopType = await resolveLopLeaveType();
                }

                return prisma.$transaction(async (tx) => {
                    const splitIndex = days.length - excessDays;
                    for (let i = 0; i < days.length; i++) {
                        const date = days[i];
                        const isLop = i >= splitIndex;
                        const leaveTypeIdForDay = isLop && lopType ? lopType.id : data.leaveTypeId;
                        await tx.attendance.upsert({
                            where: { userId_date: { userId: targetEmployeeId, date } },
                            update: { status: 'ABSENT', leaveTypeId: leaveTypeIdForDay, lopLocked: false },
                            create: {
                                userId: targetEmployeeId,
                                date,
                                status: 'ABSENT',
                                leaveTypeId: leaveTypeIdForDay,
                                branchId: application.employee.branchId,
                                lopLocked: false,
                            },
                        });
                    }

                    const { month, year } = getKolkataMonthBounds(data.fromDate);
                    await tx.employeeLeaveBalance.upsert({
                        where: { employeeId_leaveTypeId_month_year: { employeeId: targetEmployeeId, leaveTypeId: data.leaveTypeId, month, year } },
                        update: { remainingBalance: Math.max(0, remainingBalance - days.length) },
                        create: {
                            employeeId: targetEmployeeId,
                            leaveTypeId: data.leaveTypeId,
                            month, year,
                            openingBalance: 0,
                            remainingBalance: 0,
                        },
                    });

                    return tx.leaveApplication.update({
                        where: { id: applicationId },
                        data: {
                            status: 'APPROVED',
                            approvedById: user.userId,
                            approvedAt: new Date(),
                            ...(approvalInstanceId !== undefined ? { approvalInstanceId } : {}),
                        },
                        include: {
                            leaveType: true,
                            employee: { select: { firstName: true, lastName: true, employeeId: true, branchId: true } },
                        },
                    });
                });
            };

            // Start generic dynamic approval workflow
            let approvalInstanceId: string | null = null;
            let isSkipApproval = false;
            try {
                const started = await startApprovalWorkflow({
                    moduleSlug: 'hr-leave',
                    recordType: 'LeaveApplication',
                    recordId: application.id,
                    branchId: application.employee.branchId ?? '',
                    submittedByUserId: user.userId,
                });
                approvalInstanceId = started.instanceId;

                const inst = await prisma.approvalInstance.findUnique({
                    where: { id: started.instanceId },
                    select: { status: true },
                });
                if (inst?.status === 'APPROVED') {
                    isSkipApproval = true;
                }
            } catch (workflowError: unknown) {
                // No approval workflow could be started — don't leave an application behind.
                await cancelApprovalForRecord('LeaveApplication', application.id, user.userId);
                await prisma.leaveApplication.delete({ where: { id: application.id } });
                throw workflowError;
            }

            if (isSkipApproval) {
                const finalizedSkip = await executeLeaveFinalization(application.id, approvalInstanceId);
                return successResponse(finalizedSkip, 'Leave application submitted and approved successfully', 201);
            }

            // Save approvalInstanceId on leaveApplication and remain PENDING awaiting approval
            const updatedPending = await prisma.leaveApplication.update({
                where: { id: application.id },
                data: {
                    approvalInstanceId,
                },
                include: {
                    leaveType: true,
                    employee: { select: { firstName: true, lastName: true, employeeId: true, branchId: true } },
                },
            });

            return successResponse(updatedPending, 'Leave application submitted successfully', 201);
        } catch (error: unknown) {
            if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
            console.error('Error applying for leave:', error);
            const message = error instanceof Error ? error.message : 'Failed to submit leave application';
            return errorResponse(message, 500);
        }
    })(request);
}
