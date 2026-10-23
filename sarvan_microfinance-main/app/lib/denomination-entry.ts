import { prisma } from '@/app/lib/prisma';
import {
    denominationMatchesFlooredCollection,
    floorToWholeRupeesForDenomination,
} from '@/app/lib/denomination-money';
import {
    denominationEntryDateFromWorkingInstant,
    getBranchCalendarDayHalfOpenUtc,
} from '@/app/lib/branch-financial-day';
import { isAmAssignedToBranch } from '@/app/lib/am-branch-utils';
import { isUserAssignedToBranch } from '@/app/lib/user-branch-assignments';
import { isHeadOfficeBranch } from '@/app/lib/head-office-branch';
import { getDaybookData } from '@/app/lib/actions/reports';
import { getKolkataCalendarYmd } from '@/app/lib/branch-lock';
import {
    INDEX_DISBURSEMENT_DUPLICATE_FEE_DESCRIPTIONS,
    INDEX_DISBURSEMENT_FUNDER_LEG_DESCRIPTION_PREFIX,
    INDEX_DISBURSEMENT_POSTING_MARKER_PREFIX,
    SAVINGS_REFUND_POSTING_MARKER_PREFIX,
} from '@/app/lib/services/accounting-posting.service';

// These mirror app/lib/actions/reports.ts's Daybook rules because they still drive
// this file's own "today only" totals (getBranchDayCreditTotal /
// getBranchDayDisbursementTotal, used for the collection/disbursement breakdown
// cards) — every rule below (types, `status: 'APPROVED'`, the per-type cash-amount
// field) must stay identical to that file for those two totals to keep tying out.
// The opening-balance component no longer duplicates the daybook's rules — it calls
// getDaybookData directly (see computeBranchCashBalanceThrough).
//
// REPAYMENT / PRECLOSURE / SAVINGS_COLLECTION are only posted to GL — and therefore
// only recognised by the Daybook closing balance — once "Allocate for EOD" runs and
// stamps LoanTransaction.eodAllocatedAt. So the denomination expected total gates
// those three on eodAllocatedAt too (EOD cash never shows a collection the Daybook
// hasn't booked yet); the un-allocated remainder is surfaced separately via
// getPendingEodAllocationTotal and blocks EOD close. FEE / PENALTY / ADJUSTMENT are
// counted directly by both sides and stay ungated.
const EOD_ALLOCATION_GATED_CREDIT_TYPES = ['REPAYMENT', 'PRECLOSURE', 'SAVINGS_COLLECTION'] as const;
const DIRECT_CREDIT_LOAN_TYPES = ['FEE', 'PENALTY', 'ADJUSTMENT'] as const;
// SAVINGS_REFUND is deliberately NOT in this list — unlike DISBURSEMENT (whose GL echo
// FinancialTransaction is excluded from getFinancialCashFlowForDay, so the cash-out must
// come from this LoanTransaction sum instead), a loan-advance refund's cash-out is read
// directly from its FinancialTransaction CASH_PAYMENT voucher (see
// SAVINGS_REFUND_POSTING_MARKER_PREFIX) — summing the LoanTransaction here too would
// double-count it, and relying on both staying same-day was fragile (see that marker's
// doc comment for the real incident this caused).
const DEBIT_LOAN_TYPES = ['DISBURSEMENT'] as const;

