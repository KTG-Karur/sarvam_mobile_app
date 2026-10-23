import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withRole, errorResponse, successResponse, handleCorsPreflight } from '@/app/lib/api-utils';
import { highmarkService, RateLimitExceededError } from '@/app/lib/services/highmark.service';

const recheckSchema = z.object({
  clientId: z.string().trim().min(1, 'Client is required'),
  consentObtained: z.literal(true, { errorMap: () => ({ message: 'Consent is required' }) }),
});

/**
 * POST /api/highmark/recheck
 * Re-runs a Highmark check for a client already on file — used by the "Recheck"
 * action on client-detail screens. Honors the normal freshness-window reuse
 * (Masters > Highmark Settings): if the last report for this client is still
 * within that window it's reused as-is, otherwise a new one is pulled from CRIF.
 */
export async function POST(request: NextRequest) {
  return withRole(['BRANCH_MANAGER', 'FDO'], async (req, user) => {
    try {
      if (!user.branchId) return errorResponse('No active branch on this session', 400);

      const data = recheckSchema.parse(await req.json());

      const { reused, report } = await highmarkService.runCheckForClient({
        clientIdOrCuid: data.clientId,
        consentObtained: data.consentObtained,
        requestedById: user.userId,
        requestedByRole: user.role,
        branchId: user.branchId,
      });

      return successResponse(report, reused ? 'Already have a current report on file — showing that' : 'Updated Highmark report pulled');
    } catch (error: any) {
      if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
      if (error instanceof RateLimitExceededError) return errorResponse(error.message, 429);
      return errorResponse(error.message || 'Failed to run credit check', 500);
    }
  })(request);
}

export async function OPTIONS() {
  return handleCorsPreflight();
}
