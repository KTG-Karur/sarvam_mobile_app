import { NextRequest } from 'next/server';
import { z } from 'zod';
import type { ApprovalStatus } from '@prisma/client';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse } from '@/app/lib/api-utils';
import { requirePermission, isUserContext } from '@/app/lib/permissions/guards';
import { processStageAction } from '@/app/lib/approval/engine';
import { invalidateUserPermissions } from '@/app/lib/permissions/engine';
import { bumpMasterDataVersion } from '@/app/lib/cache/master-data-cache';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const actionSchema = z.object({
    action: z.enum(['approve', 'reject', 'send_back']),
    remarks: z.string().optional(),
});

// POST /api/hr/transfers/[id]/action — advance the transfer's ApprovalInstance
// via the generic engine (app/lib/approval/engine.ts), then apply the
// domain-specific side effect (User.branchId/departmentId update) once every
// stage is APPROVED. The engine itself intentionally has no knowledge of this
// side effect — it's applied here, in its own transaction, on success.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const ctx = await requirePermission(request, 'hr-transfer', 'approve');
    if (!isUserContext(ctx)) return ctx;

    try {
        const { id } = await params;
        const transfer = await prisma.employeeTransfer.findUnique({ where: { id } });
        if (!transfer) return errorResponse('Transfer not found', 404);
        if (!transfer.approvalInstanceId) return errorResponse('This transfer has no active approval workflow', 409);
        const isAdmin = ctx.roles.some((r) => r.roleSlug === 'admin');
        if (transfer.requestedById === ctx.userId && !isAdmin) {
            return errorResponse('Self-approval is not allowed', 400);
        }

        const body = await request.json();
        const { action, remarks } = actionSchema.parse(body);

        const outcome = await processStageAction(
            { instanceId: transfer.approvalInstanceId, actorUserId: ctx.userId, action, remarks },
            ctx
        );

        const updated = await prisma.$transaction(async (tx) => {
            if (outcome.newStatus === 'APPROVED') {
                // Snapshot what the departing employee currently holds BEFORE any
                // branch reassignment below runs — otherwise an AREA_MANAGER's
                // brand-new AreaManagerBranch row for their destination branch
                // (created a few lines down) would immediately get swept up and
                // handed to the replacement along with their real old branches.
                let departingCenters: { id: string; meetingDay: string | null }[] = [];
                let departingBranches: { id: string; branchId: string; isPrimary: boolean }[] = [];
                if (transfer.replacementEmployeeId) {
                    const departingEmployee = await tx.user.findUnique({
                        where: { id: transfer.employeeId },
                        select: { role: true },
                    });
                    if (departingEmployee?.role === 'FDO') {
                        departingCenters = await tx.center.findMany({
                            where: { fdoId: transfer.employeeId, isActive: true },
                            select: { id: true, meetingDay: true },
                        });
                    } else if (departingEmployee?.role === 'AREA_MANAGER') {
                        departingBranches = await tx.areaManagerBranch.findMany({
                            where: { userId: transfer.employeeId },
                            select: { id: true, branchId: true, isPrimary: true },
                        });
                    }
                }

                if (transfer.transferType === 'DEPARTMENT' && transfer.toDepartmentId) {
                    await tx.user.update({
                        where: { id: transfer.employeeId },
                        data: { departmentId: transfer.toDepartmentId },
                    });
                } else if (transfer.toBranchId) {
                    const employee = await tx.user.findUnique({
                        where: { id: transfer.employeeId },
                        select: { role: true },
                    });

                    await tx.user.update({
                        where: { id: transfer.employeeId },
                        data: { branchId: transfer.toBranchId },
                    });

                    // Keep UserBranchAccess's primary flag in step with the
                    // employee's actual branch — otherwise their login
                    // context (and anything that reads this table rather
                    // than User.branchId directly) keeps pointing at the old
                    // branch after the move.
                    const oldPrimaryAccess = await tx.userBranchAccess.findFirst({
                        where: { userId: transfer.employeeId, isPrimary: true },
                    });
                    await tx.userBranchAccess.updateMany({
                        where: { userId: transfer.employeeId, isPrimary: true },
                        data: { isPrimary: false },
                    });
                    const existingNewAccess = await tx.userBranchAccess.findFirst({
                        where: { userId: transfer.employeeId, branchId: transfer.toBranchId },
                    });
                    if (existingNewAccess) {
                        await tx.userBranchAccess.update({
                            where: { id: existingNewAccess.id },
                            data: { isPrimary: true, isActive: true },
                        });
                    } else {
                        await tx.userBranchAccess.create({
                            data: {
                                userId: transfer.employeeId,
                                branchId: transfer.toBranchId,
                                accessType: oldPrimaryAccess?.accessType ?? 'OPERATIONAL',
                                isPrimary: true,
                                isActive: true,
                            },
                        });
                    }

                    // Area Managers carry a separate AreaManagerBranch primary
                    // assignment (used for AM-scoped branch data access) — same
                    // staleness risk, same fix, mirroring how onboarding
                    // provisioning already sets this up for a newly-created AM.
                    if (employee?.role === 'AREA_MANAGER') {
                        await tx.areaManagerBranch.updateMany({
                            where: { userId: transfer.employeeId, isPrimary: true },
                            data: { isPrimary: false },
                        });
                        const existingAmBranch = await tx.areaManagerBranch.findFirst({
                            where: { userId: transfer.employeeId, branchId: transfer.toBranchId },
                        });
                        if (existingAmBranch) {
                            await tx.areaManagerBranch.update({
                                where: { id: existingAmBranch.id },
                                data: { isPrimary: true },
                            });
                        } else {
                            await tx.areaManagerBranch.create({
                                data: { userId: transfer.employeeId, branchId: transfer.toBranchId, isPrimary: true },
                            });
                        }
                    }
                }

                // Hand the departing employee's snapshotted position over to the
                // chosen replacement.
                if (transfer.replacementEmployeeId) {
                    for (const center of departingCenters) {
                        await tx.center.update({
                            where: { id: center.id },
                            data: { fdoId: transfer.replacementEmployeeId },
                        });
                        await tx.centerTransfer.create({
                            data: {
                                centerId: center.id,
                                previousFdoId: transfer.employeeId,
                                transferredToFdoId: transfer.replacementEmployeeId,
                                meetingDay: center.meetingDay,
                                transferredById: ctx.userId,
                            },
                        });
                    }

                    for (const branch of departingBranches) {
                        const existingForReplacement = await tx.areaManagerBranch.findFirst({
                            where: { userId: transfer.replacementEmployeeId, branchId: branch.branchId },
                        });
                        if (existingForReplacement) {
                            if (branch.isPrimary && !existingForReplacement.isPrimary) {
                                await tx.areaManagerBranch.update({
                                    where: { id: existingForReplacement.id },
                                    data: { isPrimary: true },
                                });
                            }
                        } else {
                            await tx.areaManagerBranch.create({
                                data: {
                                    userId: transfer.replacementEmployeeId,
                                    branchId: branch.branchId,
                                    isPrimary: branch.isPrimary,
                                },
                            });
                        }
                        await tx.areaManagerBranch.delete({ where: { id: branch.id } });
                    }
                }
            }

            return tx.employeeTransfer.update({
                where: { id },
                data: {
                    status: outcome.newStatus as ApprovalStatus,
                    completedAt: outcome.newStatus === 'APPROVED' || outcome.newStatus === 'REJECTED' ? new Date() : null,
                },
            });
        });

        if (outcome.newStatus === 'APPROVED') {
            try {
                await invalidateUserPermissions(transfer.employeeId);
                if (transfer.replacementEmployeeId) {
                    await invalidateUserPermissions(transfer.replacementEmployeeId);
                }
            } catch (permissionError) {
                console.error('Failed to invalidate permissions after transfer approval:', permissionError);
            }
            // Departing FDO's centers may have been handed to a replacement — moves
            // those centers between FDO-scoped minimal-list cache entries.
            if (transfer.replacementEmployeeId) {
                await bumpMasterDataVersion('centers:minimal');
            }
        }

        return successResponse({ transfer: updated, ...outcome }, `Transfer ${action}d successfully`);
    } catch (error: unknown) {
        if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
        const message = error instanceof Error ? error.message : 'Failed to process transfer action';
        if (message === 'Self-approval is not allowed') {
            return errorResponse('Self-approval is not allowed', 400);
        }
        console.error('Error processing transfer action:', error);
        return errorResponse(message, 400);
    }
}
