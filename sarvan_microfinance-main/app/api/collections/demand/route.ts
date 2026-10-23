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
import {
    getKolkataCalendarYmd,
    getKolkataDayEndExclusiveUtc,
    parseKolkataAttendanceDateYmd,
} from '@/app/lib/branch-lock';
import { getBranchWorkingDayWindow } from '@/app/lib/branch-working-day-guard';
import { pendingClosureAllocationLoanCondition } from '@/app/lib/eod-closure-allocation';
import { parseDenominationEntryDateUtc } from '@/app/lib/branch-financial-day';
import {
    round2,
    netScheduleComponents,
    applySavingsBudget,
    NON_OUTSTANDING_SCHEDULE_STATUSES,
} from '@/app/lib/collections/demand-calculation';
import { getPendingScheduleAmounts } from '@/app/lib/collections/pending-schedule-amounts';
import { checkCenterAccess } from '@/app/lib/filters/fdo-center-scope';
import {
    normalizeDenominationCounts,
    calculateDenominationTotal,
    denominationMatchesFlooredCollection,
} from '@/app/lib/denomination-money';
import {
    uploadCollectionMeetingPhoto,
    deleteCollectionMeetingPhoto,
} from '@/app/lib/storage/collection-meeting-storage';
import { getLoanAdvanceEnabled } from '@/app/lib/loan-advance-config';
import { compareMemberIds } from '@/app/lib/member-id-sort';

const ALLOWED_MEETING_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const DEMAND_BATCH_TX_TIMEOUT_MS = 30_000;
const DEMAND_MAX_ITEMS_PER_BATCH = 100;

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
 * GET /api/collections/demand
 * Fetch demand collection data for a center on a specific date
 * Query params: centerId, collectionDate
 */
