import { NextRequest } from 'next/server';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';
import { getBranchMeta, getFDOs } from '@/app/lib/actions/demand';

const DEMAND_SHEET_ROLES = [
    'ADMIN',
    'BRANCH_MANAGER',
    'FDO',
    'AREA_MANAGER',
] as const;

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/reports/demand-sheet/bootstrap
 * Returns FDO dropdown options and branch metadata for the demand sheet (same rules as the web screen).
 * Auth: Cookie accessToken or Authorization: Bearer <token>. Optional X-Branch-Id for ADMIN/AM.
 */
export async function GET(request: NextRequest) {
    const handler = withRole([...DEMAND_SHEET_ROLES], async () => {
        try {
            const [fdos, branch] = await Promise.all([getFDOs(), getBranchMeta()]);
            return successResponse({ fdos, branch });
        } catch (e) {
            const msg = e instanceof Error ? e.message : 'Failed to load demand sheet bootstrap data';
            return errorResponse(msg, 500);
        }
    });

    return handler(request);
}
