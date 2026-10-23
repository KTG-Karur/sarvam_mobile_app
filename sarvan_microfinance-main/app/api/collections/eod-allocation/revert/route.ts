import { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { parseRevertLocation, revertLocationColumns, type RevertLocation } from '@/app/lib/revert-location';
import { assertSameEodDayYmd } from '@/app/lib/revert-eod-guard';
import { parseKolkataAttendanceDateYmd, getKolkataDayEndExclusiveUtc } from '@/app/lib/branch-lock';
import { accountingPostingService } from '@/app/lib/services/accounting-posting.service';
import { buildEodClosureMarker } from '@/app/lib/eod-closure-allocation';
import { unwindForeclosureFinalization } from '@/app/lib/foreclosure-workflow';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * Reverts a Pre-Closure (PRECLOSURE) "Allocate for EOD" posting — the inverse of
 * postEodClosureAllocation. Unlike REPAYMENT, that posting also finalized the loan
 * (schedules -> PAID, principalPaid/interestPaid/penaltiesPaid, isActive:false,
 * closedDate) as part of the same atomic step, using `increment` for
 * interestPaid/penaltiesPaid — so re-running postEodClosureAllocation on a remainder
 * would double those increments. There's no re-post path here because of that: the
 * full allocated bucket must be reverted at once (which is what the UI's "Revert All"
 * button already sends — there's no per-row partial-select UI for this bucket).
 *
 * Un-finalizing a loan un-marks the LoanTransaction's `eodAllocatedAt` only — it does
 * NOT mark it `isReversed` (the foreclosure approval itself is still valid). This
 * naturally makes it reappear as PENDING in Allocate-for-EOD, and as revertable again
 * from Delete Foreclosure.
 */
async function revertPreclosureAllocation(
    tx: Prisma.TransactionClient,
    params: { branchId: string; dateYmd: string; funderId: string | null; reason: string; transactionIds: string[]; userId: string; location: RevertLocation }
): Promise<{ error: string; status: number } | { voucherNos: string[] }> {
    const { branchId, dateYmd, funderId, reason, transactionIds, userId, location } = params;
    const funderKey = funderId ?? 'OWN';
    const marker = buildEodClosureMarker(branchId, dateYmd, funderKey, 'PRECLOSURE');

    const dayStartUtc = parseKolkataAttendanceDateYmd(dateYmd);
    const dayEndExclusiveUtc = getKolkataDayEndExclusiveUtc(dayStartUtc);

    const vouchers = await tx.financialTransaction.findMany({
        where: { description: { contains: marker, mode: 'insensitive' }, isActive: true },
        select: { id: true, voucherNo: true, description: true },
    });
    if (vouchers.length === 0) {
        return { error: 'No active allocation found for this funder/date', status: 404 };
    }

    const candidateTx = await tx.loanTransaction.findMany({
        where: {
            branchId,
            type: 'PRECLOSURE',
            isReversed: false,
            transactionDate: { gte: dayStartUtc, lt: dayEndExclusiveUtc },
            loan: funderId ? { funderId } : { funderId: null },
            eodAllocatedAt: { not: null },
        },
        select: {
            id: true,
            loanId: true,
            principalAmount: true,
            interestAmount: true,
            feesAmount: true,
            penaltyAmount: true,
        },
    });
    const allocatedIds = new Set(candidateTx.map((t) => t.id));
    const notAllocated = transactionIds.filter((id) => !allocatedIds.has(id));
    if (notAllocated.length > 0) {
        return { error: 'Some selected transactions are no longer allocated — refresh and try again', status: 409 };
    }
    if (transactionIds.length !== candidateTx.length) {
        return {
            error: 'Pre-closure allocations must be reverted in full for this funder/date — partial revert isn\'t supported.',
            status: 400,
        };
    }

    for (const t of candidateTx) {
        await unwindForeclosureFinalization(tx, {
            loanId: t.loanId,
            transactionId: t.id,
            principalAmount: Number(t.principalAmount || 0),
            interestAmount: Number(t.interestAmount || 0),
            feesAmount: Number(t.feesAmount || 0),
            penaltyAmount: Number(t.penaltyAmount || 0),
        });

        await tx.loanTransaction.update({
            where: { id: t.id },
            data: { eodAllocatedAt: null },
        });
    }

    // One shared instant for every voucher this action reverts — not a fresh `new Date()` per
    // voucher — so the "Show Reverted Allocations" history view can group by exact revertedAt and
    // tell this one revert action apart from another one on the same funder/date later (see
    // buildRevertedAllocationView in app/api/collections/eod-allocation/route.ts).
    const revertedAt = new Date();
    await Promise.all(
        vouchers.map((v) =>
            tx.financialTransaction.update({
                where: { id: v.id },
                data: {
                    isActive: false,
                    revertedById: userId,
                    revertedAt,
                    revertReason: reason.trim(),
                    ...revertLocationColumns(location),
                    description: `${v.description ?? ''}\n[REVERSED by ${userId}: ${reason.trim()}]`,
                },
            })
        )
    );

    return { voucherNos: vouchers.map((v) => v.voucherNo) };
}

/**
 * Reverts a merged "Allocate for EOD" funder voucher (accounting-posting.service.ts's
 * postEodFunderAllocation) — one voucher pair covering REPAYMENT + PRECLOSURE + WRITEOFF
 * collections together for a funder/date (Gold and Normal loans share the bucket), tagged via
 * `postingMarker` rather than a `description` prefix. Reverting only deactivates the voucher(s)
 * and clears `eodAllocatedAt` on
 * every transaction they covered — it deliberately does NOT touch LoanSchedule/Loan state for any
 * covered PRECLOSURE/WRITEOFF row. Un-finalizing (reopening) a pre-closed/written-off loan stays
 * the job of the separate Delete Foreclosure / Loan Closure Revert pages, which already gate on
 * `eodAllocatedAt` being clear before they'll act.
 *
 * Returns `{ found: false }` when no merged voucher exists for this key (nothing was written),
 * so the caller can fall back to the legacy EOD_COLLECTION / EOD_PRECLOSURE marker paths below —
 * a funder/date can still have those from before the merged flow existed.
 *
 * Full-bucket revert only, same constraint as revertPreclosureAllocation: a partial revert would
 * need to re-post a remainder through postEodFunderAllocation, which would re-run
 * finalizeClosureCoveredLoan on already-finalized loans and double-apply their balance changes.
 * Enforced by always reverting the *complete* currently-allocated set for this key (every
 * REPAYMENT + PRECLOSURE + WRITEOFF transaction the merged voucher covers) regardless of which
 * subset the caller's `transactionIds` names — the UI can only ever send one type-scoped bucket
 * at a time (the FUNDER row sends REPAYMENT ids, the PRECLOSURE row sends PRECLOSURE ids, neither
 * can enumerate all three together), so requiring an exact match against the combined set would
 * make this unreachable. `transactionIds` is used only as a sanity check that the click targets a
 * real, currently-allocated transaction — not as the definition of what gets reverted.
 */
async function revertEodFunderMergedAllocation(
    tx: Prisma.TransactionClient,
    params: { branchId: string; dateYmd: string; funderId: string | null; reason: string; transactionIds: string[]; userId: string; location: RevertLocation }
): Promise<{ found: false } | { found: true; result: { error: string; status: number } | { voucherNos: string[] } }> {
    const { branchId, dateYmd, funderId, reason, transactionIds, userId, location } = params;
    const funderKey = funderId ?? 'OWN';
    const markerBase = `[POSTING:EOD_FUNDER:${branchId}:${dateYmd}:${funderKey}`;

    // New postings use `${markerBase}]` (no Gold/Normal split). A voucher posted the same day
    // before this merge — while Gold and Normal still posted under separate markers — may still
    // carry a trailing `:GOLD]`/`:NORMAL]` segment; match all three forms so it doesn't become
    // silently unrevertable for the rest of that day.
    const vouchers = await tx.financialTransaction.findMany({
        where: { postingMarker: { in: [`${markerBase}]`, `${markerBase}:GOLD]`, `${markerBase}:NORMAL]`] }, isActive: true },
        select: { id: true, voucherNo: true, description: true },
    });
    if (vouchers.length === 0) {
        return { found: false };
    }

    const dayStartUtc = parseKolkataAttendanceDateYmd(dateYmd);
    const dayEndExclusiveUtc = getKolkataDayEndExclusiveUtc(dayStartUtc);

    const allocatedTx = await tx.loanTransaction.findMany({
        where: {
            branchId,
            type: { in: ['REPAYMENT', 'PRECLOSURE', 'WRITEOFF'] },
            transactionDate: { gte: dayStartUtc, lt: dayEndExclusiveUtc },
            loan: funderId ? { funderId } : { funderId: null },
            eodAllocatedAt: { not: null },
        },
        select: { id: true },
    });

    const allocatedIds = new Set(allocatedTx.map((t) => t.id));
    const notAllocated = transactionIds.filter((id) => !allocatedIds.has(id));
    if (notAllocated.length > 0) {
        return { found: true, result: { error: 'Some selected transactions are no longer allocated — refresh and try again', status: 409 } };
    }

    // Always revert the full combined set (every type this voucher covers), not just whatever
    // subset of transactionIds the caller happened to send — see the doc comment above.
    // One shared instant for every voucher this action reverts (see the comment on the same
    // pattern in revertPreclosureAllocation above).
    const revertedAt = new Date();
    await Promise.all(
        vouchers.map((v) =>
            tx.financialTransaction.update({
                where: { id: v.id },
                data: {
                    isActive: false,
                    revertedById: userId,
                    revertedAt,
                    revertReason: reason.trim(),
                    ...revertLocationColumns(location),
                    description: `${v.description ?? ''}\n[REVERSED by ${userId}: ${reason.trim()}]`,
                },
            })
        )
    );
    await tx.loanTransaction.updateMany({
        where: { id: { in: allocatedTx.map((t) => t.id) } },
        data: { eodAllocatedAt: null },
    });

    return { found: true, result: { voucherNos: vouchers.map((v) => v.voucherNo) } };
}

/**
 * POST /api/collections/eod-allocation/revert
 * Undoes a funder's "Allocate for EOD" posting for a given branch/date — the
 * inverse of accounting-posting.service.ts's postEodCollectionAllocation.
 *
 * A funder/date's posting is one aggregate PRINCIPAL + INTEREST voucher pair
 * covering every allocated client — there's no per-client line to undo. So a
 * partial revert (`transactionIds` short of the full allocated set) works by
 * fully un-posting the funder/date (soft-deleting the voucher(s), exactly what
 * every report/daybook/denomination query already filters on — see
 * app/lib/denomination-entry.ts, app/lib/actions/reports.ts) and then
 * immediately re-posting a fresh, accurate voucher pair for whichever clients
 * were NOT selected to be reverted. Passing every currently-allocated id
 * reverts everyone with nothing to re-post — identical to a full revert.
 * Admin-only — this undoes a GL posting, not just a UI state.
 *
 * `closureType: 'PRECLOSURE'` in the body routes to revertPreclosureAllocation
 * above instead — a structurally different posting (bundles loan finalization,
 * always a full-bucket revert, no re-post).
 */
export async function POST(request: NextRequest) {
    return withRole(['ADMIN'], async (req, user) => {
        try {
            const body = await req.json();
            const branchId: string | undefined = body.branchId;
            const dateYmd: string | undefined = body.date;
            const funderId: string | null = body.funderId ?? null;
            const reason: string | undefined = body.reason;
            const transactionIds: string[] | undefined = Array.isArray(body.transactionIds) ? body.transactionIds : undefined;
            const closureType: 'PRECLOSURE' | undefined = body.closureType === 'PRECLOSURE' ? 'PRECLOSURE' : undefined;

            if (!branchId) return errorResponse('Branch context is required', 400);
            if (!dateYmd) return errorResponse('date is required', 400);
            // Location is mandatory for every revert.
            const parsedLocation = parseRevertLocation(body);
            if ('error' in parsedLocation) return errorResponse(parsedLocation.error, 400);
            const location = parsedLocation.location;
            if (!reason || !reason.trim()) return errorResponse('A reason is required to revert an allocation', 400);
            if (!transactionIds || transactionIds.length === 0) {
                return errorResponse('Select at least one client to revert', 400);
            }

            const eodError = await assertSameEodDayYmd(prisma, branchId, dateYmd);
            if (eodError) return errorResponse(eodError, 403);

            // A merged "Allocate for EOD" voucher covers REPAYMENT + PRECLOSURE + WRITEOFF
            // together (see revertEodFunderMergedAllocation below), but the "Revert All
            // Allocations" button on the UI still sends one call per type-scoped bucket (FUNDER,
            // then PRECLOSURE) for what's actually the same underlying voucher. The first call
            // reverts everything; the second would then find nothing left for its own marker and
            // 404. Treat "every requested id is already un-allocated" as a no-op success instead
            // of an error, so a redundant call from the same batch (or a stale double-click)
            // doesn't surface as a partial failure.
            const stillAllocatedCount = await prisma.loanTransaction.count({
                where: { id: { in: transactionIds }, eodAllocatedAt: { not: null } },
            });
            if (stillAllocatedCount === 0) {
                return successResponse(
                    { voucherNos: [], repostVoucherNos: [] },
                    'Already reverted — nothing to do.'
                );
            }

            // A funder/date may have been posted through the merged "Allocate for EOD" voucher
            // (postEodFunderAllocation) instead of the legacy per-type markers below — check that
            // first, regardless of whether this request came in as a plain FUNDER revert or a
            // closureType: 'PRECLOSURE' one, since a merged voucher covers both under one key.
            const mergedCheck = await prisma.$transaction((tx) =>
                revertEodFunderMergedAllocation(tx, { branchId, dateYmd, funderId, reason, transactionIds, userId: user.userId, location })
            );
            if (mergedCheck.found) {
                if ('error' in mergedCheck.result) {
                    return errorResponse(mergedCheck.result.error, mergedCheck.result.status);
                }
                return successResponse(
                    { voucherNos: mergedCheck.result.voucherNos, repostVoucherNos: [] },
                    `Reverted allocation (voucher${mergedCheck.result.voucherNos.length > 1 ? 's' : ''} ${mergedCheck.result.voucherNos.join(', ')})`
                );
            }

            if (closureType === 'PRECLOSURE') {
                const closureResult = await prisma.$transaction((tx) =>
                    revertPreclosureAllocation(tx, { branchId, dateYmd, funderId, reason, transactionIds, userId: user.userId, location })
                );
                if ('error' in closureResult) {
                    return errorResponse(closureResult.error, closureResult.status);
                }
                return successResponse(
                    { voucherNos: closureResult.voucherNos, repostVoucherNos: [] },
                    `Reverted pre-closure allocation (voucher${closureResult.voucherNos.length > 1 ? 's' : ''} ${closureResult.voucherNos.join(', ')})`
                );
            }

            const funderKey = funderId ?? 'OWN';
            // Base marker text with no Gold/Normal suffix — new postings carry
            // `${markerBase}]`, but a voucher posted the same day before this merge may still
            // carry a trailing `:GOLD]`/`:NORMAL]` segment (see accounting-posting.service.ts's
            // buildEodCollectionMarker). Match on the base substring (no closing bracket) so
            // both forms are found instead of the old one becoming silently unrevertable for the
            // rest of that day.
            const markerBase = `[POSTING:EOD_COLLECTION:${branchId}:${dateYmd}:${funderKey}`;

            const dayStartUtc = parseKolkataAttendanceDateYmd(dateYmd);
            const dayEndExclusiveUtc = getKolkataDayEndExclusiveUtc(dayStartUtc);

            const result = await prisma.$transaction(async (tx): Promise<
                { error: string; status: number } | { voucherNos: string[]; repostVoucherNos: string[] }
            > => {
                const vouchers = await tx.financialTransaction.findMany({
                    where: { description: { contains: markerBase, mode: 'insensitive' }, isActive: true },
                    select: { id: true, voucherNo: true, description: true },
                });

                if (vouchers.length === 0) {
                    return { error: 'No active allocation found for this funder/date', status: 404 };
                }

                // Gold and Normal loans for this funder/date share this marker/bucket — no
                // product-type filtering needed here anymore (see buildFunderLabel in gl-config.ts).
                const allocatedTx = await tx.loanTransaction.findMany({
                    where: {
                        branchId,
                        type: 'REPAYMENT',
                        transactionDate: { gte: dayStartUtc, lt: dayEndExclusiveUtc },
                        loan: funderId ? { funderId } : { funderId: null },
                        eodAllocatedAt: { not: null },
                    },
                    select: {
                        id: true,
                        principalAmount: true,
                        interestAmount: true,
                    },
                });

                const allocatedIds = new Set(allocatedTx.map((t) => t.id));
                const notAllocated = transactionIds.filter((id) => !allocatedIds.has(id));
                if (notAllocated.length > 0) {
                    return { error: 'Some selected transactions are no longer allocated — refresh and try again', status: 409 };
                }

                const revertIds = new Set(transactionIds);
                const remainderTx = allocatedTx.filter((t) => !revertIds.has(t.id));

                // Fully un-post the funder/date — every active voucher is deactivated and every
                // allocated transaction is un-tagged, regardless of which subset was requested.
                // One shared instant for every voucher this action reverts (see the comment on
                // the same pattern in revertPreclosureAllocation above).
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
                    const funder = funderId
                        ? await tx.funder.findUnique({ where: { id: funderId }, select: { funderName: true } })
                        : null;
                    const principalAmount = remainderTx.reduce((s, t) => s + Number(t.principalAmount || 0), 0);
                    const interestAmount = remainderTx.reduce((s, t) => s + Number(t.interestAmount || 0), 0);

                    const repost = await accountingPostingService.postEodCollectionAllocation({
                        tx,
                        branchId,
                        workingDateYmd: dateYmd,
                        funderId,
                        funderName: funder?.funderName || 'own fund',
                        principalAmount,
                        interestAmount,
                        transactionDate: dayStartUtc,
                        createdById: user.userId,
                        createdByRole: user.role,
                        transactionIds: remainderTx.map((t) => t.id),
                    });
                    repostVoucherNos = repost.voucherNos;
                }

                return {
                    voucherNos: vouchers.map((v) => v.voucherNo),
                    repostVoucherNos,
                };
            });

            if ('error' in result) {
                return errorResponse(result.error, result.status);
            }

            const revertedMsg = `Reverted allocation (voucher${result.voucherNos.length > 1 ? 's' : ''} ${result.voucherNos.join(', ')})`;
            const repostMsg = result.repostVoucherNos.length > 0
                ? ` — re-posted remaining clients (voucher${result.repostVoucherNos.length > 1 ? 's' : ''} ${result.repostVoucherNos.join(', ')})`
                : '';

            return successResponse(
                { voucherNos: result.voucherNos, repostVoucherNos: result.repostVoucherNos },
                `${revertedMsg}${repostMsg}`
            );
        } catch (error) {
            console.error('[EOD Allocation Revert] POST Error:', error);
            return errorResponse('Failed to revert allocation', 500);
        }
    })(request);
}
