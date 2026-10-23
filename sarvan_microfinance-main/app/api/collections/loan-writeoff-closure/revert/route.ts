import { NextRequest } from 'next/server';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/db';
import { revertLocationFields, revertLocationColumns, toRevertLocationDto } from '@/app/lib/revert-location';
import { recomputeScheduleStatus } from '@/app/lib/loan-closure-revert';
import { assertSameEodDay, assertNotEodAllocated } from '@/app/lib/revert-eod-guard';
import { unwindForeclosureFinalization } from '@/app/lib/foreclosure-workflow';
import { bumpLoanBalance } from '@/app/lib/cache/loan-balance-cache';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const RevertSchema = z.object({
    loanId: z.string().min(1, 'Loan ID is required'),
    reason: z.string().min(1, 'Reason is required'),
    ...revertLocationFields,
});

/**
 * GET /api/collections/loan-writeoff-closure/revert
 * Admin-only: find closed (write-off/death) loans for a member, for the Loan
 * Closure Revert screen. Same three search modes as the closure search.
 */
export async function GET(request: NextRequest) {
    return withRole(['ADMIN'], async (req) => {
        try {
            const { searchParams } = new URL(req.url);
            const searchType = searchParams.get('searchType') as 'memberId' | 'phone' | 'aadhaar' | null;
            const searchValue = searchParams.get('searchValue')?.trim() ?? '';
            const statusParam = searchParams.get('status');

            if (!searchType || !['memberId', 'phone', 'aadhaar'].includes(searchType)) {
                return errorResponse('searchType must be one of: memberId, phone, aadhaar', 400);
            }
            if (!searchValue) return errorResponse('searchValue is required', 400);

            let clientWhere: Prisma.ClientWhereInput;
            if (searchType === 'memberId') {
                clientWhere = { clientId: { contains: searchValue, mode: 'insensitive' } };
            } else if (searchType === 'phone') {
                clientWhere = {
                    OR: [
                        { mobileNumber: { contains: searchValue, mode: 'insensitive' } },
                        { phone: { contains: searchValue, mode: 'insensitive' } },
                    ],
                };
            } else {
                const normalized = searchValue.replace(/\D/g, '');
                clientWhere = { otherIdNo: { contains: normalized, mode: 'insensitive' } };
            }

            if (statusParam === 'reverted') {
                // A reverted closure's disbursementStatus is reset away from CLOSED
                // (see POST below), so it structurally disappears from the live
                // query below — query LoanClosureRecord directly instead, which
                // now carries its own revertedBy/revertedAt/revertReason.
                const records = await prisma.loanClosureRecord.findMany({
                    where: {
                        isReversed: true,
                        client: clientWhere,
                    },
                    include: {
                        client: { select: { clientId: true, firstName: true, lastName: true, mobileNumber: true } },
                        loan: { select: { loanNumber: true } },
                        revertedBy: { select: { firstName: true, lastName: true, employeeId: true } },
                    },
                    orderBy: { revertedAt: 'desc' },
                });

                const revertedRows = records.map((r) => ({
                    loanId: r.loanId,
                    loanNumber: r.loan.loanNumber,
                    clientCode: r.client.clientId,
                    memberName: `${r.client.firstName} ${r.client.lastName}`,
                    memberPhone: r.client.mobileNumber ?? null,
                    closureReason: r.reason,
                    closedDate: r.closeDate.toISOString(),
                    remarks: r.remarks,
                    revertedAt: r.revertedAt ? r.revertedAt.toISOString() : null,
                    revertedByName: r.revertedBy ? `${r.revertedBy.firstName} ${r.revertedBy.lastName}` : null,
                    revertedByEmployeeId: r.revertedBy?.employeeId ?? null,
                    revertReason: r.revertReason ?? null,
                    revertLocation: toRevertLocationDto(r),
                }));

                return successResponse(revertedRows, revertedRows.length === 0 ? 'No reverted closures found matching the search criteria' : 'Reverted closures fetched');
            }

            const loans = await prisma.loan.findMany({
                where: {
                    client: clientWhere,
                    disbursementStatus: 'CLOSED',
                    closureReason: { not: null },
                },
                include: {
                    client: { select: { clientId: true, firstName: true, lastName: true, mobileNumber: true } },
                    loanClosureRecord: { where: { isReversed: false } },
                    transactions: {
                        where: { type: 'WRITEOFF', isReversed: false },
                        orderBy: { transactionDate: 'desc' },
                        take: 1,
                        select: { eodAllocatedAt: true },
                    },
                },
                orderBy: { closedDate: 'desc' },
            });

            const rows = await Promise.all(
                loans.map(async (loan) => {
                    const eodError = loan.closedDate
                        ? await assertSameEodDay(prisma, loan.branchId, loan.closedDate)
                        : null;
                    // Same rule the POST revert enforces — can't revert while the closure's GL
                    // voucher is still active (see assertNotEodAllocated).
                    const isAllocated = loan.transactions[0]?.eodAllocatedAt != null;
                    return {
                        loanId: loan.id,
                        loanNumber: loan.loanNumber,
                        clientCode: loan.client.clientId,
                        memberName: `${loan.client.firstName} ${loan.client.lastName}`,
                        memberPhone: loan.client.mobileNumber ?? null,
                        closureReason: loan.closureReason,
                        closedDate: loan.closedDate?.toISOString() ?? null,
                        remarks: loan.loanClosureRecord[0]?.remarks ?? null,
                        eligible: !eodError && !isAllocated,
                        // Surfaced separately so the UI can tell the two independent guards
                        // apart instead of collapsing both into one "EOD already processed"
                        // message — see assertSameEodDay vs assertNotEodAllocated above.
                        eodLocked: !!eodError,
                        allocationLocked: isAllocated,
                    };
                })
            );

            return successResponse(rows, rows.length === 0 ? 'No closed loans found matching the search criteria' : 'Closed loans fetched');
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Failed to search closed loans';
            return errorResponse(message, 500);
        }
    })(request);
}

