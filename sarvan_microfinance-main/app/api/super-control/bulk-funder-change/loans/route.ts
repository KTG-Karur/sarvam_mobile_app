import { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { handleCorsPreflight, errorResponse, successResponse, withRole } from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { legacyLedgerLoanIds } from '@/app/lib/services/legacy-ledger-loans';
import { loanMemberIdSearchConditions } from '@/app/lib/reports/member-contacts';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/super-control/bulk-funder-change/loans?branchId=&funderId=&status=&q=&page=&pageSize=
 *
 * The loans of ONE branch currently financed by ONE funder — the candidate list for a bulk
 * funder transfer. Both branchId and funderId are required (a bulk move is always
 * "this branch, from this funder").
 */
export async function GET(request: NextRequest) {
    return withRole(['ADMIN'], async (req) => {
        try {
            const { searchParams } = new URL(req.url);
            const branchId = (searchParams.get('branchId') || '').trim();
            const funderId = (searchParams.get('funderId') || '').trim();
            const legacyParam = (searchParams.get('ledgerAlias') || '').trim();
            if (!branchId || (!funderId && !legacyParam)) return errorResponse('Branch and funder are required', 400);

            const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
            const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get('pageSize') || '50', 10)));
            const q = (searchParams.get('q') || '').trim();
            const statusParam = (searchParams.get('status') || '').trim().toUpperCase();
            const statusFilter: ('DISBURSED' | 'CLOSED')[] =
                statusParam === 'DISBURSED' || statusParam === 'CLOSED' ? [statusParam] : ['DISBURSED', 'CLOSED'];

            // "old ledger" source → only loans disbursed through that ledger; normal source → everyone else
            const legacyAlias = (searchParams.get('ledgerAlias') || '').trim();
            const excludeAliases = (searchParams.get('excludeAliases') || '').split('|').map((a) => a.trim()).filter(Boolean);
            let idFilter: Prisma.LoanWhereInput = {};
            if (legacyAlias) {
                // old-ledger vouchers can belong to loans that have since moved to ANY funder
                idFilter = { id: { in: [...(await legacyLedgerLoanIds(branchId, null, legacyAlias))] } };
            } else if (excludeAliases.length > 0) {
                const hidden = new Set<string>();
                for (const a of excludeAliases) (await legacyLedgerLoanIds(branchId, funderId, a)).forEach((id) => hidden.add(id));
                idFilter = { id: { notIn: [...hidden] } };
            }

            const where: Prisma.LoanWhereInput = {
                ...idFilter,
                branchId,
                ...(legacyAlias ? {} : { funderId }),
                disbursementStatus: { in: statusFilter },
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
                    orderBy: [{ disbursedByBMAt: 'desc' }, { loanNumber: 'asc' }],
                    skip: (page - 1) * pageSize,
                    take: pageSize,
                    select: {
                        id: true,
                        loanNumber: true,
                        amount: true,
                        disbursedByBMAt: true,
                        disbursementStatus: true,
                        client: { select: { clientId: true, firstName: true, lastName: true } },
                        center: { select: { name: true } },
                        loanProduct: { select: { productName: true } },
                        funder: { select: { funderName: true } },
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
                    clientId: l.client.clientId,
                    clientName: `${l.client.firstName ?? ''} ${l.client.lastName ?? ''}`.trim() || l.client.clientId,
                    centerName: l.center?.name ?? '',
                    productName: l.loanProduct?.productName ?? '',
                    funderName: l.funder?.funderName ?? '—',
                })),
                totalCount,
                totalPages: Math.ceil(totalCount / pageSize),
                page,
                pageSize,
            });
        } catch (error) {
            console.error('[super-control bulk-funder-change/loans] Error:', error);
            return errorResponse(error instanceof Error ? error.message : 'Failed to fetch loans', 500);
        }
    })(request);
}
