import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { errorResponse, successResponse, handleCorsPreflight } from '@/app/lib/api-utils';
import { requirePermission, isUserContext } from '@/app/lib/permissions/guards';

export async function OPTIONS() {
    return handleCorsPreflight();
}

// GET /api/hr/employees/[id]/history — CTC change history + role (Designation)
// change history for the Employee edit page's History tab. Role history is
// sourced from APPROVED EmployeePromotion rows — a Designation changed
// directly on the Organization tab (bypassing Promotion) has no audit trail
// today and so won't appear here; that's an existing gap on that field, not
// something this endpoint can recover.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const ctx = await requirePermission(request, 'hr-employee', 'view');
    if (!isUserContext(ctx)) return ctx;

    try {
        const { id } = await params;
        const employee = await prisma.user.findUnique({ where: { id }, select: { id: true, branchId: true } });
        if (!employee) return errorResponse('Employee not found', 404);

        const permittedBranchIds = ctx.isHeadOffice ? null : ctx.branchAccess.map((ba) => ba.branchId);
        if (permittedBranchIds !== null && (!employee.branchId || !permittedBranchIds.includes(employee.branchId))) {
            return errorResponse('You do not have access to this employee', 403);
        }

        const [ctcHistory, roleHistory] = await Promise.all([
            prisma.employeeCtcHistory.findMany({
                where: { employeeId: id },
                include: { changedBy: { select: { firstName: true, lastName: true } } },
                orderBy: { effectiveDate: 'desc' },
            }),
            prisma.employeePromotion.findMany({
                where: { employeeId: id, status: 'APPROVED' },
                include: {
                    fromDesignation: { select: { name: true } },
                    toDesignation: { select: { name: true } },
                    reviewedBy: { select: { firstName: true, lastName: true } },
                },
                orderBy: { effectiveDate: 'desc' },
            }),
        ]);

        return successResponse({
            ctcHistory: ctcHistory.map((h) => ({
                id: h.id,
                effectiveDate: h.effectiveDate,
                fromMonthlyCtc: h.fromMonthlyCtc ? Number(h.fromMonthlyCtc) : null,
                toMonthlyCtc: Number(h.toMonthlyCtc),
                source: h.source,
                changedByName: h.changedBy ? `${h.changedBy.firstName} ${h.changedBy.lastName}` : null,
            })),
            roleHistory: roleHistory.map((p) => ({
                id: p.id,
                effectiveDate: p.effectiveDate,
                fromDesignationName: p.fromDesignation?.name ?? null,
                toDesignationName: p.toDesignation.name,
                approvedByName: p.reviewedBy ? `${p.reviewedBy.firstName} ${p.reviewedBy.lastName}` : null,
            })),
        }, 'Employee history fetched successfully');
    } catch (error: any) {
        console.error('Error fetching employee history:', error);
        return errorResponse(error.message || 'Failed to fetch employee history', 500);
    }
}