export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const centerId = searchParams.get('centerId');
            const collectionDate = searchParams.get('collectionDate');

            if (!centerId) {
                return errorResponse('Center ID is required', 400);
            }

            if (!collectionDate) {
                return errorResponse('Collection date is required', 400);
            }

            const trimmedCollectionDate = String(collectionDate).trim();
            if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmedCollectionDate)) {
                return errorResponse('Invalid collection date format (expected YYYY-MM-DD)', 400);
            }

            const { dayStartUtc: collectionDayStartUtc, dayEndExclusiveUtc: collectionDayEndExclusiveUtc } =
                getKolkataDayHalfOpenUtcFromYmd(trimmedCollectionDate);
            const todayYmd = getKolkataCalendarYmd(new Date());
            const { dayStartUtc: todayStartUtc } = getKolkataDayHalfOpenUtcFromYmd(todayYmd);

            // Future collection dates are not allowed
            if (collectionDayStartUtc > todayStartUtc) {
                return errorResponse('Cannot load demand for a future date', 400);
            }

            const center = await prisma.center.findUnique({
                where: { id: centerId },
                select: {
                    id: true,
                    name: true,
                    code: true,
                    branchId: true,
                    fdoId: true,
                }
            });

            if (!center) {
                return errorResponse('Center not found', 404);
            }

            const accessError = await checkCenterAccess(user, center);
            if (accessError) {
                console.warn('[Demand Collection] Access denied:', {
                    userId: user.userId,
                    centerBranchId: center.branchId,
                    role: user.role
                });
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
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            clientId: true,
                            mobileNumber: true,
                            phone: true,
                        }
                    },
                    loanProduct: {
                        select: {
                            loanProductType: {
                                select: { name: true }
                            }
                        }
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
                    schedules: {
                        where: {
                            dueDate: {
                                // Demand is cumulative dues up to selected date (inclusive).
                                lte: new Date(collectionDayEndExclusiveUtc.getTime() - 1),
                            },
                            // Excludes only the truly final statuses — see
                            // NON_OUTSTANDING_SCHEDULE_STATUSES for why a PAID row isn't
                            // safe to filter out here (status can drift from the real
                            // due-vs-paid amounts). The per-schedule net-remaining check
                            // below already ignores genuinely-settled rows.
                            status: {
                                notIn: NON_OUTSTANDING_SCHEDULE_STATUSES
                            }
                        },
                        orderBy: {
                            dueDate: 'asc'
                        }
                    }
                }
            });

            const scheduleIds = loans.flatMap((l) => l.schedules.map((s) => s.id));
            const loanIds = loans.map((l) => l.id);

            // Two REPAYMENT signals are needed:
            //  - `pendingByScheduleId` (any still-PENDING collection, regardless of
            //    which day it was submitted): used to NET staged-but-not-yet-approved
            //    collections out of remaining due, so the same due can never be
            //    collected twice while an earlier submission is still awaiting BM
            //    approval. An APPROVED line already updated schedule.*Paid, so
            //    including it here too would double-count it. A REJECTED line is
            //    naturally excluded (status is no longer PENDING), which is what
            //    makes a rejected collection's amount available again automatically.
            //  - `collectedLines` (PENDING+APPROVED, combined lineTotal, today only):
            //    purely informational "Already Collected" display total — never fed
            //    into the remaining-due math.
            const [pendingByScheduleId, collectedLines, pendingSavingsLines, collectedSavingsLines, osInterestAggregates] =
                await Promise.all([
                    getPendingScheduleAmounts(scheduleIds),
                    scheduleIds.length
                        ? prisma.loanTransactionLine.findMany({
                            where: {
                                scheduleId: { in: scheduleIds },
                                transaction: {
                                    centerId,
                                    type: 'REPAYMENT',
                                    status: { in: ['PENDING', 'APPROVED'] as any },
                                    // A reverted collection stays APPROVED with isReversed=true — it was undone, not collected.
                                    isReversed: false,
                                    transactionDate: {
                                        gte: collectionDayStartUtc,
                                        lt: collectionDayEndExclusiveUtc,
                                    },
                                },
                            },
                            select: {
                                scheduleId: true,
                                lineTotal: true,
                            },
                        })
                        : Promise.resolve([]),
                    loanIds.length
                        ? prisma.loanTransaction.findMany({
                            where: {
                                loanId: { in: loanIds },
                                centerId,
                                type: 'SAVINGS_COLLECTION' as any,
                                status: 'PENDING' as any,
                                isReversed: false,
                                transactionDate: {
                                    gte: collectionDayStartUtc,
                                    lt: collectionDayEndExclusiveUtc,
                                },
                            },
                            select: { loanId: true, amount: true },
                        })
                        : Promise.resolve([]),
                    loanIds.length
                        ? prisma.loanTransaction.findMany({
                            where: {
                                loanId: { in: loanIds },
                                centerId,
                                type: 'SAVINGS_COLLECTION' as any,
                                status: { in: ['PENDING', 'APPROVED'] as any },
                                isReversed: false,
                                transactionDate: {
                                    gte: collectionDayStartUtc,
                                    lt: collectionDayEndExclusiveUtc,
                                },
                            },
                            select: { loanId: true, amount: true },
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

            const pendingSavingsByLoanId = new Map<string, number>();
            for (const txn of pendingSavingsLines) {
                const prev = pendingSavingsByLoanId.get(txn.loanId) ?? 0;
                pendingSavingsByLoanId.set(txn.loanId, prev + Number(txn.amount || 0));
            }

            const collectedSavingsByLoanId = new Map<string, number>();
            for (const txn of collectedSavingsLines) {
                const prev = collectedSavingsByLoanId.get(txn.loanId) ?? 0;
                collectedSavingsByLoanId.set(txn.loanId, prev + Number(txn.amount || 0));
            }

            const collectionItems = [];
            let totalDemandSum = 0;
            let totalClients = 0;
            let totalLoanOutstanding = 0;
            let totalOpeningArrears = 0;
            let summaryArrearPrincipal = 0;
            let summaryArrearInterest = 0;
            let summaryCurrentDemandPrincipal = 0;
            let summaryCurrentDemandInterest = 0;

            for (const loan of loans) {
                if (loan.schedules.length === 0) continue;

                const activeDeathMarking = loan.deathMarking[0] ?? null;

                const osPrincipal = round2(Number(loan.amount) - Number(loan.principalPaid || 0));
                const osInterest = osInterestByLoanId.get(loan.id) ?? 0;
                totalLoanOutstanding += osPrincipal;

                // IMPORTANT: classify schedules by Kolkata calendar day (not server timezone)
                // to keep "current demand" accurate for meeting-day collections.
                const scheduleMeta = loan.schedules.map((schedule) => {
                    const dueYmd = getKolkataCalendarYmd(schedule.dueDate);
                    const scheduleDueDayStartUtc = parseKolkataAttendanceDateYmd(dueYmd);
                    // Date-only — deliberately NOT gated on schedule.status !== 'PAID'.
                    // status can drift from the real due-vs-paid amounts (see
                    // NON_OUTSTANDING_SCHEDULE_STATUSES), and a mismarked-PAID overdue
                    // row would otherwise fall through to the "current demand" bucket
                    // below instead of arrear. A genuinely-settled row still nets to
                    // zero remaining further down and is skipped either way.
                    const isOverdue = scheduleDueDayStartUtc < collectionDayStartUtc;
                    return { schedule, isOverdue };
                });

                // ── Loan Advance (savings) — netted independently of principal/interest ──
                const savingsBudget = pendingSavingsByLoanId.get(loan.id) ?? 0;
                const savingsResult = applySavingsBudget(
                    scheduleMeta.map(({ schedule, isOverdue }) => ({
                        scheduleId: schedule.id,
                        savingsDue: Number(schedule.savingsDue || 0),
                        savingsPaid: Number(schedule.savingsPaid || 0),
                        isOverdue,
                    })),
                    savingsBudget,
                );
                const savingsByScheduleId = new Map(savingsResult.schedules.map((s) => [s.scheduleId, s]));

                // ── Aggregate all schedules for this loan into one row ──
                let loanArrearPri = 0;
                let loanArrearInt = 0;
                let loanTodayPri = 0;
                let loanTodayInt = 0;
                let loanFees = 0;
                let loanPenalties = 0;
                let loanTotalDemand = 0;
                let loanCollected = 0;
                let loanGrossPri = 0;
                let loanGrossInt = 0;
                let hasOverdue = false;
                const loanScheduleIds: string[] = [];
                let displayInstNo = 0;
                let loanSavingsArrear = 0;
                let loanSavingsCurrent = 0;

                for (const { schedule, isOverdue } of scheduleMeta) {
                    const principalDue = Number(schedule.principalDue);
                    const principalPaid = Number(schedule.principalPaid || 0);
                    const interestDue = Number(schedule.interestDue);
                    const interestPaid = Number(schedule.interestPaid || 0);
                    const feesDue = Number(schedule.feesDue || 0);
                    const feesPaid = Number(schedule.feesPaid || 0);
                    const penaltiesDue = Number(schedule.penaltiesDue || 0);
                    const penaltiesPaid = Number(schedule.penaltiesPaid || 0);

                    const pending = pendingByScheduleId.get(schedule.id);
                    const net = netScheduleComponents({
                        principalDue, principalPaid,
                        interestDue, interestPaid,
                        feesDue, feesPaid,
                        penaltiesDue, penaltiesPaid,
                        pendingPrincipal: pending?.principal ?? 0,
                        pendingInterest: pending?.interest ?? 0,
                        pendingFees: pending?.fees ?? 0,
                        pendingPenalty: pending?.penalty ?? 0,
                    });

                    const alreadyCollected = collectedByScheduleId.get(schedule.id) ?? 0;

                    // A due only disappears once net Principal AND net Interest both reach zero.
                    if (net.netPrincipal <= 0 && net.netInterest <= 0 && alreadyCollected <= 0) continue;

                    loanScheduleIds.push(schedule.id);
                    loanCollected += alreadyCollected;

                    loanGrossPri += principalDue - principalPaid;
                    loanGrossInt += interestDue - interestPaid;

                    const savings = savingsByScheduleId.get(schedule.id);

                    if (isOverdue) {
                        loanArrearPri += net.netPrincipal;
                        loanArrearInt += net.netInterest;
                        loanSavingsArrear += savings?.netSavingsArrear ?? 0;
                        hasOverdue = true;
                    } else {
                        loanTodayPri += net.netPrincipal;
                        loanTodayInt += net.netInterest;
                        loanSavingsCurrent += savings?.netSavingsCurrent ?? 0;
                        if (!displayInstNo) displayInstNo = schedule.installmentNo;
                    }

                    loanFees += net.netFees;
                    loanPenalties += net.netPenalties;
                    loanTotalDemand += net.netPrincipal + net.netInterest + net.netFees + net.netPenalties;
                }

                if (loanScheduleIds.length === 0) continue;
                if (!displayInstNo) displayInstNo = loan.schedules[0].installmentNo;

                // Round all accumulated values
                loanArrearPri = round2(loanArrearPri);
                loanArrearInt = round2(loanArrearInt);
                loanTodayPri = round2(loanTodayPri);
                loanTodayInt = round2(loanTodayInt);
                loanFees = round2(loanFees);
                loanPenalties = round2(loanPenalties);
                loanTotalDemand = round2(loanTotalDemand);
                loanCollected = round2(loanCollected);
                loanGrossPri = round2(loanGrossPri);
                loanGrossInt = round2(loanGrossInt);
                loanSavingsArrear = round2(loanSavingsArrear);
                loanSavingsCurrent = round2(loanSavingsCurrent);

                // loanTotalDemand is already net of today's PENDING collections
                // (single subtraction, done per component above) — do not subtract
                // loanCollected again here.
                const remainingDue = loanTotalDemand;
                const status =
                    remainingDue === 0 && loanCollected > 0
                        ? 'COLLECTED'
                        : loanCollected > 0
                            ? 'PARTIAL'
                            : 'PENDING';

                const loanAdvanceCollectedToday = round2(collectedSavingsByLoanId.get(loan.id) ?? 0);

                // Summary accumulators
                summaryArrearPrincipal += loanArrearPri;
                summaryArrearInterest += loanArrearInt;
                summaryCurrentDemandPrincipal += loanTodayPri;
                summaryCurrentDemandInterest += loanTodayInt;
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

                    // Net (remaining) arrear/current breakdown
                    arrearPrincipal: loanArrearPri,
                    arrearInterest: loanArrearInt,

                    // Loan Advance (savings) — net of today's pending, independent of principal/interest
                    savingsArrear: loanSavingsArrear,
                    savingsCurrentDemand: loanSavingsCurrent,
                    totalSavingsDue: round2(loanSavingsArrear + loanSavingsCurrent),
                    loanAdvanceCollectedToday,

                    // Today's installment amounts (for allocation cap), net
                    currentDemandPrincipal: loanTodayPri,
                    currentDemandInterest: loanTodayInt,

                    feesDue: loanFees,
                    penaltiesDue: loanPenalties,

                    // Gross due (before any of today's collections) for display
                    duePrincipal: loanGrossPri,
                    dueInterest: loanGrossInt,

                    // Net remaining, summed across arrear + current
                    remainingPrincipal: round2(loanArrearPri + loanTodayPri),
                    remainingInterest: round2(loanArrearInt + loanTodayInt),

                    totalDemand: remainingDue,

                    collectedAmount: loanCollected,
                    remainingDue,
                    status,
                    isOverdue: hasOverdue,
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

                    // All schedule IDs for this loan (ordered by dueDate asc)
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
                    totalCurrentDemandPrincipal: round2(summaryCurrentDemandPrincipal),
                    totalCurrentDemandInterest: round2(summaryCurrentDemandInterest),
                },
                collections: collectionItems,
            };

            return successResponse(
                responseData,
                `Found ${collectionItems.length} pending installments for ${totalClients} clients`
            );

        } catch (error) {
            return errorResponse('Failed to fetch demand collection data', 500);
        }
    })(request);
}

