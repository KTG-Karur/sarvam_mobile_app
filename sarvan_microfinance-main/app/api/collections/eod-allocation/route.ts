import { NextRequest } from 'next/server';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
} from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { toRevertLocationDto } from '@/app/lib/revert-location';
import {
    assertBranchNotLocked,
    parseKolkataAttendanceDateYmd,
    getKolkataDayEndExclusiveUtc,
} from '@/app/lib/branch-lock';
import { accountingPostingService, ClosureAllocationConflictError } from '@/app/lib/services/accounting-posting.service';
import { pendingClosureAllocationWhere, type ClosureType } from '@/app/lib/eod-closure-allocation';
import { determineWorkbenchMode, type WorkbenchMode } from '@/app/lib/collections/workbench-mode';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';

/** Rejects a branchId the caller isn't permitted to see (ADMIN/HO users are unrestricted). */
async function assertBranchPermitted(user: Parameters<typeof getPermittedBranchIds>[0], branchId: string) {
    const permitted = await getPermittedBranchIds(user);
    if (permitted !== null && !permitted.includes(branchId)) {
        return errorResponse('You do not have access to that branch', 403);
    }
    return null;
}

export async function OPTIONS() {
    return handleCorsPreflight();
}

type RevertedAllocationRow = {
    funderId: string | null;
    funderName: string;
    voucherNos: string[];
    principalAmount: number;
    interestAmount: number;
    totalAmount: number;
    revertedByName: string | null;
    revertedByEmployeeId: string | null;
    revertedAt: string | null;
    revertReason: string | null;
    revertLocation: { latitude: number; longitude: number } | null;
};

type RevertedLoanAdvanceRow = {
    voucherNos: string[];
    amount: number;
    revertedByName: string | null;
    revertedByEmployeeId: string | null;
    revertedAt: string | null;
    revertReason: string | null;
    revertLocation: { latitude: number; longitude: number } | null;
};

/**
 * "Show Reverted History" view for the Allocation Revert page — every
 * FinancialTransaction voucher reverted (isActive:false, revertedAt set) for
 * this branch/date, grouped back by funder using the same
 * `[POSTING:EOD_COLLECTION:...]` marker the live PENDING/ALLOCATED view scans
 * (see the marker-matching logic below GET). Additive to that view — it only
 * ever reads isActive:false rows, which the live view already excludes.
 * Loan Advance reverts are unrelated to any funder (see
 * buildRevertedLoanAdvanceView) and are returned separately.
 *
 * Grouped by funder+gold-flag *and* the exact `revertedAt` instant — not just
 * funder+gold-flag — so two separate revert actions on the same funder (e.g. one
 * reverted this morning, a fresh allocation posted and reverted again this
 * afternoon) show as two distinct rows with their own date/time, instead of
 * being silently merged into one row that only shows the most recent one. The
 * revert routes (app/api/collections/eod-allocation/revert/route.ts) stamp every
 * voucher from the same revert action with one shared `revertedAt` value (not a
 * fresh `new Date()` per voucher), so an exact-match group reliably captures
 * "everything reverted together in one action" without over- or under-grouping.
 */
async function buildRevertedAllocationView(branchId: string, dateYmd: string): Promise<{ rows: RevertedAllocationRow[] }> {
    const markerBase = `[POSTING:EOD_COLLECTION:${branchId}:${dateYmd}:`;
    const vouchers = await prisma.financialTransaction.findMany({
        where: {
            branchId,
            description: { contains: markerBase, mode: 'insensitive' },
            isActive: false,
            revertedAt: { not: null },
        },
        select: {
            voucherNo: true,
            amount: true,
            description: true,
            revertedAt: true,
            revertReason: true,
            revertLatitude: true,
            revertLongitude: true,
            revertedBy: { select: { firstName: true, lastName: true, employeeId: true } },
        },
        orderBy: { revertedAt: 'desc' },
    });

    const groups = new Map<string, RevertedAllocationRow>();
    for (const v of vouchers) {
        const match = v.description?.match(/\[POSTING:EOD_COLLECTION:[^:]+:[^:]+:([^\]]+)\]/);
        if (!match) continue;

        // Markers posted before Gold/Normal was merged back into one funder bucket may still end
        // in `:GOLD` or `:NORMAL` (see postEodCollectionAllocation's history) — strip that off the
        // funder segment so old and new markers for the same funder group together rather than
        // showing the raw (unsplit) marker text as the funder name.
        const rawKey = match[1];
        const lastColon = rawKey.lastIndexOf(':');
        const suffix = lastColon !== -1 ? rawKey.slice(lastColon + 1) : '';
        const hasTypeSuffix = suffix === 'GOLD' || suffix === 'NORMAL';
        const funderKey = hasTypeSuffix ? rawKey.slice(0, lastColon) : rawKey;
        const revertedAtKey = v.revertedAt ? v.revertedAt.toISOString() : 'unknown';
        const groupKey = `${funderKey}:${revertedAtKey}`;

        const isPrincipal = v.description?.includes('PRINCIPAL\n');
        const isInterest = v.description?.includes('INTEREST\n');

        if (!groups.has(groupKey)) {
            groups.set(groupKey, {
                funderId: funderKey === 'OWN' ? null : funderKey,
                funderName: funderKey === 'OWN' ? 'own fund' : funderKey,
                voucherNos: [],
                principalAmount: 0,
                interestAmount: 0,
                totalAmount: 0,
                revertedByName: v.revertedBy ? `${v.revertedBy.firstName} ${v.revertedBy.lastName}` : null,
                revertedByEmployeeId: v.revertedBy?.employeeId ?? null,
                revertedAt: v.revertedAt ? v.revertedAt.toISOString() : null,
                revertReason: v.revertReason ?? null,
                revertLocation: toRevertLocationDto(v),
            });
        }
        const group = groups.get(groupKey)!;
        group.voucherNos.push(v.voucherNo);
        const amount = Number(v.amount || 0);
        if (isPrincipal) group.principalAmount += amount;
        else if (isInterest) group.interestAmount += amount;
        group.totalAmount += amount;
    }

    // Same reverted-history view, for funders whose allocation was posted via the merged
    // "Allocate for EOD" voucher (postEodFunderAllocation) instead — tagged via `postingMarker`
    // rather than a `description` prefix (see the doc comment on that Prisma field). Merged into
    // the same `groups` map so a funder with both legacy and merged reverted vouchers on the same
    // day shows as one combined row.
    const eodFunderMarkerBase = `[POSTING:EOD_FUNDER:${branchId}:${dateYmd}:`;
    const funderVouchers = await prisma.financialTransaction.findMany({
        where: {
            branchId,
            postingMarker: { startsWith: eodFunderMarkerBase },
            isActive: false,
            revertedAt: { not: null },
        },
        select: {
            voucherNo: true,
            amount: true,
            postingMarker: true,
            description: true,
            revertedAt: true,
            revertReason: true,
            revertLatitude: true,
            revertLongitude: true,
            revertedBy: { select: { firstName: true, lastName: true, employeeId: true } },
        },
        orderBy: { revertedAt: 'desc' },
    });
    for (const v of funderVouchers) {
        if (!v.postingMarker) continue;
        const rawFunderKey = v.postingMarker.slice(eodFunderMarkerBase.length, -1);
        const lastFunderColon = rawFunderKey.lastIndexOf(':');
        const funderSuffix = lastFunderColon !== -1 ? rawFunderKey.slice(lastFunderColon + 1) : '';
        const funderHasTypeSuffix = funderSuffix === 'GOLD' || funderSuffix === 'NORMAL';
        const funderKey = funderHasTypeSuffix ? rawFunderKey.slice(0, lastFunderColon) : rawFunderKey;
        const revertedAtKey = v.revertedAt ? v.revertedAt.toISOString() : 'unknown';
        const groupKey = `${funderKey}:${revertedAtKey}`;

        const isPrincipal = v.description?.includes('PRINCIPAL\n');
        const isInterest = v.description?.includes('INTEREST\n');

        if (!groups.has(groupKey)) {
            groups.set(groupKey, {
                funderId: funderKey === 'OWN' ? null : funderKey,
                funderName: funderKey === 'OWN' ? 'own fund' : funderKey,
                voucherNos: [],
                principalAmount: 0,
                interestAmount: 0,
                totalAmount: 0,
                revertedByName: v.revertedBy ? `${v.revertedBy.firstName} ${v.revertedBy.lastName}` : null,
                revertedByEmployeeId: v.revertedBy?.employeeId ?? null,
                revertedAt: v.revertedAt ? v.revertedAt.toISOString() : null,
                revertReason: v.revertReason ?? null,
                revertLocation: toRevertLocationDto(v),
            });
        }
        const group = groups.get(groupKey)!;
        group.voucherNos.push(v.voucherNo);
        const amount = Number(v.amount || 0);
        if (isPrincipal) group.principalAmount += amount;
        else if (isInterest) group.interestAmount += amount;
        group.totalAmount += amount;
    }

    const rows = Array.from(groups.values()).sort((a, b) => (b.revertedAt ?? '').localeCompare(a.revertedAt ?? ''));
    const funderIds = rows.map((r) => r.funderId).filter((id): id is string => !!id);
    if (funderIds.length > 0) {
        const funders = await prisma.funder.findMany({
            where: { id: { in: funderIds } },
            select: { id: true, funderName: true },
        });
        const funderNameById = new Map(funders.map((f) => [f.id, f.funderName]));
        for (const row of rows) {
            if (row.funderId) row.funderName = funderNameById.get(row.funderId) ?? row.funderName;
        }
    }

    return { rows };
}

