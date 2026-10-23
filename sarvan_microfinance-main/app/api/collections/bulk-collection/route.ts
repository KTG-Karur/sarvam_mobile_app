import { NextRequest } from 'next/server';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
} from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { format, addDays } from 'date-fns';
import { assertBranchNotLocked, getKolkataCalendarYmd } from '@/app/lib/branch-lock';
import { parseDenominationEntryDateUtc } from '@/app/lib/branch-financial-day';
import { resolveLoanFrequencyForDisplay } from '@/app/lib/loan-frequency';
import { allocateTransactionLines } from '@/app/lib/loan-transaction-lines';
import { getBranchWorkingDayWindow } from '@/app/lib/branch-working-day-guard';
import { getPendingScheduleAmounts } from '@/app/lib/collections/pending-schedule-amounts';
import { NON_OUTSTANDING_SCHEDULE_STATUSES } from '@/app/lib/collections/demand-calculation';
import { excludePendingClosureAllocationWhere, pendingClosureAllocationLoanCondition } from '@/app/lib/eod-closure-allocation';
import { applyPendingToSchedule } from '@/app/lib/collections/effective-schedule';
import { upcomingWindowDays } from '@/app/lib/collections/collection-due-window';
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

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/collections/bulk-collection
 * Fetch demand sheet for bulk collection (all clients in a center with dues)
 * Query params: centerId, collectionDate (optional, defaults to today)
 */
export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const centerId = searchParams.get('centerId');
            const collectionDateParam = searchParams.get('collectionDate');

            if (!centerId) {
                return errorResponse('Center ID is required', 400);
            }

            const centerRecord = await prisma.center.findUnique({
                where: { id: centerId },
                select: { branchId: true, fdoId: true },
            });
            if (!centerRecord) {
                return errorResponse('Center not found', 404);
            }
            const accessError = await checkCenterAccess(user, centerRecord);
            if (accessError) {
                return errorResponse(accessError, 403);
            }

            // Parse collection date or use today
            const collectionDate = collectionDateParam
                ? new Date(collectionDateParam)
                : new Date();
            collectionDate.setHours(0, 0, 0, 0);

            // Fetch all active loans for this center
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
                            clientId: true,
                            firstName: true,
                            lastName: true,
                            mobileNumber: true,
                            phone: true,
                        }
                    },
                    loanProduct: {
                        select: {
                            productName: true,
                            frequency: true,
                        }
                    },
                    schedules: {
                        where: {
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

            // Any still-PENDING (not yet approved) collection against these
            // schedules — from this page, or any other collection page — must be
            // netted out before showing what's still collectable, so the same due
            // can never be collected twice while awaiting BM approval. Batched
            // once for every loan in the center (not per-client) to avoid N+1.
            const allScheduleIds = loans.flatMap(loan => loan.schedules.map(s => s.id));
            const pendingByScheduleId = await getPendingScheduleAmounts(allScheduleIds);

            // Process each loan to calculate dues
            const demandSheet = [];

            for (const loan of loans) {
                // "Upcoming" window: next 5 days, but 0 for DAILY loans (see upcomingWindowDays).
                const upcomingWindowEnd = addDays(collectionDate, upcomingWindowDays(loan.frequency));
                let totalArrearsPrincipal = 0;
                let totalArrearsInterest = 0;
                let totalCurrentDuePrincipal = 0;
                let totalCurrentDueInterest = 0;
                let hasArrears = false;
                let hasCurrentDue = false;

                // Calculate arrears and current dues
                for (const schedule of loan.schedules) {
                    const scheduleDueDate = new Date(schedule.dueDate);
                    scheduleDueDate.setHours(0, 0, 0, 0);

                    const bumped = applyPendingToSchedule(
                        {
                            principalPaid: Number(schedule.principalPaid || 0),
                            interestPaid: Number(schedule.interestPaid || 0),
                            feesPaid: Number(schedule.feesPaid || 0),
                            penaltiesPaid: Number(schedule.penaltiesPaid || 0),
                        },
                        pendingByScheduleId.get(schedule.id)
                    );
                    const principalRemaining = Math.max(0, Number(schedule.principalDue) - bumped.principalPaid);
                    const interestRemaining = Math.max(0, Number(schedule.interestDue) - bumped.interestPaid);

                    if (scheduleDueDate < collectionDate) {
                        // Past due = Arrears
                        totalArrearsPrincipal += principalRemaining;
                        totalArrearsInterest += interestRemaining;
                        if (principalRemaining > 0 || interestRemaining > 0) {
                            hasArrears = true;
                        }
                    } else if (scheduleDueDate >= collectionDate && scheduleDueDate <= upcomingWindowEnd) {
                        // Due today or in next 3-5 days
                        totalCurrentDuePrincipal += principalRemaining;
                        totalCurrentDueInterest += interestRemaining;
                        if (principalRemaining > 0 || interestRemaining > 0) {
                            hasCurrentDue = true;
                        }
                    }
                }

                // Only include clients with arrears OR current dues
                if (hasArrears || hasCurrentDue) {
                    const totalDue = totalArrearsPrincipal + totalArrearsInterest +
                        totalCurrentDuePrincipal + totalCurrentDueInterest;

                    const loanAmount = Number(loan.amount);
                    const principalPaid = Number(loan.principalPaid || 0);
                    const loanOutstanding = loanAmount - principalPaid;

                    demandSheet.push({
                        clientId: loan.client.id,
                        clientCode: loan.client.clientId,
                        clientMobile: loan.client.mobileNumber ?? loan.client.phone ?? null,
                        clientName: `${loan.client.firstName} ${loan.client.lastName}`,
                        loanId: loan.id,
                        loanNumber: loan.loanNumber,
                        loanAmount: Number(loanAmount.toFixed(2)),
                        loanOutstanding: Number(loanOutstanding.toFixed(2)),
                        productName: loan.loanProduct?.productName || 'N/A',
                        frequency: resolveLoanFrequencyForDisplay(
                            loan.frequency,
                            loan.loanProduct?.frequency
                        ),

                        // Arrears
                        arrearsPrincipal: Number(totalArrearsPrincipal.toFixed(2)),
                        arrearsInterest: Number(totalArrearsInterest.toFixed(2)),
                        totalArrears: Number((totalArrearsPrincipal + totalArrearsInterest).toFixed(2)),

                        // Current Due
                        currentDuePrincipal: Number(totalCurrentDuePrincipal.toFixed(2)),
                        currentDueInterest: Number(totalCurrentDueInterest.toFixed(2)),
                        totalCurrentDue: Number((totalCurrentDuePrincipal + totalCurrentDueInterest).toFixed(2)),

                        // Total Due (Arrears + Current)
                        totalDue: Number(totalDue.toFixed(2)),

                        // Default collected amount (pre-filled with total due)
                        collectedAmount: Number(totalDue.toFixed(2)),

                        // Default to selected
                        isSelected: true,
                    });
                }
            }

            // Sort by client name
            demandSheet.sort((a, b) => compareMemberIds(a.clientCode, b.clientCode) || a.clientName.localeCompare(b.clientName));

            return successResponse(
                {
                    centerId,
                    collectionDate: format(collectionDate, 'yyyy-MM-dd'),
                    totalClients: demandSheet.length,
                    demandSheet,
                },
                'Demand sheet fetched successfully'
            );

        } catch (error) {
            console.error('[Bulk Collection] Error:', error);
            return errorResponse('Failed to fetch demand sheet', 500);
        }
    })(request);
}

