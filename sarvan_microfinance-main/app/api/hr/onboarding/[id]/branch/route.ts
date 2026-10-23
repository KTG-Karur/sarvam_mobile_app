// ============================================================
// PATCH /api/hr/onboarding/[id]/branch — correct a mis-picked branch on an
// in-flight request, self-serviceable instead of a manual DB patch.
//
// Safety gate: only allowed while Stage 1 is still undecided — i.e. nobody
// has approved/rejected/sent-back anything yet. Checking
// EmployeeOnboardingRequest.status alone isn't enough (it stays
// 'PENDING_APPROVAL' through every intermediate stage — only action/route.ts's
// terminal outcomes change it), so this checks the ApprovalInstance/stage
// state directly. Once any stage has acted, a real Branch/Area Manager
// already exercised authority based on that branch assignment — retroactively
// changing it at that point would invalidate that decision's legitimacy.
// ============================================================

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse } from '@/app/lib/api-utils';
import { requirePermission, isUserContext } from '@/app/lib/permissions/guards';
import { getWorkflowStatus } from '@/app/lib/approval/engine';

export async function OPTIONS() {
    return handleCorsPreflight();
}

function isBranchScopePermitted(ctx: { isHeadOffice: boolean; branchAccess: { branchId: string }[] }, branchId: string | null): boolean {
    if (ctx.isHeadOffice) return true;
    if (!branchId) return true;
    return ctx.branchAccess.some((ba) => ba.branchId === branchId);
}

const bodySchema = z.object({ branchId: z.string().min(1, 'Branch is required') });

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const ctx = await requirePermission(request, 'hr-onboarding', 'edit');
    if (!isUserContext(ctx)) return ctx;

    try {
        const { id } = await params;
        const onboardingRequest = await prisma.employeeOnboardingRequest.findUnique({ where: { id } });
        if (!onboardingRequest) return errorResponse('Onboarding request not found', 404);
        if (!onboardingRequest.approvalInstanceId) {
            return errorResponse('This request has not been submitted for approval yet', 400);
        }
        if (!isBranchScopePermitted(ctx, onboardingRequest.branchId)) {
            return errorResponse('You do not have access to this request', 403);
        }

        const { branchId } = bodySchema.parse(await request.json());

        const branch = await prisma.branch.findUnique({ where: { id: branchId } });
        if (!branch || !branch.isActive) {
            return errorResponse('Selected branch is not valid', 400);
        }
        // Must also have access to the NEW branch — mirrors submit-for-approval's own check.
        if (!ctx.isHeadOffice && !ctx.branchAccess.some((ba) => ba.branchId === branchId)) {
            return errorResponse('You do not have access to this branch', 403);
        }

        // Safety gate: Stage 1 must still be undecided.
        const workflow = await getWorkflowStatus(onboardingRequest.approvalInstanceId);
        const firstStage = workflow.stages.find((s) => s.stageOrder === 1);
        if (workflow.instance.status !== 'PENDING' || firstStage?.status !== 'PENDING') {
            return errorResponse('This request has already moved past its first approval stage — the branch can no longer be changed', 409);
        }

        const [updated] = await prisma.$transaction([
            prisma.employeeOnboardingRequest.update({
                where: { id },
                data: { branchId },
                include: { branch: { select: { name: true } } },
            }),
            prisma.approvalInstance.update({ where: { id: onboardingRequest.approvalInstanceId }, data: { branchId } }),
        ]);

        return successResponse(updated, 'Branch updated');
    } catch (error: any) {
        if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
        console.error('Error updating onboarding request branch:', error);
        return errorResponse(error.message || 'Failed to update branch', 500);
    }
}
