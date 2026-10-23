import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { errorResponse, successResponse, handleCorsPreflight } from '@/app/lib/api-utils';
import { requirePermission, isUserContext, isEmployeeInCallerScope } from '@/app/lib/permissions/guards';
import { processStageAction } from '@/app/lib/approval/engine';
import { executePromotionSideEffects } from '@/app/lib/hr/promotion-side-effects';

const APPROVED_INSTANCE_ERROR = "Instance is in 'APPROVED' state, cannot process";

export async function OPTIONS() {
    return handleCorsPreflight();
}

// POST /api/hr/promotions/[id]/approve
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const ctx = await requirePermission(request, 'hr-promotion', 'approve');
    if (!isUserContext(ctx)) return ctx;

    try {
        const { id } = await params;

        const promotion = await prisma.employeePromotion.findUnique({
            where: { id },
            include: {
                employee: {
                    select: {
                        id: true, firstName: true, lastName: true, employeeId: true, branchId: true,
                        department: { select: { name: true } },
                        branch: { select: { name: true } },
                    },
                },
                toDesignation: { select: { id: true, name: true } },
            },
        });
        if (!promotion) return errorResponse('Promotion request not found', 404);
        if (!(await isEmployeeInCallerScope(ctx, promotion.employee.branchId))) {
            return errorResponse('You do not have access to this employee', 403);
        }
        if (promotion.status === 'APPROVED') {
            return successResponse(promotion, 'Promotion already approved');
        }
        if (promotion.status !== 'PENDING') {
            return errorResponse(`Cannot approve a request in '${promotion.status}' status`, 409);
        }

        const finalize = () => executePromotionSideEffects({
            promotionId: id,
            employeeId: promotion.employeeId,
            employeeFirstName: promotion.employee.firstName,
            employeeLastName: promotion.employee.lastName,
            employeeCode: promotion.employee.employeeId,
            departmentName: promotion.employee.department?.name ?? null,
            branchName: promotion.employee.branch?.name ?? null,
            toDesignationName: promotion.toDesignation.name,
            actorUserId: ctx.userId,
        });

        // ENGINE PATH: Row has an approvalInstanceId
        let approvalInstanceId = promotion.approvalInstanceId;
        if (!approvalInstanceId) {
            const existingInstance = await prisma.approvalInstance.findFirst({
                where: {
                    recordType: 'EmployeePromotion',
                    recordId: id,
                    status: { in: ['PENDING', 'IN_PROGRESS'] },
                },
                select: { id: true },
            });
            if (existingInstance) {
                approvalInstanceId = existingInstance.id;
                await prisma.employeePromotion.update({
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
                // promotion (letter generation/upload) — the row is still PENDING and the
                // instance can never be approved again. Finish just the side effect
                // instead of leaving the promotion stuck.
                if (engineError instanceof Error && engineError.message === APPROVED_INSTANCE_ERROR) {
                    outcome = { newStatus: 'APPROVED', nextStage: null };
                } else {
                    throw engineError;
                }
            }

            if (outcome.newStatus === 'APPROVED') {
                const updated = await finalize();
                return successResponse(updated, 'Promotion approved successfully');
            }

            // Intermediate stage approved: remain PENDING awaiting next stage
            return successResponse(
                promotion,
                `Approved at this level — now awaiting ${outcome.nextStage ?? 'the next approval level'}`
            );
        }

        // LEGACY PATH: Legacy row with approvalInstanceId = null
        const isAdmin = ctx.roles.some((r) => r.roleSlug === 'admin');
        if (promotion.initiatedById === ctx.userId && !isAdmin) {
            return errorResponse('Self-approval is not allowed', 400);
        }

        const updated = await finalize();
        return successResponse(updated, 'Promotion approved successfully');
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to approve promotion';
        if (message === 'Self-approval is not allowed') {
            return errorResponse('Self-approval is not allowed', 400);
        }
        if (message.startsWith('Action requires role') || message.startsWith('You do not have access')) {
            return errorResponse(message, 403);
        }
        if (message.includes('already ') || message.includes('cannot process')) {
            return errorResponse(message, 409);
        }
        console.error('Error approving promotion:', error);
        return errorResponse(message, 500);
    }
}
