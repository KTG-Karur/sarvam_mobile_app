import { NextRequest } from 'next/server';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { handleCorsPreflight, errorResponse, successResponse, withRole } from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { applyBackupLoanHistory, createGoldLoanRecords } from '@/app/lib/services/backup-loan.service';
import { reconstructBackupLoanSource } from '@/app/lib/services/backup-loan-reconstruct.service';
import { assertFunderChangeAllowed } from '@/app/lib/revert-eod-guard';
import {
    loanCardReportSchema,
    repaymentReportSchema,
} from '@/app/lib/validations/backup-loan-report.validation';
import type {
    ParsedLoanCardReport,
    ParsedRepaymentReport,
} from '@/app/lib/services/uploan-loan-history.service';
import { bumpLoanBalance } from '@/app/lib/cache/loan-balance-cache';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/** The `{ loanCard, repayment, savingsPaid }` envelope stored on `Loan.migratedLoanSource`. */
interface MigratedLoanSourceEnvelope {
    loanCard: ParsedLoanCardReport | null;
    repayment: ParsedRepaymentReport | null;
    savingsPaid?: number;
    principalPaid?: number;
    interestPaid?: number;
}

const toYmd = (d: Date | null): string => (d ? d.toISOString().slice(0, 10) : '');

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/uploan/loan-history/loans/[loanId]
//   Returns the editable meta + the { loanCard, repayment, savingsPaid } grids,
//   from Loan.migratedLoanSource when present (source: 'STORED', exact) or an
//   approximate reconstruction from LoanSchedule/LoanTransaction (source: 'RECONSTRUCTED').
// ──────────────────────────────────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: { params: Promise<{ loanId: string }> }) {
    return withRole(['ADMIN'], async () => {
        try {
            const { loanId } = await params;

            const loan = await prisma.loan.findUnique({
                where: { id: loanId },
                select: {
                    id: true,
                    loanNumber: true,
                    branchId: true,
                    centerId: true,
                    clientId: true,
                    amount: true,
                    interestRate: true,
                    frequency: true,
                    indexId: true,
                    disbursementStatus: true,
                    closedDate: true,
                    disbursedByBMAt: true,
                    firstDueDate: true,
                    funderId: true,
                    savingsPaid: true,
                    loanProductId: true,
                    loanPurposeId: true,
                    migratedLoanSource: true,
                    client: { select: { clientId: true, firstName: true, lastName: true } },
                    loanProduct: { select: { productName: true, loanProductTypeId: true } },
                    loanPurpose: { select: { loanPurposeTypeId: true } },
                    funder: { select: { funderName: true } },
                    createdBy: { select: { firstName: true, lastName: true } },
                    goldLoanDetail: {
                        select: { karatType: true, gramCount: true, goldTakenValue: true, cashGiven: true },
                    },
                    schedules: { orderBy: { installmentNo: 'asc' } },
                    transactions: {
                        where: { isReversed: false },
                        orderBy: { transactionDate: 'asc' },
                        include: { lines: { select: { installmentNo: true } } },
                    },
                },
            });

            if (!loan) return errorResponse('Loan not found', 404);
            // Never-indexed backup/migrated loans only — whether still DISBURSED or since
            // CLOSED (full repayment, foreclosure, or imported directly as closed). A loan
            // that went through live indexation is off-limits either way.
            if (
                (loan.disbursementStatus !== 'DISBURSED' && loan.disbursementStatus !== 'CLOSED') ||
                loan.indexId !== null
            ) {
                return errorResponse(
                    'This loan is not a backup/migrated loan (it went through the live indexation/disbursement workflow) — it cannot be edited here',
                    400
                );
            }

            const realActivity = await prisma.loanTransaction.findFirst({
                where: { loanId, excludeFromEodAllocation: false },
                select: { id: true },
            });

            const clientName =
                `${loan.client.firstName ?? ''} ${loan.client.lastName ?? ''}`.trim() || loan.client.clientId;

            const stored = loan.migratedLoanSource as unknown as MigratedLoanSourceEnvelope | null;
            let source: 'STORED' | 'RECONSTRUCTED';
            let loanCard: ParsedLoanCardReport;
            let repayment: ParsedRepaymentReport;
            let savingsPaid: number;

            if (stored && stored.loanCard) {
                source = 'STORED';
                loanCard = stored.loanCard;
                repayment = stored.repayment ?? { memberId: loan.client.clientId, clientName, events: [] };
                savingsPaid = typeof stored.savingsPaid === 'number' ? stored.savingsPaid : Number(loan.savingsPaid);
            } else {
                source = 'RECONSTRUCTED';
                const rebuilt = reconstructBackupLoanSource({
                    loanNumber: loan.loanNumber,
                    amount: loan.amount,
                    interestRate: loan.interestRate,
                    disbursedByBMAt: loan.disbursedByBMAt,
                    clientClientId: loan.client.clientId,
                    clientName,
                    officerName: loan.createdBy
                        ? `${loan.createdBy.firstName} ${loan.createdBy.lastName}`.trim()
                        : '',
                    funderName: loan.funder?.funderName ?? '',
                    schedules: loan.schedules,
                    transactions: loan.transactions,
                });
                loanCard = rebuilt.loanCard;
                repayment = rebuilt.repayment;
                savingsPaid = rebuilt.savingsPaid;
            }

            return successResponse({
                source,
                hasRealActivity: !!realActivity,
                meta: {
                    loanId: loan.id,
                    loanNumber: loan.loanNumber,
                    disbursementStatus: loan.disbursementStatus as 'DISBURSED' | 'CLOSED',
                    closedDate: loan.closedDate ? loan.closedDate.toISOString() : null,
                    branchId: loan.branchId,
                    centerId: loan.centerId,
                    clientId: loan.clientId,
                    clientName,
                    clientCode: loan.client.clientId,
                    productName: loan.loanProduct?.productName ?? '',
                    loanProductId: loan.loanProductId ?? '',
                    loanProductTypeId: loan.loanProduct?.loanProductTypeId ?? '',
                    loanPurposeId: loan.loanPurposeId ?? '',
                    loanPurposeTypeId: loan.loanPurpose?.loanPurposeTypeId ?? '',
                    frequency: loan.frequency ?? 'weekly',
                    disbursementDate: toYmd(loan.disbursedByBMAt),
                    scheduleStartDate: toYmd(loan.firstDueDate),
                    funderId: loan.funderId ?? '',
                    savingsPaid,
                    gold: loan.goldLoanDetail
                        ? {
                              karatType: loan.goldLoanDetail.karatType,
                              gramCount: Number(loan.goldLoanDetail.gramCount),
                              goldTakenValue: Number(loan.goldLoanDetail.goldTakenValue),
                              cashGiven: Number(loan.goldLoanDetail.cashGiven),
                          }
                        : null,
                },
                loanCard,
                repayment,
            });
        } catch (error) {
            console.error('[uploan loan-history/loans/[loanId]] GET Error:', error);
            return errorResponse(error instanceof Error ? error.message : 'Failed to load loan history', 500);
        }
    })(request);
}

