import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { withAuth, errorResponse, successResponse, handleCorsPreflight } from '@/app/lib/api-utils';
import type { ParsedLoanCardReport, ParsedRepaymentReport } from '@/app/lib/services/uploan-loan-history.service';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/ongoing-loan-backup/eligible-clients?groupId={groupId}
 * Get clients who are eligible for ongoing loan backup:
 * - VERIFIED status
 * - isActive = true
 * - No existing DISBURSED loan that went through the live indexation/disbursement
 *   workflow (indexId set) — those clients are fully off-limits to this tool.
 *
 * A client who already has a backup-imported loan (DISBURSED, indexId still null —
 * e.g. created via the Member upload bulk import) is still included, with
 * `hasBackup: true` + `existingBackup` (pre-fills the edit form) + `history` (a
 * read-only reconstruction of the migrated Loan Card schedule + Repayment events,
 * from the real LoanSchedule/LoanTransaction rows) so the admin can review — and
 * still edit/update — what was already migrated instead of it silently vanishing
 * from the list.
 */
export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const { searchParams } = new URL(request.url);
            const groupId = searchParams.get('groupId');

            if (!groupId) {
                return errorResponse('Group ID is required', 400);
            }

            // Step 1: Fetch all group members
            const groupMembers = await prisma.groupMember.findMany({
                where: { groupId },
                include: {
                    client: {
                        select: {
                            id: true,
                            clientId: true,
                            firstName: true,
                            lastName: true,
                            verificationStatus: true,
                            isActive: true,
                        },
                    },
                },
            });

            // Step 2: Filter to VERIFIED + isActive clients
            const eligibleClients = groupMembers
                .filter(
                    (gm) =>
                        gm.client.verificationStatus === 'VERIFIED' &&
                        gm.client.isActive === true
                )
                .map((gm) => gm.client);

            if (eligibleClients.length === 0) {
                return successResponse([], 'No eligible clients found in this group');
            }

            const clientIds = eligibleClients.map((c) => c.id);

            // Step 3: Fetch every DISBURSED+active loan for these clients, with enough
            // detail to reconstruct a read-only history view for backup loans.
            const disbursedLoans = await prisma.loan.findMany({
                where: {
                    clientId: { in: clientIds },
                    disbursementStatus: 'DISBURSED',
                    isActive: true,
                },
                select: {
                    id: true,
                    clientId: true,
                    indexId: true,
                    loanNumber: true,
                    amount: true,
                    interestRate: true,
                    frequency: true,
                    disbursedByBMAt: true,
                    firstDueDate: true,
                    funderId: true,
                    principalPaid: true,
                    interestPaid: true,
                    savingsPaid: true,
                    loanProductId: true,
                    loanPurposeId: true,
                    loanProduct: { select: { loanProductTypeId: true } },
                    loanPurpose: { select: { loanPurposeTypeId: true } },
                    funder: { select: { funderName: true } },
                    createdBy: { select: { firstName: true, lastName: true } },
                    goldLoanDetail: { select: { karatType: true, gramCount: true, cashGiven: true } },
                    schedules: { orderBy: { installmentNo: 'asc' } },
                    transactions: {
                        where: { isReversed: false },
                        orderBy: { transactionDate: 'asc' },
                        include: { lines: { select: { installmentNo: true } } },
                    },
                },
            });

            // Step 4: Split into "live" (went through real indexation/disbursement — off
            // limits to this tool) vs "backup" (this tool's own import, indexId still null).
            const liveLoanClientIds = new Set(disbursedLoans.filter((l) => l.indexId !== null).map((l) => l.clientId));
            const backupLoanByClientId = new Map(disbursedLoans.filter((l) => l.indexId === null).map((l) => [l.clientId, l]));

            // Step 5: Drop clients on a live loan — nothing this tool can do for them.
            const eligibleClientsOnly = eligibleClients.filter((client) => !liveLoanClientIds.has(client.id));

            if (eligibleClientsOnly.length === 0) {
                return successResponse([], 'No eligible clients found (all are on a live disbursed loan)');
            }

            // Step 6: Build response — backup-loan clients get existingBackup + history, others are fresh imports.
            const clientsWithBackups = eligibleClientsOnly.map((client) => {
                const name = client.firstName && client.lastName ? `${client.firstName} ${client.lastName}` : client.clientId;
                const backupLoan = backupLoanByClientId.get(client.id);

                if (!backupLoan) {
                    return { id: client.id, clientId: client.clientId, name, hasBackup: false, existingBackup: null, history: null };
                }

                // loanBalance/walletBalance aren't stored per-transaction — reconstructed as
                // running totals across the ordered transaction trail, same idea as the
                // source CSVs' cumulative columns (read-only display only).
                let runningLoanBalance = Number(backupLoan.amount);
                let runningWalletBalance = 0;
                const events = backupLoan.transactions.map((t) => {
                    if (t.type === 'REPAYMENT') runningLoanBalance -= Number(t.principalAmount || 0);
                    if (t.type === 'SAVINGS_COLLECTION') runningWalletBalance += Number(t.amount);
                    if (t.type === 'ADJUSTMENT') runningWalletBalance -= Number(t.amount);
                    return {
                        dueNo: t.lines[0]?.installmentNo != null ? String(t.lines[0].installmentNo) : '',
                        dueDate: null,
                        dueAmount: 0,
                        transactionDate: t.transactionDate.toISOString(),
                        transactionType: t.type,
                        amount: Number(t.amount),
                        principalAmount: Number(t.principalAmount || 0),
                        interestAmount: Number(t.interestAmount || 0),
                        loanBalance: Math.max(0, Number(runningLoanBalance.toFixed(2))),
                        walletAdvanceAmount: t.type === 'SAVINGS_COLLECTION' ? Number(t.amount) : 0,
                        walletAdvanceDate: t.type === 'SAVINGS_COLLECTION' ? t.transactionDate.toISOString() : null,
                        walletPayAmount: t.type === 'ADJUSTMENT' ? Number(t.amount) : 0,
                        walletPayDate: t.type === 'ADJUSTMENT' ? t.transactionDate.toISOString() : null,
                        walletBalance: Number(runningWalletBalance.toFixed(2)),
                    };
                });

                const loanCard: ParsedLoanCardReport = {
                    memberId: client.clientId,
                    contractCode: backupLoan.loanNumber,
                    officerName: backupLoan.createdBy ? `${backupLoan.createdBy.firstName} ${backupLoan.createdBy.lastName}`.trim() : '',
                    groupName: '',
                    amount: Number(backupLoan.amount),
                    funderName: backupLoan.funder?.funderName || '',
                    installments: backupLoan.schedules.length,
                    interestRate: Number(backupLoan.interestRate),
                    disbursementDate: backupLoan.disbursedByBMAt ? backupLoan.disbursedByBMAt.toISOString() : null,
                    scheduleRows: backupLoan.schedules.map((s) => ({
                        installmentNo: s.installmentNo,
                        dueDate: s.dueDate.toISOString(),
                        principalDue: Number(s.principalDue),
                        interestDue: Number(s.interestDue),
                        savingsDue: Number(s.savingsDue),
                        feesDue: Number(s.feesDue),
                        totalDue: Number(s.totalDue),
                        // Per-installment remaining (totalDue - totalPaid), not the source
                        // CSV's cumulative whole-loan balance — that figure isn't stored.
                        outstandingBalance: Math.max(0, Number(s.totalDue) - Number(s.totalPaid)),
                        receivedDate: s.paidAt ? s.paidAt.toISOString() : null,
                        receivedAmount: Number(s.totalPaid) > 0 ? Number(s.totalPaid) : null,
                    })),
                };

                const repayment: ParsedRepaymentReport = { memberId: client.clientId, clientName: name, events };

                return {
                    id: client.id,
                    clientId: client.clientId,
                    name,
                    hasBackup: true,
                    existingBackup: {
                        loanId: backupLoan.id,
                        loanProductTypeId: backupLoan.loanProduct?.loanProductTypeId,
                        loanProductId: backupLoan.loanProductId ?? undefined,
                        loanPurposeTypeId: backupLoan.loanPurpose?.loanPurposeTypeId,
                        loanPurposeId: backupLoan.loanPurposeId ?? undefined,
                        frequency: backupLoan.frequency ?? undefined,
                        disbursementDate: backupLoan.disbursedByBMAt ? backupLoan.disbursedByBMAt.toISOString() : undefined,
                        firstDueDate: backupLoan.firstDueDate ? backupLoan.firstDueDate.toISOString() : undefined,
                        funderId: backupLoan.funderId,
                        principalPaid: Number(backupLoan.principalPaid),
                        interestPaid: Number(backupLoan.interestPaid),
                        savingsPaid: Number(backupLoan.savingsPaid),
                        goldDetail: backupLoan.goldLoanDetail
                            ? {
                                  karatType: backupLoan.goldLoanDetail.karatType,
                                  gramCount: Number(backupLoan.goldLoanDetail.gramCount),
                                  cashGiven: Number(backupLoan.goldLoanDetail.cashGiven),
                              }
                            : null,
                    },
                    history: { loanCard, repayment },
                };
            });

            return successResponse(clientsWithBackups, 'Eligible clients fetched successfully');
        } catch (error) {
            console.error('Error fetching eligible clients:', error);
            return errorResponse(
                error instanceof Error ? error.message : 'Failed to fetch eligible clients',
                500
            );
        }
    })(request);
}