/**
 * "Show Reverted History" for the standalone Loan Advance bucket — a single branch/date-wide
 * marker (see buildEodLoanAdvanceMarker). Grouped by exact `revertedAt` instant (the revert route
 * stamps every voucher from one revert action with a single shared timestamp, not a fresh
 * `new Date()` per voucher) so two separate revert actions on the same date show as two distinct
 * entries with their own date/time, instead of being merged into one aggregate that only shows the
 * most recent one.
 */
async function buildRevertedLoanAdvanceView(branchId: string, dateYmd: string): Promise<RevertedLoanAdvanceRow[]> {
    const marker = `[POSTING:EOD_LOAN_ADVANCE:${branchId}:${dateYmd}]`;
    const vouchers = await prisma.financialTransaction.findMany({
        where: {
            branchId,
            description: { contains: marker, mode: 'insensitive' },
            isActive: false,
            revertedAt: { not: null },
        },
        select: {
            voucherNo: true,
            amount: true,
            revertedAt: true,
            revertReason: true,
            revertLatitude: true,
            revertLongitude: true,
            revertedBy: { select: { firstName: true, lastName: true, employeeId: true } },
        },
        orderBy: { revertedAt: 'desc' },
    });
    if (vouchers.length === 0) return [];

    const groups = new Map<string, RevertedLoanAdvanceRow>();
    for (const v of vouchers) {
        const key = v.revertedAt ? v.revertedAt.toISOString() : 'unknown';
        let group = groups.get(key);
        if (!group) {
            group = {
                voucherNos: [],
                amount: 0,
                revertedByName: v.revertedBy ? `${v.revertedBy.firstName} ${v.revertedBy.lastName}` : null,
                revertedByEmployeeId: v.revertedBy?.employeeId ?? null,
                revertedAt: v.revertedAt ? v.revertedAt.toISOString() : null,
                revertReason: v.revertReason ?? null,
                revertLocation: toRevertLocationDto(v),
            };
            groups.set(key, group);
        }
        group.voucherNos.push(v.voucherNo);
        group.amount += Number(v.amount || 0);
    }

    return Array.from(groups.values()).sort((a, b) => (b.revertedAt ?? '').localeCompare(a.revertedAt ?? ''));
}

const CLOSURE_MARKER_PREFIX: Record<ClosureType, string> = {
    PRECLOSURE: 'EOD_PRECLOSURE',
    WRITEOFF: 'EOD_WRITEOFF',
};

type ClosureTransactionRow = {
    transactionId: string;
    clientCode: string;
    clientName: string;
    loanNumber: string;
    collectionDate: string;
    principalAmount: number;
    interestAmount: number;
    totalAmount: number;
    collectedByName: string;
};

type ClosureAllocationRow = {
    funderId: string | null;
    funderName: string;
    principalAmount: number;
    interestAmount: number;
    totalAmount: number;
    batches: Array<{
        batchNumber: number;
        status: 'ALLOCATED' | 'PENDING';
        principalAmount: number;
        interestAmount: number;
        totalAmount: number;
        pendingTransactions: ClosureTransactionRow[];
    }>;
    allocatedTransactions: ClosureTransactionRow[];
};

/**
 * Funder-wise summary of a branch's APPROVED same-day Pre-Closure/Loan-Closing collections,
 * for the "Allocate for EOD" tab's Pre-Closure / Loan Closing sections. Built independently of
 * the REPAYMENT `rows` block above (not by refactoring it) to keep zero regression risk there.
 * Unlike REPAYMENT, there is no legacy-residual posting history to net against for these two
 * types (this feature has no history predating per-transaction eodAllocatedAt tagging) — so
 * eodAllocatedAt alone is a reliable ALLOCATED/PENDING split, with no need to cross-reference
 * FinancialTransaction markers for the summary numbers. No loan.isActive filter either — the
 * loan is already closed by the time a row is genuinely pending here (finalization happens at
 * approval/creation time — see finalizeClosureCoveredLoan in app/lib/foreclosure-workflow.ts),
 * exactly like REPAYMENT's own pending-collection query never needed one.
 */
