import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/prisma';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const schema = z.object({ indexId: z.string().min(1, 'indexId is required') });

/**
 * POST /api/disbursements/send-back-to-am
 *
 * Admin-only: sends an AM-approved (APPROVED_LEVEL2) index's loans back to
 * PENDING_LEVEL2 so the AM's Level-2 approval can be redone — e.g. to correct a
 * loan product via Member Individual → Loan Appraisal before disbursement.
 *
 * Hard-refuses if any loan in the index is already disbursed (a repayment
 * schedule exists) or has any recorded payment — those need Disbursement
 * Revert, not this. Nothing is written unless every loan passes.
 *
 * @access ADMIN, ADMIN_NON_HO_BRANCH_SWITCH (branch-scoped for the latter)
 */
export async function POST(request: NextRequest) {
    return withRole(['ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH'], async (req, user) => {
        try {
            const { indexId } = schema.parse(await req.json());

            const loanIndex = await prisma.loanIndex.findUnique({
                where: { id: indexId },
                select: { id: true, indexNo: true, branchId: true },
            });
            if (!loanIndex) return errorResponse('Loan Index not found', 404);

            const permitted = await getPermittedBranchIds(user);
            if (permitted !== null && !permitted.includes(loanIndex.branchId)) {
                return errorResponse('Access denied to this branch', 403);
            }

            const loans = await prisma.loan.findMany({
                where: { indexId, isActive: true },
                select: {
                    id: true,
                    loanNumber: true,
                    disbursementStatus: true,
                    principalPaid: true,
                    interestPaid: true,
                    penaltiesPaid: true,
                    savingsPaid: true,
                },
            });
            if (loans.length === 0) return errorResponse('No active loans in this index', 400);

            const notApproved = loans.filter((l) => l.disbursementStatus !== 'APPROVED_LEVEL2');
            if (notApproved.length > 0) {
                return errorResponse(
                    `Cannot send back — ${notApproved.length} loan(s) are not at the AM-approved stage: ` +
                        notApproved.map((l) => `${l.loanNumber} (${l.disbursementStatus})`).join(', '),
                    400
                );
            }

            const withPayments = loans.filter(
                (l) =>
                    Number(l.principalPaid || 0) > 0 ||
                    Number(l.interestPaid || 0) > 0 ||
                    Number(l.penaltiesPaid || 0) > 0 ||
                    Number(l.savingsPaid || 0) > 0
            );
            if (withPayments.length > 0) {
                return errorResponse(
                    `Cannot send back — payments already recorded on: ${withPayments.map((l) => l.loanNumber).join(', ')}. Use Disbursement Revert instead.`,
                    400
                );
            }

            const loanIds = loans.map((l) => l.id);
            const scheduleCount = await prisma.loanSchedule.count({ where: { loanId: { in: loanIds } } });
            if (scheduleCount > 0) {
                return errorResponse(
                    'Cannot send back — one or more loans are already disbursed (a repayment schedule exists). Use Disbursement Revert instead.',
                    400
                );
            }

            const result = await prisma.loan.updateMany({
                where: { indexId, isActive: true, disbursementStatus: 'APPROVED_LEVEL2' },
                data: {
                    disbursementStatus: 'PENDING_LEVEL2',
                    approvedLevel2ById: null,
                    approvedLevel2At: null,
                },
            });

            console.log(
                `[SendBackToAM] indexId=${indexId} indexNo=${loanIndex.indexNo} loans=${result.count} by=${user.userId}`
            );
            return successResponse(
                { indexId, indexNo: loanIndex.indexNo, sentBack: result.count },
                `${result.count} loan(s) sent back to AM approval`
            );
        } catch (error) {
            if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
            console.error('Error in send-back-to-am:', error);
            return errorResponse(error instanceof Error ? error.message : 'Failed to send back to AM', 500);
        }
    })(request);
}
