import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getLoanAdvanceRefundData } from '@/app/lib/actions/reports';
import { errorResponse, handleCorsPreflight, successResponse, withRole } from '@/app/lib/api-utils';
import { resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';
import { getLoanAdvanceEnabled } from '@/app/lib/loan-advance-config';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Dates must be YYYY-MM-DD');

const querySchema = z
    .object({
        branchId: z.string().optional(),
        centerId: z.string().optional(),
        status: z.enum(['ALL', 'INITIATED', 'GIVEN', 'REJECTED']).default('ALL'),
        fromDate: ymd,
        tillDate: ymd,
    })
    .refine((q) => q.fromDate <= q.tillDate, { message: 'From date cannot be after Till date' });

/**
 * GET /api/reports/portfolio/loan-advance-refund
 * Loan Advance Refund report — one row per refund request (initiated / given / rejected / reverted).
 * One IST date range, applied to the date that matches each row's status (initiated / given / rejected / reverted).
 */
export async function GET(request: NextRequest) {
    return withRole(['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'], async (req, user) => {
        try {
            const raw = Object.fromEntries(req.nextUrl.searchParams.entries());
            const parsed = querySchema.safeParse(raw);
            if (!parsed.success) {
                return errorResponse(parsed.error.errors[0]?.message || 'Invalid filters', 400);
            }
            const q = parsed.data;

            if (!(await getLoanAdvanceEnabled())) {
                return errorResponse('Loan Advance feature is disabled', 403);
            }

            const branchIds = await resolveScopedBranchIds(user, q.branchId && q.branchId !== 'all' ? q.branchId : null);
            const data = await getLoanAdvanceRefundData(
                {
                    centerId: q.centerId,
                    status: q.status,
                    fromDate: q.fromDate,
                    tillDate: q.tillDate,
                },
                branchIds ?? undefined
            );

            return successResponse(data, 'Loan advance refund data fetched successfully');
        } catch (error: any) {
            console.error('Error fetching loan advance refund data:', error);
            return errorResponse(error.message || 'Failed to fetch loan advance refund data', 500);
        }
    })(request);
}
