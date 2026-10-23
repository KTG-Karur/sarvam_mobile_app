import type { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { getKolkataCalendarYmd, parseKolkataAttendanceDateYmd } from '@/app/lib/branch-lock';
import { allocateTransactionLinesFromComponentBudgets, type TransactionLinePlan } from '@/app/lib/loan-transaction-lines';

type Db = Prisma.TransactionClient;

/**
 * Super Control — Live Loan Schedule Edit. Edits the Loan Card (LoanSchedule) of a LIVE loan
 * IN PLACE — never wipes/rebuilds LoanSchedule or LoanTransaction (unlike Loan History Edit,
 * which only handles backup/migrated loans and deletes real activity).
 *
 * Only PENDING installments (nothing collected against them) can be edited, so collections,
 * LoanTransactionLine rows and paid columns are never touched — nothing is replayed. Modes:
 *  - DATES_ONLY — only `dueDate` changed.
 *  - AMOUNTS    — principalDue / interestDue / savingsDue changed on pending rows (totalDue is
 *                 recomputed). Amount edits are blocked while pending collections, a
 *                 pre-closure/write-off or an open foreclosure exist.
 * Loan Advance (savingsPaid) is never redistributed — only capped to an edited savingsDue.
 *
 * Migrated loans are allowed: their stored `Loan.migratedLoanSource.loanCard` rows are patched in
 * the same transaction so Loan History Edit stays consistent.
 *
 * Out of scope (by design): collection (transaction) dates — moving one means re-bucketing the
 * EOD GL vouchers by date. LoanTransaction CCR snapshot columns (currentDemand*, openingArrears*,
 * collectionType) were captured at collection time and are NOT recomputed.
 */

export interface ScheduleEditInput {
    installmentNo: number;
    /** YYYY-MM-DD (Kolkata calendar day) */
    dueDate?: string;
    principalDue?: number;
    interestDue?: number;
    savingsDue?: number;
}

export interface ScheduleRowView {
    installmentNo: number;
    dueDate: string;
    principalDue: number;
    interestDue: number;
    savingsDue: number;
    totalDue: number;
    principalPaid: number;
    interestPaid: number;
    savingsPaid: number;
    totalPaid: number;
    status: string;
    paidAt: string | null;
}

export interface ScheduleEditPlan {
    loanId: string;
    loanNumber: string;
    mode: 'DATES_ONLY' | 'AMOUNTS' | 'NONE';
    before: ScheduleRowView[];
    after: ScheduleRowView[];
    /** Hard problems — the edit cannot be applied. */
    errors: string[];
    /** Soft problems — apply requires explicit acknowledgement. */
    warnings: string[];
    /** Internal apply payload (not shown in the UI). */
    internal: {
        scheduleUpdates: {
            id: string;
            data: {
                dueDate: Date;
                principalDue: number;
                interestDue: number;
                savingsDue: number;
                totalDue: number;
                principalPaid: number;
                interestPaid: number;
                feesPaid: number;
                penaltiesPaid: number;
                savingsPaid: number;
                totalPaid: number;
                status: string;
                paidAt: Date | null;
            };
        }[];
        replacedLines: { transactionId: string; lines: TransactionLinePlan[] }[];
        newFirstDueDate: Date | null;
    };
}

const round2 = (n: number) => Number(n.toFixed(2));
const num = (v: unknown) => Number(v ?? 0);
const MONEY_EPS = 0.01;

const ymd = (d: Date) => getKolkataCalendarYmd(d);

interface WorkingRow {
    id: string;
    installmentNo: number;
    dueDate: Date;
    principalDue: number;
    interestDue: number;
    feesDue: number;
    penaltiesDue: number;
    savingsDue: number;
    totalDue: number;
    principalPaid: number;
    interestPaid: number;
    feesPaid: number;
    penaltiesPaid: number;
    savingsPaid: number;
    totalPaid: number;
    status: string;
    paidAt: Date | null;
}

const toView = (r: WorkingRow): ScheduleRowView => ({
    installmentNo: r.installmentNo,
    dueDate: ymd(r.dueDate),
    principalDue: r.principalDue,
    interestDue: r.interestDue,
    savingsDue: r.savingsDue,
    totalDue: r.totalDue,
    principalPaid: r.principalPaid,
    interestPaid: r.interestPaid,
    savingsPaid: r.savingsPaid,
    totalPaid: r.totalPaid,
    status: r.status,
    paidAt: r.paidAt ? ymd(r.paidAt) : null,
});

export async function buildScheduleEditPlan(db: Db, loanId: string, edits: ScheduleEditInput[]): Promise<ScheduleEditPlan> {
    const loan = await db.loan.findUnique({
        where: { id: loanId },
        select: { id: true, loanNumber: true, amount: true, disbursementStatus: true, migratedLoanSource: true, firstDueDate: true },
    });
    if (!loan) throw new Error('Loan not found');

    const errors: string[] = [];
    const warnings: string[] = [];

    if (loan.disbursementStatus !== 'DISBURSED') errors.push('Only DISBURSED loans can be edited here.');

    const scheduleRows = await db.loanSchedule.findMany({ where: { loanId }, orderBy: { installmentNo: 'asc' } });
    const original: WorkingRow[] = scheduleRows.map((s) => ({
        id: s.id,
        installmentNo: s.installmentNo,
        dueDate: s.dueDate,
        principalDue: num(s.principalDue),
        interestDue: num(s.interestDue),
        feesDue: num(s.feesDue),
        penaltiesDue: num(s.penaltiesDue),
        savingsDue: num(s.savingsDue),
        totalDue: num(s.totalDue),
        principalPaid: num(s.principalPaid),
        interestPaid: num(s.interestPaid),
        feesPaid: num(s.feesPaid),
        penaltiesPaid: num(s.penaltiesPaid),
        savingsPaid: num(s.savingsPaid),
        totalPaid: num(s.totalPaid),
        status: s.status,
        paidAt: s.paidAt,
    }));
    const working: WorkingRow[] = original.map((r) => ({ ...r }));
    const byNo = new Map(working.map((r) => [r.installmentNo, r]));

    // ── Apply the edits to the working copy ─────────────────────────────────────
    let amountsEdited = false;
    let datesEdited = false;
    for (const e of edits) {
        const row = byNo.get(e.installmentNo);
        if (!row) {
            errors.push(`Installment ${e.installmentNo} does not exist.`);
            continue;
        }
        if (row.status === 'WAIVED' || row.status === 'CLOSED') {
            errors.push(`Installment ${e.installmentNo} is ${row.status} and cannot be edited.`);
            continue;
        }
        if (row.status === 'PAID' || row.status === 'PARTIALLY_PAID' || row.principalPaid > 0 || row.interestPaid > 0) {
            errors.push(`Installment ${e.installmentNo} is already ${row.status === 'PENDING' ? 'collected against' : row.status}; only pending installments can be edited.`);
            continue;
        }
        if (e.dueDate !== undefined) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(e.dueDate)) {
                errors.push(`Installment ${e.installmentNo}: invalid date.`);
            } else if (e.dueDate !== ymd(row.dueDate)) {
                row.dueDate = parseKolkataAttendanceDateYmd(e.dueDate);
                datesEdited = true;
            }
        }
        const setAmount = (field: 'principalDue' | 'interestDue' | 'savingsDue', v: number | undefined) => {
            if (v === undefined) return;
            if (!Number.isFinite(v) || v < 0) {
                errors.push(`Installment ${e.installmentNo}: ${field} must be 0 or more.`);
                return;
            }
            if (Math.abs(v - row[field]) > 0.001) {
                row[field] = round2(v);
                amountsEdited = true;
            }
        };
        setAmount('principalDue', e.principalDue);
        setAmount('interestDue', e.interestDue);
        setAmount('savingsDue', e.savingsDue);
    }

    if (!datesEdited && !amountsEdited && errors.length === 0) {
        return { loanId, loanNumber: loan.loanNumber, mode: 'NONE', before: original.map(toView), after: working.map(toView), errors: ['Nothing was changed.'], warnings, internal: { scheduleUpdates: [], replacedLines: [], newFirstDueDate: null } };
    }

    // Due dates must stay strictly ascending by installment.
    for (let i = 1; i < working.length; i++) {
        if (working[i].dueDate.getTime() <= working[i - 1].dueDate.getTime()) {
            errors.push(`Installment ${working[i].installmentNo} due date must be after installment ${working[i - 1].installmentNo}.`);
        }
    }

    // ── Amount edits: guard rails + replay ─────────────────────────────────────
    const replacedLines: { transactionId: string; lines: TransactionLinePlan[] }[] = [];
    if (amountsEdited) {
        const [pendingRepayments, closureTxns, openForeclosure] = await Promise.all([
            db.loanTransaction.count({ where: { loanId, type: 'REPAYMENT', status: 'PENDING', isReversed: false } }),
            db.loanTransaction.count({ where: { loanId, type: { in: ['PRECLOSURE', 'WRITEOFF'] }, isReversed: false } }),
            db.foreclosureRequest.count({ where: { loanId, status: { in: ['INITIATED', 'PENDING_APPROVAL', 'APPROVED'] } } }),
        ]);
        if (pendingRepayments > 0) errors.push('Pending collections exist — approve or reject them before editing installment amounts.');
        if (closureTxns > 0) errors.push('This loan has a pre-closure / write-off transaction — installment amounts are locked.');
        if (openForeclosure > 0) errors.push('A foreclosure request exists for this loan — installment amounts are locked.');

        // Only untouched (pending) installments are editable, so no collection is ever re-allocated:
        // an edited row has nothing paid against it. totalDue keeps whatever extra (fees etc.) it had.
        for (const w of working) {
            const o = original.find((x) => x.id === w.id)!;
            const changed = w.principalDue !== o.principalDue || w.interestDue !== o.interestDue || w.savingsDue !== o.savingsDue;
            if (!changed) continue;
            const extra = round2(o.totalDue - o.principalDue - o.interestDue);
            w.totalDue = round2(w.principalDue + w.interestDue + extra);
            // Loan Advance already collected against an installment is never redistributed;
            // it is only capped so it cannot exceed an edited savingsDue.
            if (w.savingsPaid > w.savingsDue) w.savingsPaid = w.savingsDue;
        }

        const principalTotal = round2(working.reduce((s, r) => s + r.principalDue, 0));
        if (Math.abs(principalTotal - num(loan.amount)) > MONEY_EPS) {
            warnings.push(`Sum of principal due (₹${principalTotal}) differs from the loan amount (₹${num(loan.amount)}).`);
        }
    }

    const updates = working
        .filter((w, i) => {
            const o = original[i];
            return (
                w.dueDate.getTime() !== o.dueDate.getTime() ||
                w.principalDue !== o.principalDue ||
                w.interestDue !== o.interestDue ||
                w.savingsDue !== o.savingsDue ||
                w.principalPaid !== o.principalPaid ||
                w.interestPaid !== o.interestPaid ||
                w.feesPaid !== o.feesPaid ||
                w.penaltiesPaid !== o.penaltiesPaid ||
                w.savingsPaid !== o.savingsPaid ||
                w.status !== o.status
            );
        })
        .map((w) => ({
            id: w.id,
            data: {
                dueDate: w.dueDate,
                principalDue: w.principalDue,
                interestDue: w.interestDue,
                savingsDue: w.savingsDue,
                totalDue: w.totalDue,
                principalPaid: w.principalPaid,
                interestPaid: w.interestPaid,
                feesPaid: w.feesPaid,
                penaltiesPaid: w.penaltiesPaid,
                savingsPaid: w.savingsPaid,
                totalPaid: w.totalPaid,
                status: w.status,
                paidAt: w.paidAt,
            },
        }));

    const first = working[0];
    const newFirstDueDate =
        first && original[0] && first.dueDate.getTime() !== original[0].dueDate.getTime() ? first.dueDate : null;

    return {
        loanId,
        loanNumber: loan.loanNumber,
        mode: amountsEdited ? 'AMOUNTS' : 'DATES_ONLY',
        before: original.map(toView),
        after: working.map(toView),
        errors,
        warnings,
        internal: { scheduleUpdates: updates, replacedLines, newFirstDueDate },
    };
}

