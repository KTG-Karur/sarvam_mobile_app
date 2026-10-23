import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse } from '@/app/lib/api-utils';
import { requirePermission, isUserContext } from '@/app/lib/permissions/guards';
import { startApprovalWorkflow, cancelApprovalForRecord } from '@/app/lib/approval/engine';
import { getPermittedBranchIdsForContext } from '@/app/lib/permissions/branch-scope';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const baseSchema = z.object({
    employeeId: z.string().min(1),
    transferType: z.enum(['BRANCH', 'AREA', 'REGION', 'DEPARTMENT']),
    toBranchId: z.string().optional(),
    toAreaId: z.string().optional(),
    toRegionId: z.string().optional(),
    toDepartmentId: z.string().optional(),
    effectiveDate: z.coerce.date(),
    reason: z.string().optional().nullable(),
    replacementEmployeeId: z.string().optional(),
});

// Every transfer type that relocates the employee (BRANCH/AREA/REGION) ultimately
// changes User.branchId (the only real "location" scalar on User) — toAreaId/
// toRegionId are descriptive/audit metadata alongside the required toBranchId.
// DEPARTMENT transfers change User.departmentId instead and need no branch.
const createSchema = baseSchema.refine((data) => {
    if (data.transferType === 'DEPARTMENT') return !!data.toDepartmentId;
    return !!data.toBranchId;
}, { message: 'toBranchId is required for BRANCH/AREA/REGION transfers; toDepartmentId is required for DEPARTMENT transfers' });

// GET /api/hr/transfers — 'view' permission, not just any authenticated
// user: a bare withAuth here let anyone signed in list/enumerate transfer
// records (source/destination branch, requester) regardless of whether
// they hold any hr-transfer permission at all.
export async function GET(request: NextRequest) {
    const ctx = await requirePermission(request, 'hr-transfer', 'view');
    if (!isUserContext(ctx)) return ctx;

    try {
        const permittedBranchIds = await getPermittedBranchIdsForContext(ctx);
        const transfers = await prisma.employeeTransfer.findMany({
            where: permittedBranchIds ? { employee: { branchId: { in: permittedBranchIds } } } : {},
            include: {
                employee: { select: { id: true, firstName: true, lastName: true, employeeId: true } },
                fromBranch: { select: { name: true } },
                toBranch: { select: { name: true } },
                fromDepartment: { select: { name: true } },
                toDepartment: { select: { name: true } },
                requestedBy: { select: { id: true, firstName: true, lastName: true } },
                replacementEmployee: { select: { id: true, firstName: true, lastName: true } },
            },
            orderBy: { requestedAt: 'desc' },
        });
        return successResponse(transfers, 'Transfers fetched successfully');
    } catch (error: any) {
        console.error('Error fetching transfers:', error);
        return errorResponse(error.message || 'Failed to fetch transfers', 500);
    }
}

