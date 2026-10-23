import { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { handleCorsPreflight, errorResponse, successResponse, withRole } from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { loanMemberIdSearchConditions } from '@/app/lib/reports/member-contacts';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/super-control/member-loan-edit/loans?page=&pageSize=&q=&branchId=&status=
 *
 * Paginated list of LIVE loans (disbursed through the app OR migrated) for Member Loan Edit.
 * Unlike Loan History Edit, indexed loans are included — this tool never rebuilds the schedule
 * or transactions, it only re-homes the loan's funder and its GL vouchers.
 */
export async function GET(request: NextRequest) {
    return withRole(['ADMIN'], async (req) => {
        try {
            const { searchParams } = new URL(req.url);
            const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
            const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '20', 10)));
            const q = (searchParams.get('q') || '').trim();
            const branchId = (searchParams.get('branchId') || '').trim();
            const statusParam = (searchParams.get('status') || '').trim().toUpperCase();
            const statusFilter: ('DISBURSED' | 'CLOSED')[] =
                statusParam === 'DISBURSED' || statusParam === 'CLOSED' ? [statusParam] : ['DISBURSED', 'CLOSED'];

            const where: Prisma.LoanWhereInput = {
                disbursementStatus: { in: statusFilter },
                ...(branchId ? { branchId } : {}),
                ...(q
                    ? {
                          OR: [
                              { loanNumber: { contains: q, mode: 'insensitive' } },
                              { client: { clientId: { contains: q, mode: 'insensitive' } } },
                              { client: { firstName: { contains: q, mode: 'insensitive' } } },
                              { client: { lastName: { contains: q, mode: 'insensitive' } } },
                              ...loanMemberIdSearchConditions(q),
                          ],
                      }
                    : {}),
            };

            const [totalCount, loans] = await Promise.all([
                prisma.loan.count({ where }),
                prisma.loan.findMany({
                    where,
                    orderBy: { updatedAt: 'desc' },
                    skip: (page - 1) * pageSize,
                    take: pageSize,
                    select: {
                        id: true,
                        loanNumber: true,
                        amount: true,
                        disbursedByBMAt: true,
                        disbursementStatus: true,
                        funderId: true,
                        funder: { select: { funderName: true } },
                        client: { select: { clientId: true, firstName: true, lastName: true } },
                        branch: { select: { name: true, code: true } },
                        center: { select: { name: true } },
                        loanProduct: { select: { productName: true } },
                    },
                }),
            ]);

            return successResponse({
                loans: loans.map((l) => ({
                    loanId: l.id,
                    loanNumber: l.loanNumber,
                    amount: Number(l.amount),
                    disbursedAt: l.disbursedByBMAt,
                    disbursementStatus: l.disbursementStatus,
                    funderId: l.funderId,
                    funderName: l.funder?.funderName ?? 'OWN FUND (none)',
                    clientId: l.client.clientId,
                    clientName: `${l.client.firstName ?? ''} ${l.client.lastName ?? ''}`.trim() || l.client.clientId,
                    branchName: l.branch.name,
                    branchCode: l.branch.code,
                    centerName: l.center?.name ?? '',
                    productName: l.loanProduct?.productName ?? '',
                })),
                totalCount,
                totalPages: Math.ceil(totalCount / pageSize),
                page,
                pageSize,
            });
        } catch (error) {
            console.error('[super-control member-loan-edit/loans] Error:', error);
            return errorResponse(error instanceof Error ? error.message : 'Failed to fetch loans', 500);
        }
    })(request);
}
