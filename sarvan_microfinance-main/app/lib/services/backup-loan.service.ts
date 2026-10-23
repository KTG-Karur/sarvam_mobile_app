import { Decimal } from '@prisma/client/runtime/library';
import type { Prisma, ScheduleStatus } from '@prisma/client';
import { getKolkataCalendarYmd } from '@/app/lib/branch-lock';
import type { ParsedLoanCardReport, ParsedRepaymentReport, RepaymentEvent } from '@/app/lib/services/uploan-loan-history.service';
import {
    allocateTransactionLines,
    allocateTransactionLinesFromComponentBudgets,
    type TransactionLinePlan,
} from '@/app/lib/loan-transaction-lines';
import { MONTHLY_INTERVAL_DAYS, QUARTERLY_INTERVAL_DAYS } from '@/app/lib/loan-frequency';

/**
 * Creates a "backup" (already-disbursed) loan with a schedule and a real
 * transaction trail — so migrated history is first-class LoanTransaction(s),
 * not just a silent balance stamp, and shows up in the same reports
 * (CCR/DCB/ledgers) that key off LoanTransactionLine.
 *
 * Two entry points:
 * - `createBackupLoanWithHistory` — generic path: schedule generated from the
 *   LoanProduct template, one aggregate migrated-payment transaction. Used by
 *   the single-entry "Ongoing Loan Backup" form, and as the upload fallback
 *   when a member has no Loan Card / Repayment Report.
 * - `createBackupLoanFromReports` — precise path: schedule taken verbatim from
 *   a Loan Card Report (exact per-installment principal/interest/dates), and
 *   the transaction trail replayed event-by-event from a Repayment Report
 *   (including Wallet Advance/Pay, mapped onto Sarvan's Loan Advance /
 *   savingsPaid). Falls back per-piece to the generic behavior when either
 *   report is missing for a given loan.
 *
 * Must be called inside the caller's prisma.$transaction() callback.
 */

export interface GoldLoanDetailsInput {
    karatType: '24K' | '22K' | '20K' | '18K' | '16K';
    gramCount: number;
    goldTakenValue: number;
    cashGiven: number;
    goldTokenNo?: string;
    itemDescription?: string;
}

export interface CreateBackupLoanInput {
    clientId: string;
    centerId: string;
    branchId: string;
    loanProductId: string;
    loanPurposeId: string;
    frequency: string;
    disbursementDate: Date;
    scheduleStartDate: Date;
    funderId?: string | null;
    principalPaid: number;
    interestPaid: number;
    savingsPaid: number;
    /** Date of the last historical repayment, if known — used as the migrated transaction's date. */
    lastRepayDate?: Date | null;
    goldLoanDetails?: GoldLoanDetailsInput;
    createdById: string;
    /** Employee who actually collected this history (resolved from the Loan Card Report's
     * "Loan Officer" name against the branch's employees) — stamped as each migrated
     * transaction's collectedById. Falls back to createdById when not resolved (e.g. the
     * generic no-report backup-loan path, which never carries a Loan Card Report). */
    loanOfficerId?: string;
    /** Uploan-import-only override: use this exact loanNumber (the source file's "Loan
     *  MemberID", preserved verbatim) instead of generating one. Left unset by every other
     *  caller (e.g. the "Ongoing Loan Backup" form), which keeps getting an auto-generated
     *  LN{yy}{seq} number as before. */
    loanNumberOverride?: string;
}

export interface CreateBackupLoanResult {
    loanId: string;
    loanNumber: string;
    transactionId: string | null;
}

export interface ScheduleItem {
    installmentNo: number;
    dueDate: Date;
    principalDue: number;
    interestDue: number;
    feesDue: number;
    savingsDue: number;
    totalDue: number;
    penaltiesDue?: number;
}

interface ScheduleItemWithPayments extends ScheduleItem {
    principalPaid: number;
    interestPaid: number;
    savingsPaid: number;
    penaltiesPaid: number;
    totalPaid: number;
}

export interface ScheduleTemplateLike {
    installmentNo?: number | null;
    // Prisma Decimal, string, or number — always safe to pass through String()/Number().
    principalAmount: unknown;
    interestAmount: unknown;
}

function getNextValidDate(date: Date): Date {
    const nextDate = new Date(date);
    if (nextDate.getDay() === 0) {
        nextDate.setDate(nextDate.getDate() + 1);
    }
    return nextDate;
}

/** Exported for reuse by uploan-branch-repayment.service.ts, which needs to step one due
 *  date forward from a migrated loan's last actually-collected installment before handing
 *  it to generateScheduleFromTemplates as that function's firstDueDate. */
