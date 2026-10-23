import { NextRequest } from 'next/server';
import { handleCorsPreflight, errorResponse, successResponse } from '@/app/lib/api-utils';
import { requirePermission, isUserContext } from '@/app/lib/permissions/guards';
import { getOnboardingApprovalStageCount } from '@/app/lib/hr/onboarding-approval-levels';

export async function OPTIONS() {
    return handleCorsPreflight();
}

// GET /api/hr/onboarding/approval-levels — how many approval stages the
// currently active hr-onboarding workflow has (same workflow + selection
// rule startApprovalWorkflow uses: isDefault, else first active). Consumed
// by Reporting Manager L1/L2/L3 fields (Employee Master, onboarding
// finalize panel, both field-config admin pages) so they only appear when
// the configured approval chain actually has that many levels — a single
// "Admin Approval" stage means there's no real reporting hierarchy to
// capture. My Profile gets the same answer from /api/hr/employees/me itself,
// since ordinary employees don't hold hr-onboarding:view.
export async function GET(request: NextRequest) {
    const ctx = await requirePermission(request, 'hr-onboarding', 'view');
    if (!isUserContext(ctx)) return ctx;

    try {
        const stageCount = await getOnboardingApprovalStageCount();

        return successResponse({ stageCount }, 'Approval level count fetched successfully');
    } catch (error: any) {
        console.error('Error fetching hr-onboarding approval levels:', error);
        return errorResponse(error.message || 'Failed to fetch approval level count', 500);
    }
}
