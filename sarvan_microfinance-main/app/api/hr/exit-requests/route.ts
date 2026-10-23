import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse } from '@/app/lib/api-utils';
import { requirePermission, isUserContext } from '@/app/lib/permissions/guards';
import { describePendingApprovals } from '@/app/lib/approval/record-approval';
import { startApprovalWorkflow, cancelApprovalForRecord } from '@/app/lib/approval/engine';
import { buildRelievingLetterPdf } from '@/app/lib/reports/relieving-letter-pdf';
import { uploadHrLetter } from '@/app/lib/storage/hr-letter-storage';
import { getOutstandingBelongings, getOutstandingBelongingsCounts, outstandingBelongingsMessage } from '@/app/lib/hr/exit-belongings-check';
import { toDisplayDate } from '@/app/lib/date-format';
import { getPermittedBranchIdsForContext } from '@/app/lib/permissions/branch-scope';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const EXIT_TYPES = [
    'VOLUNTARY_RESIGNATION', 'ABSCONDING', 'ASK_TO_GO', 'APPOINTMENT_CANCELLATION',
    'TERMINATION', 'DECEASED', 'RETIREMENT',
] as const;

const EXIT_TYPE_LABELS: Record<string, string> = {
    VOLUNTARY_RESIGNATION: 'Voluntary Resignation',
    ABSCONDING: 'Absconding',
    ASK_TO_GO: 'Ask to Go',
    APPOINTMENT_CANCELLATION: 'Appointment Cancellation',
    TERMINATION: 'Termination',
    DECEASED: 'Deceased',
    RETIREMENT: 'Retirement',
};

const createSchema = z.object({
    employeeId: z.string().min(1),
    exitType: z.enum(EXIT_TYPES),
    requestedDate: z.coerce.date(),
    lastWorkingDate: z.coerce.date(),
    reason: z.string().optional().nullable(),
});

// GET /api/hr/exit-requests — 'view' permission
export async function GET(request: NextRequest) {
    const ctx = await requirePermission(request, 'hr-exit', 'view');
    if (!isUserContext(ctx)) return ctx;

    try {
        const permittedBranchIds = await getPermittedBranchIdsForContext(ctx);
        const exitRequests = await prisma.employeeExitRequest.findMany({
            where: permittedBranchIds ? { employee: { branchId: { in: permittedBranchIds } } } : {},
            include: {
                employee: { select: { id: true, firstName: true, lastName: true, employeeId: true, branchId: true, branch: { select: { name: true } } } },
                initiatedBy: { select: { id: true, firstName: true, lastName: true } },
                clearanceItems: true,
            },
            orderBy: { initiatedAt: 'desc' },
        });
        const inProgress = exitRequests.filter((r) => r.status === 'IN_PROGRESS');
        const approvals = await describePendingApprovals(
            'hr-exit',
            'EmployeeExitRequest',
            inProgress.map((r) => ({ id: r.id, branchId: r.employee.branchId })),
            ctx
        );
        const outstandingBelongingsCounts = await getOutstandingBelongingsCounts(inProgress.map((r) => r.employeeId));
        return successResponse(
            exitRequests.map((r) => ({
                ...r,
                approval: approvals.get(r.id) ?? null,
                outstandingBelongingsCount: outstandingBelongingsCounts.get(r.employeeId) ?? 0,
            })),
            'Exit requests fetched successfully'
        );
    } catch (error: unknown) {
        console.error('Error fetching exit requests:', error);
        const message = error instanceof Error ? error.message : 'Failed to fetch exit requests';
        return errorResponse(message, 500);
    }
}

