import { NextRequest } from 'next/server';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
} from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { getBranchWorkingDayWindow } from '@/app/lib/branch-working-day-guard';
import { getFirstDueDateConfig } from '@/app/lib/first-due-date-config';
import { recordLoanHistory } from '@/app/lib/loan-history';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * Helper function to get next valid date (skipping Sundays)
 */
function getNextValidDate(date: Date): Date {
    const nextDate = new Date(date);
    if (nextDate.getDay() === 0) {
        nextDate.setDate(nextDate.getDate() + 1);
    }
    return nextDate;
}

/**
 * Helper function to validate if a date matches the center's meeting day
 */
function validateMeetingDay(date: Date, meetingDay: string | null | undefined, frequency: string): { valid: boolean; message?: string } {
    if (frequency.toLowerCase() === 'daily' || !meetingDay) {
        return { valid: true };
    }

    const dateDay = date.getDay();
    const dayMap: Record<string, number> = {
        'SUNDAY': 0, 'MONDAY': 1, 'TUESDAY': 2, 'WEDNESDAY': 3,
        'THURSDAY': 4, 'FRIDAY': 5, 'SATURDAY': 6
    };

    const expectedDay = dayMap[meetingDay.toUpperCase()];
    if (expectedDay === undefined) return { valid: true };

    if (dateDay !== expectedDay) {
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        return {
            valid: false,
            message: `First due date must fall on center meeting day (${meetingDay}). Selected date is ${dayNames[dateDay]}.`
        };
    }
    return { valid: true };
}

