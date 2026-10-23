import { NextRequest } from 'next/server';
import { Decimal } from '@prisma/client/runtime/library';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { recordLoanHistory } from '@/app/lib/loan-history';
import { z } from 'zod';
import { loanService } from '@/app/lib/services/loan.service';
import { assertBranchNotLocked } from '@/app/lib/branch-lock';
import { SYSTEM_LEDGERS } from '@/app/lib/constants/ledgers';
import { accountingPostingService, INDEX_DISBURSEMENT_POSTING_MARKER_PREFIX } from '@/app/lib/services/accounting-posting.service';
import { getBranchWorkingDayWindow } from '@/app/lib/branch-working-day-guard';
import { getFirstDueDateConfig } from '@/app/lib/first-due-date-config';
import { findIncompleteMemberIndividualLoanIds } from '@/app/lib/member-individual-gate';
import { findGoldLoansMissingPhoto } from '@/app/lib/gold-loan-photo-gate';
import { isGoldLoanProduct } from '@/app/lib/gl-config';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';
import { bumpLoanBalance } from '@/app/lib/cache/loan-balance-cache';
import { MONTHLY_INTERVAL_DAYS, QUARTERLY_INTERVAL_DAYS } from '@/app/lib/loan-frequency';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const goldLoanDetailSchema = z.object({
    karatType: z.enum(['24K', '22K', '20K', '18K', '16K']),
    gramCount: z.number().positive('Gram count must be positive'),
    goldTakenValue: z.number().positive('Gold taken value must be positive'),
    // Can legitimately be 0 when the gold value alone covers the full loan amount.
    cashGiven: z.number().min(0, 'Cash given cannot be negative'),
    itemDescription: z.string().trim().max(200).optional(),
    goldTokenNo: z.string().trim().max(100).optional(),
    remarks: z.string().trim().max(500).optional(),
});

const perLoanSchema = z.object({
    loanId: z.string().min(1),
    attendanceStatus: z.enum(['PRESENT', 'ABSENT']),
    admissionFee: z.number().min(0).default(0),
    isNewClient: z.boolean().default(false),
    // Per-member funder override — falls back to the batch-level `funderId`
    // below when not provided (see FUNDER SELECTION PRIORITY in the UI).
    funderId: z.string().min(1).optional(),
    goldLoanDetails: goldLoanDetailSchema.optional(),
});

const bmDisburseSchema = z.object({
    centerId: z.string().min(1, 'Center ID is required'),
    // Scopes the batch to one LoanIndex — also the stable key used for bulk
    // accounting-posting idempotency (see accounting-posting.service.ts).
    indexId: z.string().min(1, 'Index ID is required'),
    funderId: z.string().min(1, 'Funder is required'),
    disbursements: z.array(perLoanSchema).min(1, 'At least one loan is required'),
});

/**
 * Helper function to get next valid date (skipping Sundays)
 */
function getNextValidDate(date: Date): Date {
    const nextDate = new Date(date);
    // Check if the date is Sunday (0 = Sunday)
    if (nextDate.getDay() === 0) {
        nextDate.setDate(nextDate.getDate() + 1);
    }
    return nextDate;
}

/**
 * Helper function to calculate next due date based on frequency
 */
function calculateNextDueDate(currentDate: Date, frequency: string): Date {
    const nextDate = new Date(currentDate);
    
    switch (frequency.toLowerCase()) {
        case 'daily':
            nextDate.setDate(nextDate.getDate() + 1);
            return getNextValidDate(nextDate);
        case 'weekly':
            nextDate.setDate(nextDate.getDate() + 7);
            return getNextValidDate(nextDate);
        case 'forthnight':
            nextDate.setDate(nextDate.getDate() + 14);
            return getNextValidDate(nextDate);
        case 'monthly':
            nextDate.setDate(nextDate.getDate() + MONTHLY_INTERVAL_DAYS);
            return getNextValidDate(nextDate);
        case 'quarterly':
            nextDate.setDate(nextDate.getDate() + QUARTERLY_INTERVAL_DAYS);
            return getNextValidDate(nextDate);
        default:
            nextDate.setDate(nextDate.getDate() + 7);
            return getNextValidDate(nextDate);
    }
}

