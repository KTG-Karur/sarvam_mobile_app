import { NextRequest } from 'next/server';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse } from '@/app/lib/api-utils';
import { requirePermission, isUserContext } from '@/app/lib/permissions/guards';
import { getWorkflowStatus } from '@/app/lib/approval/engine';
import { withLiveEmployeeData } from '@/app/lib/hr/onboarding-live-employee';
import { validateOnboardingOrgPlacement } from '@/app/lib/hr/onboarding-org-placement';
import { onboardingFormFieldsSchema, childrenJsonInput, validateOnboardingServerRules } from '@/app/lib/hr/onboarding-form-fields';
import { generateNextEmployeeId } from '@/app/lib/hr/generate-employee-id';
import { deleteOnboardingDocument } from '@/app/lib/storage/onboarding-document-storage';
import { checkOnboardingDuplicates, formatInternalDuplicateMessage, normalizeOnboardingIdentityFields } from '@/app/lib/hr/onboarding-duplicate-check';

export async function OPTIONS() {
    return handleCorsPreflight();
}

// `finalize` mirrors the create route's flag — an explicit "Create Request" /
// "Submit" advances a DRAFT to SUBMITTED; a Save Draft or the Edit-Details
// correction flow (see OnboardingQueueClient) never does, however many times
// it's called.
const updateSchema = onboardingFormFieldsSchema.extend({ finalize: z.boolean().optional() }).superRefine(validateOnboardingServerRules);

function isBranchScopePermitted(ctx: { isHeadOffice: boolean; branchAccess: { branchId: string }[] }, branchId: string | null): boolean {
    if (ctx.isHeadOffice) return true;
    if (!branchId) return true; // not yet assigned to a branch (e.g. a DRAFT link request)
    return ctx.branchAccess.some((ba) => ba.branchId === branchId);
}

// GET /api/hr/onboarding/[id] — request detail + its approval-engine stage timeline
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const ctx = await requirePermission(request, 'hr-onboarding', 'view');
    if (!isUserContext(ctx)) return ctx;

    try {
        const { id } = await params;
        const onboardingRequest = await prisma.employeeOnboardingRequest.findUnique({
            where: { id },
            include: {
                branch: { select: { name: true } },
                designation: { select: { name: true } },
                department: { select: { name: true } },
                createdBy: { select: { id: true, firstName: true, lastName: true } },
                reportingManager: { select: { id: true, firstName: true, lastName: true } },
                createdUser: { select: { id: true, employeeId: true } },
            },
        });
        if (!onboardingRequest) return errorResponse('Onboarding request not found', 404);
        if (!isBranchScopePermitted(ctx, onboardingRequest.branchId)) {
            return errorResponse('You do not have access to this request', 403);
        }

        const workflow = onboardingRequest.approvalInstanceId
            ? await getWorkflowStatus(onboardingRequest.approvalInstanceId).catch(() => null)
            : null;

        // Suggest an Employee ID for the "Finalize Employee Details" panel to pre-fill
        // when this request is at its final stage or ready for direct admin approval.
        let suggestedEmployeeId: string | undefined;
        if (workflow && ['PENDING', 'IN_PROGRESS'].includes(workflow.instance.status)) {
            const maxOrder = Math.max(...workflow.stages.map((s) => s.stageOrder));
            const currentStage = workflow.stages.find((s) => s.stageId === workflow.instance.currentStageId);
            if (currentStage?.stageOrder === maxOrder) {
                suggestedEmployeeId = await generateNextEmployeeId(prisma);
            }
        } else if (!workflow && ['DRAFT', 'SUBMITTED', 'IN_REVIEW'].includes(onboardingRequest.status)) {
            suggestedEmployeeId = await generateNextEmployeeId(prisma);
        }

        return successResponse(
            { request: (await withLiveEmployeeData([onboardingRequest]))[0], workflow, ...(suggestedEmployeeId ? { suggestedEmployeeId } : {}) },
            'Onboarding request fetched successfully'
        );
    } catch (error: unknown) {
        console.error('Error fetching onboarding request:', error);
        const message = error instanceof Error ? error.message : 'Failed to fetch onboarding request';
        return errorResponse(message, 500);
    }
}