/**
 * POST /api/collections/bulk-collection
 * Process bulk collection for multiple clients
 */
export async function POST(request: NextRequest) {
    return withAuth(async (req, user) => {
        let uploadedPhotoKey: string | null = null;
        try {
            const formData = await req.formData();
            const centerId = formData.get('centerId') as string | null;
            const collectionDate = formData.get('collectionDate') as string | null;
            const collectionType = formData.get('collectionType') as string | null;
            const photo = formData.get('photo') as File | null;
            const latitudeRaw = formData.get('latitude') as string | null;
            const longitudeRaw = formData.get('longitude') as string | null;
            const latitude = latitudeRaw != null && latitudeRaw !== '' ? parseFloat(latitudeRaw) : null;
            const longitude = longitudeRaw != null && longitudeRaw !== '' ? parseFloat(longitudeRaw) : null;

            let collections: unknown;
            let denominationRaw: Record<string, unknown>;
            try {
                collections = JSON.parse((formData.get('collections') as string) || '[]');
                denominationRaw = JSON.parse((formData.get('denomination') as string) || '{}');
            } catch {
                return errorResponse('Invalid JSON in collections/denomination fields', 400);
            }

            // Validation
            if (!centerId || !collectionDate || !collectionType || !Array.isArray(collections)) {
                return errorResponse('Missing required fields', 400);
            }

            // Loan Advance kill-switch — zero out any incoming loanAdvance amount
            // when the feature is disabled project-wide.
            const loanAdvanceEnabled = await getLoanAdvanceEnabled();
            const collectionsList: any[] = loanAdvanceEnabled
                ? (collections as any[])
                : (collections as any[]).map((c) => ({ ...c, loanAdvance: 0 }));

            if (!photo) {
                return errorResponse('Meeting photo is required', 400);
            }
            if (!ALLOWED_MEETING_PHOTO_TYPES.includes(photo.type)) {
                return errorResponse('Meeting photo must be JPEG, PNG or WEBP', 400);
            }

            // Filter only selected collections with a collection amount or a loan
            // advance (or both) — a loan-advance-only row (amount = 0) is valid.
            const validCollections = collectionsList.filter(
                (c: any) => c.isSelected && (Number(c.amount) > 0 || Number(c.loanAdvance) > 0)
            );

            if (validCollections.length === 0) {
                return errorResponse('No valid collections to process', 400);
            }

            // ── Branch Lock Guard ──
            // Resolve branchId from the center before processing
            const center = await prisma.center.findUnique({
                where: { id: centerId },
                select: { branchId: true, fdoId: true, name: true },
            });
            if (!center?.branchId) {
                return errorResponse('Center branch context is required', 400);
            }

            const accessError = await checkCenterAccess(user, center);
            if (accessError) {
                return errorResponse(accessError, 403);
            }

            const lockResponse = await assertBranchNotLocked(center.branchId);
            if (lockResponse) return lockResponse;

            // Collection/GL date is always the branch's current working day (not
            // whatever the client submitted) — same convention as
            // disbursement/single-collection, so a branch that hasn't rolled EOD
            // forward to today's real calendar date still works instead of erroring out.
            const workingDay = await getBranchWorkingDayWindow({ branchId: center.branchId });
            const bulkTxnDate = workingDay.dayStartUtc;

            // Generate a batch ID for this bulk collection
            const now = new Date();
            const dateStr = format(now, 'yyyyMMdd');
            const timeStr = format(now, 'HHmmss');
            const batchId = `BATCH-${dateStr}-${timeStr}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

            // ── Denomination must match the batch's collected cash (server-computed) ──
            const batchCashTotal = validCollections.reduce(
                (sum: number, c: any) => sum + Number(c.amount || 0) + Math.max(0, Number(c.loanAdvance) || 0),
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
                    centerId,
                    collectionBatchId: batchId,
                });
                photoKey = uploadResult.photoKey;
                photoUrl = uploadResult.photoUrl;
                uploadedPhotoKey = photoKey;
            } catch (uploadErr) {
                console.error('[Bulk Collection] Meeting photo upload failed:', uploadErr);
                return errorResponse('Failed to upload meeting photo', 500);
            }

            // Process all collections in a transaction
            const result = await prisma.$transaction(async (tx) => {
                const processedTransactions = [];
                let totalCollected = 0;
                let successCount = 0;
                let failureCount = 0;
                const warnings: string[] = [];

                for (const collection of validCollections) {
                    try {
                        const { clientId, loanId, amount } = collection;
                        const loanAdvance = Math.max(0, Number(collection.loanAdvance) || 0);

                        if (!clientId || !loanId || !Number.isFinite(Number(amount)) || Number(amount) < 0) {
                            failureCount++;
                            continue;
                        }
                        if (Number(amount) <= 0 && loanAdvance <= 0) {
                            failureCount++;
                            continue;
                        }

                        // Fetch loan with schedules
                        const loan = await tx.loan.findFirst({
                            where: {
                                id: loanId,
                                clientId,
                                centerId,
                                isActive: true,
                                disbursementStatus: 'DISBURSED',
                                ...excludePendingClosureAllocationWhere(),
                            },
                            include: {
                                schedules: {
                                    where: {
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

                        if (!loan) {
                            failureCount++;
                            continue;
                        }

                        // Net out any still-PENDING (not yet approved) collection
                        // against these schedules — from this page, or any other
                        // collection page — so the same due can never be collected
                        // twice while awaiting BM approval. Read via `tx` since this
                        // runs inside the same transaction as the loan fetch above.
                        // Note: this only sees PENDING rows already committed before
                        // this transaction started — two rows in the SAME batch
                        // against the same loan won't see each other's in-flight
                        // amount (pre-existing edge case, not introduced here).
                        const pendingByScheduleId = await getPendingScheduleAmounts(
                            loan.schedules.map(schedule => schedule.id),
                            { client: tx }
                        );

                        // Transform schedules to match expected type for allocateTransactionLines
                        // (*Paid already net of pending — single source of truth used
                        // below for both the remaining-due cap and allocation).
                        const transformedSchedules = loan.schedules.map(schedule => {
                            const bumped = applyPendingToSchedule(
                                {
                                    principalPaid: Number(schedule.principalPaid || 0),
                                    interestPaid: Number(schedule.interestPaid || 0),
                                    feesPaid: Number(schedule.feesPaid || 0),
                                    penaltiesPaid: Number(schedule.penaltiesPaid || 0),
                                },
                                pendingByScheduleId.get(schedule.id)
                            );
                            return {
                                id: schedule.id,
                                installmentNo: schedule.installmentNo,
                                dueDate: schedule.dueDate,
                                principalDue: Number(schedule.principalDue),
                                interestDue: Number(schedule.interestDue),
                                feesDue: Number(schedule.feesDue || 0),
                                penaltiesDue: Number(schedule.penaltiesDue || 0),
                                principalPaid: bumped.principalPaid,
                                interestPaid: bumped.interestPaid,
                                feesPaid: bumped.feesPaid,
                                penaltiesPaid: bumped.penaltiesPaid,
                                status: schedule.status,
                            };
                        });

                        // Calculate Snapshot for CCR (Client Collection Report) from current schedule state (no writes)
                        let openingArrearsPrincipal = 0;
                        let openingArrearsInterest = 0;
                        let currentDemandPrincipal = 0;
                        let currentDemandInterest = 0;

                        const collectionDateObj = new Date(collectionDate);
                        collectionDateObj.setHours(0, 0, 0, 0);
                        const upcomingWindowEnd = new Date(collectionDateObj);
                        upcomingWindowEnd.setDate(upcomingWindowEnd.getDate() + upcomingWindowDays(loan.frequency));

                        let totalRemainingDue = 0;
                        for (const schedule of transformedSchedules) {
                            const scheduleDueDate = new Date(schedule.dueDate);
                            scheduleDueDate.setHours(0, 0, 0, 0);

                            const principalRemaining = schedule.principalDue - schedule.principalPaid;
                            const interestRemaining = schedule.interestDue - schedule.interestPaid;
                            const feesRemaining = schedule.feesDue - schedule.feesPaid;
                            const penaltiesRemaining = schedule.penaltiesDue - schedule.penaltiesPaid;

                            totalRemainingDue += Math.max(0, principalRemaining + interestRemaining + feesRemaining + penaltiesRemaining);

                            if (scheduleDueDate < collectionDateObj) {
                                // Arrears
                                openingArrearsPrincipal += principalRemaining;
                                openingArrearsInterest += interestRemaining;
                            } else if (scheduleDueDate >= collectionDateObj && scheduleDueDate <= upcomingWindowEnd) {
                                // Current Demand
                                currentDemandPrincipal += principalRemaining;
                                currentDemandInterest += interestRemaining;
                            }
                        }

                        // Determine Collection Type for Report
                        const reportCollectionType = (currentDemandPrincipal + currentDemandInterest) > 0
                            ? "Demand Collection"
                            : "Non Demand Collection";

                        // A loan-advance-only row (amount = 0) skips allocation entirely —
                        // there is no repayment to apply against schedules.
                        const hasCollectionAmount = Number(amount) > 0;
                        let allocation: ReturnType<typeof allocateTransactionLines> = {
                            lines: [],
                            summary: { principalAmount: 0, interestAmount: 0, feesAmount: 0, penaltyAmount: 0, lineTotal: 0 },
                            remainingAmount: 0,
                        };

                        if (hasCollectionAmount) {
                            allocation = allocateTransactionLines(transformedSchedules, Number(amount), 'default');
                            if (allocation.lines.length === 0) {
                                failureCount++;
                                continue;
                            }

                            if (Number(amount) > totalRemainingDue * 1.001) {
                                warnings.push(
                                    `Skipped loan ${loanId}: amount exceeds remaining due (remaining ₹${totalRemainingDue.toFixed(2)})`
                                );
                                failureCount++;
                                continue;
                            }
                        }

                        // Generate transaction ID
                        const transactionId = `TXN-${dateStr}-${timeStr}-${successCount + 1}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

                        // Create transaction record (repayment) only when there's an actual collection amount
                        if (hasCollectionAmount) {
                            await tx.loanTransaction.create({
                                data: {
                                    transactionId,
                                    loanId,
                                    branchId: loan.branchId,
                                    clientId,
                                    centerId,
                                    amount: Number(amount),
                                    type: 'REPAYMENT',
                                    paymentMode: collectionType === 'CASH_IN_HAND' ? 'CASH' : 'BANK_TRANSFER',
                                    transactionDate: bulkTxnDate,
                                    collectedById: user.userId,
                                    remarks: `Bulk collection - ${collectionType}`,
                                    status: 'PENDING' as any,
                                    collectionBatchId: batchId,
                                    batchId, // legacy field used by some reports; keep in sync
                                    principalAmount: allocation.summary.principalAmount,
                                    interestAmount: allocation.summary.interestAmount,
                                    feesAmount: allocation.summary.feesAmount,
                                    penaltyAmount: allocation.summary.penaltyAmount,
                                    // CCR Snapshot Fields
                                    openingArrearsPrincipal,
                                    openingArrearsInterest,
                                    currentDemandPrincipal,
                                    currentDemandInterest,
                                    collectionType: reportCollectionType,
                                    lines: {
                                        create: allocation.lines.map((line) => ({
                                            scheduleId: line.scheduleId,
                                            installmentNo: line.installmentNo,
                                            principalAmount: line.principalAmount,
                                            interestAmount: line.interestAmount,
                                            feesAmount: line.feesAmount,
                                            penaltyAmount: line.penaltyAmount,
                                            lineTotal: line.lineTotal,
                                        })),
                                    },
                                }
                            });
                        }

                        let savingsTxnId: string | null = null;
                        if (loanAdvance > 0) {
                            savingsTxnId = `TXN-SAV-${dateStr}-${timeStr}-${successCount + 1}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
                            await tx.loanTransaction.create({
                                data: {
                                    transactionId: savingsTxnId,
                                    loanId,
                                    branchId: loan.branchId,
                                    clientId,
                                    centerId,
                                    amount: loanAdvance,
                                    type: 'SAVINGS_COLLECTION' as any,
                                    paymentMode: collectionType === 'CASH_IN_HAND' ? 'CASH' : 'BANK_TRANSFER',
                                    transactionDate: bulkTxnDate,
                                    collectedById: user.userId,
                                    status: 'PENDING' as any,
                                    collectionBatchId: batchId,
                                    collectionType: 'Bulk Collection',
                                    remarks: 'Advance savings collection',
                                } as any,
                            });
                        }

                        processedTransactions.push({
                            transactionId: hasCollectionAmount ? transactionId : (savingsTxnId ?? transactionId),
                            clientId,
                            loanId,
                            amount: Number(amount),
                            principalPayment: Number(allocation.summary.principalAmount.toFixed(2)),
                            interestPayment: Number(allocation.summary.interestAmount.toFixed(2)),
                            feePayment: Number(allocation.summary.feesAmount.toFixed(2)),
                            penaltyPayment: Number(allocation.summary.penaltyAmount.toFixed(2)),
                        });

                        totalCollected += Number(amount);
                        successCount++;

                    } catch (error) {
                        console.error('[Bulk Collection] Error processing collection:', error);
                        failureCount++;
                    }
                }

                await tx.collectionMeetingRecord.create({
                    data: {
                        collectionBatchId: batchId,
                        centerId,
                        branchId: center.branchId,
                        // @db.Date column: plain UTC-midnight for the business day, not the
                        // IST-anchored bulkTxnDate — see demand/route.ts for why.
                        collectionDate: parseDenominationEntryDateUtc(getKolkataCalendarYmd(bulkTxnDate)),
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

                return {
                    processedTransactions,
                    totalCollected,
                    successCount,
                    failureCount,
                    batchId,
                    warnings: warnings.length > 0 ? warnings : undefined,
                };
            });

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
                        centerId,
                        branchId: center.branchId,
                        label: center.name ? `Collection at ${center.name}` : 'Collection submitted',
                    },
                }).catch((err) => console.error('[Bulk Collection] Failed to record tracking event:', err));
            }

            return successResponse(
                {
                    batchId: result.batchId,
                    totalCollected: Number(result.totalCollected.toFixed(2)),
                    successCount: result.successCount,
                    failureCount: result.failureCount,
                    transactions: result.processedTransactions,
                    warnings: (result as any).warnings,
                },
                `Collections submitted for Review. Awaiting BM approval.`
            );

        } catch (error) {
            if (uploadedPhotoKey) {
                try {
                    await deleteCollectionMeetingPhoto(uploadedPhotoKey);
                } catch (cleanupErr) {
                    console.error('[Bulk Collection] Failed to clean up orphaned meeting photo:', cleanupErr);
                }
            }
            console.error('[Bulk Collection] Error:', error);
            return errorResponse('Failed to process bulk collection', 500);
        }
    })(request);
}
