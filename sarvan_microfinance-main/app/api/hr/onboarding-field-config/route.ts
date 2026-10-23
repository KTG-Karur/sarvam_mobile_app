import { NextRequest } from 'next/server';
import { z } from 'zod';
import { handleCorsPreflight, errorResponse, successResponse } from '@/app/lib/api-utils';
import { requirePermission, isUserContext } from '@/app/lib/permissions/guards';
import { hrOnboardingValidationService } from '@/app/lib/services/hr-onboarding-validation.service';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const updateSchema = z.object({
    updates: z.array(z.object({
        fieldKey: z.string().min(1),
        isRequired: z.boolean(),
    })).min(1),
});

// GET /api/hr/onboarding-field-config — consulted by the onboarding form
// itself (both the manual-entry admin form and the public joinee form) to
// know which fields currently carry a red asterisk.
export async function GET(request: NextRequest) {
    const ctx = await requirePermission(request, 'hr-onboarding', 'view');
    if (!isUserContext(ctx)) return ctx;

    try {
        const configs = await hrOnboardingValidationService.getConfig();
        return successResponse(configs, 'HR onboarding field configs fetched successfully');
    } catch (error: any) {
        console.error('Error fetching HR onboarding field configs:', error);
        return errorResponse(error.message || 'Failed to fetch HR onboarding field configs', 500);
    }
}

// POST /api/hr/onboarding-field-config — admin toggles which fields are
// required. Locked (isAlwaysRequired) fields are rejected server-side by
// hrOnboardingValidationService.upsertConfigs, not just UI-disabled.
export async function POST(request: NextRequest) {
    const ctx = await requirePermission(request, 'admin', 'edit');
    if (!isUserContext(ctx)) return ctx;

    try {
        const body = await request.json();
        const { updates } = updateSchema.parse(body);

        await hrOnboardingValidationService.upsertConfigs(updates);

        const configs = await hrOnboardingValidationService.getConfig();
        return successResponse(configs, 'HR onboarding field configs updated successfully');
    } catch (error: any) {
        if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
        console.error('Error updating HR onboarding field configs:', error);
        return errorResponse(error.message || 'Failed to update HR onboarding field configs', 400);
    }
}
