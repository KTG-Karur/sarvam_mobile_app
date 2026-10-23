import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse, withAuth } from '@/app/lib/api-utils';
import { getUtcBoundsForBranchCalendarDay } from '@/app/lib/branch-lock';
import { canActorApplyForEmployee, isUserContext } from '@/app/lib/permissions/guards';
import { startApprovalWorkflow, cancelApprovalForRecord } from '@/app/lib/approval/engine';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const timeRe = /^([01]\d|2[0-3]):([0-5]\d)$/;

const applySchema = z.object({
    employeeId: z.string().optional().nullable(),
    permissionTypeId: z.string().min(1),
    date: z.coerce.date(),
    fromTime: z.string().regex(timeRe, 'From time must be HH:MM'),
    toTime: z.string().regex(timeRe, 'To time must be HH:MM'),
    reason: z.string().optional().nullable(),
});

function toMinutes(hhmm: string): number {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
}

// POST /api/hr/permission/apply — self-service or authorized manager permission request.
export async function POST(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const body = await req.json();
            const data = applySchema.parse(body);

            let targetEmployeeId = user.userId;
            if (data.employeeId && data.employeeId !== user.userId) {
                const authRes = await canActorApplyForEmployee(req, data.employeeId, '/dashboard/hr/permission/apply');
                if (!isUserContext(authRes)) return authRes;
                targetEmployeeId = data.employeeId;
            }

            const fromMin = toMinutes(data.fromTime);
            const toMin = toMinutes(data.toTime);
            if (toMin <= fromMin) {
                return errorResponse('To time must be after from time', 400);
            }
            const hours = Math.round(((toMin - fromMin) / 60) * 100) / 100;

            const permissionType = await prisma.permissionType.findFirst({
                where: { id: data.permissionTypeId, isActive: true },
            });
            if (!permissionType) return errorResponse('Invalid or inactive permission type', 400);

            const { dayStartUtc, dayEndUtc } = getUtcBoundsForBranchCalendarDay(data.date);

            // Multiple permissions are allowed on the same day — only an actual
            // overlapping time range on that day is rejected.
            const sameDayRequests = await prisma.permissionRequest.findMany({
                where: {
                    employeeId: targetEmployeeId,
                    status: { in: ['PENDING', 'APPROVED'] },
                    date: { gte: dayStartUtc, lte: dayEndUtc },
                },
                select: { fromTime: true, toTime: true },
            });
            const overlapping = sameDayRequests.some(
                (r) => toMinutes(r.fromTime) < toMin && fromMin < toMinutes(r.toTime),
            );
            if (overlapping) {
                return errorResponse(
                    targetEmployeeId === user.userId
                        ? 'You already have a permission request overlapping this time on this day'
                        : 'The selected employee already has a permission request overlapping this time on this day',
                    409
                );
            }

            const created = await prisma.permissionRequest.create({
                data: {
                    employeeId: targetEmployeeId,
                    permissionTypeId: data.permissionTypeId,
                    date: dayStartUtc,
                    fromTime: data.fromTime,
                    toTime: data.toTime,
                    hours,
                    reason: data.reason,
                },
                include: {
                    permissionType: true,
                    employee: { select: { firstName: true, lastName: true, employeeId: true, branchId: true } },
                },
            });

            // Start generic dynamic approval workflow
            let approvalInstanceId: string | null = null;
            let isSkipApproval = false;
            try {
                const started = await startApprovalWorkflow({
                    moduleSlug: 'hr-permission',
                    recordType: 'PermissionRequest',
                    recordId: created.id,
                    branchId: created.employee.branchId ?? '',
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
                // No approval workflow could be started — don't leave an unapprovable request behind.
                await cancelApprovalForRecord('PermissionRequest', created.id, user.userId);
                await prisma.permissionRequest.delete({ where: { id: created.id } });
                throw workflowError;
            }

            if (isSkipApproval) {
                const finalizedSkip = await prisma.permissionRequest.update({
                    where: { id: created.id },
                    data: {
                        status: 'APPROVED',
                        approvedById: user.userId,
                        approvedAt: new Date(),
                        approvalInstanceId,
                    },
                    include: {
                        permissionType: true,
                        employee: { select: { firstName: true, lastName: true, employeeId: true, branchId: true } },
                    },
                });
                return successResponse(finalizedSkip, 'Permission request submitted and approved successfully', 201);
            }

            // Save approvalInstanceId on permissionRequest and remain PENDING awaiting approval
            const updatedPending = await prisma.permissionRequest.update({
                where: { id: created.id },
                data: { approvalInstanceId },
                include: {
                    permissionType: true,
                    employee: { select: { firstName: true, lastName: true, employeeId: true, branchId: true } },
                },
            });

            return successResponse(updatedPending, 'Permission request submitted successfully', 201);
        } catch (error: unknown) {
            if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
            console.error('Error applying for permission:', error);
            const message = error instanceof Error ? error.message : 'Failed to submit permission request';
            return errorResponse(message, 500);
        }
    })(request);
}
