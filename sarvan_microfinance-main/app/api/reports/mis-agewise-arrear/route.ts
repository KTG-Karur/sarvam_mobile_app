import { NextRequest, NextResponse } from 'next/server';
import {
    getMISAgewiseArrearData,
    getMISDetailedAgewiseArrearData,
    type MISAgewiseReportType,
} from '@/app/lib/actions/reports';
import { withRole } from '@/app/lib/api-utils';
import { resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';

const VALID_REPORT_TYPES: (MISAgewiseReportType | 'DETAILEDWISE')[] = [
    'BRANCHWISE',
    'CENTERWISE',
    'FDOWISE',
    'CLIENTWISE',
    'DETAILEDWISE',
];

/**
 * GET /api/reports/mis-agewise-arrear
 * Query params:
 *   - reportDate: string (YYYY-MM-DD, required)
 *   - reportType: 'BRANCHWISE' | 'CENTERWISE' | 'FDOWISE' | 'CLIENTWISE' | 'DETAILEDWISE' (required)
 *   - branchId: string (optional)
 *   - centerId: string (optional)
 *   - fdoId: string (optional, DETAILEDWISE only)
 */
export async function GET(req: NextRequest) {
    return withRole(['ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH', 'BRANCH_MANAGER', 'AREA_MANAGER'], async (request, user) => {
    try {
        const searchParams = request.nextUrl.searchParams;
        const reportDate = searchParams.get('reportDate');
        const reportType = searchParams.get('reportType') as (MISAgewiseReportType | 'DETAILEDWISE') | null;
        const branchIdParam = searchParams.get('branchId');
        const centerIdParam = searchParams.get('centerId') || undefined;
        const fdoIdParam = searchParams.get('fdoId') || undefined;

        if (!reportDate) {
            return NextResponse.json(
                { error: 'reportDate is required' },
                { status: 400 }
            );
        }

        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(reportDate)) {
            return NextResponse.json(
                { error: 'reportDate must be in YYYY-MM-DD format' },
                { status: 400 }
            );
        }

        if (!reportType || !VALID_REPORT_TYPES.includes(reportType)) {
            return NextResponse.json(
                { error: `reportType must be one of: ${VALID_REPORT_TYPES.join(', ')}` },
                { status: 400 }
            );
        }

        const branchIds = await resolveScopedBranchIds(user, branchIdParam);

        // DETAILEDWISE uses a dedicated function
        if (reportType === 'DETAILEDWISE') {
            const result = await getMISDetailedAgewiseArrearData(reportDate, branchIds ?? undefined, centerIdParam, { fdoId: fdoIdParam });
            return NextResponse.json({
                success: true,
                ...result,
                reportDate,
            });
        }

        const result = await getMISAgewiseArrearData(reportDate, reportType, branchIds ?? undefined, centerIdParam);

        return NextResponse.json({
            success: true,
            ...result,
            reportDate,
        });
    } catch (error) {
        console.error('Error fetching MIS agewise arrear data:', error);
        return NextResponse.json(
            {
                error: 'Failed to fetch MIS agewise arrear data',
                details: error instanceof Error ? error.message : 'Unknown error',
            },
            { status: 500 }
        );
    }
    })(req);
}
