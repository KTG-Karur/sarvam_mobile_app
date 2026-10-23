import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/app/lib/db';
import { withRole } from '@/app/lib/api-utils';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';
import { buildFinancialTransactionBranchScope } from '@/app/lib/filters/financial-transaction-branch';
import { getBranchOpeningContext, resolveSelfAccountBridges, selfAccountOpeningAmount, type BranchOpeningContext } from '@/app/lib/services/ledger-opening-balance';
import { toDisplayDate } from '@/app/lib/date-format';

export async function GET(req: NextRequest) {
    return withRole(['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'], async (request, user) => {
    try {
        const { searchParams } = new URL(request.url);
        const requestedType = searchParams.get('type') || 'head_office';

        // Non-admin (or admin scoped to an active branch) can only ever see their
        // own/assigned branch(es) — 'head_office' and 'consolidated' are HQ-only views.
        const permitted = await getPermittedBranchIds(user);
        let type = requestedType;
        if (permitted !== null) {
            if (permitted.length === 0) {
                return NextResponse.json({ success: true, data: [] });
            }
            if (!permitted.includes(requestedType)) {
                type = permitted[0];
            }
        }

        const startDateParam = searchParams.get('startDate');
        const endDateParam = searchParams.get('endDate');

        // Parse dates
        if (!startDateParam || !endDateParam) {
            return NextResponse.json(
                { success: false, message: 'Start Date and End Date are required.' },
                { status: 400 }
            );
        }

        const startDate = new Date(startDateParam);
        const endDate = new Date(endDateParam);
        // Ensure endDate covers the full day
        endDate.setHours(23, 59, 59, 999);

        // Resolve branch scope for this view — null (consolidated) means unrestricted.
        let branchIds: string[] | null = null;
        if (type === 'head_office') {
            // Find Head Office branch
            const headOfficeBranch = await prisma.branch.findFirst({
                where: {
                    OR: [
                        { name: { contains: 'Head Office', mode: 'insensitive' } },
                        { code: 'HO' }
                    ]
                },
                select: { id: true }
            });

            if (!headOfficeBranch) {
                // CRITICAL FIX: If Head Office branch is not found, do NOT return all data.
                // Return empty to distinguish from Consolidated.
                return NextResponse.json({
                    success: true,
                    data: []
                });
            }
            branchIds = [headOfficeBranch.id];
        } else if (type !== 'consolidated') {
            // A specific branchId (e.g. a non-admin forced to their own/assigned branch above)
            branchIds = [type];
        }

        const result = await computeGlAllAccounts(branchIds, startDate, endDate);

        return NextResponse.json({
            success: true,
            data: result
        });

    } catch (error: any) {
        console.error("Error fetching GL All:", error);
        return NextResponse.json(
            { success: false, message: error.message || 'Internal Server Error' },
            { status: 500 }
        );
    }
    })(req);
}

/**
 * Cookie-free core, split out of the GET handler above so the Request Report queue adapter
 * (app/lib/reports/report-registry.ts) — which has no cookie/session context — can call it
 * directly with an already-resolved `branchIds` (null = consolidated/unrestricted, matching
 * buildFinancialTransactionBranchScope()'s and getBranchOpeningContext()'s own null-safe
 * array-or-null contract). The live route above still resolves `type` → `branchIds` from the
 * request's role/permissions before delegating here.
 */
