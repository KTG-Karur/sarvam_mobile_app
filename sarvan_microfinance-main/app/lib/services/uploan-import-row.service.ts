import type { PrismaClient } from '@prisma/client';
import { prisma } from '@/app/lib/prisma';
import { extractUploanLoanId, type ValidatedUploanRow } from '@/app/lib/services/uploan-import.service';
import { buildLoanHistoryForLoan, type BranchRepaymentRow } from '@/app/lib/services/uploan-branch-repayment.service';
import type { ParsedLoanCardReport, ParsedRepaymentReport } from '@/app/lib/services/uploan-loan-history.service';
import { createBackupLoanFromReports } from '@/app/lib/services/backup-loan.service';
import { createOrMatchLegacyMemberClient } from '@/app/lib/services/legacy-member-client.service';

/**
 * The shape persisted as `UploanImportJobRow.rowData` — a `ValidatedUploanRow` (from
 * validateUploanRows) plus the handful of fields resolved once, up front, in
 * POST /api/uploan/member/import/start (Center/Group creation + branch code), so
 * importSingleUploanRow below never needs to re-touch Center/Group creation or re-derive
 * centerCode/groupNumber — it's a pure function of this one object.
 */
export interface UploanJobRowData extends ValidatedUploanRow {
    resolvedCenterId: string;
    resolvedGroupId: string;
    centerCode: string;
    groupNumber: number | null;
    branchCode: string;
    branchId: string;
}

export interface ImportSingleUploanRowResult {
    status: 'CREATED' | 'FAILED';
    clientId?: string;
    loanNumber?: string;
    // Populated alongside clientId/loanNumber on success — lets a later same-day
    // revertSingleUploanRow() target exactly what this row created.
    loanId?: string;
    coApplicantId?: string;
    reason?: string;
}

/**
 * Creates/reuses the Client and creates the backup Loan (schedule + replayed
 * transaction trail) for one already-resolved uploan row. Ported verbatim from the
 * per-row loop that used to run synchronously inside POST /api/uploan/member/import —
 * now called by app/lib/services/uploan-import-worker.ts, one row per claimed
 * UploanImportJobRow, so a full branch (600+ rows) never has to fit in one request.
 */
export async function importSingleUploanRow(
    row: UploanJobRowData,
    branchRepaymentByLoanId: Map<string, BranchRepaymentRow[]>,
    createdById: string,
    db: PrismaClient = prisma
): Promise<ImportSingleUploanRowResult> {
    const centerId = row.resolvedCenterId;
    const groupId = row.resolvedGroupId;

    try {
        const { clientId, coApplicantId } = await db.$transaction(
            (tx) => createOrMatchLegacyMemberClient(tx, row, { centerId, groupId }, createdById, true),
            { maxWait: 10000, timeout: 30000 }
        );

        const loanId = extractUploanLoanId(row.raw);
        const repaymentRows = loanId ? branchRepaymentByLoanId.get(loanId) : undefined;
        // Fetched once and reused below both to build the migrated schedule/tail (when
        // there's collected history) and as the new Loan record's own frequency — a
        // biweekly/monthly product must not silently become a weekly loan.
        const loanProduct = await db.loanProduct.findUnique({
            where: { id: row.resolved.loanProductId as string },
            include: { scheduleTemplates: { orderBy: { installmentNo: 'asc' } } },
        });
        let loanCardReport: ParsedLoanCardReport | undefined;
        let repaymentReport: ParsedRepaymentReport | undefined;
        if (repaymentRows && repaymentRows.length > 0 && loanProduct) {
            const built = buildLoanHistoryForLoan({
                loanId,
                rows: repaymentRows,
                loanProduct,
                officerName: '', // unused downstream — loanOfficerId (already resolved) is what matters
                // Product due count over raw row count — a re-amortised legacy file has more
                // lines than the loan's real tenure. buildLoanHistoryForLoan hard-caps at the
                // product tenure regardless; this only keeps the passed hint sane.
                totalInstallments: Number(row.installmentsRef) || loanProduct.numberOfDues || repaymentRows.length,
                scheduleStartDate: row.scheduleStartDateResolved as string,
                frequency: loanProduct.frequency,
            });
            loanCardReport = built.loanCard;
            repaymentReport = built.repayment;
        }

        // generateLoanNumber (backup-loan.service.ts) reads the current max loanNumber and
        // checks for a collision before this transaction commits — if a second,
        // truly-concurrent import (another job, or an overlapping worker tick) generates
        // the same number and commits first, this INSERT fails on the unique constraint.
        // Postgres aborts the whole transaction on that error (no partial retry inside
        // it), so the fix is to retry the ENTIRE transaction from scratch — a fresh
        // attempt re-reads the now-updated max and gets a different number.
        const MAX_LOAN_NUMBER_COLLISION_RETRIES = 3;
        let loanResult: Awaited<ReturnType<typeof createBackupLoanFromReports>> | undefined;
        for (let attempt = 0; ; attempt++) {
            try {
                loanResult = await db.$transaction(
                    (tx) =>
                        createBackupLoanFromReports(tx, {
                            clientId,
                            centerId,
                            branchId: row.branchId,
                            loanProductId: row.resolved.loanProductId as string,
                            loanPurposeId: row.resolved.loanPurposeId as string,
                            frequency: loanProduct?.frequency ?? 'weekly',
                            disbursementDate: new Date(row.disbursementDateResolved as string),
                            scheduleStartDate: new Date(row.scheduleStartDateResolved as string),
                            funderId: row.resolved.funderId ?? null,
                            principalPaid: row.resolved.paidPrincipal,
                            interestPaid: row.resolved.paidInterest,
                            // resolved.loanAdvanceOutstanding (from the Thrift/Loan-Advance
                            // Outstanding Report, grouped+summed across ALL of this member's loan
                            // cycles) replaces the old Thrift1+Thrift2 current-loan-only sum
                            // whenever that report was uploaded this import run; falls back to the
                            // legacy sum when it wasn't (the report is optional).
                            savingsPaid:
                                row.resolved.loanAdvanceOutstanding !== undefined
                                    ? row.resolved.loanAdvanceOutstanding
                                    : (Number(row.thrift1) || 0) + (Number(row.thrift2) || 0),
                            lastRepayDate: row.lastRepayDateResolved ? new Date(row.lastRepayDateResolved as string) : null,
                            createdById,
                            loanOfficerId: row.resolved.loanOfficerId,
                            loanCardReport,
                            repaymentReport,
                            goldLoanDetails: row.resolved.goldLoanDetails,
                            // The legacy "Loan MemberID", preserved verbatim as Loan.loanNumber —
                            // validateUploanRows already confirmed it doesn't collide with an
                            // existing loan before this row ever reached the worker.
                            loanNumberOverride: loanId || undefined,
                        }),
                    // Replays one transaction per paid installment (up to ~60+ for a long-running
                    // loan) — generous timeout, same as the old synchronous import route used.
                    { maxWait: 10000, timeout: 60000 }
                );
                break;
            } catch (err) {
                const isLoanNumberCollision =
                    err instanceof Error &&
                    /unique constraint/i.test(err.message) &&
                    /loanNumber/i.test(err.message);
                if (isLoanNumberCollision && attempt < MAX_LOAN_NUMBER_COLLISION_RETRIES) continue;
                throw err;
            }
        }

        return {
            status: 'CREATED',
            clientId,
            loanNumber: loanResult.loanNumber,
            loanId: loanResult.loanId,
            coApplicantId,
        };
    } catch (err) {
        return { status: 'FAILED', reason: err instanceof Error ? err.message : 'Failed to create client/loan' };
    }
}

