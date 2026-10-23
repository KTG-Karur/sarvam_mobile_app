import type { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '@/app/lib/prisma';
import { extractUploanLoanId, toNumber } from '@/app/lib/services/uploan-import.service';
import type { ValidatedClosedMemberRow } from '@/app/lib/services/closed-member-import.service';
import { createOrMatchLegacyMemberClient } from '@/app/lib/services/legacy-member-client.service';
import {
    createBackupLoanWithHistory,
    createGoldLoanRecords,
    generateLoanNumber,
} from '@/app/lib/services/backup-loan.service';

/**
 * The shape persisted as `ClosedMemberImportJobRow.rowData` — a `ValidatedClosedMemberRow`
 * (from validateClosedMemberRows) plus the handful of fields resolved once, up front, in
 * POST /api/uploan/closed-member/import/start — same "pure function of one JSON blob"
 * contract as UploanJobRowData.
 */
export interface ClosedMemberJobRowData extends ValidatedClosedMemberRow {
    resolvedCenterId: string;
    resolvedGroupId: string;
    branchId: string;
    /** The job's one global toggle, carried onto every row so the worker never needs to
     *  look the job back up mid-row just to know which Loan path to take. */
    createLoan: boolean;
}

export interface ImportSingleClosedMemberRowResult {
    status: 'CREATED' | 'FAILED';
    clientId?: string;
    loanNumber?: string;
    loanId?: string;
    coApplicantId?: string;
    savingsRefundRequestId?: string;
    goldTransactionId?: string;
    reason?: string;
}

function resolveAnchorDate(row: ClosedMemberJobRowData): Date {
    const raw = row.disbursementDateResolved || row.closedDateResolved;
    return raw ? new Date(raw) : new Date();
}

/**
 * Creates/reuses the Client and creates a CLOSED Loan (either a full historical record —
 * schedule + one aggregate migrated transaction, same as the ongoing-loan importer's
 * generic path — or a bare shell with no schedule/transactions, per the job's createLoan
 * toggle), then auto-queues any unreturned Savings/Gold as PENDING requests in the same
 * approval queues a normally-closed loan's Savings Refund / Gold Return would use.
 */
export async function importSingleClosedMemberRow(
    row: ClosedMemberJobRowData,
    createdById: string,
    db: PrismaClient = prisma
): Promise<ImportSingleClosedMemberRowResult> {
    const centerId = row.resolvedCenterId;
    const groupId = row.resolvedGroupId;

    try {
        // A closed-loan migration is fine for a client who also has an active loan
        // elsewhere — blockIfActiveLoan: false (unlike the ongoing-loan importer).
        const { clientId, coApplicantId } = await db.$transaction(
            (tx) => createOrMatchLegacyMemberClient(tx, row, { centerId, groupId }, createdById, false),
            { maxWait: 10000, timeout: 30000 }
        );

        const loanPrincipal = toNumber(row.loanPrincipal) ?? 0;
        const loanInterest = toNumber(row.loanInterest) ?? 0;
        const unreturnedSavings = row.resolved.unreturnedSavings ?? 0;
        const closedDate = row.closedDateResolved ? new Date(row.closedDateResolved) : new Date();
        const anchorDate = resolveAnchorDate(row);
        const loanNumberOverride = extractUploanLoanId(row.raw) || undefined;
        const closureReason = row.resolved.closureReason ?? null;

        const result = await db.$transaction(async (tx) => {
            let loanId: string;
            let loanNumber: string;

            if (row.createLoan) {
                const loanProduct = await tx.loanProduct.findUnique({
                    where: { id: row.resolved.loanProductId as string },
                    select: { frequency: true },
                });
                if (!loanProduct) throw new Error('Loan product could not be re-fetched to create the closed loan');

                const created = await createBackupLoanWithHistory(tx, {
                    clientId,
                    centerId,
                    branchId: row.branchId,
                    loanProductId: row.resolved.loanProductId as string,
                    loanPurposeId: row.resolved.loanPurposeId as string,
                    frequency: loanProduct.frequency ?? 'weekly',
                    disbursementDate: anchorDate,
                    scheduleStartDate: anchorDate,
                    funderId: row.resolved.funderId ?? null,
                    principalPaid: loanPrincipal,
                    interestPaid: loanInterest,
                    // createBackupLoanWithHistory applies this straight to
                    // Loan.savingsPaid + Client.loanAdvance for us — do not also bump
                    // them manually below in this branch (would double-count).
                    savingsPaid: unreturnedSavings,
                    lastRepayDate: closedDate,
                    createdById,
                    goldLoanDetails: row.resolved.goldLoanDetails,
                    loanNumberOverride,
                });
                loanId = created.loanId;
                loanNumber = created.loanNumber;

                await tx.loan.update({
                    where: { id: loanId },
                    data: {
                        disbursementStatus: 'CLOSED',
                        isActive: false,
                        closedDate,
                        closureReason: closureReason ?? undefined,
                    },
                });
            } else {
                // Bare shell — no product/schedule/transactions, exists only to anchor the
                // Savings/Gold requests below (both require a non-nullable loanId).
                loanNumber = loanNumberOverride ?? (await generateLoanNumber(tx));
                const loan = await tx.loan.create({
                    data: {
                        loanNumber,
                        clientId,
                        centerId,
                        branchId: row.branchId,
                        applicationStatus: 'VERIFIED',
                        disbursementStatus: 'CLOSED',
                        amount: new Decimal(loanPrincipal.toFixed(2)),
                        interestRate: new Decimal(0),
                        tenureMonths: 0,
                        createdById,
                        verifiedById: createdById,
                        verifiedAt: new Date(),
                        disbursedByBMId: createdById,
                        disbursedByBMAt: anchorDate,
                        loanProductId: row.resolved.loanProductId ?? null,
                        loanPurposeId: row.resolved.loanPurposeId ?? null,
                        funderId: row.resolved.funderId ?? null,
                        principalPaid: new Decimal(loanPrincipal.toFixed(2)),
                        interestPaid: new Decimal(loanInterest.toFixed(2)),
                        isActive: false,
                        closedDate,
                        closureReason: closureReason ?? undefined,
                    },
                    select: { id: true },
                });
                loanId = loan.id;

                await createGoldLoanRecords(tx, loanId, {
                    goldLoanDetails: row.resolved.goldLoanDetails,
                    createdById,
                    disbursementDate: anchorDate,
                });

                if (unreturnedSavings > 0) {
                    await tx.loan.update({
                        where: { id: loanId },
                        data: { savingsPaid: { increment: new Decimal(unreturnedSavings.toFixed(2)) } },
                    });
                    await tx.client.update({
                        where: { id: clientId },
                        data: { loanAdvance: { increment: new Decimal(unreturnedSavings.toFixed(2)) } },
                    });
                }
            }

            let savingsRefundRequestId: string | undefined;
            if (unreturnedSavings > 0) {
                const request = await tx.savingsRefundRequest.create({
                    data: {
                        loanId,
                        clientId,
                        centerId,
                        branchId: row.branchId,
                        totalSavings: new Decimal(unreturnedSavings.toFixed(2)),
                        refundAmount: new Decimal(unreturnedSavings.toFixed(2)),
                        remarks: 'Auto-created by Closed Loan Member Upload',
                        status: 'PENDING_APPROVAL',
                        initiatedById: createdById,
                        initiatedAt: new Date(),
                    },
                    select: { id: true },
                });
                savingsRefundRequestId = request.id;
            }

            let goldTransactionId: string | undefined;
            if (row.resolved.goldLoanDetails) {
                const gd = row.resolved.goldLoanDetails;
                const goldReturn = await tx.goldTransaction.create({
                    data: {
                        loanId,
                        type: 'GIVE',
                        gramCount: new Decimal(gd.gramCount.toString()),
                        goldValue: new Decimal(gd.goldTakenValue.toString()),
                        status: 'PENDING',
                        initiatedById: createdById,
                        remarks: 'Auto-created by Closed Loan Member Upload',
                    },
                    select: { id: true },
                });
                goldTransactionId = goldReturn.id;
            }

            return { loanId, loanNumber, savingsRefundRequestId, goldTransactionId };
        }, { maxWait: 10000, timeout: 30000 });

        return {
            status: 'CREATED',
            clientId,
            loanNumber: result.loanNumber,
            loanId: result.loanId,
            coApplicantId,
            savingsRefundRequestId: result.savingsRefundRequestId,
            goldTransactionId: result.goldTransactionId,
        };
    } catch (err) {
        return { status: 'FAILED', reason: err instanceof Error ? err.message : 'Failed to create client/loan' };
    }
}

export interface RevertSingleClosedMemberRowInput {
    loanId: string | null;
    clientId: string | null;
    coApplicantId: string | null;
    clientStatus: 'MATCHED_EXISTING' | 'NEW' | undefined;
}

export interface RevertSingleClosedMemberRowResult {
    status: 'REVERTED' | 'REVERT_FAILED';
    reason?: string;
}

/**
 * Undoes exactly what importSingleClosedMemberRow created for one row — mirrors
 * revertSingleUploanRow's shape. Only called from the same-day revert window
 * (closed-member-import-revert-gate.ts) after that gate has already excluded any row
 * whose auto-created SavingsRefundRequest/GoldTransaction was since approved/rejected by
 * a human, or whose loan picked up other real activity.
 */
export async function revertSingleClosedMemberRow(
    input: RevertSingleClosedMemberRowInput,
    db: PrismaClient = prisma
): Promise<RevertSingleClosedMemberRowResult> {
    if (!input.loanId) {
        return { status: 'REVERTED' };
    }

    try {
        await db.$transaction(
            async (tx) => {
                const loan = await tx.loan.findUnique({
                    where: { id: input.loanId! },
                    select: { id: true, clientId: true, savingsPaid: true },
                });
                if (!loan) return;

                // Only ever deletable here if still PENDING_APPROVAL / PENDING — the
                // revert-gate has already excluded any row whose request was since acted
                // on by a human, so this delete is always safe to attempt unconditionally.
                await tx.savingsRefundRequest.deleteMany({ where: { loanId: loan.id, status: 'PENDING_APPROVAL' } });
                await tx.goldTransaction.deleteMany({ where: { loanId: loan.id } });
                await tx.goldLoanDetail.deleteMany({ where: { loanId: loan.id } });
                await tx.loanTransaction.deleteMany({ where: { loanId: loan.id } });
                await tx.loanSchedule.deleteMany({ where: { loanId: loan.id } });

                if (input.clientStatus === 'MATCHED_EXISTING') {
                    await tx.client.update({
                        where: { id: loan.clientId },
                        data: { loanAdvance: { decrement: loan.savingsPaid } },
                    });
                }

                await tx.loan.delete({ where: { id: loan.id } });

                if (input.coApplicantId) {
                    await tx.coApplicantHistory.deleteMany({ where: { coApplicantId: input.coApplicantId } });
                    await tx.coApplicant.delete({ where: { id: input.coApplicantId } });
                }

                if (input.clientStatus === 'NEW' && input.clientId) {
                    await tx.client.delete({ where: { id: input.clientId } });
                }
            },
            { maxWait: 10000, timeout: 30000 }
        );

        return { status: 'REVERTED' };
    } catch (err) {
        return {
            status: 'REVERT_FAILED',
            reason: err instanceof Error ? err.message : 'Failed to revert this row',
        };
    }
}
