import { Prisma } from '@prisma/client';

/**
 * EOD "Collection" (checklist code 6) — branch-day gates for repayments.
 *
 * BM batch approval predicate is kept in sync with:
 * @see app/api/collections/approve/route.ts (GET pending queue + POST batch actions)
 *
 * Foreclosure / Area Manager queue stays on checklist code 7 (`ForeclosureRequest`).
 *
 * Important: pending batch lines are **not** filtered by `transactionDate`. The BM approval queue lists all
 * open batches for the branch; `transactionDate` can be an earlier meeting day while the working date has
 * moved forward — EOD must still block until those lines are approved or rejected.
 */

/** Same filter as GET `app/api/collections/approve` — entire branch queue, any calendar `transactionDate`. */
export function pendingBmCollectionBatchWhere(branchId: string): Prisma.LoanTransactionWhereInput {
    return {
        branchId,
        type: 'REPAYMENT',
        isReversed: false,
        status: 'PENDING',
        collectionBatchId: { not: null },
        collectedBy: { role: 'FDO' },
    };
}

type TxLikeForBmGate = {
    type: string;
    isReversed: boolean;
    status: string;
    collectionBatchId: string | null;
    collectedBy: { role: string };
};

/** Mirrors `pendingBmCollectionBatchWhere` for in-memory rows (detail grid, sorting). */
export function isPendingBmCollectionBatchLine(tx: TxLikeForBmGate): boolean {
    return (
        tx.type === 'REPAYMENT' &&
        !tx.isReversed &&
        tx.status === 'PENDING' &&
        tx.collectionBatchId != null &&
        tx.collectedBy.role === 'FDO'
    );
}

export function labelBranchApprovalForEodRow(tx: TxLikeForBmGate): string {
    if (isPendingBmCollectionBatchLine(tx)) {
        return 'Awaiting BM approval (batch)';
    }
    if (tx.status === 'APPROVED') {
        return 'Approved';
    }
    if (tx.status === 'REJECTED') {
        return 'Rejected';
    }
    return tx.status;
}

export type EodCollectionGateInput = {
    zeroRepaymentDay: boolean;
    centersWithNoRepayment: number;
    pendingBmCollectionLineCount: number;
};

/**
 * Derives checklist code 6 issue flag + summary copy. Pure — easy to unit test and log.
 */
export function evaluateEodCollectionChecklist(input: EodCollectionGateInput): {
    issue: boolean;
    details: string;
} {
    const { zeroRepaymentDay, centersWithNoRepayment, pendingBmCollectionLineCount } = input;
    const missingScheduledRepaymentIssue = !zeroRepaymentDay && centersWithNoRepayment > 0;
    const pendingBmIssue = pendingBmCollectionLineCount > 0;

    if (zeroRepaymentDay) {
        return {
            issue: false,
            details:
                'No cash repayments for this branch day — close EOD with denomination ₹0.00 after saving counts.',
        };
    }

    const parts: string[] = [];
    if (missingScheduledRepaymentIssue) {
        parts.push(
            `${centersWithNoRepayment} scheduled center(s) have no repayment collection for today.`
        );
    }
    if (pendingBmIssue) {
        parts.push(
            `${pendingBmCollectionLineCount} repayment line(s) await BM approval (collection batch; may include earlier meeting dates). Preclosure awaiting Area Manager is listed under Preclosure (code 7).`
        );
    }
    if (parts.length === 0) {
        return {
            issue: false,
            details:
                'All scheduled centers have repayments recorded; BM collection batches have no pending lines.',
        };
    }
    return { issue: true, details: parts.join(' ') };
}

// ─────────────────────────────────────────────────────────────────────────────
// Checklist code 9 — Collection Error (unattempted scheduled installments)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Prisma WHERE for `LoanSchedule` rows whose installment is due today
 * (dueDate falls within the branch calendar day UTC window) and the loan
 * is active + disbursed.
 *
 * "Due today" means the schedule installment's `dueDate` falls inside the
 * half-open UTC interval [dayStartUtc, dayEndExclusiveUtc).
 *
 * Loans that are closed (`closedDate` is set) or not yet disbursed are excluded.
 */
export function unattemptedInstallmentScheduleWhere(
    branchId: string,
    dayStartUtc: Date,
    dayEndExclusiveUtc: Date
): Prisma.LoanScheduleWhereInput {
    return {
        dueDate: { gte: dayStartUtc, lt: dayEndExclusiveUtc },
        status: { in: ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] },
        loan: {
            branchId,
            isActive: true,
            disbursementStatus: 'DISBURSED',
            closedDate: null,
        },
    };
}

/**
 * Prisma WHERE for every `LoanSchedule` installment due on the branch day (any status) —
 * the day's demand, i.e. "who has to be collected today". Unlike
 * `unattemptedInstallmentScheduleWhere`, PAID rows are kept so a member collected and
 * approved today still shows; loans closed on/after the day (e.g. paid off today) too.
 */