// POST /api/hr/transfers
export async function POST(request: NextRequest) {
    const ctx = await requirePermission(request, 'hr-transfer', 'create');
    if (!isUserContext(ctx)) return ctx;

    try {
        const body = await request.json();
        const data = createSchema.parse(body);

        const employee = await prisma.user.findUnique({
            where: { id: data.employeeId },
            select: { id: true, role: true, branchId: true, departmentId: true, isActive: true },
        });
        if (!employee) return errorResponse('Employee not found', 404);
        if (employee.isActive === false) {
            return errorResponse('This employee is no longer active — cannot transfer them', 409);
        }

        const fromBranchId = employee.branchId;

        // A transfer to where the employee already is (or into the department
        // they already hold) changes nothing and would still burn an approval.
        if (data.transferType === 'DEPARTMENT') {
            if (data.toDepartmentId && data.toDepartmentId === employee.departmentId) {
                return errorResponse('This employee is already in that department', 400);
            }
        } else if (data.toBranchId) {
            if (data.toBranchId === employee.branchId) {
                return errorResponse('This employee is already in that branch', 400);
            }
            const toBranch = await prisma.branch.findUnique({ where: { id: data.toBranchId }, select: { isActive: true } });
            if (!toBranch || !toBranch.isActive) {
                return errorResponse('Selected branch is not valid', 400);
            }
        }

        // Two open transfers for one employee would each apply on approval,
        // the second silently overriding the first (same guard Promotion has).
        const openTransfer = await prisma.employeeTransfer.findFirst({
            where: { employeeId: data.employeeId, status: { in: ['PENDING', 'IN_PROGRESS'] } },
            select: { id: true },
        });
        if (openTransfer) {
            return errorResponse('This employee already has a transfer request in progress', 409);
        }

        // Only FDO (Center.fdoId) and AREA_MANAGER (AreaManagerBranch) have a
        // one-employee-to-many-locations table to hand over — don't trust the
        // client's requiresReplacement flag, recompute it server-side.
        let currentPositionCount = 0;
        if (employee.role === 'FDO') {
            currentPositionCount = await prisma.center.count({ where: { fdoId: data.employeeId, isActive: true } });
        } else if (employee.role === 'AREA_MANAGER') {
            currentPositionCount = await prisma.areaManagerBranch.count({ where: { userId: data.employeeId } });
        }

        if (currentPositionCount > 0) {
            if (!data.replacementEmployeeId) {
                return errorResponse('A replacement employee is required — this employee currently holds an assigned position', 400);
            }
            if (data.replacementEmployeeId === data.employeeId) {
                return errorResponse('Replacement employee cannot be the same as the transferring employee', 400);
            }
            const replacement = await prisma.user.findUnique({
                where: { id: data.replacementEmployeeId },
                select: { role: true, branchId: true, isActive: true },
            });
            if (!replacement || !replacement.isActive) {
                return errorResponse('Replacement employee not found or inactive', 400);
            }
            if (replacement.role !== employee.role) {
                return errorResponse(`Replacement employee must also be a ${employee.role}`, 400);
            }
            if (employee.role === 'FDO' && replacement.branchId !== employee.branchId) {
                return errorResponse('Replacement FDO must belong to the same branch', 400);
            }
        }

        const transfer = await prisma.employeeTransfer.create({
            data: {
                employeeId: data.employeeId,
                transferType: data.transferType,
                fromBranchId: data.transferType !== 'DEPARTMENT' ? fromBranchId : undefined,
                toBranchId: data.transferType !== 'DEPARTMENT' ? data.toBranchId : undefined,
                fromAreaId: undefined,
                toAreaId: data.transferType === 'AREA' ? data.toAreaId : undefined,
                fromRegionId: undefined,
                toRegionId: data.transferType === 'REGION' ? data.toRegionId : undefined,
                fromDepartmentId: data.transferType === 'DEPARTMENT' ? employee.departmentId : undefined,
                toDepartmentId: data.transferType === 'DEPARTMENT' ? data.toDepartmentId : undefined,
                effectiveDate: data.effectiveDate,
                reason: data.reason,
                requestedById: ctx.userId,
                replacementEmployeeId: currentPositionCount > 0 ? data.replacementEmployeeId : undefined,
            },
        });

        try {
            const { instanceId } = await startApprovalWorkflow({
                moduleSlug: 'hr-transfer',
                recordType: 'EmployeeTransfer',
                recordId: transfer.id,
                branchId: fromBranchId ?? ctx.branchId ?? '',
                submittedByUserId: ctx.userId,
            });

            const updated = await prisma.employeeTransfer.update({
                where: { id: transfer.id },
                data: { approvalInstanceId: instanceId, status: 'PENDING' },
            });

            return successResponse(updated, 'Transfer request submitted for approval', 201);
        } catch (workflowError: any) {
            // Roll back the orphaned transfer row if no approval workflow could be started
            // (e.g. no active ApprovalWorkflow configured yet for hr-transfer).
            await cancelApprovalForRecord('EmployeeTransfer', transfer.id, ctx.userId);
            await prisma.employeeTransfer.delete({ where: { id: transfer.id } });
            throw workflowError;
        }
    } catch (error: any) {
        if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
        console.error('Error creating transfer:', error);
        return errorResponse(error.message || 'Failed to create transfer request', 500);
    }
}
