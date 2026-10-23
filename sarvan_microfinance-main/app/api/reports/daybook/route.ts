import { NextRequest, NextResponse } from 'next/server';
import { getDaybookData } from '@/app/lib/actions/reports';
import { withRole } from '@/app/lib/api-utils';
import { isHeadOfficeBranch } from '@/app/lib/head-office-branch';
import { prisma } from '@/app/lib/db';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';

export async function GET(req: NextRequest) {
    return withRole(
        ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER', 'FDO'],
        async (request, user) => {
            try {
                const searchParams = request.nextUrl.searchParams;

                // Support both date-range params (preferred) and legacy single reportDate
                const fallbackDate = new Date().toISOString().split('T')[0];
                const reportDate   = searchParams.get('reportDate') || fallbackDate;
                const fromDate     = searchParams.get('fromDate')   || reportDate;
                const toDate       = searchParams.get('toDate')     || fromDate;

                const requestedBranchId = searchParams.get('branchId') || undefined;
                const page     = parseInt(searchParams.get('page')     || '1');
                const pageSize = parseInt(searchParams.get('pageSize') || '20');
                const exportAll = searchParams.get('exportAll') === 'true';

                // Robust branch scoping:
                // - Admins may request a specific branch / "all" / "head_office"
                // - Non-admin users may view the daybook for any branch they're
                //   assigned to (UserBranchAssignment / AreaManagerBranch), not just
                //   their primary — but getDaybookData only ever looks at ONE branch
                //   at a time, so an explicit request outside their permitted set is
                //   rejected rather than silently widened.
                let effectiveBranchId: string | undefined;
                if (user.role === 'ADMIN') {
                    effectiveBranchId = requestedBranchId ?? user.branchId;
                } else {
                    const permittedBranchIds = await getPermittedBranchIds(user);
                    if (requestedBranchId) {
                        if (permittedBranchIds !== null && !permittedBranchIds.includes(requestedBranchId)) {
                            return NextResponse.json(
                                { error: 'You do not have access to that branch' },
                                { status: 403 }
                            );
                        }
                        effectiveBranchId = requestedBranchId;
                    } else {
                        effectiveBranchId = user.branchId ?? permittedBranchIds?.[0];
                    }
                }

                if (!effectiveBranchId && user.role !== 'ADMIN') {
                    return NextResponse.json(
                        { error: 'Branch context is required' },
                        { status: 400 }
                    );
                }

                // ── Resolve HO daybook flag ──────────────────────────────────
                // When the selected branch is Head Office we use a specialised
                // query that shows only inter-branch transfers and direct HO
                // cash movements — not the entire loan portfolio of all branches.
                let resolvedBranchId: string | undefined = effectiveBranchId;
                let isHODaybook = false;

                if (effectiveBranchId === 'head_office') {
                    // The admin selected "HEAD OFFICE" from the trial-balance style
                    // selector — look up the actual HO branch UUID.
                    const hoBranch = await prisma.branch.findFirst({
                        where: {
                            OR: [
                                { code: 'HO' },
                                { name: { equals: 'Head Office', mode: 'insensitive' } },
                            ],
                        },
                        select: { id: true },
                    });
                    if (hoBranch) {
                        resolvedBranchId = hoBranch.id;
                        isHODaybook      = true;
                    }
                } else if (effectiveBranchId && effectiveBranchId !== 'all') {
                    // Regular branch UUID — check if it's the Head Office branch.
                    isHODaybook = await isHeadOfficeBranch(effectiveBranchId);
                }

                const result = await getDaybookData(
                    fromDate,
                    toDate,
                    resolvedBranchId,
                    page,
                    pageSize,
                    isHODaybook,
                    exportAll,
                );

                return NextResponse.json(result);
            } catch (error) {
                console.error('Error fetching Daybook data:', error);
                return NextResponse.json(
                    { error: 'Failed to fetch Daybook data' },
                    { status: 500 }
                );
            }
        }
    )(req);
}