export async function applyScheduleEditPlan(db: Db, plan: ScheduleEditPlan, params: { editedById: string; reason: string }) {
    if (plan.errors.length > 0) throw new Error(plan.errors[0]);

    // Concurrency guard: the live schedule must still equal what the plan was built from.
    const live = await db.loanSchedule.findMany({ where: { loanId: plan.loanId }, orderBy: { installmentNo: 'asc' } });
    const liveView = live.map((s) => ({ no: s.installmentNo, d: ymd(s.dueDate), p: num(s.principalDue), i: num(s.interestDue), pp: num(s.principalPaid), ip: num(s.interestPaid) }));
    const planView = plan.before.map((b) => ({ no: b.installmentNo, d: b.dueDate, p: b.principalDue, i: b.interestDue, pp: b.principalPaid, ip: b.interestPaid }));
    if (JSON.stringify(liveView) !== JSON.stringify(planView)) {
        throw new Error('The loan schedule changed while you were reviewing — reload and try again');
    }

    for (const u of plan.internal.scheduleUpdates) {
        await db.loanSchedule.update({
            where: { id: u.id },
            data: {
                dueDate: u.data.dueDate,
                principalDue: new Decimal(u.data.principalDue),
                interestDue: new Decimal(u.data.interestDue),
                savingsDue: new Decimal(u.data.savingsDue),
                totalDue: new Decimal(u.data.totalDue),
                principalPaid: new Decimal(u.data.principalPaid),
                interestPaid: new Decimal(u.data.interestPaid),
                feesPaid: new Decimal(u.data.feesPaid),
                penaltiesPaid: new Decimal(u.data.penaltiesPaid),
                savingsPaid: new Decimal(u.data.savingsPaid),
                totalPaid: new Decimal(u.data.totalPaid),
                status: u.data.status as never,
                paidAt: u.data.paidAt,
            },
        });
    }

    for (const rl of plan.internal.replacedLines) {
        await db.loanTransactionLine.deleteMany({ where: { transactionId: rl.transactionId } });
        if (rl.lines.length > 0) {
            await db.loanTransactionLine.createMany({
                data: rl.lines.map((line) => ({
                    transactionId: rl.transactionId,
                    scheduleId: line.scheduleId,
                    installmentNo: line.installmentNo,
                    principalAmount: line.principalAmount,
                    interestAmount: line.interestAmount,
                    feesAmount: line.feesAmount,
                    penaltyAmount: line.penaltyAmount,
                    lineTotal: line.lineTotal,
                })),
            });
        }
    }

    // A migrated loan carries the Loan Card it was imported from (Loan.migratedLoanSource) —
    // Loan History Edit rebuilds from it, so keep its loanCard rows in step with this edit.
    const src = await db.loan.findUnique({ where: { id: plan.loanId }, select: { migratedLoanSource: true } });
    const source = src?.migratedLoanSource as { loanCard?: { scheduleRows?: Record<string, unknown>[] } | null } | null;
    if (source?.loanCard?.scheduleRows) {
        const after = new Map(plan.after.map((a) => [a.installmentNo, a]));
        const liveByNo = new Map(live.map((l) => [l.installmentNo, l]));
        source.loanCard.scheduleRows = source.loanCard.scheduleRows.map((row) => {
            const a = after.get(Number(row.installmentNo));
            const l = liveByNo.get(Number(row.installmentNo));
            if (!a || !l) return row;
            const fees = Number(row.feesDue ?? 0);
            return {
                ...row,
                dueDate: parseKolkataAttendanceDateYmd(a.dueDate).toISOString(),
                principalDue: a.principalDue,
                interestDue: a.interestDue,
                savingsDue: a.savingsDue,
                totalDue: round2(a.principalDue + a.interestDue + fees),
            };
        });
        await db.loan.update({ where: { id: plan.loanId }, data: { migratedLoanSource: JSON.parse(JSON.stringify(source)) } });
    }

    if (plan.internal.newFirstDueDate) {
        await db.loan.update({ where: { id: plan.loanId }, data: { firstDueDate: plan.internal.newFirstDueDate } });
    }

    await db.loanScheduleEditLog.create({
        data: {
            loanId: plan.loanId,
            editedById: params.editedById,
            reason: params.reason,
            mode: plan.mode,
            beforeSnapshot: JSON.parse(JSON.stringify(plan.before)),
            afterSnapshot: JSON.parse(JSON.stringify(plan.after)),
        },
    });
}
