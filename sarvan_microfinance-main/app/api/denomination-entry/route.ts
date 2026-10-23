import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { withRole, errorResponse, successResponse, handleCorsPreflight } from '@/app/lib/api-utils';
import {
    calculateDenominationTotal,
    denominationMatchesFlooredCollection,
    floorToWholeRupeesForDenomination,
    getExpectedDenominationTotal,
    getPendingEodAllocationTotal,
    normalizeDenominationCounts,
    resolveBranchIdFromUser,
    resolveEodViewBranchId,
} from '@/app/lib/denomination-entry';
import { parseDenominationEntryDateUtc } from '@/app/lib/branch-financial-day';
import { assertBranchNotLocked } from '@/app/lib/branch-lock';

const DEFAULT_BRANCH_CALENDAR_TZ = 'Asia/Kolkata';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/denomination-entry?date=YYYY-MM-DD&branchId=xxx
 * Fetch denomination entry for a specific date and branch
 */
export async function GET(req: NextRequest) {
    return withRole(
        ['FDO', 'ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'],
        async (request, user) => {
            const { searchParams } = new URL(request.url);
            const date = searchParams.get('date');
            const branchId = searchParams.get('branchId');

            if (!date) {
                return errorResponse('Date is required', 400);
            }

            // Admin: any branch. Area Manager: only branches they're assigned to.
            // Everyone else (FDO included): their own or UserBranchAssignment branches —
            // an unassigned branchId falls back to their own branch.
            const effectiveBranchId = await resolveEodViewBranchId(user, branchId);

            if (!effectiveBranchId) {
                return errorResponse('Branch not assigned to this user', 400);
            }

            let entryDate: Date;
            try {
                entryDate = parseDenominationEntryDateUtc(date);
            } catch {
                return errorResponse('Invalid date format (use YYYY-MM-DD)', 400);
            }

            const entry = await prisma.denominationEntry.findUnique({
                where: {
                    branchId_entryDate: {
                        branchId: effectiveBranchId,
                        entryDate: entryDate,
                    },
                },
                include: {
                    branch: { select: { id: true, name: true, code: true } },
                    createdBy: { select: { id: true, firstName: true, lastName: true } },
                },
            });

            // Expected = opening balance + today's loan collection− today's disbursements  + financial net cash
            // (HO Borrow +, HO Remittance −, EB charges −, other cash payments −)
            // REPAYMENT/PRECLOSURE/SAVINGS_COLLECTION only count once "Allocate for EOD"
            // has booked them; `pendingEodAllocation` is the approved-but-unallocated rest.
            const [
                {
                    todayCollection,
                    openingBalance,
                    financialCashIn,
                    financialCashOut,
                    financialNetCash,
                    todayDisbursement,
                    total: expectedAmountRaw,
                },
                pendingEodAllocation,
            ] = await Promise.all([
                getExpectedDenominationTotal(effectiveBranchId, entryDate, DEFAULT_BRANCH_CALENDAR_TZ),
                getPendingEodAllocationTotal(effectiveBranchId, entryDate, DEFAULT_BRANCH_CALENDAR_TZ),
            ]);
            const expectedAmount = floorToWholeRupeesForDenomination(expectedAmountRaw);
            const enteredAmount = Number(entry?.totalAmount || 0);

            return successResponse(
                {
                    entry,
                    expectedAmount,
                    enteredAmount,
                    openingBalance,
                    todayCollection,
                    todayDisbursement,
                    financialCashIn,
                    financialCashOut,
                    financialNetCash,
                    pendingEodAllocation,
                    workingDateYmd: date.trim(),
                    branchCalendarTimeZone: DEFAULT_BRANCH_CALENDAR_TZ,
                    amountMatches:
                        Boolean(entry) &&
                        denominationMatchesFlooredCollection(enteredAmount, expectedAmountRaw),
                },
                entry ? 'Denomination entry found' : 'No entry for this date'
            );
        }
    )(req);
}

/**
 * POST /api/denomination-entry
 * Create or update denomination entry for a specific date and branch
 * Upsert logic: if entry exists for branch+date, update it; otherwise create
 */
