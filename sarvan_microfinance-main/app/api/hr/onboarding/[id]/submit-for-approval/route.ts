import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse } from '@/app/lib/api-utils';
import { requirePermission, isUserContext } from '@/app/lib/permissions/guards';
import { startApprovalWorkflow } from '@/app/lib/approval/engine';
import { hrOnboardingValidationService } from '@/app/lib/services/hr-onboarding-validation.service';
import { CONFIGURABLE_ONBOARDING_FIELD_KEYS, getOnboardingSkipKeys, buildChildRequiredChecks } from '@/app/lib/hr/onboarding-form-fields';
import { checkOnboardingDuplicates, formatInternalDuplicateMessage } from '@/app/lib/hr/onboarding-duplicate-check';
import { hasUsableOnboardingPhoto } from '@/app/lib/hr/employee-photo';

export async function OPTIONS() {
    return handleCorsPreflight();
}

// Branch is picked here, not earlier — at Generate Link or manual-entry
// creation nobody has decided who this hire even is yet, so an admin/HR staff
// assigns the branch at the point they actually review and submit the request.
const bodySchema = z.object({
    branchId: z.string().min(1, 'Branch is required'),
    departmentId: z.string().optional().nullable(),
    designationId: z.string().optional().nullable(),
});

// POST /api/hr/onboarding/[id]/submit-for-approval — starts the generic
// ApprovalWorkflow engine (moduleSlug "hr-onboarding") once HR has reviewed
// the data (manually entered, or joinee-submitted via the public link).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const ctx = await requirePermission(request, 'hr-onboarding', 'edit');
    if (!isUserContext(ctx)) return ctx;

    try {
        const { id } = await params;
        const onboardingRequest = await prisma.employeeOnboardingRequest.findUnique({ where: { id } });
        if (!onboardingRequest) return errorResponse('Onboarding request not found', 404);
        if (onboardingRequest.approvalInstanceId) {
            return errorResponse('This request has already been submitted for approval', 409);
        }
        if (!['DRAFT', 'SUBMITTED', 'IN_REVIEW'].includes(onboardingRequest.status)) {
            return errorResponse(`Cannot submit a request with status '${onboardingRequest.status}' for approval`, 409);
        }

        const body = await request.json();
        const { branchId, departmentId, designationId } = bodySchema.parse(body);

        const branch = await prisma.branch.findUnique({ where: { id: branchId } });
        if (!branch || !branch.isActive) {
            return errorResponse('Selected branch is not valid', 400);
        }
        // Non-Head-Office staff can only assign a branch they themselves have
        // access to — mirrors isBranchScopePermitted used elsewhere in this
        // route family, re-enforced here since the frontend dropdown filtering
        // alone is only a convenience, not a real gate.
        if (!ctx.isHeadOffice && !ctx.branchAccess.some((ba) => ba.branchId === branchId)) {
            return errorResponse('You do not have access to this branch', 403);
        }

        // Cheap defense in depth — the real gates are at intake (POST/PATCH/
        // public submit) and at final approval; this just catches a
        // collision introduced between those points (e.g. two drafts edited
        // concurrently) before the workflow even starts.
        const { hit: duplicateHit, rejoinerHint } = await checkOnboardingDuplicates(prisma, onboardingRequest, id);
        if (duplicateHit) {
            return errorResponse(formatInternalDuplicateMessage(duplicateHit), 409);
        }

        // Wife/Husband details + Wedding Date only apply while currently married.
        // Single/Divorced/Widowed applicants are never blocked on any spouse fields.
        // For MARRIED:
        // - Male applicants: husband fields are skipped (wife fields & wedding date apply).
        // - Female applicants: wife fields are skipped (husband fields & wedding date apply).
        // - Other/unspecified: all spouse fields are skipped.
        const skipKeys = getOnboardingSkipKeys(onboardingRequest.maritalStatus, onboardingRequest.gender);
        const fieldsToCheck = CONFIGURABLE_ONBOARDING_FIELD_KEYS
            .filter((key) => !skipKeys.includes(key))
            .map((key) => ({ configKey: key, value: onboardingRequest[key] }) as { configKey: string; value: unknown; label?: string })
            .concat(buildChildRequiredChecks(onboardingRequest.children, onboardingRequest.maritalStatus));
        const validation = await hrOnboardingValidationService.assertRequiredFieldsPresent(fieldsToCheck);
        if (!validation.ok) {
            return errorResponse(`Missing required field(s) before this can be submitted: ${validation.missing.join(', ')}`, 400);
        }
        // The photo tile's config row only drives an asterisk; the ID card can't
        // be issued without one, so it's a real gate here and at final approval.
        if (!(await hasUsableOnboardingPhoto(id))) {
            return errorResponse('Missing required field(s) before this can be submitted: Photo (upload a passport photo that is not rejected)', 400);
        }

        const { instanceId } = await startApprovalWorkflow({
            moduleSlug: 'hr-onboarding',
            recordType: 'EmployeeOnboardingRequest',
            recordId: id,
            branchId,
            submittedByUserId: ctx.userId,
        });

        const updated = await prisma.employeeOnboardingRequest.update({
            where: { id },
            data: {
                branchId,
                departmentId: departmentId || undefined,
                designationId: designationId || undefined,
                approvalInstanceId: instanceId,
                status: 'PENDING_APPROVAL',
                submittedForApprovalAt: new Date(),
            },
        });

        return successResponse({ ...updated, rejoinerHint }, 'Submitted for approval');
    } catch (error: any) {
        if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
        console.error('Error submitting onboarding request for approval:', error);
        return errorResponse(error.message || 'Failed to submit for approval', 500);
    }
}
