import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse } from '@/app/lib/api-utils';
import { requirePermission, isUserContext } from '@/app/lib/permissions/guards';
import { getKolkataCalendarYmd } from '@/app/lib/branch-lock';
import { describePendingApprovals } from '@/app/lib/approval/record-approval';
import { startApprovalWorkflow, cancelApprovalForRecord } from '@/app/lib/approval/engine';
import { executePromotionSideEffects } from '@/app/lib/hr/promotion-side-effects';
import { getPermittedBranchIdsForContext } from '@/app/lib/permissions/branch-scope';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const createSchema = z.object({
    employeeId: z.string().min(1),
    toDesignationId: z.string().min(1),
    effectiveDate: z.coerce.date(),
    reason: z.string().optional().nullable(),
    // Optional — a title-only promotion leaves CTC unchanged.
    toMonthlyCtc: z.number().min(0).optional().nullable(),
});

// GET /api/hr/promotions — 'view' permission
export async function GET(request: NextRequest) {
    const ctx = await requirePermission(request, 'hr-promotion', 'view');
    if (!isUserContext(ctx)) return ctx;

    try {
        const permittedBranchIds = await getPermittedBranchIdsForContext(ctx);
        const promotions = await prisma.employeePromotion.findMany({
            where: permittedBranchIds ? { employee: { branchId: { in: permittedBranchIds } } } : {},
            include: {
                employee: { select: { id: true, firstName: true, lastName: true, employeeId: true, branchId: true, branch: { select: { name: true } } } },
                fromDesignation: { select: { id: true, name: true } },
                toDesignation: { select: { id: true, name: true } },
                initiatedBy: { select: { id: true, firstName: true, lastName: true } },
                reviewedBy: { select: { id: true, firstName: true, lastName: true } },
            },
            orderBy: { initiatedAt: 'desc' },
        });
        const approvals = await describePendingApprovals(
            'hr-promotion',
            'EmployeePromotion',
            promotions.filter((p) => p.status === 'PENDING').map((p) => ({ id: p.id, branchId: p.employee.branchId })),
            ctx
        );
        return successResponse(
            promotions.map((p) => ({ ...p, approval: approvals.get(p.id) ?? null })),
            'Promotions fetched successfully'
        );
    } catch (error: unknown) {
        console.error('Error fetching promotions:', error);
        const message = error instanceof Error ? error.message : 'Failed to fetch promotions';
        return errorResponse(message, 500);
    }
}

// POST /api/hr/promotions
export async function POST(request: NextRequest) {
    const ctx = await requirePermission(request, 'hr-promotion', 'create');
    if (!isUserContext(ctx)) return ctx;

    try {
        const body = await request.json();
        const data = createSchema.parse(body);

        const employee = await prisma.user.findUnique({
            where: { id: data.employeeId },
            select: {
                id: true,
                firstName: true,
                lastName: true,
                employeeId: true,
                designationId: true,
                branchId: true,
                isActive: true,
                department: { select: { name: true } },
                branch: { select: { name: true } },
                employeeCtcMaster: { select: { monthlyCtc: true } },
            },
        });
        if (!employee) return errorResponse('Employee not found', 404);
        if (employee.isActive === false) {
            return errorResponse('This employee is no longer active — cannot promote them', 409);
        }

        if (employee.designationId && employee.designationId === data.toDesignationId) {
            return errorResponse('This employee already holds that designation', 400);
        }

        const toDesignation = await prisma.designation.findUnique({
            where: { id: data.toDesignationId },
            select: { id: true, name: true, defaultRoleSlug: true },
        });
        if (!toDesignation) return errorResponse('Designation not found', 404);

        if (getKolkataCalendarYmd(data.effectiveDate) < getKolkataCalendarYmd(new Date())) {
            return errorResponse('Effective date cannot be in the past', 400);
        }

        const existing = await prisma.employeePromotion.findFirst({
            where: { employeeId: data.employeeId, status: 'PENDING' },
        });
        if (existing) {
            return errorResponse('This employee already has a pending promotion request', 409);
        }

        const promotion = await prisma.employeePromotion.create({
            data: {
                employeeId: data.employeeId,
                fromDesignationId: employee.designationId,
                toDesignationId: data.toDesignationId,
                fromMonthlyCtc: employee.employeeCtcMaster?.monthlyCtc ?? null,
                toMonthlyCtc: data.toMonthlyCtc ?? null,
                effectiveDate: data.effectiveDate,
                reason: data.reason,
                initiatedById: ctx.userId,
            },
            include: {
                employee: { select: { id: true, firstName: true, lastName: true, employeeId: true } },
                toDesignation: { select: { id: true, name: true } },
            },
        });

        // Start generic dynamic approval workflow
        let approvalInstanceId: string | null = null;
        let isSkipApproval = false;
        try {
            const started = await startApprovalWorkflow({
                moduleSlug: 'hr-promotion',
                recordType: 'EmployeePromotion',
                recordId: promotion.id,
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
            // No approval workflow could be started — don't leave a request behind that nobody can ever approve.
            await cancelApprovalForRecord('EmployeePromotion', promotion.id, ctx.userId);
            await prisma.employeePromotion.delete({ where: { id: promotion.id } });
            throw workflowError;
        }

        // Save approvalInstanceId on the promotion either way — the shared
        // side-effects helper re-reads the row fresh, so this must land first.
        const updatedPending = await prisma.employeePromotion.update({
            where: { id: promotion.id },
            data: { approvalInstanceId },
            include: {
                employee: { select: { id: true, firstName: true, lastName: true, employeeId: true } },
                toDesignation: { select: { id: true, name: true } },
            },
        });

        if (isSkipApproval) {
            const finalizedSkip = await executePromotionSideEffects({
                promotionId: promotion.id,
                employeeId: data.employeeId,
                employeeFirstName: employee.firstName,
                employeeLastName: employee.lastName,
                employeeCode: employee.employeeId,
                departmentName: employee.department?.name ?? null,
                branchName: employee.branch?.name ?? null,
                toDesignationName: toDesignation.name,
                actorUserId: ctx.userId,
            });
            return successResponse(finalizedSkip, 'Promotion request created and approved successfully', 201);
        }

        return successResponse(updatedPending, 'Promotion request created successfully', 201);
    } catch (error: unknown) {
        if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
        console.error('Error creating promotion:', error);
        const message = error instanceof Error ? error.message : 'Failed to create promotion request';
        return errorResponse(message, 500);
    }
}