/**
 * POST /api/loan-indexes/[indexId]/approve
 *
 * Unified "Approve & Submit for Disbursement" action.
 * When the BM approves loans in an index, they go directly to PENDING_LEVEL2
 * (ready for AM/HO final disbursement), skipping the intermediate APPROVED_LEVEL1 state.
 *
 * This merges what was previously two separate BM steps:
 *   1. Index Approval (PENDING_LEVEL1 → APPROVED_LEVEL1)
 *   2. Level 1 Disbursement (APPROVED_LEVEL1 → PENDING_LEVEL2)
 * into a single atomic action.
 *
 * The BM also sets the batch's First Due Date here. It is stored on each
 * approved loan (Loan.firstDueDate) so Final Disbursement can use it later —
 * but no LoanSchedule is generated yet; that only happens at final BM
 * disbursement (POST /api/disbursements/bm-disburse).
 */
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ indexId: string }> }
) {
    return withAuth(async (req, user) => {
        try {
            const { indexId } = await params;
            const body = await req.json();
            const { selectedLoanIds, rejectedLoanIds, firstDueDate } = body;

            let firstDue: Date | null = null;
            if (selectedLoanIds?.length > 0) {
                if (!firstDueDate || !/^\d{4}-\d{2}-\d{2}$/.test(firstDueDate)) {
                    return errorResponse('First due date is required (YYYY-MM-DD)', 400);
                }

                firstDue = new Date(firstDueDate);

                const loanIndex = await prisma.loanIndex.findUnique({
                    where: { id: indexId },
                    include: { center: { select: { meetingDay: true } } },
                });
                if (!loanIndex) return errorResponse('Loan index not found', 404);

                // Validate the first due date against the branch's EOD working
                // date, not the server wall-clock date — a branch may be
                // operating on a working day that lags real time, and the BM
                // must be able to set a first due date relative to that.
                const { workingDateYmd } = await getBranchWorkingDayWindow({
                    branchId: loanIndex.branchId,
                });
                if (firstDueDate < workingDateYmd) {
                    return errorResponse(
                        `First due date must be on or after the branch working date (${workingDateYmd})`,
                        400
                    );
                }

                // Admin-configurable cap on how far out the first due date may be
                // set — ADMIN is always exempt, mirroring the same check at BM
                // Final Disbursement (app/api/disbursements/bm-disburse/route.ts).
                const firstDueDateConfig = await getFirstDueDateConfig();
                if (firstDueDateConfig.enabled && user.role !== 'ADMIN') {
                    const [wy, wm, wd] = workingDateYmd.split('-').map(Number);
                    const DAY_MS = 24 * 60 * 60 * 1000;
                    const maxDueUTC = Date.UTC(wy, wm - 1, wd) + firstDueDateConfig.maxDays * DAY_MS;
                    const maxDueYmd = new Date(maxDueUTC).toISOString().split('T')[0];
                    if (firstDueDate > maxDueYmd) {
                        return errorResponse(
                            `First due date must be within ${firstDueDateConfig.maxDays} days of the branch working date (${workingDateYmd})`,
                            400
                        );
                    }
                }

                const loans = await prisma.loan.findMany({
                    where: { id: { in: selectedLoanIds }, indexId },
                    select: { id: true, loanNumber: true, frequency: true },
                });

                for (const loan of loans) {
                    const meetingValidation = validateMeetingDay(
                        getNextValidDate(firstDue),
                        loanIndex.center?.meetingDay,
                        loan.frequency || 'weekly'
                    );
                    if (!meetingValidation.valid) {
                        return errorResponse(
                            `For loan ${loan.loanNumber}: ${meetingValidation.message}`,
                            400
                        );
                    }
                }
            }

            // Atomic transaction: approve + submit for disbursement in one go
            await prisma.$transaction(async (tx) => {
                // Approved loans go directly to PENDING_LEVEL2 (ready for AM/HO)
                if (selectedLoanIds?.length > 0) {
                    await tx.loan.updateMany({
                        where: {
                            id: { in: selectedLoanIds },
                            indexId: indexId,
                        },
                        data: {
                            disbursementStatus: 'PENDING_LEVEL2',
                            disbursedLevel1ById: user.userId,
                            disbursedLevel1At: new Date(),
                            rejectionReason: null,
                            firstDueDate: firstDue,
                        },
                    });
                }

                await recordLoanHistory(tx, [
                    ...((selectedLoanIds as string[] | undefined) ?? []).map((loanId) => ({
                        loanId,
                        action: 'BM_SUBMITTED_TO_AM',
                        performedById: user.userId,
                        remarks: `Approved by BM and submitted for AM approval (first due date ${firstDueDate})`,
                        newState: 'PENDING_LEVEL2',
                    })),
                    ...((rejectedLoanIds as string[] | undefined) ?? []).map((loanId) => ({
                        loanId,
                        action: 'BM_REJECTED',
                        performedById: user.userId,
                        remarks: 'Rejected by BM during index approval',
                        newState: 'REJECTED',
                    })),
                ]);

                // Rejected loans
                if (rejectedLoanIds?.length > 0) {
                    await tx.loan.updateMany({
                        where: {
                            id: { in: rejectedLoanIds },
                            indexId: indexId,
                        },
                        data: {
                            disbursementStatus: 'REJECTED',
                            firstDueDate: null,
                        },
                    });
                }

                // Reset any loans in this index that were previously approved/rejected
                // but are no longer in the current selection lists
                const processedIds = [...(selectedLoanIds || []), ...(rejectedLoanIds || [])];

                await tx.loan.updateMany({
                    where: {
                        indexId: indexId,
                        id: { notIn: processedIds },
                        disbursementStatus: { in: ['PENDING_LEVEL2', 'APPROVED_LEVEL1', 'REJECTED'] }
                    },
                    data: {
                        disbursementStatus: 'PENDING_LEVEL1',
                        disbursedLevel1ById: null,
                        disbursedLevel1At: null,
                        rejectionReason: null,
                        firstDueDate: null,
                    },
                });
            });

            return successResponse(
                {
                    approved: selectedLoanIds?.length || 0,
                    rejected: rejectedLoanIds?.length || 0,
                },
                'Loans approved and submitted for disbursement successfully'
            );
        } catch (error) {
            console.error('Error processing index approval:', error);
            return errorResponse('Failed to process index approval', 500);
        }
    })(request);
}
