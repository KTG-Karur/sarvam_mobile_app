import { NextRequest } from 'next/server';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
} from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { format } from 'date-fns';
import { assertBranchNotLocked, getKolkataCalendarYmd } from '@/app/lib/branch-lock';
import { parseDenominationEntryDateUtc } from '@/app/lib/branch-financial-day';
import { resolveLoanFrequencyForDisplay } from '@/app/lib/loan-frequency';
import { allocateTransactionLines } from '@/app/lib/loan-transaction-lines';
import { computeDueWindow, upcomingWindowDays } from '@/app/lib/collections/collection-due-window';
import { NON_OUTSTANDING_SCHEDULE_STATUSES } from '@/app/lib/collections/demand-calculation';
import { getBranchWorkingDayWindow } from '@/app/lib/branch-working-day-guard';
import { excludePendingClosureAllocationWhere, pendingClosureAllocationLoanCondition } from '@/app/lib/eod-closure-allocation';
import { getPendingScheduleAmounts } from '@/app/lib/collections/pending-schedule-amounts';
import { applyPendingToSchedule } from '@/app/lib/collections/effective-schedule';
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

const ALLOWED_MEETING_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/collections/single-collection
 * Fetch client loan details for single collection
 * Query params: clientId
 */
export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const clientId = searchParams.get('clientId');
            const collectionDateParam = searchParams.get('collectionDate');
            const loanIdParam = searchParams.get('loanId');

            if (!clientId) {
                return errorResponse('Client ID is required', 400);
            }

            // Fetch client with active loans (a client/member can have more than
            // one active loan — all are fetched so the FDO can switch between them).
            const client = await prisma.client.findUnique({
                where: { id: clientId },
                include: {
                    center: {
                        select: {
                            id: true,
                            name: true,
                            code: true,
                            branchId: true,
                            fdoId: true,
                        }
                    },
                    loanApplications: {
                        where: {
                            isActive: true,
                            disbursementStatus: 'DISBURSED',
                            NOT: [
                                { deathMarking: { some: { isReversed: false, demandRequired: false } } },
                                pendingClosureAllocationLoanCondition(),
                            ],
                        },
                        orderBy: {
                            createdAt: 'desc'
                        },
                        include: {
                            loanProduct: {
                                select: {
                                    productName: true,
                                    frequency: true,
                                }
                            },
                            schedules: {
                                where: {
                                    // Excludes only WAIVED/CLOSED, not PAID — see
                                    // NON_OUTSTANDING_SCHEDULE_STATUSES: status can drift
                                    // from the real due-vs-paid amounts, and a PAID row
                                    // wrongly excluded here silently drops its remaining
                                    // balance from arrears.
                                    status: {
                                        notIn: NON_OUTSTANDING_SCHEDULE_STATUSES
                                    }
                                },
                                orderBy: {
                                    dueDate: 'asc'
                                }
                            }
                        }
                    }
                }
            });

            if (!client) {
                return errorResponse('Client not found', 404);
            }

            if (client.center) {
                const accessError = await checkCenterAccess(user, client.center);
                if (accessError) {
                    return errorResponse(accessError, 403);
                }
            }

            if (client.loanApplications.length === 0) {
                return errorResponse('No active loan found for this client', 404);
            }

            // Select the requested loan (by loanId), defaulting to the most recent
            // active loan when the client has multiple and none was specified.
            const activeLoan = loanIdParam
                ? client.loanApplications.find(l => l.id === loanIdParam)
                : client.loanApplications[0];

            if (!activeLoan) {
                return errorResponse('Loan not found for this client', 404);
            }

            // Calculate loan financials
            const loanAmount = Number(activeLoan.amount);
            const principalPaid = Number(activeLoan.principalPaid || 0);
            const interestPaid = Number(activeLoan.interestPaid || 0);
            const penaltiesPaid = Number(activeLoan.penaltiesPaid || 0);

            const loanOutstanding = loanAmount - principalPaid;

            // Calculate arrears / current-due window, using the selected collection
            // date (defaults to today) — mirrors bulk-collection's GET windowing exactly.
            const collectionDate = collectionDateParam ? new Date(collectionDateParam) : new Date();
            collectionDate.setHours(0, 0, 0, 0);

            // Treat any still-PENDING (not yet approved) collection against these
            // schedules as if it were already paid, purely for this remaining-due
            // calculation — so a due already submitted (from this page, or any
            // other collection page) is never shown/allowed as collectable again
            // while it awaits Branch Manager approval. Nothing is written to the
            // DB here; LoanSchedule stays untouched until actual approval.
            const pendingByScheduleId = await getPendingScheduleAmounts(
                activeLoan.schedules.map(schedule => schedule.id)
            );
            const effectiveSchedules = activeLoan.schedules.map(schedule => {
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
                    dueDate: schedule.dueDate,
                    principalDue: Number(schedule.principalDue),
                    principalPaid: bumped.principalPaid,
                    interestDue: Number(schedule.interestDue),
                    interestPaid: bumped.interestPaid,
                };
            });

            const dueWindow = computeDueWindow(effectiveSchedules, collectionDate, activeLoan.frequency);
            const openingArrearsPrincipal = dueWindow.arrearsPrincipal;
            const openingArrearsInterest = dueWindow.arrearsInterest;

            let totalDueWeeks = 0;
            let totalCollectedWeeks = 0;

            activeLoan.schedules.forEach(schedule => {
                totalDueWeeks++;
                if (schedule.status === 'PAID') {
                    totalCollectedWeeks++;
                }
            });

            // Calculate interest balance (total interest due - interest paid),
            // net of any still-PENDING collection (see effectiveSchedules above).
            // Genuinely-settled rows contribute 0 here, so this sum is still the
            // total remaining interest even though PAID rows are now included.
            const interestBalance = effectiveSchedules.reduce((sum, s) =>
                sum + (s.interestDue - s.interestPaid), 0
            );

            // Get disbursement date
            const disbursementDate = activeLoan.disbursedLevel1At
                ? format(activeLoan.disbursedLevel1At, 'yyyy-MM-dd')
                : null;

            const responseData = {
                clientId: client.id,
                clientName: `${client.firstName} ${client.lastName}`,
                clientCode: client.clientId,
                clientMobile: client.mobileNumber ?? client.phone ?? null,
                centerId: client.center?.id,
                centerName: client.center?.name,
                centerCode: client.center?.code,

                // Loan details
                loanId: activeLoan.id,
                loanNumber: activeLoan.loanNumber,
                loanAmount: Number(loanAmount.toFixed(2)),
                loanOutstanding: Number(loanOutstanding.toFixed(2)),

                // All of this client's active loans, so the FDO can switch
                // between them one at a time when a member has multiple loans.
                availableLoans: client.loanApplications.map(loan => ({
                    loanId: loan.id,
                    loanNumber: loan.loanNumber,
                    loanAmount: Number(loan.amount),
                    productName: loan.loanProduct?.productName || 'N/A',
                })),

                // Financial details
                principalPaid: Number(principalPaid.toFixed(2)),
                interestPaid: Number(interestPaid.toFixed(2)),
                penaltiesPaid: Number(penaltiesPaid.toFixed(2)),
                interestBalance: Number(interestBalance.toFixed(2)),

                // Arrears
                openingArrearsPrincipal,
                openingArrearsInterest,
                totalArrears: dueWindow.totalArrears,

                // Current Due (installment(s) due for the selected collection date)
                currentDuePrincipal: dueWindow.currentDuePrincipal,
                currentDueInterest: dueWindow.currentDueInterest,
                totalCurrentDue: dueWindow.totalCurrentDue,

                // Total Due (Arrears + Current Due, for the selected collection date)
                totalDue: dueWindow.totalDue,

                collectionDate: format(collectionDate, 'yyyy-MM-dd'),

                // Schedule info
                dueWeeks: totalDueWeeks,
                collectedWeeks: totalCollectedWeeks,
                pendingWeeks: totalDueWeeks - totalCollectedWeeks,

                // Other details
                disbursementDate,
                frequency: resolveLoanFrequencyForDisplay(
                    activeLoan.frequency,
                    activeLoan.loanProduct?.frequency
                ),
                productName: activeLoan.loanProduct?.productName || 'N/A',

                // Pending schedules
                pendingSchedules: activeLoan.schedules.map(schedule => ({
                    scheduleId: schedule.id,
                    installmentNo: schedule.installmentNo,
                    dueDate: format(schedule.dueDate, 'yyyy-MM-dd'),
                    principalDue: Number(schedule.principalDue),
                    interestDue: Number(schedule.interestDue),
                    feesDue: Number(schedule.feesDue || 0),
                    penaltiesDue: Number(schedule.penaltiesDue || 0),
                    totalDue: Number(schedule.totalDue),
                    principalPaid: Number(schedule.principalPaid || 0),
                    interestPaid: Number(schedule.interestPaid || 0),
                    feesPaid: Number(schedule.feesPaid || 0),
                    penaltiesPaid: Number(schedule.penaltiesPaid || 0),
                    totalPaid: Number(schedule.totalPaid || 0),
                    status: schedule.status,
                }))
            };

            return successResponse(
                responseData,
                'Loan details fetched successfully'
            );

        } catch (error) {
            console.error('[Single Collection] Error:', error);
            return errorResponse('Failed to fetch loan details', 500);
        }
    })(request);
}