export function calculateNextDueDate(currentDate: Date, frequency: string): Date {
    const nextDate = new Date(currentDate);

    switch (frequency.toLowerCase()) {
        case 'daily':
            nextDate.setDate(nextDate.getDate() + 1);
            return getNextValidDate(nextDate);
        case 'weekly':
            nextDate.setDate(nextDate.getDate() + 7);
            return getNextValidDate(nextDate);
        case 'forthnight':
        case 'biweekly':
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

/** `savingsPaid` is accepted for call-site signature parity with the caller's other
 *  aggregate figures but deliberately NOT distributed across schedule rows — it's a
 *  client-level wallet balance (Client.loanAdvance / Loan.savingsPaid, incremented by the
 *  caller separately), not a per-installment collection. Smearing it across future,
 *  not-yet-due installments made them look already-collected on the loan-advance/savings
 *  component months or years before their actual due date. */
function distributePayments(
    scheduleItems: ScheduleItem[],
    principalPaid: number,
    interestPaid: number,
    savingsPaid: number,
    penaltiesPaid: number
): ScheduleItemWithPayments[] {
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

/** Exported for reuse by uploan-branch-repayment.service.ts, which slices a LoanProduct's
 *  own scheduleTemplates for the not-yet-collected tail of a migrated loan's schedule and
 *  needs the same due-date stepping used everywhere else in this file. */
export function generateScheduleFromTemplates(
    templates: ScheduleTemplateLike[],
    firstDueDate: Date,
    frequency: string,
    advanceSavingsAmount: number
): ScheduleItem[] {
    const schedule: ScheduleItem[] = [];
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

        const principalAmount = Number(String(template.principalAmount));
        const interestAmount = Number(String(template.interestAmount));

        schedule.push({
            installmentNo: template.installmentNo || i + 1,
            dueDate,
            principalDue: Number(principalAmount.toFixed(2)),
            interestDue: Number(interestAmount.toFixed(2)),
            feesDue: 0,
            savingsDue: advanceSavingsAmount,
            totalDue: Number((principalAmount + interestAmount).toFixed(2)),
        });

        currentDate = dueDate;
    }

    return schedule;
}

function generateFlatRateSchedule(
    loan: { amount: number; interestRate: number; tenureMonths: number },
    product: { numberOfDues?: number | null; interestAmount?: number | null } | null,
    firstDueDate: Date,
    frequency: string,
    advanceSavingsAmount: number
): ScheduleItem[] {
    const schedule: ScheduleItem[] = [];
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

        schedule.push({
            installmentNo: i + 1,
            dueDate,
            principalDue: Number(principalDue.toFixed(2)),
            interestDue: Number(interestDue.toFixed(2)),
            feesDue: 0,
            savingsDue: advanceSavingsAmount,
            totalDue: Number((principalDue + interestDue).toFixed(2)),
        });

        currentDate = dueDate;
    }

    return schedule;
}

function generateScheduleWithHolidaySkip(
    loan: { amount: number; interestRate: number; tenureMonths: number },
    product: { numberOfDues?: number | null; interestAmount?: number | null } | null,
    firstDueDate: Date,
    scheduleTemplates: ScheduleTemplateLike[] | undefined,
    frequency: string,
    advanceSavingsAmount: number
): ScheduleItem[] {
    if (scheduleTemplates && scheduleTemplates.length > 0) {
        return generateScheduleFromTemplates(scheduleTemplates, firstDueDate, frequency, advanceSavingsAmount);
    }
    return generateFlatRateSchedule(loan, product, firstDueDate, frequency, advanceSavingsAmount);
}

/** Maps a Loan Card Report's exact per-installment rows onto the same shape the generic generator produces. */
function buildScheduleFromLoanCardReport(report: ParsedLoanCardReport): ScheduleItem[] {
    return report.scheduleRows.map((row) => ({
        installmentNo: row.installmentNo,
        dueDate: new Date(row.dueDate),
        principalDue: row.principalDue,
        interestDue: row.interestDue,
        feesDue: row.feesDue,
        savingsDue: row.savingsDue,
        totalDue: row.totalDue,
    }));
}

/**
 * Reconstructs a per-installment repayment ledger straight from the Loan Card Report's
 * own Received Date / Received Amount columns — used when no separate Repayment Report
 * was uploaded for this member. Without this, every historical payment collapses into a
 * single aggregate transaction dated once (at disbursement), which desyncs each
 * already-paid installment's "collected" signal from its real collection date and makes
 * the Dashboard's per-day demand/collection table show it as still "Yet to Collect"
 * forever — even though the LoanSchedule itself is marked PAID.
 */
function buildSyntheticEventsFromLoanCardReport(report: ParsedLoanCardReport): RepaymentEvent[] {
    const events: RepaymentEvent[] = [];
    for (const row of report.scheduleRows) {
        if (!row.receivedDate || row.receivedAmount == null || row.receivedAmount <= 0) continue;

        const emiDue = Number((row.principalDue + row.interestDue).toFixed(2));
        const emiPaid = Math.min(row.receivedAmount, emiDue);
        const principalAmount = Number(Math.min(row.principalDue, emiPaid).toFixed(2));
        const interestAmount = Number(Math.max(0, emiPaid - principalAmount).toFixed(2));

        events.push({
            dueNo: String(row.installmentNo),
            dueDate: row.dueDate,
            dueAmount: emiDue,
            transactionDate: row.receivedDate,
            transactionType: 'Demand Collection',
            amount: Number((principalAmount + interestAmount).toFixed(2)),
            principalAmount,
            interestAmount,
            loanBalance: row.outstandingBalance,
            // Any excess over the EMI (e.g. a loan advance bundled into Received Amount) is
            // picked up separately by the loanCardByInstallment fallback in
            // replayRepaymentEvents, not here — kept at 0 so it isn't double-applied.
            walletAdvanceAmount: 0,
            walletAdvanceDate: null,
            walletPayAmount: 0,
            walletPayDate: null,
            walletBalance: 0,
        });
    }
    return events;
}

/** Exported for reuse by closed-member-import-row.service.ts's bare-shell Loan path
 *  (no LoanProduct/createLoanRecord involved there, so it needs to generate its own
 *  loanNumber directly). */
export async function generateLoanNumber(tx: Prisma.TransactionClient, attempt = 0): Promise<string> {
    const MAX_ATTEMPTS = 5;
    const istYmd = getKolkataCalendarYmd(new Date());
    const year = Number(istYmd.slice(0, 4));
    const yearSuffix = year.toString().slice(-2);
    const prefix = `LN${yearSuffix}`;

    const lastLoan = await tx.loan.findFirst({
        where: { loanNumber: { startsWith: prefix } },
        orderBy: { loanNumber: 'desc' },
        select: { loanNumber: true },
    });

    let sequentialNumber = 1;
    if (lastLoan) {
        const lastNumber = parseInt(lastLoan.loanNumber.slice(-6), 10);
        sequentialNumber = lastNumber + 1;
    }

    const newLoanNumber = `${prefix}${sequentialNumber.toString().padStart(6, '0')}`;

    const exists = await tx.loan.findUnique({
        where: { loanNumber: newLoanNumber },
        select: { id: true },
    });

    if (exists && attempt < MAX_ATTEMPTS) {
        return generateLoanNumber(tx, attempt + 1);
    }

    return newLoanNumber;
}

export type LoanProductWithTemplates = NonNullable<Awaited<ReturnType<typeof fetchLoanProduct>>>;

/** Exported for reuse by uploan-import.service.ts, which needs a row's resolved
 *  LoanProduct's scheduleTemplates to build that row's migrated schedule tail. */
export async function fetchLoanProduct(tx: Prisma.TransactionClient, loanProductId: string) {
    return tx.loanProduct.findUnique({
        where: { id: loanProductId },
        include: { scheduleTemplates: { orderBy: { installmentNo: 'asc' } } },
    });
}

async function createLoanRecord(
    tx: Prisma.TransactionClient,
    loanProduct: LoanProductWithTemplates,
    input: CreateBackupLoanInput
) {
    const loanNumber = input.loanNumberOverride ?? (await generateLoanNumber(tx));

    const loan = await tx.loan.create({
        data: {
            loanNumber,
            clientId: input.clientId,
            centerId: input.centerId,
            branchId: input.branchId,
            applicationStatus: 'VERIFIED',
            disbursementStatus: 'DISBURSED',
            amount: new Decimal(loanProduct.loanAmount.toString()),
            interestRate: new Decimal(loanProduct.interestRate.toString()),
            tenureMonths: loanProduct.numberOfDues,
            frequency: input.frequency,
            createdById: input.createdById,
            verifiedById: input.createdById,
            verifiedAt: new Date(),
            disbursedByBMId: input.createdById,
            disbursedByBMAt: input.disbursementDate,
            firstDueDate: input.scheduleStartDate,
            loanProductId: input.loanProductId,
            loanPurposeId: input.loanPurposeId,
            funderId: input.funderId || null,
            principalPaid: new Decimal(input.principalPaid.toString()),
            interestPaid: new Decimal(input.interestPaid.toString()),
            isActive: true,
            // loanNumberOverride is only ever supplied by the bulk uploan-member import
            // (see its doc comment above) — never by the single-entry "Ongoing Loan Backup"
            // form — so this precisely tags loans that came from that bulk import.
            isBulkMemberImport: Boolean(input.loanNumberOverride),
        },
    });

    return { loan, loanNumber };
}

/** Exported for reuse by closed-member-import-row.service.ts's bare-shell Loan path,
 *  which needs to attach gold directly to a Loan it created itself (no product/schedule
 *  involved), the same way createBackupLoanWithHistory/createBackupLoanFromReports do. */
export async function createGoldLoanRecords(
    tx: Prisma.TransactionClient,
    loanId: string,
    input: Pick<CreateBackupLoanInput, 'goldLoanDetails' | 'createdById' | 'disbursementDate'>
) {
    if (!input.goldLoanDetails) return;
    const gd = input.goldLoanDetails;

    await tx.goldLoanDetail.create({
        data: {
            loanId,
            karatType: gd.karatType,
            gramCount: new Decimal(gd.gramCount.toString()),
            goldTakenValue: new Decimal(gd.goldTakenValue.toString()),
            cashGiven: new Decimal(gd.cashGiven.toString()),
            goldTokenNo: gd.goldTokenNo || null,
            itemDescription: gd.itemDescription || null,
        },
    });

    await tx.goldTransaction.create({
        data: {
            loanId,
            type: 'TAKE',
            gramCount: new Decimal(gd.gramCount.toString()),
            goldValue: new Decimal(gd.goldTakenValue.toString()),
            status: 'APPROVED',
            initiatedById: input.createdById,
            approvedById: input.createdById,
            approvedAt: input.disbursementDate,
        },
    });
}

/**
 * Creates the schedule (with paid amounts stamped) + one aggregate migrated
 * REPAYMENT transaction from a lump paid-to-date figure. Shared by the
 * generic no-report path and the report path's fallback when a Loan Card
 * Report exists but no Repayment Report does (exact schedule, aggregate txn).
 */
async function applyAggregatePaymentAndSchedule(
    tx: Prisma.TransactionClient,
    loanId: string,
    loanNumber: string,
    input: CreateBackupLoanInput,
    scheduleItems: ScheduleItem[]
): Promise<string | null> {
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
                // Migrated loans' feesDue is whatever the old software's Loan Card Report
                // recorded — that fee was already collected there, not owed to this
                // system, so it's dropped entirely at import (never just marked "paid")
                // rather than left outstanding. Marking-as-paid instead of dropping was
                // tried first and proved fragile: reverting ANY later collection on the
                // same loan reopens whatever it finds paid, which can reintroduce a fee
                // gap that then intercepts a future real arrear payment ahead of
                // principal/interest. totalDue is reduced by the same amount since the
                // source's own totalDue bundles the fee in.
                const feesDueFromSource = Number(item.feesDue || 0);
                const adjustedTotalDue = item.totalDue - feesDueFromSource;
                const totalPaidForStatus = item.principalPaid + item.interestPaid + item.penaltiesPaid;
                const scheduleStatus: ScheduleStatus =
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
                    paidAt: scheduleStatus === 'PAID' ? input.disbursementDate : null,
                };
            }),
        });
    }

    if (input.savingsPaid > 0) {
        // Recorded only as the loan/client aggregate wallet balance — NOT distributed onto
        // individual LoanSchedule.savingsPaid rows (see distributePayments' doc comment for
        // why: it's a carried-over balance, not a per-installment collection).
        await tx.loan.update({
            where: { id: loanId },
            data: { savingsPaid: { increment: new Decimal(input.savingsPaid.toString()) } },
        });
        await tx.client.update({
            where: { id: input.clientId },
            data: { loanAdvance: { increment: new Decimal(input.savingsPaid.toString()) } },
        });
    }

    const totalHistoricalPaid = input.principalPaid + input.interestPaid;
    if (totalHistoricalPaid <= 0 || schedulesWithPayments.length === 0) return null;

    const createdSchedules = await tx.loanSchedule.findMany({
        where: { loanId },
        orderBy: { installmentNo: 'asc' },
        select: { id: true, installmentNo: true },
    });
    const scheduleIdByInstallment = new Map(createdSchedules.map((s) => [s.installmentNo, s.id]));

    const lines = schedulesWithPayments
        .filter((item) => item.principalPaid > 0 || item.interestPaid > 0)
        .map((item) => {
            const scheduleId = scheduleIdByInstallment.get(item.installmentNo);
            if (!scheduleId) return null;
            const lineTotal = Number((item.principalPaid + item.interestPaid).toFixed(2));
            return {
                scheduleId,
                installmentNo: item.installmentNo,
                principalAmount: new Decimal(item.principalPaid.toFixed(2)),
                interestAmount: new Decimal(item.interestPaid.toFixed(2)),
                feesAmount: new Decimal(0),
                penaltyAmount: new Decimal(0),
                lineTotal: new Decimal(lineTotal),
            };
        })
        .filter((line): line is NonNullable<typeof line> => line !== null);

    const transactionId = `TXN-BKP-${loanNumber}-${Date.now().toString().slice(-6)}`;
    const transactionDate = input.lastRepayDate ?? input.disbursementDate;

    await tx.loanTransaction.create({
        data: {
            transactionId,
            loanId,
            branchId: input.branchId,
            centerId: input.centerId,
            clientId: input.clientId,
            amount: new Decimal(totalHistoricalPaid.toFixed(2)),
            type: 'REPAYMENT' as const,
            paymentMode: 'CASH' as const,
            collectedById: input.loanOfficerId ?? input.createdById,
            transactionDate,
            status: 'APPROVED' as const,
            approvedById: input.createdById,
            approvedAt: new Date(),
            principalAmount: new Decimal(input.principalPaid.toFixed(2)),
            interestAmount: new Decimal(input.interestPaid.toFixed(2)),
            feesAmount: new Decimal(0),
            penaltyAmount: new Decimal(0),
            description: 'Migrated repayment history (backup loan import)',
            lines: lines.length > 0 ? { create: lines } : undefined,
            excludeFromEodAllocation: true,
        },
    });

    return transactionId;
}

