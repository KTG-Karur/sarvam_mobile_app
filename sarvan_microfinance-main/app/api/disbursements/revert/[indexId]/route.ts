import { NextRequest } from 'next/server';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { assertSameEodDayYmd } from '@/app/lib/revert-eod-guard';
import { getKolkataCalendarYmd } from '@/app/lib/branch-lock';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';
import { SYSTEM_LEDGERS } from '@/app/lib/constants/ledgers';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const NON_DISBURSEMENT_TYPES = [
    'REPAYMENT',
    'PRECLOSURE',
    'ADJUSTMENT',
    'INTEREST_POSTING',
    'PENALTY',
    'SAVINGS_COLLECTION',
    'SAVINGS_REFUND',
    'WRITEOFF',
] as const;

/**
 * GET /api/disbursements/revert/[indexId]
 * Admin-only: full disbursement detail for the Disbursement Revert detail
 * modal — every loan disbursed under this Loan Index, aggregated fees, and
 * the index's active GL vouchers, so an admin can verify exactly what a
 * whole-batch revert will touch before confirming.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ indexId: string }> }) {
    return withRole(['ADMIN'], async (_req, user) => {
        try {
            const { indexId } = await context.params;

            const loanIndex = await prisma.loanIndex.findUnique({
                where: { id: indexId },
                include: {
                    branch: { select: { name: true, code: true } },
                    center: {
                        select: {
                            name: true,
                            code: true,
                            fdo: { select: { firstName: true, lastName: true, employeeId: true } },
                        },
                    },
                },
            });
            if (!loanIndex) return errorResponse('Loan Index not found', 404);

            const permitted = await getPermittedBranchIds(user);
            if (permitted !== null && !permitted.includes(loanIndex.branchId)) {
                return errorResponse('Access denied to this branch', 403);
            }

            const loans = await prisma.loan.findMany({
                where: { indexId, disbursementStatus: 'DISBURSED' },
                include: {
                    client: {
                        select: {
                            clientId: true,
                            firstName: true,
                            lastName: true,
                            groupMemberships: { select: { group: { select: { name: true } } }, take: 1 },
                        },
                    },
                    funder: { select: { funderName: true } },
                    goldTransactions: { select: { type: true } },
                    transactions: {
                        where: { isReversed: false, type: { in: [...NON_DISBURSEMENT_TYPES] } },
                        select: { id: true },
                    },
                },
            });

            if (loans.length === 0) {
                return errorResponse('No disbursed loans found for this batch', 404);
            }

            const loanIds = loans.map((l) => l.id);
            const dsbTxns = await prisma.loanTransaction.findMany({
                where: { loanId: { in: loanIds }, type: 'DISBURSEMENT' },
            });
            const feeTxns = await prisma.loanTransaction.findMany({
                where: { loanId: { in: loanIds }, type: 'FEE' },
            });
            const feeAmount = (description: string) =>
                feeTxns
                    .filter((t) => t.description === description && !t.isReversed)
                    .reduce((sum, t) => sum + Number(t.amount || 0), 0);

            const fees = {
                admissionFee: feeAmount('Client Admission Fee'),
                processingFee: feeAmount(SYSTEM_LEDGERS.DOC_CHARGES.name),
                insuranceFee: feeAmount(SYSTEM_LEDGERS.INSURANCE_PAYABLE.name),
            };

            const marker = `[POSTING:INDEX_DISBURSEMENT:${indexId}]`;
            const vouchers = await prisma.financialTransaction.findMany({
                where: { postingMarker: marker, isActive: true },
                select: { voucherNo: true, type: true, amount: true, description: true },
                orderBy: { voucherNo: 'asc' },
            });

            const disbursedAt = dsbTxns[0]?.transactionDate ?? null;
            const eodError = disbursedAt
                ? await assertSameEodDayYmd(prisma, loanIndex.branchId, getKolkataCalendarYmd(disbursedAt))
                : null;

            let ineligibleReason: string | null = null;
            for (const loan of loans) {
                if (!loan.isActive || loan.closureReason) {
                    ineligibleReason = `Loan ${loan.loanNumber} is no longer disbursed or has been closed`;
                    break;
                }
                const hasPayments =
                    Number(loan.principalPaid || 0) > 0 ||
                    Number(loan.interestPaid || 0) > 0 ||
                    Number(loan.penaltiesPaid || 0) > 0 ||
                    Number(loan.savingsPaid || 0) > 0;
                if (hasPayments) {
                    ineligibleReason = `Loan ${loan.loanNumber} already has payments recorded`;
                    break;
                }
                if (loan.goldTransactions.some((g) => g.type !== 'TAKE')) {
                    ineligibleReason = `Loan ${loan.loanNumber} already has a gold return recorded`;
                    break;
                }
                if (loan.transactions.length > 0) {
                    ineligibleReason = `Loan ${loan.loanNumber} already has downstream transaction activity`;
                    break;
                }
            }
            if (!ineligibleReason && eodError) ineligibleReason = eodError;

            return successResponse({
                indexId,
                indexNo: loanIndex.indexNo,
                indexDate: loanIndex.indexDate.toISOString(),
                branchName: loanIndex.branch.name,
                branchCode: loanIndex.branch.code,
                centerName: loanIndex.center.name,
                centerCode: loanIndex.center.code,
                fdoName: loanIndex.center.fdo ? `${loanIndex.center.fdo.firstName} ${loanIndex.center.fdo.lastName}` : null,
                fdoEmployeeId: loanIndex.center.fdo?.employeeId ?? null,
                disbursedAt: disbursedAt ? disbursedAt.toISOString() : null,
                loans: loans.map((l) => ({
                    loanId: l.id,
                    loanNumber: l.loanNumber,
                    clientCode: l.client.clientId,
                    clientName: `${l.client.firstName} ${l.client.lastName}`,
                    groupName: l.client.groupMemberships[0]?.group.name ?? null,
                    amount: Number(l.amount),
                    funderName: l.funder?.funderName ?? null,
                })),
                totalAmount: loans.reduce((sum, l) => sum + Number(l.amount), 0),
                fees,
                activeVouchers: vouchers.map((v) => ({
                    voucherNo: v.voucherNo,
                    type: v.type,
                    amount: Number(v.amount),
                    description: v.description,
                })),
                eligible: !ineligibleReason,
                ineligibleReason,
            }, 'Disbursement batch detail fetched');
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Failed to fetch disbursement batch detail';
            return errorResponse(message, 500);
        }
    })(request);
}