/**
 * POST /api/collections/single-collection
 * Submit single collection payment
 */
export async function POST(request: NextRequest) {
    return withAuth(async (req, user) => {
        let uploadedPhotoKey: string | null = null;
        try {
            const formData = await req.formData();
            const clientId = formData.get('clientId') as string | null;
            const loanId = formData.get('loanId') as string | null;
            const collectionType = formData.get('collectionType') as string | null;
            const amount = Number(formData.get('amount'));
            const loanAdvanceEnabled = await getLoanAdvanceEnabled();
            const loanAdvance = loanAdvanceEnabled ? Math.max(0, Number(formData.get('loanAdvance')) || 0) : 0;
            const paymentMode = (formData.get('paymentMode') as string | null) || 'CASH';
            const collectionDate = formData.get('collectionDate') as string | null;
            const remarks = formData.get('remarks') as string | null;
            const photo = formData.get('photo') as File | null;
            const latitudeRaw = formData.get('latitude') as string | null;
            const longitudeRaw = formData.get('longitude') as string | null;
            const latitude = latitudeRaw != null && latitudeRaw !== '' ? parseFloat(latitudeRaw) : null;
            const longitude = longitudeRaw != null && longitudeRaw !== '' ? parseFloat(longitudeRaw) : null;

            let denominationRaw: Record<string, unknown>;
            try {
                denominationRaw = JSON.parse((formData.get('denomination') as string) || '{}');
            } catch {
                return errorResponse('Invalid JSON in denomination field', 400);
            }

            // Validation — either a collection amount or a loan advance (or both) must
            // be present; a loan-advance-only submission with amount = 0 is valid.
            if (!clientId || !loanId || !collectionType || !Number.isFinite(amount) || amount < 0) {
                return errorResponse('Missing required fields', 400);
            }
            if (amount <= 0 && loanAdvance <= 0) {
                return errorResponse('Enter a collection amount or a loan advance', 400);
            }

            if (!photo) {
                return errorResponse('Meeting photo is required', 400);
            }
            if (!ALLOWED_MEETING_PHOTO_TYPES.includes(photo.type)) {
                return errorResponse('Meeting photo must be JPEG, PNG or WEBP', 400);
            }

            // ── Branch Lock Guard ──
            // Resolve the loan's branchId and check if the branch is locked
            const loanForLock = await prisma.loan.findUnique({
                where: { id: loanId },
                select: { branchId: true },
            });
            if (loanForLock) {
                const lockResponse = await assertBranchNotLocked(loanForLock.branchId);
                if (lockResponse) return lockResponse;
            }

            // Verify loan exists and belongs to client
            const loan = await prisma.loan.findFirst({
                where: {
                    id: loanId,
                    clientId,
                    isActive: true,
                    disbursementStatus: 'DISBURSED',
                    ...excludePendingClosureAllocationWhere(),
                },
                include: {
                    client: {
                        select: {
                            firstName: true,
                            lastName: true,
                        }
                    },
                    center: {
                        select: {
                            id: true,
                            name: true,
                            branchId: true,
                            fdoId: true,
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

            if (!loan) {
                return errorResponse('Loan not found or not active', 404);
            }

            if (loan.center) {
                const accessError = await checkCenterAccess(user, loan.center);
                if (accessError) {
                    return errorResponse(accessError, 403);
                }
            }

            // Net out any still-PENDING (not yet approved) collection against these
            // schedules — from this page, or any other collection page — so the
            // same due can never be collected twice while awaiting BM approval.
            // Nothing is written to the DB here; LoanSchedule stays untouched until
            // actual approval.
            const pendingByScheduleId = await getPendingScheduleAmounts(
                loan.schedules.map(schedule => schedule.id)
            );

            // Transform schedules for allocation (convert Decimal to number, *Paid
            // already net of pending — this is the single source of truth used
            // below for both the remaining-due cap and allocateTransactionLines).
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

            // Calculate CCR snapshot from current schedule state (no writes here)
            let openingArrearsPrincipal = 0;
            let openingArrearsInterest = 0;
            let currentDemandPrincipal = 0;
            let currentDemandInterest = 0;

            const collectionDateObj = collectionDate ? new Date(collectionDate) : new Date();
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
                    openingArrearsPrincipal += principalRemaining;
                    openingArrearsInterest += interestRemaining;
                } else if (scheduleDueDate >= collectionDateObj && scheduleDueDate <= upcomingWindowEnd) {
                    currentDemandPrincipal += principalRemaining;
                    currentDemandInterest += interestRemaining;
                }
            }

            const hasCollectionAmount = Number(amount) > 0;

            if (hasCollectionAmount && Number(amount) > totalRemainingDue * 1.001) {
                return errorResponse(
                    `Amount exceeds remaining due (remaining ₹${totalRemainingDue.toFixed(2)})`,
                    400
                );
            }

            const reportCollectionType = (currentDemandPrincipal + currentDemandInterest) > 0
                ? 'Demand Collection'
                : 'Non Demand Collection';

            const allocationMode =
                collectionType === 'principal' || collectionType === 'interest' || collectionType === 'penalty'
                    ? collectionType
                    : 'default';

            // A loan-advance-only submission (amount = 0) skips allocation entirely —
            // there is no repayment to apply against schedules.
            let allocation: ReturnType<typeof allocateTransactionLines> = {
                lines: [],
                summary: { principalAmount: 0, interestAmount: 0, feesAmount: 0, penaltyAmount: 0, lineTotal: 0 },
                remainingAmount: 0,
            };
            if (hasCollectionAmount) {
                allocation = allocateTransactionLines(transformedSchedules, Number(amount), allocationMode);
                if (allocation.lines.length === 0) {
                    return errorResponse('No payable schedule found for the supplied amount', 400);
                }
            }

            // The selected collectionDate only decides WHICH installment(s) this
            // payment is applied toward (see the arrears/current-demand windowing
            // above) — it is not when the cash changes hands. The actual
            // transaction/GL date is always the branch's current working day,
            // so collecting today against a future due date (an advance) is
            // never rejected as "outside the branch working day."
            const workingDay = await getBranchWorkingDayWindow({ branchId: loan.branchId });
            const transactionDate = workingDay.dayStartUtc;

            // Batch id ensures this transaction enters BM approval queue (maker-checker)
            const now = new Date();
            const dateStr = format(now, 'yyyyMMdd');
            const timeStr = format(now, 'HHmmss');
            const batchId = `BATCH-${dateStr}-${timeStr}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
            const transactionId = `TXN-${dateStr}-${timeStr}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

            // ── Denomination must match the collected cash (amount + loan advance) ──
            const cashTotal = Number((Number(amount) + loanAdvance).toFixed(2));
            const denomCounts = normalizeDenominationCounts(denominationRaw);
            const upiAmount = Math.max(0, Number(denominationRaw?.upi) || 0);
            const denomTotal = Number((calculateDenominationTotal(denomCounts) + upiAmount).toFixed(2));

            if (!denominationMatchesFlooredCollection(denomTotal, cashTotal)) {
                return errorResponse(
                    `Denomination total (₹${denomTotal.toFixed(2)}) does not match collected cash (₹${cashTotal.toFixed(2)})`,
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
                    branchId: loan.branchId,
                    centerId: loan.center?.id ?? 'unknown-center',
                    collectionBatchId: batchId,
                });
                photoKey = uploadResult.photoKey;
                photoUrl = uploadResult.photoUrl;
                uploadedPhotoKey = photoKey;
            } catch (uploadErr) {
                console.error('[Single Collection] Meeting photo upload failed:', uploadErr);
                return errorResponse('Failed to upload meeting photo', 500);
            }

            let savingsTxnId: string | null = null;

            await prisma.$transaction(async (tx) => {
                if (hasCollectionAmount) {
                    await tx.loanTransaction.create({
                        data: {
                            transactionId,
                            loanId,
                            branchId: loan.branchId,
                            clientId,
                            centerId: loan.center?.id,
                            amount: Number(amount),
                            type: 'REPAYMENT',
                            paymentMode,
                            transactionDate,
                            collectedById: user.userId,
                            status: 'PENDING' as any,
                            collectionBatchId: batchId,
                            remarks: remarks || `Single collection - ${collectionType}`,
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
                        } as any,
                    });
                }

                if (loanAdvance > 0) {
                    savingsTxnId = `TXN-SAV-${dateStr}-${timeStr}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
                    await tx.loanTransaction.create({
                        data: {
                            transactionId: savingsTxnId,
                            loanId,
                            branchId: loan.branchId,
                            clientId,
                            centerId: loan.center?.id,
                            amount: loanAdvance,
                            type: 'SAVINGS_COLLECTION' as any,
                            paymentMode,
                            transactionDate,
                            collectedById: user.userId,
                            status: 'PENDING',
                            collectionBatchId: batchId,
                            collectionType: 'Single Collection',
                            remarks: 'Advance savings collection',
                        } as any,
                    });
                }

                await tx.collectionMeetingRecord.create({
                    data: {
                        collectionBatchId: batchId,
                        centerId: loan.center?.id ?? '',
                        branchId: loan.branchId,
                        // @db.Date column: plain UTC-midnight for the business day, not the
                        // IST-anchored transactionDate (which truncates to the wrong UTC
                        // calendar date when written to a @db.Date field).
                        collectionDate: parseDenominationEntryDateUtc(getKolkataCalendarYmd(transactionDate)),
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
                        centerId: loan.center?.id ?? null,
                        branchId: loan.branchId,
                        label: loan.center?.name ? `Collection at ${loan.center.name}` : 'Collection submitted',
                    },
                }).catch((err) => console.error('[Single Collection] Failed to record tracking event:', err));
            }

            return successResponse(
                {
                    batchId,
                    transactionId: hasCollectionAmount ? transactionId : (savingsTxnId ?? transactionId),
                    amount: Number(amount),
                    loanAdvance,
                    principalPayment: Number(allocation.summary.principalAmount.toFixed(2)),
                    interestPayment: Number(allocation.summary.interestAmount.toFixed(2)),
                    feePayment: Number(allocation.summary.feesAmount.toFixed(2)),
                    penaltyPayment: Number(allocation.summary.penaltyAmount.toFixed(2)),
                },
                `Collection submitted for Review. Awaiting BM approval.`
            );

        } catch (error) {
            if (uploadedPhotoKey) {
                try {
                    await deleteCollectionMeetingPhoto(uploadedPhotoKey);
                } catch (cleanupErr) {
                    console.error('[Single Collection] Failed to clean up orphaned meeting photo:', cleanupErr);
                }
            }
            console.error('[Single Collection] Error:', error);
            return errorResponse('Failed to process payment', 500);
        }
    })(request);
}
