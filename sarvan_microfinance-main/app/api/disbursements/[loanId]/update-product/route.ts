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
import { deriveLoanIndexFrequency } from '@/app/lib/loan-frequency';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const updateProductSchema = z.object({
    loanProductId: z.string().min(1, 'Loan product ID is required'),
    stage: z.enum(['MEMBER_INDIVIDUAL', 'DISBURSEMENT']),
});

/**
 * PATCH /api/disbursements/[loanId]/update-product
 * Allows AM (or BM, reviewing Loan Appraisal in Member Individual before AM
 * approval) to change the loan product on a PENDING_LEVEL2 loan.
 * Updates amount, interestRate, tenureMonths, and frequency from the selected product.
 * Also recalculates LoanIndex.totalAmount and LoanIndex.frequency in the same transaction.
 *
 * `stage` controls which ceiling applies:
 * - MEMBER_INDIVIDUAL: capped by the approved Loan Indexation amount (indexedAmount).
 * - DISBURSEMENT: capped by the approved Member Individual amount (memberIndividualApprovedAmount),
 *   which this route also freezes whenever a MEMBER_INDIVIDUAL-stage edit happens.
 *
 * @access AREA_MANAGER, BRANCH_MANAGER, ADMIN
 */
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ loanId: string }> }
) {
    return withRole(['AREA_MANAGER', 'BRANCH_MANAGER', 'ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH'], async (req, user) => {
        try {
            const { loanId } = await params;
            const body = await req.json();
            const { loanProductId, stage } = updateProductSchema.parse(body);

            const loan = await prisma.loan.findUnique({
                where: { id: loanId, isActive: true },
                select: {
                    id: true,
                    indexId: true,
                    disbursementStatus: true,
                    amount: true,
                    appliedAmount: true,
                    indexedAmount: true,
                    memberIndividualApprovedAmount: true,
                    loanProduct: { select: { productName: true } },
                },
            });

            if (!loan) return errorResponse('Loan not found', 404);
            if (!loan.indexId) return errorResponse('Loan is not part of any index', 400);
            if (loan.disbursementStatus !== 'PENDING_LEVEL2') {
                return errorResponse('Product can only be changed for loans pending AM approval', 400);
            }

            const product = await prisma.loanProduct.findUnique({
                where: { id: loanProductId, isActive: true },
                select: {
                    id: true,
                    productName: true,
                    loanAmount: true,
                    interestRate: true,
                    numberOfDues: true,
                    frequency: true,
                },
            });

            if (!product) return errorResponse('Loan product not found or inactive', 404);

            const maxAllowedAmount = stage === 'DISBURSEMENT'
                ? Number(loan.memberIndividualApprovedAmount ?? loan.indexedAmount ?? loan.appliedAmount ?? loan.amount)
                : Number(loan.indexedAmount ?? loan.appliedAmount ?? loan.amount);

            // Admin may pick a product above the approved ceiling (e.g. raise a client's
            // amount); everyone else is capped by the previous stage's approved amount.
            const isAdmin = user.role === 'ADMIN';
            const exceedsCeiling = Number(product.loanAmount) > maxAllowedAmount;
            if (exceedsCeiling && !isAdmin) {
                return errorResponse(
                    stage === 'DISBURSEMENT'
                        ? "Selected Loan Product exceeds the approved Member Individual loan amount."
                        : "Selected Loan Product exceeds the approved Loan Indexation amount.",
                    400
                );
            }

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

            const indexId = loan.indexId;

            const updated = await prisma.$transaction(async (tx) => {
                const updatedLoan = await tx.loan.update({
                    where: { id: loanId },
                    data: {
                        loanProductId: product.id,
                        amount: product.loanAmount,
                        interestRate: product.interestRate,
                        tenureMonths,
                        frequency: product.frequency,
                        ...(stage === 'MEMBER_INDIVIDUAL'
                            ? { memberIndividualApprovedAmount: product.loanAmount }
                            : {}),
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

                const siblings = await tx.loan.findMany({
                    where: { indexId, isActive: true },
                    select: { amount: true, frequency: true },
                });

                const newTotalAmount = siblings.reduce((sum, l) => sum + Number(l.amount), 0);
                const newFrequency = deriveLoanIndexFrequency({
                    loanFrequencies: siblings.map((l) => l.frequency),
                });

                await tx.loanIndex.update({
                    where: { id: indexId },
                    data: {
                        totalAmount: newTotalAmount,
                        frequency: newFrequency,
                    },
                });

                await recordLoanHistory(tx, [{
                    loanId,
                    action: 'PRODUCT_CHANGED',
                    performedById: user.userId,
                    remarks: `Loan product changed from "${loan.loanProduct?.productName ?? 'none'}" to "${product.productName}" (${stage})` +
                        (exceedsCeiling ? ` — admin override above approved amount ₹${maxAllowedAmount}` : ''),
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