// Mirror of the markers in reports.ts — rows whose description starts with these
// are accounting GL echo postings and must never affect the cash balance.
// NULL descriptions are safe (never a GL echo), hence the OR: [{ description: null }, …] guard.
// Covers every AccountingPostingService marker still embedded directly in `description`
// (postEodCollectionAllocation / postEodLoanAdvanceAllocation / postEodClosureAllocation /
// postIndexDisbursementAggregate's legacy admission-fee marker). postEodFunderAllocation
// and postIndexDisbursementAggregate instead write their marker to the dedicated
// `postingMarker` column (see that Prisma field's doc comment) — those rows aren't caught
// by this description check at all; they're handled separately below, in
// getFinancialCashFlowForDay's own filter, which is NOT a blanket `postingMarker: null`
// (see the comment there for why postIndexDisbursementAggregate's HO Borrow leg must stay
// included while its other legs must stay excluded).
const GL_SHADOW_MARKERS = [
    '[POSTING:DISBURSEMENT:',
    '[POSTING:ADMISSION_FEE:',
    '[POSTING:EOD_COLLECTION:',
    '[POSTING:EOD_LOAN_ADVANCE:',
    '[POSTING:EOD_PRECLOSURE:',
    '[POSTING:EOD_WRITEOFF:',
];
const nullSafeShadowFilter = GL_SHADOW_MARKERS.map((m) => ({
    OR: [
        { description: null as string | null },
        { NOT: { description: { contains: m } } },
    ],
}));

