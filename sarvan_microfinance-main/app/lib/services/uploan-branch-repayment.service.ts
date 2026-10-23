import * as XLSX from 'xlsx';
import {
    toIso,
    toNum,
    type ParsedLoanCardReport,
    type ParsedRepaymentReport,
    type RepaymentEvent,
    type LoanCardScheduleRow,
} from '@/app/lib/services/uploan-loan-history.service';
import {
    generateScheduleFromTemplates,
    type LoanProductWithTemplates,
} from '@/app/lib/services/backup-loan.service';

/**
 * Parser for the "Branch Wise Repayment" export — one flat xlsx covering every collected
 * installment, for every loan, for a whole branch (unlike the old per-member Loan Card
 * Report / Repayment Report CSV pair). Paired with the "Member Details Report" xlsx
 * (parsed by uploan-import.service.ts's parseUploanWorkbook), joined by that file's "Loan
 * MemberID" column against this file's "Loan ID" column — NOT either file's "Member ID",
 * which is a reused branch/center/group/seat slot code, not a stable identifier.
 *
 * Runs server-side (the file can run to 15k+ rows for a full branch) — see
 * app/api/uploan/member/preview/route.ts, which uploads the raw file to GCS once and
 * re-parses it from there on every re-validate rather than round-tripping the parsed
 * result through the browser.
 */

export interface BranchRepaymentRow {
    loanId: string;
    memberId: string;
    memberName: string;
    installmentNo: number;
    /** ISO — when this installment was actually collected. Due dates are never read from
     *  this file — they're computed from the loan's own start date + product frequency
     *  (see buildLoanHistoryForLoan), so an early/late collection here never drifts the
     *  schedule. */
    collectionDate: string;
    principal: number;
    interest: number;
    totalAmount: number;
}

function cell(row: unknown[] | undefined, idx: number): string {
    if (idx < 0 || !row) return '';
    const val = row[idx];
    return val !== undefined && val !== null ? String(val).trim() : '';
}

/**
 * Groups every row by its "Loan ID" column, sorted by installment number. Skips each
 * loan's trailing "Loan Total" summary row — identified by a non-numeric S.No, since the
 * summary row otherwise has the same column count as a real installment row.
 */
export function parseBranchWiseRepaymentWorkbook(buffer: ArrayBuffer | Buffer): Map<string, BranchRepaymentRow[]> {
    const workbook = Buffer.isBuffer(buffer)
        ? XLSX.read(buffer, { type: 'buffer' })
        : XLSX.read(new Uint8Array(buffer), { type: 'array' });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false, defval: '' }) as unknown[][];

    const header = (rows[0] ?? []) as unknown[];
    const idx = (name: string) => header.findIndex((h) => String(h ?? '').trim().toLowerCase() === name.toLowerCase());
    const loanIdIdx = idx('Loan ID');
    const memberIdIdx = idx('Member ID');
    const memberNameIdx = idx('Member Name');
    const sNoIdx = idx('S.No');
    const collectionDateIdx = idx('CollectionDate');
    const principalIdx = idx('Principal');
    const interestIdx = idx('Interest');
    const totalIdx = idx('Total Amount');

    const byLoan = new Map<string, BranchRepaymentRow[]>();
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const loanId = cell(row, loanIdIdx);
        if (!loanId) continue;

        const installmentNo = parseInt(cell(row, sNoIdx), 10);
        if (!Number.isFinite(installmentNo)) continue; // "Loan Total" summary row, or a stray blank line

        const list = byLoan.get(loanId) ?? [];
        list.push({
            loanId,
            memberId: cell(row, memberIdIdx),
            memberName: cell(row, memberNameIdx),
            installmentNo,
            collectionDate: toIso(cell(row, collectionDateIdx)) ?? new Date().toISOString(),
            principal: toNum(cell(row, principalIdx)),
            interest: toNum(cell(row, interestIdx)),
            totalAmount: toNum(cell(row, totalIdx)),
        });
        byLoan.set(loanId, list);
    }

    for (const list of byLoan.values()) list.sort((a, b) => a.installmentNo - b.installmentNo);
    return byLoan;
}

