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
 * GET /api/loan-indexes/[indexId]/loans
 * Get all loans for a specific index
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ indexId: string }> }
) {
    return withAuth(async (req, user) => {
        try {
            const { indexId } = await params;

            // Multi-tenancy boundary — confirm this caller is permitted to see
            // the branch this loan index belongs to before returning any loans.
            const loanIndex = await prisma.loanIndex.findUnique({
                where: { id: indexId },
                select: { branchId: true },
            });
            if (!loanIndex) {
                return errorResponse('Loan index not found', 404);
            }
            const permittedBranchIds = await getPermittedBranchIds(user);
            if (permittedBranchIds !== null && !permittedBranchIds.includes(loanIndex.branchId)) {
                return errorResponse('You do not have access to this loan index', 403);
            }

            // Get loans for this index
            const loans = await prisma.loan.findMany({
                where: {
                    indexId,
                    isActive: true,
                },
                select: {
                    id: true,
                    loanNumber: true,
                    amount: true,
                    interestRate: true,
                    tenureMonths: true,
                    frequency: true,
                    loanProductId: true,
                    disbursementStatus: true,
                    firstDueDate: true,
                    branchId: true,
                    loanPurposeId: true, // Add this instead of purpose
                    client: {
                        select: {
                            id: true,
                            clientId: true,
                            firstName: true,
                            lastName: true,
                        },
                    },
                    loanPurpose: { // Include loanPurpose relation
                        select: {
                            id: true,
                            name: true,
                            loanPurposeType: {
                                select: {
                                    id: true,
                                    name: true,
                                },
                            },
                        },
                    },
                },
                orderBy: {
                    createdAt: 'asc',
                },
            });

            // Fetch product names mapping
            const productIds = Array.from(new Set(loans.map(l => l.loanProductId).filter(Boolean))) as string[];

            let productMap: Record<string, { name: string; typeName: string }> = {};

            if (productIds.length > 0) {
                // Fetch directly from global LoanProduct table to ensure we get names
                const products = await prisma.loanProduct.findMany({
                    where: {
                        id: { in: productIds },
                    },
                    select: {
                        id: true,
                        productName: true,
                        loanProductType: { select: { name: true } },
                    },
                });

                products.forEach(p => {
                    productMap[p.id] = {
                        name: p.productName,
                        typeName: p.loanProductType?.name || '',
                    };
                });
            }

            // Format the response - use loanPurpose name as purpose
            const formattedLoans = loans.map(loan => ({
                id: loan.id,
                loanNumber: loan.loanNumber,
                clientId: loan.client.clientId,
                clientName: `${loan.client.firstName} ${loan.client.lastName}`,
                purpose: loan.loanPurpose?.name || 'N/A', // Use loanPurpose name
                purposeType: loan.loanPurpose?.loanPurposeType?.name || 'N/A',
                product: (loan.loanProductId && productMap[loan.loanProductId]?.name) || loan.loanProductId || 'N/A',
                loanProductTypeName: (loan.loanProductId && productMap[loan.loanProductId]?.typeName) || '',
                amount: Number(loan.amount),
                interestRate: Number(loan.interestRate),
                tenureMonths: loan.tenureMonths,
                frequency: loan.frequency || 'N/A',
                disbursementStatus: loan.disbursementStatus,
                firstDueDate: loan.firstDueDate ? loan.firstDueDate.toISOString().split('T')[0] : null,
            }));

            return successResponse(
                formattedLoans,
                'Loan details retrieved successfully'
            );
        } catch (error) {
            console.error('Error fetching loan details:', error);
            return errorResponse(
                error instanceof Error ? error.message : 'Failed to fetch loan details',
                500
            );
        }
    })(request);
}