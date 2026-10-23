import { NextRequest } from 'next/server';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
} from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import {
    assertBranchNotLocked,
    parseKolkataAttendanceDateYmd,
    getKolkataDayEndExclusiveUtc,
} from '@/app/lib/branch-lock';
import { accountingPostingService } from '@/app/lib/services/accounting-posting.service';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';
import { getLoanAdvanceEnabled } from '@/app/lib/loan-advance-config';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * POST /api/collections/eod-allocation/loan-advance
 * Posts a branch/date's approved "Loan Advance" (SAVINGS_COLLECTION) amounts as a Cash Receipt
 * voucher into the shared LOAN ADVANCE ledger — deliberately separate from a funder's principal/
 * interest "Allocate for EOD" click (see postEodLoanAdvanceAllocation), since Loan Advance isn't
 * tied to any one funder or gold/normal split. Idempotent — a date already posted returns 409
 * rather than double-posting.
 *
 * `transactionIds` (optional): allocate only this subset of the branch/date's pending Loan
 * Advance transactions instead of every pending one.
 */
export async function POST(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            if (!(await getLoanAdvanceEnabled())) {
                return errorResponse('Loan Advance is currently disabled', 403);
            }

            const body = await req.json();
            const branchId: string | undefined = body.branchId || user.branchId;
            const dateYmd: string | undefined = body.date;
            const transactionIds: string[] | undefined = Array.isArray(body.transactionIds) ? body.transactionIds : undefined;

            if (!branchId) return errorResponse('Branch context is required', 400);
            if (!dateYmd) return errorResponse('date is required', 400);

            const permittedBranchIds = await getPermittedBranchIds(user);
            if (permittedBranchIds !== null && !permittedBranchIds.includes(branchId)) {
                return errorResponse('You do not have access to that branch', 403);
            }

            const lockResponse = await assertBranchNotLocked(branchId);
            if (lockResponse) return lockResponse;

            const dayStartUtc = parseKolkataAttendanceDateYmd(dateYmd);
            const dayEndExclusiveUtc = getKolkataDayEndExclusiveUtc(dayStartUtc);

            const candidateTx = await prisma.loanTransaction.findMany({
                where: {
                    branchId,
                    type: 'SAVINGS_COLLECTION' as never,
                    status: 'APPROVED',
                    isReversed: false,
                    eodAllocatedAt: null,
                    excludeFromEodAllocation: false,
                    transactionDate: { gte: dayStartUtc, lt: dayEndExclusiveUtc },
                    ...(transactionIds ? { id: { in: transactionIds } } : {}),
                },
                select: { id: true, amount: true },
            });

            if (candidateTx.length === 0) {
                return errorResponse('No approved Loan Advance collections found for this date', 404);
            }
            if (transactionIds && candidateTx.length !== transactionIds.length) {
                return errorResponse('Some selected transactions are no longer pending allocation — refresh and try again', 409);
            }

            const loanAdvanceAmount = candidateTx.reduce((sum, t) => sum + Number(t.amount || 0), 0);

            const result = await prisma.$transaction(async (tx) => {
                return accountingPostingService.postEodLoanAdvanceAllocation({
                    tx,
                    branchId,
                    workingDateYmd: dateYmd,
                    loanAdvanceAmount,
                    transactionDate: dayStartUtc,
                    createdById: user.userId,
                    createdByRole: user.role,
                    transactionIds: candidateTx.map((t) => t.id),
                });
            });

            if (!result.posted) {
                return errorResponse(result.message || 'Already allocated for this date', 409);
            }

            return successResponse(
                result,
                `Allocated Loan Advance to EOD (voucher ${result.voucherNo})`
            );
        } catch (error) {
            console.error('[EOD Loan Advance Allocation] POST Error:', error);
            return errorResponse('Failed to allocate Loan Advance for EOD', 500);
        }
    })(request);
}
