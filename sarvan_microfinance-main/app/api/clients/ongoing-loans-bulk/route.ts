// app/api/clients/ongoing-loans-bulk/route.ts
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { handleCorsPreflight, withAuth, errorResponse, successResponse } from '@/app/lib/api-utils';
import { getOngoingLoansByClientIds } from '@/app/lib/services/ongoing-loans.service';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const bulkSchema = z.object({
    clientIds: z.array(z.string().min(1)).min(1),
});

/**
 * POST /api/clients/ongoing-loans-bulk
 * Fetches ongoing loans for many clients in a single query, keyed by clientId.
 * Replaces firing one GET /clients/[clientId]/ongoing-loans request per client,
 * which under a large "select all" batch made partial/silent per-request failures likely.
 */
export async function POST(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const body = await req.json();
            const { clientIds } = bulkSchema.parse(body);

            const uniqueClientIds = Array.from(new Set(clientIds));
            const ongoingLoansByClient = await getOngoingLoansByClientIds(uniqueClientIds);

            return successResponse(ongoingLoansByClient, 'Ongoing loans fetched successfully');
        } catch (error: any) {
            if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
            console.error('[POST /api/clients/ongoing-loans-bulk]', error);
            return errorResponse(error.message || 'Failed to fetch ongoing loans', 500);
        }
    })(request);
}