export async function createBackupLoanWithHistory(
    tx: Prisma.TransactionClient,
    input: CreateBackupLoanInput
): Promise<CreateBackupLoanResult> {
    const loanProduct = await fetchLoanProduct(tx, input.loanProductId);
    if (!loanProduct) throw new Error('Loan product not found');

    const { loan, loanNumber } = await createLoanRecord(tx, loanProduct, input);

    const advanceSavingsAmount = loanProduct.advanceSavingsAmount ? Number(loanProduct.advanceSavingsAmount) : 0;
    const scheduleItems = generateScheduleWithHolidaySkip(
        {
            amount: Number(loanProduct.loanAmount),
            interestRate: Number(loanProduct.interestRate),
            tenureMonths: loanProduct.numberOfDues || 12,
        },
        {
            numberOfDues: loanProduct.numberOfDues,
            interestAmount: loanProduct.interestAmount ? Number(loanProduct.interestAmount) : null,
        },
        input.scheduleStartDate,
        loanProduct.scheduleTemplates?.length ? loanProduct.scheduleTemplates : undefined,
        input.frequency,
        advanceSavingsAmount
    );

    await createGoldLoanRecords(tx, loan.id, input);
    const transactionId = await applyAggregatePaymentAndSchedule(tx, loan.id, loanNumber, input, scheduleItems);

    // Aggregate (no-report) path — still a backup loan the Loan History Edit tool can pick
    // up; stamp the money figures so a later edit round-trips the same aggregate.
    await stampMigratedLoanSource(tx, loan.id, input as CreateBackupLoanFromReportsInput);

    return { loanId: loan.id, loanNumber, transactionId };
}

