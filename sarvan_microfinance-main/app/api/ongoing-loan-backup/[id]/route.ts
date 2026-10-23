import { NextRequest } from 'next/server';
import { Decimal } from '@prisma/client/runtime/library';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/db';
import { z } from 'zod';
import { getLoanAdvanceEnabled } from '@/app/lib/loan-advance-config';
import { assertFunderChangeAllowed } from '@/app/lib/revert-eod-guard';
import { MONTHLY_INTERVAL_DAYS, QUARTERLY_INTERVAL_DAYS } from '@/app/lib/loan-frequency';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const goldLoanDetailSchema = z.object({
    karatType: z.enum(['24K', '22K', '20K', '18K', '16K']),
    gramCount: z.number().positive('Gram count must be positive'),
    pricePerGram: z.number().positive('Price per gram must be positive'),
    goldTakenValue: z.number().nonnegative(),
    cashGiven: z.number().nonnegative(),
});

const updateBackupLoanSchema = z.object({
    loanProductId: z.string().min(1, 'Loan Product ID is required'),
    frequency: z.enum(['daily', 'weekly', 'forthnight', 'monthly', 'quarterly']),
    loanPurposeId: z.string().min(1, 'Loan Purpose ID is required'),
    disbursementDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    scheduleStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Schedule start date must be YYYY-MM-DD'),
    funderId: z.string().optional(),
    principalPaid: z.number().min(0, 'Principal paid cannot be negative').default(0),
    interestPaid: z.number().min(0, 'Interest paid cannot be negative').default(0),
    savingsPaid: z.number().min(0, 'Savings paid cannot be negative').default(0),
    goldLoanDetails: goldLoanDetailSchema.optional(),
});

// Helper functions (same as in route.ts for POST)

/**
 * Helper function to distribute payments across schedule installments
 *
 * `savingsPaid` is accepted for call-site signature parity with the caller's other
 * aggregate figures but deliberately NOT distributed across schedule rows — it's a
 * client-level wallet balance (Client.loanAdvance / Loan.savingsPaid, incremented by the
 * caller separately), not a per-installment collection. Smearing it across future,
 * not-yet-due installments made them look already-collected on the loan-advance/savings
 * component months or years before their actual due date.
 */
function distributePayments(
    scheduleItems: any[],
    principalPaid: number,
    interestPaid: number,
    savingsPaid: number,
    penaltiesPaid: number
): any[] {
    const result = scheduleItems.map((item) => ({
        ...item,
        principalPaid: 0,
        interestPaid: 0,
        savingsPaid: 0,
        penaltiesPaid: 0,
        totalPaid: 0,
    }));

    let remainingPrincipal = principalPaid;
    let remainingInterest = interestPaid;
    let remainingPenalties = penaltiesPaid;

    // Distribute payments across installments in order
    for (const item of result) {
        if (remainingPrincipal > 0) {
            const toAllocate = Math.min(remainingPrincipal, Number(item.principalDue));
            item.principalPaid = Number(toAllocate.toFixed(2));
            remainingPrincipal -= toAllocate;
        }

        if (remainingInterest > 0) {
            const toAllocate = Math.min(remainingInterest, Number(item.interestDue));
            item.interestPaid = Number(toAllocate.toFixed(2));
            remainingInterest -= toAllocate;
        }

        if (remainingPenalties > 0) {
            const toAllocate = Math.min(remainingPenalties, Number(item.penaltiesDue || 0) || remainingPenalties);
            item.penaltiesPaid = Number(toAllocate.toFixed(2));
            remainingPenalties -= toAllocate;
        }

        item.totalPaid = item.principalPaid + item.interestPaid + item.penaltiesPaid;
    }

    return result;
}

function getNextValidDate(date: Date): Date {
    const nextDate = new Date(date);
    if (nextDate.getDay() === 0) {
        nextDate.setDate(nextDate.getDate() + 1);
    }
    return nextDate;
}

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
        const savingsDue = advanceSavingsAmount;

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

        const principalDue =
            i === numberOfDues - 1
                ? Number(loan.amount) - principalPerInstallment * (numberOfDues - 1)
                : principalPerInstallment;

        const interestDue =
            i === numberOfDues - 1
                ? (product?.interestAmount ? Number(product.interestAmount) : 0) - interestPerInstallment * (numberOfDues - 1)
                : interestPerInstallment;

        const savingsDue = advanceSavingsAmount;

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

