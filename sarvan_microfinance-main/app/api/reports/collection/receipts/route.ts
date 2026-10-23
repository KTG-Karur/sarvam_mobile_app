import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/app/lib/db';
import { withRole } from '@/app/lib/api-utils';
import { resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';

export async function GET(req: NextRequest) {
    return withRole(
        ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'],
        async (request, user) => {
            const { searchParams } = new URL(request.url);
            const fromDate = searchParams.get('fromDate');
            const toDate = searchParams.get('toDate');
            const officerId = searchParams.get('officerId');
            const branchId = searchParams.get('branchId');
            const centerId = searchParams.get('centerId');

            if (!fromDate || !toDate) {
                return NextResponse.json(
                    { success: false, message: 'fromDate and toDate are required.' },
                    { status: 400 }
                );
            }

            const startDate = new Date(fromDate);
            startDate.setHours(0, 0, 0, 0);

            const endDate = new Date(toDate);
            endDate.setHours(23, 59, 59, 999);

            const baseWhere: any = {
                transactionDate: { gte: startDate, lte: endDate },
                isReversed: false,
            };

            // Role-based branch scoping — fails safe: a client-supplied branchId
            // outside the caller's permitted set is ignored, never honored.
            const scopedBranchIds = await resolveScopedBranchIds(user, branchId);
            if (scopedBranchIds !== null) {
                baseWhere.branchId = scopedBranchIds.length === 1 ? scopedBranchIds[0] : { in: scopedBranchIds };
            }

            if (centerId && centerId !== 'all') {
                baseWhere.centerId = centerId;
            }

            if (officerId && officerId !== 'all') {
                baseWhere.collectedById = officerId;
            }

            const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
            const pageSize = Math.min(5000, Math.max(1, parseInt(searchParams.get('pageSize') ?? '25', 10)));

            const rowsWhere = { ...baseWhere, type: { in: ['REPAYMENT', 'PRECLOSURE'] } };
            const savingsWhere = { ...baseWhere, type: 'SAVINGS_COLLECTION' };

            // Savings amounts and grand totals are computed via separate, unpaginated
            // aggregates scoped to the same filters — decoupled from pagination, so a
            // batch's savings row is never split from its paired row across a page
            // boundary, and totals always reflect the full filtered set.
            const [totalCount, transactions, savingsGroups, sumsAgg] = await Promise.all([
                prisma.loanTransaction.count({ where: rowsWhere }),
                prisma.loanTransaction.findMany({
                    where: rowsWhere,
                    include: {
                        client: { select: { clientId: true, firstName: true, lastName: true } },
                        center: { select: { code: true, name: true } },
                        loan: { select: { loanNumber: true, amount: true } },
                        collectedBy: { select: { id: true, firstName: true, lastName: true } },
                    },
                    orderBy: [{ transactionDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
                    skip: (page - 1) * pageSize,
                    take: pageSize,
                }),
                prisma.loanTransaction.groupBy({
                    by: ['batchId', 'loanId'],
                    where: savingsWhere,
                    _sum: { amount: true },
                }),
                prisma.loanTransaction.aggregate({
                    where: rowsWhere,
                    _sum: {
                        principalAmount: true,
                        interestAmount: true,
                        currentDemandPrincipal: true,
                        currentDemandInterest: true,
                    },
                }),
            ]);

            // Build savings map: batchId:loanId → savings amount
            const savingsMap = new Map<string, number>();
            let totalSavings = 0;
            for (const g of savingsGroups) {
                const key = `${g.batchId || ''}:${g.loanId}`;
                const amt = Number(g._sum.amount || 0);
                savingsMap.set(key, (savingsMap.get(key) || 0) + amt);
                totalSavings += amt;
            }

            const rows = transactions.map((tx, index) => {
                const principalCollected = Number(tx.principalAmount ?? 0);
                const interestCollected = Number(tx.interestAmount ?? 0);
                const savingsKey = `${tx.batchId || ''}:${tx.loanId}`;
                const collectedSavings = savingsMap.get(savingsKey) || 0;
                const totalCollected = principalCollected + interestCollected + collectedSavings;
                const demandPrincipal = Number((tx as any).currentDemandPrincipal ?? 0);
                const demandInterest = Number((tx as any).currentDemandInterest ?? 0);

                return {
                    sno: (page - 1) * pageSize + index + 1,
                    centerName: tx.center ? `${tx.center.code} - ${tx.center.name}` : 'N/A',
                    clientName: `${tx.client.firstName} ${tx.client.lastName}`,
                    accountNo: tx.client.clientId,
                    loanAc: tx.loan.loanNumber,
                    refNo: tx.transactionId,
                    receiptDate: tx.transactionDate.toISOString(),
                    demandPrincipal,
                    demandInterest,
                    collectedPrincipal: principalCollected,
                    collectedInterest: interestCollected,
                    collectedSavings,
                    totalCollected,
                    mode: tx.paymentMode,
                    collectedBy: `${tx.collectedBy.firstName} ${tx.collectedBy.lastName}`,
                    collectedById: tx.collectedBy.id,
                    transactionType: tx.type,
                };
            });

            const totals = {
                demandPrincipal: Number(sumsAgg._sum.currentDemandPrincipal || 0),
                demandInterest: Number(sumsAgg._sum.currentDemandInterest || 0),
                collectedPrincipal: Number(sumsAgg._sum.principalAmount || 0),
                collectedInterest: Number(sumsAgg._sum.interestAmount || 0),
                collectedSavings: totalSavings,
                totalCollected: Number(sumsAgg._sum.principalAmount || 0) + Number(sumsAgg._sum.interestAmount || 0) + totalSavings,
            };

            return NextResponse.json({
                success: true,
                data: { rows, totals, count: totalCount, totalCount, totalPages: Math.ceil(totalCount / pageSize), page, pageSize },
            });
        }
    )(req);
}