export interface BuildLoanHistoryParams {
    loanId: string;
    rows: BranchRepaymentRow[];
    loanProduct: LoanProductWithTemplates;
    officerName: string;
    /** From the member row's "No.Of Installments" — the full schedule (collected + tail)
     *  is generated to exactly this length. */
    totalInstallments: number;
    /** From the member row's "Loan Start Date" (ISO) — installment #1's due date; every
     *  other installment's due date is stepped forward from here by `frequency`, the same
     *  way the rest of this app generates a schedule. Source files never carry a reliable
     *  per-installment due-date column, and collection date is NOT a substitute (a payment
     *  collected early/late would otherwise drift the whole downstream schedule — see
     *  buildLoanHistoryForLoan's doc comment). */
    scheduleStartDate: string;
    /** The matched LoanProduct's own frequency (e.g. 'weekly', 'biweekly', 'monthly') —
     *  callers should always pass loanProduct.frequency here so the generated schedule's
     *  due-date spacing matches the product, not a hardcoded default. */
    frequency?: string;
}

export interface BuildLoanHistoryResult {
    loanCard: ParsedLoanCardReport;
    repayment: ParsedRepaymentReport;
    errors: string[];
    /** Non-blocking notices (unlike `errors`, which fail the row). Currently: repayment
     *  rows beyond the product's tenure that were dropped from schedule creation. */
    warnings: string[];
}

/**
 * Builds the same `ParsedLoanCardReport` / `ParsedRepaymentReport` shapes the old
 * per-member CSV flow produced, so backup-loan.service.ts's createBackupLoanFromReports /
 * replayRepaymentEvents need no changes to consume them.
 *
 * Due dates for EVERY installment (collected or not) come from one deterministic
 * computation — `scheduleStartDate` stepped forward by the product's `frequency`, exactly
 * the way this app generates any other schedule (`generateScheduleFromTemplates`) — never
 * from collection date. A payment collected early or late only affects `receivedDate` on
 * its own row; it can never shift that or any later installment's due date, which is what
 * happened before this computation existed (collectionDate doubling as dueDate let a
 * handful of early/late payments silently drift the entire projected tail).
 *
 * Collected amounts (principal/interest/total) still come verbatim from `rows` — only the
 * due date is computed, not the money.
 */
