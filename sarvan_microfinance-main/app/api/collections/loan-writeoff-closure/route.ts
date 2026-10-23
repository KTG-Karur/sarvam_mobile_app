import { NextRequest } from 'next/server';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/db';
import { format } from 'date-fns';
import { computeOutstandingForForeclosure, finalizeClosureCoveredLoan } from '@/app/lib/foreclosure-workflow';
import { getBranchWorkingDayWindow, isInstantWithinWindow } from '@/app/lib/branch-working-day-guard';
import { excludePendingClosureAllocationWhere } from '@/app/lib/eod-closure-allocation';
import { bumpLoanBalance } from '@/app/lib/cache/loan-balance-cache';

export async function OPTIONS() {
    return handleCorsPreflight();
}

type DeathStatus = 'Normal' | 'Demand Required' | 'Demand Not Required';

function deriveDeathStatus(deathMarking: { demandRequired: boolean } | null): DeathStatus {
    if (!deathMarking) return 'Normal';
    return deathMarking.demandRequired ? 'Demand Required' : 'Demand Not Required';
}

/**
 * GET /api/collections/loan-writeoff-closure
 * Search for a member and return their active disbursed loans eligible for write-off / death closure.
 * Query params: searchType (memberId | phone | aadhaar), searchValue
 */
export async function GET(request: NextRequest) {
    return withRole(['ADMIN'], async (req) => {
        try {
            const { searchParams } = new URL(req.url);
            const searchType = searchParams.get('searchType') as 'memberId' | 'phone' | 'aadhaar' | null;
            const searchValue = searchParams.get('searchValue')?.trim() ?? '';

            if (!searchType || !['memberId', 'phone', 'aadhaar'].includes(searchType)) {
                return errorResponse('searchType must be one of: memberId, phone, aadhaar', 400);
            }
            if (!searchValue) return errorResponse('searchValue is required', 400);

            // Build client search condition
            let clientWhere: Prisma.ClientWhereInput;
            if (searchType === 'memberId') {
                clientWhere = { clientId: { contains: searchValue, mode: 'insensitive' } };
            } else if (searchType === 'phone') {
                clientWhere = {
                    OR: [
                        { mobileNumber: { contains: searchValue, mode: 'insensitive' } },
                        { phone: { contains: searchValue, mode: 'insensitive' } },
                    ],
                };
            } else {
                const normalized = searchValue.replace(/\D/g, '');
                clientWhere = { otherIdNo: { contains: normalized, mode: 'insensitive' } };
            }

            const client = await prisma.client.findFirst({
                where: clientWhere,
                select: {
                    id: true,
                    clientId: true,
                    firstName: true,
                    lastName: true,
                    mobileNumber: true,
                },
            });

            if (!client) {
                return successResponse(null, 'No member found matching the search criteria');
            }

            // Fetch active disbursed loans not yet closed
            // Death-marked loans are included here because death marking does NOT change
            // isActive / disbursementStatus / closureReason on the Loan model.
            const loans = await prisma.loan.findMany({
                where: {
                    clientId: client.id,
                    isActive: true,
                    disbursementStatus: 'DISBURSED',
                    closureReason: null,
                    ...excludePendingClosureAllocationWhere(),
                },
                include: {
                    schedules: {
                        orderBy: { dueDate: 'asc' },
                        select: {
                            id: true,
                            installmentNo: true,
                            dueDate: true,
                            status: true,
                            principalDue: true,
                            interestDue: true,
                            principalPaid: true,
                            interestPaid: true,
                            penaltiesDue: true,
                            penaltiesPaid: true,
                        },
                    },
                    deathMarking: {
                        where: { isReversed: false },
                        select: { demandRequired: true },
                    },
                },
            });

            const loanRows = loans.map((loan) => {
                const loanAmount = Number(loan.amount);
                const principalPaid = Number(loan.principalPaid ?? 0);
                const interestPaid = Number(loan.interestPaid ?? 0);

                const scheduleInputs = loan.schedules.map((s) => ({
                    status: String(s.status),
                    principalDue: Number(s.principalDue),
                    principalPaid: Number(s.principalPaid ?? 0),
                    interestDue: Number(s.interestDue),
                    interestPaid: Number(s.interestPaid ?? 0),
                    penaltiesDue: Number(s.penaltiesDue ?? 0),
                    penaltiesPaid: Number(s.penaltiesPaid ?? 0),
                    dueDate: new Date(s.dueDate),
                }));

                const computed = computeOutstandingForForeclosure({
                    loanAmount,
                    principalPaid,
                    schedules: scheduleInputs,
                });

                const totalScheduledInterest = loan.schedules.reduce(
                    (sum, s) => sum + Number(s.interestDue ?? 0),
                    0
                );

                return {
                    loanId: loan.id,
                    loanNumber: loan.loanNumber,
                    clientId: client.id,
                    clientCode: client.clientId,
                    memberName: `${client.firstName} ${client.lastName}`,
                    memberPhone: client.mobileNumber ?? null,

                    loanPrincipal: loanAmount,
                    loanInterest: totalScheduledInterest,
                    loanTotal: loanAmount + totalScheduledInterest,

                    outstandingPrincipal: computed.osPrincipal,
                    outstandingInterest: computed.osInterest,
                    outstandingTotal: computed.osPrincipal + computed.osInterest,

                    arrearPrincipal: computed.arrearPrincipal,
                    arrearInterest: computed.arrearInterest,
                    arrearTotal: computed.arrearPrincipal + computed.arrearInterest,

                    principalPaid,
                    interestPaid,

                    deathStatus: deriveDeathStatus(loan.deathMarking[0] ?? null),
                };
            });

            // Default the Close Date field to this client's branch's current EOD/working
            // date (not the browser's system date) — the branch it's derived from is the
            // first eligible loan's, since a client's loans are all scoped to one branch.
            // POST validates closeDate against this exact same window per-loan (see
            // getBranchWorkingDayWindow below) — best-effort here (null on failure, e.g. no
            // BranchLock row yet) so a lookup issue never blocks the search itself.
            let workingDate: string | null = null;
            if (loans.length > 0) {
                try {
                    const window = await getBranchWorkingDayWindow({ branchId: loans[0].branchId });
                    workingDate = window.workingDateYmd;
                } catch {
                    workingDate = null;
                }
            }

            return successResponse(
                {
                    client: { id: client.id, clientId: client.clientId, firstName: client.firstName, lastName: client.lastName, mobileNumber: client.mobileNumber },
                    loans: loanRows,
                    workingDate,
                },
                loanRows.length === 0 ? 'Member found but has no active loans eligible for closure' : 'Loans fetched'
            );
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Failed to fetch loans';
            return errorResponse(message, 500);
        }
    })(request);
}

