import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/prisma';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
} from '@/app/lib/api-utils';
import { isSubAdminUser } from '@/app/lib/permissions/sub-admin';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const bodySchema = z.object({
    loanProductId: z.string().min(1, 'Loan product is required'),
});

/** Mirrors first-loan.service.ts / update-product's tenure derivation. */
function computeTenureMonths(numberOfDues: number, frequency: string): number {
    const freq = (frequency || '').toLowerCase();
    if (freq === 'weekly') return Math.ceil(numberOfDues / 4.33);
    if (freq === 'forthnight') return Math.ceil(numberOfDues / 2.17);
    if (freq === 'daily') return Math.ceil(numberOfDues / 30);
    if (freq === 'quarterly') return numberOfDues * 3;
    return numberOfDues;
}

/**
 * PATCH /api/approval/loans/[loanId]/renewal-product
 *
 * Lets a reviewer (BM/AM/QC/Admin, at any stage) swap the loan product on a
 * renewal loan application while it's still working through its own
 * FDO -> BM -> AM -> QC -> Admin chain (Loan.renewalApprovalStatus) — before
 * FINAL_APPROVE releases it into Loan Indexation. Updates amount, interestRate,
 * tenureMonths and frequency from the new product, same convention as
 * /api/disbursements/[loanId]/update-product for an already-indexed loan.
 *
 * @access BRANCH_MANAGER, AREA_MANAGER, ADMIN, QC team, Sub Admin roles
 */
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ loanId: string }> }
) {
    const { loanId } = await params;

    return withAuth(async (req, user) => {
        try {
            const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
            if (!parsed.success) {
                return errorResponse(parsed.error.errors[0]?.message || 'Invalid request', 400);
            }
            const { loanProductId } = parsed.data;

            const isQCTeam = user.role === 'QC' || !!(await prisma.userRoleAssignment.findFirst({
                where: { userId: user.userId, isActive: true, role: { slug: 'quality-checkers', isActive: true } },
            }));
            const isSubAdmin = user.role !== 'ADMIN' && await isSubAdminUser(user.userId);
            const allowedRoles = ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH'];
            if (!allowedRoles.includes(user.role) && !isQCTeam && !isSubAdmin) {
                return errorResponse('Insufficient permissions', 403);
            }

            const loan = await prisma.loan.findUnique({
                where: { id: loanId },
                select: {
                    id: true,
                    branchId: true,
                    isRenewalApplication: true,
                    renewalApprovalStatus: true,
                    loanProduct: { select: { productName: true } },
                },
            });
            if (!loan) return errorResponse('Renewal loan not found', 404);
            if (!loan.isRenewalApplication || !loan.renewalApprovalStatus) {
                return errorResponse('This loan is not a renewal loan application', 400);
            }
            if (loan.renewalApprovalStatus === 'APPROVED' || loan.renewalApprovalStatus === 'REJECTED') {
                return errorResponse(`Cannot change loan product once the renewal is ${loan.renewalApprovalStatus.toLowerCase()}`, 400);
            }

            if (user.role === 'BRANCH_MANAGER') {
                const u = await prisma.user.findUnique({ where: { id: user.userId }, select: { branchId: true } });
                if (!u?.branchId || loan.branchId !== u.branchId) {
                    return errorResponse('Loan does not belong to your branch', 403);
                }
            }

            const product = await prisma.loanProduct.findUnique({
                where: { id: loanProductId },
                select: { id: true, productName: true, loanAmount: true, interestRate: true, numberOfDues: true, frequency: true, isActive: true },
            });
            if (!product || !product.isActive) {
                return errorResponse('Selected loan product is not available', 404);
            }
            const tenureMonths = computeTenureMonths(product.numberOfDues, product.frequency);

            const updated = await prisma.$transaction(async (tx) => {
                const updatedLoan = await tx.loan.update({
                    where: { id: loan.id },
                    data: {
                        loanProductId: product.id,
                        amount: product.loanAmount,
                        appliedAmount: product.loanAmount,
                        interestRate: product.interestRate,
                        tenureMonths,
                        frequency: product.frequency,
                    },
                    select: { id: true, loanProductId: true, amount: true, interestRate: true, tenureMonths: true, frequency: true },
                });
                await tx.loanApprovalHistory.create({
                    data: {
                        loanId: loan.id,
                        action: 'RENEWAL_PRODUCT_CHANGED',
                        performedById: user.userId,
                        remarks: `Loan product changed from "${loan.loanProduct?.productName ?? 'none'}" to "${product.productName}"`,
                    },
                });
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
        } catch (error) {
            console.error('Error updating renewal loan product:', error);
            return errorResponse(error instanceof Error ? error.message : 'Failed to update loan product', 500);
        }
    })(request);
}