export async function computeGlAllAccounts(branchIds: string[] | null, startDate: Date, endDate: Date) {
        // Fetch Accounts (Ledgers and Self Accounts)
        const [ledgers, selfAccounts] = await Promise.all([
            prisma.accountLedger.findMany({
                where: { isActive: true },
                select: { id: true, ledgerName: true, groupId: true },
            }),
            prisma.selfAccount.findMany({
                where: { isActive: true },
                select: { id: true, name: true },
            }),
        ]);

        // Fetch Transactions — only APPROVED transactions affect GL reports
        const whereClause: any = {
            isActive: true,
            approvalStatus: 'APPROVED',
            transactionDate: {
                lte: endDate,
            },
            // Explicit FinancialTransaction.branchId (with legacy createdBy fallback) —
            // matches Day Book/Receipts & Payments/Trial Balance's scoping so all reports
            // agree on which branch a transaction belongs to.
            ...buildFinancialTransactionBranchScope({ branchId: branchIds ?? undefined }),
        };

        // Per-branch opening-balance context (never blended across branches) + the
        // Cash in Hand / Bank self-account bridge, resolved once.
        const branchContexts = await getBranchOpeningContext(branchIds);
        const selfBridges = await resolveSelfAccountBridges();
        const selfAccountBridgeLedgerId = new Map<string, string | null>();
        if (selfBridges.cashInHand) selfAccountBridgeLedgerId.set(selfBridges.cashInHand.selfAccountId, selfBridges.cashInHand.bridgeLedgerId);
        if (selfBridges.bank) selfAccountBridgeLedgerId.set(selfBridges.bank.selfAccountId, selfBridges.bank.bridgeLedgerId);
        // The bridge ledger's opening amount is owned by the self-account row (real cash
        // transactions post via selfAccountId, never via this ledger's own id) — the ledger
        // seed loop below must skip EVERY ledger sharing the bridged name (the chart of
        // accounts can contain more than one "Cash in Hand" ledger — all of them, not just
        // the one picked as the amount-of-record), or the same configured amount shows up
        // as two rows: a near-inert ledger row and the real, transaction-backed self row.
        const bridgeLedgerIds = new Set(selfBridges.allBridgeLedgerIds);

        const resolveTxBranchId = (tx: { branchId: string | null; createdBy: { branchId: string | null } | null }): string | null =>
            tx.branchId ?? tx.createdBy?.branchId ?? null;

        // Configured opening amount for a ledger/self account within a branch context —
        // null = unconfigured (naive fallback), 0 = configured but this account was never
        // given its own row.
        const configuredAmountFor = (
            context: BranchOpeningContext | undefined,
            accountType: 'LEDGER' | 'SELF',
            accountId: string
        ): number | null => {
            if (!context) return null;
            if (accountType === 'SELF') {
                // Direct SelfAccountOpeningBalance row wins; legacy name→ledger bridge is the fallback.
                return selfAccountOpeningAmount(context, accountId, selfAccountBridgeLedgerId.get(accountId) ?? null);
            }
            return context.ledgerAmounts.get(accountId) ?? 0;
        };

        const transactions = await prisma.financialTransaction.findMany({
            where: whereClause,
            include: {
                ledger: { select: { id: true, ledgerName: true } },
                selfAccount: { select: { id: true, name: true } },
                createdBy: { select: { branchId: true } },
            },
            orderBy: { transactionDate: 'asc' },
        });

        // Initialize Result Map
        const accountMap: Record<string, {
            id: string;
            name: string;
            type: 'LEDGER' | 'SELF';
            openingBalance: number;
            closingBalance: number;
            transactions: any[];
        }> = {};

        // Helper to get/create account entry
        const getAccountEntry = (id: string, name: string, type: 'LEDGER' | 'SELF') => {
            if (!accountMap[id]) {
                accountMap[id] = {
                    id,
                    name,
                    type,
                    openingBalance: 0,
                    closingBalance: 0,
                    transactions: [],
                };
            }
            return accountMap[id];
        };

        // Initialize map with all known accounts (even with 0 balance)
        ledgers.forEach(l => getAccountEntry(l.id, l.ledgerName, 'LEDGER'));
        selfAccounts.forEach(s => getAccountEntry(s.id, s.name, 'SELF'));

        // Process Transactions
        transactions.forEach(tx => {
            const amount = Number(tx.amount);
            const txDate = new Date(tx.transactionDate);
            const context = branchContexts.get(resolveTxBranchId(tx) ?? '');
            const txDateStr = toDisplayDate(txDate);
            const isBeforeStart = txDate < startDate;

            // Logic:
            // Bank/Cash Receipt: Self Account (Debit +), Ledger (Credit -)
            // Bank/Cash Payment: Self Account (Credit -), Ledger (Debit +)

            // Self Account Processing
            if (tx.selfAccountId) {
                const configuredAmount = configuredAmountFor(context, 'SELF', tx.selfAccountId);
                const excluded = configuredAmount !== null && txDate < context!.openingDate;
                if (!excluded) {
                    const entry = getAccountEntry(tx.selfAccountId, tx.selfAccount?.name || 'Unknown Self Account', 'SELF');
                    let impact = 0; // Positive = Debit, Negative = Credit

                    if (tx.type === 'BANK_RECEIPT' || tx.type === 'CASH_RECEIPT') {
                        impact = amount; // Debit
                    } else if (tx.type === 'BANK_PAYMENT' || tx.type === 'CASH_PAYMENT') {
                        impact = -amount; // Credit
                    } else if (tx.type === 'CONTRA') {
                        // Contra logic depends on implementation. Defaulting to impact based on common flows if discernible.
                    }

                    if (isBeforeStart) {
                        entry.openingBalance += impact;
                    } else {
                        entry.transactions.push({
                            date: txDateStr,
                            type: impact > 0 ? 'DR' : 'CR',
                            particulars: tx.description || tx.type.replace('_', ' '),
                            debit: impact > 0 ? impact : 0,
                            credit: impact < 0 ? Math.abs(impact) : 0,
                            voucherNo: tx.voucherNo
                        });
                    }
                    entry.closingBalance += impact;
                }
            }

            // Ledger Account Processing
            if (tx.ledgerId) {
                const configuredAmount = configuredAmountFor(context, 'LEDGER', tx.ledgerId);
                const excluded = configuredAmount !== null && txDate < context!.openingDate;
                if (!excluded) {
                    const entry = getAccountEntry(tx.ledgerId, tx.ledger?.ledgerName || 'Unknown Ledger', 'LEDGER');
                    let impact = 0;

                    if (tx.type === 'BANK_RECEIPT' || tx.type === 'CASH_RECEIPT') {
                        impact = -amount; // Credit
                    } else if (tx.type === 'BANK_PAYMENT' || tx.type === 'CASH_PAYMENT') {
                        impact = amount; // Debit
                    }

                    if (isBeforeStart) {
                        entry.openingBalance += impact;
                    } else {
                        entry.transactions.push({
                            date: txDateStr,
                            type: impact > 0 ? 'DR' : 'CR',
                            particulars: tx.description || tx.type.replace('_', ' '),
                            debit: impact > 0 ? impact : 0,
                            credit: impact < 0 ? Math.abs(impact) : 0,
                            voucherNo: tx.voucherNo
                        });
                    }
                    entry.closingBalance += impact;
                }
            }
        });

        // Seed configured opening amounts once per (branch, account) — summed across every
        // branch in scope, mirroring GL One / Trial Balance's "All Branches" aggregation.
        // Bridge ledgers are seeded on the self-account side only (see bridgeLedgerIds
        // above) — skip them here to avoid seeding the same amount onto two rows.
        for (const context of branchContexts.values()) {
            ledgers.forEach(l => {
                if (bridgeLedgerIds.has(l.id)) return;
                const amt = context.ledgerAmounts.get(l.id);
                if (amt === undefined) return;
                const entry = getAccountEntry(l.id, l.ledgerName, 'LEDGER');
                entry.openingBalance += amt;
                entry.closingBalance += amt;
            });
            selfAccounts.forEach(s => {
                const bridgeLedgerId = selfAccountBridgeLedgerId.get(s.id);
                if (!bridgeLedgerId) return;
                const amt = context.ledgerAmounts.get(bridgeLedgerId);
                if (amt === undefined) return;
                const entry = getAccountEntry(s.id, s.name, 'SELF');
                entry.openingBalance += amt;
                entry.closingBalance += amt;
            });
        }

        return Object.values(accountMap).filter(acc =>
            Math.abs(acc.openingBalance) > 0.01 ||
            Math.abs(acc.closingBalance) > 0.01 ||
            acc.transactions.length > 0
        ).sort((a, b) => a.name.localeCompare(b.name));
}
