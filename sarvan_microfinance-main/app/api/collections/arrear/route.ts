import { NextRequest } from 'next/server';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
} from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { format } from 'date-fns';
import { assertBranchNotLocked } from '@/app/lib/branch-lock';
import { allocateTransactionLines } from '@/app/lib/loan-transaction-lines';
import { pendingClosureAllocationLoanCondition } from '@/app/lib/eod-closure-allocation';
import {
    getKolkataCalendarYmd,
    getKolkataDayEndExclusiveUtc,
    parseKolkataAttendanceDateYmd,
} from '@/app/lib/branch-lock';
import { getBranchWorkingDayWindow } from '@/app/lib/branch-working-day-guard';
import { parseDenominationEntryDateUtc } from '@/app/lib/branch-financial-day';
import { round2, NON_OUTSTANDING_SCHEDULE_STATUSES } from '@/app/lib/collections/demand-calculation';
import { getPendingScheduleAmounts } from '@/app/lib/collections/pending-schedule-amounts';
import { checkCenterAccess, buildFdoCenterScope } from '@/app/lib/filters/fdo-center-scope';
import {
    normalizeDenominationCounts,
    calculateDenominationTotal,
    denominationMatchesFlooredCollection,
} from '@/app/lib/denomination-money';
import {
    uploadCollectionMeetingPhoto,
    deleteCollectionMeetingPhoto,
} from '@/app/lib/storage/collection-meeting-storage';
import { resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';
import { getLoanAdvanceEnabled } from '@/app/lib/loan-advance-config';
import { compareMemberIds } from '@/app/lib/member-id-sort';

const ALLOWED_MEETING_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const ARREAR_BATCH_TX_TIMEOUT_MS = 30_000;
const ARREAR_MAX_ITEMS_PER_BATCH = 100;

type KolkataDayHalfOpenUtc = {
    dayStartUtc: Date;
    dayEndExclusiveUtc: Date;
};

const getKolkataDayHalfOpenUtcFromYmd = (ymd: string): KolkataDayHalfOpenUtc => {
    const dayStartUtc = parseKolkataAttendanceDateYmd(ymd);
    const dayEndExclusiveUtc = getKolkataDayEndExclusiveUtc(dayStartUtc);
    return { dayStartUtc, dayEndExclusiveUtc };
};

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/collections/arrear
 * Fetch arrear-only collection data for a center on a specific date.
 * Only returns loans with overdue (past-due) installments.
 * Query params: centerId, collectionDate
 * Special mode: ?mode=pending returns pending arrear batches for the branch.
 */
export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const mode = searchParams.get('mode');

            // ── Pending mode: list all pending arrear batches for the branch ──
            if (mode === 'pending') {
                // Multi-branch aware: an AM (AreaManagerBranch) or any other role
                // explicitly assigned multiple branches (UserBranchAssignment) sees
                // pending batches across ALL of their assigned branches, not just
                // whichever one is currently active. HO-based users are unrestricted.
                const scopedBranchIds = await resolveScopedBranchIds(user);

                if (scopedBranchIds !== null && scopedBranchIds.length === 0
                    && user.role !== 'ADMIN' && user.role !== 'AREA_MANAGER') {
                    return errorResponse('No branch associated with user', 400);
                }

                const whereClause: Record<string, unknown> = {
                    type: 'REPAYMENT',
                    collectionType: 'Arrear Collection',
                    status: { in: ['PENDING', 'APPROVED', 'REJECTED'] },
                    collectionBatchId: { not: null },
                };
                if (scopedBranchIds !== null && scopedBranchIds.length > 0) {
                    whereClause.branchId = scopedBranchIds.length === 1
                        ? scopedBranchIds[0]
                        : { in: scopedBranchIds };
                }

                // FDOs may only see pending batches for centers assigned to them,
                // not the whole branch's pending arrear batches.
                if (user.role === 'FDO') {
                    const fdoCenters = await prisma.center.findMany({
                        where: buildFdoCenterScope(user),
                        select: { id: true },
                    });
                    whereClause.centerId = { in: fdoCenters.map((c) => c.id) };
                }

                const transactions = await prisma.loanTransaction.findMany({
                    where: whereClause as any,
                    orderBy: { transactionDate: 'desc' },
                    select: {
                        id: true,
                        transactionId: true,
                        collectionBatchId: true,
                        amount: true,
                        status: true,
                        transactionDate: true,
                        principalAmount: true,
                        interestAmount: true,
                        client: {
                            select: { id: true, firstName: true, lastName: true, clientId: true },
                        },
                        loan: {
                            select: { id: true, loanNumber: true },
                        },
                        center: {
                            select: { id: true, name: true, code: true },
                        },
                        collectedBy: {
                            select: { id: true, firstName: true, lastName: true },
                        },
                    },
                });

                // Group by batchId
                const batchMap = new Map<string, {
                    batchId: string;
                    status: string;
                    transactionDate: Date;
                    centerName: string;
                    centerCode: string;
                    totalAmount: number;
                    collectedByName: string;
                    items: Array<{
                        transactionId: string;
                        clientName: string;
                        clientCode: string;
                        loanNumber: string;
                        amount: number;
                        principalAmount: number;
                        interestAmount: number;
                        status: string;
                    }>;
                }>();

                for (const tx of transactions) {
                    const bid = tx.collectionBatchId!;
                    if (!batchMap.has(bid)) {
                        batchMap.set(bid, {
                            batchId: bid,
                            status: tx.status,
                            transactionDate: tx.transactionDate,
                            centerName: tx.center?.name ?? '',
                            centerCode: tx.center?.code ?? '',
                            totalAmount: 0,
                            collectedByName: tx.collectedBy
                                ? `${tx.collectedBy.firstName} ${tx.collectedBy.lastName}`
                                : 'Unknown',
                            items: [],
                        });
                    }
                    const entry = batchMap.get(bid)!;
                    entry.totalAmount += Number(tx.amount);
                    entry.items.push({
                        transactionId: tx.transactionId,
                        clientName: `${tx.client?.firstName ?? ''} ${tx.client?.lastName ?? ''}`.trim(),
                        clientCode: tx.client?.clientId ?? '',
                        loanNumber: tx.loan?.loanNumber ?? '',
                        amount: Number(tx.amount),
                        principalAmount: Number(tx.principalAmount ?? 0),
                        interestAmount: Number(tx.interestAmount ?? 0),
                        status: tx.status,
                    });
                }

                const batches = Array.from(batchMap.values()).map(b => ({
                    ...b,
                    totalAmount: round2(b.totalAmount),
                }));

                return successResponse({ batches }, `Found ${batches.length} arrear collection batch(es)`);
            }

            // ── Normal mode: fetch arrear data for center + date ──
            const centerId = searchParams.get('centerId');
            const collectionDate = searchParams.get('collectionDate');

            if (!centerId) return errorResponse('Center ID is required', 400);
            if (!collectionDate) return errorResponse('Collection date is required', 400);

            const trimmedCollectionDate = String(collectionDate).trim();
            if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmedCollectionDate)) {
                return errorResponse('Invalid collection date format (expected YYYY-MM-DD)', 400);
            }

            const { dayStartUtc: collectionDayStartUtc, dayEndExclusiveUtc: collectionDayEndExclusiveUtc } =
                getKolkataDayHalfOpenUtcFromYmd(trimmedCollectionDate);
            const todayYmd = getKolkataCalendarYmd(new Date());
            const { dayStartUtc: todayStartUtc } = getKolkataDayHalfOpenUtcFromYmd(todayYmd);

            if (collectionDayStartUtc > todayStartUtc) {
                return errorResponse('Cannot load arrear data for a future date', 400);
            }

            const center = await prisma.center.findUnique({
                where: { id: centerId },
                select: { id: true, name: true, code: true, branchId: true, fdoId: true },
            });
            if (!center) return errorResponse('Center not found', 404);

            const accessError = await checkCenterAccess(user, center);
            if (accessError) {
                return errorResponse(accessError, 403);
            }

            const loans = await prisma.loan.findMany({
                where: {
                    centerId,
                    isActive: true,
                    disbursementStatus: 'DISBURSED',
                    NOT: [
                        { deathMarking: { some: { isReversed: false, demandRequired: false } } },
                        pendingClosureAllocationLoanCondition(),
                    ],
                },
                include: {
                    client: {
                        select: { id: true, firstName: true, lastName: true, clientId: true, mobileNumber: true, phone: true },
                    },
                    loanProduct: {
                        select: { loanProductType: { select: { name: true } } },
                    },
                    deathMarking: {
                        where: { isReversed: false },
                        select: {
                            deceasedPersonType: true,
                            deceasedPersonName: true,
                            deathReason: true,
                            deathDate: true,
                            placeOfDeath: true,
                            demandRequired: true,
                        }
                    },
                    // Fetch only schedules strictly past-due before the selected date (true
                    // arrears only). Excludes only WAIVED/CLOSED, not PAID — see
                    // NON_OUTSTANDING_SCHEDULE_STATUSES for why status alone can't be
                    // trusted to mean "nothing left to collect."
                    schedules: {
                        where: {
                            dueDate: { lt: collectionDayStartUtc },
                            status: { notIn: NON_OUTSTANDING_SCHEDULE_STATUSES },
                        },
                        orderBy: { dueDate: 'asc' },
                    },
                },
            });

            const scheduleIds = loans.flatMap(l => l.schedules.map(s => s.id));
            const loanIds = loans.map(l => l.id);

            // Two REPAYMENT signals, same split as app/api/collections/demand/route.ts:
            // - `pendingByScheduleId` (any still-PENDING collection, regardless of
            //   which day it was submitted): netted OUT of remainingDue below — an
            //   APPROVED line already updated schedule.principalPaid/interestPaid,
            //   so including it here too would double-count it. A reverted line's schedule
            //   fields are already restored by the revert, so excluding APPROVED/reversed
            //   ones here is also what makes a reverted collection show as fully due again.
            //   A REJECTED line is naturally excluded too, so a rejected collection's
            //   amount becomes due again automatically.
            // - `collectedLines` (PENDING+APPROVED, isReversed:false, today only): purely
            //   informational "Already Collected" display total — never fed into the
            //   remaining-due math.
            const [pendingByScheduleId, collectedLines, osInterestAggregates] = await Promise.all([
                getPendingScheduleAmounts(scheduleIds),
                scheduleIds.length
                    ? prisma.loanTransactionLine.findMany({
                        where: {
                            scheduleId: { in: scheduleIds },
                            transaction: {
                                centerId,
                                type: 'REPAYMENT',
                                status: { in: ['PENDING', 'APPROVED'] as any },
                                isReversed: false,
                                transactionDate: {
                                    gte: collectionDayStartUtc,
                                    lt: collectionDayEndExclusiveUtc,
                                },
                            },
                        },
                        select: { scheduleId: true, lineTotal: true },
                    })
                    : Promise.resolve([]),
                loanIds.length
                    ? prisma.loanSchedule.groupBy({
                        by: ['loanId'],
                        where: { loanId: { in: loanIds } },
                        _sum: { interestDue: true, interestPaid: true },
                    })
                    : Promise.resolve([]),
            ]);

            const osInterestByLoanId = new Map<string, number>();
            for (const agg of osInterestAggregates) {
                const totalInterestDue = Number(agg._sum.interestDue ?? 0);
                const totalInterestPaid = Number(agg._sum.interestPaid ?? 0);
                osInterestByLoanId.set(agg.loanId, round2(totalInterestDue - totalInterestPaid));
            }

            const collectedByScheduleId = new Map<string, number>();
            for (const line of collectedLines) {
                const prev = collectedByScheduleId.get(line.scheduleId) ?? 0;
                collectedByScheduleId.set(line.scheduleId, prev + Number(line.lineTotal || 0));
            }

            const collectionItems = [];
            let totalDemandSum = 0;
            let totalClients = 0;
            let totalLoanOutstanding = 0;
            let totalOpeningArrears = 0;
            let summaryArrearPrincipal = 0;
            let summaryArrearInterest = 0;

            for (const loan of loans) {
                // Skip loans with no overdue schedules
                if (loan.schedules.length === 0) continue;

                const activeDeathMarking = loan.deathMarking[0] ?? null;

                const osPrincipal = round2(Number(loan.amount) - Number(loan.principalPaid || 0));
                const osInterest = osInterestByLoanId.get(loan.id) ?? 0;
                totalLoanOutstanding += osPrincipal;

                let loanArrearPri = 0;
                let loanArrearInt = 0;
                let loanFees = 0;
                let loanPenalties = 0;
                let loanTotalDemand = 0;
                let loanCollected = 0;
                const loanScheduleIds: string[] = [];
                let displayInstNo = 0;

                for (const schedule of loan.schedules) {
                    const principalRemaining = Number(schedule.principalDue) - Number(schedule.principalPaid || 0);
                    const interestRemaining = Number(schedule.interestDue) - Number(schedule.interestPaid || 0);
                    const feesRemaining = Number(schedule.feesDue || 0) - Number(schedule.feesPaid || 0);
                    const penaltiesRemaining = Number(schedule.penaltiesDue || 0) - Number(schedule.penaltiesPaid || 0);

                    const grossDue = principalRemaining + interestRemaining + feesRemaining + penaltiesRemaining;
                    // Netting math uses any still-PENDING (not-yet-approved) lines,
                    // regardless of age — APPROVED lines are already reflected in
                    // principalPaid/interestPaid above, so folding them in here too
                    // would double-count them (and would keep a reverted collection
                    // looking "already collected" even after its schedule fields were
                    // correctly restored by the revert).
                    const pendingCollected = pendingByScheduleId.get(schedule.id)?.total ?? 0;
                    const remainingDue = Math.max(0, grossDue - pendingCollected);
                    // Display-only "already collected" total (informational), separate
                    // from the netting math above.
                    const displayCollected = collectedByScheduleId.get(schedule.id) ?? 0;

                    if (remainingDue <= 0 && pendingCollected <= 0) continue;

                    loanScheduleIds.push(schedule.id);
                    loanCollected += displayCollected;

                    // All schedules here are overdue (dueDate < collectionDate)
                    loanArrearPri += principalRemaining;
                    loanArrearInt += interestRemaining;
                    loanFees += feesRemaining;
                    loanPenalties += penaltiesRemaining;
                    loanTotalDemand += remainingDue;

                    if (!displayInstNo) displayInstNo = schedule.installmentNo;
                }

                if (loanScheduleIds.length === 0) continue;
                if (!displayInstNo) displayInstNo = loan.schedules[0].installmentNo;

                loanArrearPri = round2(loanArrearPri);
                loanArrearInt = round2(loanArrearInt);
                loanFees = round2(loanFees);
                loanPenalties = round2(loanPenalties);
                loanTotalDemand = round2(loanTotalDemand);
                loanCollected = round2(loanCollected);

                // Skip if no actual arrear amount to collect
                if (loanArrearPri + loanArrearInt + loanFees + loanPenalties === 0) continue;

                const remainingDue = round2(Math.max(0, loanTotalDemand - loanCollected));
                const status =
                    remainingDue === 0 && loanCollected > 0
                        ? 'COLLECTED'
                        : loanCollected > 0
                            ? 'PARTIAL'
                            : 'PENDING';

                summaryArrearPrincipal += loanArrearPri;
                summaryArrearInterest += loanArrearInt;
                totalOpeningArrears += round2(loanArrearPri + loanArrearInt);
                totalDemandSum += remainingDue;

                collectionItems.push({
                    loanId: loan.id,
                    loanNumber: loan.loanNumber,
                    clientId: loan.client.id,
                    clientName: `${loan.client.firstName} ${loan.client.lastName}`,
                    clientCode: loan.client.clientId,
                    clientMobile: loan.client.mobileNumber ?? loan.client.phone ?? null,
                    installmentNo: displayInstNo,
                    loanProductTypeName: loan.loanProduct?.loanProductType?.name ?? null,

                    osPrincipal,
                    osInterest,

                    arrearPrincipal: loanArrearPri,
                    arrearInterest: loanArrearInt,

                    // Arrear page has no current demand components
                    currentDemandPrincipal: 0,
                    currentDemandInterest: 0,

                    feesDue: loanFees,
                    penaltiesDue: loanPenalties,

                    totalDemand: round2(loanArrearPri + loanArrearInt + loanFees + loanPenalties),

                    collectedAmount: loanCollected,
                    remainingDue,
                    status,
                    isOverdue: true,
                    loanOutstanding: osPrincipal,

                    isDead: !!activeDeathMarking,
                    deathMarking: activeDeathMarking
                        ? {
                            deceasedPersonType: activeDeathMarking.deceasedPersonType,
                            deceasedPersonName: activeDeathMarking.deceasedPersonName,
                            deathDate: activeDeathMarking.deathDate,
                            placeOfDeath: activeDeathMarking.placeOfDeath,
                            deathReason: activeDeathMarking.deathReason,
                            demandRequired: activeDeathMarking.demandRequired,
                          }
                        : null,

                    scheduleIds: loanScheduleIds,
                });

                totalClients++;
            }

            collectionItems.sort((a, b) => compareMemberIds(a.clientCode, b.clientCode) || a.clientName.localeCompare(b.clientName));

            const responseData = {
                summary: {
                    centerName: center.name,
                    centerCode: center.code,
                    collectionDate: trimmedCollectionDate,
                    totalClients,
                    totalDemand: round2(totalDemandSum),
                    loanOutstanding: round2(totalLoanOutstanding),
                    openingArrears: round2(totalOpeningArrears),
                    totalArrearPrincipal: round2(summaryArrearPrincipal),
                    totalArrearInterest: round2(summaryArrearInterest),
                    totalCurrentDemandPrincipal: 0,
                    totalCurrentDemandInterest: 0,
                },
                collections: collectionItems,
            };

            return successResponse(
                responseData,
                `Found ${collectionItems.length} clients with arrear installments`
            );

        } catch (error) {
            return errorResponse('Failed to fetch arrear collection data', 500);
        }
    })(request);
}