async function buildClosureAllocationRows(
    branchId: string,
    dayStartUtc: Date,
    dayEndExclusiveUtc: Date,
    closureType: ClosureType
): Promise<ClosureAllocationRow[]> {
    const tx = await prisma.loanTransaction.findMany({
        where: {
            branchId,
            type: closureType,
            status: 'APPROVED',
            isReversed: false,
            isGlSynced: false,
            transactionDate: { gte: dayStartUtc, lt: dayEndExclusiveUtc },
        },
        orderBy: { transactionDate: 'asc' },
        select: {
            id: true,
            eodAllocatedAt: true,
            transactionDate: true,
            principalAmount: true,
            interestAmount: true,
            amount: true,
            collectedBy: { select: { firstName: true, lastName: true } },
            client: { select: { clientId: true, firstName: true, lastName: true } },
            loan: {
                select: {
                    loanNumber: true,
                    funderId: true,
                    funder: { select: { funderName: true } },
                },
            },
        },
    });

    // Grouped by funder only — Gold and Normal collections for the same funder share one bucket
    // (gold is a loan-type flag, not a separate funder; see buildFunderLabel in gl-config.ts).
    type FunderGroup = {
        funderId: string | null;
        funderName: string;
        principalAmount: number;
        interestAmount: number;
        totalAmount: number;
        transactions: typeof tx;
    };
    const groups = new Map<string, FunderGroup>();
    for (const t of tx) {
        const funderId = t.loan?.funderId ?? null;
        const key = funderId ?? 'OWN';
        if (!groups.has(key)) {
            groups.set(key, {
                funderId,
                funderName: t.loan?.funder?.funderName || 'own fund',
                principalAmount: 0,
                interestAmount: 0,
                totalAmount: 0,
                transactions: [],
            });
        }
        const bucket = groups.get(key)!;
        bucket.principalAmount += Number(t.principalAmount || 0);
        bucket.interestAmount += Number(t.interestAmount || 0);
        bucket.totalAmount += Number(t.amount || 0);
        bucket.transactions.push(t);
    }

    const buildTxRow = (t: (typeof tx)[number]): ClosureTransactionRow => ({
        transactionId: t.id,
        clientCode: t.client?.clientId || 'N/A',
        clientName: t.client ? `${t.client.firstName} ${t.client.lastName}` : 'Unknown Client',
        loanNumber: t.loan?.loanNumber || 'N/A',
        collectionDate: t.transactionDate.toISOString(),
        principalAmount: Number(t.principalAmount || 0),
        interestAmount: Number(t.interestAmount || 0),
        totalAmount: Number(t.amount || 0),
        collectedByName: t.collectedBy ? `${t.collectedBy.firstName} ${t.collectedBy.lastName}` : 'System',
    });

    return Array.from(groups.values()).map((g) => {
        const allocatedTx = g.transactions.filter((t) => t.eodAllocatedAt);
        const pendingTx = g.transactions.filter((t) => !t.eodAllocatedAt);

        const batches: ClosureAllocationRow['batches'] = [];
        if (allocatedTx.length > 0) {
            batches.push({
                batchNumber: batches.length + 1,
                status: 'ALLOCATED',
                principalAmount: Number(allocatedTx.reduce((s, t) => s + Number(t.principalAmount || 0), 0).toFixed(2)),
                interestAmount: Number(allocatedTx.reduce((s, t) => s + Number(t.interestAmount || 0), 0).toFixed(2)),
                totalAmount: Number(allocatedTx.reduce((s, t) => s + Number(t.amount || 0), 0).toFixed(2)),
                pendingTransactions: [],
            });
        }
        if (pendingTx.length > 0) {
            batches.push({
                batchNumber: batches.length + 1,
                status: 'PENDING',
                principalAmount: Number(pendingTx.reduce((s, t) => s + Number(t.principalAmount || 0), 0).toFixed(2)),
                interestAmount: Number(pendingTx.reduce((s, t) => s + Number(t.interestAmount || 0), 0).toFixed(2)),
                totalAmount: Number(pendingTx.reduce((s, t) => s + Number(t.amount || 0), 0).toFixed(2)),
                pendingTransactions: pendingTx.map(buildTxRow),
            });
        }

        return {
            funderId: g.funderId,
            funderName: g.funderName,
            principalAmount: g.principalAmount,
            interestAmount: g.interestAmount,
            totalAmount: g.totalAmount,
            batches,
            allocatedTransactions: allocatedTx.map(buildTxRow),
        };
    });
}

/**
 * "Show Reverted History" for Pre-Closure / Loan Closing allocations — same grouping shape as
 * buildRevertedAllocationView (funder+gold-flag+exact-revertedAt, so distinct revert actions on
 * the same funder stay separate rows), built as a standalone function against the
 * EOD_PRECLOSURE/EOD_WRITEOFF marker prefixes rather than generalizing the REPAYMENT-scoped
 * original.
 */
async function buildRevertedClosureView(branchId: string, dateYmd: string, closureType: ClosureType): Promise<{ rows: RevertedAllocationRow[] }> {
    const prefix = CLOSURE_MARKER_PREFIX[closureType];
    const markerBase = `[POSTING:${prefix}:${branchId}:${dateYmd}:`;
    const vouchers = await prisma.financialTransaction.findMany({
        where: {
            branchId,
            description: { contains: markerBase, mode: 'insensitive' },
            isActive: false,
            revertedAt: { not: null },
        },
        select: {
            voucherNo: true,
            amount: true,
            description: true,
            revertedAt: true,
            revertReason: true,
            revertLatitude: true,
            revertLongitude: true,
            revertedBy: { select: { firstName: true, lastName: true, employeeId: true } },
        },
        orderBy: { revertedAt: 'desc' },
    });

    const groups = new Map<string, RevertedAllocationRow>();
    const markerRegex = new RegExp(`\\[POSTING:${prefix}:[^:]+:[^:]+:([^\\]]+)\\]`);
    for (const v of vouchers) {
        const match = v.description?.match(markerRegex);
        if (!match) continue;

        const rawKey = match[1];
        const lastColon = rawKey.lastIndexOf(':');
        const suffix = lastColon !== -1 ? rawKey.slice(lastColon + 1) : '';
        const hasTypeSuffix = suffix === 'GOLD' || suffix === 'NORMAL';
        const funderKey = hasTypeSuffix ? rawKey.slice(0, lastColon) : rawKey;
        const revertedAtKey = v.revertedAt ? v.revertedAt.toISOString() : 'unknown';
        const groupKey = `${funderKey}:${revertedAtKey}`;

        const isPrincipal = v.description?.includes('PRINCIPAL\n');
        const isInterest = v.description?.includes('INTEREST\n');

        if (!groups.has(groupKey)) {
            groups.set(groupKey, {
                funderId: funderKey === 'OWN' ? null : funderKey,
                funderName: funderKey === 'OWN' ? 'own fund' : funderKey,
                voucherNos: [],
                principalAmount: 0,
                interestAmount: 0,
                totalAmount: 0,
                revertedByName: v.revertedBy ? `${v.revertedBy.firstName} ${v.revertedBy.lastName}` : null,
                revertedByEmployeeId: v.revertedBy?.employeeId ?? null,
                revertedAt: v.revertedAt ? v.revertedAt.toISOString() : null,
                revertReason: v.revertReason ?? null,
                revertLocation: toRevertLocationDto(v),
            });
        }
        const group = groups.get(groupKey)!;
        group.voucherNos.push(v.voucherNo);
        const amount = Number(v.amount || 0);
        if (isPrincipal) group.principalAmount += amount;
        else if (isInterest) group.interestAmount += amount;
        group.totalAmount += amount;
    }

    const rows = Array.from(groups.values()).sort((a, b) => (b.revertedAt ?? '').localeCompare(a.revertedAt ?? ''));
    const funderIds = rows.map((r) => r.funderId).filter((id): id is string => !!id);
    if (funderIds.length > 0) {
        const funders = await prisma.funder.findMany({
            where: { id: { in: funderIds } },
            select: { id: true, funderName: true },
        });
        const funderNameById = new Map(funders.map((f) => [f.id, f.funderName]));
        for (const row of rows) {
            if (row.funderId) row.funderName = funderNameById.get(row.funderId) ?? row.funderName;
        }
    }

    return { rows };
}

