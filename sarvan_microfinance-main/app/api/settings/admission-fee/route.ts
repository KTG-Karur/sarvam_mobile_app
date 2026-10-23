import { NextRequest } from 'next/server';
import {
    handleCorsPreflight,
    successResponse,
    withAuth,
} from '@/app/lib/api-utils';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/settings/admission-fee
 *
 * Returns global admission-fee settings used by the Final Disbursement page.
 * There is no dedicated settings table for this — the per-client override lives
 * on Client.admissionFees and is returned by /api/clients/{id}/is-new.
 *
 * This endpoint provides the branch-level defaults so the UI knows:
 *   - enabled       Whether to show the Admission Fee column at all
 *   - defaultAmount The fee to pre-fill for new clients that have no per-client override
 */
export async function GET(request: NextRequest) {
    return withAuth(async (_req, _user) => {
        // Default settings — can be promoted to a DB table or env vars later.
        const settings = {
            enabled: true,
            defaultAmount: 50,   // ₹50 default admission fee for new clients
        };

        return successResponse(settings, 'Admission fee settings fetched');
    })(request);
}
