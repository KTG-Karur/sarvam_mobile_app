import { NextRequest } from 'next/server';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { recordLoanHistory } from '@/app/lib/loan-history';
import { z } from 'zod';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const updateProductSchema = z.object({
    loanProductId: z.string().min(1, 'Loan product ID is required'),
});

/**
 * PATCH /api/loans/[loanId]/update-product
 * Allows BM to change the loan product before indexation.
 * Updates amount, interestRate, tenureMonths from the new product.
 * ADMIN (base role) is exempt from the applied-amount ceiling and may raise the amount.
 *
 * @access BRANCH_MANAGER, ADMIN
 */
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ loanId: string }> }
) {
    return withRole(['BRANCH_MANAGER', 'ADMIN'], async (req, user) => {
        try {
            const { loanId } = await params;
            const body = await req.json();
            const { loanProductId } = updateProductSchema.parse(body);

            const loan = await prisma.loan.findUnique({
                where: { id: loanId, isActive: true },
                select: {
                    id: true,
                    indexId: true,
                    disbursementStatus: true,
                    frequency: true,
                    amount: true,
                    appliedAmount: true,
                    loanProduct: { select: { productName: true } },
                },
            });

            if (!loan) return errorResponse('Loan not found', 404);
            if (loan.indexId) return errorResponse('Cannot change product after loan has been indexed', 400);
            if (!['PENDING_LEVEL1', 'APPROVED_LEVEL1'].includes(loan.disbursementStatus)) {
                return errorResponse('Product can only be changed for loans not yet sent to Area Manager', 400);
            }

            const product = await prisma.loanProduct.findUnique({
                where: { id: loanProductId, isActive: true },
                select: {
                    id: true,
                    productName: true,
                    loanAmount: true,
                    interestRate: true,
                    insuranceFees: true,
                    documentCharges: true,
                    numberOfDues: true,
                    frequency: true,
                    loanProductTypeId: true,
                },
            });

            if (!product) return errorResponse('Loan product not found or inactive', 404);

            const appliedAmount = Number(loan.appliedAmount ?? loan.amount);
            // Admin may pick a product above the applied amount (e.g. raise a client's
            // amount); BM is capped by what the customer applied for.
            const isAdmin = user.role === 'ADMIN';
            const exceedsCeiling = Number(product.loanAmount) > appliedAmount;
            if (exceedsCeiling && !isAdmin) {
                return errorResponse(
                    "Selected Loan Product exceeds the customer's applied loan amount. Please select a Loan Product within the approved application amount.",
                    400
                );
            }

            // Calculate tenureMonths from numberOfDues and the new product's frequency
            const freq = product.frequency.toLowerCase();
            let tenureMonths = product.numberOfDues;
            if (freq === 'weekly') {
                tenureMonths = Math.ceil(product.numberOfDues / 4.33);
            } else if (freq === 'forthnight') {
                tenureMonths = Math.ceil(product.numberOfDues / 2.17);
            } else if (freq === 'daily') {
                tenureMonths = Math.ceil(product.numberOfDues / 30);
            } else if (freq === 'quarterly') {
                tenureMonths = product.numberOfDues * 3;
            }

            const updated = await prisma.$transaction(async (tx) => {
            const updatedLoan = await tx.loan.update({
                where: { id: loanId },
                data: {
                    loanProductId: product.id,
                    amount: product.loanAmount,
                    interestRate: product.interestRate,
                    tenureMonths,
                    frequency: product.frequency,
                },
                select: {
                    id: true,
                    amount: true,
                    interestRate: true,
                    tenureMonths: true,
                    loanProductId: true,
                    frequency: true,
                },
            });
            await recordLoanHistory(tx, [{
                loanId,
                action: 'PRODUCT_CHANGED',
                performedById: user.userId,
                remarks: `Loan product changed from "${loan.loanProduct?.productName ?? 'none'}" to "${product.productName}"` +
                    (exceedsCeiling ? ` — admin override above applied amount ₹${appliedAmount}` : ''),
            }]);
            return updatedLoan;
            });

            return successResponse(
                {
                    id: updated.id,
                    loanProductId: updated.loanProductId,
                    productName: product.productName,
                    amount: Number(updated.amount),
                    interestRate: Number(updated.interestRate),
                    tenureMonths: updated.tenureMonths,
                    frequency: updated.frequency,
                },
                'Loan product updated successfully'
            );
        } catch (error: any) {
            if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
            return errorResponse(error.message || 'Failed to update loan product', 500);
        }
    })(request);
}