/**
 * PUT /api/ongoing-loan-backup/[id]
 * Update an existing backup loan and regenerate its schedule
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    return withRole(['ADMIN'], async (req, user) => {
        try {
            const { id: loanId } = await params;
            const body = await req.json();
            const validationResult = updateBackupLoanSchema.safeParse(body);

            if (!validationResult.success) {
                return errorResponse(
                    `Validation failed: ${validationResult.error.errors.map((e) => e.message).join(', ')}`,
                    400
                );
            }

            const input = validationResult.data;
            if (!(await getLoanAdvanceEnabled())) {
                input.savingsPaid = 0;
            }

            // Verify loan exists and is a backup loan (disbursed with no indexId)
            const existingLoan = await prisma.loan.findUnique({
                where: { id: loanId },
                include: {
                    loanProduct: {
                        select: {
                            id: true,
                            loanAmount: true,
                            interestRate: true,
                            numberOfDues: true,
                            interestAmount: true,
                            advanceSavingsAmount: true,
                        },
                    },
                },
            });

            if (!existingLoan) {
                return errorResponse('Backup loan not found', 404);
            }

            if (existingLoan.disbursementStatus !== 'DISBURSED' || existingLoan.indexId !== null) {
                return errorResponse('This is not a backup loan or has already been indexed', 400);
            }

            // This endpoint rebuilds the schedule from the product template + distributePayments
            // only — it ignores any Loan Card / Repayment history. For a loan that carries a
            // replayed history (`migratedLoanSource` set: bulk uploan import, or already edited
            // via the Loan History Edit tool), saving here would silently flatten that history
            // into a generic schedule. Send the user to the tool that preserves it.
            if (existingLoan.migratedLoanSource != null) {
                return errorResponse(
                    'This loan has a migrated Loan Card / Repayment history. Edit it at Masters → Upload → Loan History Edit (/dashboard/masters/uploan/loan-history), which rebuilds the real schedule + transactions — not here.',
                    409
                );
            }

            const funderChangeError = await assertFunderChangeAllowed(
                prisma,
                loanId,
                existingLoan.funderId,
                input.funderId || null
            );
            if (funderChangeError) return errorResponse(funderChangeError, 409);

            // Fetch new loan product with schedule templates
            const newLoanProduct = await prisma.loanProduct.findUnique({
                where: { id: input.loanProductId },
                include: {
                    scheduleTemplates: { orderBy: { installmentNo: 'asc' } },
                },
            });

            if (!newLoanProduct) {
                return errorResponse('New loan product not found', 404);
            }

            // Update loan in transaction
            const result = await prisma.$transaction(async (tx) => {
                // Update Loan record
                const updatedLoan = await tx.loan.update({
                    where: { id: loanId },
                    data: {
                        loanProductId: input.loanProductId,
                        frequency: input.frequency,
                        loanPurposeId: input.loanPurposeId,
                        funderId: input.funderId || null,
                        disbursedByBMAt: new Date(input.disbursementDate),
                        firstDueDate: new Date(input.scheduleStartDate),
                        principalPaid: new Decimal(input.principalPaid.toString()),
                        interestPaid: new Decimal(input.interestPaid.toString()),
                        savingsPaid: new Decimal(input.savingsPaid.toString()),
                        amount: new Decimal(newLoanProduct.loanAmount.toString()),
                        interestRate: new Decimal(newLoanProduct.interestRate.toString()),
                        tenureMonths: newLoanProduct.numberOfDues,
                    },
                });

                // Delete existing schedule
                await tx.loanSchedule.deleteMany({
                    where: { loanId },
                });

                // Generate new schedule
                const advanceSavingsAmount = newLoanProduct.advanceSavingsAmount
                    ? Number(newLoanProduct.advanceSavingsAmount)
                    : 0;

                const scheduleItems = generateScheduleWithHolidaySkip(
                    {
                        amount: newLoanProduct.loanAmount,
                        interestRate: newLoanProduct.interestRate,
                        tenureMonths: newLoanProduct.numberOfDues || 12,
                        frequency: input.frequency,
                    },
                    {
                        numberOfDues: newLoanProduct.numberOfDues,
                        interestAmount: newLoanProduct.interestAmount,
                        advanceSavingsAmount: advanceSavingsAmount,
                    },
                    new Date(input.scheduleStartDate),
                    newLoanProduct.scheduleTemplates?.length ? (newLoanProduct.scheduleTemplates as any) : undefined,
                    input.frequency,
                    advanceSavingsAmount
                );

                // Distribute paid amounts across schedule installments
                const schedulesWithPayments = distributePayments(
                    scheduleItems,
                    input.principalPaid,
                    input.interestPaid,
                    input.savingsPaid,
                    0
                );

                if (schedulesWithPayments.length > 0) {
                    await tx.loanSchedule.createMany({
                        data: schedulesWithPayments.map((item) => {
                            // Migrated loans' feesDue was already collected by the old
                            // software (see backup-loan.service.ts) — the fee obligation is
                            // dropped entirely here too (not just marked paid), and totalDue
                            // reduced by the same amount since the source's own totalDue
                            // bundles the fee in. Marking-as-paid instead of dropping was
                            // tried first and proved fragile: reverting a later collection
                            // reopens whatever it finds paid, which can reintroduce a fee gap
                            // that then intercepts a future real arrear payment.
                            const feesDueFromSource = Number(item.feesDue || 0);
                            const adjustedTotalDue = item.totalDue - feesDueFromSource;
                            const totalPaidForStatus = item.principalPaid + item.interestPaid + item.penaltiesPaid;
                            const scheduleStatus =
                                totalPaidForStatus >= adjustedTotalDue && adjustedTotalDue > 0
                                    ? 'PAID'
                                    : totalPaidForStatus > 0
                                    ? 'PARTIALLY_PAID'
                                    : 'PENDING';

                            return {
                                loanId,
                                installmentNo: item.installmentNo,
                                dueDate: item.dueDate,
                                principalDue: new Decimal(item.principalDue.toString()),
                                interestDue: new Decimal(item.interestDue.toString()),
                                penaltiesDue: new Decimal(item.penaltiesDue || 0),
                                feesDue: new Decimal(0),
                                feesPaid: new Decimal(0),
                                savingsDue: new Decimal(item.savingsDue || 0),
                                totalDue: new Decimal(adjustedTotalDue.toString()),
                                principalPaid: new Decimal(item.principalPaid.toString()),
                                interestPaid: new Decimal(item.interestPaid.toString()),
                                penaltiesPaid: new Decimal(item.penaltiesPaid.toString()),
                                savingsPaid: new Decimal(item.savingsPaid.toString()),
                                totalPaid: new Decimal(item.totalPaid.toString()),
                                status: scheduleStatus,
                                paidAt: scheduleStatus === 'PAID' ? new Date(input.disbursementDate) : null,
                            };
                        }) as any,
                    });
                }

                // Update or create gold loan detail
                if (input.goldLoanDetails) {
                    const goldDetails = input.goldLoanDetails;

                    // Delete existing gold detail if any
                    await tx.goldLoanDetail.deleteMany({
                        where: { loanId },
                    });

                    // Delete existing gold transaction if any
                    await tx.goldTransaction.deleteMany({
                        where: { loanId, type: 'TAKE' },
                    });

                    // Create new gold detail
                    await tx.goldLoanDetail.create({
                        data: {
                            loanId,
                            karatType: goldDetails.karatType,
                            gramCount: new Decimal(goldDetails.gramCount.toString()),
                            goldTakenValue: new Decimal(goldDetails.goldTakenValue.toString()),
                            cashGiven: new Decimal(goldDetails.cashGiven.toString()),
                        },
                    });

                    await tx.goldTransaction.create({
                        data: {
                            loanId,
                            type: 'TAKE',
                            gramCount: new Decimal(goldDetails.gramCount.toString()),
                            goldValue: new Decimal(goldDetails.goldTakenValue.toString()),
                            status: 'APPROVED',
                            initiatedById: user.userId,
                            approvedById: user.userId,
                            approvedAt: new Date(input.disbursementDate),
                        },
                    });
                } else {
                    // Delete existing gold detail and transaction if no gold details in update
                    await tx.goldLoanDetail.deleteMany({
                        where: { loanId },
                    });

                    // Delete existing gold transaction if any
                    await tx.goldTransaction.deleteMany({
                        where: { loanId, type: 'TAKE' },
                    });
                }

                // Adjust client's loanAdvance by the difference between new and old savingsPaid
                const oldSavingsPaid = Number(existingLoan.savingsPaid);
                const newSavingsPaid = input.savingsPaid;
                const savingsDiff = newSavingsPaid - oldSavingsPaid;

                if (savingsDiff !== 0) {
                    await tx.client.update({
                        where: { id: existingLoan.clientId },
                        data: {
                            loanAdvance: {
                                increment: new Decimal(savingsDiff.toString()),
                            },
                        },
                    });
                }

                return updatedLoan;
            });

            return successResponse(
                {
                    loanId: result.id,
                    loanNumber: result.loanNumber,
                    message: 'Backup loan updated successfully with new schedule',
                }
            );
        } catch (error) {
            console.error('Error updating backup loan:', error);
            return errorResponse(
                error instanceof Error ? error.message : 'Failed to update backup loan',
                500
            );
        }
    })(request);
}