export interface CreateBackupLoanFromReportsInput extends CreateBackupLoanInput {
    loanCardReport?: ParsedLoanCardReport;
    repaymentReport?: ParsedRepaymentReport;
}

/**
 * Report-driven variant: Loan Card Report's exact schedule wins over generic
 * generation; every paid/status column is derived by replaying a real per-installment
 * event ledger — the Repayment Report's own events when one was uploaded, otherwise one
 * synthesized from the Loan Card Report's Received Date/Amount columns (see
 * buildSyntheticEventsFromLoanCardReport — this is what keeps each installment's
 * "collected" signal dated on its actual collection day instead of collapsing into one
 * lump transaction, which is what the Dashboard's per-day demand/collection table keys
 * off). Falls back to `createBackupLoanWithHistory`'s aggregate behavior only when
 * neither report is present at all.
 */
export async function createBackupLoanFromReports(
    tx: Prisma.TransactionClient,
    input: CreateBackupLoanFromReportsInput
): Promise<CreateBackupLoanResult> {
    if (!input.loanCardReport && !input.repaymentReport) {
        return createBackupLoanWithHistory(tx, input);
    }

    const loanProduct = await fetchLoanProduct(tx, input.loanProductId);
    if (!loanProduct) throw new Error('Loan product not found');

    // Every path below replays an event ledger, which is the sole source of truth for
    // Loan.principalPaid/interestPaid (incremented per event further down) — seeding them
    // again here from input.principalPaid/interestPaid (the main Excel's aggregate figure)
    // would double-count every paid installment.
    const { loan, loanNumber } = await createLoanRecord(tx, loanProduct, { ...input, principalPaid: 0, interestPaid: 0 });
    await stampMigratedLoanSource(tx, loan.id, input);

    return applyBackupLoanHistory(tx, loan.id, loanNumber, input);
}

