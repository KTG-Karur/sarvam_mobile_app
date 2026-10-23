import { NextRequest } from 'next/server';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
} from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';
import { memberIdSearchConditions } from '@/app/lib/reports/member-contacts';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/savings/summary
 * Returns loan advance summary for a client or center/branch.
 * Query: clientId (optional), centerId (optional), branchId (optional)
 */
export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const clientId = searchParams.get('clientId');
            const loanId = searchParams.get('loanId');
            const centerId = searchParams.get('centerId');
            const branchId = searchParams.get('branchId');
            const search = searchParams.get('search')?.trim() || undefined;
            const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
            const pageSize = Math.min(5000, Math.max(1, parseInt(searchParams.get('pageSize') ?? '25', 10)));

            const permittedBranchIds = await getPermittedBranchIds(user);

            if (clientId) {
                const client = await prisma.client.findUnique({
                    where: { id: clientId },
                    select: {
                        id: true,
                        clientId: true,
                        firstName: true,
                        lastName: true,
                        loanAdvance: true,
                        center: { select: { branchId: true } },
                        loanApplications: {
                            where: { isActive: true, disbursementStatus: 'DISBURSED' },
                            select: {
                                id: true,
                                loanNumber: true,
                                disbursementStatus: true,
                                savingsPaid: true,
                            },
                        },
                    },
                });

                if (!client) return errorResponse('Client not found', 404);

                // Multi-tenancy boundary
                if (permittedBranchIds !== null && (!client.center || !permittedBranchIds.includes(client.center.branchId))) {
                    return errorResponse('You do not have access to this client', 403);
                }

                const pendingRefund = await prisma.savingsRefundRequest.aggregate({
                    where: { clientId, status: 'PENDING_APPROVAL' },
                    _sum: { refundAmount: true },
                });

                return successResponse({
                    clientId: client.id,
                    clientCode: client.clientId,
                    clientName: `${client.firstName} ${client.lastName}`,
                    loanAdvanceBalance: Number(client.loanAdvance ?? 0),
                    savingsBalance: Number(client.loanAdvance ?? 0),
                    pendingRefundAmount: Number(Number(pendingRefund._sum.refundAmount ?? 0).toFixed(2)),
                    loans: client.loanApplications.map(l => ({
                        loanId: l.id,
                        loanNumber: l.loanNumber,
                        disbursementStatus: l.disbursementStatus,
                        savingsPaid: Number(l.savingsPaid ?? 0),
                    })),
                }, 'Loan advance summary fetched');
            }

            if (loanId) {
                const loan = await prisma.loan.findUnique({
                    where: { id: loanId },
                    select: {
                        id: true,
                        loanNumber: true,
                        savingsPaid: true,
                        disbursementStatus: true,
                        clientId: true,
                        branchId: true,
                        client: {
                            select: {
                                firstName: true,
                                lastName: true,
                                clientId: true,
                                loanAdvance: true,
                            },
                        },
                    },
                });

                if (!loan) return errorResponse('Loan not found', 404);

                // Multi-tenancy boundary
                if (permittedBranchIds !== null && !permittedBranchIds.includes(loan.branchId)) {
                    return errorResponse('You do not have access to this loan', 403);
                }

                const pendingRefund = await prisma.savingsRefundRequest.aggregate({
                    where: { clientId: loan.clientId, status: 'PENDING_APPROVAL' },
                    _sum: { refundAmount: true },
                });

                return successResponse({
                    loanId: loan.id,
                    loanNumber: loan.loanNumber,
                    clientName: `${loan.client.firstName} ${loan.client.lastName}`,
                    loanAdvanceBalance: Number(loan.client.loanAdvance ?? 0),
                    savingsBalance: Number(loan.client.loanAdvance ?? 0),
                    pendingRefundAmount: Number(Number(pendingRefund._sum.refundAmount ?? 0).toFixed(2)),
                    disbursementStatus: loan.disbursementStatus,
                }, 'Loan advance summary fetched');
            }

            if (centerId || branchId) {
                // Multi-tenancy boundary — validate the requested branch/center
                // against what this role is actually permitted to see.
                if (permittedBranchIds !== null) {
                    if (branchId && !permittedBranchIds.includes(branchId)) {
                        return errorResponse('You do not have access to this branch', 403);
                    }
                    if (centerId && !branchId) {
                        const center = await prisma.center.findUnique({ where: { id: centerId }, select: { branchId: true } });
                        if (!center || !permittedBranchIds.includes(center.branchId)) {
                            return errorResponse('You do not have access to this center', 403);
                        }
                    }
                }

                const where: any = { isActive: true, loanAdvance: { gt: 0 } };
                if (centerId) where.centerId = centerId;
                if (branchId) where.center = { branchId };
                if (search) {
                    where.OR = [
                        { firstName: { contains: search, mode: 'insensitive' } },
                        { lastName: { contains: search, mode: 'insensitive' } },
                        { clientId: { contains: search, mode: 'insensitive' } },
                        ...memberIdSearchConditions(search),
                    ];
                }

                const [totalCount, clients] = await Promise.all([
                    prisma.client.count({ where }),
                    prisma.client.findMany({
                        where,
                        select: {
                            id: true,
                            clientId: true,
                            firstName: true,
                            lastName: true,
                            loanAdvance: true,
                            center: { select: { name: true, code: true } },
                            loanApplications: {
                                where: { isActive: true, disbursementStatus: 'DISBURSED' },
                                select: { id: true, loanNumber: true },
                                take: 1,
                                orderBy: { createdAt: 'desc' },
                            },
                        },
                        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
                        skip: (page - 1) * pageSize,
                        take: pageSize,
                    }),
                ]);

                const pendingAgg = clients.length > 0
                    ? await prisma.savingsRefundRequest.groupBy({
                        by: ['clientId'],
                        where: { clientId: { in: clients.map(c => c.id) }, status: 'PENDING_APPROVAL' },
                        _sum: { refundAmount: true },
                    })
                    : [];
                const pendingMap = new Map(pendingAgg.map(p => [p.clientId, Number(p._sum.refundAmount ?? 0)]));

                const data = clients.map((c) => {
                    const loanAdvanceBalance = Number(c.loanAdvance ?? 0);
                    const requestedRefundAmount = pendingMap.get(c.id) ?? 0;
                    return {
                        clientDbId: c.id,
                        clientId: c.clientId,
                        clientName: `${c.firstName} ${c.lastName}`,
                        centerName: c.center?.name ?? null,
                        centerCode: c.center?.code ?? null,
                        loanAdvanceBalance,
                        savingsBalance: loanAdvanceBalance,
                        requestedRefundAmount,
                        availableBalance: Math.max(0, loanAdvanceBalance - requestedRefundAmount),
                        refundStatus: requestedRefundAmount > 0 ? 'PENDING_APPROVAL' : null,
                        loanId: c.loanApplications[0]?.id || null,
                        loanNumber: c.loanApplications[0]?.loanNumber || null,
                    };
                });

                return successResponse(
                    { data, totalCount, totalPages: Math.ceil(totalCount / pageSize), page, pageSize },
                    'Loan advance summary fetched'
                );
            }

            return errorResponse('clientId, loanId, centerId, or branchId is required', 400);
        } catch (error) {
            console.error('Error fetching loan advance summary:', error);
            return errorResponse('Failed to fetch loan advance summary', 500);
        }
    })(request);
}