/**
 * Helper function to validate if a date matches the center's meeting day
 */
function validateMeetingDay(date: Date, meetingDay: string | null | undefined, frequency: string): { valid: boolean; message?: string } {
    if (frequency.toLowerCase() === 'daily' || !meetingDay) {
        return { valid: true };
    }
    
    const dateDay = date.getDay();
    const dayMap: Record<string, number> = {
        'SUNDAY': 0, 'MONDAY': 1, 'TUESDAY': 2, 'WEDNESDAY': 3,
        'THURSDAY': 4, 'FRIDAY': 5, 'SATURDAY': 6
    };
    
    const expectedDay = dayMap[meetingDay.toUpperCase()];
    if (expectedDay === undefined) return { valid: true };
    
    if (dateDay !== expectedDay) {
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        return {
            valid: false,
            message: `Due date must fall on center meeting day (${meetingDay}). Selected date is ${dayNames[dateDay]}.`
        };
    }
    return { valid: true };
}

/**
 * POST /api/disbursements/bm-disburse
 */
export async function POST(request: NextRequest) {
    return withRole(['BRANCH_MANAGER', 'ADMIN'], async (req, user) => {
        try {
            const body = await req.json();
            const { centerId, indexId, funderId, disbursements: allEntries } = bmDisburseSchema.parse(body);

            // ABSENT members are not disbursed in this batch: no money, fees, schedule or GL for them.
            // They stay APPROVED_LEVEL2 in the same index, so the BM can disburse them on the day they come.
            const disbursements = allEntries.filter((d) => d.attendanceStatus === 'PRESENT');
            if (disbursements.length === 0) {
                return errorResponse('All selected members are marked Absent — mark at least one member Present to disburse.', 400);
            }

            const center = await prisma.center.findUnique({
                where: { id: centerId },
                select: { id: true, branchId: true, code: true, name: true, meetingDay: true },
            });
            if (!center) return errorResponse('Center not found', 404);

            const lockResponse = await assertBranchNotLocked(center.branchId);
            if (lockResponse) return lockResponse;

            if (user.role === 'BRANCH_MANAGER') {
                // Allow disbursing at any branch the BM is assigned to (UserBranchAssignment),
                // not just their primary branch.
                const permittedBranchIds = await getPermittedBranchIds(user);
                if (permittedBranchIds !== null && !permittedBranchIds.includes(center.branchId)) {
                    return errorResponse('Center does not belong to one of your assigned branches', 403);
                }
            }

            // Disbursement/GL date is always the branch's current working day (not the
            // server's real wall-clock time) — matches the collection flow convention
            // (see app/api/collections/single-collection/route.ts) so a branch that
            // hasn't rolled EOD forward to today's real calendar date can still disburse.
            const workingDay = await getBranchWorkingDayWindow({ branchId: center.branchId });
            const disbursementDate = workingDay.dayStartUtc;

            const loanIds = disbursements.map((d) => d.loanId);
            const targetLoans = await prisma.loan.findMany({
                where: {
                    id: { in: loanIds },
                    centerId,
                    indexId,
                    isActive: true,
                    disbursementStatus: 'APPROVED_LEVEL2',
                },
                include: {
                    loanProduct: {
                        include: {
                            scheduleTemplates: { orderBy: { installmentNo: 'asc' } },
                            loanProductType: { select: { name: true } },
                        },
                    },
                    client: {
                        select: { clientId: true, firstName: true, lastName: true },
                    },
                },
            });

            if (targetLoans.length === 0) {
                // Recovery path: loans for this index may already be DISBURSED from a
                // prior attempt whose final bulk GL-posting step never completed (e.g.
                // a network blip after loan writes committed) — re-run just the
                // aggregation, which is idempotent per marker, instead of failing.
                const alreadyDisbursedCount = await prisma.loan.count({
                    where: { indexId, centerId, disbursementStatus: 'DISBURSED' },
                });
                // Index vouchers already exist => a previous (possibly partial-day) disbursement was
                // fully posted; re-running the aggregate would double-post it.
                const existingIndexVouchers = await prisma.financialTransaction.count({
                    where: { postingMarker: `${INDEX_DISBURSEMENT_POSTING_MARKER_PREFIX}${indexId}]`, isActive: true },
                });
                if (alreadyDisbursedCount > 0 && existingIndexVouchers === 0) {
                    const disbursementDateForRecovery = (await getBranchWorkingDayWindow({ branchId: center.branchId })).dayStartUtc;
                    const { voucherNos } = await prisma.$transaction(
                        (tx) => accountingPostingService.postIndexDisbursementAggregate({
                            tx,
                            indexId,
                            branchId: center.branchId,
                            centerCode: center.code || '',
                            centerName: center.name || center.code || 'Unknown Center',
                            createdById: user.userId,
                            createdByRole: user.role,
                            transactionDate: disbursementDateForRecovery,
                            loanIds,
                        }),
                        { maxWait: 15000, timeout: 30000 }
                    );
                    return successResponse(
                        { count: 0, centerId: center.id, voucherNos },
                        'Loans already disbursed for this index — accounting entries verified/completed'
                    );
                }
                return errorResponse('No APPROVED_LEVEL2 loans found for the given IDs in this center', 400);
            }

            // Member Individual + GRT gate (defense-in-depth — already checked at AM
            // Level-2 approval) — a member cannot be disbursed until Cash Flow, Loan
            // Appraisal and House Hold Visit are complete AND the client is covered
            // by a completed center-wide GRT session.
            const incompleteLoanIds = await findIncompleteMemberIndividualLoanIds(targetLoans);
            const incomplete = targetLoans.filter((l) => incompleteLoanIds.has(l.id));
            if (incomplete.length > 0) {
                const names = incomplete
                    .map((l) => `${l.client.clientId} (${l.client.firstName} ${l.client.lastName})`.trim())
                    .join(', ');
                return errorResponse(
                    `Cannot disburse — Member Individual not completed for: ${names}`,
                    400
                );
            }

            // First-due-date validation is anchored to the branch's EOD working date
            // (BranchLock.currentWorkingDate), NOT the server wall-clock date — a branch
            // whose EOD hasn't rolled forward to the real calendar date must still be able
            // to disburse against its own working day (matches disbursementDate above).
            //
            // Compared as pure UTC calendar-day timestamps on both sides. loan.firstDueDate
            // is persisted from a plain Y-M-D string (see loan-indexes/[indexId]/approve),
            // which JS parses as UTC midnight — not local midnight. Building today/maxDue
            // via `new Date(y, m-1, d)` (local server time) instead of UTC used to shift the
            // boundary by the server's UTC offset (e.g. IST's +5:30), so a due date exactly
            // 8 calendar days out (e.g. working date 03.09 -> due 11.09) was wrongly
            // rejected as if only 7 days were allowed — effectively double-counting the
            // working date itself. Working entirely in UTC-day timestamps removes that skew.
            const [wy, wm, wd] = workingDay.workingDateYmd.split('-').map(Number);
            const todayUTC = Date.UTC(wy, wm - 1, wd);
            const DAY_MS = 24 * 60 * 60 * 1000;
            const firstDueDateConfig = await getFirstDueDateConfig();

            for (const d of disbursements) {
                const loan = targetLoans.find((l) => l.id === d.loanId);

                if (!loan?.firstDueDate) {
                    return errorResponse(
                        `First due date is not set for loan ${loan?.loanNumber ?? d.loanId}. Set it on the Loan Index page before disbursing.`,
                        400
                    );
                }

                const firstDue = new Date(loan.firstDueDate);
                const firstDueUTC = Date.UTC(firstDue.getUTCFullYear(), firstDue.getUTCMonth(), firstDue.getUTCDate());

                if (firstDueUTC < todayUTC) {
                    return errorResponse(
                        `First due date for loan ${loan.loanNumber} must be on or after the branch working date`,
                        400
                    );
                }

                if (firstDueDateConfig.enabled && user.role !== 'ADMIN') {
                    const maxDueUTC = todayUTC + firstDueDateConfig.maxDays * DAY_MS;
                    if (firstDueUTC > maxDueUTC) {
                        return errorResponse(
                            `First due date for loan ${loan.loanNumber} must be within ${firstDueDateConfig.maxDays} days of the branch working date`,
                            400
                        );
                    }
                }

                const frequency = loan.frequency || 'weekly';
                const meetingValidation = validateMeetingDay(firstDue, center.meetingDay, frequency);
                if (!meetingValidation.valid) {
                    return errorResponse(
                        `For loan ${loan.loanNumber}: ${meetingValidation.message}`,
                        400
                    );
                }
            }

            // Validate gold loan details are provided for gold loan products
            const goldLoansInBatch: typeof targetLoans = [];
            for (const d of disbursements) {
                const loan = targetLoans.find((l) => l.id === d.loanId);
                const isGoldLoan = isGoldLoanProduct(loan?.loanProduct?.loanProductType?.name);
                if (isGoldLoan && !d.goldLoanDetails) {
                    return errorResponse(
                        `Gold loan details (karat type, gram count, gold value, cash given) are required for loan ${loan?.loanNumber ?? d.loanId}`,
                        400
                    );
                }
                if (isGoldLoan && loan) goldLoansInBatch.push(loan);
            }

            // At least one pledge photo is required before a gold loan can be
            // disbursed (anti-fraud control) — enforced here at BM final
            // disbursement only (not at AM Level-2 approval).
            if (goldLoansInBatch.length > 0) {
                const missingPhotoLoanIds = await findGoldLoansMissingPhoto(goldLoansInBatch);
                if (missingPhotoLoanIds.size > 0) {
                    const names = goldLoansInBatch
                        .filter((l) => missingPhotoLoanIds.has(l.id))
                        .map((l) => l.loanNumber)
                        .join(', ');
                    return errorResponse(
                        `At least one photo of the pledged gold is required before disbursement for loan(s): ${names}`,
                        400
                    );
                }
            }

            const inputMap = new Map(disbursements.map((d) => [d.loanId, d]));
            const BATCH_SIZE = 10;
            let processedCount = 0;

            for (let batchStart = 0; batchStart < targetLoans.length; batchStart += BATCH_SIZE) {
                const batch = targetLoans.slice(batchStart, batchStart + BATCH_SIZE);

                const processed = await prisma.$transaction(
                    async (tx) => {
                        const timestamp = Date.now().toString().slice(-6);
                        const allTransactions: any[] = [];
                        const loanUpdates: any[] = [];

                        for (let i = 0; i < batch.length; i++) {
                            const loan = batch[i];
                            const input = inputMap.get(loan.id)!;
                            const firstDueDate = new Date(loan.firstDueDate!);
                            const product = loan.loanProduct;
                            const randomIdx = Math.floor(Math.random() * 1000).toString().padStart(3, '0');

                            // Get advance savings amount from product (default to 0 if not set)
                            const advanceSavingsAmount = product?.advanceSavingsAmount 
                                ? Number(product.advanceSavingsAmount) 
                                : 0;

                            // Get frequency with fallback to 'weekly'
                            const frequency = loan.frequency || 'weekly';

                            // Generate schedule with savings amount
                            const scheduleItems = generateScheduleWithHolidaySkip(
                                {
                                    amount: loan.amount,
                                    interestRate: loan.interestRate,
                                    tenureMonths: loan.tenureMonths,
                                    frequency: frequency,
                                },
                                product
                                    ? {
                                          numberOfDues: product.numberOfDues,
                                          interestAmount: product.interestAmount,
                                          interestMethod: product.interestMethod ?? undefined,
                                          documentCharges: product.documentCharges,
                                          insuranceFees: product.insuranceFees,
                                          advanceSavingsAmount: advanceSavingsAmount,
                                      }
                                    : null,
                                firstDueDate,
                                product?.scheduleTemplates?.length
                                    ? (product.scheduleTemplates as any)
                                    : undefined,
                                frequency,
                                advanceSavingsAmount
                            );

                            await tx.loanSchedule.deleteMany({ where: { loanId: loan.id } });

                            if (scheduleItems.length > 0) {
                                await tx.loanSchedule.createMany({
                                    data: scheduleItems.map((item) => ({
                                        loanId: loan.id,
                                        installmentNo: item.installmentNo,
                                        dueDate: item.dueDate,
                                        principalDue: item.principalDue,
                                        interestDue: item.interestDue,
                                        feesDue: item.feesDue || 0,
                                        savingsDue: item.savingsDue || 0, // This will now have the advance savings amount
                                        totalDue: item.totalDue,
                                        status: 'PENDING',
                                    })) as any,
                                });
                            }

                            // Client Admission Fee transaction (for new clients)
                            if (input.isNewClient && input.admissionFee && Number(input.admissionFee) > 0) {
                                allTransactions.push({
                                    transactionId: `TXN-ADM-${center.code}-${timestamp}${batchStart + i}${randomIdx}`,
                                    loanId: loan.id,
                                    branchId: center.branchId,
                                    centerId: center.id,
                                    clientId: loan.clientId,
                                    amount: new Decimal(input.admissionFee.toString()),
                                    feesAmount: new Decimal(input.admissionFee.toString()),
                                    type: 'FEE' as const,
                                    paymentMode: 'CASH' as const,
                                    collectedById: user.userId,
                                    status: 'APPROVED' as const,
                                    approvedById: user.userId,
                                    approvedAt: disbursementDate,
                                    transactionDate: disbursementDate,
                                    description: 'Client Admission Fee',
                                    isReversed: false,
                                });
                            }

                            // Document charges transaction
                            if (product?.documentCharges && Number(product.documentCharges) > 0) {
                                allTransactions.push({
                                    transactionId: `TXN-DOC-${center.code}-${timestamp}${batchStart + i}${randomIdx}`,
                                    loanId: loan.id,
                                    branchId: center.branchId,
                                    centerId: center.id,
                                    clientId: loan.clientId,
                                    amount: new Decimal(product.documentCharges),
                                    feesAmount: new Decimal(product.documentCharges),
                                    type: 'FEE' as const,
                                    paymentMode: 'CASH' as const,
                                    collectedById: user.userId,
                                    status: 'APPROVED' as const,
                                    approvedById: user.userId,
                                    approvedAt: disbursementDate,
                                    transactionDate: disbursementDate,
                                    description: SYSTEM_LEDGERS.DOC_CHARGES.name,
                                    isReversed: false,
                                });
                            }

                            // Insurance fees transaction
                            if (product?.insuranceFees && Number(product.insuranceFees) > 0) {
                                allTransactions.push({
                                    transactionId: `TXN-INS-${center.code}-${timestamp}${batchStart + i}${randomIdx}`,
                                    loanId: loan.id,
                                    branchId: center.branchId,
                                    centerId: center.id,
                                    clientId: loan.clientId,
                                    amount: new Decimal(product.insuranceFees),
                                    feesAmount: new Decimal(product.insuranceFees),
                                    type: 'FEE' as const,
                                    paymentMode: 'CASH' as const,
                                    collectedById: user.userId,
                                    status: 'APPROVED' as const,
                                    approvedById: user.userId,
                                    approvedAt: disbursementDate,
                                    transactionDate: new Date(disbursementDate.getTime() + 10),
                                    description: SYSTEM_LEDGERS.INSURANCE_PAYABLE.name,
                                    isReversed: false,
                                });
                            }

                            // Main disbursement transaction
                            allTransactions.push({
                                transactionId: `TXN-DSB-${center.code}-${timestamp}${batchStart + i}${randomIdx}`,
                                loanId: loan.id,
                                branchId: center.branchId,
                                centerId: center.id,
                                clientId: loan.clientId,
                                amount: new Decimal(loan.amount.toString()),
                                principalAmount: new Decimal(loan.amount.toString()),
                                type: 'DISBURSEMENT' as const,
                                paymentMode: 'CASH' as const,
                                collectedById: user.userId,
                                status: 'APPROVED' as const,
                                approvedById: user.userId,
                                approvedAt: disbursementDate,
                                transactionDate: new Date(disbursementDate.getTime() + 20),
                                description: `Loan Disbursed by BM (${center.code})`,
                                isReversed: false,
                            });

                            // Per-member funder override (spec: FUNDER SELECTION PRIORITY) —
                            // falls back to the batch-level default when not overridden.
                            const effectiveFunderId = input.funderId || funderId;

                            loanUpdates.push({
                                id: loan.id,
                                loanData: {
                                    disbursementStatus: 'DISBURSED' as const,
                                    disbursedByBMId: user.userId,
                                    disbursedByBMAt: disbursementDate,
                                    attendanceStatus: input.attendanceStatus as any,
                                    firstDueDate,
                                    lastPaymentDate: null,
                                    principalPaid: new Decimal(0),
                                    interestPaid: new Decimal(0),
                                    penaltiesPaid: new Decimal(0),
                                    isActive: true,
                                    ...(effectiveFunderId ? { funderId: effectiveFunderId } : {}),
                                },
                                clientName: `${loan.client.firstName} ${loan.client.lastName}`.trim() || loan.client.clientId,
                            });
                        }

                        if (allTransactions.length > 0) {
                            await tx.loanTransaction.createMany({ data: allTransactions as any });
                        }

                        // Create Gold Loan records for gold loan products
                        for (const loan of batch) {
                            const input = inputMap.get(loan.id)!;
                            const isGoldLoan = isGoldLoanProduct(loan?.loanProduct?.loanProductType?.name);
                            if (isGoldLoan && input.goldLoanDetails) {
                                const gd = input.goldLoanDetails;
                                await tx.goldLoanDetail.create({
                                    data: {
                                        loanId: loan.id,
                                        karatType: gd.karatType,
                                        gramCount: gd.gramCount,
                                        goldTakenValue: gd.goldTakenValue,
                                        cashGiven: gd.cashGiven,
                                        itemDescription: gd.itemDescription,
                                        goldTokenNo: gd.goldTokenNo,
                                        remarks: gd.remarks,
                                    },
                                });
                                await tx.goldTransaction.create({
                                    data: {
                                        loanId: loan.id,
                                        type: 'TAKE',
                                        gramCount: gd.gramCount,
                                        goldValue: gd.goldTakenValue,
                                        status: 'APPROVED',
                                        initiatedById: user.userId,
                                        approvedById: user.userId,
                                        approvedAt: disbursementDate,
                                    },
                                });
                            }
                        }

                        // GL accounting is NOT posted per loan here — it's aggregated once
                        // for the whole index after all batches commit (see below), so a
                        // bulk disbursement produces one HO Borrow voucher, one voucher per
                        // distinct funder, one Processing Fees voucher and one Admission
                        // Fees voucher instead of one of each per loan.

                        for (const update of loanUpdates) {
                            await tx.loan.update({
                                where: { id: update.id },
                                data: update.loanData,
                            });
                        }

                        await recordLoanHistory(
                            tx,
                            loanUpdates.map((update) => ({
                                loanId: update.id,
                                action: 'BM_DISBURSED',
                                performedById: user.userId,
                                remarks: 'Final disbursement by BM',
                                previousState: 'APPROVED_LEVEL2',
                                newState: 'DISBURSED',
                            }))
                        );

                        return batch.length;
                    },
                    { maxWait: 30000, timeout: 60000, isolationLevel: 'ReadCommitted' }
                );

                processedCount += processed;
            }

            // Aggregate GL posting — one bulk voucher per ledger for the whole index,
            // run in its own (fast) transaction after all loan-writing batches commit.
            // Idempotent per marker, so a partial-failure retry is safe (see the
            // recovery branch above).
            const { voucherNos } = await prisma.$transaction(
                (tx) => accountingPostingService.postIndexDisbursementAggregate({
                    tx,
                    indexId,
                    branchId: center.branchId,
                    centerCode: center.code || '',
                    centerName: center.name || center.code || 'Unknown Center',
                    createdById: user.userId,
                    createdByRole: user.role,
                    transactionDate: disbursementDate,
                    // Only this batch's loans: earlier partial disbursements of the same index are already posted.
                    loanIds,
                }),
                { maxWait: 15000, timeout: 30000 }
            );

            await bumpLoanBalance(loanIds);

            return successResponse(
                { count: processedCount, centerId: center.id, voucherNos },
                `${processedCount} loan(s) disbursed successfully`
            );
        } catch (error: any) {
            if (error instanceof z.ZodError) {
                return errorResponse(
                    `Validation error: ${error.errors.map((e) => e.message).join(', ')}`,
                    400
                );
            }
            console.error('Error in BM disbursement:', error);
            return errorResponse(error.message || 'Failed to disburse loans', 500);
        }
    })(request);
}