// ──────────────────────────────────────────────────────────────────────────────
// PUT /api/uploan/loan-history/loans/[loanId]
//   Wipes this backup loan's schedule + transaction trail and rebuilds it from the
//   edited grids. Destructive — records a BackupLoanEditLog and requires a reason.
// ──────────────────────────────────────────────────────────────────────────────
const goldSchema = z.object({
    karatType: z.enum(['24K', '22K', '20K', '18K', '16K']),
    gramCount: z.number().positive(),
    goldTakenValue: z.number().nonnegative(),
    cashGiven: z.number().nonnegative(),
});

const putSchema = z.object({
    reason: z.string().trim().min(3, 'A reason (min 3 chars) is required'),
    allowRealActivityWipe: z.boolean().optional(),
    meta: z.object({
        loanProductId: z.string().min(1, 'Loan product is required'),
        loanPurposeId: z.string().min(1, 'Loan purpose is required'),
        frequency: z.enum(['daily', 'weekly', 'forthnight', 'monthly', 'quarterly']),
        disbursementDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Disbursement date must be YYYY-MM-DD'),
        scheduleStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'First due date must be YYYY-MM-DD'),
        funderId: z.string().optional(),
        savingsPaid: z.number().min(0).default(0),
        gold: goldSchema.nullish(),
    }),
    loanCardReport: loanCardReportSchema.nullish(),
    repaymentReport: repaymentReportSchema.nullish(),
});

