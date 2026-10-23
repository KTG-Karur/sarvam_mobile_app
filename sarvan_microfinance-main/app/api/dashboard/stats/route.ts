import { NextRequest } from 'next/server';
import {
    handleCorsPreflight,
    successResponse,
    withAuth,
    errorResponse
} from '@/app/lib/api-utils';
import { Prisma } from '@prisma/client';
import { prisma } from '@/app/lib/prisma';
import { scheduleAdvancePaidTotalSql } from '@/app/lib/eod-collection-gates';
import {
    getBranchCalendarDayHalfOpenUtc,
    getBranchCalendarYmdForInstant,
    isWorkingDateAheadOfBranchCalendarToday,
} from '@/app/lib/branch-financial-day';
import { resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';

const HEAD_OFFICE_BRANCH_CODE = 'HO';

export async function OPTIONS() {
    return handleCorsPreflight();
}

type EodDayKey = string;

type BranchEodContext = {
    branchId: string;
    branchLabel: string;
    timeZone: string;
    currentWorkingInstant: Date;
    workingDateYmd: string;
    dayStartUtc: Date;
    dayEndExclusiveUtc: Date;
    lastEodClosedAt: Date | null;
};

type EodMoneyAggRow = {
    branchId: string;
    openingReceipts: unknown;
    openingPayments: unknown;
    dayReceipts: unknown;
    dayPayments: unknown;
};

function formatEodDateLabel(ymd: string, timeZone: string): string {
    // Render yyyy-MM-dd as a branch-local date label (e.g. "07 Apr 2026").
    // Use a TZ-anchored instant to avoid server-local timezone drift.
    const instant =
        timeZone === 'Asia/Kolkata'
            ? new Date(`${ymd}T00:00:00+05:30`)
            : new Date(`${ymd}T00:00:00.000Z`);
    return new Intl.DateTimeFormat('en-GB', {
        timeZone,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
    }).format(instant);
}

function formatDoneAtLabel(instant: Date, timeZone: string): string {
    return new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
    }).format(instant);
}

