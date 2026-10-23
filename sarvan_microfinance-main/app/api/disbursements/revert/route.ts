import { NextRequest } from 'next/server';
import { z } from 'zod';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { revertLocationFields, revertLocationColumns, toRevertLocationDto } from '@/app/lib/revert-location';
import { assertSameEodDay, assertSameEodDayYmd } from '@/app/lib/revert-eod-guard';
import { parseKolkataAttendanceDateYmd, getKolkataDayEndExclusiveUtc } from '@/app/lib/branch-lock';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';
import { accountingPostingService } from '@/app/lib/services/accounting-posting.service';
import type { JWTPayload } from '@/app/lib/auth';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const RevertSchema = z.object({
    indexId: z.string().min(1, 'Loan Index ID is required'),
    reason: z.string().min(1, 'Reason is required'),
    ...revertLocationFields,
});

const YMD_REGEX = /^\d{4}-\d{2}-\d{2}$/;

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

/** Rejects (rather than silently falling back, unlike resolveScopedBranchIds) a
 *  branchId outside what this admin is permitted to see. */
async function assertBranchAccess(user: JWTPayload, branchId: string): Promise<string | null> {
    const permitted = await getPermittedBranchIds(user);
    if (permitted !== null && !permitted.includes(branchId)) {
        return 'Access denied to this branch';
    }
    return null;
}

/**
 * GET /api/disbursements/revert
 * Admin-only: lists Loan Indexes (bulk disbursement batches) disbursed for a
 * branch on a given working date, for the Disbursement Revert screen
 * (Date -> Branch -> Disbursed Batches). Disbursement always happens per
 * LoanIndex (see bm-disburse/route.ts + postIndexDisbursementAggregate), so
 * revert operates on the whole index, not an individual loan — this lists
 * one row per index, aggregated across its loans. `mode` toggles between the
 * live/revertable list and the revert history for the same branch/date.
 */
