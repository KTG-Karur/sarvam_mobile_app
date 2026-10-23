import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getFunderOSReportData } from '@/app/lib/actions/reports';
import { withRole, handleCorsPreflight, errorResponse, successResponse } from '@/app/lib/api-utils';
import { resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';

const ymdSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be in YYYY-MM-DD format');

const funderOSReportQuerySchema = z
    .object({
        asOnDate: ymdSchema,
        fromDate: ymdSchema.optional(),
        branchId: z.string().optional(),
        funderId: z.string().optional(),
    })
    .refine((data) => !data.fromDate || data.fromDate <= data.asOnDate, {
        message: 'fromDate must be on or before asOnDate',
        path: ['fromDate'],
    });

export async function OPTIONS() {
    return handleCorsPreflight();
}

export async function GET(req: NextRequest) {
    return withRole(['ADMIN'], async (request, user) => {
        try {
            const searchParams = request.nextUrl.searchParams;
            const parsed = funderOSReportQuerySchema.safeParse({
                asOnDate: searchParams.get('asOnDate') ?? undefined,
                fromDate: searchParams.get('fromDate') ?? undefined,
                branchId: searchParams.get('branchId') ?? undefined,
                funderId: searchParams.get('funderId') ?? undefined,
            });
            if (!parsed.success) {
                return errorResponse(parsed.error.errors[0].message, 400);
            }
            const { asOnDate, fromDate, branchId, funderId } = parsed.data;

            const branchIds = await resolveScopedBranchIds(user, branchId);
            const data = await getFunderOSReportData(asOnDate, fromDate, branchIds ?? undefined, funderId);

            return successResponse(data, `Loaded ${data.length} funder record(s)`);
        } catch (error) {
            console.error('Error fetching funder OS report:', error);
            return errorResponse(error instanceof Error ? error.message : 'Failed to fetch funder OS report', 500);
        }
    })(req);
}