export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const { searchParams } = new URL(request.url);
            const branchIdParam = searchParams.get('branchId');
            const branchIdHeader = req.headers.get('x-branch-id');
            // Fails safe — a client-supplied branchId (param or header) outside the
            // caller's permitted set is ignored, never honored. BM/FDO are forced to
            // their own branch; AREA_MANAGER is restricted to their assigned branches.
            const scopedBranchIds = await resolveScopedBranchIds(user, branchIdParam || branchIdHeader);
            const effectiveBranchId =
                scopedBranchIds && scopedBranchIds.length === 1 ? scopedBranchIds[0] : undefined;

            const effectiveBranch = effectiveBranchId
                ? await prisma.branch.findUnique({
                      where: { id: effectiveBranchId },
                      select: { id: true, code: true },
                  })
                : null;

            const isHeadOffice = effectiveBranch?.code === HEAD_OFFICE_BRANCH_CODE;

            const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

            // Filter Definitions — null scopedBranchIds means an unrestricted Head
            // Office ADMIN view (no filter); otherwise restrict to the permitted set.
            const branchIdFilterValue =
                scopedBranchIds === null || isHeadOffice
                    ? undefined
                    : scopedBranchIds.length === 1
                      ? scopedBranchIds[0]
                      : { in: scopedBranchIds };
            const branchFilter = branchIdFilterValue ? { branchId: branchIdFilterValue } : {};
            const clientFilter = branchIdFilterValue ? { center: { branchId: branchIdFilterValue } } : {};
            const branchListFilter = branchIdFilterValue ? { id: branchIdFilterValue } : {};

            // Pending approval counts (role-sensitive)
            const [pendingAmCount, pendingAdminCount] = await Promise.all([
                prisma.financialTransaction.count({
                    where: { isActive: true, approvalStatus: 'PENDING_AM_APPROVAL' as any, ...branchFilter },
                }),
                prisma.financialTransaction.count({
                    where: { isActive: true, approvalStatus: 'PENDING_ADMIN_APPROVAL' as any },
                }),
            ]);

            // Parallel fetching for maximum efficiency
            const [
                totalCenters,
                totalClients,
                newCentersThisMonth,
                newClientsThisMonth,
                disbursedThisMonth,
                disbursedLastMonth,
                portfolioOS,
                portfolioCollected,
                branches
            ] = await prisma.$transaction([
                // 1. Total Centers
                prisma.center.count({
                    where: {
                        isActive: true,
                        ...branchFilter
                    }
                }),

                // 2. Total Clients
                prisma.client.count({
                    where: {
                        isActive: true,
                        ...clientFilter
                    }
                }),

                // 3. New Centers (Trend)
                prisma.center.count({
                    where: {
                        isActive: true,
                        createdAt: { gte: startOfMonth },
                        ...branchFilter
                    }
                }),

                // 4. New Clients (Trend)
                prisma.client.count({
                    where: {
                        isActive: true,
                        createdAt: { gte: startOfMonth },
                        ...clientFilter
                    }
                }),

                // 5. Disbursement (All Time)
                prisma.loan.aggregate({
                    _sum: { amount: true },
                    where: {
                        isActive: true,
                        disbursementStatus: 'DISBURSED',
                        ...branchFilter
                    }
                }),

                // 6. Disbursement Last Month (Trend) - approximate
                prisma.loan.aggregate({
                    _sum: { amount: true },
                    where: {
                        disbursementStatus: 'DISBURSED',
                        disbursedLevel1At: {
                            lt: startOfMonth
                        },
                        ...branchFilter
                    }
                }),

                // 7. Portfolio OS (Total Disbursed - Total Repaid)
                prisma.loan.aggregate({
                    _sum: { amount: true },
                    where: {
                        isActive: true,
                        disbursementStatus: 'DISBURSED',
                        ...branchFilter
                    }
                }),

                // 8. Portfolio Collected (All Time) - total repayments
                prisma.loanTransaction.aggregate({
                    _sum: { amount: true },
                    where: {
                        type: 'REPAYMENT',
                        status: 'APPROVED',
                        isReversed: false,
                        ...branchFilter,
                    },
                }),

                // 9. Branch Data for Reports
                prisma.branch.findMany({
                    where: {
                        isActive: true,
                        ...branchListFilter
                    },
                    include: {
                        lock: {
                            select: {
                                currentWorkingDate: true,
                                timezone: true,
                                lastEodClosedAt: true,
                            },
                        },
                        _count: {
                            select: {
                                centers: true
                            }
                        },
                        centers: {
                            select: {
                                id: true,
                                _count: {
                                    select: { clients: true }
                                }
                            }
                        }
                    },
                    orderBy: { code: 'asc' }
                })
            ]);

            // Calculate Trends for Stats
            const totalCentersPrev = totalCenters - newCentersThisMonth;
            const centerTrend = totalCentersPrev > 0 ? ((newCentersThisMonth / totalCentersPrev) * 100) : 0;

            const totalClientsPrev = totalClients - newClientsThisMonth;
            const clientTrend = totalClientsPrev > 0 ? ((newClientsThisMonth / totalClientsPrev) * 100) : 0;

            const currentDisb = Number(disbursedThisMonth._sum.amount || 0);
            const prevDisb = Number(disbursedLastMonth._sum.amount || 0); // This is actually 'All Time Before This Month' in query above, logic implies fetching specific month is expensive without boundaries. 
            // Simplified trend for disbursed: just comparison? Let's use 0 for now or improved later.
            const portfolioDisbursed = Number(portfolioOS._sum.amount || 0);
            const portfolioRepaid = Number(portfolioCollected._sum.amount || 0);
            const portfolioOutstanding = Math.max(0, portfolioDisbursed - portfolioRepaid);

            // Construct Branch Report Data
            // Calculate End of Month
            const now = new Date();
            const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

            const branchIds = branches.map((b) => b.id);

            const [scheduleAggByBranch, collectionByBranch] = await Promise.all([
                branchIds.length > 0
                    ? prisma.$queryRaw<
                          Array<{
                              branchId: string;
                              openingArr: unknown;
                              demand: unknown;
                          }>
                      >(Prisma.sql`
                        SELECT
                          l."branchId" AS "branchId",
                          COALESCE(SUM(CASE
                            WHEN s."dueDate" < ${startOfMonth} THEN (s."totalDue" - s."totalPaid")
                            ELSE 0
                          END), 0) AS "openingArr",
                          COALESCE(SUM(CASE
                            WHEN s."dueDate" >= ${startOfMonth} AND s."dueDate" <= ${endOfMonth} THEN GREATEST(s."totalDue" - ${scheduleAdvancePaidTotalSql}, 0)
                            ELSE 0
                          END), 0) AS "demand"
                        FROM "loan_schedules" s
                        JOIN "loans" l ON l."id" = s."loanId"
                        WHERE l."branchId" IN (${Prisma.join(branchIds)})
                          AND l."isActive" = true
                      GROUP BY l."branchId"
                      `)
                    : Promise.resolve([]),
                branchIds.length > 0
                    ? prisma.loanTransaction.groupBy({
                          by: ['branchId'],
                          _sum: { amount: true },
                          where: {
                              branchId: { in: branchIds },
                              type: 'REPAYMENT',
                              status: 'APPROVED',
                              isReversed: false,
                              transactionDate: { gte: startOfMonth, lte: endOfMonth },
                          },
                      })
                    : Promise.resolve([]),
            ]);

            const openingArrMap = new Map<string, number>();
            const demandMap = new Map<string, number>();
            for (const row of scheduleAggByBranch) {
                openingArrMap.set(row.branchId, Number(row.openingArr ?? 0));
                demandMap.set(row.branchId, Number(row.demand ?? 0));
            }

            const collectionMap = new Map<string, number>();
            for (const row of collectionByBranch) {
                if (!row.branchId) continue;
                collectionMap.set(row.branchId, Number(row._sum.amount ?? 0));
            }

            // Construct Branch Report Data with batched financial aggregates (avoids N+1)
            const branchReportPayload = branches.map((b) => {
                const clientCount = b.centers.reduce((sum, c) => sum + c._count.clients, 0);

                const openingArr = Math.max(0, openingArrMap.get(b.id) ?? 0);
                const demand = Math.max(0, demandMap.get(b.id) ?? 0);
                const collection = collectionMap.get(b.id) ?? 0;
                const closingArr = Math.max(0, openingArr + demand - collection);

                const status: 'Collected' | 'Pending' | 'Overdue' = closingArr > 0 ? 'Overdue' : 'Collected';

                return {
                    code: b.code || '000',
                    branch: `${b.code} - ${b.name}`,
                    centers: b._count.centers,
                    clients: clientCount,
                    openingArr: Number(openingArr.toFixed(2)),
                    demand: Number(demand.toFixed(2)),
                    collection: Number(collection.toFixed(2)),
                    closingArr: Number(closingArr.toFixed(2)),
                    status,
                };
            });

            // Sort by branch code/name if needed (already sorted by code in query, but Promise.all preserves order)
            const branchReport = branchReportPayload;

            // Construct EOD Data (Using Branch info + Mock Times)
            const nowUtc = new Date();

            const branchEodContexts: BranchEodContext[] = branches.map((b) => {
                const timeZone = b.lock?.timezone || 'Asia/Kolkata';
                const currentWorkingInstant = b.lock?.currentWorkingDate || nowUtc;
                const { workingDateYmd, dayStartUtc, dayEndExclusiveUtc } =
                    getBranchCalendarDayHalfOpenUtc(currentWorkingInstant, timeZone);

                return {
                    branchId: b.id,
                    branchLabel: `${b.code} - ${b.name}`,
                    timeZone,
                    currentWorkingInstant,
                    workingDateYmd,
                    dayStartUtc,
                    dayEndExclusiveUtc,
                    lastEodClosedAt: b.lock?.lastEodClosedAt ?? null,
                };
            });

            const branchesByEodDay = new Map<EodDayKey, BranchEodContext[]>();
            for (const ctx of branchEodContexts) {
                const key = `${ctx.timeZone}|${ctx.dayStartUtc.toISOString()}`;
                const existing = branchesByEodDay.get(key) ?? [];
                existing.push(ctx);
                branchesByEodDay.set(key, existing);
            }

            const RECEIPT_TYPES = ['BANK_RECEIPT', 'CASH_RECEIPT'] as const;
            const PAYMENT_TYPES = ['BANK_PAYMENT', 'CASH_PAYMENT'] as const;

            const eodMoneyAggByBranchId = new Map<string, {
                openingBalance: number;
                dayReceipts: number;
                dayPayments: number;
            }>();

            for (const [, ctxs] of branchesByEodDay) {
                const groupBranchIds = ctxs.map((c) => c.branchId);
                const { dayStartUtc, dayEndExclusiveUtc } = ctxs[0];

                // Postgres stores FinancialTransaction.type as an enum ("FinancialTransactionType").
                // Cast literals to the enum to avoid enum-vs-text operator errors.
                const receiptTypeSql = [
                    Prisma.sql`'BANK_RECEIPT'::"FinancialTransactionType"`,
                    Prisma.sql`'CASH_RECEIPT'::"FinancialTransactionType"`,
                ];
                const paymentTypeSql = [
                    Prisma.sql`'BANK_PAYMENT'::"FinancialTransactionType"`,
                    Prisma.sql`'CASH_PAYMENT'::"FinancialTransactionType"`,
                ];

                const rows = await prisma.$queryRaw<EodMoneyAggRow[]>(
                    Prisma.sql`
                        SELECT
                            u."branchId" AS "branchId",
                            COALESCE(SUM(CASE
                                WHEN ft."transactionDate" < ${dayStartUtc}
                                  AND ft."type" IN (${Prisma.join(receiptTypeSql)})
                                THEN ft."amount"
                                ELSE 0
                            END), 0) AS "openingReceipts",
                            COALESCE(SUM(CASE
                                WHEN ft."transactionDate" < ${dayStartUtc}
                                  AND ft."type" IN (${Prisma.join(paymentTypeSql)})
                                THEN ft."amount"
                                ELSE 0
                            END), 0) AS "openingPayments",
                            COALESCE(SUM(CASE
                                WHEN ft."transactionDate" >= ${dayStartUtc}
                                  AND ft."transactionDate" < ${dayEndExclusiveUtc}
                                  AND ft."type" IN (${Prisma.join(receiptTypeSql)})
                                THEN ft."amount"
                                ELSE 0
                            END), 0) AS "dayReceipts",
                            COALESCE(SUM(CASE
                                WHEN ft."transactionDate" >= ${dayStartUtc}
                                  AND ft."transactionDate" < ${dayEndExclusiveUtc}
                                  AND ft."type" IN (${Prisma.join(paymentTypeSql)})
                                THEN ft."amount"
                                ELSE 0
                            END), 0) AS "dayPayments"
                        FROM "financial_transactions" ft
                        JOIN "users" u ON u."id" = ft."createdById"
                        WHERE ft."isActive" = true
                          AND ft."selfAccountId" IS NOT NULL
                          AND ft."transactionDate" < ${dayEndExclusiveUtc}
                          AND u."branchId" IN (${Prisma.join(groupBranchIds)})
                        GROUP BY u."branchId"
                    `
                );

                for (const r of rows) {
                    const openingReceipts = Number(r.openingReceipts ?? 0);
                    const openingPayments = Number(r.openingPayments ?? 0);
                    const dayReceipts = Number(r.dayReceipts ?? 0);
                    const dayPayments = Number(r.dayPayments ?? 0);

                    eodMoneyAggByBranchId.set(r.branchId, {
                        openingBalance: openingReceipts - openingPayments,
                        dayReceipts,
                        dayPayments,
                    });
                }

                // Ensure branches with zero financial txns still appear with zeros.
                for (const c of ctxs) {
                    if (!eodMoneyAggByBranchId.has(c.branchId)) {
                        eodMoneyAggByBranchId.set(c.branchId, {
                            openingBalance: 0,
                            dayReceipts: 0,
                            dayPayments: 0,
                        });
                    }
                }
            }

            const eodStatus = branchEodContexts.map((ctx) => {
                const money = eodMoneyAggByBranchId.get(ctx.branchId) ?? {
                    openingBalance: 0,
                    dayReceipts: 0,
                    dayPayments: 0,
                };

                const closingBalance =
                    money.openingBalance + money.dayReceipts - money.dayPayments;

                const completedForBranchCalendarToday = isWorkingDateAheadOfBranchCalendarToday(
                    ctx.currentWorkingInstant,
                    nowUtc,
                    ctx.timeZone
                );

                // Match EOD process semantics: when working date is ahead of today's calendar day, EOD is "Completed for today".
                // For the dashboard, if it isn't completed, consider it "In Progress" when there's any cash/bank movement on the working date.
                const hasActivityToday = money.dayReceipts > 0 || money.dayPayments > 0;

                const status: 'Completed' | 'Pending' | 'In Progress' =
                    completedForBranchCalendarToday ? 'Completed' : hasActivityToday ? 'In Progress' : 'Pending';

                return {
                    branch: ctx.branchLabel,
                    eodDate: formatEodDateLabel(ctx.workingDateYmd, ctx.timeZone),
                    doneAt:
                        status === 'Completed' && ctx.lastEodClosedAt
                            ? formatDoneAtLabel(ctx.lastEodClosedAt, ctx.timeZone)
                            : '',
                    status,
                    openingBalance: Number(money.openingBalance.toFixed(2)),
                    totalReceipts: Number(money.dayReceipts.toFixed(2)),
                    totalPayments: Number(money.dayPayments.toFixed(2)),
                    closingBalance: Number(closingBalance.toFixed(2)),
                };
            });


            return successResponse({
                stats: {
                    totalCenters: {
                        value: totalCenters,
                        trend: centerTrend
                    },
                    totalClients: {
                        value: totalClients,
                        trend: clientTrend
                    },
                    loanDisbursement: {
                        value: currentDisb,
                        trend: 0 // Placeholder
                    },
                    portfolioOS: {
                        value: portfolioOutstanding,
                        trend: 0 // Placeholder
                    },
                    pendingAmApproval: pendingAmCount,
                    pendingAdminApproval: pendingAdminCount,
                },
                branchReport,
                eodStatus
            });

        } catch (error) {
            console.error('Dashboard Stats API Error:', error);
            return errorResponse('Failed to fetch dashboard stats', 500);
        }
    })(request);
}
