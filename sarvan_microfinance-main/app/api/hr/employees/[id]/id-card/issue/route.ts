import { NextRequest } from 'next/server';
import { handleCorsPreflight, errorResponse, successResponse } from '@/app/lib/api-utils';
import { requireEmployeeAccess, isUserContext } from '@/app/lib/permissions/guards';
import { recordIdCardIssued } from '@/app/lib/hr/id-card-data';
import { formatIdCardIssues } from '@/app/lib/hr/id-card-eligibility';

export async function OPTIONS() {
    return handleCorsPreflight();
}

// POST /api/hr/employees/[id]/id-card/issue — called by the ID card modal after
// HR prints or downloads the card. Stamps User.idCardIssuedAt and fingerprints
// the printed fields from the live record (no request body — nothing the client
// sends is trusted), so a later edit to a printed field flags "Reprint required"
// on the Employee List (app/lib/hr/id-card-reprint.ts). Same access rule as
// viewing the card.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const ctx = await requireEmployeeAccess(request, id);
    if (!isUserContext(ctx)) return ctx;

    try {
        const result = await recordIdCardIssued(id);
        if (!result) return errorResponse('Employee not found', 404);
        if (!result.issued) {
            return errorResponse(
                `ID card cannot be issued: ${formatIdCardIssues(result.eligibility.issues)}`,
                422,
                { code: 'ID_CARD_NOT_ELIGIBLE', issues: result.eligibility.issues }
            );
        }
        return successResponse({ issuedAt: result.issuedAt }, 'ID card issue recorded');
    } catch (error: unknown) {
        console.error('Error recording ID card issue:', error);
        return errorResponse(error instanceof Error ? error.message : 'Failed to record ID card issue', 500);
    }
}
