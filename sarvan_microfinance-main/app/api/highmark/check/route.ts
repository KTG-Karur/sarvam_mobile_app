import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withRole, errorResponse, successResponse, handleCorsPreflight } from '@/app/lib/api-utils';
import { highmarkService, RateLimitExceededError } from '@/app/lib/services/highmark.service';

const checkSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required'),
  lastName: z.string().trim().optional(),
  aadhaar: z.string().trim().regex(/^\d{12}$/, 'Aadhaar must be 12 digits'),
  phone: z.string().trim().regex(/^\d{10}$/, 'Phone must be 10 digits'),
  consentObtained: z.literal(true, { errorMap: () => ({ message: 'Consent is required' }) }),
  clientId: z.string().cuid().optional(),
});

export async function POST(request: NextRequest) {
  return withRole(['BRANCH_MANAGER', 'FDO'], async (req, user) => {
    try {
      if (!user.branchId) return errorResponse('No active branch on this session', 400);

      const body = await req.json();
      const data = checkSchema.parse(body);

      const { reused, report } = await highmarkService.runCheck({
        ...data,
        requestedById: user.userId,
        requestedByRole: user.role,
        branchId: user.branchId,
      });

      return successResponse(report, reused ? 'Reused a recent report — no charge' : 'Credit report pulled');
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