// POST /api/hr/exit-requests — snapshots applicable ExitClearanceItemConfig
// rows into per-request EmployeeExitClearanceItem checklist items.
export async function POST(request: NextRequest) {
    const ctx = await requirePermission(request, 'hr-exit', 'create');
    if (!isUserContext(ctx)) return ctx;

    try {
        const body = await request.json();
        const data = createSchema.parse(body);

        if (data.lastWorkingDate < data.requestedDate) {
            return errorResponse('Last working date cannot be before the requested date', 400);
        }

        const employee = await prisma.user.findUnique({
            where: { id: data.employeeId },
            select: {
                id: true,
                firstName: true,
                lastName: true,
                employeeId: true,
                dateOfJoining: true,
                isActive: true,
                branchId: true,
                designation: { select: { name: true } },
                department: { select: { name: true } },
                branch: { select: { name: true } },
            },
        });
        if (!employee) return errorResponse('Employee not found', 404);
        if (!employee.isActive) {
            return errorResponse('This employee has already exited — cannot create another exit request for them', 409);
        }

        const existing = await prisma.employeeExitRequest.findFirst({
            where: { employeeId: data.employeeId, status: { in: ['IN_PROGRESS', 'HR_APPROVED'] } },
        });
        if (existing) {
            return errorResponse('This employee already has an exit request in progress', 409);
        }

        const applicableConfigItems = await prisma.exitClearanceItemConfig.findMany({
            where: {
                isActive: true,
                OR: [{ exitTypes: { isEmpty: true } }, { exitTypes: { has: data.exitType } }],
            },
            orderBy: [{ department: 'asc' }, { sortOrder: 'asc' }],
        });

        const exitRequest = await prisma.employeeExitRequest.create({
            data: {
                employeeId: data.employeeId,
                exitType: data.exitType,
                requestedDate: data.requestedDate,
                lastWorkingDate: data.lastWorkingDate,
                reason: data.reason,
                initiatedById: ctx.userId,
                clearanceItems: {
                    create: applicableConfigItems.map((item) => ({
                        configItemId: item.id,
                        department: item.department,
                        itemName: item.itemName,
                    })),
                },
            },
            include: { clearanceItems: true },
        });

        const executeExitSideEffects = async (exitRequestId: string, approvalInstanceId?: string | null) => {
            const pdfBuffer = await buildRelievingLetterPdf({
                refNo: `REL-${exitRequestId.slice(-8).toUpperCase()}`,
                issueDate: toDisplayDate(new Date()),
                dateOfJoining: (employee.dateOfJoining == null ? undefined : toDisplayDate(employee.dateOfJoining)) ?? 'N/A',
                lastWorkingDate: toDisplayDate(data.lastWorkingDate),
                exitTypeLabel: EXIT_TYPE_LABELS[data.exitType] ?? data.exitType,
                recipient: {
                    employeeName: `${employee.firstName} ${employee.lastName}`,
                    employeeCode: employee.employeeId ?? 'N/A',
                    designation: employee.designation?.name ?? 'N/A',
                    department: employee.department?.name ?? 'N/A',
                    branchName: employee.branch?.name ?? 'N/A',
                },
            });
            const relievingLetterUrl = await uploadHrLetter({
                employeeId: data.employeeId,
                letterType: 'relieving',
                pdfBuffer,
            });

            const now = new Date();
            return prisma.$transaction(async (tx) => {
                await tx.user.update({
                    where: { id: data.employeeId },
                    data: { isActive: false, dateOfExit: data.lastWorkingDate },
                });

                // Auto-clear clearance items upon skip-approval
                await tx.employeeExitClearanceItem.updateMany({
                    where: { exitRequestId },
                    data: {
                        status: 'CLEARED',
                        clearedById: ctx.userId,
                        clearedAt: now,
                        remarks: 'Auto-cleared via skip-approval',
                    },
                });

                return tx.employeeExitRequest.update({
                    where: { id: exitRequestId },
                    data: {
                        status: 'COMPLETED',
                        finalHrApprovedById: ctx.userId,
                        finalHrApprovedAt: now,
                        ndcGeneratedAt: now,
                        relievingLetterUrl,
                        employeeDeactivatedAt: now,
                        ...(approvalInstanceId !== undefined ? { approvalInstanceId } : {}),
                    },
                    include: {
                        employee: { select: { id: true, firstName: true, lastName: true, employeeId: true } },
                        clearanceItems: true,
                    },
                });
            });
        };

        // Start generic dynamic approval workflow
        let approvalInstanceId: string | null = null;
        let isSkipApproval = false;
        try {
            const started = await startApprovalWorkflow({
                moduleSlug: 'hr-exit',
                recordType: 'EmployeeExitRequest',
                recordId: exitRequest.id,
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
            // No approval workflow could be started — don't leave a request behind that nobody can ever finalize.
            await cancelApprovalForRecord('EmployeeExitRequest', exitRequest.id, ctx.userId);
            await prisma.employeeExitRequest.delete({ where: { id: exitRequest.id } });
            throw workflowError;
        }

        // Skip-approval auto-finalizes immediately (deactivates the employee) —
        // it must not do that while they're still holding company belongings.
        // Rather than fail the whole creation over this, just don't auto-finalize:
        // the request is still created, sitting IN_PROGRESS same as any other,
        // and Final Approval will re-check this once the items are returned.
        const outstandingAtCreate = isSkipApproval ? await getOutstandingBelongings(data.employeeId) : [];
        if (outstandingAtCreate.length > 0) {
            isSkipApproval = false;
        }

        if (isSkipApproval) {
            const finalizedSkip = await executeExitSideEffects(exitRequest.id, approvalInstanceId);
            return successResponse(finalizedSkip, 'Exit request created and finalized successfully', 201);
        }

        // Save approvalInstanceId on exitRequest and remain IN_PROGRESS awaiting clearance and approval
        const updatedPending = await prisma.employeeExitRequest.update({
            where: { id: exitRequest.id },
            data: { approvalInstanceId },
            include: {
                employee: { select: { id: true, firstName: true, lastName: true, employeeId: true } },
                clearanceItems: true,
            },
        });

        return successResponse(
            updatedPending,
            outstandingAtCreate.length > 0
                ? `Exit request created successfully. Not auto-finalized — ${outstandingBelongingsMessage(outstandingAtCreate)}`
                : 'Exit request created successfully',
            201
        );
    } catch (error: unknown) {
        if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
        console.error('Error creating exit request:', error);
        const message = error instanceof Error ? error.message : 'Failed to create exit request';
        return errorResponse(message, 500);
    }
}
