import { NextRequest } from 'next/server';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/reports/others/insurance-report/loan-lookup?search=
 * Search disbursed loans by loan number for insurance-record prefill.
 */
export async function GET(request: NextRequest) {
    return withRole(['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER'], async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const search = searchParams.get('search')?.trim() || '';
            const branchFilter = searchParams.get('branchId');

            if (search.length < 2) {
                return successResponse([], 'Enter at least 2 characters to search');
            }

            const whereClause: any = {
                loanNumber: { contains: search, mode: 'insensitive' },
                disbursementStatus: 'DISBURSED',
                isActive: true,
                insuranceRecords: { none: { isActive: true } },
            };

            if (user.role === 'BRANCH_MANAGER' || user.role === 'AREA_MANAGER') {
                // AREA_MANAGER assigned multiple branches (AreaManagerBranch) searches
                // across ALL of them, not just the currently active one.
                const scopedBranchIds = await resolveScopedBranchIds(user, branchFilter);
                if (scopedBranchIds !== null && scopedBranchIds.length > 0) {
                    whereClause.branchId = scopedBranchIds.length === 1
                        ? scopedBranchIds[0]
                        : { in: scopedBranchIds };
                }
            } else if (user.role === 'ADMIN' && branchFilter) {
                whereClause.branchId = branchFilter;
            }

            const loans = await prisma.loan.findMany({
                where: whereClause,
                select: {
                    id: true,
                    loanNumber: true,
                    amount: true,
                    tenureMonths: true,
                    disbursedByBMAt: true,
                    branchId: true,
                    branch: { select: { id: true, name: true, code: true } },
                    client: {
                        select: {
                            id: true,
                            clientId: true,
                            firstName: true,
                            lastName: true,
                            gender: true,
                            permanentAddress: true,
                            district: true,
                            state: true,
                            pincode: true,
                            country: true,
                            nomineeName: true,
                            nomineeRelation: true,
                            nomineeGender: true,
                            nomineeDateOfBirth: true,
                            nomineeAge: true,
                        },
                    },
                },
                take: 10,
                orderBy: { createdAt: 'desc' },
            });

            const enriched = loans.map((loan) => ({
                ...loan,
                amount: Number(loan.amount),
            }));

            return successResponse(enriched, 'Loans fetched successfully');
        } catch (error) {
            console.error('[Insurance] Error searching loans:', error);
            return errorResponse('Failed to search loans', 500);
        }
    })(request);
}
