import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { withRole } from '@/app/lib/api-utils';
import { successResponse, errorResponse } from '@/app/lib/api-utils';
import type { JWTPayload } from '@/app/lib/auth';
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

function handleCorsPreflight() {
    return new Response(null, {
        status: 204,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
    });
}

/**
 * GET /api/reports/daily-monitoring/collection-followup
 * Fetch Collection Followup Data
 */
async function handler(req: NextRequest, user: JWTPayload) {
    try {
        const { searchParams } = new URL(req.url);
        const fromDateStr = searchParams.get('fromDate');
        const tillDateStr = searchParams.get('tillDate');
        const branchIdParam = searchParams.get('branchId');
        const centerIdParam = searchParams.get('centerId');

        if (!fromDateStr || !tillDateStr) {
            return errorResponse('Missing required date parameters', 400);
        }

        const fromDate = parseDateOnlyUtc(fromDateStr);
        const tillDateStart = parseDateOnlyUtc(tillDateStr);
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

        // Fetch all active loans with their schedules and transactions
        const loans = await prisma.loan.findMany({
            where: {
                disbursementStatus: 'DISBURSED',
                isActive: true,
                branchId: scopedBranchId,
                ...(centerIdParam ? { centerId: centerIdParam } : {}),
                OR: [
                    { schedules: { some: { dueDate: { gte: fromDate, lte: tillDate } } } },
                    { transactions: { some: { type: 'REPAYMENT', isReversed: false, amount: { gt: 0 }, transactionDate: { gte: fromDate, lte: tillDate } } } }
                ]
            },
            include: {
                branch: true,
                center: {
                    include: {
                        fdo: true,
                    }
                },
                client: true,
                schedules: {
                    orderBy: {
                        installmentNo: 'asc',
                    },
                },
                transactions: {
                    where: {
                        type: 'REPAYMENT',
                        isReversed: false,
                        amount: { gt: 0 },
                        transactionDate: { lte: tillDate }
                    },
                },
            },
        });

        if (loans.length === 0) {
            return successResponse([], 'Collection followup data retrieved successfully');
        }

        // Advance already paid for in-period installments: approved payments (LoanTransactionLine is the
        // source of truth) dated BEFORE the installment's due date. It reduces that installment's demand when
        // it falls due, and must not also be counted as paying off older arrears.
        const periodSchedules = loans.flatMap(l => l.schedules.filter(s => s.dueDate >= fromDate && s.dueDate <= tillDate));
        const periodDueById = new Map(periodSchedules.map(s => [s.id, s.dueDate]));
        const advanceLines = periodSchedules.length === 0 ? [] : await prisma.loanTransactionLine.findMany({
            where: {
                scheduleId: { in: [...periodDueById.keys()] },
                transaction: { status: 'APPROVED', isReversed: false, type: { in: ['REPAYMENT', 'PRECLOSURE'] } },
            },
            select: { scheduleId: true, principalAmount: true, interestAmount: true, transaction: { select: { transactionDate: true } } },
        });
        const advanceBySchedule = new Map<string, number>();
        const advanceBeforeFromBySchedule = new Map<string, number>();
        for (const ln of advanceLines) {
            const due = periodDueById.get(ln.scheduleId);
            if (!due || !(ln.transaction.transactionDate < due)) continue;
            const amt = safeNum(ln.principalAmount) + safeNum(ln.interestAmount);
            advanceBySchedule.set(ln.scheduleId, (advanceBySchedule.get(ln.scheduleId) ?? 0) + amt);
            if (ln.transaction.transactionDate < fromDate) {
                advanceBeforeFromBySchedule.set(ln.scheduleId, (advanceBeforeFromBySchedule.get(ln.scheduleId) ?? 0) + amt);
            }
        }
        const netDueOf = (s: { id: string; totalDue: unknown }) =>
            Math.max(0, safeNum(s.totalDue) - (advanceBySchedule.get(s.id) ?? 0));

        const results = loans.map(loan => {
            const schedules = loan.schedules;
            const transactions = loan.transactions;

            // OPPARR: As-of arrears before `fromDate`
            // Due before fromDate
            const dueBefore = schedules
                .filter(s => s.dueDate < fromDate)
                .reduce((sum, s) => sum + safeNum(s.totalDue), 0);

            // ONLY APPROVED transactions count towards reducing historical arrears
            const advanceBeforeFrom = schedules.reduce((sum, s) => sum + (advanceBeforeFromBySchedule.get(s.id) ?? 0), 0);
            const repaidBefore = Math.max(
                0,
                transactions
                    .filter(t => t.transactionDate < fromDate && t.status === 'APPROVED')
                    .reduce((sum, t) => sum + safeNum(t.amount), 0) - advanceBeforeFrom
            );

            const opArr = Math.max(0, dueBefore - repaidBefore);

            // DUEAMOUNT: Sum of totalDue for installments strictly between fromDate and tillDate
            const dueAmount = schedules
                .filter(s => s.dueDate >= fromDate && s.dueDate <= tillDate)
                .reduce((sum, s) => sum + netDueOf(s), 0);

            // Collections DURING the period [fromDate, tillDate]
            const periodTxns = transactions.filter(t => t.transactionDate >= fromDate && t.transactionDate <= tillDate);
            
            // Total submitted
            const collAmt = periodTxns.reduce((sum, t) => sum + safeNum(t.amount), 0);
            
            // Realized (Approved)
            const realizedCollAmt = periodTxns
                .filter(t => t.status === 'APPROVED')
                .reduce((sum, t) => sum + safeNum(t.amount), 0);
                
            // Pending (Waitng for BM)
            const pendingCollAmt = periodTxns
                .filter(t => t.status === 'PENDING')
                .reduce((sum, t) => sum + safeNum(t.amount), 0);

            // Separate today's demand from past demand so it's not mislabelled as "arrear"
            // tillDate is end-of-day; its start-of-day marks the boundary for "today"
            const startOfTillDate = new Date(tillDateStart); // tillDateStart is UTC midnight (parseDateOnlyUtc)
            const todayDemand = schedules
                .filter(s => s.dueDate >= startOfTillDate && s.dueDate <= tillDate)
                .reduce((sum, s) => sum + netDueOf(s), 0);
            const todayCollAmt = periodTxns
                .filter(t => t.transactionDate >= startOfTillDate)
                .reduce((sum, t) => sum + safeNum(t.amount), 0);
            // Today's PENDING = today's demand not yet collected (pending, NOT arrear yet)
            const todayPending = Math.max(0, todayDemand - todayCollAmt);

            // CLSARR: Closing arrear = opening arrear + past-period demand - collections
            // Excludes today's pending so it's not shown as "arrear"
            const pastPeriodDemand = dueAmount - todayDemand;
            const pastPeriodColl = Math.max(0, collAmt - todayCollAmt);
            const clsArr = Math.max(0, opArr + pastPeriodDemand - pastPeriodColl);

            // COMPDUE: Count of installments where dueDate <= end of YESTERDAY (exclude today's pending)
            const compDue = schedules.filter(s => s.dueDate < startOfTillDate).length;

            // COLLDUE: Count of fully paid installments up to (but not including) today
            const collDue = schedules.filter(s => s.dueDate < startOfTillDate && safeNum(s.totalPaid) >= safeNum(s.totalDue)).length;

            const totalDue = schedules.length;

            const maturityDate = schedules.length > 0
                ? schedules[schedules.length - 1].dueDate.toISOString()
                : 'N/A';

            return {
                id: loan.id,
                branchName: loan.branch.name,
                centerName: `${loan.center.code} - ${loan.center.name}`,
                loanAccountId: loan.loanNumber,
                memberName: `${loan.client.firstName} ${loan.client.lastName}`,
                disbursalDate: loan.disbursedLevel1At ? loan.disbursedLevel1At.toISOString() : 'N/A',
                loanAmount: safeNum(loan.amount),
                opArr,
                dueAmount,
                
                // Real collection transactions within the period [fromDate, tillDate]
                collAmt, 
                realizedCollAmt, 
                pendingCollAmt, 
                
                clsArr,
                todayPending,  // today's demand not yet collected (pending, NOT arrear)
                compDue,
                collDue,
                totalDue,
                maturityDate,
                phone: loan.client.mobileNumber || 'N/A',
                nomineeName: loan.client.nomineeName || 'N/A',
                nomineePhone: loan.client.nomineePhone || 'N/A',
                meetingDay: loan.center.meetingDay || 'N/A',
                empName: loan.center.fdo ? `${loan.center.fdo.firstName} ${loan.center.fdo.lastName}` : 'Unassigned',
            };
        });

        // Filter out loans that have no relevance to the period
        const filteredResults = results.filter(r => r.opArr > 0 || r.dueAmount > 0 || r.collAmt > 0);

        // Sort by center, then member name
        filteredResults.sort((a, b) => {
            const byCen = a.centerName.localeCompare(b.centerName);
            if (byCen !== 0) return byCen;
            return a.memberName.localeCompare(b.memberName);
        });

        return successResponse(filteredResults, 'Collection followup data retrieved successfully');
    } catch (error) {
        console.error('Error fetching collection followup report:', error);
        return errorResponse('Internal server error', 500);
    }
}

export const GET = withRole(['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER'], handler);