function safeNum(value: unknown): number {
    if (value === null || value === undefined) return 0;
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

export {
    amountsMatchForDenomination,
    calculateDenominationTotal,
    denominationMatchesFlooredCollection,
    DENOMINATION_VALUES,
    EOD_DENOMINATION_CHECKLIST_CODE,
    floorToWholeRupeesForDenomination,
    normalizeDenominationCounts,
    roundAmountToPaise,
    type DenominationCounts,
} from '@/app/lib/denomination-money';

type ResolveBranchUser = {
    userId: string;
    branchId?: string | null;
    role?: string;
    /** JWT-embedded assigned-branch list, when present (see JWTPayload). */
    assignedBranchIds?: string[];
};

/**
 * Resolves a branch id that exists in `branches` (avoids FK errors when JWT or client
 * holds a stale id from another environment). Candidate order: `preferredIds` (e.g. query
 * param) → token branchId → DB user.branchId → role fallbacks (ADMIN: HO; else first
 * active branch). FDO/BM get no arbitrary fallback.
 */
export async function resolveBranchIdFromUser(
    user: ResolveBranchUser,
    preferredIds?: readonly (string | null | undefined)[]
): Promise<string | null> {
    const dbUser = await prisma.user.findUnique({
        where: { id: user.userId },
        select: { branchId: true, role: true },
    });
    const effectiveRole = user.role ?? dbUser?.role ?? '';

    const orderedCandidates: string[] = [];
    const push = (id: string | null | undefined) => {
        if (id && !orderedCandidates.includes(id)) {
            orderedCandidates.push(id);
        }
    };
    for (const id of preferredIds ?? []) {
        push(id);
    }
    push(user.branchId);
    push(dbUser?.branchId);

    if (orderedCandidates.length > 0) {
        const existing = await prisma.branch.findMany({
            where: { id: { in: orderedCandidates }, isActive: true },
            select: { id: true },
        });
        const ok = new Set(existing.map((b) => b.id));
        for (const id of orderedCandidates) {
            if (ok.has(id)) {
                return id;
            }
        }
    }

    const scopedToAssignment = effectiveRole === 'FDO' || effectiveRole === 'BRANCH_MANAGER';
    if (scopedToAssignment) {
        return null;
    }

    if (effectiveRole === 'ADMIN') {
        const ho = await prisma.branch.findFirst({
            where: {
                isActive: true,
                OR: [
                    { code: 'HO' },
                    { name: { equals: 'Head Office', mode: 'insensitive' } },
                ],
            },
            select: { id: true },
        });
        if (ho) {
            return ho.id;
        }
    }

    const firstBranch = await prisma.branch.findFirst({
        where: { isActive: true },
        orderBy: { code: 'asc' },
        select: { id: true },
    });

    return firstBranch?.id ?? null;
}

/**
 * Like {@link resolveBranchIdFromUser}, but only honors an explicit branch
 * override (e.g. a `?branchId=` query param from a branch picker) for a
 * branch the caller is actually allowed to look at:
 *  - ADMIN / ADMIN_NON_HO_BRANCH_SWITCH — any active branch.
 *  - AREA_MANAGER — only branches they're assigned to (AreaManagerBranch).
 *  - Any other role (BRANCH_MANAGER, FDO, custom RBAC roles, ...) — their own
 *    primary branch, or any branch explicitly assigned to them via
 *    UserBranchAssignment. A single-branch user (no assignment rows) has no
 *    override target beyond their own branch, so the override is silently
 *    ignored for them — never trusted from the client beyond what they're
 *    actually assigned.
 */
export async function resolveEodViewBranchId(
    user: ResolveBranchUser,
    requestedBranchId?: string | null
): Promise<string | null> {
    if (!requestedBranchId) {
        return resolveBranchIdFromUser(user);
    }

    if (user.role === 'ADMIN' || user.role === 'ADMIN_NON_HO_BRANCH_SWITCH') {
        return resolveBranchIdFromUser(user, [requestedBranchId]);
    }

    // Head Office–based users (e.g. a Sub Admin / custom RBAC role at HO) are
    // unrestricted — same rule as getPermittedBranchIds in permissions/branch-scope.ts.
    if (user.branchId && await isHeadOfficeBranch(user.branchId)) {
        return resolveBranchIdFromUser(user, [requestedBranchId]);
    }

    if (user.role === 'AREA_MANAGER') {
        const allowed = await isAmAssignedToBranch(user.userId, requestedBranchId);
        if (allowed) {
            return resolveBranchIdFromUser(user, [requestedBranchId]);
        }
        return resolveBranchIdFromUser(user);
    }

    const allowed =
        requestedBranchId === user.branchId ||
        (user.assignedBranchIds
            ? user.assignedBranchIds.includes(requestedBranchId)
            : await isUserAssignedToBranch(user.userId, requestedBranchId));
    if (allowed) {
        return resolveBranchIdFromUser(user, [requestedBranchId]);
    }

    return resolveBranchIdFromUser(user);
}

/**
 * Cash amount contributed by one grouped LoanTransaction type, using the exact
 * same per-type field as the daybook: REPAYMENT/PRECLOSURE use principal+interest
 * (not the raw `amount`, which can also include fees/penalty already reflected
 * elsewhere), FEE uses feesAmount, everything else falls back to `amount`.
 */
function cashAmountForLoanTypeGroup(g: {
    type: string;
    _sum: {
        principalAmount?: unknown;
        interestAmount?: unknown;
        feesAmount?: unknown;
        amount?: unknown;
    };
}): number {
    if (g.type === 'REPAYMENT' || g.type === 'PRECLOSURE') {
        return safeNum(g._sum.principalAmount) + safeNum(g._sum.interestAmount);
    }
    if (g.type === 'FEE') {
        return safeNum(g._sum.feesAmount ?? g._sum.amount);
    }
    return safeNum(g._sum.amount);
}

/**
 * Cash collected at loan write-off closure (paymentMode 'ADJUSTMENT', tracked
 * separately from the CASH-mode credit types above) within the given half-open
 * UTC window — mirrors the dedicated write-off aggregate in the daybook.
 */
async function getWriteOffCollectionTotal(
    branchId: string,
    gte: Date,
    lt: Date
): Promise<number> {
    const result = await prisma.loanTransaction.aggregate({
        where: {
            branchId,
            type: 'WRITEOFF',
            paymentMode: 'ADJUSTMENT',
            isReversed: false,
            status: 'APPROVED',
            transactionDate: { gte, lt },
        },
        _sum: { principalAmount: true, interestAmount: true },
    });
    return safeNum(result._sum.principalAmount) + safeNum(result._sum.interestAmount);
}

/**
 * Sum of branch cash credits for the branch calendar day containing `processDate`
 * (half-open UTC range in `branchCalendarTimeZone`).
 *
 * This is the **today's collection only** — does NOT include the opening balance.
 * Use `getExpectedDenominationTotal` for the full denomination gate check.
 *
 * REPAYMENT / PRECLOSURE / SAVINGS_COLLECTION are counted only once they have been
 * run through "Allocate for EOD" (`eodAllocatedAt` set) — the same trigger the
 * Daybook waits for. Approved-but-unallocated collection cash is reported by
 * `getPendingEodAllocationTotal` and blocks EOD close instead.
 */
export async function getBranchDayCreditTotal(
    branchId: string,
    processDate: Date,
    branchCalendarTimeZone: string = 'Asia/Kolkata'
): Promise<number> {
    const { dayStartUtc, dayEndExclusiveUtc } = getBranchCalendarDayHalfOpenUtc(
        processDate,
        branchCalendarTimeZone
    );

    const [gatedCreditGroups, directCreditGroups, writeOffCollected, admissionFees] = await Promise.all([
        prisma.loanTransaction.groupBy({
            by: ['type'],
            where: {
                branchId,
                paymentMode: 'CASH',
                isReversed: false,
                status: 'APPROVED',
                // Only collections already swept into an "Allocate for EOD" GL
                // posting — matches what the Daybook closing balance counts.
                eodAllocatedAt: { not: null },
                excludeFromEodAllocation: false,
                type: { in: [...EOD_ALLOCATION_GATED_CREDIT_TYPES] },
                transactionDate: {
                    gte: dayStartUtc,
                    lt: dayEndExclusiveUtc,
                },
            },
            _sum: { principalAmount: true, interestAmount: true, feesAmount: true, amount: true },
        }),
        prisma.loanTransaction.groupBy({
            by: ['type'],
            where: {
                branchId,
                paymentMode: 'CASH',
                isReversed: false,
                status: 'APPROVED',
                type: { in: [...DIRECT_CREDIT_LOAN_TYPES] },
                transactionDate: {
                    gte: dayStartUtc,
                    lt: dayEndExclusiveUtc,
                },
            },
            _sum: { principalAmount: true, interestAmount: true, feesAmount: true, amount: true },
        }),
        getWriteOffCollectionTotal(branchId, dayStartUtc, dayEndExclusiveUtc),
        prisma.client.aggregate({
            _sum: { admissionFees: true },
            where: {
                center: { branchId },
                admissionFees: { gt: 0 },
                createdAt: {
                    gte: dayStartUtc,
                    lt: dayEndExclusiveUtc,
                },
            },
        }),
    ]);

    const loanCreditsTotal = [...gatedCreditGroups, ...directCreditGroups].reduce(
        (sum, g) => sum + cashAmountForLoanTypeGroup(g),
        0
    );

    return loanCreditsTotal + writeOffCollected + Number(admissionFees._sum.admissionFees || 0);
}

/**
 * Cash value of collections for the branch calendar day that are APPROVED but have
 * NOT yet been run through "Allocate for EOD" (`eodAllocatedAt` still null). Exact
 * complement of the allocation-gated portion of `getBranchDayCreditTotal`: while it
 * is non-zero the EOD expected cash total deliberately omits this cash, and the
 * "EOD Allocation" checklist item blocks EOD close — the branch must allocate first
 * rather than close with collection cash the GL/Daybook hasn't booked.
 */
export async function getPendingEodAllocationTotal(
    branchId: string,
    processDate: Date,
    branchCalendarTimeZone: string = 'Asia/Kolkata'
): Promise<number> {
    const { dayStartUtc, dayEndExclusiveUtc } = getBranchCalendarDayHalfOpenUtc(
        processDate,
        branchCalendarTimeZone
    );

    const groups = await prisma.loanTransaction.groupBy({
        by: ['type'],
        where: {
            branchId,
            paymentMode: 'CASH',
            isReversed: false,
            status: 'APPROVED',
            eodAllocatedAt: null,
            excludeFromEodAllocation: false,
            type: { in: [...EOD_ALLOCATION_GATED_CREDIT_TYPES] },
            transactionDate: {
                gte: dayStartUtc,
                lt: dayEndExclusiveUtc,
            },
        },
        _sum: { principalAmount: true, interestAmount: true, feesAmount: true, amount: true },
    });

    return groups.reduce((sum, g) => sum + cashAmountForLoanTypeGroup(g), 0);
}

/**
 * Total cash disbursed to borrowers (loan disbursements paid in cash) by the branch
 * on the given UTC half-open calendar-day window.
 *
 * This is cash OUT — it reduces the denomination closing balance. It's tracked via
 * LoanTransaction.type = 'DISBURSEMENT' and is excluded from getBranchDayCreditTotal
 * (which only counts credit/collection events). The GL echo FinancialTransaction for
 * disbursements is also excluded from getFinancialCashFlowForDay via GL_SHADOW_MARKERS,
 * so we must account for the cash outflow here separately to avoid an understated
 * denomination balance. (Loan-advance refunds — type SAVINGS_REFUND — are NOT summed
 * here; their cash-out comes from the FinancialTransaction voucher instead, see
 * SAVINGS_REFUND_POSTING_MARKER_PREFIX.)
 */
async function getBranchDayDisbursementTotal(
    branchId: string,
    dayStartUtc: Date,
    dayEndExclusiveUtc: Date
): Promise<number> {
    const result = await prisma.loanTransaction.aggregate({
        _sum: { amount: true },
        where: {
            branchId,
            paymentMode: 'CASH',
            isReversed: false,
            status: 'APPROVED',
            type: { in: [...DEBIT_LOAN_TYPES] },
            transactionDate: {
                gte: dayStartUtc,
                lt: dayEndExclusiveUtc,
            },
        },
    });
    return Number(result._sum.amount || 0);
}

// A genuine manual voucher never sets `postingMarker` — every non-null value is one of
// exactly three system posters (see accounting-posting.service.ts):
//   - postEodFunderAllocation (marker EOD_FUNDER_POSTING_MARKER_PREFIX): every leg is a GL
//     echo of a collection/preclosure/write-off already counted via todayCollection on the
//     day it actually happened (which can differ from the day the EOD allocation runs) —
//     always excluded. It simply falls through every OR branch below (non-null marker that
//     doesn't match either allow-listed prefix), so it needs no explicit branch of its own.
//   - postIndexDisbursementAggregate (marker INDEX_DISBURSEMENT_POSTING_MARKER_PREFIX): only
//     SOME of its legs are echoes of LoanTransaction cash already counted via
//     todayCollection/todayDisbursement (the funder-disbursement CASH_PAYMENT leg and the
//     Admission/Processing/Insurance fee CASH_RECEIPT legs) — those are excluded
//     individually, by description. Its HO Borrow CASH_RECEIPT leg has NO LoanTransaction
//     equivalent anywhere else — it's the branch's only record of that cash arriving — so it
//     must stay INCLUDED, or the expected denomination total silently understates by the HO
//     Borrow amount every disbursement day.
//   - postSavingsRefundPayment (marker SAVINGS_REFUND_POSTING_MARKER_PREFIX): this voucher is
//     the branch's ONLY record of the refund's cash outflow — the paired LoanTransaction
//     (type SAVINGS_REFUND) is deliberately NOT summed by getBranchDayDisbursementTotal (see
//     that function's doc comment), so this marker must always stay INCLUDED, unconditionally.
const nonEchoPostingMarkerFilter = {
    OR: [
        { postingMarker: null as string | null },
        {
            postingMarker: { startsWith: INDEX_DISBURSEMENT_POSTING_MARKER_PREFIX },
            NOT: {
                OR: [
                    { description: { startsWith: INDEX_DISBURSEMENT_FUNDER_LEG_DESCRIPTION_PREFIX } },
                    { description: { in: [...INDEX_DISBURSEMENT_DUPLICATE_FEE_DESCRIPTIONS] } },
                ],
            },
        },
        { postingMarker: { startsWith: SAVINGS_REFUND_POSTING_MARKER_PREFIX } },
    ],
};

/**
 * Cash from FinancialTransaction entries for the branch on the given UTC half-open
 * calendar-day window, returned as gross `cashIn` (CASH_RECEIPT), gross `cashOut`
 * (CASH_PAYMENT) and `net` (cashIn − cashOut) so the EOD breakdown can show the
 * two directions separately instead of a single signed figure.
 *
 * Included:  HO Borrow receipts (in), HO Remittance payments (out), EB charges (out),
 *            any other manual cash receipts/payments — but only once fully
 *            APPROVED through the 3-level maker-checker (mirrors the same gate
 *            in app/lib/actions/reports.ts's Cash Book/Daybook query). A voucher
 *            still sitting in PENDING_APPROVAL / PENDING_AM_APPROVAL hasn't
 *            actually moved cash yet and must not inflate the expected total.
 * Excluded:  GL echo rows — either the description starts with a known posting marker
 *            (older AccountingPostingService postings), or the row is one of the specific
 *            postIndexDisbursementAggregate/postEodFunderAllocation legs that duplicate
 *            LoanTransaction cash counted elsewhere — see nonEchoPostingMarkerFilter above.
 *            In particular the "Allocate for EOD" collection receipt legs (OWN FUND
 *            PRINCIPAL / INTEREST etc.) are excluded here because that cash is already
 *            counted under `todayCollection` — it must not be double-added as a voucher.
 *
 * This is the component that reconciles the daybook closing balance with the
 * denomination expected total when branches make same-day cash transfers.
 */
async function getFinancialCashFlowForDay(
    branchId: string,
    dayStartUtc: Date,
    dayEndExclusiveUtc: Date
): Promise<{ cashIn: number; cashOut: number; net: number }> {
    const [receipts, payments] = await Promise.all([
        prisma.financialTransaction.aggregate({
            where: {
                branchId,
                isActive: true,
                approvalStatus: 'APPROVED',
                type: 'CASH_RECEIPT',
                transactionDate: { gte: dayStartUtc, lt: dayEndExclusiveUtc },
                AND: [...nullSafeShadowFilter, nonEchoPostingMarkerFilter],
            },
            _sum: { amount: true },
        }),
        prisma.financialTransaction.aggregate({
            where: {
                branchId,
                isActive: true,
                approvalStatus: 'APPROVED',
                type: 'CASH_PAYMENT',
                transactionDate: { gte: dayStartUtc, lt: dayEndExclusiveUtc },
                AND: [...nullSafeShadowFilter, nonEchoPostingMarkerFilter],
            },
            _sum: { amount: true },
        }),
    ]);
    const cashIn = Number(receipts._sum?.amount ?? 0);
    const cashOut = Number(payments._sum?.amount ?? 0);
    return { cashIn, cashOut, net: cashIn - cashOut };
}

/**
 * The branch's true cash ledger balance as of the start of the calendar day
 * containing `throughExclusiveUtc`, taken directly from the daybook
 * (`getDaybookData` in app/lib/actions/reports.ts) instead of a hand-rolled
 * duplicate of its rules. Used as the denomination opening balance INSTEAD OF
 * the previous day's saved DenominationEntry — a saved entry can be edited to
 * a mismatched figure, and any prior day's mismatch would otherwise
 * permanently carry forward and corrupt every following day's expected
 * total. Reusing the daybook directly (rather than mirroring its logic) means
 * the expected total always ties out with it, including the Cash-in-Hand
 * opening-balance bridge and per-branch opening-date truncation, with no risk
 * of the two implementations drifting apart again.
 */
async function computeBranchCashBalanceThrough(
    branchId: string,
    throughExclusiveUtc: Date
): Promise<number> {
    const ymd = getKolkataCalendarYmd(throughExclusiveUtc);
    const daybook = await getDaybookData(ymd, ymd, branchId, 1, 1, false, true);
    return daybook.openingBalance;
}

/**
 * Full expected denomination total for EOD:
 *   openingBalance     (full branch cash ledger recomputed through the start of this day)
 * + todayCollection    (fees + admission fees in cash today, plus REPAYMENT / PRECLOSURE /
 *                       SAVINGS_COLLECTION only once "Allocate for EOD" has booked them)
 * + financialCashIn    (approved cash-receipt vouchers today — HO Borrow etc., excluding
 *                       the "Allocate for EOD" collection legs already in todayCollection)
 * − financialCashOut   (approved cash-payment vouchers today — HO Remittance, EB charges, …)
 * − todayDisbursement  (cash disbursed to borrowers today — cash leaves the branch)
 *
 * The result matches the daybook closing balance for the day. Approved collections
 * still awaiting "Allocate for EOD" are excluded here on purpose — see
 * `getPendingEodAllocationTotal`, which blocks EOD close until they are allocated.
 */
export async function getExpectedDenominationTotal(
    branchId: string,
    processDate: Date,
    branchCalendarTimeZone: string = 'Asia/Kolkata'
): Promise<{
    todayCollection: number;
    openingBalance: number;
    financialCashIn: number;
    financialCashOut: number;
    financialNetCash: number;
    todayDisbursement: number;
    total: number;
}> {
    const { dayStartUtc, dayEndExclusiveUtc } =
        getBranchCalendarDayHalfOpenUtc(processDate, branchCalendarTimeZone);

    const [todayCollection, openingBalance, financialCashFlow, todayDisbursement] = await Promise.all([
        getBranchDayCreditTotal(branchId, processDate, branchCalendarTimeZone),
        computeBranchCashBalanceThrough(branchId, dayStartUtc),
        getFinancialCashFlowForDay(branchId, dayStartUtc, dayEndExclusiveUtc),
        getBranchDayDisbursementTotal(branchId, dayStartUtc, dayEndExclusiveUtc),
    ]);

    return {
        todayCollection,
        openingBalance,
        financialCashIn: financialCashFlow.cashIn,
        financialCashOut: financialCashFlow.cashOut,
        financialNetCash: financialCashFlow.net,
        todayDisbursement,
        total: openingBalance + todayCollection + financialCashFlow.net - todayDisbursement,
    };
}

export async function getDenominationValidation(
    branchId: string,
    workingDate: Date,
    branchCalendarTimeZone: string = 'Asia/Kolkata'
) {
    const entryDate = denominationEntryDateFromWorkingInstant(workingDate, branchCalendarTimeZone);

    // Expected = opening balance + today's (allocated) collection + financial net
    // cash − today's disbursements. `pendingEodAllocation` is the approved-but-
    // unallocated collection cash deliberately left OUT of that total.
    const [
        { todayCollection, openingBalance, todayDisbursement, total: expectedAmountRaw },
        pendingEodAllocation,
    ] = await Promise.all([
        getExpectedDenominationTotal(branchId, workingDate, branchCalendarTimeZone),
        getPendingEodAllocationTotal(branchId, workingDate, branchCalendarTimeZone),
    ]);
    const expectedAmount = floorToWholeRupeesForDenomination(expectedAmountRaw);

    const entry = await prisma.denominationEntry.findUnique({
        where: {
            branchId_entryDate: {
                branchId,
                entryDate,
            },
        },
    });

    const enteredAmount = Number(entry?.totalAmount || 0);
    const matchesExpected =
        Boolean(entry) &&
        denominationMatchesFlooredCollection(enteredAmount, expectedAmountRaw);

    return {
        entryDate,
        expectedAmount,
        expectedAmountRaw,
        openingBalance,
        todayCollection,
        todayDisbursement,
        pendingEodAllocation,
        entry,
        enteredAmount,
        matchesExpected,
    };
}