// PATCH /api/hr/onboarding/[id] — HR corrects/fills in details before submitting
// for approval. Locked once a request has moved into (or past) the approval
// pipeline, so an edit can never happen underneath an in-flight or decided instance.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const ctx = await requirePermission(request, 'hr-onboarding', 'edit');
    if (!isUserContext(ctx)) return ctx;

    try {
        const { id } = await params;
        const existing = await prisma.employeeOnboardingRequest.findUnique({ where: { id } });
        if (!existing) return errorResponse('Onboarding request not found', 404);
        if (!isBranchScopePermitted(ctx, existing.branchId)) {
            return errorResponse('You do not have access to this request', 403);
        }
        if (existing.approvalInstanceId || ['APPROVED', 'REJECTED'].includes(existing.status)) {
            return errorResponse('This request is already in or past approval and can no longer be edited', 409);
        }

        const body = await request.json();
        const { finalize, ...data } = updateSchema.parse(body);

        const placementError = await validateOnboardingOrgPlacement(data);
        if (placementError) return errorResponse(placementError, 400);

        // Only checks fields actually present in this payload — editing your
        // own record never self-collides (excludeRequestId), and a field
        // this PATCH doesn't touch is left entirely alone either way.
        const { hit: duplicateHit, rejoinerHint } = await checkOnboardingDuplicates(prisma, data, id);
        if (duplicateHit) {
            return errorResponse(formatInternalDuplicateMessage(duplicateHit), 409);
        }

        const nextStatus = existing.status === 'DRAFT' && finalize ? 'SUBMITTED' : existing.status;

        const updated = await prisma.employeeOnboardingRequest.update({
            where: { id },
            data: {
                ...data,
                ...normalizeOnboardingIdentityFields(data),
                children: childrenJsonInput(data.children),
                status: nextStatus,
            } satisfies Prisma.EmployeeOnboardingRequestUncheckedUpdateInput,
        });

        return successResponse(
            { ...updated, rejoinerHint },
            finalize ? 'Onboarding request updated successfully' : 'Draft saved'
        );
    } catch (error: unknown) {
        if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
        console.error('Error updating onboarding request:', error);
        const message = error instanceof Error ? error.message : 'Failed to update onboarding request';
        return errorResponse(message, 500);
    }
}

// DELETE /api/hr/onboarding/[id] — withdraw a request that never reached (or
// was rejected out of) the approval pipeline. Blocked once a decision is in
// flight or an employee has already been provisioned from it — deleting
// either would orphan an in-flight ApprovalInstance or, worse, a request
// that already produced a real User account.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const ctx = await requirePermission(request, 'hr-onboarding', 'delete');
    if (!isUserContext(ctx)) return ctx;

    try {
        const { id } = await params;
        const existing = await prisma.employeeOnboardingRequest.findUnique({ where: { id } });
        if (!existing) return errorResponse('Onboarding request not found', 404);
        if (!isBranchScopePermitted(ctx, existing.branchId)) {
            return errorResponse('You do not have access to this request', 403);
        }
        if (!['DRAFT', 'SUBMITTED', 'IN_REVIEW', 'REJECTED'].includes(existing.status)) {
            return errorResponse('This request is in progress or already approved and cannot be deleted', 409);
        }

        // No cascade delete configured for OnboardingDocument -> clean those up
        // (storage objects + rows) first, or the FK would block the delete.
        const docs = await prisma.onboardingDocument.findMany({ where: { onboardingRequestId: id } });
        for (const doc of docs) {
            try {
                await deleteOnboardingDocument(doc.fileUrl);
            } catch (storageError) {
                console.error('Failed to delete onboarding document object', doc.id, storageError);
            }
        }
        await prisma.onboardingDocument.deleteMany({ where: { onboardingRequestId: id } });
        await prisma.employeeOnboardingRequest.delete({ where: { id } });

        return successResponse(null, 'Onboarding request deleted successfully');
    } catch (error: unknown) {
        console.error('Error deleting onboarding request:', error);
        const message = error instanceof Error ? error.message : 'Failed to delete onboarding request';
        return errorResponse(message, 500);
    }
}
