import { NextRequest } from 'next/server';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { parseRevertLocation, revertLocationColumns } from '@/app/lib/revert-location';
import { assertSameEodDayYmd } from '@/app/lib/revert-eod-guard';
import { parseKolkataAttendanceDateYmd, getKolkataDayEndExclusiveUtc } from '@/app/lib/branch-lock';
import { accountingPostingService } from '@/app/lib/services/accounting-posting.service';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * POST /api/collections/eod-allocation/loan-advance/revert
 * Undoes the branch/date's "Loan Advance" posting — the inverse of
 * accounting-posting.service.ts's postEodLoanAdvanceAllocation. Mirrors
 * app/api/collections/eod-allocation/revert/route.ts but for the standalone, non-funder-scoped
 * Loan Advance bucket: a partial revert (`transactionIds` short of the full allocated set) fully
 * un-posts the date's voucher(s) and immediately re-posts a fresh one for whichever clients
 * were NOT selected to be reverted. Admin-only — this undoes a GL posting, not just a UI state.
 */
export async function POST(request: NextRequest) {
    return withRole(['ADMIN'], async (req, user) => {
        try {
            const body = await req.json();
            const branchId: string | undefined = body.branchId;
            const dateYmd: string | undefined = body.date;
            const reason: string | undefined = body.reason;
            const transactionIds: string[] | undefined = Array.isArray(body.transactionIds) ? body.transactionIds : undefined;

            if (!branchId) return errorResponse('Branch context is required', 400);
            if (!dateYmd) return errorResponse('date is required', 400);
            if (!reason || !reason.trim()) return errorResponse('A reason is required to revert an allocation', 400);
            // Location is mandatory for every revert.
            const parsedLocation = parseRevertLocation(body);
            if ('error' in parsedLocation) return errorResponse(parsedLocation.error, 400);
            const location = parsedLocation.location;
            if (!transactionIds || transactionIds.length === 0) {
                return errorResponse('Select at least one client to revert', 400);
            }

            const eodError = await assertSameEodDayYmd(prisma, branchId, dateYmd);
            if (eodError) return errorResponse(eodError, 403);

            const marker = `[POSTING:EOD_LOAN_ADVANCE:${branchId}:${dateYmd}]`;

            const dayStartUtc = parseKolkataAttendanceDateYmd(dateYmd);
            const dayEndExclusiveUtc = getKolkataDayEndExclusiveUtc(dayStartUtc);

            const result = await prisma.$transaction(async (tx): Promise<
                { error: string; status: number } | { voucherNos: string[]; repostVoucherNos: string[] }
            > => {
                const vouchers = await tx.financialTransaction.findMany({
                    where: { description: { contains: marker, mode: 'insensitive' }, isActive: true },
                    select: { id: true, voucherNo: true, description: true },
                });

                if (vouchers.length === 0) {
                    return { error: 'No active Loan Advance allocation found for this date', status: 404 };
                }

                const allocatedTx = await tx.loanTransaction.findMany({
                    where: {
                        branchId,
                        type: 'SAVINGS_COLLECTION' as never,
                        transactionDate: { gte: dayStartUtc, lt: dayEndExclusiveUtc },
                        eodAllocatedAt: { not: null },
                    },
                    select: { id: true, amount: true },
                });

                const allocatedIds = new Set(allocatedTx.map((t) => t.id));
                const notAllocated = transactionIds.filter((id) => !allocatedIds.has(id));
                if (notAllocated.length > 0) {
                    return { error: 'Some selected transactions are no longer allocated — refresh and try again', status: 409 };
                }

                const revertIds = new Set(transactionIds);
                const remainderTx = allocatedTx.filter((t) => !revertIds.has(t.id));

                // One shared instant for every voucher this action reverts — not a fresh `new
                // Date()` per voucher — so the reverted-history view can group by exact revertedAt
                // and tell this revert action apart from another one later the same day.
                const revertedAt = new Date();
                await Promise.all(
                    vouchers.map((v) =>
                        tx.financialTransaction.update({
                            where: { id: v.id },
                            data: {
                                isActive: false,
                                revertedById: user.userId,
                                revertedAt,
                                revertReason: reason.trim(),
                                ...revertLocationColumns(location),
                                description: `${v.description ?? ''}\n[REVERSED by ${user.userId}: ${reason.trim()}]`,
                            },
                        })
                    )
                );
                await tx.loanTransaction.updateMany({
                    where: { id: { in: allocatedTx.map((t) => t.id) } },
                    data: { eodAllocatedAt: null },
                });

                let repostVoucherNos: string[] = [];
                if (remainderTx.length > 0) {
                    const loanAdvanceAmount = remainderTx.reduce((s, t) => s + Number(t.amount || 0), 0);
                    const repost = await accountingPostingService.postEodLoanAdvanceAllocation({
                        tx,
                        branchId,
                        workingDateYmd: dateYmd,
                        loanAdvanceAmount,
                        transactionDate: dayStartUtc,
                        createdById: user.userId,
                        createdByRole: user.role,
                        transactionIds: remainderTx.map((t) => t.id),
                    });
                    if (repost.voucherNo) repostVoucherNos = [repost.voucherNo];
                }

                return {
                    voucherNos: vouchers.map((v) => v.voucherNo),
                    repostVoucherNos,
                };
            });

            if ('error' in result) {
                return errorResponse(result.error, result.status);
            }

            const revertedMsg = `Reverted Loan Advance allocation (voucher${result.voucherNos.length > 1 ? 's' : ''} ${result.voucherNos.join(', ')})`;
            const repostMsg = result.repostVoucherNos.length > 0
                ? ` — re-posted remaining clients (voucher${result.repostVoucherNos.length > 1 ? 's' : ''} ${result.repostVoucherNos.join(', ')})`
                : '';

            return successResponse(
                { voucherNos: result.voucherNos, repostVoucherNos: result.repostVoucherNos },
                `${revertedMsg}${repostMsg}`
            );
        } catch (error) {
            console.error('[EOD Loan Advance Revert] POST Error:', error);
            return errorResponse('Failed to revert Loan Advance allocation', 500);
        }
    })(request);
}
