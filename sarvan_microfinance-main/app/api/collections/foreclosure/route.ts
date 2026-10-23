import { NextRequest } from 'next/server';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/db';
import { format } from 'date-fns';
import { assertBranchNotLocked } from '@/app/lib/branch-lock';
import { getBranchWorkingDayWindow } from '@/app/lib/branch-working-day-guard';
import { excludePendingClosureAllocationWhere } from '@/app/lib/eod-closure-allocation';
import { resolveLoanFrequencyForDisplay } from '@/app/lib/loan-frequency';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';
import { z } from 'zod';
import {
    computeOutstandingForForeclosure,
    FORECLOSURE_MONEY_TOLERANCE,
} from '@/app/lib/foreclosure-workflow';

const submitForeclosureSchema = z.object({
    clientId: z.string().min(1),
    loanId: z.string().min(1),
    paymentMode: z.enum(['CASH', 'BANK_TRANSFER', 'CHEQUE', 'UPI', 'ADJUSTMENT']).default('CASH'),
    amountCollected: z.number().positive(),
    collectionDate: z.string().optional(),
    remarks: z.string().trim().optional(),
});


/**
 * A preclosure is always booked on the branch's EOD working date — for every role,
 * Admin included. A client-supplied date is only accepted if it equals that working
 * date (a stale/fallback browser date must never leak into transactionDate, since
 * revert eligibility, closedDate and the Allocate-for-EOD bucket all key off it).
 */
async function resolveEodTransactionDate(
    branchId: string,
    requestedDate?: string
): Promise<{ transactionDate: Date } | { error: string }> {
    const workingDay = await getBranchWorkingDayWindow({ branchId });
    if (requestedDate && requestedDate.slice(0, 10) !== workingDay.workingDateYmd) {
        return {
            error: `Preclosure date must be the branch working day (${workingDay.workingDateYmd})`,
        };
    }
    return { transactionDate: new Date(`${workingDay.workingDateYmd}T00:00:00.000Z`) };
}

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/collections/foreclosure
 * Fetch client loan details for foreclosure (full settlement)
 * Query params: clientId
 */