/**
 * POST /api/collections/loan-writeoff-closure/revert
 * Admin-only: undo a write-off / death closure recorded in error.
 *
 * - Reverses the WRITEOFF LoanTransaction (isReversed convention, row kept for audit).
 * - Restores the Loan's active/open state and clears the closure fields.
 * - Recomputes (not "restores") every currently-CLOSED schedule's status from its
 *   own paid/due amounts, which the closure never touched — see loan-closure-revert.ts.
 * - Soft-deletes the LoanClosureRecord (isReversed: true) instead of hard-deleting it,
 *   so the "Loan Closure Revert" history toggle can show who reverted it and why.
 *   loanId is no longer unique on this model for that reason — re-closing the same
 *   loan after a revert creates a new row rather than colliding with the old one.
 */
export async function POST(request: NextRequest) {
    return withRole(['ADMIN'], async (req, user) => {
        try {
            const body = await req.json();
            const { loanId, reason, latitude, longitude } = RevertSchema.parse(body);
            const revertLocation = { latitude, longitude };

            await prisma.$transaction(async (tx) => {
                const loan = await tx.loan.findUnique({
                    where: { id: loanId },
                    select: {
                        id: true,
                        branchId: true,
                        disbursementStatus: true,
                        closureReason: true,
                        isActive: true,
                    },
                });
                if (!loan) throw new Error('Loan not found');
                if (loan.disbursementStatus !== 'CLOSED' || !loan.closureReason) {
                    throw new Error('Loan is not in a closed state — nothing to revert');
                }

                const closureRecord = await tx.loanClosureRecord.findFirst({ where: { loanId, isReversed: false } });
                if (!closureRecord) throw new Error('No closure record found for this loan');

                const writeoffTxn = await tx.loanTransaction.findFirst({
                    where: { loanId, type: 'WRITEOFF', isReversed: false },
                    orderBy: { transactionDate: 'desc' },
                });
                if (!writeoffTxn) throw new Error('No un-reversed write-off transaction found for this loan');

                // The loan closes immediately at creation now (see finalizeClosureCoveredLoan),
                // independent of when its GL voucher gets posted via "Allocate for EOD" — so this
                // transaction can still have an active voucher (eodAllocatedAt set) at revert time.
                // Reverting the closure here would leave that voucher orphaned. Block it — same
                // rule Delete Foreclosure and Collection Revert already enforce: undo the
                // Allocation first.
                const allocatedError = assertNotEodAllocated(writeoffTxn.eodAllocatedAt);
                if (allocatedError) throw new Error(allocatedError);

                // Guard: block if any other un-reversed transaction was recorded after
                // the closure — closure is meant to be terminal, so anything later
                // means the loan state has moved on and a blind revert would desync it.
                const laterActivity = await tx.loanTransaction.findFirst({
                    where: {
                        loanId,
                        id: { not: writeoffTxn.id },
                        isReversed: false,
                        transactionDate: { gt: writeoffTxn.transactionDate },
                    },
                });
                if (laterActivity) {
                    throw new Error('Cannot revert — a later transaction exists on this loan since closure');
                }

                const eodError = await assertSameEodDay(tx, loan.branchId, writeoffTxn.transactionDate);
                if (eodError) throw new Error(eodError);

                const wasDeathReason = closureRecord.reason === 'DEAD';

                console.log(
                    `[LoanClosureRevert] loanId=${loanId} closureRecordId=${closureRecord.id} reason(original)=${closureRecord.reason} ` +
                    `paidPrincipal=${closureRecord.paidPrincipal} paidInterest=${closureRecord.paidInterest} ` +
                    `principalWaiver=${closureRecord.principalWaiver} interestWaiver=${closureRecord.interestWaiver} ` +
                    `revertedBy=${user.userId} revertReason=${reason}`
                );

                await tx.loan.update({
                    where: { id: loanId },
                    data: {
                        disbursementStatus: 'DISBURSED',
                        isActive: true,
                        closureReason: null,
                        closedDate: null,
                        ...(wasDeathReason ? { isDead: false, deathMarkedDate: null } : {}),
                    },
                });

                if (closureRecord.reason === 'DEAD' || closureRecord.reason === 'OTHERS') {
                    // DEAD/OTHERS forward-closes by fully paying schedules off (see
                    // finalizeClosureCoveredLoan) — those schedules are now 'PAID', not
                    // 'CLOSED', so the WRITEOFF-only status-recompute loop below wouldn't
                    // even find them. Reverse the money using the same LIFO unwind Pre-Closure
                    // revert uses; the pool is reconstructed from the closure record's own
                    // stored fields (paid + waiver == what was applied to schedules for
                    // principal/interest, penaltyPaid == what was applied for penalty).
                    await unwindForeclosureFinalization(tx, {
                        loanId,
                        transactionId: writeoffTxn.id,
                        principalAmount: Number(closureRecord.paidPrincipal) + Number(closureRecord.principalWaiver),
                        interestAmount: Number(closureRecord.paidInterest) + Number(closureRecord.interestWaiver),
                        feesAmount: 0,
                        penaltyAmount: Number(closureRecord.penaltyPaid),
                    });
                } else {
                    const closedSchedules = await tx.loanSchedule.findMany({
                        where: { loanId, status: 'CLOSED' },
                    });
                    for (const schedule of closedSchedules) {
                        const newStatus = recomputeScheduleStatus(
                            Number(schedule.totalPaid || 0),
                            Number(schedule.totalDue)
                        );
                        await tx.loanSchedule.update({
                            where: { id: schedule.id },
                            data: { status: newStatus },
                        });
                    }
                }

                await tx.loanTransaction.update({
                    where: { id: writeoffTxn.id },
                    data: {
                        isReversed: true,
                        revertedAt: new Date(),
                        revertedById: user.userId,
                        revertReason: reason,
                        ...revertLocationColumns(revertLocation),
                        remarks: writeoffTxn.remarks
                            ? `${writeoffTxn.remarks}\n[REVERSED: ${reason}]`
                            : `[REVERSED: ${reason}]`,
                    },
                });

                await tx.loanClosureRecord.update({
                    where: { id: closureRecord.id },
                    data: {
                        isReversed: true,
                        revertedAt: new Date(),
                        revertedById: user.userId,
                        revertReason: reason,
                        ...revertLocationColumns(revertLocation),
                    },
                });
            });

            await bumpLoanBalance(loanId);

            return successResponse(null, 'Loan closure reverted successfully');
        } catch (error: unknown) {
            if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
            const message = error instanceof Error ? error.message : 'Failed to revert loan closure';
            return errorResponse(message, 500);
        }
    })(request);
}
