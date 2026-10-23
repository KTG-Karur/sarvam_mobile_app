import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { errorResponse, successResponse, handleCorsPreflight } from '@/app/lib/api-utils';
import { requirePermission, isUserContext, isEmployeeInCallerScope } from '@/app/lib/permissions/guards';
import { buildConfirmationLetterPdf } from '@/app/lib/reports/confirmation-letter-pdf';
import { uploadHrLetter } from '@/app/lib/storage/hr-letter-storage';
import { processStageAction } from '@/app/lib/approval/engine';
import { toDisplayDate } from '@/app/lib/date-format';

const APPROVED_INSTANCE_ERROR = "Instance is in 'APPROVED' state, cannot process";

export async function OPTIONS() {
    return handleCorsPreflight();
}

// POST /api/hr/confirmations/[id]/approve
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const ctx = await requirePermission(request, 'hr-confirmation', 'approve');
    if (!isUserContext(ctx)) return ctx;

    try {
        const { id } = await params;

        const confirmation = await prisma.employeeConfirmation.findUnique({
            where: { id },
            include: {
                employee: {
                    select: {
                        id: true, firstName: true, lastName: true, employeeId: true, branchId: true,
                        designation: { select: { name: true } },
                        department: { select: { name: true } },
                        branch: { select: { name: true } },
                    },
                },
            },
        });
        if (!confirmation) return errorResponse('Confirmation request not found', 404);
        if (!(await isEmployeeInCallerScope(ctx, confirmation.employee.branchId))) {
            return errorResponse('You do not have access to this employee', 403);
        }
        if (confirmation.status === 'APPROVED') {
            return successResponse(confirmation, 'Confirmation already approved');
        }
        if (confirmation.status !== 'PENDING') {
            return errorResponse(`Cannot approve a request in '${confirmation.status}' status`, 409);
        }

        // Helper to execute final confirmation side effects (letter generation + User confirmationDate + status APPROVED)
        const executeConfirmationSideEffects = async () => {
            const confirmationDateStr = toDisplayDate(confirmation.proposedConfirmationDate);
            const pdfBuffer = await buildConfirmationLetterPdf({
                refNo: `CNF-${confirmation.id.slice(-8).toUpperCase()}`,
                issueDate: toDisplayDate(new Date()),
                confirmationDate: confirmationDateStr,
                recipient: {
                    employeeName: `${confirmation.employee.firstName} ${confirmation.employee.lastName}`,
                    employeeCode: confirmation.employee.employeeId ?? 'N/A',
                    designation: confirmation.employee.designation?.name ?? 'N/A',
                    department: confirmation.employee.department?.name ?? 'N/A',
                    branchName: confirmation.employee.branch?.name ?? 'N/A',
                },
            });
            const letterUrl = await uploadHrLetter({
                employeeId: confirmation.employeeId,
                letterType: 'confirmation',
                pdfBuffer,
            });

            return prisma.$transaction(async (tx) => {
                const fresh = await tx.employeeConfirmation.findUnique({ where: { id } });
                if (!fresh || fresh.status !== 'PENDING') {
                    throw new Error('Confirmation request status changed — please refresh and retry');
                }

                await tx.user.update({
                    where: { id: confirmation.employeeId },
                    data: { confirmationDate: confirmation.proposedConfirmationDate },
                });

                return tx.employeeConfirmation.update({
                    where: { id },
                    data: {
                        status: 'APPROVED',
                        reviewedById: ctx.userId,
                        reviewedAt: new Date(),
                        letterUrl,
                        letterGeneratedAt: new Date(),
                    },
                    include: {
                        employee: { select: { id: true, firstName: true, lastName: true, employeeId: true } },
                    },
                });
            });
        };

        // ENGINE PATH: Row has an approvalInstanceId
        let approvalInstanceId = confirmation.approvalInstanceId;
        if (!approvalInstanceId) {
            const existingInstance = await prisma.approvalInstance.findFirst({
                where: {
                    recordType: 'hr_confirmation',
                    recordId: id,
                    status: { in: ['PENDING', 'IN_PROGRESS'] },
                },
                select: { id: true },
            });
            if (existingInstance) {
                approvalInstanceId = existingInstance.id;
                await prisma.employeeConfirmation.update({
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
                // change (letter generation/upload) — the row is still PENDING and the
                // instance can never be approved again. Finish just the side effect
                // instead of leaving the employee stuck.
                if (engineError instanceof Error && engineError.message === APPROVED_INSTANCE_ERROR) {
                    outcome = { newStatus: 'APPROVED', nextStage: null };
                } else {
                    throw engineError;
                }
            }

            if (outcome.newStatus === 'APPROVED') {
                const updated = await executeConfirmationSideEffects();
                return successResponse(updated, 'Confirmation approved successfully');
            }

            // Intermediate stage approved: remain PENDING awaiting next stage
            return successResponse(
                confirmation,
                `Approved at this level — now awaiting ${outcome.nextStage ?? 'the next approval level'}`
            );
        }

        // LEGACY PATH: Legacy row with approvalInstanceId = null
        const isAdmin = ctx.roles.some((r) => r.roleSlug === 'admin');
        if (confirmation.initiatedById === ctx.userId && !isAdmin) {
            return errorResponse('Self-approval is not allowed', 400);
        }

        const updated = await executeConfirmationSideEffects();
        return successResponse(updated, 'Confirmation approved successfully');
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to approve confirmation';
        if (message === 'Self-approval is not allowed') {
            return errorResponse('Self-approval is not allowed', 400);
        }
        if (message.startsWith('Action requires role') || message.startsWith('You do not have access')) {
            return errorResponse(message, 403);
        }
        if (message.includes('already ') || message.includes('cannot process')) {
            return errorResponse(message, 409);
        }
        console.error('Error approving confirmation:', error);
        return errorResponse(message, 500);
    }
}