export async function GET(request: NextRequest) {
    return withRole(['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN'], async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const clientId = searchParams.get('clientId');
            const loanId = searchParams.get('loanId'); // Optional: specific loan to foreclose

            if (!clientId) {
                return errorResponse('Client ID is required', 400);
            }

            // Backward-compatible lookup: accept DB id OR business clientId code.
            // findFirst, not findUnique — clientId isn't DB-unique (uploan-imported
            // legacy IDs can intentionally collide) — deterministic oldest-created
            // tiebreak, matching every other clientId lookup in the app.
            const client = await prisma.client.findFirst({
                where: {
                    OR: [{ id: clientId }, { clientId }],
                    isActive: true,
                },
                orderBy: { createdAt: 'asc' },
                include: {
                    center: {
                        select: {
                            id: true,
                            name: true,
                            code: true,
                            branchId: true,
                        }
                    },
                    loanApplications: {
                        where: {
                            isActive: true,
                            disbursementStatus: 'DISBURSED',
                            ...(loanId ? { id: loanId } : {}), // Filter by loanId if provided
                            ...excludePendingClosureAllocationWhere(),
                        },
                        include: {
                            loanProduct: {
                                select: {
                                    productName: true,
                                    frequency: true,
                                }
                            },
                            schedules: {
                                // Fetch ALL schedules to get correct counts
                                orderBy: {
                                    dueDate: 'asc'
                                }
                            }
                        }
                    }
                }
            });

            if (!client || !(client as any).center) {
                return errorResponse('Client not found', 404);
            }

            // Any non-unrestricted caller (BM, AM, or any other role reaching this
            // route) must only access clients within one of their assigned branches —
            // role-agnostic so a custom RBAC role is scoped exactly like BM/AM.
            const permittedBranchIds = await getPermittedBranchIds(user);
            if (permittedBranchIds !== null && !permittedBranchIds.includes((client as any).center.branchId)) {
                return errorResponse('Client does not belong to one of your assigned branches', 403);
            }

            // Get the specified loan or the most recent active loan
            const activeLoan = (client as any).loanApplications[0];

            if (!activeLoan) {
                return errorResponse(loanId ? 'Specified loan not found' : 'No active loan found for this client', 404);
            }

            const loanAmount = Number(activeLoan.amount);
            const principalPaid = Number(activeLoan.principalPaid || 0);
            const scheduleInputs = activeLoan.schedules.map((schedule: any) => ({
                status: String(schedule.status),
                principalDue: Number(schedule.principalDue),
                principalPaid: Number(schedule.principalPaid || 0),
                interestDue: Number(schedule.interestDue),
                interestPaid: Number(schedule.interestPaid || 0),
                penaltiesDue: Number(schedule.penaltiesDue || 0),
                penaltiesPaid: Number(schedule.penaltiesPaid || 0),
                dueDate: new Date(schedule.dueDate),
            }));

            const computed = computeOutstandingForForeclosure({
                loanAmount,
                principalPaid,
                schedules: scheduleInputs,
            });

            // Get disbursement date — disbursedByBMAt is the actual final disbursement
            // date (set in bm-disburse); disbursedLevel1At is an earlier approval-stage
            // timestamp and can be null even for fully disbursed loans, so fall back to it
            // only if the BM disbursement date is somehow missing.
            const disbursementDateRaw = activeLoan.disbursedByBMAt || activeLoan.disbursedLevel1At;
            const disbursementDate = disbursementDateRaw
                ? format(disbursementDateRaw, 'yyyy-MM-dd')
                : null;

            // Calculate EMI (from first schedule if available)
            const firstSchedule = activeLoan.schedules[0];
            const emiAmount = firstSchedule
                ? Number(firstSchedule.principalDue) + Number(firstSchedule.interestDue)
                : 0;

            // Get tenure and frequency from loan
            const tenureMonths = activeLoan.tenureMonths || 0;
            const frequency = resolveLoanFrequencyForDisplay(
                activeLoan.frequency,
                activeLoan.loanProduct?.frequency
            );

            // Get funder information (from loanProduct relation if available)
            const funderName = activeLoan.loanProduct?.productName || 'N/A';

            const responseData = {
                clientId: client.id,
                clientName: `${client.firstName} ${client.lastName}`,
                clientCode: client.clientId,
                centerId: (client as any).center.id,
                centerName: (client as any).center.name,
                centerCode: (client as any).center.code,
                phone: client.phone || null,

                // Loan details
                loanId: activeLoan.id,
                loanNumber: activeLoan.loanNumber,
                loanAmount: Number(loanAmount.toFixed(2)),
                funderName,
                tenureMonths,
                frequency,
                interestRate: Number(activeLoan.interestRate),
                emiAmount: Number(emiAmount.toFixed(2)),

                // Financial details for foreclosure
                osPrincipal: Number(computed.osPrincipal.toFixed(2)),
                osInterest: Number(computed.osInterest.toFixed(2)),
                arrearPrincipal: Number(computed.arrearPrincipal.toFixed(2)),
                arrearInterest: Number(computed.arrearInterest.toFixed(2)),
                totalPenalties: Number(computed.osPenalties.toFixed(2)),

                // Total foreclosure amount (what needs to be collected)
                totalForeclosureAmount: Number(computed.totalOutstanding.toFixed(2)),

                // To be collected amounts (pre-filled for foreclosure)
                toBeCollPrincipal: Number(computed.osPrincipal.toFixed(2)),
                toBeCollInterest: Number(computed.osInterest.toFixed(2)),
                toBeCollTotal: Number(computed.totalOutstanding.toFixed(2)),

                // Schedule info
                dueWeeks: computed.dueWeeks,
                collectedWeeks: computed.collectedWeeks,
                pendingWeeks: computed.pendingWeeks,

                // Other details
                disbursementDate,
                productName: activeLoan.loanProduct?.productName || 'N/A',
            };

            const response = successResponse(
                responseData,
                'Loan preclosure details fetched successfully'
            );

            // Add no-cache headers to ensure fresh data
            response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
            response.headers.set('Pragma', 'no-cache');
            response.headers.set('Expires', '0');

            return response;

        } catch (error) {
            return errorResponse('Failed to fetch loan details', 500);
        }
    })(request);
}