type ArrearCollectionItem = {
    loanId: string;
    amountCollected: number;
    loanAdvanceAmount: number;
    paymentMode?: string;
    remarks?: string;
};

type ItemValidationError = {
    index: number;
    loanId: string;
    reason: string;
};

/**
 * POST /api/collections/arrear
 * Submit arrear collections (PENDING status, awaiting BM approval).
 * Only allocates against overdue schedules (dueDate < collectionDate).
 */
export async function POST(request: NextRequest) {
    return withAuth(async (req, user) => {
        let uploadedPhotoKey: string | null = null;
        try {
            const formData = await req.formData();
            const centerId = formData.get('centerId') as string | null;
            const collectionDate = formData.get('collectionDate') as string | null;
            const photo = formData.get('photo') as File | null;
            const latitudeRaw = formData.get('latitude') as string | null;
            const longitudeRaw = formData.get('longitude') as string | null;
            const latitude = latitudeRaw != null && latitudeRaw !== '' ? parseFloat(latitudeRaw) : null;
            const longitude = longitudeRaw != null && longitudeRaw !== '' ? parseFloat(longitudeRaw) : null;

            let collections: unknown;
            let attendance: unknown;
            let denominationRaw: Record<string, unknown>;
            try {
                collections = JSON.parse((formData.get('collections') as string) || '[]');
                attendance = JSON.parse((formData.get('attendance') as string) || '{}');
                denominationRaw = JSON.parse((formData.get('denomination') as string) || '{}');
            } catch {
                return errorResponse('Invalid JSON in collections/attendance/denomination fields', 400);
            }

            if (!centerId || typeof centerId !== 'string') {
                return errorResponse('centerId is required', 400);
            }
            if (!collectionDate || typeof collectionDate !== 'string') {
                return errorResponse('collectionDate is required', 400);
            }
            if (!Array.isArray(collections) || collections.length === 0) {
                return errorResponse('collections must be a non-empty array', 400);
            }
            if (collections.length > ARREAR_MAX_ITEMS_PER_BATCH) {
                return errorResponse(
                    `Cannot process more than ${ARREAR_MAX_ITEMS_PER_BATCH} items per batch`,
                    400
                );
            }
            if (!photo) {
                return errorResponse('Meeting photo is required', 400);
            }
            if (!ALLOWED_MEETING_PHOTO_TYPES.includes(photo.type)) {
                return errorResponse('Meeting photo must be JPEG, PNG or WEBP', 400);
            }

            const trimmedCollectionDate = collectionDate.trim();
            if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmedCollectionDate)) {
                return errorResponse('Invalid collectionDate format (expected YYYY-MM-DD)', 400);
            }

            const { dayStartUtc: submittedDayStartUtc } = getKolkataDayHalfOpenUtcFromYmd(trimmedCollectionDate);
            const currentTimestamp = new Date();

            const { dayStartUtc: todayStartUtcPost } = getKolkataDayHalfOpenUtcFromYmd(
                getKolkataCalendarYmd(currentTimestamp)
            );
            if (submittedDayStartUtc > todayStartUtcPost) {
                return errorResponse('Cannot submit arrear collections for a future date', 400);
            }

            const validItems: ArrearCollectionItem[] = [];
            const validationErrors: ItemValidationError[] = [];
            const loanAdvanceEnabled = await getLoanAdvanceEnabled();

            for (let i = 0; i < collections.length; i++) {
                const raw = collections[i];
                const loanId = raw?.loanId;
                const amount = Number(raw?.amountCollected);

                if (!loanId || typeof loanId !== 'string') {
                    validationErrors.push({ index: i, loanId: loanId ?? '(missing)', reason: 'Missing loanId' });
                    continue;
                }
                if (!Number.isFinite(amount) || amount <= 0) continue;

                const rawAdv = loanAdvanceEnabled ? Number(raw?.loanAdvanceAmount ?? 0) : 0;
                validItems.push({
                    loanId,
                    amountCollected: Number(amount.toFixed(2)),
                    loanAdvanceAmount: Number.isFinite(rawAdv) && rawAdv > 0
                        ? Number(rawAdv.toFixed(2))
                        : 0,
                    paymentMode: raw.paymentMode,
                    remarks: raw.remarks,
                });
            }

            if (validationErrors.length > 0) {
                return errorResponse(
                    `Invalid collection data: ${validationErrors.map(e => `item[${e.index}] ${e.reason}`).join('; ')}`,
                    400
                );
            }
            if (validItems.length === 0) {
                return errorResponse('No collections with positive amounts to process', 400);
            }

            const center = await prisma.center.findUnique({
                where: { id: centerId },
                select: { id: true, branchId: true, fdoId: true, name: true },
            });
            if (!center) return errorResponse('Center not found', 404);

            const accessError = await checkCenterAccess(user, center);
            if (accessError) {
                return errorResponse(accessError, 403);
            }

            const lockResponse = await assertBranchNotLocked(center.branchId);
            if (lockResponse) return lockResponse;

            // Collection date is always the branch's current working day (not whatever
            // the client submitted) — same convention as disbursement/single-collection,
            // so a branch that hasn't rolled EOD forward to today's real calendar date
            // still works instead of erroring out.
            const workingDay = await getBranchWorkingDayWindow({ branchId: center.branchId });
            const collectionDayStartUtc = workingDay.dayStartUtc;
            const effectiveCollectionDateYmd = workingDay.workingDateYmd;

            const loanIds = [...new Set(validItems.map(i => i.loanId))];

            const loansRaw = await prisma.loan.findMany({
                where: { id: { in: loanIds } },
                select: { id: true, clientId: true, centerId: true, branchId: true },
            });
            const loansMap = new Map(loansRaw.map(l => [l.id, l]));

            // Fetch only schedules strictly past-due before the collection date (true
            // arrears only). See the matching GET query above for why this excludes
            // only WAIVED/CLOSED.
            const allSchedulesRaw = await prisma.loanSchedule.findMany({
                where: {
                    loanId: { in: loanIds },
                    dueDate: { lt: collectionDayStartUtc },
                    status: { notIn: NON_OUTSTANDING_SCHEDULE_STATUSES },
                },
                orderBy: { dueDate: 'asc' },
            });

            const schedulesByLoanId = new Map<string, typeof allSchedulesRaw>();
            for (const s of allSchedulesRaw) {
                const arr = schedulesByLoanId.get(s.loanId) ?? [];
                arr.push(s);
                schedulesByLoanId.set(s.loanId, arr);
            }

            const allScheduleIds = allSchedulesRaw.map(s => s.id);

            // How much of each schedule's due is already "reserved" by a still-PENDING
            // collection (any age, any page). APPROVED lines are already baked into
            // schedule.principalPaid/interestPaid (→ grossRaw below), so netting only
            // the PENDING ones here avoids double-counting them. This is the EXACT
            // same signal GET's remaining-due uses (getPendingScheduleAmounts with no
            // cutoff), so the amount the client was allowed to enter is precisely the
            // amount this route accepts — the client always sends the incremental
            // amount to collect now, never a cumulative running total.
            const pendingByScheduleId = await getPendingScheduleAmounts(allScheduleIds);

            type LoanWritePayload = {
                item: ArrearCollectionItem;
                loan: (typeof loansRaw)[number];
                allocation: ReturnType<typeof allocateTransactionLines>;
            };
            const writePayloads: LoanWritePayload[] = [];
            const itemErrors: string[] = [];
            const warnings: string[] = [];

            for (const item of validItems) {
                const loan = loansMap.get(item.loanId);
                if (!loan) {
                    itemErrors.push(`Loan ${item.loanId} not found`);
                    continue;
                }

                const schedules = schedulesByLoanId.get(item.loanId) ?? [];
                if (schedules.length === 0) {
                    itemErrors.push(`No overdue schedules for loan ${item.loanId}`);
                    continue;
                }

                let totalRemainingDue = 0;
                for (const s of schedules) {
                    const priRem = Number(s.principalDue) - Number(s.principalPaid || 0);
                    const intRem = Number(s.interestDue) - Number(s.interestPaid || 0);
                    const feesRem = Number(s.feesDue || 0) - Number(s.feesPaid || 0);
                    const penRem = Number(s.penaltiesDue || 0) - Number(s.penaltiesPaid || 0);
                    const grossRaw = priRem + intRem + feesRem + penRem;
                    // Net every still-PENDING collection for this schedule (mirrors GET).
                    const pending = pendingByScheduleId.get(s.id)?.total ?? 0;
                    totalRemainingDue += Math.max(0, grossRaw - pending);
                }

                // The client sends the amount to collect NOW (already capped to the
                // row's remaining due it was shown), not a cumulative total.
                const additionalToCollect = Number(item.amountCollected.toFixed(2));

                if (additionalToCollect <= 0) {
                    warnings.push(`Loan ${item.loanId}: no amount entered to collect`);
                    continue;
                }

                if (additionalToCollect > totalRemainingDue * 1.001) {
                    itemErrors.push(
                        `Loan ${item.loanId} exceeds remaining arrear due for ${effectiveCollectionDateYmd} ` +
                        `(remaining ₹${totalRemainingDue.toFixed(2)}, attempted ₹${additionalToCollect.toFixed(2)}). ` +
                        `Another batch may have collected it — reload and retry.`
                    );
                    continue;
                }

                const allocation = allocateTransactionLines(schedules as any, additionalToCollect, 'default');
                if (allocation.lines.length === 0) {
                    itemErrors.push(`No allocatable amount for loan ${item.loanId}`);
                    continue;
                }

                writePayloads.push({
                    item: { ...item, amountCollected: additionalToCollect },
                    loan,
                    allocation,
                });
            }

            if (writePayloads.length === 0) {
                const detail = [...itemErrors, ...warnings].join('; ');
                return errorResponse(
                    `No arrear collection could be recorded${detail ? ` — ${detail}` : ''}. ` +
                    `If a batch was already submitted for this center today, reload to refresh the remaining dues.`,
                    400
                );
            }

            const batchId = `ARR-BATCH-${format(new Date(), 'yyyyMMdd')}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

            // ── Denomination must match the batch's collected cash (server-computed) ──
            const batchCashTotal = writePayloads.reduce(
                (sum, wp) => sum + wp.item.amountCollected + (wp.item.loanAdvanceAmount || 0),
                0
            );
            const denomCounts = normalizeDenominationCounts(denominationRaw);
            const upiAmount = Math.max(0, Number(denominationRaw?.upi) || 0);
            const denomTotal = Number((calculateDenominationTotal(denomCounts) + upiAmount).toFixed(2));

            if (!denominationMatchesFlooredCollection(denomTotal, Number(batchCashTotal.toFixed(2)))) {
                return errorResponse(
                    `Denomination total (₹${denomTotal.toFixed(2)}) does not match collected cash (₹${batchCashTotal.toFixed(2)})`,
                    400
                );
            }

            // ── Upload meeting photo before any DB write ──
            const photoBuffer = Buffer.from(await photo.arrayBuffer());
            let photoKey: string;
            let photoUrl: string;
            try {
                const uploadResult = await uploadCollectionMeetingPhoto({
                    fileBuffer: photoBuffer,
                    contentType: photo.type,
                    fileName: photo.name,
                    branchId: center.branchId,
                    centerId: center.id,
                    collectionBatchId: batchId,
                });
                photoKey = uploadResult.photoKey;
                photoUrl = uploadResult.photoUrl;
                uploadedPhotoKey = photoKey;
            } catch (uploadErr) {
                console.error('[Arrear Collection] Meeting photo upload failed:', uploadErr);
                return errorResponse('Failed to upload meeting photo', 500);
            }

            const result = await prisma.$transaction(
                async (tx) => {
                    let totalCollected = 0;
                    let totalLoanAdvance = 0;
                    let itemsProcessed = 0;
                    const failedItems: string[] = [];

                    for (const { item, loan, allocation } of writePayloads) {
                        const txnId = `TXN-ARR-${format(new Date(), 'yyyyMMdd')}-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
                        const payMode = (['CASH', 'BANK_TRANSFER', 'UPI', 'CHEQUE'].includes(item.paymentMode ?? '')
                            ? item.paymentMode!
                            : 'CASH') as any;

                        try {
                            await tx.loanTransaction.create({
                                data: {
                                    transactionId: txnId,
                                    loanId: item.loanId,
                                    branchId: loan.branchId,
                                    clientId: loan.clientId,
                                    centerId: loan.centerId,
                                    amount: item.amountCollected,
                                    type: 'REPAYMENT',
                                    paymentMode: payMode,
                                    transactionDate: collectionDayStartUtc,
                                    collectedById: user.userId,
                                    status: 'PENDING',
                                    collectionBatchId: batchId,
                                    collectionType: 'Arrear Collection',
                                    remarks: item.remarks || 'Arrear collection',
                                    principalAmount: allocation.summary.principalAmount,
                                    interestAmount: allocation.summary.interestAmount,
                                    feesAmount: allocation.summary.feesAmount,
                                    penaltyAmount: allocation.summary.penaltyAmount,
                                    openingArrearsPrincipal: allocation.summary.principalAmount,
                                    openingArrearsInterest: allocation.summary.interestAmount,
                                    lines: {
                                        create: allocation.lines.map(line => ({
                                            scheduleId: line.scheduleId,
                                            installmentNo: line.installmentNo,
                                            principalAmount: line.principalAmount,
                                            interestAmount: line.interestAmount,
                                            feesAmount: line.feesAmount,
                                            penaltyAmount: line.penaltyAmount,
                                            lineTotal: line.lineTotal,
                                        })),
                                    },
                                } as any,
                            });

                            if (item.loanAdvanceAmount > 0) {
                                const savingsTxnId = `TXN-SAV-${format(new Date(), 'yyyyMMdd')}-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
                                await tx.loanTransaction.create({
                                    data: {
                                        transactionId: savingsTxnId,
                                        loanId: item.loanId,
                                        branchId: loan.branchId,
                                        clientId: loan.clientId,
                                        centerId: loan.centerId,
                                        amount: item.loanAdvanceAmount,
                                        type: 'SAVINGS_COLLECTION' as any,
                                        paymentMode: payMode,
                                        transactionDate: collectionDayStartUtc,
                                        collectedById: user.userId,
                                        status: 'PENDING',
                                        collectionBatchId: batchId,
                                        collectionType: 'Arrear Collection',
                                        remarks: 'Advance savings collection',
                                    } as any,
                                });
                                totalLoanAdvance += item.loanAdvanceAmount;
                            }

                            totalCollected += item.amountCollected;
                            itemsProcessed++;
                        } catch (writeErr) {
                            const msg = writeErr instanceof Error ? writeErr.message : String(writeErr);
                            console.error(`[Arrear Collection] Failed to create txn for loan=${item.loanId}:`, msg);
                            failedItems.push(`loan ${item.loanId}: ${msg}`);
                        }
                    }

                    if (itemsProcessed === 0 && failedItems.length > 0) {
                        throw new Error(`All writes failed: ${failedItems.join('; ')}`);
                    }

                    await tx.collectionMeetingRecord.create({
                        data: {
                            collectionBatchId: batchId,
                            centerId: center.id,
                            branchId: center.branchId,
                            // @db.Date column: plain UTC-midnight, not the IST-anchored
                            // collectionDayStartUtc — see demand/route.ts for why.
                            collectionDate: parseDenominationEntryDateUtc(effectiveCollectionDateYmd),
                            photoKey,
                            photoUrl,
                            latitude,
                            longitude,
                            ...denomCounts,
                            upi: upiAmount,
                            totalAmount: denomTotal,
                            submittedById: user.userId,
                        },
                    });

                    return { batchId, totalCollected, totalLoanAdvance, itemsProcessed, failedItems };
                },
                { timeout: ARREAR_BATCH_TX_TIMEOUT_MS }
            );

            // Live Employee Tracking: soft-capture pointer at the moment this
            // collection was submitted, reusing the same GPS just stored on
            // CollectionMeetingRecord above — never blocks the collection itself.
            if (latitude != null && longitude != null) {
                prisma.employeeTrackingEvent.create({
                    data: {
                        employeeId: user.userId,
                        eventType: 'COLLECTION',
                        latitude,
                        longitude,
                        centerId: center.id,
                        branchId: center.branchId,
                        label: center.name ? `Collection at ${center.name}` : 'Collection submitted',
                    },
                }).catch((err) => console.error('[Arrear Collection] Failed to record tracking event:', err));
            }

            // Attendance outside financial transaction
            let attendanceProcessed = 0;
            if (attendance && typeof attendance === 'object') {
                try {
                    const entries = Object.entries(attendance);
                    for (const [clientId, isPresent] of entries) {
                        if (!clientId || typeof clientId !== 'string') continue;
                        await prisma.clientAttendance.upsert({
                            where: {
                                clientId_attendanceDate: {
                                    clientId,
                                    attendanceDate: collectionDayStartUtc,
                                },
                            },
                            update: { isPresent: Boolean(isPresent) },
                            create: {
                                clientId,
                                centerId: center.id,
                                branchId: center.branchId,
                                attendanceDate: collectionDayStartUtc,
                                isPresent: Boolean(isPresent),
                                createdById: user.userId,
                            },
                        });
                        attendanceProcessed++;
                    }
                } catch (attErr) {
                    console.error('[Arrear Collection] Attendance processing error (non-blocking):', attErr);
                }
            }

            if (itemErrors.length > 0) warnings.push(`${itemErrors.length} item(s) skipped during validation`);
            if (result.failedItems.length > 0) warnings.push(`${result.failedItems.length} item(s) failed during write`);

            return successResponse(
                {
                    batchId: result.batchId,
                    totalCollected: Number(result.totalCollected.toFixed(2)),
                    totalLoanAdvance: Number(result.totalLoanAdvance.toFixed(2)),
                    itemsProcessed: result.itemsProcessed,
                    attendanceProcessed,
                    warnings: warnings.length > 0 ? warnings : undefined,
                    message: 'Arrear collections submitted for Review',
                },
                `Successfully staged ${result.itemsProcessed} arrear collections totaling ₹${result.totalCollected.toFixed(2)}. Awaiting BM approval.`
            );

        } catch (error) {
            if (uploadedPhotoKey) {
                try {
                    await deleteCollectionMeetingPhoto(uploadedPhotoKey);
                } catch (cleanupErr) {
                    console.error('[Arrear Collection] Failed to clean up orphaned meeting photo:', cleanupErr);
                }
            }
            const errMsg = error instanceof Error ? error.message : 'Unknown error';
            if (errMsg.includes('Transaction already closed') || errMsg.includes('Transaction API error')) {
                return errorResponse('Transaction timed out. Try submitting fewer items at once.', 504);
            }
            return errorResponse(`Failed to process arrear collection: ${errMsg}`, 500);
        }
    })(request);
}

/**
 * PATCH /api/collections/arrear?centerId=...&date=...
 * Check if any arrear collection batch was already submitted for this center + date.
 */
export async function PATCH(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const centerId = searchParams.get('centerId');
            const date = searchParams.get('date');

            if (!centerId) return errorResponse('centerId is required', 400);
            if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
                return errorResponse('date is required (YYYY-MM-DD)', 400);
            }

            const { dayStartUtc, dayEndExclusiveUtc } = getKolkataDayHalfOpenUtcFromYmd(date.trim());

            const center = await prisma.center.findUnique({
                where: { id: centerId },
                select: { id: true, name: true, code: true, branchId: true, fdoId: true },
            });
            if (!center) return errorResponse('Center not found', 404);

            const accessError = await checkCenterAccess(user, center);
            if (accessError) {
                return errorResponse(accessError, 403);
            }

            const repayments = await prisma.loanTransaction.findMany({
                where: {
                    centerId,
                    type: 'REPAYMENT',
                    collectionType: 'Arrear Collection',
                    transactionDate: { gte: dayStartUtc, lt: dayEndExclusiveUtc },
                },
                select: {
                    id: true,
                    transactionId: true,
                    collectionBatchId: true,
                    amount: true,
                    clientId: true,
                    status: true,
                    transactionDate: true,
                },
            });

            const batchIds = [...new Set(repayments.map(r => r.collectionBatchId).filter(Boolean))];

            const batchMap = new Map<string, any>();
            for (const tx of repayments) {
                const bid = tx.collectionBatchId ?? tx.id;
                if (!batchMap.has(bid)) {
                    batchMap.set(bid, {
                        batchId: bid,
                        collectionDate: tx.transactionDate,
                        centerName: center.name,
                        centerCode: center.code,
                        clientIds: new Set<string>(),
                        totalRepayment: 0,
                        status: tx.status,
                    });
                }
                const entry = batchMap.get(bid)!;
                entry.clientIds.add(tx.clientId);
                entry.totalRepayment += Number(tx.amount);
            }

            const batches = Array.from(batchMap.values()).map(b => ({
                ...b,
                noOfClients: b.clientIds.size,
                clientIds: undefined,
                totalRepayment: Number(b.totalRepayment.toFixed(2)),
            }));

            return successResponse({ batches, centerName: center.name, centerCode: center.code }, 'Arrear collection history fetched');
        } catch (error) {
            console.error('[Arrear History] Error:', error);
            return errorResponse('Failed to fetch arrear collection history', 500);
        }
    })(request);
}
