import { NextRequest } from 'next/server';
import { handleCorsPreflight, errorResponse, successResponse, withRole } from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { assertBranchNotLocked } from '@/app/lib/branch-lock';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';
import { getBranchOpeningContext } from '@/app/lib/services/ledger-opening-balance';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/admin-reports/account/compare-ilgl
 * Compares the Individual Ledger (IL) sums from LoanTransactions
 * against the General Ledger (GL) sums from FinancialTransactions
 */
export async function GET(request: NextRequest) {
    return withRole(['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER'], async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const dateStr = searchParams.get('date');
            const branchId = searchParams.get('branchId') || request.headers.get('X-Branch-Id');

            if (!dateStr) {
                return errorResponse('Comparison date is required', 400);
            }
            if (!branchId) {
                return errorResponse('Branch ID is required', 400);
            }

            // Multi-tenancy boundary — never trust the header alone; confirm this
            // caller is actually permitted to see this branch's GL/IL reconciliation.
            const permittedBranchIds = await getPermittedBranchIds(user);
            if (permittedBranchIds !== null && !permittedBranchIds.includes(branchId)) {
                return errorResponse('You do not have access to this branch', 403);
            }

            // Create cutoff date (End of the selected day)
            const cutoffDate = new Date(dateStr);
            cutoffDate.setHours(23, 59, 59, 999);

            // GL side only — per product decision, the matching Loan Transaction (IL) side
            // below intentionally stays since-inception/unbridged even when this branch has
            // a configured opening balance, so `difference` may show a persistent gap for
            // matched ledgers once one is set. That's expected, not a bug.
            const branchContexts = await getBranchOpeningContext([branchId]);
            const rawContext = branchContexts.get(branchId);
            // This report reconciles ledger vs loan-transaction balances — only a LEDGER-side
            // opening config is relevant (a branch that configured only self-account opening
            // balances must still behave as unbridged here, exactly as before).
            const openingContext = rawContext && rawContext.ledgerAmounts.size > 0 ? rawContext : undefined;
            const glDateFilter = openingContext
                ? { gte: openingContext.openingDate, lte: cutoffDate }
                : { lte: cutoffDate };

            // 1. Calculate General Ledger aggregates via FinancialTransactions
            // We group by ledgerId
            const glTransactions = await prisma.financialTransaction.groupBy({
                by: ['ledgerId'],
                where: {
                    isActive: true,
                    approvalStatus: 'APPROVED' as any,
                    transactionDate: glDateFilter,
                    createdBy: {
                        branchId: branchId
                    }
                },
                _sum: {
                    amount: true
                }
            });

            const glCreditTransactions = await prisma.financialTransaction.groupBy({
                by: ['creditLedgerId'],
                where: {
                    isActive: true,
                    approvalStatus: 'APPROVED' as any,
                    transactionDate: glDateFilter,
                    createdBy: {
                        branchId: branchId
                    },
                    creditLedgerId: {
                        not: null
                    }
                },
                _sum: {
                    amount: true
                }
            });

            // Flatten GL balances by Ledger ID
            const glBalances: Record<string, number> = {};

            // Debits
            for (const txn of glTransactions) {
                if (txn.ledgerId) {
                    glBalances[txn.ledgerId] = (glBalances[txn.ledgerId] || 0) + Number(txn._sum.amount || 0);
                }
            }

            // Credits
            for (const txn of glCreditTransactions) {
                if (txn.creditLedgerId) {
                    glBalances[txn.creditLedgerId] = (glBalances[txn.creditLedgerId] || 0) - Number(txn._sum.amount || 0);
                }
            }

            // Seed each ledger's configured opening balance on top of the (now truncated)
            // transaction sums above — same pattern as every other report. Decision 1: once
            // the branch is configured, this applies to every ledger, including ones with no
            // row of their own (0 seed) and ones with zero truncated transactions (adds a new
            // key here, which the results loop below picks up like any other GL balance).
            if (openingContext) {
                for (const [ledgerId, amt] of openingContext.ledgerAmounts) {
                    glBalances[ledgerId] = (glBalances[ledgerId] || 0) + amt;
                }
            }

            // 2. Fetch Ledger Names to map the IDs back to human-readable names
            const ledgerIds = Object.keys(glBalances);
            const ledgers = await prisma.accountLedger.findMany({
                where: {
                    id: { in: ledgerIds }
                }
            });

            const ledgerMap: Record<string, string> = {};
            ledgers.forEach(l => {
                ledgerMap[l.id] = l.ledgerName;
            });


            // 3. Calculate Individual Ledger (IL) Aggregates from LoanTransactions
            const ilTransactions = await prisma.loanTransaction.aggregate({
                where: {
                    branchId,
                    transactionDate: { lte: cutoffDate },
                    isReversed: false
                },
                _sum: {
                    principalAmount: true,
                    interestAmount: true,
                    feesAmount: true,
                    penaltyAmount: true,
                    amount: true
                }
            });

            // 4. Draft the Reconciled Array Response
            // In a mature MFI, you will likely map these implicitly using specific mapped ledger IDs.
            // Since k3-microfinance dynamically assigns Ledgers, we'll try to match by name or return IL as discrete line items.

            const results = [];

            // A) Map General Ledgers found in FinancialTransactions
            for (const [ledgerId, tbAmount] of Object.entries(glBalances)) {
                const ledgerName = ledgerMap[ledgerId] || 'Unknown Ledger';
                let ilAmount = 0;

                // Match IL to GL (Hardcoded matching logic based on MFI standard names)
                // In production, this should ideally be driven by a Mapping Table.
                const nameUpper = ledgerName.toUpperCase();

                if (nameUpper.includes('PRINCIPAL') || nameUpper.includes('LOAN RECEIVABLE')) {
                    ilAmount = Number(ilTransactions._sum.principalAmount || 0);
                } else if (nameUpper.includes('INTEREST')) {
                    ilAmount = Number(ilTransactions._sum.interestAmount || 0);
                } else if (nameUpper.includes('FEE') || nameUpper.includes('DOCUMENT')) {
                    ilAmount = Number(ilTransactions._sum.feesAmount || 0);
                } else if (nameUpper.includes('PENALTY')) {
                    ilAmount = Number(ilTransactions._sum.penaltyAmount || 0);
                } else {
                    // It's a non-portfolio GL (e.g. Office Rent), IL is naturally 0 or equal to TB logically for comparison
                    ilAmount = tbAmount;
                }

                results.push({
                    ledger: ledgerName,
                    tb: tbAmount,
                    il: ilAmount,
                    difference: tbAmount - ilAmount
                });
            }

            // Optional: If there are ZERO GL entries for Principal, but there are IL transactions, we should flag it!
            const hasPrincipalLedger = results.some(r => r.ledger.toUpperCase().includes('PRINCIPAL') || r.ledger.toUpperCase().includes('LOAN RECEIVABLE'));
            if (!hasPrincipalLedger && Number(ilTransactions._sum.principalAmount || 0) > 0) {
                const ilAmt = Number(ilTransactions._sum.principalAmount || 0);
                results.push({
                    ledger: 'LOAN PORTFOLIO PRINCIPAL (Missing GL mapping)',
                    tb: 0,
                    il: ilAmt,
                    difference: 0 - ilAmt
                });
            }

            const hasInterestLedger = results.some(r => r.ledger.toUpperCase().includes('INTEREST'));
            if (!hasInterestLedger && Number(ilTransactions._sum.interestAmount || 0) > 0) {
                const ilAmt = Number(ilTransactions._sum.interestAmount || 0);
                results.push({
                    ledger: 'INTEREST INCOME (Missing GL mapping)',
                    tb: 0,
                    il: ilAmt,
                    difference: 0 - ilAmt
                });
            }

            return successResponse(results, 'Comparison generated successfully');

        } catch (error) {
            console.error('[Compare IL/GL API] Error:', error);
            return errorResponse('Failed to generate comparison. Please contact support.', 500);
        }
    })(request);
}
