import { NextRequest } from 'next/server';
import { handleCorsPreflight, errorResponse, successResponse, withAuth } from '@/app/lib/api-utils';
import { getEmployeeIdCard } from '@/app/lib/hr/id-card-data';
import { formatIdCardIssues } from '@/app/lib/hr/id-card-eligibility';

export async function OPTIONS() {
    return handleCorsPreflight();
}

// GET /api/hr/employees/me/id-card — everything the signed-in employee's own
// Employee ID Card prints, in one call.
//
// Deliberately separate from /api/hr/employees/me: that route blanks any field
// an admin marked "not visible to employee", and a person's own ID card needs
// their blood group / DOB / address regardless. Data comes from the shared
// builder (app/lib/hr/id-card-data.ts) so this matches the HR-printed card and
// the QR verification page exactly. Always the caller's own record; no
// permission grant or request id needed.
//
// 422 (code ID_CARD_NOT_ELIGIBLE, data.issues) when the employee may not be
// issued a card — inactive/exited, or a printed field is missing.
export async function GET(request: NextRequest) {
    return withAuth(async (_req, user) => {
        try {
            const result = await getEmployeeIdCard(user.userId);
            if (!result) return errorResponse('Employee record not found', 404);
            if (!result.eligibility.eligible) {
                return errorResponse(
                    `ID card cannot be issued: ${formatIdCardIssues(result.eligibility.issues)}`,
                    422,
                    { code: 'ID_CARD_NOT_ELIGIBLE', issues: result.eligibility.issues }
                );
            }
            return successResponse(result.card, 'ID card details fetched successfully');
        } catch (error: unknown) {
            console.error('Error fetching ID card details:', error);
            return errorResponse(error instanceof Error ? error.message : 'Failed to fetch ID card details', 500);
        }
    })(request);
}
