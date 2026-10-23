import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { withRole, successResponse, errorResponse, handleCorsPreflight } from '@/app/lib/api-utils';
import { resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';
import { buildFinancialTransactionBranchScope } from '@/app/lib/filters/financial-transaction-branch';
import {
    getBranchOpeningContext,
    resolveSelfAccountBridges,
} from '@/app/lib/services/ledger-opening-balance';
import { GL_SELF_ACCOUNT_NAMES } from '@/app/lib/gl-config';

export async function OPTIONS() {
    return handleCorsPreflight();
}

type GroupPathEntry = { groupId: string; groupName: string };

export type TrialBalanceRow = {
    groupPath: GroupPathEntry[];
    ledgerCode: string;
    ledgerName: string;
    openingDebit: number;
    openingCredit: number;
    txnDebit: number;
    txnCredit: number;
    closingDebit: number;
    closingCredit: number;
};

/**
 * Shared computation, used by the live GET below and by the Request-Queue
 * export adapter (app/lib/reports/report-registry.ts). `scopedBranchIds: null`
 * means unrestricted (already resolved by the caller).
 */
export async function computeTrialBalanceRows(params: {
    reportType: 'RANGE' | 'AS_ON';
    fromDateStr?: string | null;
    toDateStr?: string | null;
    asOnDateStr?: string | null;
    scopedBranchIds: string[] | null;
}): Promise<TrialBalanceRow[]> {
        const { reportType, fromDateStr, toDateStr, asOnDateStr, scopedBranchIds } = params;
        const branchScope = buildFinancialTransactionBranchScope({ branchId: scopedBranchIds ?? undefined });

        let windowStart: Date | null = null; // RANGE only — inclusive lower bound of the "Transactions" bucket
        let windowEnd: Date;

        if (reportType === 'RANGE') {
            windowStart = new Date(fromDateStr as string);
            windowStart.setHours(0, 0, 0, 0);
            windowEnd = new Date(toDateStr as string);
            windowEnd.setHours(23, 59, 59, 999);
        } else {
            windowEnd = new Date(asOnDateStr as string);
            windowEnd.setHours(23, 59, 59, 999);
        }

        // Opening balances are looked up "as of" the period start (RANGE: fromDate) or
        // the report date itself (AS_ON) — same convention as ledger-report's RANGE mode.
        // Computed independently per branch (never summed/date-blended across branches —
        // Branch A's config must never leak into Branch B's figures) and applied per
        // transaction row below using that row's own branch.
        const branchContexts = await getBranchOpeningContext(scopedBranchIds);
        const selfBridges = await resolveSelfAccountBridges();
        // The two system SelfAccounts (Cash in Hand / Bank) are attributed to a matching-named
        // bridge AccountLedger *only when one actually exists* — that ledger row then carries
        // their activity and its persisted opening balance. When there is NO such ledger
        // (bridgeLedgerId === null — e.g. this chart of accounts has "Cash"/"Bank" but no
        // "Cash in Hand" ledger), they get their own synthetic Current Assets → Cash|Bank row
        // just like every other SelfAccount, so their transactions are never lost.
        const selfAccountBridgeLedgerId = new Map<string, string>();
        if (selfBridges.cashInHand?.bridgeLedgerId) selfAccountBridgeLedgerId.set(selfBridges.cashInHand.selfAccountId, selfBridges.cashInHand.bridgeLedgerId);
        if (selfBridges.bank?.bridgeLedgerId) selfAccountBridgeLedgerId.set(selfBridges.bank.selfAccountId, selfBridges.bank.bridgeLedgerId);

        // Every OTHER self account (any Cash/Bank "hand" created in
        // /dashboard/accounts/self-accounts that isn't the system "Cash in Hand" /
        // "Bank") has no AccountLedger of its own and therefore no bridge above — its
        // transactions used to be dropped from this report entirely. Instead, render one
        // synthetic row per such self account under Current Assets → Cash/Bank, with its
        // Debit/Credit summed straight from its own FinancialTransaction legs.
        const activeSelfAccounts = await prisma.selfAccount.findMany({
            where: { isActive: true },
            select: { id: true, name: true, type: true },
        });
        const activeSelfAccountIds = new Set(activeSelfAccounts.map((s) => s.id));
        // Only skip the synthetic row for a self account that IS represented by a real bridge
        // ledger row above (non-null bridgeLedgerId). A system self account with no bridge
        // ledger still needs its own row.
        const bridgeSelfAccountIds = new Set<string>(selfAccountBridgeLedgerId.keys());

        // Synthetic self-account rows track GROSS debit and credit separately (not just the
        // net like a normal ledger row) so a self account with equal debits and credits —
        // net zero — is still shown with both figures, per "don't hide a ledger merely
        // because its net balance is zero". selfOpening is the pre-window net (RANGE only),
        // kept debit-positive like every other opening figure here.
        const selfTxnDr: Record<string, number> = {};
        const selfTxnCr: Record<string, number> = {};
        const selfOpening: Record<string, number> = {};
        const bucketSelfGross = (sid: string, txDate: Date, side: 1 | -1, amount: number, txBranchId: string | null) => {
            const context = txBranchId ? branchContexts.get(txBranchId) : undefined;
            if (context && txDate < context.openingDate) return; // same pre-cutover gate as bucket()
            if (reportType === 'RANGE') {
                if (txDate < (windowStart as Date)) {
                    selfOpening[sid] = (selfOpening[sid] || 0) + side * amount;
                    return;
                }
                if (txDate > windowEnd) return;
            } else if (txDate > windowEnd) {
                return;
            }
            if (side === 1) selfTxnDr[sid] = (selfTxnDr[sid] || 0) + amount;
            else selfTxnCr[sid] = (selfTxnCr[sid] || 0) + amount;
        };

        const resolveTxBranchId = (tx: { branchId: string | null; createdBy: { branchId: string | null } | null }): string | null =>
            tx.branchId ?? tx.createdBy?.branchId ?? null;

        const approvedOnly = { approvalStatus: 'APPROVED' as const, isActive: true };
        const baseWhere = {
            ...approvedOnly,
            transactionDate: { lte: windowEnd },
            ...branchScope,
        };

        // Raw transaction rows (not groupBy sums) — each branch's opening-balance
        // "openingDate" cutoff can differ, so bucketing into Opening vs Transactions has
        // to happen per-row in JS rather than via a single uniform date filter.
        const branchAttribution = { branchId: true, createdBy: { select: { branchId: true } } } as const;
        const [debitTxns, ledgerReceiptTxns, creditTxns, selfDebitTxns, selfCreditTxns, contraCreditTxns] = await Promise.all([
            // ledgerId is the Debit leg only for Cash/Bank Payment and Journal vouchers
            // (see app/api/transactions/cash-payment|bank-payment|journal/route.ts).
            prisma.financialTransaction.findMany({
                where: { ...baseWhere, type: { in: ['CASH_PAYMENT', 'BANK_PAYMENT', 'JOURNAL'] }, ledgerId: { not: null } },
                select: { ledgerId: true, amount: true, transactionDate: true, ...branchAttribution },
            }),
            // ledgerId is the Credit leg for Cash/Bank Receipt vouchers (see
            // app/api/transactions/cash-receipt|bank-receipt/route.ts — selfAccountId is
            // the Debit leg there, ledgerId is the Credit leg).
            prisma.financialTransaction.findMany({
                where: { ...baseWhere, type: { in: ['CASH_RECEIPT', 'BANK_RECEIPT'] }, ledgerId: { not: null } },
                select: { ledgerId: true, amount: true, transactionDate: true, ...branchAttribution },
            }),
            // creditLedgerId is only ever set by Journal vouchers.
            prisma.financialTransaction.findMany({
                where: { ...baseWhere, creditLedgerId: { not: null } },
                select: { creditLedgerId: true, amount: true, transactionDate: true, ...branchAttribution },
            }),
            prisma.financialTransaction.findMany({
                where: { ...baseWhere, type: { in: ['BANK_RECEIPT', 'CASH_RECEIPT', 'CONTRA'] }, selfAccountId: { not: null } },
                select: { selfAccountId: true, amount: true, transactionDate: true, ...branchAttribution },
            }),
            prisma.financialTransaction.findMany({
                where: { ...baseWhere, type: { in: ['BANK_PAYMENT', 'CASH_PAYMENT'] }, selfAccountId: { not: null } },
                select: { selfAccountId: true, amount: true, transactionDate: true, ...branchAttribution },
            }),
            // contraAccountId is the Credit leg of a Contra voucher (selfAccountId is the
            // Debit leg, handled by selfDebitTxns above) — see app/api/transactions/contra/route.ts.
            prisma.financialTransaction.findMany({
                where: { ...baseWhere, type: 'CONTRA', contraAccountId: { not: null } },
                select: { contraAccountId: true, amount: true, transactionDate: true, ...branchAttribution },
            }),
        ]);

        // netOpening/netTxn per id (positive = debit, negative = credit). Every voucher
        // type is classified by its actual posting convention (verified against the
        // voucher-creation routes) so each voucher's two legs always net to zero — this
        // is what keeps the report's Dr and Cr grand totals equal ("Balanced").
        const netOpening: Record<string, number> = {};
        const netTxn: Record<string, number> = {};
        // Gross period movement per ledger (debit legs and credit legs kept apart) so a
        // ledger that both received and paid the same amount in the period still shows its
        // real ₹X Debit and ₹X Credit — not a blank net-zero row that then gets suppressed.
        // Opening and Closing stay net; only the Transaction columns use these.
        const grossTxnDr: Record<string, number> = {};
        const grossTxnCr: Record<string, number> = {};

        // For RANGE: Opening = seededAmount + sum(branchOpeningDate <= tx < fromDate),
        // or (if branch unconfigured) sum(tx < fromDate). Transactions = sum(fromDate <= tx <= toDate).
        // For AS_ON: Opening = seededAmount alone; Transactions = sum(branchOpeningDate <= tx <= asOnDate),
        // or (if branch unconfigured) sum(tx <= asOnDate) i.e. everything since inception.
        // A transaction dated before its own branch's opening date is excluded entirely —
        // never counted in Opening or Transactions once that branch is configured.
        const bucket = (id: string, txDate: Date, sign: 1 | -1, amount: number, txBranchId: string | null) => {
            const signedAmount = sign * amount;
            const context = txBranchId ? branchContexts.get(txBranchId) : undefined;
            // Once a branch is configured, anything dated before its opening date is
            // out of the picture entirely (neither Opening nor Transactions).
            if (context && txDate < context.openingDate) return;

            let target: 'opening' | 'txn' | null = null;
            if (reportType === 'RANGE') {
                if (txDate < (windowStart as Date)) target = 'opening';
                else if (txDate <= windowEnd) target = 'txn';
            } else if (txDate <= windowEnd) {
                target = 'txn';
            }

            if (target === 'opening') {
                netOpening[id] = (netOpening[id] || 0) + signedAmount;
            } else if (target === 'txn') {
                netTxn[id] = (netTxn[id] || 0) + signedAmount;
                if (sign === 1) grossTxnDr[id] = (grossTxnDr[id] || 0) + amount;
                else grossTxnCr[id] = (grossTxnCr[id] || 0) + amount;
            }
        };

        debitTxns.forEach(tx => {
            if (tx.ledgerId) bucket(tx.ledgerId, tx.transactionDate, 1, Number(tx.amount || 0), resolveTxBranchId(tx));
        });
        ledgerReceiptTxns.forEach(tx => {
            if (tx.ledgerId) bucket(tx.ledgerId, tx.transactionDate, -1, Number(tx.amount || 0), resolveTxBranchId(tx));
        });
        creditTxns.forEach(tx => {
            if (tx.creditLedgerId) bucket(tx.creditLedgerId, tx.transactionDate, -1, Number(tx.amount || 0), resolveTxBranchId(tx));
        });
        // Self-account legs: the two system accounts (Cash in Hand / Bank) merge into their
        // bridged ledger row via the same bucket() logic as any other ledger; every other
        // self account is summed (gross) onto its own synthetic row instead of being dropped.
        const routeSelfLeg = (
            accountId: string | null,
            txDate: Date,
            side: 1 | -1,
            amount: number,
            txBranchId: string | null,
        ) => {
            if (!accountId) return;
            const bridgeLedgerId = selfAccountBridgeLedgerId.get(accountId);
            if (bridgeLedgerId) {
                bucket(bridgeLedgerId, txDate, side, amount, txBranchId);
            } else if (activeSelfAccountIds.has(accountId)) {
                bucketSelfGross(accountId, txDate, side, amount, txBranchId);
            }
        };
        selfDebitTxns.forEach(tx => {
            routeSelfLeg(tx.selfAccountId, tx.transactionDate, 1, Number(tx.amount || 0), resolveTxBranchId(tx));
        });
        selfCreditTxns.forEach(tx => {
            routeSelfLeg(tx.selfAccountId, tx.transactionDate, -1, Number(tx.amount || 0), resolveTxBranchId(tx));
        });
        contraCreditTxns.forEach(tx => {
            routeSelfLeg(tx.contraAccountId, tx.transactionDate, -1, Number(tx.amount || 0), resolveTxBranchId(tx));
        });

        // Seed persisted ledger opening balances — summed across every configured branch
        // in scope (each branch's own row, computed independently above; simply summed
        // here for the "All Branches" aggregate view). Includes bridge ledgers normally —
        // they own the self account's activity too now, so no exclusion is needed here.
        for (const context of branchContexts.values()) {
            for (const [ledgerId, amt] of context.ledgerAmounts) {
                netOpening[ledgerId] = (netOpening[ledgerId] || 0) + amt;
            }
        }

        // Seed persisted self-account opening balances (SelfAccountOpeningBalance) — a
        // system self account that has a bridge ledger folds its opening into that ledger's
        // row; every other self account seeds its own synthetic row's opening.
        for (const context of branchContexts.values()) {
            for (const [selfAccountId, amt] of context.selfAccountAmounts) {
                const bridgeLedgerId = selfAccountBridgeLedgerId.get(selfAccountId);
                if (bridgeLedgerId) {
                    netOpening[bridgeLedgerId] = (netOpening[bridgeLedgerId] || 0) + amt;
                } else {
                    selfOpening[selfAccountId] = (selfOpening[selfAccountId] || 0) + amt;
                }
            }
        }

        // Build full ancestor chain (root → immediate group) for every AccountGroup.
        const allGroups = await prisma.accountGroup.findMany();
        const groupMap = new Map(allGroups.map(g => [g.groupId, g]));
        const getGroupPath = (groupId: string): GroupPathEntry[] => {
            const path: GroupPathEntry[] = [];
            const visited = new Set<string>();
            let current = groupMap.get(groupId);
            while (current && !visited.has(current.groupId)) {
                visited.add(current.groupId);
                path.unshift({ groupId: current.groupId, groupName: current.groupName });
                current = current.parentGroupId ? groupMap.get(current.parentGroupId) : undefined;
            }
            return path.length > 0 ? path : [{ groupId: 'UNCLASSIFIED', groupName: 'UNCLASSIFIED' }];
        };

        // Cash / Bank self accounts belong under Current Assets → Cash|Bank. Resolve the
        // real "Current Assets" group (seeded groupId 'G-ASSET-CUR') so the synthetic
        // sub-node nests under the real Assets tree; the Cash/Bank leaf group is synthetic
        // (the report/export/client all key group nesting off groupName, not groupId, and
        // a same-named real group would simply merge with it).
        const currentAssetsGroup =
            allGroups.find((g) => g.groupId === 'G-ASSET-CUR') ??
            allGroups.find((g) => g.groupName.trim().toLowerCase() === 'current assets');
        const currentAssetsPath: GroupPathEntry[] = currentAssetsGroup
            ? getGroupPath(currentAssetsGroup.groupId)
            : [{ groupId: 'SELF-CA', groupName: 'Current Assets' }];
        const selfGroupPath = (t: 'CASH' | 'BANK'): GroupPathEntry[] => [
            ...currentAssetsPath,
            { groupId: `SELF-GRP-${t}`, groupName: t === 'CASH' ? 'Cash' : 'Bank' },
        ];
        const cashInHandName = GL_SELF_ACCOUNT_NAMES.CASH_IN_HAND.trim().toLowerCase();
        const bridgeLedgerIds = new Set(selfBridges.allBridgeLedgerIds);

        const allLedgers = await prisma.accountLedger.findMany({
            include: { group: true },
            where: { isActive: true },
        });

        const rows: TrialBalanceRow[] = [];

        allLedgers.forEach(ledger => {
            const opening = netOpening[ledger.id] || 0;
            const txn = netTxn[ledger.id] || 0;
            const txnDr = grossTxnDr[ledger.id] || 0;
            const txnCr = grossTxnCr[ledger.id] || 0;
            const closing = opening + txn;

            // Suppress a ledger only when it genuinely has nothing to report in this view:
            // no opening balance AND no debit or credit movement in the period. A ledger
            // with equal debits and credits (net zero) is still shown, per "don't hide a
            // ledger merely because its net balance is zero".
            if (Math.abs(opening) <= 0.005 && txnDr <= 0.005 && txnCr <= 0.005) return;

            // A "Cash in Hand" / "Bank" bridge ledger carries its self account's folded
            // activity — display it under Current Assets → Cash|Bank regardless of which
            // chart-of-accounts group it was physically filed in.
            const groupPath = bridgeLedgerIds.has(ledger.id)
                ? selfGroupPath(ledger.ledgerName.trim().toLowerCase() === cashInHandName ? 'CASH' : 'BANK')
                : ledger.group
                    ? getGroupPath(ledger.group.groupId)
                    : [{ groupId: 'UNCLASSIFIED', groupName: 'UNCLASSIFIED' }];

            rows.push({
                groupPath,
                ledgerCode: ledger.ledgerId,
                ledgerName: ledger.ledgerName,
                openingDebit: opening > 0 ? opening : 0,
                openingCredit: opening < 0 ? Math.abs(opening) : 0,
                txnDebit: txnDr,
                txnCredit: txnCr,
                closingDebit: closing > 0 ? closing : 0,
                closingCredit: closing < 0 ? Math.abs(closing) : 0,
            });
        });

        // One row per non-system self account, always shown (even with no activity — "any
        // account created in Self Accounts must appear in the Trial Balance"). Gross Dr/Cr
        // come straight from its own transaction legs; opening = configured
        // SelfAccountOpeningBalance (seeded above, both modes) + the pre-window transaction
        // net (RANGE only).
        activeSelfAccounts.forEach((sa) => {
            if (bridgeSelfAccountIds.has(sa.id)) return; // shown as its bridge-ledger row above
            const type: 'CASH' | 'BANK' =
                sa.type ??
                (sa.name.trim().toLowerCase() === GL_SELF_ACCOUNT_NAMES.BANK.trim().toLowerCase() ? 'BANK' : 'CASH');
            const opening = selfOpening[sa.id] || 0;
            const txnDr = selfTxnDr[sa.id] || 0;
            const txnCr = selfTxnCr[sa.id] || 0;
            const closing = opening + txnDr - txnCr;
            rows.push({
                groupPath: selfGroupPath(type),
                ledgerCode: '',
                ledgerName: sa.name,
                openingDebit: opening > 0 ? opening : 0,
                openingCredit: opening < 0 ? Math.abs(opening) : 0,
                txnDebit: txnDr,
                txnCredit: txnCr,
                closingDebit: closing > 0 ? closing : 0,
                closingCredit: closing < 0 ? Math.abs(closing) : 0,
            });
        });

        rows.sort((a, b) => {
            const len = Math.max(a.groupPath.length, b.groupPath.length);
            for (let i = 0; i < len; i++) {
                const an = a.groupPath[i]?.groupName ?? '';
                const bn = b.groupPath[i]?.groupName ?? '';
                if (an !== bn) return an.localeCompare(bn);
            }
            return a.ledgerName.localeCompare(b.ledgerName);
        });

        return rows;
}

export async function GET(req: NextRequest) {
    return withRole(['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'], async (request, user) => {
    try {
        const { searchParams } = new URL(request.url);
        const reportType = (searchParams.get('reportType') || 'AS_ON') as 'RANGE' | 'AS_ON';
        const fromDateStr = searchParams.get('fromDate');
        const toDateStr = searchParams.get('toDate');
        const asOnDateStr = searchParams.get('asOnDate');
        const branchIdParam = searchParams.get('branchId');
        // viewType (Condensed/Detailed) is intentionally not read here — the full field
        // set is always computed/returned and the client chooses which columns to render.

        if (reportType === 'RANGE' && (!fromDateStr || !toDateStr)) {
            return errorResponse('fromDate and toDate are required for range reports', 400);
        }
        if (reportType === 'AS_ON' && !asOnDateStr) {
            return errorResponse('asOnDate is required for as-on-date reports', 400);
        }

        const scopedBranchIds = await resolveScopedBranchIds(user, branchIdParam ?? null);
        const rows = await computeTrialBalanceRows({ reportType, fromDateStr, toDateStr, asOnDateStr, scopedBranchIds });

        return successResponse({ rows });
    } catch (error: any) {
        console.error('Trial Balance error:', error);
        return errorResponse(error.message || 'Failed to fetch trial balance data', 500);
    }
    })(req);
}