export async function POST(req: NextRequest) {
    return withRole(
        ['FDO', 'BRANCH_MANAGER', 'ADMIN'],
        async (request, user) => {
            const body = await request.json();
            const { date, branchId, d500, d100, d200, d50, d20, d10, d5, d2, d1, remarks } = body;

            if (!date) {
                return errorResponse('Date is required', 400);
            }

            // Admin: any branch (via body.branchId). Area Manager: only branches
            // they're assigned to. Everyone else (BM/FDO): always their own branch.
            const effectiveBranchId =
                user.role === 'FDO'
                    ? await resolveBranchIdFromUser(user)
                    : await resolveEodViewBranchId(user, branchId);
            if (!effectiveBranchId) {
                return errorResponse('Branch not assigned to this user', 400);
            }

            const lockGuard = await assertBranchNotLocked(effectiveBranchId);
            if (lockGuard) {
                return lockGuard;
            }

            let entryDate: Date;
            try {
                entryDate = parseDenominationEntryDateUtc(date);
            } catch {
                return errorResponse('Invalid date format (use YYYY-MM-DD)', 400);
            }

            const counts = normalizeDenominationCounts({ d500, d200, d100, d50, d20, d10, d5, d2, d1 });
            const totalAmount = calculateDenominationTotal(counts);

            // Expected = opening balance (prev day's denomination total) + today's collection
            const [
                {
                    todayCollection,
                    openingBalance,
                    financialCashIn,
                    financialCashOut,
                    financialNetCash,
                    todayDisbursement,
                    total: expectedAmountRaw,
                },
                pendingEodAllocation,
            ] = await Promise.all([
                getExpectedDenominationTotal(effectiveBranchId, entryDate, DEFAULT_BRANCH_CALENDAR_TZ),
                getPendingEodAllocationTotal(effectiveBranchId, entryDate, DEFAULT_BRANCH_CALENDAR_TZ),
            ]);
            const expectedAmount = floorToWholeRupeesForDenomination(expectedAmountRaw);
            const amountMatches = denominationMatchesFlooredCollection(totalAmount, expectedAmountRaw);

            // Hard gate — approved collection cash still awaiting "Allocate for EOD" is
            // not booked to GL / the Daybook, so it is excluded from the expected total
            // above. Saving now (the count would just match the understated expected,
            // e.g. 0 vs 0) would let EOD close with that cash dropped. Block the save
            // until it is allocated. No role bypass.
            if (pendingEodAllocation > 0) {
                return errorResponse(
                    `₹${pendingEodAllocation.toFixed(2)} of collection is not yet allocated to EOD. Allocate it in Collections → Approval → Allocate for EOD before saving the denomination.`,
                    400
                );
            }

            // Hard gate — no role, including ADMIN, may save a mismatched count. Nothing
            // is persisted; the caller must recount or the underlying transactions must be
            // fixed so the expected total is correct.
            if (!amountMatches) {
                return errorResponse(
                    'Denomination is unmatched — entered total does not match the expected cash balance. Recount and try again.',
                    400
                );
            }

            const entry = await prisma.denominationEntry.upsert({
                where: {
                    branchId_entryDate: {
                        branchId: effectiveBranchId,
                        entryDate: entryDate,
                    },
                },
                create: {
                    branchId: effectiveBranchId,
                    entryDate: entryDate,
                    ...counts,
                    upi: 0,
                    totalAmount: totalAmount,
                    remarks: remarks || null,
                    createdById: user.userId,
                },
                update: {
                    ...counts,
                    upi: 0,
                    totalAmount: totalAmount,
                    remarks: remarks || null,
                },
                include: {
                    branch: { select: { id: true, name: true, code: true } },
                    createdBy: { select: { id: true, firstName: true, lastName: true } },
                },
            });

            return successResponse(
                {
                    entry,
                    expectedAmount,
                    openingBalance,
                    todayDisbursement,
                    todayCollection,
                    financialCashIn,
                    financialCashOut,
                    financialNetCash,
                    pendingEodAllocation,
                    enteredAmount: totalAmount,
                    amountMatches,
                },
                'Denomination entry saved successfully'
            );
        }
    )(req);
}
