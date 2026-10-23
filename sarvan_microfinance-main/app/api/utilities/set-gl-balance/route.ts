import { NextRequest } from 'next/server';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { format } from 'date-fns';
import {
    GL_LEDGER_NAMES,
    GL_DEFAULT_GROUPS,
    resolveOrCreateLedger,
    resolveSelfAccount,
    getNextVoucherNo,
    mapPaymentModeToGL,
} from '@/app/lib/gl-config';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * POST /api/utilities/set-gl-balance
 * ───────────────────────────────────
 * Batch GL Sync: Aggregates all unsynced LoanTransactions and posts
 * consolidated double-entry journal entries into FinancialTransaction.
 *
 * This bridges the gap between IL (Individual Ledger / Loan operations)
 * and GL (General Ledger / Accounting), ensuring that all downstream
 * reports (Trial Balance, GL-All, Daybook, Compare IL/GL) reflect
 * the true financial position of the company.
 *
 * Idempotent: Safe to run multiple times. Only processes transactions
 * where isGlSynced = false.
 */
export async function POST(request: NextRequest) {
    return withRole(['ADMIN'], async (req, user) => {
        try {
            const syncStartTime = Date.now();
            const batchId = `GLSYNC-${format(new Date(), 'yyMMdd-HHmmss')}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;

            console.log(`[GL Sync] Starting batch: ${batchId}`);

            // ─── Execute the entire sync in a single ACID transaction ───
            const result = await prisma.$transaction(async (tx) => {

                // ─── Step 1: Check if there are any unsynced transactions ───
                // PRECLOSURE/WRITEOFF are excluded — they're now owned by the "Allocate for EOD"
                // path (postEodClosureAllocation), gated by eodAllocatedAt, not isGlSynced. Without
                // this exclusion, this legacy batch tool would post a second voucher for a
                // PRECLOSURE row the new path already posted.
                const unsyncedCount = await tx.loanTransaction.count({
                    where: { isGlSynced: false, isReversed: false, type: { notIn: ['PRECLOSURE', 'WRITEOFF'] } },
                });

                if (unsyncedCount === 0) {
                    return {
                        status: 'NO_DATA',
                        message: 'No new transactions to sync. GL is already up to date.',
                        batchId,
                        txnCount: 0,
                        vouchersCreated: 0,
                        summary: null,
                    };
                }

                console.log(`[GL Sync] Found ${unsyncedCount} unsynced transactions`);

                // ─── Step 2: Aggregate unsynced transactions ───
                // Group by (branchId, type, paymentMode) to create branch-correct consolidated entries.
                // This is critical because downstream branch reports must not depend on `createdBy.branchId`
                // (centralized postings are usually created by HO/Admin users).
                const aggregations = await tx.loanTransaction.groupBy({
                    by: ['branchId', 'type', 'paymentMode'],
                    where: {
                        isGlSynced: false,
                        isReversed: false,
                        type: { notIn: ['PRECLOSURE', 'WRITEOFF'] },
                    },
                    _sum: {
                        amount: true,
                        principalAmount: true,
                        interestAmount: true,
                        feesAmount: true,
                        penaltyAmount: true,
                    },
                    _count: {
                        id: true,
                    },
                });

                console.log(`[GL Sync] Aggregated into ${aggregations.length} groups`);

                // ─── Step 3: Resolve all required ledger & self-account IDs ───
                const loanPortfolioLedgerId = await resolveOrCreateLedger(
                    tx, GL_LEDGER_NAMES.LOAN_PORTFOLIO, GL_DEFAULT_GROUPS.ASSETS
                );
                const interestIncomeLedgerId = await resolveOrCreateLedger(
                    tx, GL_LEDGER_NAMES.INTEREST_INCOME, GL_DEFAULT_GROUPS.INCOME
                );
                const feeIncomeLedgerId = await resolveOrCreateLedger(
                    tx, GL_LEDGER_NAMES.FEE_INCOME, GL_DEFAULT_GROUPS.INCOME
                );
                const penaltyIncomeLedgerId = await resolveOrCreateLedger(
                    tx, GL_LEDGER_NAMES.PENALTY_INCOME, GL_DEFAULT_GROUPS.INCOME
                );

                // ─── Step 4: Create consolidated FinancialTransaction entries ───
                let vouchersCreated = 0;
                const now = new Date();
                let totalDisbursements = 0;
                let totalCollections = 0;
                let totalPrincipal = 0;
                let totalInterest = 0;
                let totalFees = 0;
                let totalPenalties = 0;

                for (const agg of aggregations) {
                    const principal = Number(agg._sum.principalAmount || 0);
                    const interest = Number(agg._sum.interestAmount || 0);
                    const fees = Number(agg._sum.feesAmount || 0);
                    const penalties = Number(agg._sum.penaltyAmount || 0);
                    const totalAmount = Number(agg._sum.amount || 0);
                    // PRECLOSURE rows never reach this loop now (excluded by the where-filter
                    // above) — narrowed for clarity, not the functional fix.
                    const isCollection = agg.type === 'REPAYMENT';
                    const isDisbursement = agg.type === 'DISBURSEMENT';

                    // Map paymentMode to GL type (Cash vs Bank)
                    const glMapping = mapPaymentModeToGL(agg.paymentMode, isCollection);
                    const selfAccountId = await resolveSelfAccount(tx, glMapping.selfAccountName);
                    const transactionType = glMapping.transactionType;
                    const voucherPrefix = glMapping.voucherPrefix;

                    // Build description for audit
                    const typeLabel = agg.type.replace('_', ' ');
                    const modeLabel = agg.paymentMode.replace('_', ' ');
                    const descriptionBase = `[GL Sync ${batchId}] ${typeLabel} via ${modeLabel} (${agg._count.id} txns)`;

                    if (isCollection) {
                        totalCollections += totalAmount;

                        // ── A. Principal Recovery ──
                        // Collection creates: Debit Cash/Bank, Credit Loan Portfolio (reduces asset)
                        if (principal > 0) {
                            const voucherNo = await getNextVoucherNo(tx, voucherPrefix);
                            await tx.financialTransaction.create({
                                data: {
                                    voucherNo,
                                    transactionDate: now,
                                    type: transactionType as any,
                                    branchId: agg.branchId,
                                    selfAccountId,
                                    ledgerId: loanPortfolioLedgerId,
                                    amount: principal,
                                    description: `${descriptionBase} — Principal Recovery`,
                                    createdById: user.userId,
                                },
                            });
                            vouchersCreated++;
                            totalPrincipal += principal;
                        }

                        // ── B. Interest Income ──
                        if (interest > 0) {
                            const voucherNo = await getNextVoucherNo(tx, voucherPrefix);
                            await tx.financialTransaction.create({
                                data: {
                                    voucherNo,
                                    transactionDate: now,
                                    type: transactionType as any,
                                    branchId: agg.branchId,
                                    selfAccountId,
                                    ledgerId: interestIncomeLedgerId,
                                    amount: interest,
                                    description: `${descriptionBase} — Interest Income`,
                                    createdById: user.userId,
                                },
                            });
                            vouchersCreated++;
                            totalInterest += interest;
                        }

                        // ── C. Fee Income ──
                        if (fees > 0) {
                            const voucherNo = await getNextVoucherNo(tx, voucherPrefix);
                            await tx.financialTransaction.create({
                                data: {
                                    voucherNo,
                                    transactionDate: now,
                                    type: transactionType as any,
                                    branchId: agg.branchId,
                                    selfAccountId,
                                    ledgerId: feeIncomeLedgerId,
                                    amount: fees,
                                    description: `${descriptionBase} — Fee Income`,
                                    createdById: user.userId,
                                },
                            });
                            vouchersCreated++;
                            totalFees += fees;
                        }

                        // ── D. Penalty Income ──
                        if (penalties > 0) {
                            const voucherNo = await getNextVoucherNo(tx, voucherPrefix);
                            await tx.financialTransaction.create({
                                data: {
                                    voucherNo,
                                    transactionDate: now,
                                    type: transactionType as any,
                                    branchId: agg.branchId,
                                    selfAccountId,
                                    ledgerId: penaltyIncomeLedgerId,
                                    amount: penalties,
                                    description: `${descriptionBase} — Penalty Income`,
                                    createdById: user.userId,
                                },
                            });
                            vouchersCreated++;
                            totalPenalties += penalties;
                        }

                    } else if (isDisbursement) {
                        totalDisbursements += totalAmount;

                        // Disbursement creates: Debit Loan Portfolio (asset increases), Credit Cash/Bank
                        // In FinancialTransaction terms: type = CASH/BANK_PAYMENT
                        // Payment: selfAccount is credited (money goes out), ledger is debited (asset created)
                        if (totalAmount > 0) {
                            const paymentMapping = mapPaymentModeToGL(agg.paymentMode, false);
                            const paymentSelfAccountId = await resolveSelfAccount(tx, paymentMapping.selfAccountName);
                            const paymentVoucherPrefix = paymentMapping.voucherPrefix;

                            const voucherNo = await getNextVoucherNo(tx, paymentVoucherPrefix);
                            await tx.financialTransaction.create({
                                data: {
                                    voucherNo,
                                    transactionDate: now,
                                    type: paymentMapping.transactionType as any,
                                    branchId: agg.branchId,
                                    selfAccountId: paymentSelfAccountId,
                                    ledgerId: loanPortfolioLedgerId,
                                    amount: totalAmount,
                                    description: `${descriptionBase} — Loan Disbursement`,
                                    createdById: user.userId,
                                },
                            });
                            vouchersCreated++;
                            totalPrincipal += totalAmount;
                        }
                    }
                    // Other types (WRITEOFF, ADJUSTMENT, etc.) can be handled here
                    // as the system evolves — future-proof extensibility point
                }

                console.log(`[GL Sync] Created ${vouchersCreated} vouchers`);

                // ─── Step 5: Mark all loan transactions as synced ───
                // Excludes PRECLOSURE/WRITEOFF — see Step 1's comment. Leaving these rows
                // isGlSynced:false forever post-cutover is intentional: eodAllocatedAt is their
                // sole source of truth now, not this legacy flag.
                await tx.loanTransaction.updateMany({
                    where: {
                        isGlSynced: false,
                        isReversed: false,
                        type: { notIn: ['PRECLOSURE', 'WRITEOFF'] },
                    },
                    data: {
                        isGlSynced: true,
                        glSyncedAt: now,
                        glSyncBatchId: batchId,
                    },
                });

                console.log(`[GL Sync] Marked ${unsyncedCount} transactions as synced`);

                // ─── Step 6: Create audit log ───
                await tx.gLSyncLog.create({
                    data: {
                        batchId,
                        syncedById: user.userId,
                        totalDisbursements,
                        totalCollections,
                        totalPrincipal,
                        totalInterest,
                        totalFees,
                        totalPenalties,
                        txnCount: unsyncedCount,
                        vouchersCreated,
                        status: 'COMPLETED',
                        remarks: `Synced ${unsyncedCount} transactions into ${vouchersCreated} GL vouchers`,
                    },
                });

                return {
                    status: 'SUCCESS',
                    message: `GL Balance set successfully. ${unsyncedCount} transactions synced into ${vouchersCreated} vouchers.`,
                    batchId,
                    txnCount: unsyncedCount,
                    vouchersCreated,
                    summary: {
                        collections: {
                            principal: totalPrincipal,
                            interest: totalInterest,
                            fees: totalFees,
                            penalties: totalPenalties,
                            total: totalCollections,
                        },
                        disbursements: {
                            total: totalDisbursements,
                        },
                    },
                };
            }, {
                // Increase timeout for large datasets (default is 5s)
                timeout: 60000,
            });

            const elapsed = Date.now() - syncStartTime;
            console.log(`[GL Sync] Completed in ${elapsed}ms: ${result.message}`);

            return successResponse(result, result.message);

        } catch (error) {
            console.error('[GL Sync] FATAL ERROR:', error);
            return errorResponse(
                'Failed to set GL Balance. Please try again or contact support.',
                500
            );
        }
    })(request);
}

/**
 * GET /api/utilities/set-gl-balance
 * Returns the current sync status — how many transactions are pending sync,
 * and the last sync details.
 */
export async function GET(request: NextRequest) {
    return withRole(['ADMIN'], async (req, user) => {
        try {
            const [unsyncedCount, lastSync, totalSynced] = await Promise.all([
                prisma.loanTransaction.count({
                    where: { isGlSynced: false, isReversed: false, type: { notIn: ['PRECLOSURE', 'WRITEOFF'] } },
                }),
                prisma.gLSyncLog.findFirst({
                    orderBy: { syncDate: 'desc' },
                }),
                prisma.loanTransaction.count({
                    where: { isGlSynced: true },
                }),
            ]);

            return successResponse({
                pendingTransactions: unsyncedCount,
                totalSyncedTransactions: totalSynced,
                lastSync: lastSync ? {
                    batchId: lastSync.batchId,
                    syncDate: lastSync.syncDate,
                    txnCount: lastSync.txnCount,
                    vouchersCreated: lastSync.vouchersCreated,
                    totalCollections: Number(lastSync.totalCollections),
                    totalDisbursements: Number(lastSync.totalDisbursements),
                    status: lastSync.status,
                } : null,
            }, 'GL sync status fetched successfully');
        } catch (error) {
            console.error('[GL Sync] Error fetching status:', error);
            return errorResponse('Failed to fetch GL sync status', 500);
        }
    })(request);
}
