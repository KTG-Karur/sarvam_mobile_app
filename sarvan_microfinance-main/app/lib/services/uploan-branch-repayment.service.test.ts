import { describe, expect, it } from 'vitest';
import { buildLoanHistoryForLoan, type BranchRepaymentRow } from '@/app/lib/services/uploan-branch-repayment.service';
import type { LoanProductWithTemplates } from '@/app/lib/services/backup-loan.service';

function buildProduct(advanceSavingsAmount: number, installments: number): LoanProductWithTemplates {
    return {
        advanceSavingsAmount,
        numberOfDues: installments,
        scheduleTemplates: Array.from({ length: installments }, (_, i) => ({
            installmentNo: i + 1,
            principalAmount: '100',
            interestAmount: '20',
        })),
    } as unknown as LoanProductWithTemplates;
}

function repaymentRow(loanId: string, installmentNo: number, over: Partial<BranchRepaymentRow> = {}): BranchRepaymentRow {
    return {
        loanId,
        memberId: 'M1',
        memberName: 'Test',
        installmentNo,
        collectionDate: '2026-01-01',
        principal: 100,
        interest: 20,
        totalAmount: 120,
        ...over,
    };
}

describe('buildLoanHistoryForLoan', () => {
    it('carries the loan product\'s advanceSavingsAmount onto tail (not-yet-collected) schedule rows', () => {
        const collectedRows: BranchRepaymentRow[] = [
            { loanId: 'L1', memberId: 'M1', memberName: 'Test', installmentNo: 1, collectionDate: '2026-01-01', principal: 100, interest: 20, totalAmount: 120 },
            { loanId: 'L1', memberId: 'M1', memberName: 'Test', installmentNo: 2, collectionDate: '2026-01-08', principal: 100, interest: 20, totalAmount: 120 },
        ];

        const result = buildLoanHistoryForLoan({
            loanId: 'L1',
            rows: collectedRows,
            loanProduct: buildProduct(100, 4),
            officerName: 'Officer',
            totalInstallments: 4,
            scheduleStartDate: '2026-01-01',
            frequency: 'weekly',
        });

        const collected = result.loanCard.scheduleRows.filter((r) => r.installmentNo <= 2);
        const tail = result.loanCard.scheduleRows.filter((r) => r.installmentNo > 2);

        expect(collected).toHaveLength(2);
        expect(tail).toHaveLength(2);
        // Already-collected installments have no per-installment savings breakdown in the
        // source file — intentionally 0, not part of this bug.
        for (const row of collected) expect(row.savingsDue).toBe(0);
        // Not-yet-collected tail installments must reflect the product's own
        // advanceSavingsAmount, same as every other schedule-generation path in the app.
        for (const row of tail) expect(row.savingsDue).toBe(100);
    });

    it('sources principalDue/interestDue/totalDue for COLLECTED installments from the loan product template, not from what was actually collected', () => {
        // Installment 1 was paid exactly on schedule (100/20); installment 2 was a late/
        // partial catch-up payment that split very differently (60/0) from the true EMI —
        // this is exactly what corrupted real imported schedules (bug report: due amounts
        // degrading into erratic values like "600/0" once a member's payments stopped
        // landing exactly on schedule).
        const collectedRows: BranchRepaymentRow[] = [
            { loanId: 'L3', memberId: 'M1', memberName: 'Test', installmentNo: 1, collectionDate: '2026-01-01', principal: 100, interest: 20, totalAmount: 120 },
            { loanId: 'L3', memberId: 'M1', memberName: 'Test', installmentNo: 2, collectionDate: '2026-01-15', principal: 60, interest: 0, totalAmount: 60 },
        ];

        const result = buildLoanHistoryForLoan({
            loanId: 'L3',
            rows: collectedRows,
            loanProduct: buildProduct(0, 2),
            officerName: 'Officer',
            totalInstallments: 2,
            scheduleStartDate: '2026-01-01',
            frequency: 'weekly',
        });

        const [row1, row2] = result.loanCard.scheduleRows.sort((a, b) => a.installmentNo - b.installmentNo);

        // Due amounts always match the product template (100/20), regardless of what was
        // actually collected on that installment.
        expect(row1.principalDue).toBe(100);
        expect(row1.interestDue).toBe(20);
        expect(row1.totalDue).toBe(120);
        expect(row2.principalDue).toBe(100);
        expect(row2.interestDue).toBe(20);
        expect(row2.totalDue).toBe(120);

        // The actual collected amount is still preserved separately via receivedAmount.
        expect(row1.receivedAmount).toBe(120);
        expect(row2.receivedAmount).toBe(60);
    });

    it('carries the loan advance onto a COLLECTED installment that was only partially paid, not just onto the tail', () => {
        // Real-world bug: a branch repayment file row exists for installment 2 (so it lands
        // in the "collected" partition, not the tail), but only 60 of the 120 due was
        // actually recorded — the installment is still genuinely open. It must keep its
        // savingsDue instead of silently losing it forever like a fully-settled row would.
        const collectedRows: BranchRepaymentRow[] = [
            { loanId: 'L4', memberId: 'M1', memberName: 'Test', installmentNo: 1, collectionDate: '2026-01-01', principal: 100, interest: 20, totalAmount: 120 },
            { loanId: 'L4', memberId: 'M1', memberName: 'Test', installmentNo: 2, collectionDate: '2026-01-15', principal: 60, interest: 0, totalAmount: 60 },
        ];

        const result = buildLoanHistoryForLoan({
            loanId: 'L4',
            rows: collectedRows,
            loanProduct: buildProduct(100, 2),
            officerName: 'Officer',
            totalInstallments: 2,
            scheduleStartDate: '2026-01-01',
            frequency: 'weekly',
        });

        const [row1, row2] = result.loanCard.scheduleRows.sort((a, b) => a.installmentNo - b.installmentNo);
        // Installment 1 was fully collected (120 covers the 120 due) — no loan advance owed.
        expect(row1.savingsDue).toBe(0);
        // Installment 2 was only partially collected (60 of 120) — still open, so it keeps
        // the product's loan advance amount.
        expect(row2.savingsDue).toBe(100);
    });

    it('never creates more schedule rows than the loan product tenure, no matter how many repayment rows the file has', () => {
        // Legacy export re-amortised a defaulting member's arrears into installments 5-8;
        // the product is only a 4-due loan. The extra lines must NOT become schedule rows
        // (61, 62… in the real bug), must NOT be replayed as collections, and must NOT
        // raise the payable amount. No blocking error — a non-blocking warning only.
        const rows: BranchRepaymentRow[] = Array.from({ length: 8 }, (_, i) => repaymentRow('L5', i + 1));

        const result = buildLoanHistoryForLoan({
            loanId: 'L5',
            rows,
            loanProduct: buildProduct(100, 4),
            officerName: 'Officer',
            totalInstallments: 8, // even when the member file's own figure is inflated
            scheduleStartDate: '2026-01-01',
            frequency: 'weekly',
        });

        expect(result.errors).toHaveLength(0);
        expect(result.loanCard.scheduleRows).toHaveLength(4);
        expect(Math.max(...result.loanCard.scheduleRows.map((r) => r.installmentNo))).toBe(4);
        // Only in-range collections replay — total payable/collected stays within the loan.
        expect(result.repayment.events).toHaveLength(4);
        expect(result.warnings.join(' ')).toMatch(/4 row\(s\) beyond the product's 4-due tenure/);
        // The 4 real dues keep the product-template due amounts + their collected figures.
        for (const row of result.loanCard.scheduleRows) {
            expect(row.principalDue).toBe(100);
            expect(row.interestDue).toBe(20);
            expect(row.totalDue).toBe(120);
            expect(row.receivedAmount).toBe(120);
        }
    });

    it('generates the full product-tenure schedule even when the member file understates the installment count', () => {
        // Member file says 2 installments but the product is a 4-due loan — the schedule
        // must still be 4 rows (2 collected + 2 tail), not truncated to 2.
        const rows: BranchRepaymentRow[] = [repaymentRow('L6', 1), repaymentRow('L6', 2)];

        const result = buildLoanHistoryForLoan({
            loanId: 'L6',
            rows,
            loanProduct: buildProduct(100, 4),
            officerName: 'Officer',
            totalInstallments: 2,
            scheduleStartDate: '2026-01-01',
            frequency: 'weekly',
        });

        expect(result.errors).toHaveLength(0);
        expect(result.warnings).toHaveLength(0);
        expect(result.loanCard.scheduleRows).toHaveLength(4);
    });

    it('produces 0 savingsDue on tail rows when the product has no advanceSavingsAmount', () => {
        const result = buildLoanHistoryForLoan({
            loanId: 'L2',
            rows: [],
            loanProduct: buildProduct(0, 2),
            officerName: 'Officer',
            totalInstallments: 2,
            scheduleStartDate: '2026-01-01',
            frequency: 'weekly',
        });

        for (const row of result.loanCard.scheduleRows) expect(row.savingsDue).toBe(0);
    });
});
