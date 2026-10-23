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
                return NextResponse.json({ success: true, data: { accountName: '', openingBalance: 0, closingBalance: 0, transactions: [] } });
            }
            if (!permitted.includes(requestedType)) {
                type = permitted[0];
            }
        }

        const accountId = searchParams.get('accountId');
        const startDateParam = searchParams.get('startDate');
        const endDateParam = searchParams.get('endDate');

        // Validation
        if (!startDateParam || !endDateParam || !accountId) {
            return NextResponse.json(
                { success: false, message: 'Start Date, End Date and Account are required.' },
                { status: 400 }
            );
        }

        const startDate = new Date(startDateParam);
        const endDate = new Date(endDateParam);
        endDate.setHours(23, 59, 59, 999);

        // Resolve branch scope for this view — null (consolidated) means unrestricted.
        let branchIds: string[] | null = null;
        if (type === 'head_office') {
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
                return NextResponse.json({
                    success: true,
                    data: {
                        accountName: '',
                        openingBalance: 0,
                        closingBalance: 0,
                        transactions: []
                    }
                });
            }
            branchIds = [headOfficeBranch.id];
        } else if (type !== 'consolidated') {
            // A specific branchId (e.g. a non-admin forced to their own/assigned branch above)
            branchIds = [type];
        }

        const result = await computeGlOneAccount(accountId, startDate, endDate, branchIds);
        if (!result) {
            return NextResponse.json({ success: false, message: 'Account not found.' }, { status: 404 });
        }

        return NextResponse.json({ success: true, data: result });

    } catch (error: any) {
        console.error("Error fetching GL One:", error);
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
 * directly with an already-resolved `branchIds` (null = consolidated/unrestricted, same
 * contract as computeGlAllAccounts() in app/api/reports/gl-all/route.ts). Returns null when
 * the accountId matches neither a ledger nor a self account.
 */
export async function computeGlOneAccount(accountId: string, startDate: Date, endDate: Date, branchIds: string[] | null) {
        // Fetch Account Details (Try Ledger first, then Self)
        let accountName = '';
        let isSelfAccount = false;

        const ledger = await prisma.accountLedger.findUnique({
            where: { id: accountId },
            select: { ledgerName: true }
        });

        if (ledger) {
            accountName = ledger.ledgerName;
        } else {
            const selfAccount = await prisma.selfAccount.findUnique({
                where: { id: accountId },
                select: { name: true }
            });
            if (selfAccount) {
                accountName = selfAccount.name;
                isSelfAccount = true;
            } else {
                return null;
            }
        }

        // Build Where Clause — only APPROVED transactions affect GL reports
        const whereClause: any = {
            isActive: true,
            approvalStatus: 'APPROVED',
            transactionDate: {
                lte: endDate,
            },
            OR: [
                { ledgerId: isSelfAccount ? undefined : accountId },
                { selfAccountId: isSelfAccount ? accountId : undefined }
            ],
            // Explicit FinancialTransaction.branchId (with legacy createdBy fallback) —
            // matches Day Book/Receipts & Payments/Trial Balance's scoping so all reports
            // agree on which branch a transaction belongs to.
            ...buildFinancialTransactionBranchScope({ branchId: branchIds ?? undefined }),
        };

        // Filter out undefined OR conditions
        whereClause.OR = whereClause.OR.filter((c: any) => Object.values(c)[0] !== undefined);

        // Per-branch opening-balance context (never blended across branches) + the
        // Cash in Hand / Bank self-account bridge, resolved once (unconditionally — needed
        // below even for a ledger account, to detect "this ledger IS a bridge ledger").
        const branchContexts = await getBranchOpeningContext(branchIds);
        const bridges = await resolveSelfAccountBridges();
        let bridgeLedgerIdForAccount: string | null = null;
        if (isSelfAccount) {
            if (bridges.cashInHand?.selfAccountId === accountId) bridgeLedgerIdForAccount = bridges.cashInHand.bridgeLedgerId;
            else if (bridges.bank?.selfAccountId === accountId) bridgeLedgerIdForAccount = bridges.bank.bridgeLedgerId;
        }
        // A bridge ledger's opening amount is owned by its self-account representation
        // (Trial Balance / GL All seed it there, not on the ledger row) — if this GL One
        // view was opened directly on a raw ledger sharing that name (e.g. one of possibly
        // several ledgers named "Cash in Hand"), it must NOT also claim the configured
        // amount, or the two reports would disagree on the same account (rule #11).
        const bridgeLedgerIds = new Set(bridges.allBridgeLedgerIds);

        const resolveTxBranchId = (tx: { branchId: string | null; createdBy: { branchId: string | null } | null }): string | null =>
            tx.branchId ?? tx.createdBy?.branchId ?? null;

        // This account's configured opening amount for a given branch context — null when
        // that branch isn't configured (or, for a self account, has no bridge ledger yet, or
        // this is a bridge ledger viewed directly rather than via its self account), 0 when
        // configured but this specific account was never given its own row.
        const configuredAmountFor = (context: BranchOpeningContext | undefined): number | null => {
            if (!context) return null;
            if (!isSelfAccount && bridgeLedgerIds.has(accountId)) return null;
            if (isSelfAccount) {
                // Direct SelfAccountOpeningBalance row wins; legacy name→ledger bridge is the fallback.
                return selfAccountOpeningAmount(context, accountId, bridgeLedgerIdForAccount);
            }
            return context.ledgerAmounts.get(accountId) ?? 0;
        };

        const transactions = await prisma.financialTransaction.findMany({
            where: whereClause,
            include: {
                ledger: { select: { ledgerName: true } },
                selfAccount: { select: { name: true } },
                createdBy: { select: { branchId: true } },
            },
            orderBy: { transactionDate: 'asc' },
        });

        // Calculate Balances
        let openingBalance = 0;
        let runningBalance = 0;
        const resultTransactions: any[] = [];

        transactions.forEach(tx => {
            const amount = Number(tx.amount);
            const txDate = new Date(tx.transactionDate);
            const context = branchContexts.get(resolveTxBranchId(tx) ?? '');
            const configuredAmount = configuredAmountFor(context);

            // Once this account's branch is configured, transactions before the branch's
            // opening date are excluded entirely — never shown in Opening or in the list.
            if (configuredAmount !== null && txDate < context!.openingDate) return;

            const isBeforeStart = txDate < startDate;
            const txDateStr = toDisplayDate(txDate);

            let debit = 0;
            let credit = 0;
            let particulars = '';

            // Determine Impact
            if (isSelfAccount) {
                // Self Account Logic
                if (tx.type === 'BANK_RECEIPT' || tx.type === 'CASH_RECEIPT') {
                    debit = amount;
                    particulars = tx.ledger?.ledgerName || 'Unknown Payer'; // Received from Ledger
                } else if (tx.type === 'BANK_PAYMENT' || tx.type === 'CASH_PAYMENT') {
                    credit = amount;
                    particulars = tx.ledger?.ledgerName || 'Unknown Payee'; // Paid to Ledger
                }
            } else {
                // Ledger Account Logic
                if (tx.type === 'BANK_RECEIPT' || tx.type === 'CASH_RECEIPT') {
                    credit = amount; // Ledger gave money
                    particulars = tx.selfAccount?.name || 'Cash/Bank'; // Into Self Account
                } else if (tx.type === 'BANK_PAYMENT' || tx.type === 'CASH_PAYMENT') {
                    debit = amount; // Ledger received money
                    particulars = tx.selfAccount?.name || 'Cash/Bank'; // From Self Account
                }
            }

            // Apply to Opening Balance or Transaction List
            if (isBeforeStart) {
                openingBalance += (debit - credit);
            } else {
                // Running Balance (will be adjusted relative to opening later)
                resultTransactions.push({
                    date: txDateStr,
                    type: debit > 0 ? 'DR' : 'CR',
                    particulars: particulars, // TODO: Enhance with specific descriptions if available
                    description: tx.description || tx.type.replace('_', ' '),
                    debit,
                    credit,
                    voucherNo: tx.voucherNo,
                    // balance calculated below
                });
            }
        });

        // Seed the configured opening amount once per branch (not per transaction) —
        // summed across every branch in scope, same aggregation shape as Trial Balance's
        // "All Branches" view.
        for (const context of branchContexts.values()) {
            const amt = configuredAmountFor(context);
            if (amt !== null) openingBalance += amt;
        }

        // Apply Opening Balance and Calculate Running Balance
        runningBalance = openingBalance;
        const finalTransactions = resultTransactions.map(tx => {
            runningBalance += (tx.debit - tx.credit);
            return { ...tx, balance: runningBalance };
        });

        return {
            accountName,
            openingBalance,
            closingBalance: runningBalance,
            transactions: finalTransactions
        };
}
