import { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { handleCorsPreflight, errorResponse, successResponse, withRole } from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { loanMemberIdSearchConditions } from '@/app/lib/reports/member-contacts';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/uploan/loan-history/loans?page=&pageSize=&q=&branchId=&status=
 *
 * Paginated list of backup/migrated loans (never indexed) for the Loan History Edit tool —
 * both still-DISBURSED loans AND loans that have since been CLOSED (full repayment,
 * foreclosure, or imported directly as closed via Closed Member Upload) are eligible: a
 * migrated loan's history can need correction whether or not it has since been closed.
 * `status` narrows to just one ('DISBURSED' | 'CLOSED'); omitted/invalid shows both.
 *
 * Each row carries enough signal to decide whether it's safe/exact to edit:
 *  - `hasStoredSource`  — `Loan.migratedLoanSource` is set (exact, lossless round trip)
 *  - `hasRealActivity`  — at least one LoanTransaction was NOT flagged
 *                         `excludeFromEodAllocation` (a real collection recorded through
 *                         the live app since import) — rebuilding would wipe it
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
                indexId: null,
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
                    // Closed loans have no disbursedByBMAt-ordering guarantee against still-open
                    // ones worth preserving — sort by most-recently-touched instead so newly
                    // migrated/closed rows surface first regardless of status.
                    orderBy: { updatedAt: 'desc' },
                    skip: (page - 1) * pageSize,
                    take: pageSize,
                    select: {
                        id: true,
                        loanNumber: true,
                        amount: true,
                        disbursedByBMAt: true,
                        disbursementStatus: true,
                        closedDate: true,
                        isBulkMemberImport: true,
                        migratedLoanSource: true,
                        client: { select: { clientId: true, firstName: true, lastName: true } },
                        branch: { select: { name: true, code: true } },
                        center: { select: { name: true } },
                        loanProduct: { select: { productName: true } },
                        _count: { select: { schedules: true, transactions: true } },
                    },
                }),
            ]);

            const loanIds = loans.map((l) => l.id);
            const realActivity = loanIds.length
                ? await prisma.loanTransaction.findMany({
                      where: { loanId: { in: loanIds }, excludeFromEodAllocation: false },
                      select: { loanId: true },
                      distinct: ['loanId'],
                  })
                : [];
            const realActivityLoanIds = new Set(realActivity.map((r) => r.loanId));

            const data = loans.map((l) => ({
                loanId: l.id,
                loanNumber: l.loanNumber,
                amount: Number(l.amount),
                disbursedAt: l.disbursedByBMAt,
                disbursementStatus: l.disbursementStatus as 'DISBURSED' | 'CLOSED',
                closedDate: l.closedDate,
                clientId: l.client.clientId,
                clientName: `${l.client.firstName ?? ''} ${l.client.lastName ?? ''}`.trim() || l.client.clientId,
                branchName: l.branch.name,
                branchCode: l.branch.code,
                centerName: l.center?.name ?? '',
                productName: l.loanProduct?.productName ?? '',
                scheduleCount: l._count.schedules,
                transactionCount: l._count.transactions,
                isBulkMemberImport: l.isBulkMemberImport,
                hasStoredSource: l.migratedLoanSource != null,
                hasRealActivity: realActivityLoanIds.has(l.id),
            }));

            return successResponse({
                loans: data,
                totalCount,
                totalPages: Math.ceil(totalCount / pageSize),
                page,
                pageSize,
            });
        } catch (error) {
            console.error('[uploan loan-history/loans] Error:', error);
            return errorResponse(error instanceof Error ? error.message : 'Failed to fetch loans', 500);
        }
    })(request);
}