export async function PUT(request: NextRequest, { params }: { params: Promise<{ loanId: string }> }) {
    return withRole(['ADMIN'], async (req, user) => {
        try {
            const { loanId } = await params;
            const parsed = putSchema.safeParse(await req.json());
            if (!parsed.success) {
                return errorResponse(parsed.error.errors.map((e) => e.message).join(', '), 400);
            }
            const { reason, allowRealActivityWipe, meta, loanCardReport, repaymentReport } = parsed.data;

            if (!loanCardReport && !repaymentReport) {
                return errorResponse('At least one of Loan Card / Repayment grid must be provided', 400);
            }
            if (loanCardReport && loanCardReport.scheduleRows.length === 0) {
                return errorResponse('The Loan Card schedule cannot be empty — add at least one installment row', 400);
            }

            const loan = await prisma.loan.findUnique({
                where: { id: loanId },
                select: {
                    id: true,
                    loanNumber: true,
                    branchId: true,
                    centerId: true,
                    clientId: true,
                    indexId: true,
                    disbursementStatus: true,
                    principalPaid: true,
                    interestPaid: true,
                    savingsPaid: true,
                    migratedLoanSource: true,
                    funderId: true,
                    transactions: {
                        orderBy: { transactionDate: 'asc' },
                        take: 1,
                        select: { collectedById: true },
                    },
                    _count: { select: { schedules: true, transactions: true } },
                },
            });
            if (!loan) return errorResponse('Loan not found', 404);
            if (
                (loan.disbursementStatus !== 'DISBURSED' && loan.disbursementStatus !== 'CLOSED') ||
                loan.indexId !== null
            ) {
                return errorResponse('This loan is not a backup/migrated loan and cannot be edited here', 400);
            }

            const funderChangeError = await assertFunderChangeAllowed(
                prisma,
                loanId,
                loan.funderId,
                meta.funderId || null
            );
            if (funderChangeError) return errorResponse(funderChangeError, 409);

            const realActivityTxn = await prisma.loanTransaction.findFirst({
                where: { loanId, excludeFromEodAllocation: false },
                select: { id: true },
            });
            if (realActivityTxn && !allowRealActivityWipe) {
                return errorResponse(
                    'REAL_ACTIVITY: This loan has had real (non-import) collection activity since import. Rebuilding will delete those transactions. Re-submit with confirmation to proceed.',
                    409
                );
            }

            const loanProduct = await prisma.loanProduct.findUnique({
                where: { id: meta.loanProductId },
                select: { id: true, loanAmount: true, interestRate: true, numberOfDues: true },
            });
            if (!loanProduct) return errorResponse('Loan product not found', 404);

            const oldSavingsPaid = Number(loan.savingsPaid);
            const originalOfficerId = loan.transactions[0]?.collectedById;

            const goldLoanDetails = meta.gold
                ? {
                      karatType: meta.gold.karatType,
                      gramCount: meta.gold.gramCount,
                      goldTakenValue: meta.gold.goldTakenValue,
                      cashGiven: meta.gold.cashGiven,
                  }
                : undefined;

            const newSource: MigratedLoanSourceEnvelope = {
                loanCard: loanCardReport ?? null,
                repayment: repaymentReport ?? null,
                savingsPaid: meta.savingsPaid,
                principalPaid: 0,
                interestPaid: 0,
            };

            const result = await prisma.$transaction(
                async (tx) => {
                    // 1. Audit — captured BEFORE anything is touched.
                    await tx.backupLoanEditLog.create({
                        data: {
                            loanId,
                            editedById: user.userId,
                            reason,
                            beforeSnapshot: {
                                principalPaid: Number(loan.principalPaid),
                                interestPaid: Number(loan.interestPaid),
                                savingsPaid: oldSavingsPaid,
                                scheduleCount: loan._count.schedules,
                                transactionCount: loan._count.transactions,
                                hadRealActivity: !!realActivityTxn,
                                migratedLoanSource: loan.migratedLoanSource ?? null,
                            } as unknown as Prisma.InputJsonValue,
                        },
                    });

                    // 2. Wipe the existing schedule + transaction trail + gold. Transaction
                    //    lines cascade with the transaction; schedule collection-stats
                    //    cascade with the schedule.
                    await tx.goldTransaction.deleteMany({ where: { loanId } });
                    await tx.goldLoanDetail.deleteMany({ where: { loanId } });
                    await tx.loanTransaction.deleteMany({ where: { loanId } });
                    await tx.loanScheduleCollectionStats.deleteMany({ where: { loanId } });
                    await tx.loanSchedule.deleteMany({ where: { loanId } });

                    // 3. Reset aggregates (replay uses `increment`) + apply edited meta +
                    //    stamp the new exact source.
                    await tx.loan.update({
                        where: { id: loanId },
                        data: {
                            loanProductId: meta.loanProductId,
                            loanPurposeId: meta.loanPurposeId,
                            funderId: meta.funderId || null,
                            frequency: meta.frequency,
                            disbursedByBMAt: new Date(meta.disbursementDate),
                            firstDueDate: new Date(meta.scheduleStartDate),
                            amount: new Decimal(loanProduct.loanAmount.toString()),
                            interestRate: new Decimal(loanProduct.interestRate.toString()),
                            tenureMonths: loanProduct.numberOfDues,
                            principalPaid: new Decimal(0),
                            interestPaid: new Decimal(0),
                            savingsPaid: new Decimal(0),
                            lastPaymentDate: null,
                            migratedLoanSource: newSource as unknown as Prisma.InputJsonValue,
                        },
                    });

                    // 4. Undo this loan's prior net effect on the client's wallet balance —
                    //    same invariant as revertSingleUploanRow (uploan-import-row.service.ts):
                    //    Loan.savingsPaid already equals this loan's lifetime effect on
                    //    Client.loanAdvance. Replay re-applies the new figure from scratch.
                    if (oldSavingsPaid !== 0) {
                        await tx.client.update({
                            where: { id: loan.clientId },
                            data: { loanAdvance: { decrement: new Decimal(oldSavingsPaid.toString()) } },
                        });
                    }

                    // 5. Rebuild schedule + transactions + gold + savings lump from the grids.
                    return applyBackupLoanHistory(tx, loanId, loan.loanNumber, {
                        clientId: loan.clientId,
                        centerId: loan.centerId,
                        branchId: loan.branchId,
                        loanProductId: meta.loanProductId,
                        loanPurposeId: meta.loanPurposeId,
                        frequency: meta.frequency,
                        disbursementDate: new Date(meta.disbursementDate),
                        scheduleStartDate: new Date(meta.scheduleStartDate),
                        funderId: meta.funderId || null,
                        principalPaid: 0,
                        interestPaid: 0,
                        savingsPaid: meta.savingsPaid,
                        lastRepayDate: null,
                        goldLoanDetails,
                        createdById: user.userId,
                        loanOfficerId: originalOfficerId,
                        loanCardReport: loanCardReport ?? undefined,
                        repaymentReport: repaymentReport ?? undefined,
                    });
                },
                { maxWait: 15000, timeout: 120000 }
            );

            await bumpLoanBalance(loanId);

            return successResponse(
                { loanId: result.loanId, loanNumber: result.loanNumber },
                'Loan history rebuilt from the edited grids'
            );
        } catch (error) {
            console.error('[uploan loan-history/loans/[loanId]] PUT Error:', error);
            return errorResponse(error instanceof Error ? error.message : 'Failed to rebuild loan history', 500);
        }
    })(request);
}

