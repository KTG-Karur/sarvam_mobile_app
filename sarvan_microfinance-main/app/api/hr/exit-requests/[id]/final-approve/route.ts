import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { errorResponse, successResponse, handleCorsPreflight } from '@/app/lib/api-utils';
import { requirePermission, isUserContext, isEmployeeInCallerScope } from '@/app/lib/permissions/guards';
import { buildRelievingLetterPdf } from '@/app/lib/reports/relieving-letter-pdf';
import { uploadHrLetter } from '@/app/lib/storage/hr-letter-storage';
import { processStageAction } from '@/app/lib/approval/engine';
import { invalidateUserPermissions } from '@/app/lib/permissions/engine';
import { getOutstandingBelongings, outstandingBelongingsMessage } from '@/app/lib/hr/exit-belongings-check';
import { toDisplayDate } from '@/app/lib/date-format';

const APPROVED_INSTANCE_ERROR = "Instance is in 'APPROVED' state, cannot process";

export async function OPTIONS() {
    return handleCorsPreflight();
}

const EXIT_TYPE_LABELS: Record<string, string> = {
    VOLUNTARY_RESIGNATION: 'Voluntary Resignation',
    ABSCONDING: 'Absconding',
    ASK_TO_GO: 'Ask to Go',
    APPOINTMENT_CANCELLATION: 'Appointment Cancellation',
    TERMINATION: 'Termination',
    DECEASED: 'Deceased',
    RETIREMENT: 'Retirement',
};