/**
 * Generate schedule with Sunday skip logic and savings amount
 */
function generateScheduleWithHolidaySkip(
    loan: any,
    product: any | null,
    firstDueDate: Date,
    scheduleTemplates: any[] | undefined,
    frequency: string,
    advanceSavingsAmount: number
): any[] {
    if (scheduleTemplates && scheduleTemplates.length > 0) {
        return generateScheduleFromTemplates(scheduleTemplates, firstDueDate, frequency, advanceSavingsAmount);
    }
    return generateFlatRateSchedule(loan, product, firstDueDate, frequency, advanceSavingsAmount);
}

/**
 * Generate schedule from templates (for reducing balance loans) with savings
 */
function generateScheduleFromTemplates(
    templates: any[],
    firstDueDate: Date,
    frequency: string,
    advanceSavingsAmount: number
): any[] {
    const schedule: any[] = [];
    let currentDate = new Date(firstDueDate);
    
    for (let i = 0; i < templates.length; i++) {
        const template = templates[i];
        
        let dueDate: Date;
        if (i === 0) {
            dueDate = new Date(firstDueDate);
        } else {
            dueDate = calculateNextDueDate(currentDate, frequency);
        }
        
        dueDate = getNextValidDate(dueDate);
        
        const principalAmount = Number(template.principalAmount);
        const interestAmount = Number(template.interestAmount);
        const savingsDue = advanceSavingsAmount; // Add savings amount to each installment

        schedule.push({
            installmentNo: template.installmentNo || i + 1,
            dueDate,
            principalDue: Number(principalAmount.toFixed(2)),
            interestDue: Number(interestAmount.toFixed(2)),
            feesDue: 0,
            savingsDue: savingsDue,
            totalDue: Number((principalAmount + interestAmount).toFixed(2)),
        });
        
        currentDate = dueDate;
    }
    
    return schedule;
}

