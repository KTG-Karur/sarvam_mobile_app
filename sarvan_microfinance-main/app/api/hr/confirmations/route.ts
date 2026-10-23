import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse } from '@/app/lib/api-utils';
import { requirePermission, isUserContext, isEmployeeInCallerScope } from '@/app/lib/permissions/guards';
import { buildConfirmationLetterPdf } from '@/app/lib/reports/confirmation-letter-pdf';
import { uploadHrLetter } from '@/app/lib/storage/hr-letter-storage';
import { startApprovalWorkflow, cancelApprovalForRecord } from '@/app/lib/approval/engine';
import { describePendingApprovals } from '@/app/lib/approval/record-approval';
import { toDisplayDate } from '@/app/lib/date-format';
import { getPermittedBranchIdsForContext } from '@/app/lib/permissions/branch-scope';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const createSchema = z.object({
    employeeId: z.string().min(1),
    proposedConfirmationDate: z.coerce.date(),
});

// GET /api/hr/confirmations — 'view' permission, not just any authenticated
// user: a bare withAuth here let anyone signed in list/enumerate confirmation
// records regardless of whether they hold any hr-confirmation permission.
export async function GET(request: NextRequest) {
    const ctx = await requirePermission(request, 'hr-confirmation', 'view');
    if (!isUserContext(ctx)) return ctx;

    try {
        const permittedBranchIds = await getPermittedBranchIdsForContext(ctx);
        const confirmations = await prisma.employeeConfirmation.findMany({
            where: permittedBranchIds ? { employee: { branchId: { in: permittedBranchIds } } } : {},
            include: {
                employee: { select: { id: true, firstName: true, lastName: true, employeeId: true, dateOfJoining: true, branchId: true, branch: { select: { name: true } } } },
                initiatedBy: { select: { id: true, firstName: true, lastName: true } },
                reviewedBy: { select: { id: true, firstName: true, lastName: true } },
            },
            orderBy: { initiatedAt: 'desc' },
        });
        // "Awaiting <stage>" + whether this viewer can act on it — same decoration
        // Promotion and Exit lists carry, so the page can offer Approve/Reject.
        const approvals = await describePendingApprovals(
            'hr-confirmation',
            'hr_confirmation',
            confirmations.filter((c) => c.status === 'PENDING').map((c) => ({ id: c.id, branchId: c.employee.branchId })),
            ctx
        );
        return successResponse(
            confirmations.map((c) => ({ ...c, approval: approvals.get(c.id) ?? null })),
            'Confirmations fetched successfully'
        );
    } catch (error: unknown) {
        console.error('Error fetching confirmations:', error);
        const message = error instanceof Error ? error.message : 'Failed to fetch confirmations';
        return errorResponse(message, 500);
    }
}

