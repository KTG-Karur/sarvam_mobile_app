import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const PAYMENT_TXN_TYPES = ['REPAYMENT', 'PRECLOSURE', 'SAVINGS_COLLECTION', 'SAVINGS_REFUND'];

function transactionTypeLabel(type: string, collectionType: string | null): string {
    if (collectionType && collectionType.trim()) return collectionType.trim();
    switch (type) {
        case 'REPAYMENT': return 'Repayment';
        case 'PRECLOSURE': return 'Pre-Closure / Foreclosure';
        case 'SAVINGS_COLLECTION': return 'Loan Advance Collection';
        case 'SAVINGS_REFUND': return 'Loan Advance Refund';
        default: return type;
    }
}

/**
 * GET /api/collections/member-collection-details/payment-history?loanId=X
 * Returns every actual payment transaction made against the loan (one row per
 * transaction-line, or one row per transaction when it has no lines — e.g.
 * PRECLOSURE, which settles all schedules directly without LoanTransactionLine
 * rows, or the wallet-only SAVINGS_COLLECTION/SAVINGS_REFUND transactions).
 * This is a dedicated payment-history view — distinct from the shared
 * /api/loans/[loanId]/schedule endpoint, which returns the full future schedule.
 */
export async function GET(request: NextRequest) {
    return withRole(['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER'], async (req) => {
        try {
            const { searchParams } = new URL(req.url);
            const loanId = searchParams.get('loanId');

            if (!loanId) {
                return errorResponse('loanId is required', 400);
            }

            const loan = await prisma.loan.findUnique({
                where: { id: loanId },
                select: {
                    loanNumber: true,
                    amount: true,
                    frequency: true,
                    client: { select: { firstName: true, lastName: true } },
                },
            });

            if (!loan) {
                return errorResponse('Loan not found', 404);
            }

            const transactions = await prisma.loanTransaction.findMany({
                where: {
                    loanId,
                    isReversed: false,
                    type: { in: PAYMENT_TXN_TYPES as any },
                },
                // Secondary sort on createdAt: a paired advance transaction (single-collection
                // & arrear routes both create it as a follow-up `tx.loanTransaction.create` in
                // the same request, right after the demand/arrear REPAYMENT) shares the exact
                // same transactionDate as its parent, so transactionDate alone leaves their
                // relative order undefined — this keeps "Loan Advance Collection" directly
                // after the "Demand Collection"/"Arrear Collection" row it was paired with.
                orderBy: [{ transactionDate: 'asc' }, { createdAt: 'asc' }],
                select: {
                    id: true,
                    transactionId: true,
                    type: true,
                    collectionType: true,
                    amount: true,
                    principalAmount: true,
                    interestAmount: true,
                    transactionDate: true,
                    status: true,
                    collectedBy: { select: { firstName: true, lastName: true } },
                    lines: {
                        select: {
                            principalAmount: true,
                            interestAmount: true,
                            lineTotal: true,
                            schedule: { select: { installmentNo: true, dueDate: true } },
                        },
                    },
                },
            });

            let cumulativePrincipal = 0;
            const loanAmount = Number(loan.amount);

            const rows = transactions.flatMap((txn) => {
                const status = txn.status as string;
                const collectedByName = txn.collectedBy
                    ? `${txn.collectedBy.firstName} ${txn.collectedBy.lastName}`.trim()
                    : null;
                const typeLabel = transactionTypeLabel(txn.type as string, txn.collectionType);
                const isAdvanceRow = txn.type === 'SAVINGS_COLLECTION' || txn.type === 'SAVINGS_REFUND';

                const advanceLine = (principal: number, dueNo: number | null, dueDate: Date | null, paymentAmount: number) => {
                    // Only PENDING/APPROVED principal actually moves the running loan balance.
                    if (status !== 'REJECTED' && !isAdvanceRow) {
                        cumulativePrincipal += principal;
                    }
                    return {
                        transactionDbId: txn.id,
                        dueNo,
                        dueDate: dueDate ? dueDate.toISOString() : null,
                        transactionDate: txn.transactionDate.toISOString(),
                        transactionType: typeLabel,
                        status,
                        paymentAmount: parseFloat(paymentAmount.toFixed(2)),
                        principal: parseFloat((isAdvanceRow ? 0 : principal).toFixed(2)),
                        interest: 0,
                        advanceAmount: isAdvanceRow ? parseFloat(paymentAmount.toFixed(2)) : null,
                        loanBalance: parseFloat(Math.max(0, loanAmount - cumulativePrincipal).toFixed(2)),
                        collectedByName,
                    };
                };

                if (txn.lines.length > 0) {
                    return txn.lines.map((line) => {
                        const principal = Number(line.principalAmount);
                        const interest = Number(line.interestAmount);
                        const paymentAmount = Number(line.lineTotal);
                        if (status !== 'REJECTED') cumulativePrincipal += principal;
                        return {
                            transactionDbId: txn.id,
                            dueNo: line.schedule?.installmentNo ?? null,
                            dueDate: line.schedule?.dueDate ? line.schedule.dueDate.toISOString() : null,
                            transactionDate: txn.transactionDate.toISOString(),
                            transactionType: typeLabel,
                            status,
                            paymentAmount: parseFloat(paymentAmount.toFixed(2)),
                            principal: parseFloat(principal.toFixed(2)),
                            interest: parseFloat(interest.toFixed(2)),
                            advanceAmount: null,
                            loanBalance: parseFloat(Math.max(0, loanAmount - cumulativePrincipal).toFixed(2)),
                            collectedByName,
                        };
                    });
                }

                // No lines: SAVINGS_COLLECTION / SAVINGS_REFUND (wallet-only), or a legacy
                // PRECLOSURE without lines — use the transaction's own header amounts.
                const principal = Number(txn.principalAmount ?? 0);
                const paymentAmount = Number(txn.amount);
                return [advanceLine(principal, null, null, paymentAmount)];
            });

            const loanDetails = {
                loanNumber: loan.loanNumber,
                clientName: `${loan.client.firstName} ${loan.client.lastName || ''}`.trim(),
                amount: loanAmount,
                frequency: loan.frequency,
            };

            return successResponse({ loanDetails, rows }, 'Payment history fetched');
        } catch (error: any) {
            console.error('Payment history error:', error);
            return errorResponse(error.message || 'Failed to fetch payment history', 500);
        }
    })(request);
}