export interface RevertSingleUploanRowInput {
    loanId: string | null;
    clientId: string | null;
    coApplicantId: string | null;
    clientStatus: 'MATCHED_EXISTING' | 'NEW' | undefined;
}

export interface RevertSingleUploanRowResult {
    status: 'REVERTED' | 'REVERT_FAILED';
    reason?: string;
}

/**
 * Undoes exactly what importSingleUploanRow created for one row — mirrors its shape
 * (one $transaction, never throws, catch-and-report instead so one bad row can't stop
 * the rest of a job's revert). Only called from the same-day revert window
 * (uploan-import-revert-gate.ts) after the post-import-activity safety check has
 * already excluded unsafe rows.
 */
export async function revertSingleUploanRow(
    input: RevertSingleUploanRowInput,
    db: PrismaClient = prisma
): Promise<RevertSingleUploanRowResult> {
    if (!input.loanId) {
        // Row never reached CREATED (e.g. it FAILED at import time) — nothing to undo.
        return { status: 'REVERTED' };
    }

    try {
        await db.$transaction(
            async (tx) => {
                const loan = await tx.loan.findUnique({
                    where: { id: input.loanId! },
                    select: { id: true, clientId: true, savingsPaid: true },
                });
                if (!loan) {
                    // Already gone (e.g. a prior partial revert attempt) — nothing to undo.
                    return;
                }

                await tx.goldTransaction.deleteMany({ where: { loanId: loan.id } });
                await tx.goldLoanDetail.deleteMany({ where: { loanId: loan.id } });
                await tx.loanTransaction.deleteMany({ where: { loanId: loan.id } });
                await tx.loanSchedule.deleteMany({ where: { loanId: loan.id } });

                if (input.clientStatus === 'MATCHED_EXISTING') {
                    // Client pre-existed this import — only decrement the balance this
                    // loan added to it, never delete the Client itself. loan.savingsPaid
                    // is safe to use directly here (not just the original applySavingsLumpSum
                    // increment) because every place backup-loan.service.ts touches
                    // Client.loanAdvance also applies the identical delta to
                    // Loan.savingsPaid in the same call (applySavingsLumpSum increments both;
                    // replayRepaymentEvents's wallet-payoff branch decrements both) — so
                    // Loan.savingsPaid's current value already equals this loan's net
                    // lifetime effect on Client.loanAdvance.
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
                    // Cascades the Client's GroupMember row automatically.
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
