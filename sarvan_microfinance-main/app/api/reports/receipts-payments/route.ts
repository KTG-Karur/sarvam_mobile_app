import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/app/lib/db';
import { withRole } from '@/app/lib/api-utils';
import { buildFinancialTransactionBranchScope } from '@/app/lib/filters/financial-transaction-branch';
import { getPermittedBranchIds, resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';
import { getBranchOpeningContext, resolveSelfAccountBridges, selfAccountOpeningAmount } from '@/app/lib/services/ledger-opening-balance';

export async function GET(req: NextRequest) {
    return withRole(
        ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'],
        async (request, user) => {
            const { searchParams } = new URL(request.url);
            const dateMode = (searchParams.get('reportType') || 'RANGE') as 'RANGE' | 'AS_ON';
            const fromDate = searchParams.get('fromDate');
            const toDate = searchParams.get('toDate');
            const asOnDateStr = searchParams.get('asOnDate');
            const branchId = searchParams.get('branchId') || 'all';

            if (dateMode === 'RANGE' && (!fromDate || !toDate)) {
                return NextResponse.json(
                    { success: false, message: 'fromDate and toDate are required.' },
                    { status: 400 }
                );
            }
            if (dateMode === 'AS_ON' && !asOnDateStr) {
                return NextResponse.json(
                    { success: false, message: 'asOnDate is required.' },
                    { status: 400 }
                );
            }

            // RANGE: bounded window [startDate, endDate]. AS_ON: cumulative from inception
            // (or each branch's own configured opening date) through asOnDate — startDate
            // stays null so the txInRange query below has no lower bound in that mode.
            let startDate: Date | null = null;
            let endDate: Date;
            if (dateMode === 'RANGE') {
                startDate = new Date(fromDate as string);
                startDate.setHours(0, 0, 0, 0);
                endDate = new Date(toDate as string);
                endDate.setHours(23, 59, 59, 999);
            } else {
                endDate = new Date(asOnDateStr as string);
                endDate.setHours(23, 59, 59, 999);
            }

            // Union of per-branch FinancialTransaction scopes (legacy-row fallback included).
            const scopeForBranchIds = (ids: string[]) => {
                const ors = ids.flatMap((id) => (buildFinancialTransactionBranchScope({ branchId: id }) as any).OR ?? []);
                return ors.length > 0 ? { OR: ors } : { branchId: '__NO_PERMITTED_BRANCH__' };
            };

            // branchIds mirrors branchFilter exactly (set together below) — the bounded set
            // of branches this view covers, used to look up each branch's own opening-balance
            // config independently. null = unrestricted (ADMIN "all").
            let branchFilter: any = {};
            let branchIds: string[] | null = null;
            if (user.role === 'BRANCH_MANAGER') {
                // BM is always forced to their own branch, regardless of any requested branchId.
                branchFilter = user.branchId
                    ? buildFinancialTransactionBranchScope({ branchId: user.branchId })
                    : { branchId: '__NO_PERMITTED_BRANCH__' };
                branchIds = user.branchId ? [user.branchId] : [];
            } else if (branchId === 'head_office') {
                const headOfficeBranch = await prisma.branch.findFirst({
                    where: {
                        OR: [
                            { code: 'HO' },
                            { name: { equals: 'Head Office', mode: 'insensitive' } },
                        ],
                    },
                    select: { id: true },
                });

                const hoScope = {
                    OR: [
                        ...(headOfficeBranch ? [{ branchId: headOfficeBranch.id }] : []),
                        // Legacy fallback: rows without explicit branchId but created by HO user.
                        ...(headOfficeBranch
                            ? [{ branchId: null, createdBy: { branchId: headOfficeBranch.id } }]
                            : []),
                        // Backward compatibility: include legacy vouchers created by users without branch assignment.
                        { branchId: null, createdBy: { branchId: null } },
                    ],
                };

                if (user.role === 'ADMIN') {
                    branchFilter = hoScope;
                    branchIds = headOfficeBranch ? [headOfficeBranch.id] : [];
                } else {
                    // AREA_MANAGER: only honor head_office if it's within their assigned branches.
                    const permitted = await getPermittedBranchIds(user);
                    if (headOfficeBranch && permitted?.includes(headOfficeBranch.id)) {
                        branchFilter = hoScope;
                        branchIds = [headOfficeBranch.id];
                    } else {
                        branchFilter = permitted && permitted.length > 0 ? scopeForBranchIds(permitted) : { branchId: '__NO_PERMITTED_BRANCH__' };
                        branchIds = permitted && permitted.length > 0 ? permitted : [];
                    }
                }
            } else if (branchId === 'all') {
                if (user.role === 'ADMIN') {
                    branchFilter = {};
                    branchIds = null;
                } else {
                    // AREA_MANAGER: "all" means all of their assigned branches, not the whole company.
                    const permitted = await getPermittedBranchIds(user);
                    branchFilter = permitted && permitted.length > 0 ? scopeForBranchIds(permitted) : { branchId: '__NO_PERMITTED_BRANCH__' };
                    branchIds = permitted && permitted.length > 0 ? permitted : [];
                }
            } else if (user.role === 'ADMIN') {
                branchFilter = buildFinancialTransactionBranchScope({ branchId });
                branchIds = [branchId];
            } else {
                // AREA_MANAGER requesting a specific branch — fails safe to their permitted set if not assigned.
                const resolved = await resolveScopedBranchIds(user, branchId);
                branchFilter = resolved && resolved.length > 0 ? scopeForBranchIds(resolved) : { branchId: '__NO_PERMITTED_BRANCH__' };
                branchIds = resolved && resolved.length > 0 ? resolved : [];
            }

            const data = await computeReceiptsPaymentsCore(branchFilter, branchIds, dateMode, startDate, endDate);

            return NextResponse.json({
                success: true,
                data: {
                    ...data,
                    reportType: 'CONSOLIDATED',
                    dateMode,
                    fromDate: dateMode === 'AS_ON' ? asOnDateStr : fromDate,
                    toDate: dateMode === 'AS_ON' ? asOnDateStr : toDate,
                    asOnDate: dateMode === 'AS_ON' ? asOnDateStr : null,
                },
            });
        }
    )(req);
}

/**
 * Cookie-free core, split out of the GET handler above so the Request Report queue adapter
 * (app/lib/reports/report-registry.ts) — which has no cookie/session context — can call it
 * directly with an already-resolved branchFilter/branchIds (branchFilter built the same way
 * gl-all/gl-one do, via buildFinancialTransactionBranchScope({ branchId: branchIds ?? undefined
 * })). The live route above still does its own role-derived branchFilter/branchIds resolution
 * before delegating here.
 */
export async function computeReceiptsPaymentsCore(
    branchFilter: any,
    branchIds: string[] | null,
    dateMode: 'RANGE' | 'AS_ON',
    startDate: Date | null,
    endDate: Date
) {
            const commonWhere = {
                isActive: true,
                approvalStatus: 'APPROVED' as any,
                type: { in: ['BANK_RECEIPT', 'BANK_PAYMENT', 'CASH_RECEIPT', 'CASH_PAYMENT'] as any },
                ...branchFilter
            };

            // Per-branch opening-balance context (never blended across branches) + the
            // Cash in Hand / Bank self-account bridge, resolved once.
            const branchContexts = await getBranchOpeningContext(branchIds);
            const selfBridges = await resolveSelfAccountBridges();
            const selfAccountBridgeLedgerId = new Map<string, string | null>();
            if (selfBridges.cashInHand) selfAccountBridgeLedgerId.set(selfBridges.cashInHand.selfAccountId, selfBridges.cashInHand.bridgeLedgerId);
            if (selfBridges.bank) selfAccountBridgeLedgerId.set(selfBridges.bank.selfAccountId, selfBridges.bank.bridgeLedgerId);

            const resolveTxBranchId = (tx: { branchId: string | null; createdBy: { branchId: string | null } | null }): string | null =>
                tx.branchId ?? tx.createdBy?.branchId ?? null;

            // 1. Calculate Opening Balance — per row (not a plain aggregate) so each row can
            // be checked against its own branch's opening date and excluded if it predates it.
            // AS_ON has no "before window" — its opening balance is the seeded branch config
            // alone (below), same convention Trial Balance uses for its own AS_ON mode.
            let openingBalance = 0;
            if (dateMode === 'RANGE') {
                const openingCandidateRows = await prisma.financialTransaction.findMany({
                    where: {
                        ...commonWhere,
                        transactionDate: { lt: startDate as Date },
                        selfAccountId: { not: null },
                    },
                    select: {
                        selfAccountId: true,
                        type: true,
                        amount: true,
                        transactionDate: true,
                        branchId: true,
                        createdBy: { select: { branchId: true } },
                    },
                });

                for (const row of openingCandidateRows) {
                    const txBranchId = resolveTxBranchId(row);
                    const context = txBranchId ? branchContexts.get(txBranchId) : undefined;
                    const bridgeLedgerId = row.selfAccountId ? (selfAccountBridgeLedgerId.get(row.selfAccountId) ?? null) : null;
                    const configuredAmount = context
                        ? selfAccountOpeningAmount(context, row.selfAccountId ?? '', bridgeLedgerId)
                        : null;

                    if (configuredAmount !== null && row.transactionDate < context!.openingDate) continue;

                    const amount = Number(row.amount);
                    const isReceipt = row.type === 'BANK_RECEIPT' || row.type === 'CASH_RECEIPT';
                    openingBalance += isReceipt ? amount : -amount;
                }
            }

            // Seed configured Cash in Hand / Bank opening balances once per branch — summed
            // across every branch in scope, same aggregation shape as the other reports.
            for (const context of branchContexts.values()) {
                for (const bridge of [selfBridges.cashInHand, selfBridges.bank]) {
                    if (!bridge) continue;
                    const amt = selfAccountOpeningAmount(context, bridge.selfAccountId, bridge.bridgeLedgerId);
                    if (amt !== null) openingBalance += amt;
                }
            }

            // 2. Fetch the transactions in scope. RANGE: rows here are already >= startDate,
            // and any branch with a configured opening date later than startDate is excluded
            // from branchContexts entirely (naive fallback for it) — so nothing in this
            // window needs a further per-row opening-date check. AS_ON has no lower bound in
            // the query, so each row must be checked against its own branch's opening date
            // below, same as RANGE's opening-balance loop above.
            const txCandidates = await prisma.financialTransaction.findMany({
                where: {
                    ...commonWhere,
                    transactionDate: dateMode === 'RANGE'
                        ? { gte: startDate as Date, lte: endDate }
                        : { lte: endDate },
                },
                include: {
                    ledger: { select: { id: true, ledgerName: true } },
                    createdBy: { select: { branchId: true } },
                },
                orderBy: { transactionDate: 'asc' },
            });

            const txInRange = dateMode === 'AS_ON'
                ? txCandidates.filter((tx) => {
                      const txBranchId = resolveTxBranchId(tx);
                      const context = txBranchId ? branchContexts.get(txBranchId) : undefined;
                      return !context || tx.transactionDate >= context.openingDate;
                  })
                : txCandidates;

            // Aggregate receipts and payments by ledger name within date range
            const receiptMap: Record<string, { name: string; amount: number }> = {};
            const paymentMap: Record<string, { name: string; amount: number }> = {};

            txInRange.forEach((tx) => {
                const amount = Number(tx.amount);

                if (tx.type === 'BANK_RECEIPT' || tx.type === 'CASH_RECEIPT') {
                    if (tx.ledgerId) {
                        const key = tx.ledgerId;
                        const name = tx.ledger?.ledgerName || 'Unknown';
                        if (!receiptMap[key]) receiptMap[key] = { name, amount: 0 };
                        receiptMap[key].amount += amount;
                    }
                } else if (tx.type === 'BANK_PAYMENT' || tx.type === 'CASH_PAYMENT') {
                    if (tx.ledgerId) {
                        const key = tx.ledgerId;
                        const name = tx.ledger?.ledgerName || 'Unknown';
                        if (!paymentMap[key]) paymentMap[key] = { name, amount: 0 };
                        paymentMap[key].amount += amount;
                    }
                }
            });

            const totalReceipts = Object.values(receiptMap).reduce((s, r) => s + r.amount, 0);
            const totalPayments = Object.values(paymentMap).reduce((s, p) => s + p.amount, 0);
            const closingBalance = openingBalance + totalReceipts - totalPayments;

            const receipts = Object.entries(receiptMap).map(([id, r]) => ({
                id,
                ledgerName: r.name,
                amount: r.amount,
            }));

            const payments = Object.entries(paymentMap).map(([id, p]) => ({
                id,
                ledgerName: p.name,
                amount: p.amount,
            }));

            return { receipts, payments, openingBalance, closingBalance, totalReceipts, totalPayments };
}
