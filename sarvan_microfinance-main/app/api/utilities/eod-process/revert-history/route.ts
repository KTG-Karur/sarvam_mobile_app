import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { toRevertLocationDto } from '@/app/lib/revert-location';
import { errorResponse, successResponse, withRole, handleCorsPreflight } from '@/app/lib/api-utils';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/utilities/eod-process/revert-history?branchId=&fromDate=&toDate=
 * Admin-only: "Show Reverted History" feed for the EOD Revert page — every
 * persisted EodRevertHistory row (see app/api/utilities/eod-process/revert/route.ts,
 * which writes one per revert in the same transaction as the BranchLock rewind).
 */
export async function GET(request: NextRequest) {
    return withRole(['ADMIN'], async (req) => {
        try {
            const { searchParams } = new URL(req.url);
            const branchId = searchParams.get('branchId');
            const fromDate = searchParams.get('fromDate');
            const toDate = searchParams.get('toDate');

            const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
            const revertedAtFilter: { gte?: Date; lte?: Date } = {};
            if (fromDate && YMD_RE.test(fromDate)) revertedAtFilter.gte = new Date(`${fromDate}T00:00:00.000Z`);
            if (toDate && YMD_RE.test(toDate)) revertedAtFilter.lte = new Date(`${toDate}T23:59:59.999Z`);

            const rows = await prisma.eodRevertHistory.findMany({
                where: {
                    ...(branchId ? { branchId } : {}),
                    ...(revertedAtFilter.gte || revertedAtFilter.lte ? { revertedAt: revertedAtFilter } : {}),
                },
                include: {
                    branch: { select: { code: true, name: true } },
                    revertedBy: { select: { firstName: true, lastName: true, employeeId: true } },
                },
                orderBy: { revertedAt: 'desc' },
                take: 500,
            });

            const revertedRows = rows.map((r) => ({
                id: r.id,
                branchCode: r.branch.code,
                branchName: r.branch.name,
                fromWorkingDate: r.fromWorkingDate.toISOString(),
                toWorkingDate: r.toWorkingDate.toISOString(),
                mode: r.mode,
                revertedAt: r.revertedAt.toISOString(),
                revertedByName: `${r.revertedBy.firstName} ${r.revertedBy.lastName}`,
                revertedByEmployeeId: r.revertedBy.employeeId ?? null,
                revertReason: r.revertReason,
                revertLocation: toRevertLocationDto(r),
            }));

            return successResponse(revertedRows, revertedRows.length === 0 ? 'No reverted EOD history found' : 'EOD revert history fetched');
        } catch (error) {
            console.error('[EOD Revert History] GET Error:', error);
            return errorResponse('Failed to fetch EOD revert history', 500);
        }
    })(request);
}
