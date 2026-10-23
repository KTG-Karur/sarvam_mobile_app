import { NextRequest } from 'next/server';
import { z } from 'zod';
import { handleCorsPreflight, errorResponse, successResponse, withRole } from '@/app/lib/api-utils';
import { getDenominationCollectionReport } from '@/app/lib/reports/denomination-collection';

export async function OPTIONS() {
  return handleCorsPreflight();
}

const querySchema = z
  .object({
    fromDate: z.string().min(1),
    toDate: z.string().min(1),
    branchId: z.string().min(1).optional(),
  })
  .strict();

/**
 * GET /api/reports/denomination-collection?fromDate=YYYY-MM-DD&toDate=YYYY-MM-DD&branchId=
 *
 * Aggregates *collected cash denominations* from EOD denomination entries over a date range.
 *
 * @access BRANCH_MANAGER, AREA_MANAGER, ADMIN
 */
export async function GET(request: NextRequest) {
  return withRole(['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN'], async (req, user) => {
    try {
      const { searchParams } = new URL(req.url);
      const parsed = querySchema.safeParse({
        fromDate: searchParams.get('fromDate') ?? '',
        toDate: searchParams.get('toDate') ?? '',
        branchId: searchParams.get('branchId') ?? undefined,
      });

      if (!parsed.success) {
        return errorResponse(parsed.error.errors[0]?.message || 'Invalid query params', 400);
      }

      const branchIdParam = parsed.data.branchId ?? null;
      const report = await getDenominationCollectionReport({
        fromDateYmd: parsed.data.fromDate,
        toDateYmd: parsed.data.toDate,
        branchIdParam,
        user: {
          userId: user.userId,
          role: user.role,
          branchId: user.branchId,
        },
      });

      return successResponse(report, 'Denomination collection report generated');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to generate denomination collection report';

      const isClientError =
        message.includes('YYYY-MM-DD') ||
        message.includes('fromDate must be <= toDate') ||
        message.includes('Invalid date range') ||
        message.includes('Branch not assigned') ||
        message.includes('Invalid branch selection');

      return errorResponse(message, isClientError ? 400 : 500);
    }
  })(request);
}