// ──────────────────────────────────────────────────────────────────────────────
// PATCH /api/uploan/loan-history/loans/[loanId]
//   Lightweight correction for the two things that keep needing a fix on a CLOSED
//   backup/migrated loan long after import: an unreturned Gold pledge, and the
//   unreturned Loan Advance (savings) figure. Unlike PUT above, this NEVER touches
//   LoanSchedule/LoanTransaction/migratedLoanSource/loanProduct/loanPurpose/frequency/
//   dates — no "fill in the whole loan" requirement, and no real-activity gate (nothing
//   collection-related is deleted). Body always carries the FULL current gold/advance
//   state (same "form is the source of truth" contract as PUT), not a partial diff.
// ──────────────────────────────────────────────────────────────────────────────
const patchSchema = z.object({
    reason: z.string().trim().min(3, 'A reason (min 3 chars) is required'),
    /** null = no/removed gold pledge. */
    gold: goldSchema.nullable(),
    savingsPaid: z.number().min(0),
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ loanId: string }> }) {
    return withRole(['ADMIN'], async (req, user) => {
        try {
            const { loanId } = await params;
            const parsed = patchSchema.safeParse(await req.json());
            if (!parsed.success) {
                return errorResponse(parsed.error.errors.map((e) => e.message).join(', '), 400);
            }
            const { reason, gold, savingsPaid } = parsed.data;

            const loan = await prisma.loan.findUnique({
                where: { id: loanId },
                select: {
                    id: true,
                    clientId: true,
                    disbursementStatus: true,
                    indexId: true,
                    savingsPaid: true,
                    disbursedByBMAt: true,
                    goldLoanDetail: {
                        select: { karatType: true, gramCount: true, goldTakenValue: true, cashGiven: true },
                    },
                },
            });
            if (!loan) return errorResponse('Loan not found', 404);
            if (
                (loan.disbursementStatus !== 'DISBURSED' && loan.disbursementStatus !== 'CLOSED') ||
                loan.indexId !== null
            ) {
                return errorResponse('This loan is not a backup/migrated loan and cannot be edited here', 400);
            }

            const oldGold = loan.goldLoanDetail
                ? {
                      karatType: loan.goldLoanDetail.karatType,
                      gramCount: Number(loan.goldLoanDetail.gramCount),
                      goldTakenValue: Number(loan.goldLoanDetail.goldTakenValue),
                      cashGiven: Number(loan.goldLoanDetail.cashGiven),
                  }
                : null;
            const oldSavingsPaid = Number(loan.savingsPaid);

            const goldChanged = gold === null
                ? oldGold !== null
                : !oldGold ||
                  gold.karatType !== oldGold.karatType ||
                  gold.gramCount !== oldGold.gramCount ||
                  gold.goldTakenValue !== oldGold.goldTakenValue ||
                  gold.cashGiven !== oldGold.cashGiven;
            const savingsChanged = savingsPaid !== oldSavingsPaid;

            if (!goldChanged && !savingsChanged) {
                return errorResponse('Nothing changed — edit the gold pledge or the unreturned advance figure before saving', 400);
            }

            await prisma.$transaction(
                async (tx) => {
                    await tx.backupLoanEditLog.create({
                        data: {
                            loanId,
                            editedById: user.userId,
                            reason: `[Gold/Advance] ${reason}`,
                            beforeSnapshot: { savingsPaid: oldSavingsPaid, gold: oldGold } as unknown as Prisma.InputJsonValue,
                        },
                    });

                    if (goldChanged) {
                        // Existing TAKE row(s) + the pledge detail are replaced wholesale — any
                        // prior GIVE (return) transaction is left untouched, same as the full
                        // PUT rebuild's gold handling.
                        await tx.goldTransaction.deleteMany({ where: { loanId, type: 'TAKE' } });
                        await tx.goldLoanDetail.deleteMany({ where: { loanId } });
                        if (gold) {
                            await createGoldLoanRecords(tx, loanId, {
                                goldLoanDetails: gold,
                                createdById: user.userId,
                                disbursementDate: loan.disbursedByBMAt ?? new Date(),
                            });
                        }
                    }

                    if (savingsChanged) {
                        const delta = savingsPaid - oldSavingsPaid;
                        await tx.loan.update({
                            where: { id: loanId },
                            data: { savingsPaid: new Decimal(savingsPaid.toFixed(2)) },
                        });
                        await tx.client.update({
                            where: { id: loan.clientId },
                            data: { loanAdvance: { increment: new Decimal(delta.toFixed(2)) } },
                        });
                    }
                },
                { maxWait: 10000, timeout: 30000 }
            );

            return successResponse({ loanId }, 'Gold / advance details updated');
        } catch (error) {
            console.error('[uploan loan-history/loans/[loanId]] PATCH Error:', error);
            return errorResponse(error instanceof Error ? error.message : 'Failed to update gold/advance details', 500);
        }
    })(request);
}
