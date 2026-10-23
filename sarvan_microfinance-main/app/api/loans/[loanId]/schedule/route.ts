import { NextRequest } from 'next/server';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
} from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { addDays, addMonths, addWeeks, format } from 'date-fns';
import { aggregateCollectionFromTransactionLines } from '@/app/lib/reports/loan-collection-aggregation';
import { generateDailyRepaymentDates } from '@/app/lib/schedule/daily-schedule';
import { getKolkataCalendarYmd } from '@/app/lib/branch-lock';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/loans/[loanId]/schedule
 * Get the repayment schedule for a specific loan
 * IMPORTANT: Reports should reflect collection transactions immediately.
 * We derive "collectedAmount" from `LoanTransactionLine` rows (single source of truth),
 * which covers both PENDING and APPROVED collections, and avoids relying on potentially
 * stale `LoanSchedule.*Paid` columns.
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ loanId: string }> }
) {
    return withAuth(async (req, user) => {
        try {
            const { loanId } = await params;

            if (!loanId) {
                return errorResponse('Loan ID is required', 400);
            }

            // Fetch loan with product details and schedule
            const loan = await prisma.loan.findUnique({
                where: { id: loanId },
                include: {
                    client: {
                        include: {
                            groupMemberships: {
                                include: {
                                    group: true
                                }
                            }
                        }
                    },
                    center: {
                        select: {
                            id: true,
                            code: true,
                            name: true,
                            meetingDay: true,
                            meetingPlace: true,
                            address: true,
                        }
                    },
                    branch: {
                        select: {
                            id: true,
                            code: true,
                            name: true,
                            address: true,
                        }
                    },
                    schedules: {
                        orderBy: {
                            installmentNo: 'asc'
                        },
                        include: {
                            transactionLines: {
                                where: {
                                    transaction: {
                                        isReversed: false,
                                        status: { in: ['PENDING', 'APPROVED'] as any },
                                    },
                                },
                                select: {
                                    lineTotal: true,
                                    principalAmount: true,
                                    interestAmount: true,
                                    transaction: { select: { transactionDate: true } },
                                },
                            },
                        },
                    },
                    deathMarking: { where: { isReversed: false } },
                }
            });

            if (!loan) {
                return errorResponse('Loan not found', 404);
            }

            // Get loan product details if available
            let productDetails = null;
            if (loan.loanProductId) {
                const product = await prisma.loanProduct.findUnique({
                    where: { id: loan.loanProductId },
                    select: {
                        productName: true,
                        numberOfDues: true,
                        interestRate: true,
                    }
                });
                productDetails = product;
            }

            // Determine disbursement/start date — disbursedByBMAt is the true final BM
            // disbursement (per CLAUDE.md lifecycle); approvedLevel2At is only AM approval
            // and must not be used as a disbursement-date proxy.
            const disbursedDate = loan.disbursedByBMAt || loan.disbursedLevel1At || loan.createdAt;
            const freq = loan.frequency?.toUpperCase() || 'WEEKLY';

            let schedule = [];

            // OPTION 1: Read from LoanSchedule table (preferred - shows actual saved schedule)
            if (loan.schedules && loan.schedules.length > 0) {
                // Outstanding principal balance per row = Loan Amount − cumulative
                // principal due through and including this installment. Interest is a
                // cost, not part of the loan balance, so it's excluded.
                let runningBalance = Number(loan.amount);

                schedule = loan.schedules.map((scheduleItem: any) => {
                    // Derived from principal + interest rather than the stored totalDue —
                    // some legacy schedule rows have totalDue persisted as principal + interest
                    // + savings (loan advance), which double-counts the loan advance amount.
                    const totalDue = Number(scheduleItem.principalDue) + Number(scheduleItem.interestDue);
                    runningBalance -= Number(scheduleItem.principalDue);
                    const balance = runningBalance;

                    const collection = aggregateCollectionFromTransactionLines(scheduleItem.transactionLines ?? []);

                    // For backup loans (no transaction lines), fall back to the schedule's own paid fields
                    const hasTransactionLines = (scheduleItem.transactionLines?.length ?? 0) > 0;
                    const collectedAmount = hasTransactionLines
                        ? Number(collection.total)
                        : Number(scheduleItem.principalPaid || 0)
                          + Number(scheduleItem.interestPaid || 0)
                          + Number(scheduleItem.feesPaid || 0)
                          + Number(scheduleItem.penaltiesPaid || 0);

                    const collectedPrincipal = hasTransactionLines
                        ? Number(collection.principal)
                        : Number(scheduleItem.principalPaid || 0);
                    const collectedInterest = hasTransactionLines
                        ? Number(collection.interest)
                        : Number(scheduleItem.interestPaid || 0);

                    const paidOn = collection.latestTransactionDate
                        ? collection.latestTransactionDate.toISOString()
                        : (!hasTransactionLines && scheduleItem.paidAt)
                        ? scheduleItem.paidAt.toISOString()
                        : null;

                    return {
                        installmentNo: scheduleItem.installmentNo,
                        dueDate: scheduleItem.dueDate.toISOString(),
                        principal: Number(scheduleItem.principalDue).toFixed(2),
                        interest: Number(scheduleItem.interestDue).toFixed(2),
                        savingsDue: Number(scheduleItem.savingsDue || 0).toFixed(2),
                        savingsPaid: Number(scheduleItem.savingsPaid || 0).toFixed(2),
                        totalDue: totalDue.toFixed(2),
                        balance: Math.max(0, balance).toFixed(2),
                        status: scheduleItem.status,
                        paidOn,
                        collectedAmount: collectedAmount.toFixed(2),
                        collectedPrincipal: collectedPrincipal.toFixed(2),
                        collectedInterest: collectedInterest.toFixed(2),
                    };
                });
            } else {
                // Calculate on-the-fly if no schedule exists
                let numberOfDues = loan.tenureMonths;
                if (freq === 'WEEKLY') numberOfDues = loan.tenureMonths * 4;
                else if (freq === 'BIWEEKLY' || freq === 'FORTHNIGHT') numberOfDues = Math.ceil(loan.tenureMonths * 2.16);
                else if (freq === 'MONTHLY') numberOfDues = loan.tenureMonths;
                else if (freq === 'DAILY') numberOfDues = loan.tenureMonths * 30;

                const principalAmount = Number(loan.amount);
                const ratePerPeriod = (Number(loan.interestRate) / 100) / (freq === 'MONTHLY' ? 12 : (freq === 'BIWEEKLY' || freq === 'FORTHNIGHT') ? 26 : 52);

                let remainingPrincipal = principalAmount;
                let runningBalance = principalAmount;

                if (freq === 'DAILY') {
                    const dailyResult = generateDailyRepaymentDates(
                        new Date(disbursedDate),
                        numberOfDues,
                    );

                    for (const entry of dailyResult.dates) {
                        const interestForPeriod = remainingPrincipal * ratePerPeriod;
                        const principalForPeriod = principalAmount / numberOfDues;
                        const totalDue = principalForPeriod + interestForPeriod;

                        runningBalance -= principalForPeriod;

                        schedule.push({
                            installmentNo: entry.installmentNo,
                            dueDate: entry.date.toISOString(),
                            principal: principalForPeriod.toFixed(2),
                            interest: interestForPeriod.toFixed(2),
                            totalDue: totalDue.toFixed(2),
                            balance: Math.max(0, runningBalance).toFixed(2),
                            status: 'PENDING',
                            paidOn: null,
                            collectedAmount: '0.00',
                            collectedPrincipal: '0.00',
                            collectedInterest: '0.00',
                        });

                        remainingPrincipal -= principalForPeriod;
                    }
                } else {
                    for (let i = 1; i <= numberOfDues; i++) {
                        const interestForPeriod = remainingPrincipal * ratePerPeriod;
                        const principalForPeriod = principalAmount / numberOfDues;
                        const totalDue = principalForPeriod + interestForPeriod;

                        runningBalance -= principalForPeriod;

                        let currentDate = new Date(disbursedDate);
                        if (freq === 'WEEKLY') currentDate = addWeeks(currentDate, i);
                        else if (freq === 'BIWEEKLY' || freq === 'FORTHNIGHT') currentDate = addWeeks(currentDate, i * 2);
                        else if (freq === 'MONTHLY') currentDate = addMonths(currentDate, i);

                        schedule.push({
                            installmentNo: i,
                            dueDate: currentDate.toISOString(),
                            principal: principalForPeriod.toFixed(2),
                            interest: interestForPeriod.toFixed(2),
                            totalDue: totalDue.toFixed(2),
                            balance: Math.max(0, runningBalance).toFixed(2),
                            status: 'PENDING',
                            paidOn: null,
                            collectedAmount: '0.00',
                            collectedPrincipal: '0.00',
                            collectedInterest: '0.00',
                        });

                        remainingPrincipal -= principalForPeriod;
                    }
                }
            }

            // ── Summary calculations ──────────────────────────────────────────────
            // IST calendar-day comparison (not a raw UTC/local Date compare) — a row is
            // only "arrear" once its due date has actually passed in Asia/Kolkata; a row
            // due today is still the current collectible due, not yet an arrear.
            const todayYmd = getKolkataCalendarYmd(new Date());

            const firstUnpaid = (schedule as any[]).find(
                (r) => r.status !== 'PAID' && r.status !== 'WAIVED'
            );
            // Arrear membership is decided by the actual remaining principal/interest
            // (ledger-derived collectedPrincipal/collectedInterest above), not the
            // `status` label — status is a cached/derived field that can drift out of
            // sync with the real due-vs-paid amounts (e.g. a reversal recomputing it
            // against a stale totalDue), which would silently exclude a mismarked-PAID
            // row's genuine outstanding balance. A truly-settled row still nets to
            // zero remaining, so this is a no-op for the common case.
            const arrearRows = (schedule as any[]).filter((r) => {
                if (getKolkataCalendarYmd(new Date(r.dueDate)) >= todayYmd) return false;
                const principalRemaining = Number(r.principal) - Number(r.collectedPrincipal);
                const interestRemaining = Number(r.interest) - Number(r.collectedInterest);
                return principalRemaining > 0 || interestRemaining > 0;
            });

            const totalCollectedPrincipal = (schedule as any[]).reduce((s, r) => s + Number(r.collectedPrincipal), 0);
            const totalCollectedInterest  = (schedule as any[]).reduce((s, r) => s + Number(r.collectedInterest), 0);
            const totalInterest           = (schedule as any[]).reduce((s, r) => s + Number(r.interest), 0);

            const summary = {
                currentDueNo:       firstUnpaid?.installmentNo ?? null,
                // Total interest not yet collected across the whole loan (mirrors
                // outstandingBalance being the whole-loan principal not yet collected).
                dueInterest:        Math.max(0, totalInterest - totalCollectedInterest),
                outstandingBalance: Math.max(0, Number(loan.amount) - totalCollectedPrincipal),
                arrearPrincipal:    arrearRows.reduce((s, r) => s + Math.max(0, Number(r.principal) - Number(r.collectedPrincipal)), 0),
                arrearInterest:     arrearRows.reduce((s, r) => s + Math.max(0, Number(r.interest)  - Number(r.collectedInterest)),  0),
                collectedPrincipal: totalCollectedPrincipal,
                collectedInterest:  totalCollectedInterest,
                totalInterest,
            };

            // Format client name as per PDF: "PUSHPMALAL S"
            const clientName = `${loan.client.firstName} ${loan.client.lastName || ''}`.trim();
            
            // Get group name
            const groupName = loan.client.groupMemberships?.[0]?.group?.name || 'GEN-GENERAL';

            // Client photo (from KYC: documentType = client_photo)
            const clientPhoto = await prisma.kYC.findFirst({
                where: {
                    clientId: loan.clientId,
                    documentType: 'client_photo',
                    isDeleted: false,
                    fileUrl: { not: null },
                },
                select: {
                    fileUrl: true,
                    mimeType: true,
                    createdAt: true,
                },
                orderBy: {
                    createdAt: 'desc',
                },
            });

            const responseData = {
                header: {
                    branchName: loan.branch?.name || 'GUDALUR',
                    centerName: loan.center?.name || 'KOZHIPALAM',
                    groupName: groupName,
                    clientId: loan.client.clientId,
                    accountId: loan.loanNumber,
                    clientName: clientName,
                    clientPhone: loan.client.mobileNumber || '-',
                    loanAmount: Number(loan.amount),
                    totalDues: schedule.length,
                    startDate: disbursedDate instanceof Date ? disbursedDate.toISOString() : new Date(disbursedDate).toISOString(),
                },
                loanDetails: {
                    loanNumber: loan.loanNumber,
                    clientName: clientName,
                    clientId: loan.client.clientId,
                    clientPhone: loan.client.mobileNumber,
                    clientPhotoUrl: clientPhoto?.fileUrl ?? null,
                    clientPhotoMimeType: clientPhoto?.mimeType ?? null,
                    clientAddress: loan.client.permanentAddress,
                    centerName: loan.center.name,
                    centerCode: loan.center.code,
                    groupName: groupName,
                    centerMeetingDay: loan.center.meetingDay || 'FRIDAY',
                    centerMeetingPlace: loan.center.meetingPlace || loan.center.address,
                    branchName: loan.branch?.name,
                    amount: Number(loan.amount),
                    interestRate: Number(loan.interestRate),
                    tenure: loan.tenureMonths,
                    frequency: freq,
                    productName: productDetails?.productName || 'N/A',
                    disbursedDate: disbursedDate instanceof Date ? disbursedDate.toISOString() : new Date(disbursedDate).toISOString(),
                    isDead: (loan as any).deathMarking?.length > 0,
                    deathMarking: (loan as any).deathMarking?.[0]
                        ? {
                            deceasedPersonType: (loan as any).deathMarking[0].deceasedPersonType,
                            deceasedPersonName: (loan as any).deathMarking[0].deceasedPersonName,
                            deathDate: (loan as any).deathMarking[0].deathDate,
                            placeOfDeath: (loan as any).deathMarking[0].placeOfDeath,
                            deathReason: (loan as any).deathMarking[0].deathReason,
                            demandRequired: (loan as any).deathMarking[0].demandRequired,
                          }
                        : null,
                },
                schedule,
                summary,
            };

            return successResponse(responseData, 'Loan schedule retrieved successfully');

        } catch (error) {
            console.error('Error fetching loan schedule:', error);
            return errorResponse('Failed to fetch loan schedule', 500);
        }
    })(request);
}