/**
 * GET /api/collections/eod-allocation
 * Funder-wise summary of a branch's APPROVED same-day collections, for the
 * "Allocate for EOD" tab. Returns a numbered sequence of allocation batches per
 * funder: one ALLOCATED batch per historical "Allocate for EOD" click (reconstructed
 * from FinancialTransaction voucher history), plus at most one trailing PENDING batch
 * for whatever hasn't been posted yet — with its individual transactions (same shape
 * as the Demand/Gold Loan approval tabs) so the admin can see exactly what a click
 * will post.
 */
export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const branchId = searchParams.get('branchId') || user.branchId;
            const dateYmd = searchParams.get('date');
            const statusParam = searchParams.get('status');
            if (!branchId) return errorResponse('Branch context is required', 400);
            if (!dateYmd) return errorResponse('date is required', 400);

            const branchGate = await assertBranchPermitted(user, branchId);
            if (branchGate) return branchGate;

            if (statusParam === 'reverted') {
                const [reverted, loanAdvanceReverted, preclosureReverted, writeoffReverted] = await Promise.all([
                    buildRevertedAllocationView(branchId, dateYmd),
                    buildRevertedLoanAdvanceView(branchId, dateYmd),
                    buildRevertedClosureView(branchId, dateYmd, 'PRECLOSURE'),
                    buildRevertedClosureView(branchId, dateYmd, 'WRITEOFF'),
                ]);
                return successResponse(
                    {
                        ...reverted,
                        loanAdvanceReverted,
                        preclosureReverted: preclosureReverted.rows,
                        writeoffReverted: writeoffReverted.rows,
                    },
                    'Reverted allocations fetched'
                );
            }

            const dayStartUtc = parseKolkataAttendanceDateYmd(dateYmd);
            const dayEndExclusiveUtc = getKolkataDayEndExclusiveUtc(dayStartUtc);

            const [approvedTx, savingsTx] = await Promise.all([
                prisma.loanTransaction.findMany({
                    where: {
                        branchId,
                        type: 'REPAYMENT',
                        status: 'APPROVED',
                        isReversed: false,
                        excludeFromEodAllocation: false,
                        transactionDate: { gte: dayStartUtc, lt: dayEndExclusiveUtc },
                    },
                    orderBy: { transactionDate: 'asc' },
                    select: {
                        id: true,
                        collectionBatchId: true,
                        loanId: true,
                        eodAllocatedAt: true,
                        transactionDate: true,
                        principalAmount: true,
                        interestAmount: true,
                        penaltyAmount: true,
                        feesAmount: true,
                        amount: true,
                        collectedBy: { select: { firstName: true, lastName: true } },
                        client: { select: { clientId: true, firstName: true, lastName: true } },
                        loan: {
                            select: {
                                loanNumber: true,
                                funderId: true,
                                funder: { select: { funderName: true } },
                                loanProduct: {
                                    select: {
                                        productName: true,
                                        numberOfDues: true,
                                    },
                                },
                            },
                        },
                        // No `take: 1` — determineWorkbenchMode needs every line's due date to
                        // classify Demand/Advance/Arrear correctly (any line overdue → Arrear,
                        // else any line due today → Demand, else all future → Advance). `orderBy`
                        // is kept so `tx.lines[0]` (used below for the existing dueCount/dueDate
                        // display fields) stays deterministically the lowest installmentNo.
                        lines: {
                            orderBy: { installmentNo: 'asc' },
                            select: { installmentNo: true, schedule: { select: { dueDate: true } } },
                        },
                    },
                }),
                prisma.loanTransaction.findMany({
                    where: {
                        branchId,
                        type: 'SAVINGS_COLLECTION' as never,
                        status: 'APPROVED',
                        isReversed: false,
                        excludeFromEodAllocation: false,
                        transactionDate: { gte: dayStartUtc, lt: dayEndExclusiveUtc },
                    },
                    orderBy: { transactionDate: 'asc' },
                    select: {
                        id: true,
                        collectionBatchId: true,
                        loanId: true,
                        amount: true,
                        eodAllocatedAt: true,
                        transactionDate: true,
                        collectedBy: { select: { firstName: true, lastName: true } },
                        client: { select: { clientId: true, firstName: true, lastName: true } },
                        loan: { select: { loanNumber: true } },
                    },
                }),
            ]);

            // Informational only — the per-client "Loan Advance" figure shown alongside a
            // REPAYMENT row in the funder table below (same collection batch, not the standalone
            // Loan Advance allocation bucket built further down).
            const savingsByBatchLoan = new Map<string, number>();
            for (const tx of savingsTx) {
                if (!tx.collectionBatchId) continue;
                const batchKey = `${tx.collectionBatchId}:${tx.loanId}`;
                savingsByBatchLoan.set(batchKey, (savingsByBatchLoan.get(batchKey) ?? 0) + Number(tx.amount || 0));
            }

            // Grouped by funder only — Gold and Normal collections for the same funder share one
            // bucket (gold is a loan-type flag, not a separate funder; see buildFunderLabel in
            // app/lib/gl-config.ts).
            type FunderGroup = {
                funderId: string | null;
                funderName: string;
                principalAmount: number;
                interestAmount: number;
                penaltyAmount: number;
                feesAmount: number;
                totalAmount: number;
                transactions: typeof approvedTx;
            };
            const groups = new Map<string, FunderGroup>();

            // Mode-scoped mirror of `groups` above — same accumulation, split three ways by
            // Demand/Advance/Arrear (see determineWorkbenchMode) for the Allocate-for-EOD tab's
            // segregated sections. `groups`/`rows` below stay completely untouched — they still
            // feed AllocationRevertClient.tsx, which is unaffected by this split.
            const groupsByMode: Record<WorkbenchMode, Map<string, FunderGroup>> = {
                DEMAND: new Map(),
                ADVANCE: new Map(),
                ARREAR: new Map(),
            };

            for (const tx of approvedTx) {
                const funderId = tx.loan?.funderId ?? null;
                const key = funderId ?? 'OWN';
                if (!groups.has(key)) {
                    groups.set(key, {
                        funderId,
                        funderName: tx.loan?.funder?.funderName || 'own fund',
                        principalAmount: 0,
                        interestAmount: 0,
                        penaltyAmount: 0,
                        feesAmount: 0,
                        totalAmount: 0,
                        transactions: [],
                    });
                }
                const bucket = groups.get(key)!;
                bucket.principalAmount += Number(tx.principalAmount || 0);
                bucket.interestAmount += Number(tx.interestAmount || 0);
                bucket.penaltyAmount += Number(tx.penaltyAmount || 0);
                bucket.feesAmount += Number(tx.feesAmount || 0);
                // Use the transaction's own recorded total (principal+interest+fees+penalty)
                // rather than re-summing components, so rounding/edge cases can't drift.
                bucket.totalAmount += Number(tx.amount || 0);
                bucket.transactions.push(tx);

                const scheduleLines = tx.lines.map((line) => ({
                    dueDate: line.schedule?.dueDate ? new Date(line.schedule.dueDate).toISOString() : null,
                }));
                const mode = determineWorkbenchMode(scheduleLines, tx.transactionDate);
                const modeMap = groupsByMode[mode];
                if (!modeMap.has(key)) {
                    modeMap.set(key, {
                        funderId,
                        funderName: tx.loan?.funder?.funderName || 'own fund',
                        principalAmount: 0,
                        interestAmount: 0,
                        penaltyAmount: 0,
                        feesAmount: 0,
                        totalAmount: 0,
                        transactions: [],
                    });
                }
                const modeBucket = modeMap.get(key)!;
                modeBucket.principalAmount += Number(tx.principalAmount || 0);
                modeBucket.interestAmount += Number(tx.interestAmount || 0);
                modeBucket.penaltyAmount += Number(tx.penaltyAmount || 0);
                modeBucket.feesAmount += Number(tx.feesAmount || 0);
                modeBucket.totalAmount += Number(tx.amount || 0);
                modeBucket.transactions.push(tx);
            }

            // A funder's collections for the date may be allocated across several "Allocate for
            // EOD" clicks (each posts a delta voucher pair for whatever wasn't covered yet — see
            // postEodCollectionAllocation). That's posting *history*, not something to surface
            // click-by-click: collapse every posted row for a funder/date into one aggregate
            // Allocated total (still split by PRINCIPAL/INTEREST component for display), so the
            // UI shows at most one Allocated summary + one Pending total per funder/day,
            // regardless of how many individual clicks it took to get there.
            const markerBase = `[POSTING:EOD_COLLECTION:${branchId}:${dateYmd}:`;
            const postedMarkers = await prisma.financialTransaction.findMany({
                where: { description: { contains: markerBase }, isActive: true },
                select: { description: true, amount: true },
            });
            type PostedRow = { amount: number; component: 'PRINCIPAL' | 'INTEREST' | 'OTHER' };
            const postedRowsByKey = new Map<string, PostedRow[]>();
            for (const p of postedMarkers) {
                const match = p.description?.match(/\[POSTING:EOD_COLLECTION:[^:]+:[^:]+:([^\]]+)\]/);
                if (!match) continue;
                const key = match[1];
                const component: PostedRow['component'] = p.description?.includes('PRINCIPAL\n')
                    ? 'PRINCIPAL'
                    : p.description?.includes('INTEREST\n')
                      ? 'INTEREST'
                      : 'OTHER';
                const arr = postedRowsByKey.get(key) ?? [];
                arr.push({ amount: Number(p.amount || 0), component });
                postedRowsByKey.set(key, arr);
            }

            // Same aggregation, for funders posted via the merged "Allocate for EOD" voucher
            // (postEodFunderAllocation) instead — that posting family tags its vouchers with
            // postingMarker rather than embedding the marker in `description` (see the doc comment
            // on that Prisma field), so it needs its own lookup merged into the same map.
            const eodFunderMarkerBase = `[POSTING:EOD_FUNDER:${branchId}:${dateYmd}:`;
            const postedFunderMarkers = await prisma.financialTransaction.findMany({
                where: { postingMarker: { startsWith: eodFunderMarkerBase }, isActive: true },
                select: { postingMarker: true, description: true, amount: true },
            });
            for (const p of postedFunderMarkers) {
                if (!p.postingMarker) continue;
                const key = p.postingMarker.slice(eodFunderMarkerBase.length, -1);
                const component: PostedRow['component'] = p.description?.includes('PRINCIPAL\n')
                    ? 'PRINCIPAL'
                    : p.description?.includes('INTEREST\n')
                      ? 'INTEREST'
                      : 'OTHER';
                const arr = postedRowsByKey.get(key) ?? [];
                arr.push({ amount: Number(p.amount || 0), component });
                postedRowsByKey.set(key, arr);
            }

            const buildPendingTransaction = (tx: (typeof approvedTx)[number]) => {
                const firstLine = tx.lines[0];
                const totalDues = tx.loan?.loanProduct?.numberOfDues;
                const loanAdvanceAmount = tx.collectionBatchId
                    ? savingsByBatchLoan.get(`${tx.collectionBatchId}:${tx.loanId}`) ?? 0
                    : 0;
                return {
                    transactionId: tx.id,
                    clientCode: tx.client?.clientId || 'N/A',
                    clientName: tx.client ? `${tx.client.firstName} ${tx.client.lastName}` : 'Unknown Client',
                    loanNumber: tx.loan?.loanNumber || 'N/A',
                    productName: tx.loan?.loanProduct?.productName || 'N/A',
                    dueCount: firstLine ? `${firstLine.installmentNo}${totalDues ? ` / ${totalDues}` : ''}` : '?',
                    dueDate: firstLine?.schedule?.dueDate ? new Date(firstLine.schedule.dueDate).toISOString() : null,
                    collectionDate: tx.transactionDate.toISOString(),
                    principalAmount: Number(tx.principalAmount || 0),
                    interestAmount: Number(tx.interestAmount || 0),
                    totalAmount: Number(tx.amount || 0),
                    loanAdvanceAmount,
                    collectedByName: tx.collectedBy ? `${tx.collectedBy.firstName} ${tx.collectedBy.lastName}` : 'System',
                };
            };

            // Funder-level "over-allocated" guard, keyed the same way as `groups`/`groupsByMode`
            // (${funderId ?? 'OWN'}) — populated as a side effect of the `rows`
            // build below (same computation, no duplication) and reused by
            // buildModeAllocationRows so each Demand/Advance/Arrear section for a funder shows
            // the same guard `rows` does. This has to be funder-level, not mode-level: the GL
            // voucher marker isn't mode-scoped, so a stale/over-posted marker can't be
            // attributed back to just one mode — if the funder's marker is over-posted, every
            // mode section for that funder must show the guard, not just one.
            const overAllocatedByKey = new Map<string, { overAllocated: boolean; mismatchAmount: number }>();

            const rows = Array.from(groups.entries()).map(([key, g]) => {
                const currentTotal = g.principalAmount + g.interestAmount;
                const postedRows = postedRowsByKey.get(key) ?? [];
                const postedTotal = postedRows.reduce((s, r) => s + r.amount, 0);
                const fullyAllocated = Math.abs(postedTotal - currentTotal) <= 0.01;
                // A collection reverted *after* its funder was already posted to GL leaves the
                // posted total stranded above the (now smaller) current approved total — revert
                // never adjusts the prior FinancialTransaction posting (see
                // POST /api/collections/client/reverse). The FIFO "already posted" attribution
                // below can no longer be trusted once that happens, so surface it explicitly
                // instead of silently hiding every transaction (including brand-new ones) behind
                // a stale "fully allocated" state.
                const overAllocated = postedTotal > currentTotal + 0.01;
                const mismatchAmount = overAllocated ? Number((postedTotal - currentTotal).toFixed(2)) : 0;
                overAllocatedByKey.set(key, { overAllocated, mismatchAmount });

                // At most one Allocated batch — the aggregate of every posting made for this
                // funder/date so far, regardless of how many individual clicks it took.
                const batches: Array<{
                    batchNumber: number;
                    status: 'ALLOCATED' | 'PENDING';
                    principalAmount: number;
                    interestAmount: number;
                    totalAmount: number;
                    pendingTransactions: ReturnType<typeof buildPendingTransaction>[];
                }> = [];

                if (postedTotal > 0.01) {
                    const postedPrincipal = postedRows
                        .filter((r) => r.component === 'PRINCIPAL')
                        .reduce((s, r) => s + r.amount, 0);
                    const postedInterest = postedRows
                        .filter((r) => r.component === 'INTEREST')
                        .reduce((s, r) => s + r.amount, 0);
                    batches.push({
                        batchNumber: batches.length + 1,
                        status: 'ALLOCATED',
                        principalAmount: Number(postedPrincipal.toFixed(2)),
                        interestAmount: Number(postedInterest.toFixed(2)),
                        totalAmount: Number((postedPrincipal + postedInterest).toFixed(2)),
                        pendingTransactions: [],
                    });
                }

                // Whatever's left once every historical posting is accounted for is the one
                // current pending batch. Transactions tagged with eodAllocatedAt are known-posted
                // (stamped by postEodCollectionAllocation, e.g. a per-row "Allocate for EOD"
                // click) and are never pending. Any remaining gap between postedTotal and the
                // tagged total is legacy posting history from before per-transaction tagging
                // existed — attribute that to the oldest untagged transactions first, same as
                // before. In the over-allocated case that attribution isn't trustworthy, so every
                // untagged transaction is returned instead of guessing (tagged ones stay excluded
                // either way — they're provably posted, no guessing needed).
                if (!fullyAllocated) {
                    const untaggedTx = g.transactions.filter((tx) => !tx.eodAllocatedAt);
                    const taggedTotal = g.transactions.reduce(
                        (s, tx) => (tx.eodAllocatedAt ? s + Number(tx.principalAmount || 0) + Number(tx.interestAmount || 0) : s),
                        0
                    );
                    const legacyResidual = Math.max(0, postedTotal - taggedTotal);

                    let running = 0;
                    const pendingTransactions = untaggedTx
                        .filter((tx) => {
                            if (overAllocated) return true;
                            running += Number(tx.principalAmount || 0) + Number(tx.interestAmount || 0);
                            return running > legacyResidual + 0.01;
                        })
                        .map(buildPendingTransaction);

                    batches.push({
                        batchNumber: batches.length + 1,
                        status: 'PENDING',
                        principalAmount: Number(pendingTransactions.reduce((s, t) => s + t.principalAmount, 0).toFixed(2)),
                        interestAmount: Number(pendingTransactions.reduce((s, t) => s + t.interestAmount, 0).toFixed(2)),
                        totalAmount: Number(pendingTransactions.reduce((s, t) => s + t.totalAmount, 0).toFixed(2)),
                        pendingTransactions,
                    });
                }

                // Per-client detail for every transaction already tagged eodAllocatedAt on this
                // funder/date — used by the Allocation Revert page to list individual clients
                // (instead of just the funder-level ALLOCATED batch aggregate above). Additive:
                // AllocateForEodTab.tsx only reads `batches`, so this new field is invisible to it.
                const allocatedTransactions = g.transactions
                    .filter((tx) => tx.eodAllocatedAt)
                    .map(buildPendingTransaction);

                return {
                    funderId: g.funderId,
                    funderName: g.funderName,
                    walletAdvance: 0,
                    walletPay: 0,
                    loanAdvanceUsed: 0,
                    penaltyAmount: g.penaltyAmount,
                    feesAmount: g.feesAmount,
                    principalAmount: g.principalAmount,
                    interestAmount: g.interestAmount,
                    totalAmount: g.totalAmount,
                    overAllocated,
                    mismatchAmount,
                    batches,
                    allocatedTransactions,
                };
            });

            // ─── Demand / Advance / Arrear — the same REPAYMENT money as `rows` above, split
            // three ways by collection mode for the Allocate-for-EOD tab's segregated sections.
            // Unlike `rows`, these use a direct eodAllocatedAt split (not marker-scanning/legacy-
            // residual netting) for ALLOCATED vs PENDING — the GL voucher marker isn't
            // mode-scoped, so a historical posted voucher can never be attributed back to one
            // mode anyway; eodAllocatedAt is the only mode-precise signal available.
            type ModeAllocationRow = {
                funderId: string | null;
                funderName: string;
                loanAdvanceUsed: number;
                penaltyAmount: number;
                feesAmount: number;
                principalAmount: number;
                interestAmount: number;
                totalAmount: number;
                overAllocated: boolean;
                mismatchAmount: number;
                batches: Array<{
                    batchNumber: number;
                    status: 'ALLOCATED' | 'PENDING';
                    principalAmount: number;
                    interestAmount: number;
                    totalAmount: number;
                    pendingTransactions: ReturnType<typeof buildPendingTransaction>[];
                }>;
            };

            const buildModeAllocationRows = (modeMap: Map<string, FunderGroup>): ModeAllocationRow[] => {
                return Array.from(modeMap.entries()).map(([key, g]) => {
                    const guard = overAllocatedByKey.get(key) ?? { overAllocated: false, mismatchAmount: 0 };
                    const allocatedTx = g.transactions.filter((tx) => tx.eodAllocatedAt);
                    const pendingTx = g.transactions.filter((tx) => !tx.eodAllocatedAt);

                    const batches: ModeAllocationRow['batches'] = [];
                    if (allocatedTx.length > 0) {
                        batches.push({
                            batchNumber: batches.length + 1,
                            status: 'ALLOCATED',
                            principalAmount: Number(allocatedTx.reduce((s, t) => s + Number(t.principalAmount || 0), 0).toFixed(2)),
                            interestAmount: Number(allocatedTx.reduce((s, t) => s + Number(t.interestAmount || 0), 0).toFixed(2)),
                            totalAmount: Number(allocatedTx.reduce((s, t) => s + Number(t.amount || 0), 0).toFixed(2)),
                            pendingTransactions: [],
                        });
                    }
                    if (pendingTx.length > 0) {
                        batches.push({
                            batchNumber: batches.length + 1,
                            status: 'PENDING',
                            principalAmount: Number(pendingTx.reduce((s, t) => s + Number(t.principalAmount || 0), 0).toFixed(2)),
                            interestAmount: Number(pendingTx.reduce((s, t) => s + Number(t.interestAmount || 0), 0).toFixed(2)),
                            totalAmount: Number(pendingTx.reduce((s, t) => s + Number(t.amount || 0), 0).toFixed(2)),
                            pendingTransactions: pendingTx.map(buildPendingTransaction),
                        });
                    }

                    return {
                        funderId: g.funderId,
                        funderName: g.funderName,
                        loanAdvanceUsed: 0,
                        penaltyAmount: g.penaltyAmount,
                        feesAmount: g.feesAmount,
                        principalAmount: g.principalAmount,
                        interestAmount: g.interestAmount,
                        totalAmount: g.totalAmount,
                        overAllocated: guard.overAllocated,
                        mismatchAmount: guard.mismatchAmount,
                        batches,
                    };
                });
            };

            const demandRows = buildModeAllocationRows(groupsByMode.DEMAND);
            const advanceRows = buildModeAllocationRows(groupsByMode.ADVANCE);
            const arrearRows = buildModeAllocationRows(groupsByMode.ARREAR);

            // ─── Loan Advance (SAVINGS_COLLECTION) — allocated independently of any funder, into
            // a single shared LOAN ADVANCE ledger (see postEodLoanAdvanceAllocation), so it's one
            // branch/date-wide bucket rather than split per funder row above.
            const loanAdvanceCurrentTotal = savingsTx.reduce((s, t) => s + Number(t.amount || 0), 0);
            const loanAdvanceMarker = `[POSTING:EOD_LOAN_ADVANCE:${branchId}:${dateYmd}]`;
            const postedLoanAdvanceRows = await prisma.financialTransaction.findMany({
                where: { description: { contains: loanAdvanceMarker, mode: 'insensitive' }, isActive: true },
                select: { amount: true },
            });
            const postedLoanAdvanceTotal = postedLoanAdvanceRows.reduce((s, p) => s + Number(p.amount || 0), 0);
            const loanAdvanceFullyAllocated = Math.abs(postedLoanAdvanceTotal - loanAdvanceCurrentTotal) <= 0.01;
            const loanAdvanceOverAllocated = postedLoanAdvanceTotal > loanAdvanceCurrentTotal + 0.01;
            const loanAdvanceMismatchAmount = loanAdvanceOverAllocated
                ? Number((postedLoanAdvanceTotal - loanAdvanceCurrentTotal).toFixed(2))
                : 0;

            const buildLoanAdvanceTransaction = (tx: (typeof savingsTx)[number]) => ({
                transactionId: tx.id,
                clientCode: tx.client?.clientId || 'N/A',
                clientName: tx.client ? `${tx.client.firstName} ${tx.client.lastName}` : 'Unknown Client',
                loanNumber: tx.loan?.loanNumber || 'N/A',
                amount: Number(tx.amount || 0),
                collectionDate: tx.transactionDate.toISOString(),
                collectedByName: tx.collectedBy ? `${tx.collectedBy.firstName} ${tx.collectedBy.lastName}` : 'System',
            });

            const loanAdvanceBatches: Array<{
                batchNumber: number;
                status: 'ALLOCATED' | 'PENDING';
                amount: number;
                pendingTransactions: ReturnType<typeof buildLoanAdvanceTransaction>[];
            }> = [];
            if (postedLoanAdvanceTotal > 0.01) {
                loanAdvanceBatches.push({
                    batchNumber: loanAdvanceBatches.length + 1,
                    status: 'ALLOCATED',
                    amount: Number(postedLoanAdvanceTotal.toFixed(2)),
                    pendingTransactions: [],
                });
            }
            if (!loanAdvanceFullyAllocated) {
                const untaggedTx = savingsTx.filter((tx) => !tx.eodAllocatedAt);
                const taggedTotal = savingsTx.reduce((s, tx) => (tx.eodAllocatedAt ? s + Number(tx.amount || 0) : s), 0);
                const legacyResidual = Math.max(0, postedLoanAdvanceTotal - taggedTotal);

                let running = 0;
                const pendingTransactions = untaggedTx
                    .filter((tx) => {
                        if (loanAdvanceOverAllocated) return true;
                        running += Number(tx.amount || 0);
                        return running > legacyResidual + 0.01;
                    })
                    .map(buildLoanAdvanceTransaction);

                loanAdvanceBatches.push({
                    batchNumber: loanAdvanceBatches.length + 1,
                    status: 'PENDING',
                    amount: Number(pendingTransactions.reduce((s, t) => s + t.amount, 0).toFixed(2)),
                    pendingTransactions,
                });
            }
            const loanAdvanceAllocatedTransactions = savingsTx
                .filter((tx) => tx.eodAllocatedAt)
                .map(buildLoanAdvanceTransaction);

            const loanAdvance = {
                pendingAmount: Number((loanAdvanceBatches.find((b) => b.status === 'PENDING')?.amount ?? 0).toFixed(2)),
                postedAmount: Number(postedLoanAdvanceTotal.toFixed(2)),
                totalAmount: Number(loanAdvanceCurrentTotal.toFixed(2)),
                overAllocated: loanAdvanceOverAllocated,
                mismatchAmount: loanAdvanceMismatchAmount,
                batches: loanAdvanceBatches,
                allocatedTransactions: loanAdvanceAllocatedTransactions,
            };

            const [preclosureRows, writeoffRows] = await Promise.all([
                buildClosureAllocationRows(branchId, dayStartUtc, dayEndExclusiveUtc, 'PRECLOSURE'),
                buildClosureAllocationRows(branchId, dayStartUtc, dayEndExclusiveUtc, 'WRITEOFF'),
            ]);

            return successResponse({
                date: dateYmd,
                branchId,
                rows,
                demandRows,
                advanceRows,
                arrearRows,
                loanAdvance,
                preclosureRows,
                writeoffRows,
                summary: {
                    principalAmount: rows.reduce((s, r) => s + r.principalAmount, 0),
                    interestAmount: rows.reduce((s, r) => s + r.interestAmount, 0),
                    loanAdvanceAmount: loanAdvance.totalAmount,
                    preclosureAmount: preclosureRows.reduce((s, r) => s + r.totalAmount, 0),
                    writeoffAmount: writeoffRows.reduce((s, r) => s + r.totalAmount, 0),
                    totalAmount: rows.reduce((s, r) => s + r.totalAmount, 0),
                },
            }, 'EOD allocation summary fetched');
        } catch (error) {
            console.error('[EOD Allocation] GET Error:', error);
            return errorResponse('Failed to fetch EOD allocation summary', 500);
        }
    })(request);
}