/**
 * The apply-half of `createBackupLoanFromReports`, split out verbatim so the Loan History
 * Edit tool (PUT /api/uploan/loan-history/loans/[loanId]) can wipe an existing backup
 * loan's schedule + transaction trail and rebuild it from an edited Loan Card / Repayment
 * grid — WITHOUT creating a new Loan record. A pure function of `(tx, loanId, loanNumber,
 * input)`: gold records → schedule (Loan Card exact, or generic) → event replay → savings
 * lump. Behavior for the `createBackupLoanFromReports` caller is unchanged.
 *
 * Callers MUST have already reset `Loan.principalPaid/interestPaid/savingsPaid` to 0 and
 * deleted any existing LoanSchedule/LoanTransaction/Gold rows for this loan — replay uses
 * `increment` and `createMany`, it does not upsert.
 */
export async function applyBackupLoanHistory(
    tx: Prisma.TransactionClient,
    loanId: string,
    loanNumber: string,
    input: CreateBackupLoanFromReportsInput
): Promise<CreateBackupLoanResult> {
    const loanProduct = await fetchLoanProduct(tx, input.loanProductId);
    if (!loanProduct) throw new Error('Loan product not found');

    await createGoldLoanRecords(tx, loanId, input);

    const advanceSavingsAmount = loanProduct.advanceSavingsAmount ? Number(loanProduct.advanceSavingsAmount) : 0;
    const scheduleItems = input.loanCardReport
        ? buildScheduleFromLoanCardReport(input.loanCardReport)
        : generateScheduleWithHolidaySkip(
              {
                  amount: Number(loanProduct.loanAmount),
                  interestRate: Number(loanProduct.interestRate),
                  tenureMonths: loanProduct.numberOfDues || 12,
              },
              {
                  numberOfDues: loanProduct.numberOfDues,
                  interestAmount: loanProduct.interestAmount ? Number(loanProduct.interestAmount) : null,
              },
              input.scheduleStartDate,
              loanProduct.scheduleTemplates?.length ? loanProduct.scheduleTemplates : undefined,
              input.frequency,
              advanceSavingsAmount
          );

    const events = input.repaymentReport
        ? input.repaymentReport.events
        : buildSyntheticEventsFromLoanCardReport(input.loanCardReport!);

    const result = await replayRepaymentEvents(tx, loanId, loanNumber, input, scheduleItems, events);

    // Unlike the aggregate no-report path (applyAggregatePaymentAndSchedule), the event
    // ledger replayed above never touches input.savingsPaid — the report/events shape has
    // no field for it. Post it here as one lump SAVINGS_COLLECTION so migrated
    // thrift/savings (e.g. the uploan branch-repayment flow's Thrift1+Thrift2) isn't
    // silently dropped, dated on the last collected event (falls back to lastRepayDate/
    // disbursementDate when there were no events at all, e.g. a brand-new loan).
    if (input.savingsPaid > 0) {
        const lastEventDate =
            events.length > 0
                ? new Date(Math.max(...events.map((e) => new Date(e.transactionDate).getTime())))
                : input.lastRepayDate ?? input.disbursementDate;
        await applySavingsLumpSum(tx, loanId, loanNumber, input, lastEventDate);
    }

    return result;
}

/**
 * Snapshots the exact source a backup/migrated loan's schedule + transaction trail was
 * replayed from onto `Loan.migratedLoanSource`, so the Loan History Edit tool
 * (/dashboard/masters/uploan/loan-history) can later edit and losslessly re-replay it.
 * One extra UPDATE per imported loan — negligible against the ~60 transactions/row a
 * migrated loan already writes.
 */
async function stampMigratedLoanSource(
    tx: Prisma.TransactionClient,
    loanId: string,
    input: CreateBackupLoanFromReportsInput
): Promise<void> {
    await tx.loan.update({
        where: { id: loanId },
        data: {
            migratedLoanSource: {
                loanCard: input.loanCardReport ?? null,
                repayment: input.repaymentReport ?? null,
                savingsPaid: input.savingsPaid,
                principalPaid: input.principalPaid,
                interestPaid: input.interestPaid,
            } as unknown as Prisma.InputJsonValue,
        },
    });
}

/** Posts a migrated loan's total savings/thrift figure as one SAVINGS_COLLECTION
 *  transaction + the matching Loan.savingsPaid/Client.loanAdvance increments — same
 *  shape as the per-event wallet-advance postings in replayRepaymentEvents, but for a
 *  single aggregate figure the source report has no per-installment breakdown for. */
async function applySavingsLumpSum(
    tx: Prisma.TransactionClient,
    loanId: string,
    loanNumber: string,
    input: CreateBackupLoanFromReportsInput,
    transactionDate: Date
): Promise<void> {
    const transactionId = `TXN-BKP-${loanNumber}-${Date.now().toString().slice(-6)}-THR`;

    await tx.loanTransaction.create({
        data: {
            transactionId,
            loanId,
            branchId: input.branchId,
            centerId: input.centerId,
            clientId: input.clientId,
            amount: new Decimal(input.savingsPaid.toFixed(2)),
            type: 'SAVINGS_COLLECTION' as const,
            paymentMode: 'CASH' as const,
            collectedById: input.loanOfficerId ?? input.createdById,
            transactionDate,
            status: 'APPROVED' as const,
            approvedById: input.createdById,
            approvedAt: new Date(),
            description: 'Migrated thrift/savings (backup loan import) — aggregate lump sum',
            excludeFromEodAllocation: true,
        },
    });
    await tx.loan.update({
        where: { id: loanId },
        data: { savingsPaid: { increment: new Decimal(input.savingsPaid.toFixed(2)) } },
    });
    await tx.client.update({
        where: { id: input.clientId },
        data: { loanAdvance: { increment: new Decimal(input.savingsPaid.toFixed(2)) } },
    });
}

/**
 * Replays a per-installment event ledger (real, from a Repayment Report, or synthesized
 * from a Loan Card Report's Received Date/Amount columns) onto a freshly-created backup
 * loan: schedule starts untouched (PENDING) and every paid/status column is derived here.
 */