// POST /api/hr/exit-requests/[id]/final-approve
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const ctx = await requirePermission(request, 'hr-exit', 'approve');
    if (!isUserContext(ctx)) return ctx;

    try {
        const { id } = await params;

        const exitRequest = await prisma.employeeExitRequest.findUnique({
            where: { id },
            include: {
                employee: {
                    select: {
                        id: true, firstName: true, lastName: true, employeeId: true, dateOfJoining: true, branchId: true,
                        designation: { select: { name: true } },
                        department: { select: { name: true } },
                        branch: { select: { name: true } },
                    },
                },
                clearanceItems: true,
            },
        });
        if (!exitRequest) return errorResponse('Exit request not found', 404);
        if (!(await isEmployeeInCallerScope(ctx, exitRequest.employee.branchId))) {
            return errorResponse('You do not have access to this employee', 403);
        }
        if (exitRequest.status === 'COMPLETED') {
            return successResponse(exitRequest, 'Exit request already completed');
        }
        if (exitRequest.status !== 'IN_PROGRESS') {
            return errorResponse(`Cannot finalize an exit request in '${exitRequest.status}' status`, 409);
        }

        const uncleared = exitRequest.clearanceItems.filter((item) => item.status !== 'CLEARED');
        if (uncleared.length > 0) {
            return errorResponse(
                `${uncleared.length} clearance item(s) are not yet cleared: ${uncleared.map((i) => i.itemName).join(', ')}`,
                409
            );
        }

        // Separate from the clearance checklist (a department sign-off list) —
        // this is physical-asset custody (EmployeeIssuedBelonging). An employee
        // fully cleared but still holding company property must not be finalized.
        const outstandingBelongings = await getOutstandingBelongings(exitRequest.employeeId);
        if (outstandingBelongings.length > 0) {
            return errorResponse(outstandingBelongingsMessage(outstandingBelongings), 409);
        }

        const executeExitSideEffects = async () => {
            const pdfBuffer = await buildRelievingLetterPdf({
                refNo: `REL-${exitRequest.id.slice(-8).toUpperCase()}`,
                issueDate: toDisplayDate(new Date()),
                dateOfJoining: (exitRequest.employee.dateOfJoining == null ? undefined : toDisplayDate(exitRequest.employee.dateOfJoining)) ?? 'N/A',
                lastWorkingDate: toDisplayDate(exitRequest.lastWorkingDate),
                exitTypeLabel: EXIT_TYPE_LABELS[exitRequest.exitType] ?? exitRequest.exitType,
                recipient: {
                    employeeName: `${exitRequest.employee.firstName} ${exitRequest.employee.lastName}`,
                    employeeCode: exitRequest.employee.employeeId ?? 'N/A',
                    designation: exitRequest.employee.designation?.name ?? 'N/A',
                    department: exitRequest.employee.department?.name ?? 'N/A',
                    branchName: exitRequest.employee.branch?.name ?? 'N/A',
                },
            });
            const relievingLetterUrl = await uploadHrLetter({
                employeeId: exitRequest.employeeId,
                letterType: 'relieving',
                pdfBuffer,
            });

            const now = new Date();
            const updated = await prisma.$transaction(async (tx) => {
                const fresh = await tx.employeeExitRequest.findUnique({
                    where: { id },
                    include: { clearanceItems: true },
                });
                if (!fresh || fresh.status !== 'IN_PROGRESS') {
                    throw new Error('Exit request status changed — please refresh and retry');
                }
                if (fresh.clearanceItems.some((item) => item.status !== 'CLEARED')) {
                    throw new Error('Clearance items changed — please refresh and retry');
                }
                const stillOutstanding = await tx.employeeIssuedBelonging.count({
                    where: { employeeId: exitRequest.employeeId, status: 'ISSUED' },
                });
                if (stillOutstanding > 0) {
                    throw new Error('Belongings changed — please refresh and retry');
                }

                await tx.user.update({
                    where: { id: exitRequest.employeeId },
                    data: { isActive: false, dateOfExit: exitRequest.lastWorkingDate },
                });

                return tx.employeeExitRequest.update({
                    where: { id },
                    data: {
                        status: 'COMPLETED',
                        finalHrApprovedById: ctx.userId,
                        finalHrApprovedAt: now,
                        ndcGeneratedAt: now,
                        relievingLetterUrl,
                        employeeDeactivatedAt: now,
                    },
                    include: {
                        employee: { select: { id: true, firstName: true, lastName: true, employeeId: true } },
                        clearanceItems: true,
                    },
                });
            });

            try {
                await invalidateUserPermissions(exitRequest.employeeId);
            } catch (permissionError) {
                console.error('Failed to invalidate permissions after exit approval:', permissionError);
            }

            return updated;
        };

        // ENGINE PATH: Row has an approvalInstanceId
        let approvalInstanceId = exitRequest.approvalInstanceId;
        if (!approvalInstanceId) {
            const existingInstance = await prisma.approvalInstance.findFirst({
                where: {
                    recordType: 'EmployeeExitRequest',
                    recordId: id,
                    status: { in: ['PENDING', 'IN_PROGRESS'] },
                },
                select: { id: true },
            });
            if (existingInstance) {
                approvalInstanceId = existingInstance.id;
                await prisma.employeeExitRequest.update({
                    where: { id },
                    data: { approvalInstanceId: existingInstance.id },
                });
            }
        }

        if (approvalInstanceId) {
            let outcome: { newStatus: string; nextStage: string | null };
            try {
                outcome = await processStageAction(
                    {
                        instanceId: approvalInstanceId,
                        actorUserId: ctx.userId,
                        action: 'approve',
                    },
                    ctx
                );
            } catch (engineError: unknown) {
                // An earlier attempt cleared every stage but then failed applying the
                // exit (relieving letter generation/upload) — the request is still
                // IN_PROGRESS and the instance can never be approved again. Finish just
                // the side effect instead of leaving the exit stuck.
                if (engineError instanceof Error && engineError.message === APPROVED_INSTANCE_ERROR) {
                    outcome = { newStatus: 'APPROVED', nextStage: null };
                } else {
                    throw engineError;
                }
            }

            if (outcome.newStatus === 'APPROVED') {
                const updated = await executeExitSideEffects();
                return successResponse(updated, 'Exit finalized — NDC issued, relieving letter generated, employee deactivated');
            }

            // Intermediate stage approved: remain IN_PROGRESS awaiting next stage
            return successResponse(
                exitRequest,
                `Approved at this level — now awaiting ${outcome.nextStage ?? 'the next approval level'}`
            );
        }

        // LEGACY PATH: Legacy row with approvalInstanceId = null
        const isAdmin = ctx.roles.some((r) => r.roleSlug === 'admin');
        if (exitRequest.initiatedById === ctx.userId && !isAdmin) {
            return errorResponse('Self-approval is not allowed', 400);
        }

        const updated = await executeExitSideEffects();
        return successResponse(updated, 'Exit finalized — NDC issued, relieving letter generated, employee deactivated');
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to finalize exit request';
        if (message === 'Self-approval is not allowed') {
            return errorResponse('Self-approval is not allowed', 400);
        }
        if (message.startsWith('Action requires role') || message.startsWith('You do not have access')) {
            return errorResponse(message, 403);
        }
        if (message.includes('already ') || message.includes('cannot process')) {
            return errorResponse(message, 409);
        }
        console.error('Error finalizing exit request:', error);
        return errorResponse(message, 500);
    }
}
