import { NextRequest } from 'next/server';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
} from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/reports/neft-format
 * Fetch loans for a specific index with client bank details
 */
export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const indexId = searchParams.get('indexId');

            if (!indexId) {
                return errorResponse('Index ID is required', 400);
            }

            // Fetch loans associated with this index, scoped to the caller's permitted branch(es)
            const permittedBranchIds = await getPermittedBranchIds(user);
            const loans = await prisma.loan.findMany({
                where: {
                    indexId,
                    isActive: true,
                    ...(permittedBranchIds ? { branchId: { in: permittedBranchIds } } : {}),
                },
                select: {
                    id: true,
                    loanNumber: true,
                    amount: true,
                    branch: {
                        select: {
                            code: true,
                            name: true,
                            areas: {
                                select: {
                                    name: true,
                                    division: {
                                        select: {
                                            name: true,
                                            region: { select: { name: true } },
                                        },
                                    },
                                },
                            },
                        },
                    },
                    center: {
                        select: {
                            code: true,
                            name: true,
                        },
                    },
                    client: {
                        select: {
                            id: true,
                            clientId: true,
                            firstName: true,
                            lastName: true,
                            bankAcNo: true,
                            bankName: true,
                            bankBranch: true,
                            ifscCode: true,
                        },
                    },
                },
                orderBy: {
                    client: {
                        firstName: 'asc',
                    },
                },
            });

            if (loans.length === 0) {
                return successResponse([], 'No loans found for this index');
            }

            // Format data for NEFT report
            const reportData = loans.map((loan, index) => ({
                sno: index + 1,
                regionName:   loan.branch?.areas?.[0]?.division?.region?.name || '',
                divisionName: loan.branch?.areas?.[0]?.division?.name         || '',
                areaName:     loan.branch?.areas?.[0]?.name                   || '',
                branchId:   loan.branch?.code   || '',
                branchName: loan.branch?.name   || '',
                centreId:   loan.center?.code   || '',
                centerName: loan.center?.name   || '',
                loanId:     loan.loanNumber,
                memberId:   loan.client.clientId,
                ifsc:       loan.client.ifscCode  || '',
                accountNo:  loan.client.bankAcNo  || '',
                name:       `${loan.client.firstName} ${loan.client.lastName}`,
                bank:       loan.client.bankName   || '',
                bankBranch: loan.client.bankBranch || '',
                loanAmount: Number(loan.amount),
            }));

            return successResponse(reportData, 'NEFT Format data retrieved successfully');
        } catch (error) {
            console.error('Error serving NEFT Format report:', error);
            return errorResponse(
                error instanceof Error ? error.message : 'Failed to generate NEFT Format report',
                500
            );
        }
    })(request);
}