async function replayRepaymentEvents(
    tx: Prisma.TransactionClient,
    loanId: string,
    loanNumber: string,
    input: CreateBackupLoanFromReportsInput,
    scheduleItems: ScheduleItem[],
    events: RepaymentEvent[]
): Promise<CreateBackupLoanResult> {
    await tx.loanSchedule.createMany({
        data: scheduleItems.map((item) => {
            // See applyAggregatePaymentAndSchedule above: migrated fees were already
            // collected by the old software, so the fee obligation is dropped entirely
            // (not just marked paid) — totalDue is reduced by the same amount since the
            // source's own totalDue bundles the fee in.
            const feesDueFromSource = Number(item.feesDue || 0);
            return {
                loanId,
                installmentNo: item.installmentNo,
                dueDate: item.dueDate,
                principalDue: new Decimal(item.principalDue.toFixed(2)),
                interestDue: new Decimal(item.interestDue.toFixed(2)),
                penaltiesDue: new Decimal(item.penaltiesDue || 0),
                feesDue: new Decimal(0),
                feesPaid: new Decimal(0),
                savingsDue: new Decimal(item.savingsDue || 0),
                totalDue: new Decimal(item.totalDue.toFixed(2)).minus(feesDueFromSource),
                status: 'PENDING' as const,
            };
        }),
    });

    const createdSchedules = await tx.loanSchedule.findMany({ where: { loanId } });
    const scheduleByInstallment = new Map(createdSchedules.map((s) => [s.installmentNo, s]));

    // Loan Card Report's per-installment Received Amount, keyed by installment number —
    // legacy exports often leave the Repayment Report's own "Wallet Advance Amount"
    // column blank even when the member actually paid extra that day. The Loan Card
    // Report's Received Amount for the same due already bakes that extra in (e.g. 1200
    // collected vs a 1100 EMI => a 100 loan advance the Repayment Report never names), so
    // it's used below as the fallback source of truth when the Repayment Report is silent.
    const loanCardByInstallment = new Map(
        (input.loanCardReport?.scheduleRows ?? []).map((row) => [row.installmentNo, row])
    );

    const sortedEvents = [...events].sort(
        (a, b) => new Date(a.transactionDate).getTime() - new Date(b.transactionDate).getTime()
    );

    let lastTransactionId: string | null = null;

    for (const event of sortedEvents) {
        const txnDate = new Date(event.transactionDate);
        const txnIdBase = `TXN-BKP-${loanNumber}-${Date.now().toString().slice(-6)}-${Math.random()
            .toString(36)
            .slice(2, 5)
            .toUpperCase()}`;
        const isDisbursement = event.transactionType.trim().toLowerCase() === 'disbursement';
        const installmentNo = parseInt(event.dueNo, 10);
        const schedule = !isDisbursement && Number.isFinite(installmentNo) ? scheduleByInstallment.get(installmentNo) : undefined;
        const loanCardRow = Number.isFinite(installmentNo) ? loanCardByInstallment.get(installmentNo) : undefined;

        if (isDisbursement) {
            const transactionId = `${txnIdBase}-DSB`;
            await tx.loanTransaction.create({
                data: {
                    transactionId,
                    loanId,
                    branchId: input.branchId,
                    centerId: input.centerId,
                    clientId: input.clientId,
                    amount: new Decimal(event.amount.toFixed(2)),
                    principalAmount: new Decimal(event.amount.toFixed(2)),
                    type: 'DISBURSEMENT' as const,
                    paymentMode: 'CASH' as const,
                    collectedById: input.loanOfficerId ?? input.createdById,
                    transactionDate: txnDate,
                    status: 'APPROVED' as const,
                    approvedById: input.createdById,
                    approvedAt: new Date(),
                    description: 'Migrated disbursement (upload)',
                    excludeFromEodAllocation: true,
                },
            });
            lastTransactionId = transactionId;
        } else {
            const transactionId = `${txnIdBase}-RPY`;

            // Waterfall-PLACE this payment against still-open schedule rows, oldest due
            // first — the SAME canonical allocator the live collection flow uses
            // (allocateTransactionLines, app/api/collections/single-collection/route.ts)
            // — instead of pinning the event to "the schedule row with the same
            // installmentNo" outright. The source file's own per-row installment number
            // is really just a receipt sequence counter, not a reliable 1:1 mapping to a
            // due cycle — once a member's payments split across multiple collection
            // records for the same due (late/partial/catch-up payments), matching
            // strictly by installmentNo corrupted the schedule (e.g. a due's balance
            // never getting filled while a LATER due showed a payment that was really the
            // same due's remainder).
            //
            // Row PLACEMENT stays oldest-open-first (protects the case above — see
            // backup-loan.service.test.ts). But the principal/interest SPLIT is taken
            // from the event's own recorded principalAmount/interestAmount (the
            // Repayment Report's "Break Down" columns) as a component budget, instead of
            // re-derived purely from whichever row's own due amounts the budget happens
            // to land on. Deriving the split from row due-amounts alone breaks when a
            // later due is genuinely collected before an older due closes out (arrears
            // can lag a due by well over a year — e.g. due #28 wasn't fully settled here
            // until over a year after it fell due, while due #31 was paid on time): the
            // waterfall then attributes due #31's own interest/principal split to
            // whichever older row happens to still be open, shifting the loan-wide split
            // even though every payment's TOTAL landed on the correct due amount. Using
            // the recorded split as the budget still lets same-due mislabeled splits (the
            // installmentNo-unreliability case above) land correctly, since the budget is
            // placed into the oldest open row(s) regardless of which dueNo the event
            // claims.
            const pendingSchedules = createdSchedules
                .filter((s) => {
                    const remaining =
                        Number(s.principalDue) + Number(s.interestDue) - Number(s.principalPaid) - Number(s.interestPaid);
                    return remaining > 0.004;
                })
                .sort((a, b) => a.installmentNo - b.installmentNo)
                .map((s) => ({
                    id: s.id,
                    installmentNo: s.installmentNo,
                    dueDate: s.dueDate,
                    principalDue: Number(s.principalDue),
                    interestDue: Number(s.interestDue),
                    principalPaid: Number(s.principalPaid),
                    interestPaid: Number(s.interestPaid),
                }));

            // Only trust the recorded split when it actually accounts for the whole
            // payment — some legacy exports leave the Break Down columns blank, in which
            // case principalAmount/interestAmount come back as 0 and must not be used as
            // a (wrong) all-zero budget.
            const recordedSplitTotal = event.principalAmount + event.interestAmount;
            const hasRecordedSplit = Math.abs(recordedSplitTotal - event.amount) <= 0.01;

            const budgetPass = hasRecordedSplit
                ? allocateTransactionLinesFromComponentBudgets(pendingSchedules, {
                      principalAmount: event.principalAmount,
                      interestAmount: event.interestAmount,
                      feesAmount: 0,
                      penaltyAmount: 0,
                  })
                : null;

            const lines: TransactionLinePlan[] = budgetPass ? [...budgetPass.lines] : [];
            const leftoverAmount = budgetPass
                ? budgetPass.remainingBudget.principalAmount +
                  budgetPass.remainingBudget.interestAmount +
                  budgetPass.remainingBudget.feesAmount +
                  budgetPass.remainingBudget.penaltyAmount
                : event.amount;

            if (leftoverAmount > 0.004) {
                // Either the recorded split couldn't fully fit (e.g. its interest budget
                // exceeds every open row's remaining interest) or there was no usable
                // recorded split at all — fall back to the default oldest-first waterfall
                // for whatever's left, continuing from the rows as the first pass left
                // them (so the fallback never double-allocates what the budget pass
                // already placed).
                const appliedByScheduleId = new Map<string, { principalAmount: number; interestAmount: number }>();
                for (const line of lines) {
                    const prev = appliedByScheduleId.get(line.scheduleId) ?? { principalAmount: 0, interestAmount: 0 };
                    appliedByScheduleId.set(line.scheduleId, {
                        principalAmount: prev.principalAmount + line.principalAmount,
                        interestAmount: prev.interestAmount + line.interestAmount,
                    });
                }
                const remainingSchedules = pendingSchedules
                    .map((s) => {
                        const applied = appliedByScheduleId.get(s.id);
                        return applied
                            ? {
                                  ...s,
                                  principalPaid: s.principalPaid + applied.principalAmount,
                                  interestPaid: s.interestPaid + applied.interestAmount,
                              }
                            : s;
                    })
                    .filter((s) => s.principalDue + s.interestDue - s.principalPaid - s.interestPaid > 0.004);

                const fallback = allocateTransactionLines(remainingSchedules, leftoverAmount);

                // Merge into the same per-schedule line rather than creating a second
                // LoanTransactionLine row for a row already touched by the budget pass.
                for (const line of fallback.lines) {
                    const existing = lines.find((l) => l.scheduleId === line.scheduleId);
                    if (existing) {
                        existing.principalAmount += line.principalAmount;
                        existing.interestAmount += line.interestAmount;
                        existing.feesAmount += line.feesAmount;
                        existing.penaltyAmount += line.penaltyAmount;
                        existing.lineTotal += line.lineTotal;
                    } else {
                        lines.push(line);
                    }
                }
            }

            const allocation = {
                lines,
                summary: lines.reduce(
                    (summary, line) => {
                        summary.principalAmount += line.principalAmount;
                        summary.interestAmount += line.interestAmount;
                        summary.feesAmount += line.feesAmount;
                        summary.penaltyAmount += line.penaltyAmount;
                        summary.lineTotal += line.lineTotal;
                        return summary;
                    },
                    { principalAmount: 0, interestAmount: 0, feesAmount: 0, penaltyAmount: 0, lineTotal: 0 }
                ),
            };

            await tx.loanTransaction.create({
                data: {
                    transactionId,
                    loanId,
                    branchId: input.branchId,
                    centerId: input.centerId,
                    clientId: input.clientId,
                    amount: new Decimal(event.amount.toFixed(2)),
                    principalAmount: new Decimal(allocation.summary.principalAmount.toFixed(2)),
                    interestAmount: new Decimal(allocation.summary.interestAmount.toFixed(2)),
                    feesAmount: new Decimal(0),
                    penaltyAmount: new Decimal(0),
                    type: 'REPAYMENT' as const,
                    paymentMode: 'CASH' as const,
                    // Every migrated event here is that installment's own demand being
                    // collected (paid on/near its own due date, per the source report) —
                    // never an advance-of-schedule payment — so it's always "Demand
                    // Collection", the same classification the live collection flow uses
                    // (app/api/collections/single-collection/route.ts). Left unset, this
                    // stays null and the Dashboard's per-day demand/collection table (which
                    // filters on this field) permanently shows these as "Yet to Collect"
                    // despite the schedule and transaction both being fully paid.
                    collectionType: 'Demand Collection',
                    collectedById: input.loanOfficerId ?? input.createdById,
                    transactionDate: txnDate,
                    status: 'APPROVED' as const,
                    approvedById: input.createdById,
                    approvedAt: new Date(),
                    description: `Migrated repayment — Due #${event.dueNo}`,
                    lines:
                        allocation.lines.length > 0
                            ? {
                                  create: allocation.lines.map((line) => ({
                                      scheduleId: line.scheduleId,
                                      installmentNo: line.installmentNo,
                                      principalAmount: new Decimal(line.principalAmount.toFixed(2)),
                                      interestAmount: new Decimal(line.interestAmount.toFixed(2)),
                                      feesAmount: new Decimal(0),
                                      penaltyAmount: new Decimal(0),
                                      lineTotal: new Decimal(line.lineTotal.toFixed(2)),
                                  })),
                              }
                            : undefined,
                    excludeFromEodAllocation: true,
                },
            });
            lastTransactionId = transactionId;

            // Apply every touched schedule row (a single payment can now span more than
            // one due) and keep the in-memory copies fresh so the NEXT event's allocation
            // sees up-to-date remaining balances.
            for (const line of allocation.lines) {
                const touchedSchedule = scheduleByInstallment.get(line.installmentNo);
                if (!touchedSchedule) continue;

                const newPrincipalPaid = Number(touchedSchedule.principalPaid) + line.principalAmount;
                const newInterestPaid = Number(touchedSchedule.interestPaid) + line.interestAmount;
                const totalPaidNow = newPrincipalPaid + newInterestPaid;
                const totalDue =
                    Number(touchedSchedule.principalDue) +
                    Number(touchedSchedule.interestDue) +
                    Number(touchedSchedule.feesDue) +
                    Number(touchedSchedule.penaltiesDue);
                const newStatus: ScheduleStatus =
                    totalPaidNow >= totalDue && totalDue > 0 ? 'PAID' : totalPaidNow > 0 ? 'PARTIALLY_PAID' : 'PENDING';

                await tx.loanSchedule.update({
                    where: { id: touchedSchedule.id },
                    data: {
                        principalPaid: new Decimal(newPrincipalPaid.toFixed(2)),
                        interestPaid: new Decimal(newInterestPaid.toFixed(2)),
                        totalPaid: new Decimal(totalPaidNow.toFixed(2)),
                        status: newStatus,
                        paidAt: newStatus === 'PAID' ? txnDate : touchedSchedule.paidAt,
                    },
                });
                touchedSchedule.principalPaid = new Decimal(newPrincipalPaid.toFixed(2));
                touchedSchedule.interestPaid = new Decimal(newInterestPaid.toFixed(2));
                touchedSchedule.status = newStatus;
            }

            await tx.loan.update({
                where: { id: loanId },
                data: {
                    principalPaid: { increment: new Decimal(allocation.summary.principalAmount.toFixed(2)) },
                    interestPaid: { increment: new Decimal(allocation.summary.interestAmount.toFixed(2)) },
                    lastPaymentDate: txnDate,
                },
            });
        }

        // Prefer the Repayment Report's own explicit Wallet Advance Amount; when it's
        // blank/zero, fall back to backing it out of the Loan Card Report's Received
        // Amount for this same due (receivedAmount - the EMI actually collected this
        // event) — see loanCardByInstallment above for why the Repayment Report alone
        // can under-report this.
        const explicitAdvance = event.walletAdvanceAmount > 0 ? event.walletAdvanceAmount : 0;
        const impliedAdvance =
            explicitAdvance === 0 && loanCardRow?.receivedAmount != null
                ? Math.max(0, Number((loanCardRow.receivedAmount - event.amount).toFixed(2)))
                : 0;
        const advanceAmount = explicitAdvance > 0 ? explicitAdvance : impliedAdvance;

        if (advanceAmount > 0) {
            await tx.loanTransaction.create({
                data: {
                    transactionId: `${txnIdBase}-ADV`,
                    loanId,
                    branchId: input.branchId,
                    centerId: input.centerId,
                    clientId: input.clientId,
                    amount: new Decimal(advanceAmount.toFixed(2)),
                    type: 'SAVINGS_COLLECTION' as const,
                    paymentMode: 'CASH' as const,
                    collectedById: input.loanOfficerId ?? input.createdById,
                    transactionDate: event.walletAdvanceDate ? new Date(event.walletAdvanceDate) : txnDate,
                    status: 'APPROVED' as const,
                    approvedById: input.createdById,
                    approvedAt: new Date(),
                    description:
                        explicitAdvance > 0
                            ? 'Migrated wallet advance (upload)'
                            : `Migrated loan advance — derived from Loan Card Report received amount (Due #${event.dueNo})`,
                    excludeFromEodAllocation: true,
                },
            });
            await tx.loan.update({
                where: { id: loanId },
                data: { savingsPaid: { increment: new Decimal(advanceAmount.toFixed(2)) } },
            });
            await tx.client.update({
                where: { id: input.clientId },
                data: { loanAdvance: { increment: new Decimal(advanceAmount.toFixed(2)) } },
            });
            if (schedule) {
                const savingsDue = Number(schedule.savingsDue || 0);
                const currentSavingsPaid = Number(schedule.savingsPaid || 0);
                const applyToSchedule = Math.min(advanceAmount, Math.max(0, savingsDue - currentSavingsPaid));
                if (applyToSchedule > 0) {
                    const newSavingsPaid = Number((currentSavingsPaid + applyToSchedule).toFixed(2));
                    await tx.loanSchedule.update({
                        where: { id: schedule.id },
                        data: { savingsPaid: newSavingsPaid },
                    });
                    schedule.savingsPaid = new Decimal(newSavingsPaid);
                }
            }
        }

        if (event.walletPayAmount > 0) {
            // Advance drawn down internally to cover this due — not cash leaving
            // to the client, so ADJUSTMENT rather than SAVINGS_REFUND.
            await tx.loanTransaction.create({
                data: {
                    transactionId: `${txnIdBase}-WPY`,
                    loanId,
                    branchId: input.branchId,
                    centerId: input.centerId,
                    clientId: input.clientId,
                    amount: new Decimal(event.walletPayAmount.toFixed(2)),
                    type: 'ADJUSTMENT' as const,
                    paymentMode: 'CASH' as const,
                    collectedById: input.loanOfficerId ?? input.createdById,
                    transactionDate: event.walletPayDate ? new Date(event.walletPayDate) : txnDate,
                    status: 'APPROVED' as const,
                    approvedById: input.createdById,
                    approvedAt: new Date(),
                    description: `Migrated wallet drawdown — Due #${event.dueNo}`,
                    excludeFromEodAllocation: true,
                },
            });
            await tx.loan.update({
                where: { id: loanId },
                data: { savingsPaid: { decrement: new Decimal(event.walletPayAmount.toFixed(2)) } },
            });
            await tx.client.update({
                where: { id: input.clientId },
                data: { loanAdvance: { decrement: new Decimal(event.walletPayAmount.toFixed(2)) } },
            });
        }
    }

    return { loanId, loanNumber, transactionId: lastTransactionId };
}