type DemandCollectionItem = {
    loanId: string;
    amountCollected: number;
    savingsCollected?: number;
    paymentMode?: string;
    remarks?: string;
};

type ItemValidationError = {
    index: number;
    loanId: string;
    reason: string;
};

/**
 * POST /api/collections/demand
 * Submit demand collection (record payments).
 *
 * Strategy:
 *  1. Validate & pre-fetch ALL referenced loans and their pending schedules OUTSIDE the transaction.
 *  2. For each loan, distribute the collected amount across schedules (overdue first, then current).
 *  3. Run a single DB transaction with only WRITE operations (no lookups inside).
 *  4. Process attendance outside the financial transaction.
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

            // ── Basic payload validation ──
            if (!centerId || typeof centerId !== 'string') {
                return errorResponse('centerId is required', 400);
            }
            if (!collectionDate || typeof collectionDate !== 'string') {
                return errorResponse('collectionDate is required', 400);
            }
            if (!Array.isArray(collections) || collections.length === 0) {
                return errorResponse('collections must be a non-empty array', 400);
            }
            if (collections.length > DEMAND_MAX_ITEMS_PER_BATCH) {
                return errorResponse(
                    `Cannot process more than ${DEMAND_MAX_ITEMS_PER_BATCH} items per batch`,
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

            // Future collection dates are not allowed
            const { dayStartUtc: todayStartUtcPost } = getKolkataDayHalfOpenUtcFromYmd(
                getKolkataCalendarYmd(currentTimestamp)
            );
            if (submittedDayStartUtc > todayStartUtcPost) {
                return errorResponse('Cannot submit collections for a future date', 400);
            }

            // ── Per-item shape validation ──
            const validItems: DemandCollectionItem[] = [];
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
                if (!Number.isFinite(amount) || amount <= 0) {
                    continue; // zero/negative amounts are simply skipped
                }

                const rawSavings = loanAdvanceEnabled ? Number(raw?.savingsCollected ?? 0) : 0;
                validItems.push({
                    loanId,
                    amountCollected: Number(amount.toFixed(2)),
                    savingsCollected: Number.isFinite(rawSavings) && rawSavings > 0 ? Number(rawSavings.toFixed(2)) : 0,
                    paymentMode: raw.paymentMode,
                    remarks: raw.remarks,
                });
            }

            if (validationErrors.length > 0) {
                console.error('[Demand Collection] Payload validation failures:', validationErrors);
                return errorResponse(
                    `Invalid collection data: ${validationErrors.map(e => `item[${e.index}] ${e.reason}`).join('; ')}`,
                    400
                );
            }

            if (validItems.length === 0) {
                return errorResponse('No collections with positive amounts to process', 400);
            }

            // ── Verify center ──
            const center = await prisma.center.findUnique({
                where: { id: centerId },
                select: { id: true, branchId: true, fdoId: true, name: true },
            });

            if (!center) {
                return errorResponse('Center not found', 404);
            }

            const accessError = await checkCenterAccess(user, center);
            if (accessError) {
                return errorResponse(accessError, 403);
            }

            // ── Branch Lock Guard ──
            const lockResponse = await assertBranchNotLocked(center.branchId);
            if (lockResponse) return lockResponse;

            // Collection date is always the branch's current working day (not whatever
            // the client submitted) — same convention as disbursement/single-collection,
            // so a branch that hasn't rolled EOD forward to today's real calendar date
            // still works instead of erroring out.
            const workingDay = await getBranchWorkingDayWindow({ branchId: center.branchId });
            const collectionDayStartUtc = workingDay.dayStartUtc;
            const collectionDayEndExclusiveUtc = workingDay.dayEndExclusiveUtc;
            const effectiveCollectionDateYmd = workingDay.workingDateYmd;

            // ── Pre-fetch all loans and their pending schedules ──
            const loanIds = [...new Set(validItems.map(i => i.loanId))];

            const loansRaw = await prisma.loan.findMany({
                where: { id: { in: loanIds } },
                select: {
                    id: true,
                    clientId: true,
                    centerId: true,
                    branchId: true,
                },
            });
            const loansMap = new Map(loansRaw.map(l => [l.id, l]));

            // Fetch all pending schedules for these loans (up to collection date).
            // See the matching GET query above for why this excludes only WAIVED/CLOSED.
            const allSchedulesRaw = await prisma.loanSchedule.findMany({
                where: {
                    loanId: { in: loanIds },
                    dueDate: { lte: new Date(collectionDayEndExclusiveUtc.getTime() - 1) },
                    status: { notIn: NON_OUTSTANDING_SCHEDULE_STATUSES },
                },
                orderBy: { dueDate: 'asc' },
            });

            // Group schedules by loan
            const schedulesByLoanId = new Map<string, typeof allSchedulesRaw>();
            for (const s of allSchedulesRaw) {
                const arr = schedulesByLoanId.get(s.loanId) ?? [];
                arr.push(s);
                schedulesByLoanId.set(s.loanId, arr);
            }

            // Any still-PENDING (not yet approved) collections per schedule,
            // component-level, regardless of which day they were submitted — used
            // to NET remaining due once, and to build "effective" schedules for
            // allocateTransactionLines so a second submission (same day or later)
            // continues the priority order correctly instead of re-deriving it from
            // the original gross remaining.
            const allScheduleIds = allSchedulesRaw.map(s => s.id);
            const [pendingByScheduleId, pendingSavingsLines] = await Promise.all([
                getPendingScheduleAmounts(allScheduleIds),
                loanIds.length
                    ? prisma.loanTransaction.findMany({
                        where: {
                            loanId: { in: loanIds },
                            centerId,
                            type: 'SAVINGS_COLLECTION' as any,
                            status: 'PENDING' as any,
                            isReversed: false,
                            transactionDate: {
                                gte: collectionDayStartUtc,
                                lt: collectionDayEndExclusiveUtc,
                            },
                        },
                        select: { loanId: true, amount: true },
                    })
                    : Promise.resolve([]),
            ]);

            const pendingSavingsByLoanId = new Map<string, number>();
            for (const txn of pendingSavingsLines) {
                const prev = pendingSavingsByLoanId.get(txn.loanId) ?? 0;
                pendingSavingsByLoanId.set(txn.loanId, prev + Number(txn.amount || 0));
            }

            // ── Build write-ready payloads ──
            type LoanWritePayload = {
                item: DemandCollectionItem;
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
                    itemErrors.push(`No pending schedules for loan ${item.loanId}`);
                    continue;
                }

                // Net remaining due across all schedules (single subtraction,
                // PENDING-only, per component) — this is the true remaining cap.
                let totalRemainingDue = 0;
                for (const s of schedules) {
                    const pending = pendingByScheduleId.get(s.id);
                    const net = netScheduleComponents({
                        principalDue: Number(s.principalDue),
                        principalPaid: Number(s.principalPaid || 0),
                        interestDue: Number(s.interestDue),
                        interestPaid: Number(s.interestPaid || 0),
                        feesDue: Number(s.feesDue || 0),
                        feesPaid: Number(s.feesPaid || 0),
                        penaltiesDue: Number(s.penaltiesDue || 0),
                        penaltiesPaid: Number(s.penaltiesPaid || 0),
                        pendingPrincipal: pending?.principal ?? 0,
                        pendingInterest: pending?.interest ?? 0,
                        pendingFees: pending?.fees ?? 0,
                        pendingPenalty: pending?.penalty ?? 0,
                    });
                    totalRemainingDue += net.netPrincipal + net.netInterest + net.netFees + net.netPenalties;
                }
                totalRemainingDue = Number(totalRemainingDue.toFixed(2));

                // `item.amountCollected` is the amount to collect in THIS
                // submission (a delta), not a cumulative total for the day.
                const toCollect = item.amountCollected;

                if (toCollect > totalRemainingDue * 1.001) {
                    itemErrors.push(
                        `Loan ${item.loanId} exceeds remaining due (remaining ₹${totalRemainingDue.toFixed(2)}, attempted ₹${toCollect.toFixed(2)})`
                    );
                    continue;
                }

                // Loan Advance (savings) validation — netted independently of
                // principal/interest, never mixed into the amount above.
                if (item.savingsCollected && item.savingsCollected > 0) {
                    const savingsBudgetToday = pendingSavingsByLoanId.get(item.loanId) ?? 0;
                    let grossSavingsDue = 0;
                    for (const s of schedules) {
                        grossSavingsDue += Math.max(0, Number(s.savingsDue || 0) - Number(s.savingsPaid || 0));
                    }
                    const netSavingsRemaining = Math.max(0, Number((grossSavingsDue - savingsBudgetToday).toFixed(2)));

                    if (item.savingsCollected > netSavingsRemaining * 1.001) {
                        itemErrors.push(
                            `Loan ${item.loanId} Loan Advance exceeds remaining Loan Advance due (remaining ₹${netSavingsRemaining.toFixed(2)}, attempted ₹${item.savingsCollected.toFixed(2)})`
                        );
                        continue;
                    }
                }

                // Build "effective" schedules — gross Paid bumped by today's
                // already-PENDING per-component amounts — so a second same-day
                // submission continues the priority order correctly instead of
                // re-deriving it against the untouched gross remaining.
                const effectiveSchedules = schedules.map((s) => {
                    const pending = pendingByScheduleId.get(s.id);
                    return {
                        ...s,
                        principalPaid: Number(s.principalPaid || 0) + (pending?.principal ?? 0),
                        interestPaid: Number(s.interestPaid || 0) + (pending?.interest ?? 0),
                        feesPaid: Number(s.feesPaid || 0) + (pending?.fees ?? 0),
                        penaltiesPaid: Number(s.penaltiesPaid || 0) + (pending?.penalty ?? 0),
                    };
                });

                // Allocate across all pending schedules (overdue first by dueDate asc)
                const allocation = allocateTransactionLines(effectiveSchedules as any, toCollect, 'default');
                if (allocation.lines.length === 0) {
                    itemErrors.push(`No allocatable amount for loan ${item.loanId}`);
                    continue;
                }

                writePayloads.push({
                    item: { ...item, amountCollected: toCollect },
                    loan,
                    allocation,
                });
            }

            if (itemErrors.length > 0 && writePayloads.length === 0) {
                console.error('[Demand Collection] All items failed validation:', itemErrors);
                return errorResponse(`All collections failed validation: ${itemErrors.join('; ')}`, 400);
            }

            // ── Generate batch ID ──
            const batchId = `BATCH-${format(new Date(), 'yyyyMMdd')}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

            // ── Denomination must match the batch's collected cash (server-computed, never trust the client) ──
            const batchCashTotal = writePayloads.reduce(
                (sum, wp) => sum + wp.item.amountCollected + (wp.item.savingsCollected || 0),
                0
            );
            const denomCounts = normalizeDenominationCounts(denominationRaw);
            const upiAmount = Math.max(0, Number(denominationRaw?.upi) || 0);
            const denomTotal = Number((calculateDenominationTotal(denomCounts) + upiAmount).toFixed(2));

            if (!denominationMatchesFlooredCollection(denomTotal, batchCashTotal)) {
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
                console.error('[Demand Collection] Meeting photo upload failed:', uploadErr);
                return errorResponse('Failed to upload meeting photo', 500);
            }

            // ── Execute writes in a single transaction with extended timeout ──
            const result = await prisma.$transaction(
                async (tx) => {
                    let totalCollected = 0;
                    let itemsProcessed = 0;
                    const failedItems: string[] = [];

                    for (const { item, loan, allocation } of writePayloads) {
                        const txnId = `TXN-${format(new Date(), 'yyyyMMdd')}-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
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
                                    collectionType: 'Demand Collection',
                                    remarks: item.remarks || `Demand collection`,
                                    principalAmount: allocation.summary.principalAmount,
                                    interestAmount: allocation.summary.interestAmount,
                                    feesAmount: allocation.summary.feesAmount,
                                    penaltyAmount: allocation.summary.penaltyAmount,
                                    currentDemandPrincipal: allocation.summary.principalAmount,
                                    currentDemandInterest: allocation.summary.interestAmount,
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

                            // Create a separate SAVINGS_COLLECTION transaction if savings were collected
                            if (item.savingsCollected && item.savingsCollected > 0) {
                                const savingsTxnId = `TXN-SAV-${format(new Date(), 'yyyyMMdd')}-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
                                await tx.loanTransaction.create({
                                    data: {
                                        transactionId: savingsTxnId,
                                        loanId: item.loanId,
                                        branchId: loan.branchId,
                                        clientId: loan.clientId,
                                        centerId: loan.centerId,
                                        amount: item.savingsCollected,
                                        type: 'SAVINGS_COLLECTION' as any,
                                        paymentMode: payMode,
                                        transactionDate: collectionDayStartUtc,
                                        collectedById: user.userId,
                                        status: 'PENDING',
                                        collectionBatchId: batchId,
                                        collectionType: 'Demand Collection',
                                        remarks: `Advance savings collection`,
                                    } as any,
                                });
                            }

                            totalCollected += item.amountCollected;
                            itemsProcessed++;
                        } catch (writeErr) {
                            const msg = writeErr instanceof Error ? writeErr.message : String(writeErr);
                            console.error(`[Demand Collection] Failed to create txn for loan=${item.loanId}:`, msg);
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
                            // @db.Date column: must be a plain UTC-midnight instant, not the
                            // IST-anchored collectionDayStartUtc (T00:00:00+05:30) — Prisma's
                            // @db.Date write truncates by UTC calendar date, which would shift
                            // an IST-anchored instant back one day (e.g. 28th 00:00 IST ==
                            // 27th 18:30 UTC, truncating to the 27th).
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

                    return { batchId, totalCollected, itemsProcessed, failedItems };
                },
                { timeout: DEMAND_BATCH_TX_TIMEOUT_MS }
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
                }).catch((err) => console.error('[Demand Collection] Failed to record tracking event:', err));
            }

            // ── Attendance is non-financial — process OUTSIDE the main transaction ──
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
                    console.error('[Demand Collection] Attendance processing error (non-blocking):', attErr);
                }
            }

            if (itemErrors.length > 0) {
                warnings.push(`${itemErrors.length} item(s) skipped during validation`);
            }
            if (result.failedItems.length > 0) {
                warnings.push(`${result.failedItems.length} item(s) failed during write`);
            }

            return successResponse(
                {
                    batchId: result.batchId,
                    totalCollected: Number(result.totalCollected.toFixed(2)),
                    itemsProcessed: result.itemsProcessed,
                    attendanceProcessed,
                    warnings: warnings.length > 0 ? warnings : undefined,
                    message: 'Collections submitted for Review',
                },
                `Successfully staged ${result.itemsProcessed} collections totaling ₹${result.totalCollected.toFixed(2)}. Awaiting BM approval.`
            );

        } catch (error) {
            if (uploadedPhotoKey) {
                try {
                    await deleteCollectionMeetingPhoto(uploadedPhotoKey);
                } catch (cleanupErr) {
                    console.error('[Demand Collection] Failed to clean up orphaned meeting photo:', cleanupErr);
                }
            }

            const errMsg = error instanceof Error ? error.message : 'Unknown error';

            if (errMsg.includes('Transaction already closed') || errMsg.includes('Transaction API error')) {
                return errorResponse(
                    'Transaction timed out while processing collections. Try submitting fewer items at once.',
                    504
                );
            }

            return errorResponse(
                `Failed to process demand collection: ${errMsg}`,
                500
            );
        }
    })(request);
}

/**
 * GET /api/collections/demand?mode=history&centerId=...&date=...
 * Fetch previously submitted demand collections grouped by batch for a center + date.
 * Used by the delete-demand-collection page.
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

            // Fetch all REPAYMENT transactions for this center on this date
            const repayments = await prisma.loanTransaction.findMany({
                where: {
                    centerId,
                    type: 'REPAYMENT',
                    collectionType: 'Demand Collection',
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

            // Fetch associated SAVINGS_COLLECTION from same batches
            const batchIds = [...new Set(repayments.map(r => r.collectionBatchId).filter(Boolean))];
            const savingsMap = new Map<string, number>();
            if (batchIds.length > 0) {
                const savings = await prisma.loanTransaction.findMany({
                    where: {
                        centerId,
                        type: 'SAVINGS_COLLECTION' as any,
                        collectionBatchId: { in: batchIds as string[] },
                        transactionDate: { gte: dayStartUtc, lt: dayEndExclusiveUtc },
                    },
                    select: { collectionBatchId: true, amount: true },
                });
                for (const s of savings) {
                    if (!s.collectionBatchId) continue;
                    savingsMap.set(s.collectionBatchId, (savingsMap.get(s.collectionBatchId) ?? 0) + Number(s.amount));
                }
            }

            // Group by batch
            const batchMap = new Map<string, any>();
            for (const tx of repayments) {
                const bid = tx.collectionBatchId ?? tx.id;
                if (!batchMap.has(bid)) {
                    batchMap.set(bid, {
                        batchId: bid,
                        collectionDate: tx.transactionDate,
                        centerId: center.id,
                        centerCode: center.code,
                        centerName: center.name,
                        clientIds: new Set<string>(),
                        totalRepayment: 0,
                        totalLoanAdvance: savingsMap.get(bid) ?? 0,
                        status: tx.status,
                        canDelete: tx.status === 'PENDING',
                        transactionIds: [] as string[],
                    });
                }
                const entry = batchMap.get(bid)!;
                entry.clientIds.add(tx.clientId);
                entry.totalRepayment += Number(tx.amount);
                entry.transactionIds.push(tx.id);
                if (tx.status !== 'PENDING') entry.canDelete = false;
            }

            const batches = Array.from(batchMap.values()).map(b => ({
                ...b,
                noOfClients: b.clientIds.size,
                clientIds: undefined,
                totalRepayment: Number(b.totalRepayment.toFixed(2)),
                totalLoanAdvance: Number(b.totalLoanAdvance.toFixed(2)),
            }));

            return successResponse({ batches, centerName: center.name, centerCode: center.code }, 'Collection history fetched');
        } catch (error) {
            console.error('[Demand History] Error:', error);
            return errorResponse('Failed to fetch collection history', 500);
        }
    })(request);
}

/**
 * DELETE /api/collections/demand
 * Delete demand collection batches (PENDING only).
 * Body: { centerId, batchIds: string[] }
 * Also deletes associated SAVINGS_COLLECTION transactions from the same batches.
 */
