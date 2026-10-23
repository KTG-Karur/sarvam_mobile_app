import { NextRequest } from 'next/server';
import { handleCorsPreflight, errorResponse, successResponse } from '@/app/lib/api-utils';
import { requireEmployeeAccess, isUserContext } from '@/app/lib/permissions/guards';
import { getEmployeeIdCard } from '@/app/lib/hr/id-card-data';
import { formatIdCardIssues } from '@/app/lib/hr/id-card-eligibility';

export async function OPTIONS() {
    return handleCorsPreflight();
}

// GET /api/hr/employees/[id]/id-card — ID card data for any employee (User.id),
// for HR printing a card from Employee List, Employee Master or the Onboarding
// queue. Reads the live User row through the same builder as
// /api/hr/employees/me/id-card, so an edit made in Employee Master shows up on
// the next card opened. Requires hr-employee:view plus branch scope over the
// target employee.
//
// 422 (code ID_CARD_NOT_ELIGIBLE, data.issues) when the employee may not be
// issued a card — the UI shows the list so HR knows what to fix.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const ctx = await requireEmployeeAccess(request, id);
    if (!isUserContext(ctx)) return ctx;

    try {
        const result = await getEmployeeIdCard(id);
        if (!result) return errorResponse('Employee not found', 404);
        if (!result.eligibility.eligible) {
            return errorResponse(
                `ID card cannot be issued: ${formatIdCardIssues(result.eligibility.issues)}`,
                422,
                { code: 'ID_CARD_NOT_ELIGIBLE', issues: result.eligibility.issues }
            );
        }
        return successResponse(result.card, 'ID card details fetched successfully');
    } catch (error: unknown) {
        console.error('Error fetching employee ID card details:', error);
        return errorResponse(error instanceof Error ? error.message : 'Failed to fetch ID card details', 500);
    }
}