/**
 * POST /api/collections/foreclosure
 * Submit foreclosure (full loan settlement)
 */
export async function POST(request: NextRequest) {
    return withRole(['BRANCH_MANAGER', 'ADMIN'], async (req, user) => {
        try {
            const foreclosureDelegate = (prisma as unknown as { foreclosureRequest?: unknown })
                .foreclosureRequest as
                | {
                      findFirst: typeof prisma.foreclosureRequest.findFirst;
                      create: typeof prisma.foreclosureRequest.create;
                  }
                | undefined;

            if (!foreclosureDelegate) {
                // Backward-compatible fallback: if the maker–checker model is not available
                // (e.g., migrations not deployed / Prisma client not regenerated),
                // run the legacy immediate foreclosure path so BM is not blocked.
                const body = (await req.json().catch(() => ({}))) as unknown;
                const parsed = submitForeclosureSchema.safeParse(body);
                if (!parsed.success) {
                    return errorResponse(parsed.error.issues.map((i) => i.message).join(', '), 400);
                }

                const { clientId, loanId, paymentMode, amountCollected, collectionDate, remarks } = parsed.data;
                const safeRemarks = remarks?.trim() ? remarks.trim() : null;

                const loan = await prisma.loan.findFirst({
                    where: {
                        id: loanId,
                        clientId,
                        isActive: true,
                        disbursementStatus: 'DISBURSED',
                        ...excludePendingClosureAllocationWhere(),
                    },
                    include: {
                        center: { select: { id: true } },
                        schedules: {
                            where: { status: { not: 'PAID' } },
                            orderBy: { dueDate: 'asc' },
                        },
                    },
                });

                if (!loan) {
                    return errorResponse('Loan not found or not active', 404);
                }

                const lockResponse = await assertBranchNotLocked(loan.branchId);
                if (lockResponse) return lockResponse;

                const eod = await resolveEodTransactionDate(loan.branchId, collectionDate);
                if ('error' in eod) return errorResponse(eod.error, 409);
                const transactionDate = eod.transactionDate;

                const loanAmount = Number(loan.amount);
                const principalPaid = Number(loan.principalPaid || 0);
                const scheduleInputs = loan.schedules.map((schedule) => ({
                    status: String(schedule.status),
                    principalDue: Number(schedule.principalDue),
                    principalPaid: Number(schedule.principalPaid || 0),
                    interestDue: Number(schedule.interestDue),
                    interestPaid: Number(schedule.interestPaid || 0),
                    penaltiesDue: Number(schedule.penaltiesDue || 0),
                    penaltiesPaid: Number(schedule.penaltiesPaid || 0),
                    dueDate: new Date(schedule.dueDate),
                }));

                // A still-pending (unapproved) repayment on this loan hasn't hit
                // principalPaid/interestPaid yet, so it's still inside the payoff
                // computed below. Approving it *and* this preclosure would collect
                // the same dues twice — require it to be resolved first.
                const pendingRepayment = await prisma.loanTransaction.findFirst({
                    where: { loanId: loan.id, type: 'REPAYMENT', status: 'PENDING', isReversed: false },
                    select: { id: true },
                });
                if (pendingRepayment) {
                    return errorResponse(
                        'This loan has a collection awaiting approval. Approve or reject it before preclosing so the payoff amount is accurate.',
                        409
                    );
                }

                const computed = computeOutstandingForForeclosure({
                    loanAmount,
                    principalPaid,
                    schedules: scheduleInputs,
                });

                if (Math.abs(amountCollected - computed.totalOutstanding) > FORECLOSURE_MONEY_TOLERANCE) {
                    return errorResponse(
                        `Preclosure amount (₹${amountCollected}) must equal total outstanding (₹${computed.totalOutstanding.toFixed(2)})`,
                        400
                    );
                }

                const result = await prisma.$transaction(
                    async (tx) => {
                        for (const schedule of loan.schedules) {
                            await tx.loanSchedule.update({
                                where: { id: schedule.id },
                                data: {
                                    penaltiesPaid: schedule.penaltiesDue,
                                    interestPaid: schedule.interestDue,
                                    principalPaid: schedule.principalDue,
                                    totalPaid: schedule.totalDue,
                                    status: 'PAID',
                                    paidAt: new Date(),
                                },
                            });
                        }

                        const now = new Date();
                        const dateStr = format(now, 'yyyyMMdd');
                        const timeStr = format(now, 'HHmmss');
                        const randomSuffix = Math.random().toString(36).slice(2, 6).toUpperCase();
                        const transactionCode = `FCL-${dateStr}-${timeStr}-${randomSuffix}`;

                        const transaction = await tx.loanTransaction.create({
                            data: {
                                transactionId: transactionCode,
                                loanId,
                                branchId: loan.branchId,
                                clientId,
                                centerId: loan.center.id,
                                amount: Number(amountCollected),
                                type: 'PRECLOSURE',
                                paymentMode,
                                transactionDate,
                                collectedById: user.userId,
                                remarks: safeRemarks || 'Loan preclosure - Full settlement',
                                principalAmount: computed.principalPayment,
                                interestAmount: computed.interestPayment,
                                feesAmount: 0,
                                penaltyAmount: computed.penaltyPayment,
                                status: 'APPROVED',
                                approvedById: user.userId,
                                approvedAt: now,
                            },
                            select: { transactionId: true },
                        });

                        await tx.loan.update({
                            where: { id: loanId },
                            data: {
                                principalPaid: loan.amount,
                                interestPaid: { increment: computed.interestPayment },
                                penaltiesPaid: { increment: computed.penaltyPayment },
                                lastPaymentDate: now,
                                closedDate: now,
                                disbursementStatus: 'DISBURSED',
                                isActive: false,
                            },
                        });

                        return transaction;
                    },
                    { timeout: 15000, maxWait: 15000 }
                );

                return successResponse(
                    {
                        transactionId: result.transactionId,
                        amount: Number(amountCollected),
                        principalPayment: Number(computed.principalPayment.toFixed(2)),
                        interestPayment: Number(computed.interestPayment.toFixed(2)),
                        penaltyPayment: Number(computed.penaltyPayment.toFixed(2)),
                        loanStatus: 'FORECLOSED',
                    },
                    `Loan foreclosed successfully with payment of ₹${amountCollected}`
                );
            }

            const body = (await req.json().catch(() => ({}))) as unknown;
            const parsed = submitForeclosureSchema.safeParse(body);
            if (!parsed.success) {
                return errorResponse(parsed.error.issues.map((i) => i.message).join(', '), 400);
            }

            const { clientId, loanId, paymentMode, amountCollected, collectionDate, remarks } = parsed.data;
            const safeRemarks = remarks?.trim() ? remarks.trim() : null;

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
                            id: true,
                            firstName: true,
                            lastName: true,
                        }
                    },
                    center: {
                        select: {
                            id: true,
                        }
                    },
                    schedules: {
                        orderBy: {
                            dueDate: 'asc'
                        }
                    }
                }
            });

            if (!loan) {
                return errorResponse('Loan not found or not active', 404);
            }

            // ── Branch Lock Guard ──
            const lockResponse = await assertBranchNotLocked(loan.branchId);
            if (lockResponse) return lockResponse;

            const eod = await resolveEodTransactionDate(loan.branchId, collectionDate);
            if ('error' in eod) return errorResponse(eod.error, 409);
            const transactionDate = eod.transactionDate;

            const loanAmount = Number(loan.amount);
            const principalPaid = Number(loan.principalPaid || 0);
            const scheduleInputs = loan.schedules.map((schedule) => ({
                status: String(schedule.status),
                principalDue: Number(schedule.principalDue),
                principalPaid: Number(schedule.principalPaid || 0),
                interestDue: Number(schedule.interestDue),
                interestPaid: Number(schedule.interestPaid || 0),
                penaltiesDue: Number(schedule.penaltiesDue || 0),
                penaltiesPaid: Number(schedule.penaltiesPaid || 0),
                dueDate: new Date(schedule.dueDate),
            }));

            // A still-pending (unapproved) repayment on this loan hasn't hit
            // principalPaid/interestPaid yet, so it's still inside the payoff
            // computed below. Approving it *and* this preclosure would collect the
            // same dues twice — require it to be resolved first.
            const pendingRepayment = await prisma.loanTransaction.findFirst({
                where: { loanId: loan.id, type: 'REPAYMENT', status: 'PENDING', isReversed: false },
                select: { id: true },
            });
            if (pendingRepayment) {
                return errorResponse(
                    'This loan has a collection awaiting approval. Approve or reject it before preclosing so the payoff amount is accurate.',
                    409
                );
            }

            const computed = computeOutstandingForForeclosure({
                loanAmount,
                principalPaid,
                schedules: scheduleInputs,
            });

            // Validate that amount collected matches total outstanding
            if (Math.abs(amountCollected - computed.totalOutstanding) > FORECLOSURE_MONEY_TOLERANCE) {
                return errorResponse(
                    `Preclosure amount (₹${amountCollected}) must equal total outstanding (₹${computed.totalOutstanding.toFixed(2)})`,
                    400
                );
            }

            const existingRequest = await foreclosureDelegate.findFirst({
                where: {
                    loanId,
                    status: 'PENDING_APPROVAL',
                },
                select: {
                    id: true,
                    status: true,
                },
                orderBy: { createdAt: 'desc' },
            });
            if (existingRequest) {
                return successResponse(
                    {
                        foreclosureRequestId: existingRequest.id,
                        workflowStatus: existingRequest.status,
                    },
                    'Preclosure already submitted and pending approval'
                );
            }

            const result = await prisma.$transaction(
                async (tx) => {
                    const now = new Date();
                    const dateStr = format(now, 'yyyyMMdd');
                    const timeStr = format(now, 'HHmmss');
                    const randomSuffix = Math.random().toString(36).slice(2, 6).toUpperCase();
                    const transactionCode = `FCL-${dateStr}-${timeStr}-${randomSuffix}`;

                    const transaction = await tx.loanTransaction.create({
                        data: {
                            transactionId: transactionCode,
                            loanId,
                            branchId: loan.branchId,
                            clientId,
                            centerId: loan.center.id,
                            amount: Number(amountCollected),
                            type: 'PRECLOSURE',
                            paymentMode,
                            transactionDate,
                            collectedById: user.userId,
                            remarks: safeRemarks || 'Loan preclosure - Submitted for approval',
                            principalAmount: computed.principalPayment,
                            interestAmount: computed.interestPayment,
                            feesAmount: 0,
                            penaltyAmount: computed.penaltyPayment,
                            status: 'PENDING',
                        },
                        select: { id: true, transactionId: true },
                    });

                    const requestRecord = await tx.foreclosureRequest.create({
                        data: {
                            loanId,
                            clientId,
                            centerId: loan.center.id,
                            branchId: loan.branchId,
                            transactionId: transaction.id,
                            status: 'PENDING_APPROVAL',
                            amountCollected: Number(amountCollected),
                            principalAmount: computed.principalPayment,
                            interestAmount: computed.interestPayment,
                            penaltyAmount: computed.penaltyPayment,
                            feesAmount: 0,
                            remarks: safeRemarks,
                            initiatedById: user.userId,
                        },
                        select: { id: true, status: true },
                    });

                    return { transaction, requestRecord };
                },
                {
                    timeout: 15000,
                    maxWait: 15000,
                }
            );

            return successResponse(
                {
                    foreclosureRequestId: result.requestRecord.id,
                    transactionId: result.transaction.transactionId,
                    amount: Number(amountCollected),
                    principalPayment: Number(computed.principalPayment.toFixed(2)),
                    interestPayment: Number(computed.interestPayment.toFixed(2)),
                    penaltyPayment: Number(computed.penaltyPayment.toFixed(2)),
                    workflowStatus: result.requestRecord.status,
                },
                'Preclosure submitted for approval'
            );

        } catch (error: unknown) {
            return errorResponse(
                error instanceof Error ? error.message : 'Failed to process preclosure',
                500
            );
        }
    })(request);
}
