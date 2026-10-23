import { NextRequest } from 'next/server';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/disbursements/approved-level2?centerId=xxx
 * Returns all APPROVED_LEVEL2 loans for a center, grouped by index.
 * Used by BM to see which loans are ready for final disbursement.
 *
 * @access BRANCH_MANAGER, ADMIN
 */
export async function GET(request: NextRequest) {
    return withRole(['BRANCH_MANAGER', 'ADMIN'], async (req, user) => {
        const { searchParams } = new URL(req.url);
        const centerId = searchParams.get('centerId');
        const branchId = searchParams.get('branchId');

        if (!centerId && !branchId) return errorResponse('centerId or branchId is required', 400);

        try {
            // Resolve the effective branchId for access control
            let effectiveBranchId = branchId;
            if (centerId) {
                const center = await prisma.center.findUnique({
                    where: { id: centerId },
                    select: { branchId: true },
                });
                if (!center) return errorResponse('Center not found', 404);
                effectiveBranchId = center.branchId;
            }

            // BM can only see their own branch
            if (user.role === 'BRANCH_MANAGER') {
                const bm = await prisma.user.findUnique({
                    where: { id: user.userId },
                    select: { branchId: true },
                });
                if (effectiveBranchId && bm?.branchId !== effectiveBranchId) {
                    return errorResponse('Center/branch does not belong to your branch', 403);
                }
            }

            const loanWhere: any = {
                isActive: true,
                disbursementStatus: 'APPROVED_LEVEL2',
                indexId: { not: null },
            };
            if (centerId) loanWhere.centerId = centerId;
            else if (branchId) loanWhere.branchId = branchId;

            const loans = await prisma.loan.findMany({
                where: loanWhere,
                include: {
                    client: {
                        select: { clientId: true, firstName: true, lastName: true, admissionFees: true },
                    },
                    loanIndex: {
                        select: {
                            id: true,
                            indexNo: true,
                            indexDate: true,
                            center: { select: { id: true, name: true, code: true } },
                        },
                    },
                    approvedLevel2By: {
                        select: { firstName: true, lastName: true },
                    },
                    loanPurpose: {
                        select: {
                            id: true,
                            name: true,
                            loanPurposeType: { select: { id: true, name: true } },
                        },
                    },
                    loanProduct: {
                        select: {
                            loanProductType: { select: { name: true } },
                            documentCharges: true,
                        },
                    },
                },
                orderBy: { createdAt: 'asc' },
            });

            // Group by index
            const indexMap = new Map<string, { index: any; loans: any[] }>();
            for (const loan of loans) {
                const idx = loan.loanIndex!;
                if (!indexMap.has(idx.id)) {
                    indexMap.set(idx.id, {
                        index: {
                            id: idx.id,
                            indexNo: idx.indexNo,
                            indexDate: idx.indexDate.toISOString().split('T')[0],
                            centerId: loan.centerId,
                            centerName: (idx as any).center?.name ?? '',
                            centerCode: (idx as any).center?.code ?? '',
                        },
                        loans: [],
                    });
                }
                const productTypeName = loan.loanProduct?.loanProductType?.name ?? '';
                const feeNum = (loan as any).admissionFee
                    ? Number((loan as any).admissionFee)
                    : (loan.client.admissionFees ? Number(loan.client.admissionFees) : 50);

                indexMap.get(idx.id)!.loans.push({
                    id: loan.id,
                    loanNumber: loan.loanNumber,
                    amount: Number(loan.amount),
                    frequency: loan.frequency,
                    tenureMonths: loan.tenureMonths,
                    firstDueDate: loan.firstDueDate ? loan.firstDueDate.toISOString().split('T')[0] : null,
                    purpose: loan.loanPurpose?.name || 'N/A',
                    purposeType: loan.loanPurpose?.loanPurposeType?.name || 'N/A',
                    clientId: loan.client.clientId,
                    clientName: `${loan.client.firstName} ${loan.client.lastName}`,
                    approvedLevel2By: loan.approvedLevel2By
                        ? `${loan.approvedLevel2By.firstName} ${loan.approvedLevel2By.lastName}`
                        : null,
                    approvedLevel2At: loan.approvedLevel2At,
                    isGoldLoan: productTypeName.toLowerCase().includes('gold'),
                    loanProductTypeName: productTypeName,
                    documentCharges: Number(loan.loanProduct?.documentCharges || 0),
                    admissionFee: feeNum,
                    funderId: loan.funderId || null,
                    isNewClient: true,
                });
            }

            const indexes = Array.from(indexMap.values()).map(({ index, loans: iLoans }) => ({
                ...index,
                totalLoans: iLoans.length,
                totalAmount: iLoans.reduce((s, l) => s + l.amount, 0),
                loans: iLoans,
            }));

            const stats = {
                totalLoans: loans.length,
                totalAmount: loans.reduce((s, l) => s + Number(l.amount), 0),
            };

            return successResponse(
                { stats, indexes, centerId: centerId || null, branchId: effectiveBranchId || null },
                'APPROVED_LEVEL2 loans fetched'
            );
        } catch (error) {
            console.error('Error fetching approved-level2 loans:', error);
            return errorResponse('Failed to fetch loans', 500);
        }
    })(request);
}