export async function GET(request: NextRequest) {
    return withRole(['ADMIN'], async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const branchId = searchParams.get('branchId');
            const date = searchParams.get('date');
            const mode = (searchParams.get('mode') === 'reverted' ? 'reverted' : 'live') as 'live' | 'reverted';

            if (!branchId) return errorResponse('branchId is required', 400);
            if (!date || !YMD_REGEX.test(date)) return errorResponse('date is required (YYYY-MM-DD)', 400);

            const accessError = await assertBranchAccess(user, branchId);
            if (accessError) return errorResponse(accessError, 403);

            const dayStartUtc = parseKolkataAttendanceDateYmd(date);
            const dayEndExclusiveUtc = getKolkataDayEndExclusiveUtc(dayStartUtc);

            const txns = await prisma.loanTransaction.findMany({
                where: {
                    type: 'DISBURSEMENT',
                    branchId,
                    transactionDate: { gte: dayStartUtc, lt: dayEndExclusiveUtc },
                    isReversed: mode === 'reverted',
                },
                include: {
                    loan: {
                        select: {
                            id: true,
                            amount: true,
                            disbursementStatus: true,
                            isActive: true,
                            closureReason: true,
                            principalPaid: true,
                            interestPaid: true,
                            penaltiesPaid: true,
                            savingsPaid: true,
                            indexId: true,
                            loanNumber: true,
                            funder: { select: { funderName: true } },
                            goldTransactions: { select: { type: true } },
                            transactions: {
                                where: { isReversed: false, type: { in: [...NON_DISBURSEMENT_TYPES] } },
                                select: { id: true },
                            },
                        },
                    },
                    revertedBy: { select: { firstName: true, lastName: true, employeeId: true } },
                },
                orderBy: { transactionDate: 'desc' },
            });

            // Group per LoanIndex — disbursement is always posted as one batch per
            // index (postIndexDisbursementAggregate), so revert operates at that
            // granularity too.
            type Group = {
                indexId: string;
                txns: typeof txns;
            };
            const groups = new Map<string, Group>();
            for (const t of txns) {
                const indexId = t.loan.indexId;
                if (!indexId) continue; // defensive — should not happen for a BM-disbursed loan
                if (!groups.has(indexId)) groups.set(indexId, { indexId, txns: [] });
                groups.get(indexId)!.txns.push(t);
            }

            if (groups.size === 0) {
                return successResponse(
                    [],
                    mode === 'reverted'
                        ? 'No reverted disbursements found for this branch/date'
                        : 'No disbursed loan batches found for this branch/date'
                );
            }

            const indexIds = Array.from(groups.keys());
            const indexes = await prisma.loanIndex.findMany({
                where: { id: { in: indexIds } },
                select: {
                    id: true,
                    indexNo: true,
                    branch: { select: { name: true } },
                    center: {
                        select: {
                            name: true,
                            code: true,
                            fdo: { select: { firstName: true, lastName: true, employeeId: true } },
                        },
                    },
                },
            });
            const indexById = new Map(indexes.map((i) => [i.id, i]));

            const eodError = mode === 'live' ? await assertSameEodDayYmd(prisma, branchId, date) : null;

            const rows = indexIds.map((indexId) => {
                const group = groups.get(indexId)!;
                const idx = indexById.get(indexId);
                const funderNames = Array.from(
                    new Set(group.txns.map((t) => t.loan.funder?.funderName ?? 'Own Fund'))
                );
                const totalAmount = group.txns.reduce((sum, t) => sum + Number(t.amount), 0);
                const disbursedAt = group.txns[0].transactionDate.toISOString();

                const base = {
                    indexId,
                    indexNo: idx?.indexNo ?? null,
                    branchName: idx?.branch.name ?? '',
                    centerName: idx?.center.name ?? '',
                    centerCode: idx?.center.code ?? '',
                    fdoName: idx?.center.fdo ? `${idx.center.fdo.firstName} ${idx.center.fdo.lastName}` : null,
                    fdoEmployeeId: idx?.center.fdo?.employeeId ?? null,
                    loanCount: group.txns.length,
                    totalAmount,
                    funderNames,
                    disbursedAt,
                };

                if (mode === 'reverted') {
                    const first = group.txns[0];
                    return {
                        ...base,
                        revertedAt: first.revertedAt ? first.revertedAt.toISOString() : null,
                        revertedByName: first.revertedBy ? `${first.revertedBy.firstName} ${first.revertedBy.lastName}` : null,
                        revertedByEmployeeId: first.revertedBy?.employeeId ?? null,
                        revertReason: first.revertReason ?? null,
                        revertLocation: toRevertLocationDto(first),
                    };
                }

                // Whole index is eligible only if every one of its currently-disbursed
                // loans is untouched — a single loan with downstream activity blocks
                // the entire batch (atomic per-index revert, no partial skipping).
                let ineligibleReason: string | null = null;
                for (const t of group.txns) {
                    const loan = t.loan;
                    if (loan.disbursementStatus !== 'DISBURSED' || !loan.isActive || loan.closureReason) {
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

                return { ...base, eligible: !ineligibleReason, ineligibleReason };
            });

            return successResponse(rows, 'Disbursed loan batches fetched');
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Failed to fetch disbursed loan batches';
            return errorResponse(message, 500);
        }
    })(request);
}

/**
 * POST /api/disbursements/revert
 * Admin-only: undo an entire Loan Index's disbursement — every currently
 * DISBURSED loan under it — back to APPROVED_LEVEL2, as if the BM disbursal
 * never happened. Atomic per index: if any loan in the batch has downstream
 * activity (payments, collections, gold return, etc.), the whole revert is
 * rejected — no partial/per-loan revert. Only safe while EOD hasn't yet moved
 * the branch's working date past the disbursement's own date (see
 * revert-eod-guard.ts; no Admin bypass).
 *
 * Also unwinds the GL vouchers postIndexDisbursementAggregate posted for this
 * index: deactivates every currently-active voucher tagged with this index's
 * [POSTING:INDEX_DISBURSEMENT:...] marker. Since every loan in the index is
 * reverted together, nothing remains to re-post — the aggregate function is
 * still invoked defensively afterward (it's a correct no-op when no loans in
 * the index remain DISBURSED), rather than assumed.
 */