const closureItemSchema = z
    .object({
        loanId: z.string().min(1),
        clientId: z.string().min(1),
        closeDate: z.string().min(1),
        paidPrincipal: z.number().min(0),
        paidInterest: z.number().min(0),
        principalWaiver: z.number().min(0),
        interestWaiver: z.number().min(0),
        penaltyAmount: z.number().min(0).default(0),
        penaltyPaid: z.number().min(0).default(0),
        reason: z.enum(['DEAD', 'WRITEOFF', 'OTHERS']),
        remarks: z.string().optional(),
        approvalDocumentUrl: z.string().min(1).optional(),
        approvalDocumentKey: z.string().optional(),
        approvalDocumentName: z.string().optional(),
    })
    .superRefine((data, ctx) => {
        if ((data.principalWaiver > 0 || data.interestWaiver > 0) && !data.approvalDocumentUrl) {
            ctx.addIssue({
                code: 'custom',
                message: 'HO Approval Document is required when waiver amount is greater than zero',
                path: ['approvalDocumentUrl'],
            });
        }
    });

const closureRequestSchema = z.array(closureItemSchema).min(1, 'At least one closure entry is required');

/**
 * POST /api/collections/loan-writeoff-closure
 * Submit write-off / death closure for one or more loans.
 * Body: array of closure entries.
 */
