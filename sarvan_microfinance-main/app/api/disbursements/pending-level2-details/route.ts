import { NextRequest } from 'next/server';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';
import { findIncompleteMemberIndividualLoanIds } from '@/app/lib/member-individual-gate';

export async function OPTIONS() {
    return handleCorsPreflight();
}

export async function GET(request: NextRequest) {
    return withRole(['AREA_MANAGER', 'ADMIN'], async (req, user) => {
        const { searchParams } = new URL(req.url);
        const centerId = searchParams.get('centerId');
        const branchId = searchParams.get('branchId');
        const fromDate = searchParams.get('fromDate');
        const toDate = searchParams.get('toDate');

        try {
            // Multi-tenancy boundary — an AREA_MANAGER may only see Level-2
            // pending disbursements for branches they're assigned to.
            const permittedBranchIds = await getPermittedBranchIds(user);
            if (permittedBranchIds !== null) {
                if (branchId && !permittedBranchIds.includes(branchId)) {
                    return errorResponse('You do not have access to this branch', 403);
                }
                if (centerId) {
                    const center = await prisma.center.findUnique({ where: { id: centerId }, select: { branchId: true } });
                    if (!center || !permittedBranchIds.includes(center.branchId)) {
                        return errorResponse('You do not have access to this center', 403);
                    }
                }
                if (!branchId && !centerId && permittedBranchIds.length === 0) {
                    return successResponse(
                        { stats: { totalClients: 0, totalAmount: 0 }, indexes: [] },
                        'No branches assigned'
                    );
                }
            }

            // Build the loan filter — branchId or centerId must be provided
            const loanWhere: any = {
                isActive: true,
                disbursementStatus: 'PENDING_LEVEL2',
                indexId: { not: null },
            };

            if (centerId) {
                loanWhere.centerId = centerId;
            } else if (branchId) {
                loanWhere.branchId = branchId;
            } else if (permittedBranchIds !== null) {
                // No explicit filter given — restrict to this AM's assigned branches.
                loanWhere.branchId = permittedBranchIds.length === 1 ? permittedBranchIds[0] : { in: permittedBranchIds };
            } else {
                return errorResponse('Either branchId or centerId is required', 400);
            }

            // Build index date range filter
            const indexWhere: any = { isActive: true };
            if (centerId) indexWhere.centerId = centerId;
            else if (branchId) indexWhere.branchId = branchId;
            else if (permittedBranchIds !== null) {
                indexWhere.branchId = permittedBranchIds.length === 1 ? permittedBranchIds[0] : { in: permittedBranchIds };
            }

            if (fromDate || toDate) {
                indexWhere.indexDate = {};
                if (fromDate) indexWhere.indexDate.gte = new Date(`${fromDate}T00:00:00.000Z`);
                if (toDate) indexWhere.indexDate.lte = new Date(`${toDate}T23:59:59.999Z`);
            }

            // Query loans to get unique indexIds
            const pendingLoans = await prisma.loan.findMany({
                where: loanWhere,
                select: { indexId: true },
                distinct: ['indexId'],
            });

            const indexIds = pendingLoans
                .map((loan) => loan.indexId)
                .filter((id): id is string => id !== null);

            if (indexIds.length === 0) {
                return successResponse(
                    { stats: { totalClients: 0, totalAmount: 0 }, indexes: [] },
                    'No pending disbursement loans found'
                );
            }

            // Find indexes that have PENDING_LEVEL2 loans
            const indexes = await prisma.loanIndex.findMany({
                where: { ...indexWhere, id: { in: indexIds } },
                include: {
                    center: { select: { id: true, name: true, code: true } },
                    loans: {
                        where: { isActive: true, disbursementStatus: 'PENDING_LEVEL2' },
                        include: {
                            client: {
                                select: { id: true, firstName: true, lastName: true, clientId: true },
                            },
                            loanPurpose: {
                                select: {
                                    id: true,
                                    name: true,
                                    loanPurposeType: { select: { id: true, name: true } },
                                },
                            },
                        },
                    },
                },
                orderBy: { indexDate: 'desc' },
            });

            // Member Individual + GRT completeness, per loan — surfaces the same
            // gate that blocks the actual approve action, so the AM sees it up
            // front instead of hitting an error after clicking Approve.
            const allLoansFlat = indexes.flatMap((idx) => idx.loans.map((l: any) => ({ id: l.id })));
            const incompleteLoanIds = await findIncompleteMemberIndividualLoanIds(allLoansFlat);

            const detailedIndexes = indexes.map((idx) => ({
                id: idx.id,
                indexNo: idx.indexNo,
                indexDate: idx.indexDate.toISOString().split('T')[0],
                centerId: idx.centerId,
                centerName: idx.center?.name || '',
                centerCode: idx.center?.code || '',
                totalAmount: idx.loans.reduce((sum: number, loan: any) => sum + Number(loan.amount), 0),
                totalLoans: idx.loans.length,
                loans: idx.loans.map((loan: any) => ({
                    id: loan.id,
                    amount: Number(loan.amount),
                    maxAllowedAmount: Number(loan.memberIndividualApprovedAmount ?? loan.indexedAmount ?? loan.appliedAmount ?? loan.amount),
                    interestRate: Number(loan.interestRate),
                    tenureMonths: loan.tenureMonths,
                    frequency: loan.frequency,
                    firstDueDate: loan.firstDueDate ? loan.firstDueDate.toISOString().split('T')[0] : null,
                    loanProductId: loan.loanProductId || null,
                    clientName: `${loan.client.firstName} ${loan.client.lastName}`,
                    clientId: loan.client.clientId,
                    clientDbId: loan.client.id,
                    purpose: loan.loanPurpose?.name || 'N/A',
                    purposeType: loan.loanPurpose?.loanPurposeType?.name || 'N/A',
                    tenure: `${loan.tenureMonths} Months`,
                    isVerified: !incompleteLoanIds.has(loan.id),
                })),
            }));

            const stats = {
                totalClients: detailedIndexes.reduce((sum: number, idx: any) => sum + idx.totalLoans, 0),
                totalAmount: detailedIndexes.reduce((sum: number, idx: any) => sum + idx.totalAmount, 0),
            };

            return successResponse({ stats, indexes: detailedIndexes }, 'Detailed pending stats fetched');
        } catch (error) {
            console.error('Error fetching detailed AM stats:', error);
            return errorResponse('Failed to fetch details', 500);
        }
    })(request);
}