export async function DELETE(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const body = await req.json();
            const { centerId, batchIds } = body;

            if (!centerId) return errorResponse('centerId is required', 400);
            if (!Array.isArray(batchIds) || batchIds.length === 0) {
                return errorResponse('batchIds must be a non-empty array', 400);
            }

            const center = await prisma.center.findUnique({
                where: { id: centerId },
                select: { id: true, branchId: true },
            });
            if (!center) return errorResponse('Center not found', 404);

            // Only branch managers, admins, and area managers can delete
            if (user.role === 'FDO') {
                return errorResponse('FDOs cannot delete demand collections', 403);
            }

            // Verify all transactions in these batches are PENDING
            const approvedCount = await prisma.loanTransaction.count({
                where: {
                    centerId,
                    collectionBatchId: { in: batchIds },
                    status: { not: 'PENDING' as any },
                },
            });
            if (approvedCount > 0) {
                return errorResponse(`Cannot delete: ${approvedCount} transaction(s) are already approved. Only PENDING collections can be deleted.`, 400);
            }

            // Delete within a transaction
            const result = await prisma.$transaction(async (tx) => {
                // Delete transaction lines first (FK constraint)
                const lines = await tx.loanTransactionLine.deleteMany({
                    where: {
                        transaction: {
                            centerId,
                            collectionBatchId: { in: batchIds },
                        },
                    },
                });

                // Delete REPAYMENT and SAVINGS_COLLECTION transactions for these batches
                const deleted = await tx.loanTransaction.deleteMany({
                    where: {
                        centerId,
                        collectionBatchId: { in: batchIds },
                        type: { in: ['REPAYMENT', 'SAVINGS_COLLECTION'] as any },
                    },
                });

                return { deletedTransactions: deleted.count, deletedLines: lines.count };
            });

            return successResponse(
                result,
                `Deleted ${result.deletedTransactions} transaction(s) and ${result.deletedLines} line(s)`
            );
        } catch (error) {
            console.error('[Delete Demand] Error:', error);
            return errorResponse('Failed to delete demand collections', 500);
        }
    })(request);
}