export function buildLoanHistoryForLoan(params: BuildLoanHistoryParams): BuildLoanHistoryResult {
    const { loanId, loanProduct, officerName, totalInstallments } = params;
    const frequency = params.frequency ?? 'weekly';
    const errors: string[] = [];
    const warnings: string[] = [];

    // The loan product's own No. of Dues is the HARD limit on how many LoanSchedule
    // rows this loan can ever have — a 60-due product yields exactly 60 rows no matter
    // how many lines the "Branch Wise Repayment" file carries. Legacy exports
    // re-amortise a defaulting member's arrears into extra installments (S.No 61,
    // 62, …); those surplus lines must never become schedule rows, must not be
    // replayed as collections, and must not raise the loan's payable amount. Falls
    // back to the product's template count, then the member-file figure, so
    // unit-test fixtures (which omit numberOfDues) still work.
    const productTenure =
        Number(loanProduct.numberOfDues) ||
        (loanProduct.scheduleTemplates ?? []).length ||
        totalInstallments;

    // Split incoming repayment rows once, up front: only installments 1..productTenure
    // feed schedule + event generation; anything past the tenure is dropped here and
    // reported as a non-blocking warning.
    const sortedRows = [...params.rows].sort((a, b) => a.installmentNo - b.installmentNo);
    const collectedRows = sortedRows.filter((r) => r.installmentNo >= 1 && r.installmentNo <= productTenure);
    const outOfRangeRows = sortedRows.filter((r) => r.installmentNo < 1 || r.installmentNo > productTenure);
    if (outOfRangeRows.length > 0) {
        warnings.push(
            `Loan ${loanId}: repayment file has ${outOfRangeRows.length} row(s) beyond the product's ` +
                `${productTenure}-due tenure — ignored for schedule creation and collection replay.`
        );
    }
    // Distinct in-range installment count (not raw row count) — a partial payment can
    // appear as more than one line for the same due; the tail filter below keys off
    // installment number, so it must too.
    const collectedCount = new Set(collectedRows.map((r) => r.installmentNo)).size;

    const events: RepaymentEvent[] = collectedRows.map((r) => ({
        dueNo: String(r.installmentNo),
        dueDate: r.collectionDate,
        dueAmount: Number((r.principal + r.interest).toFixed(2)),
        transactionDate: r.collectionDate,
        transactionType: 'Demand Collection',
        amount: Number(r.totalAmount.toFixed(2)),
        principalAmount: Number(r.principal.toFixed(2)),
        interestAmount: Number(r.interest.toFixed(2)),
        loanBalance: 0,
        walletAdvanceAmount: 0,
        walletAdvanceDate: null,
        walletPayAmount: 0,
        walletPayDate: null,
        walletBalance: 0,
    }));

    // One deterministic schedule for the loan's full term, computed purely from
    // scheduleStartDate + frequency — the single source of truth for every installment's
    // due date, whether already collected or still pending.
    const templates = (loanProduct.scheduleTemplates ?? []).slice(0, productTenure);
    if (templates.length < productTenure) {
        errors.push(
            `Loan ${loanId}: Loan Product's schedule only has ${(loanProduct.scheduleTemplates ?? []).length} installment(s) defined — ` +
                `fewer than the product's ${productTenure}-due tenure. Check the Loan Product's schedule template in Masters.`
        );
    }
    // Tail (not-yet-collected) installments must carry the product's own per-installment
    // savings/loan-advance amount — same as every other schedule-generation path in the
    // app (createBackupLoanWithHistory, live disbursement) — so future Demand Sheet /
    // Loan Advance Due figures aren't silently zeroed out for migrated loans.
    const advanceSavingsAmount = loanProduct.advanceSavingsAmount ? Number(loanProduct.advanceSavingsAmount) : 0;
    const fullSchedule = generateScheduleFromTemplates(templates, new Date(params.scheduleStartDate), frequency, advanceSavingsAmount);
    const scheduledByInstallmentNo = new Map(fullSchedule.map((item) => [item.installmentNo, item]));

    // Due amounts for an already-collected installment must still come from the loan
    // product's own template — same as every other schedule-generation path in the app
    // (bm-disburse's Final Disbursement, tailScheduleRows below) — never from what was
    // actually collected that day. A member who pays late, combines two dues into one
    // payment, or pays partially still owes the loan's real contractual EMI; using the
    // collected split as the due amount corrupts the schedule into whatever the payment
    // history happened to look like instead of the agreed terms. receivedAmount/
    // receivedDate stay as the real collected figures — only principalDue/interestDue/
    // totalDue (the balance actually being paid against) change here.
    const collectedScheduleRows: LoanCardScheduleRow[] = collectedRows.map((r) => {
        const templated = scheduledByInstallmentNo.get(r.installmentNo);
        const templatedTotalDue = templated?.totalDue ?? Number(r.totalAmount.toFixed(2));
        // A row appearing in the branch repayment file only means the old system has SOME
        // record for this installment — not that it was fully settled. If the recorded
        // amount doesn't cover the templated principal+interest (partial payment, or a
        // placeholder/$0 row), the installment is still open and must keep carrying the
        // product's savings/loan-advance amount, same as a tail row — otherwise it silently
        // loses its loan-advance amount forever (see the collectedCount cutoff below, which
        // only tells us row COUNT, not which installments are truly fully paid).
        const isFullyCollected = Number(r.totalAmount.toFixed(2)) >= templatedTotalDue;
        return {
            installmentNo: r.installmentNo,
            dueDate: (templated?.dueDate ?? new Date(r.collectionDate)).toISOString(),
            principalDue: templated?.principalDue ?? Number(r.principal.toFixed(2)),
            interestDue: templated?.interestDue ?? Number(r.interest.toFixed(2)),
            savingsDue: isFullyCollected ? 0 : (templated?.savingsDue ?? advanceSavingsAmount),
            feesDue: 0,
            totalDue: templatedTotalDue,
            outstandingBalance: 0,
            receivedDate: r.collectionDate,
            receivedAmount: Number(r.totalAmount.toFixed(2)),
        };
    });

    const tailScheduleRows: LoanCardScheduleRow[] = fullSchedule
        .filter((item) => item.installmentNo > collectedCount)
        .map((item) => ({
            installmentNo: item.installmentNo,
            dueDate: item.dueDate.toISOString(),
            principalDue: item.principalDue,
            interestDue: item.interestDue,
            savingsDue: item.savingsDue,
            feesDue: item.feesDue,
            totalDue: item.totalDue,
            outstandingBalance: 0,
            receivedDate: null,
            receivedAmount: null,
        }));

    const loanCard: ParsedLoanCardReport = {
        memberId: collectedRows[0]?.memberId ?? '',
        contractCode: loanId,
        officerName,
        groupName: '',
        amount: 0,
        funderName: '',
        installments: productTenure,
        interestRate: 0,
        disbursementDate: null,
        scheduleRows: [...collectedScheduleRows, ...tailScheduleRows],
    };

    const repayment: ParsedRepaymentReport = {
        memberId: collectedRows[0]?.memberId ?? '',
        clientName: collectedRows[0]?.memberName ?? '',
        events,
    };

    return { loanCard, repayment, errors, warnings };
}