/**
 * Generate flat rate schedule with savings
 */
function generateFlatRateSchedule(
    loan: any,
    product: any | null,
    firstDueDate: Date,
    frequency: string,
    advanceSavingsAmount: number
): any[] {
    const schedule: any[] = [];
    const numberOfDues = product?.numberOfDues || loan.tenureMonths || 12;
    const principalPerInstallment = Number(loan.amount) / numberOfDues;
    const interestPerInstallment = (product?.interestAmount ? Number(product.interestAmount) : 0) / numberOfDues;
    
    let currentDate = new Date(firstDueDate);
    
    for (let i = 0; i < numberOfDues; i++) {
        let dueDate: Date;
        
        if (i === 0) {
            dueDate = new Date(firstDueDate);
        } else {
            dueDate = calculateNextDueDate(currentDate, frequency);
        }
        
        dueDate = getNextValidDate(dueDate);
        
        const principalDue = i === numberOfDues - 1 
            ? Number(loan.amount) - (principalPerInstallment * (numberOfDues - 1))
            : principalPerInstallment;
        
        const interestDue = i === numberOfDues - 1
            ? (product?.interestAmount ? Number(product.interestAmount) : 0) - (interestPerInstallment * (numberOfDues - 1))
            : interestPerInstallment;
        
        const savingsDue = advanceSavingsAmount; // Add savings amount to each installment

        schedule.push({
            installmentNo: i + 1,
            dueDate,
            principalDue: Number(principalDue.toFixed(2)),
            interestDue: Number(interestDue.toFixed(2)),
            feesDue: 0,
            savingsDue: savingsDue,
            totalDue: Number((principalDue + interestDue).toFixed(2)),
        });
        
        currentDate = dueDate;
    }
    
    return schedule;
}