// POST /api/hr/confirmations — starts the module's approval workflow
// (Admin-only single stage by default). The confirmation stays PENDING until
// it is approved on the Confirmation page (which calls [id]/approve); only a
// workflow that resolves to APPROVED at creation (skip-approval) finalizes it
// immediately and generates the letter.
export async function POST(request: NextRequest) {
    const ctx = await requirePermission(request, 'hr-confirmation', 'create');
    if (!isUserContext(ctx)) return ctx;

    try {
        const body = await request.json();
        const data = createSchema.parse(body);

        const employee = await prisma.user.findUnique({
            where: { id: data.employeeId },
            select: {
                id: true, firstName: true, lastName: true, employeeId: true, branchId: true, confirmationDate: true, isActive: true,
                designation: { select: { name: true } },
                department: { select: { name: true } },
                branch: { select: { name: true } },
            },
        });
        if (!employee) return errorResponse('Employee not found', 404);
        if (!(await isEmployeeInCallerScope(ctx, employee.branchId))) {
            return errorResponse('You do not have access to this employee', 403);
        }
        if (employee.isActive === false) {
            return errorResponse('This employee is no longer active — cannot confirm them', 409);
        }
        if (employee.confirmationDate) {
            return errorResponse('This employee has already been confirmed', 409);
        }

        const confirmationDateStr = toDisplayDate(data.proposedConfirmationDate);

        const existingPending = await prisma.employeeConfirmation.findFirst({
            where: { employeeId: data.employeeId, status: 'PENDING' },
        });
        if (existingPending) {
            return errorResponse('This employee already has a pending confirmation request', 409);
        }

        // Helper to execute final confirmation side effects (letter generation + User confirmationDate + status APPROVED)
        const executeConfirmationSideEffects = async (confirmationId: string, approvalInstanceId?: string | null) => {
            const pdfBuffer = await buildConfirmationLetterPdf({
                refNo: `CNF-${confirmationId.slice(-8).toUpperCase()}`,
                issueDate: toDisplayDate(new Date()),
                confirmationDate: confirmationDateStr,
                recipient: {
                    employeeName: `${employee.firstName} ${employee.lastName}`,
                    employeeCode: employee.employeeId ?? 'N/A',
                    designation: employee.designation?.name ?? 'N/A',
                    department: employee.department?.name ?? 'N/A',
                    branchName: employee.branch?.name ?? 'N/A',
                },
            });
            const letterUrl = await uploadHrLetter({
                employeeId: employee.id,
                letterType: 'confirmation',
                pdfBuffer,
            });

            return prisma.$transaction(async (tx) => {
                await tx.user.update({
                    where: { id: employee.id },
                    data: { confirmationDate: data.proposedConfirmationDate },
                });

                return tx.employeeConfirmation.update({
                    where: { id: confirmationId },
                    data: {
                        status: 'APPROVED',
                        reviewedById: ctx.userId,
                        reviewedAt: new Date(),
                        letterUrl,
                        letterGeneratedAt: new Date(),
                        ...(approvalInstanceId !== undefined ? { approvalInstanceId } : {}),
                    },
                    include: {
                        employee: { select: { id: true, firstName: true, lastName: true, employeeId: true } },
                    },
                });
            });
        };

        // Create the record initially in PENDING status
        const confirmation = await prisma.employeeConfirmation.create({
            data: {
                employeeId: data.employeeId,
                proposedConfirmationDate: data.proposedConfirmationDate,
                initiatedById: ctx.userId,
                status: 'PENDING',
            },
            include: {
                employee: { select: { id: true, firstName: true, lastName: true, employeeId: true } },
            },
        });

        // Start generic dynamic approval workflow
        let approvalInstanceId: string | null = null;
        let isSkipApproval = false;
        try {
            const started = await startApprovalWorkflow({
                moduleSlug: 'hr-confirmation',
                recordType: 'hr_confirmation',
                recordId: confirmation.id,
                branchId: employee.branchId ?? '',
                submittedByUserId: ctx.userId,
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
            // No approval workflow could be started. Never fall back to confirming
            // the employee without approval — a misconfigured workflow or a
            // transient error would silently bypass the approver. Same rollback
            // Promotion, Transfer and Exit already do: don't leave a request behind
            // that nobody can ever approve.
            await cancelApprovalForRecord('hr_confirmation', confirmation.id, ctx.userId);
            await prisma.employeeConfirmation.delete({ where: { id: confirmation.id } });
            throw workflowError;
        }

        if (isSkipApproval) {
            const finalizedSkip = await executeConfirmationSideEffects(confirmation.id, approvalInstanceId);
            return successResponse(finalizedSkip, 'Confirmation issued and letter generated (auto-approved)', 201);
        }

        // Save approvalInstanceId on confirmation and remain PENDING awaiting approval
        const updatedPending = await prisma.employeeConfirmation.update({
            where: { id: confirmation.id },
            data: { approvalInstanceId },
            include: {
                employee: { select: { id: true, firstName: true, lastName: true, employeeId: true } },
            },
        });

        return successResponse(updatedPending, 'Confirmation initiated and submitted for approval', 201);
    } catch (error: unknown) {
        if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
        console.error('Error creating confirmation:', error);
        const message = error instanceof Error ? error.message : 'Failed to create confirmation request';
        return errorResponse(message, 500);
    }
}