/**
 * POST /api/collections/eod-allocation
 * Posts one funder's approved same-day collections as Cash Receipt vouchers
 * (Dr Cash in Hand / Cr Loan Portfolio + Interest Income). Idempotent — a
 * funder already posted for the date returns 409 rather than double-posting.
 *
 * `transactionIds` (optional): allocate only this subset of the funder's pending
 * transactions (the per-row "Allocate for EOD" button) instead of every pending
 * transaction for the funder/date (the footer bulk button).
 */
export async function POST(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const body = await req.json();
            const branchId: string | undefined = body.branchId || user.branchId;
            const dateYmd: string | undefined = body.date;
            const funderId: string | null = body.funderId ?? null;
            const transactionIds: string[] | undefined = Array.isArray(body.transactionIds) ? body.transactionIds : undefined;
            const closureType: ClosureType | undefined =
                body.closureType === 'PRECLOSURE' || body.closureType === 'WRITEOFF' ? body.closureType : undefined;
            const mergedFunderAllocation: boolean = body.mergedFunderAllocation === true;

            if (!branchId) return errorResponse('Branch context is required', 400);
            if (!dateYmd) return errorResponse('date is required', 400);

            const branchGate = await assertBranchPermitted(user, branchId);
            if (branchGate) return branchGate;

            const lockResponse = await assertBranchNotLocked(branchId);
            if (lockResponse) return lockResponse;

            const dayStartUtc = parseKolkataAttendanceDateYmd(dateYmd);
            const dayEndExclusiveUtc = getKolkataDayEndExclusiveUtc(dayStartUtc);

            if (mergedFunderAllocation) {
                // Lock re-allocation while this funder/date already has an active merged voucher
                // (Gold and Normal collections share this one bucket — gold is a loan-type flag,
                // not a separate funder) — a second click would layer another voucher under the
                // exact same postingMarker instead of topping up the first one. Mirrors the UI
                // lock on FunderGroupCard's "Allocate For EOD" button (AllocateForEodTab.tsx) so
                // the API can't be called around it. Revert the existing allocation first
                // (Allocation Revert) to unlock.
                const funderKeyForLock = funderId ?? 'OWN';
                const existingMergedVoucherCount = await prisma.financialTransaction.count({
                    where: {
                        postingMarker: `[POSTING:EOD_FUNDER:${branchId}:${dateYmd}:${funderKeyForLock}]`,
                        isActive: true,
                    },
                });
                if (existingMergedVoucherCount > 0) {
                    return errorResponse(
                        'This funder already has an active EOD allocation for this date. Revert it first (Allocation Revert) before allocating again.',
                        409
                    );
                }

                // Grabs everything currently pending for this funder/date across all three
                // collection types (Gold and Normal loans together), the same "server is source
                // of truth, no client-picked subset" pattern the closureType branch below already
                // uses — the whole point of this button is "allocate all of this funder's day,"
                // not a partial selection.
                const [candidateRepayment, candidatePreclosure, candidateWriteoff] = await Promise.all([
                    prisma.loanTransaction.findMany({
                        where: {
                            branchId,
                            type: 'REPAYMENT',
                            status: 'APPROVED',
                            isReversed: false,
                            eodAllocatedAt: null,
                            excludeFromEodAllocation: false,
                            transactionDate: { gte: dayStartUtc, lt: dayEndExclusiveUtc },
                            loan: funderId ? { funderId } : { funderId: null },
                        },
                        select: {
                            id: true,
                            loan: { select: { funder: { select: { funderName: true } } } },
                        },
                    }),
                    prisma.loanTransaction.findMany({
                        where: pendingClosureAllocationWhere(branchId, 'PRECLOSURE', dayStartUtc, dayEndExclusiveUtc, funderId),
                        select: {
                            id: true,
                            loan: { select: { funder: { select: { funderName: true } } } },
                        },
                    }),
                    prisma.loanTransaction.findMany({
                        where: pendingClosureAllocationWhere(branchId, 'WRITEOFF', dayStartUtc, dayEndExclusiveUtc, funderId),
                        select: {
                            id: true,
                            loan: { select: { funder: { select: { funderName: true } } } },
                        },
                    }),
                ]);

                const approvedMergedTx = [...candidateRepayment, ...candidatePreclosure, ...candidateWriteoff];

                if (approvedMergedTx.length === 0) {
                    return errorResponse('No approved collections found for this funder/date', 404);
                }

                const mergedFunderName = approvedMergedTx[0].loan?.funder?.funderName || 'own fund';

                let mergedResult;
                try {
                    mergedResult = await prisma.$transaction(async (tx) => {
                        return accountingPostingService.postEodFunderAllocation({
                            tx,
                            branchId,
                            workingDateYmd: dateYmd,
                            funderId,
                            funderName: mergedFunderName,
                            transactionDate: dayStartUtc,
                            createdById: user.userId,
                            createdByRole: user.role,
                            transactionIds: approvedMergedTx.map((t) => t.id),
                        });
                    }, { timeout: 20000, maxWait: 20000 });
                } catch (txError) {
                    if (txError instanceof ClosureAllocationConflictError) {
                        return errorResponse(txError.message, 409);
                    }
                    throw txError;
                }

                if (!mergedResult.posted) {
                    return errorResponse(mergedResult.message || 'Already allocated for this funder/date', 409);
                }

                return successResponse(
                    mergedResult,
                    `Allocated ${mergedFunderName} collections to EOD (voucher${mergedResult.voucherNos.length > 1 ? 's' : ''} ${mergedResult.voucherNos.join(', ')})`
                );
            }

            if (closureType) {
                const approvedClosureTx = await prisma.loanTransaction.findMany({
                    where: {
                        ...pendingClosureAllocationWhere(branchId, closureType, dayStartUtc, dayEndExclusiveUtc, funderId),
                        ...(transactionIds ? { id: { in: transactionIds } } : {}),
                    },
                    select: {
                        id: true,
                        principalAmount: true,
                        interestAmount: true,
                        loan: { select: { funder: { select: { funderName: true } } } },
                    },
                });

                if (approvedClosureTx.length === 0) {
                    return errorResponse('No approved collections found for this funder/date', 404);
                }
                if (transactionIds && approvedClosureTx.length !== transactionIds.length) {
                    return errorResponse('Some selected transactions are no longer pending allocation — refresh and try again', 409);
                }

                const closurePrincipalAmount = approvedClosureTx.reduce((sum, t) => sum + Number(t.principalAmount || 0), 0);
                const closureInterestAmount = approvedClosureTx.reduce((sum, t) => sum + Number(t.interestAmount || 0), 0);
                const closureFunderName = approvedClosureTx[0].loan?.funder?.funderName || 'own fund';

                let closureResult;
                try {
                    closureResult = await prisma.$transaction(async (tx) => {
                        return accountingPostingService.postEodClosureAllocation({
                            tx,
                            branchId,
                            workingDateYmd: dateYmd,
                            funderId,
                            funderName: closureFunderName,
                            principalAmount: closurePrincipalAmount,
                            interestAmount: closureInterestAmount,
                            transactionDate: dayStartUtc,
                            createdById: user.userId,
                            createdByRole: user.role,
                            closureType,
                            transactionIds: approvedClosureTx.map((t) => t.id),
                        });
                    }, { timeout: 20000, maxWait: 20000 });
                } catch (txError) {
                    if (txError instanceof ClosureAllocationConflictError) {
                        return errorResponse(txError.message, 409);
                    }
                    throw txError;
                }

                if (!closureResult.posted) {
                    return errorResponse(closureResult.message || 'Already allocated for this funder/date', 409);
                }

                return successResponse(
                    closureResult,
                    `Allocated ${closureFunderName} ${closureType === 'PRECLOSURE' ? 'pre-closure' : 'loan closing'} collections to EOD (voucher${closureResult.voucherNos.length > 1 ? 's' : ''} ${closureResult.voucherNos.join(', ')})`
                );
            }

            const approvedTx = await prisma.loanTransaction.findMany({
                where: {
                    branchId,
                    type: 'REPAYMENT',
                    status: 'APPROVED',
                    isReversed: false,
                    eodAllocatedAt: null,
                    excludeFromEodAllocation: false,
                    transactionDate: { gte: dayStartUtc, lt: dayEndExclusiveUtc },
                    loan: funderId ? { funderId } : { funderId: null },
                    ...(transactionIds ? { id: { in: transactionIds } } : {}),
                },
                select: {
                    id: true,
                    principalAmount: true,
                    interestAmount: true,
                    loan: { select: { funder: { select: { funderName: true } } } },
                },
            });

            if (approvedTx.length === 0) {
                return errorResponse('No approved collections found for this funder/date', 404);
            }
            if (transactionIds && approvedTx.length !== transactionIds.length) {
                return errorResponse('Some selected transactions are no longer pending allocation — refresh and try again', 409);
            }

            const principalAmount = approvedTx.reduce((sum, t) => sum + Number(t.principalAmount || 0), 0);
            const interestAmount = approvedTx.reduce((sum, t) => sum + Number(t.interestAmount || 0), 0);
            const funderName = approvedTx[0].loan?.funder?.funderName || 'own fund';

            const result = await prisma.$transaction(async (tx) => {
                return accountingPostingService.postEodCollectionAllocation({
                    tx,
                    branchId,
                    workingDateYmd: dateYmd,
                    funderId,
                    funderName,
                    principalAmount,
                    interestAmount,
                    transactionDate: dayStartUtc,
                    createdById: user.userId,
                    createdByRole: user.role,
                    transactionIds: approvedTx.map((t) => t.id),
                });
            });

            if (!result.posted) {
                return errorResponse(result.message || 'Already allocated for this funder/date', 409);
            }

            return successResponse(
                result,
                `Allocated ${funderName} collections to EOD (voucher${result.voucherNos.length > 1 ? 's' : ''} ${result.voucherNos.join(', ')})`
            );
        } catch (error) {
            console.error('[EOD Allocation] POST Error:', error);
            return errorResponse('Failed to allocate collections for EOD', 500);
        }
    })(request);
}