export async function POST(request: NextRequest) {
    return withRole(['ADMIN'], async (req, user) => {
        try {
            const body = await req.json();
            const { indexId, reason, latitude, longitude } = RevertSchema.parse(body);
            const revertLocation = { latitude, longitude };

            await prisma.$transaction(async (tx) => {
                const loanIndex = await tx.loanIndex.findUnique({
                    where: { id: indexId },
                    include: { center: { select: { code: true, name: true } } },
                });
                if (!loanIndex) throw new Error('Loan Index not found');

                const accessError = await assertBranchAccess(user, loanIndex.branchId);
                if (accessError) throw new Error(accessError);

                const loans = await tx.loan.findMany({
                    where: { indexId, disbursementStatus: 'DISBURSED' },
                    include: { goldLoanDetail: true, goldTransactions: true },
                });
                if (loans.length === 0) {
                    throw new Error('No disbursed loans found for this batch — nothing to revert');
                }

                // Validate every loan in the batch before touching any of them —
                // atomic all-or-nothing per index.
                for (const loan of loans) {
                    if (!loan.isActive || loan.closureReason) {
                        throw new Error(`Cannot revert — loan ${loan.loanNumber} is closed, revert the closure first`);
                    }
                    if (
                        Number(loan.principalPaid || 0) > 0 ||
                        Number(loan.interestPaid || 0) > 0 ||
                        Number(loan.penaltiesPaid || 0) > 0 ||
                        Number(loan.savingsPaid || 0) > 0
                    ) {
                        throw new Error(`Cannot revert — loan ${loan.loanNumber} already has payments recorded`);
                    }
                    const blockingTxn = await tx.loanTransaction.findFirst({
                        where: { loanId: loan.id, isReversed: false, type: { in: [...NON_DISBURSEMENT_TYPES] } },
                    });
                    if (blockingTxn) {
                        throw new Error(`Cannot revert — loan ${loan.loanNumber} already has downstream transaction activity`);
                    }
                    if (loan.goldTransactions.some((g) => g.type !== 'TAKE')) {
                        throw new Error(`Cannot revert — loan ${loan.loanNumber} already has a gold return recorded`);
                    }
                }

                const dsbTxns = await tx.loanTransaction.findMany({
                    where: { loanId: { in: loans.map((l) => l.id) }, type: 'DISBURSEMENT', isReversed: false },
                });
                // A double-submitted final disbursement can leave more than one
                // un-reversed DISBURSEMENT row per loan; all of them are reversed
                // below, so only require at least one per loan.
                const loanIdsWithDsb = new Set(dsbTxns.map((t) => t.loanId));
                if (loans.some((l) => !loanIdsWithDsb.has(l.id))) {
                    throw new Error('No un-reversed disbursement transaction found for one or more loans in this batch');
                }

                const eodError = await assertSameEodDay(tx, loanIndex.branchId, dsbTxns[0].transactionDate);
                if (eodError) throw new Error(eodError);

                console.log(
                    `[DisbursementRevert] indexId=${indexId} loanCount=${loans.length} revertedBy=${user.userId} reason=${reason}`
                );

                for (const loan of loans) {
                    await tx.loanSchedule.deleteMany({ where: { loanId: loan.id } });

                    if (loan.goldLoanDetail) {
                        await tx.goldTransaction.deleteMany({ where: { loanId: loan.id } });
                        await tx.goldLoanDetail.delete({ where: { loanId: loan.id } });
                        // GoldLoanDetailPhoto rows (loanId-keyed, uploaded before this
                        // GoldLoanDetail ever existed) are deliberately NOT deleted here —
                        // the pledge photos remain true evidence of what was pledged, and
                        // if this loan is re-disbursed, the photo gate is already satisfied.
                    }

                    const feeTxns = await tx.loanTransaction.findMany({
                        where: { loanId: loan.id, type: 'FEE', isReversed: false },
                    });
                    for (const feeTxn of feeTxns) {
                        await tx.loanTransaction.update({
                            where: { id: feeTxn.id },
                            data: {
                                isReversed: true,
                                revertedAt: new Date(),
                                revertedById: user.userId,
                                revertReason: reason,
                                ...revertLocationColumns(revertLocation),
                                remarks: feeTxn.remarks ? `${feeTxn.remarks}\n[REVERSED: ${reason}]` : `[REVERSED: ${reason}]`,
                            },
                        });
                    }

                    for (const dsbTxn of dsbTxns.filter((t) => t.loanId === loan.id)) {
                        await tx.loanTransaction.update({
                            where: { id: dsbTxn.id },
                            data: {
                                isReversed: true,
                                revertedAt: new Date(),
                                revertedById: user.userId,
                                revertReason: reason,
                                ...revertLocationColumns(revertLocation),
                                remarks: dsbTxn.remarks ? `${dsbTxn.remarks}\n[REVERSED: ${reason}]` : `[REVERSED: ${reason}]`,
                            },
                        });
                    }

                    await tx.loan.update({
                        where: { id: loan.id },
                        data: {
                            disbursementStatus: 'APPROVED_LEVEL2',
                            disbursedByBMId: null,
                            disbursedByBMAt: null,
                            attendanceStatus: null,
                            // firstDueDate is NOT cleared — it's set earlier, at Loan
                            // Indexation, and bm-disburse only reads/validates it
                            // (`if (!loan.firstDueDate) throw ...`), never creates it.
                            // Nulling it here would strand the loan: it could never be
                            // re-disbursed without a manual trip back to the Loan Index
                            // page to re-set a value that was never actually removed by
                            // final disbursement in the first place.
                            funderId: null,
                            lastPaymentDate: null,
                            principalPaid: 0,
                            interestPaid: 0,
                            penaltiesPaid: 0,
                        },
                    });
                }

                const marker = `[POSTING:INDEX_DISBURSEMENT:${indexId}]`;
                const vouchers = await tx.financialTransaction.findMany({
                    where: { postingMarker: marker, isActive: true },
                });
                for (const v of vouchers) {
                    await tx.financialTransaction.update({
                        where: { id: v.id },
                        data: {
                            isActive: false,
                            revertedById: user.userId,
                            revertedAt: new Date(),
                            revertReason: reason,
                            ...revertLocationColumns(revertLocation),
                            description: `${v.description ?? ''}\n[REVERSED by ${user.userId}: ${reason}]`,
                        },
                    });
                }

                // Defensive no-op: every loan in the index was just reverted above, so
                // this will find zero DISBURSED loans and post nothing. Kept for
                // correctness if that invariant is ever not fully true.
                await accountingPostingService.postIndexDisbursementAggregate({
                    tx,
                    indexId,
                    branchId: loanIndex.branchId,
                    centerCode: loanIndex.center.code || '',
                    centerName: loanIndex.center.name || loanIndex.center.code || 'Unknown Center',
                    createdById: user.userId,
                    createdByRole: user.role,
                    transactionDate: dsbTxns[0].transactionDate,
                });
            }, { maxWait: 30000, timeout: 60000 });

            return successResponse(null, 'Disbursement batch reverted successfully');
        } catch (error: unknown) {
            if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
            const message = error instanceof Error ? error.message : 'Failed to revert disbursement batch';
            return errorResponse(message, 500);
        }
    })(request);
}
