import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';
import type { JWTPayload } from '@/app/lib/auth';
import { transactionDateIsBeforeDueDate } from '@/app/lib/loan-transaction-lines';
import { isAmAssignedToBranch } from '@/app/lib/am-branch-utils';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';

function parseDateOnlyUtc(dateParam: string): Date | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateParam);
    if (!m) return null;

    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    const date = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));

    if (
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day
    ) {
        return null;
    }

    return date;
}

function safeNum(v: unknown): number {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : 0;
}

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/reports/daily-monitoring/advance-collection
 * Fetch Advance Collection Report Data based on transaction date vs due date.
 */
async function handler(req: NextRequest, user: JWTPayload) {
    try {
        const { searchParams } = new URL(req.url);
        const fromDateParam = searchParams.get('fromDate');
        const tillDateParam = searchParams.get('tillDate');
        const branchIdParam = searchParams.get('branchId');
        const centerIdParam = searchParams.get('centerId');

        if (!fromDateParam || !tillDateParam) {
            return errorResponse('fromDate and tillDate are required', 400);
        }

        const fromDate = parseDateOnlyUtc(fromDateParam);
        const tillDateStart = parseDateOnlyUtc(tillDateParam);
        if (!fromDate || !tillDateStart) {
            return errorResponse('Invalid date format', 400);
        }

        const tillDate = new Date(tillDateStart);
        tillDate.setUTCHours(23, 59, 59, 999);

        if (fromDate > tillDate) {
            return errorResponse('fromDate cannot be later than tillDate', 400);
        }

        let scopedBranchId: string | null = null;
        if (user.role === 'BRANCH_MANAGER') {
            // Any branch the BM is assigned to (UserBranchAssignment), not just
            // their primary/active branch.
            const permittedBranchIds = await getPermittedBranchIds(user);
            if (permittedBranchIds === null || permittedBranchIds.length === 0) {
                return errorResponse('Branch context missing for branch manager', 403);
            }
            if (branchIdParam && !permittedBranchIds.includes(branchIdParam)) {
                return errorResponse('Insufficient permissions for selected branch', 403);
            }
            scopedBranchId = branchIdParam || user.branchId || permittedBranchIds[0];
        } else if (user.role === 'AREA_MANAGER') {
            const requested = branchIdParam || user.branchId || null;
            if (!requested) {
                return errorResponse('Branch context is required for this report', 400);
            }
            const assigned = await isAmAssignedToBranch(user.userId, requested);
            if (!assigned) {
                return errorResponse('Insufficient permissions for selected branch', 403);
            }
            scopedBranchId = requested;
        } else {
            scopedBranchId = branchIdParam || user.branchId || null;
            if (!scopedBranchId) {
                return errorResponse('Branch context is required for this report', 400);
            }
        }

        // 1. Fetch all REPAYMENT transactions in the given period
        // where it applied to loan in our scoped branch
        const txns = await prisma.loanTransaction.findMany({
            where: {
                transactionDate: {
                    gte: fromDate,
                    lte: tillDate
                },
                type: 'REPAYMENT',
                isReversed: false,
                amount: { gt: 0 },
                loan: {
                    branchId: scopedBranchId,
                    ...(centerIdParam ? { centerId: centerIdParam } : {}),
                    isActive: true
                }
            },
            include: {
                lines: {
                    include: {
                        schedule: true
                    }
                },
                loan: {
                    include: {
                        branch: true,
                        center: { include: { fdo: true } },
                        client: true
                    }
                }
            }
        });

        // 2. Identify which of these are strictly advance collections
        // An advance collection is when the transaction day < schedule due day.
        
        type Txn = (typeof txns)[number];
        type AdvanceEntry = {
            loan: Txn['loan'];
            schedule: Txn['lines'][number]['schedule'];
            approvedCollAmount: number;
            latestApprovedPaidDate: Date | null;
        };
        const advanceLines = new Map<string, AdvanceEntry>();

        for (const t of txns) {
            const rawTxnDate = new Date(t.transactionDate.getTime());
            // Strip time for strict day comparison
            const txnDay = new Date(Date.UTC(rawTxnDate.getUTCFullYear(), rawTxnDate.getUTCMonth(), rawTxnDate.getUTCDate()));

            for (const line of t.lines) {
                const dueDay = new Date(line.schedule.dueDate.getTime());

                if (transactionDateIsBeforeDueDate(txnDay, dueDay)) {
                    let entry = advanceLines.get(line.scheduleId);
                    if (!entry) {
                        entry = {
                            loan: t.loan,
                            schedule: line.schedule,
                            approvedCollAmount: 0,
                            latestApprovedPaidDate: null,
                        };
                        advanceLines.set(line.scheduleId, entry);
                    }

                    // BM report must be based only on realized (APPROVED) collections.
                    if (t.status === 'APPROVED') {
                        entry.approvedCollAmount += Number(line.lineTotal);
                        if (!entry.latestApprovedPaidDate || t.transactionDate > entry.latestApprovedPaidDate) {
                            entry.latestApprovedPaidDate = t.transactionDate;
                        }
                    }
                }
            }
        }

        // Legacy fallback for old immediately-posted collections that completed a schedule
        // before due date but never wrote transaction lines. This is intentionally narrow:
        // we infer only from schedule.paidAt when the installment was fully paid early.
        const legacySchedules = await prisma.loanSchedule.findMany({
            where: {
                paidAt: {
                    gte: fromDate,
                    lte: tillDate,
                },
                loan: {
                    branchId: scopedBranchId,
                    ...(centerIdParam ? { centerId: centerIdParam } : {}),
                    isActive: true,
                },
            },
            include: {
                loan: {
                    include: {
                        branch: true,
                        center: { include: { fdo: true } },
                        client: true,
                    },
                },
            },
        });

        for (const schedule of legacySchedules) {
            if (advanceLines.has(schedule.id) || !schedule.paidAt) {
                continue;
            }

            if (!transactionDateIsBeforeDueDate(schedule.paidAt, schedule.dueDate)) {
                continue;
            }

            const dueAmount = safeNum(schedule.totalDue);
            const realizedAmount = safeNum(schedule.totalPaid);
            if (realizedAmount <= 0) {
                continue;
            }

            advanceLines.set(schedule.id, {
                loan: schedule.loan,
                schedule,
                approvedCollAmount: realizedAmount,
                latestApprovedPaidDate: schedule.paidAt,
            });
        }

        if (advanceLines.size === 0) {
            return successResponse([], 'No advance collections found for this period');
        }

        // 3. To calculate arrears, we need all prior schedules for the loans involved
        const uniqueLoanIds = [...new Set(Array.from(advanceLines.values()).map(e => e.loan.id))];

        const allSchedulesAgg = await prisma.loanSchedule.groupBy({
            by: ['loanId'],
            where: {
                loanId: { in: uniqueLoanIds },
                dueDate: { lt: new Date() }, // Currently overdue
                status: { not: 'PAID' } // not fully paid
            },
            _sum: {
                totalDue: true,
                totalPaid: true
            }
        });

        const currentArrearByLoan = new Map<string, number>();
        for (const row of allSchedulesAgg) {
            const due = safeNum(row._sum.totalDue);
            const paid = safeNum(row._sum.totalPaid);
            currentArrearByLoan.set(row.loanId, Math.max(0, due - paid));
        }

        // 4. Formatting output
        const formattedRows = [];
        for (const [scheduleId, entry] of advanceLines.entries()) {
            const { loan, schedule, approvedCollAmount, latestApprovedPaidDate } = entry;
            
            // Due Amount is simply the total due for that exact schedule
            const dueAmount = safeNum(schedule.totalDue);
            
            // Approved-only residual for production-safe BM numbers.
            const toBeCollected = Math.max(0, dueAmount - approvedCollAmount);

            const arrear = currentArrearByLoan.get(loan.id) || 0;
            const loanOs = Math.max(0, safeNum(loan.amount) - safeNum(loan.principalPaid));

            formattedRows.push({
                id: scheduleId,
                branchName: `${loan.branch.code} - ${loan.branch.name}`,
                centerName: `${loan.center.code} - ${loan.center.name}`,
                memberName: `${loan.client.firstName} ${loan.client.lastName}`.trim(),
                loanId: loan.loanNumber,
                dueAmount,
                collAmount: approvedCollAmount,
                toBeCollected,
                dueDate: schedule.dueDate.toISOString().split('T')[0],
                paidDate: latestApprovedPaidDate ? latestApprovedPaidDate.toISOString().split('T')[0] : '-',
                status: schedule.status,
                arrear,
                loanOs,
                meetingDay: loan.center.meetingDay || '-',
                nextMeetingDate: loan.center.nextMeetingDate ? loan.center.nextMeetingDate.toISOString().split('T')[0] : '-',
                fieldOfficer: loan.center.fdo ? `${loan.center.fdo.firstName} ${loan.center.fdo.lastName}` : 'Unassigned',
            });
        }

        // Sort by branch -> center -> dueDate
        formattedRows.sort((a, b) => {
            if (a.branchName !== b.branchName) return a.branchName.localeCompare(b.branchName);
            if (a.centerName !== b.centerName) return a.centerName.localeCompare(b.centerName);
            return a.dueDate.localeCompare(b.dueDate);
        });

        return successResponse(formattedRows, 'Advance collection data fetched successfully');
    } catch (error) {
        console.error('[Advance-Collection] Error:', error);
        return errorResponse('Failed to fetch advance collection report', 500);
    }
}

export const GET = withRole(['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER'], handler);