export function installmentsDueOnDayWhere(
    branchId: string,
    dayStartUtc: Date,
    dayEndExclusiveUtc: Date
): Prisma.LoanScheduleWhereInput {
    return {
        dueDate: { gte: dayStartUtc, lt: dayEndExclusiveUtc },
        loan: {
            branchId,
            disbursementStatus: 'DISBURSED',
            OR: [{ closedDate: null }, { closedDate: { gte: dayStartUtc } }],
        },
    };
}

/**
 * Prisma WHERE for `LoanTransaction` rows that represent a non-reversed
 * REPAYMENT posted today — used to identify which loans *have* been attempted.
 *
 * Status is intentionally not restricted here: a PENDING repayment posted by an FDO
 * today still counts as "attempted" for the Collection Error check. The BM batch
 * approval gate (code 6) already blocks EOD until pending lines are resolved.
 */
export function repaymentPostedTodayWhere(
    branchId: string,
    dayStartUtc: Date,
    dayEndExclusiveUtc: Date
): Prisma.LoanTransactionWhereInput {
    return {
        branchId,
        type: 'REPAYMENT',
        isReversed: false,
        transactionDate: { gte: dayStartUtc, lt: dayEndExclusiveUtc },
    };
}

/**
 * Raw-SQL predicate (alias `s` = loan_schedules): the installment is NOT already fully covered by approved
 * payments made on days BEFORE its due date (advance). Add it next to the "no approved transaction on the due
 * day" NOT EXISTS of any zero-collection query — a member who paid ahead owes nothing that day, so they are
 * not a zero-collection member. Source of truth is loan_transaction_lines, same as the demand sheet.
 */
export const scheduleNotCoveredByAdvanceSql = Prisma.sql`(s."principalDue" + s."interestDue") > COALESCE((
    SELECT SUM(ln."principalAmount" + ln."interestAmount")
    FROM "loan_transaction_lines" ln
    JOIN "loan_transactions" ta ON ta."id" = ln."transactionId"
    WHERE ln."scheduleId" = s."id"
        AND ta."status" = 'APPROVED'
        AND ta."isReversed" = false
        AND ta."type" IN ('REPAYMENT', 'PRECLOSURE')
        AND DATE(ta."transactionDate" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata') < DATE(s."dueDate")
), 0)`;

const advancePaidSql = (column: '"principalAmount"' | '"interestAmount"') => Prisma.sql`COALESCE((
    SELECT SUM(ln.${Prisma.raw(column)})
    FROM "loan_transaction_lines" ln
    JOIN "loan_transactions" ta ON ta."id" = ln."transactionId"
    WHERE ln."scheduleId" = s."id"
        AND ta."status" = 'APPROVED'
        AND ta."isReversed" = false
        AND ta."type" IN ('REPAYMENT', 'PRECLOSURE')
        AND DATE(ta."transactionDate" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata') < DATE(s."dueDate")
), 0)`;

/**
 * Raw-SQL net demand per installment (alias `s` = loan_schedules): principal / interest due minus what was paid on
 * days BEFORE the due date (advance). Same-day collections are never netted (they are the day's collection against
 * the demand). Use inside SUM(...) or per row in dashboard demand queries.
 */
/** Principal + interest paid on days before the installment's due date (alias `s` = loan_schedules). */
export const scheduleAdvancePaidTotalSql = Prisma.sql`(${advancePaidSql('"principalAmount"')} + ${advancePaidSql('"interestAmount"')})`;
export const scheduleNetPrincipalDueSql = Prisma.sql`GREATEST(s."principalDue" - ${advancePaidSql('"principalAmount"')}, 0)`;
export const scheduleNetInterestDueSql = Prisma.sql`GREATEST(s."interestDue" - ${advancePaidSql('"interestAmount"')}, 0)`;

export type EodCollectionErrorInput = {
    /** Number of loan installments due today that have no repayment transaction at all */
    unattemptedCount: number;
};

/**
 * Derives checklist code 9 (Collection Error) issue flag + summary copy.
 * Pure — no DB access; easy to unit-test.
 *
 * Logic: if any loan installment is scheduled (due) today but the FDO has
 * recorded zero repayment transactions for that loan today, it is flagged as
 * an error. A PENDING repayment (awaiting BM approval) still satisfies the
 * "attempted" requirement; the BM approval gate (code 6) handles that separately.
 */
export function evaluateEodCollectionError(input: EodCollectionErrorInput): {
    issue: boolean;
    details: string;
} {
    if (input.unattemptedCount === 0) {
        return {
            issue: false,
            details:
                'All installments due today have at least one repayment transaction recorded. No collection integrity errors.',
        };
    }
    return {
        issue: true,
        details:
            `${input.unattemptedCount} loan installment(s) are scheduled (due) today but have NO repayment recorded by any FDO. ` +
            'These collections must be completed or explicitly handled before closing EOD.',
    };
}