export async function POST(request: NextRequest) {
    return withRole(['ADMIN'], async (req, user) => {
        try {
            const body = await req.json();
            const entries = closureRequestSchema.parse(body);

            const now = new Date();
            const dateStr = format(now, 'yyyyMMdd');
            const timeStr = format(now, 'HHmmss');

            const results: { loanId: string; loanNumber: string; status: string }[] = [];

            await prisma.$transaction(
                async (tx) => {
                    for (let i = 0; i < entries.length; i++) {
                        const entry = entries[i];
                        const closeDate = new Date(entry.closeDate);

                        // Verify loan is still eligible
                        const loan = await tx.loan.findFirst({
                            where: {
                                id: entry.loanId,
                                clientId: entry.clientId,
                                isActive: true,
                                disbursementStatus: 'DISBURSED',
                                closureReason: null,
                                ...excludePendingClosureAllocationWhere(),
                            },
                            select: {
                                id: true,
                                loanNumber: true,
                                branchId: true,
                                centerId: true,
                            },
                        });

                        if (!loan) {
                            throw new Error(`Loan ${entry.loanId} is not eligible for closure (already closed or not disbursed)`);
                        }

                        // closeDate determines which day's "Allocate for EOD" bucket this
                        // closure's GL voucher lands in — validate it against the branch's
                        // working day.
                        const workingDay = await getBranchWorkingDayWindow({ branchId: loan.branchId });
                        if (!isInstantWithinWindow(closeDate, workingDay)) {
                            throw new Error(
                                `Close date must be within the branch working day (${workingDay.workingDateYmd}) for loan ${entry.loanId}`
                            );
                        }

                        // 1. Create closure record
                        await tx.loanClosureRecord.create({
                            data: {
                                loanId: entry.loanId,
                                clientId: entry.clientId,
                                closeDate,
                                paidPrincipal: entry.paidPrincipal,
                                paidInterest: entry.paidInterest,
                                principalWaiver: entry.principalWaiver,
                                interestWaiver: entry.interestWaiver,
                                penaltyAmount: entry.penaltyAmount,
                                penaltyPaid: entry.penaltyPaid,
                                reason: entry.reason,
                                remarks: entry.remarks ?? null,
                                approvalDocumentUrl: entry.approvalDocumentUrl ?? null,
                                approvalDocumentKey: entry.approvalDocumentKey ?? null,
                                approvalDocumentName: entry.approvalDocumentName ?? null,
                                closedById: user.userId,
                            },
                        });

                        // 2. Create WRITEOFF LoanTransaction for audit trail
                        const transactionId = `WO-${dateStr}-${timeStr}-${i + 1}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
                        const totalAmount = entry.paidPrincipal + entry.paidInterest + entry.penaltyPaid;

                        const createdTxn = await tx.loanTransaction.create({
                            data: {
                                transactionId,
                                loanId: entry.loanId,
                                clientId: entry.clientId,
                                branchId: loan.branchId,
                                centerId: loan.centerId ?? undefined,
                                amount: totalAmount,
                                type: 'WRITEOFF',
                                paymentMode: 'ADJUSTMENT',
                                collectedById: user.userId,
                                approvedById: user.userId,
                                approvedAt: now,
                                transactionDate: closeDate,
                                status: 'APPROVED',
                                principalAmount: entry.paidPrincipal,
                                interestAmount: entry.paidInterest,
                                penaltyAmount: entry.penaltyPaid,
                                description: `Write-Off/Death Closure — ${entry.reason}${entry.remarks ? ': ' + entry.remarks : ''}`,
                                collectionType: 'Write-Off Closure',
                            },
                        });

                        // Loan finalization (disbursementStatus:'CLOSED', isActive:false,
                        // closureReason, closedDate, schedules → CLOSED) happens right here, at
                        // creation time — matching REPAYMENT's approval-immediately-updates-the-
                        // loan pattern (app/api/collections/approve/route.ts). "Allocate for EOD"
                        // only posts the GL voucher afterward (postEodClosureAllocation /
                        // postEodFunderAllocation), it no longer touches the loan.
                        await finalizeClosureCoveredLoan(tx, 'WRITEOFF', createdTxn.id, entry.loanId, closeDate);

                        results.push({ loanId: loan.id, loanNumber: loan.loanNumber, status: 'CLOSED' });
                    }
                },
                { timeout: 30_000 }
            );

            await bumpLoanBalance(results.map((r) => r.loanId));

            return successResponse(results, `${results.length} loan(s) closed — GL voucher will post via Allocate for EOD`);
        } catch (error: unknown) {
            if (error instanceof z.ZodError) {
                return errorResponse(error.errors[0].message, 400);
            }
            const message = error instanceof Error ? error.message : 'Failed to process closures';
            return errorResponse(message, 500);
        }
    })(request);
}
