import { z } from 'zod';

/**
 * Shared Zod schemas for the parsed Loan Card Report / Repayment Report payloads that
 * drive a backup/migrated loan's schedule + transaction replay. Mirrors
 * `ParsedLoanCardReport` / `ParsedRepaymentReport` from
 * `app/lib/services/uploan-loan-history.service.ts` — those parse client-side and travel
 * to the server as plain JSON (dates as ISO strings).
 *
 * Used by:
 * - POST /api/ongoing-loan-backup            (single-entry "Ongoing Loan Backup" form)
 * - PUT  /api/uploan/loan-history/loans/[id] (the Loan History Edit tool — add/edit/delete rows)
 *
 * `.strip()` (Zod's default for objects) drops the client-only `rowId` key without error.
 */

export const loanCardScheduleRowSchema = z.object({
    installmentNo: z.number().int().positive(),
    dueDate: z.string().min(1),
    principalDue: z.number().min(0),
    interestDue: z.number().min(0),
    savingsDue: z.number().min(0),
    feesDue: z.number().min(0),
    totalDue: z.number().min(0),
    outstandingBalance: z.number(),
    receivedDate: z.string().nullable(),
    receivedAmount: z.number().nullable(),
});

export const loanCardReportSchema = z
    .object({
        memberId: z.string(),
        contractCode: z.string(),
        officerName: z.string(),
        groupName: z.string(),
        amount: z.number(),
        funderName: z.string(),
        installments: z.number(),
        interestRate: z.number(),
        disbursementDate: z.string().nullable(),
        scheduleRows: z.array(loanCardScheduleRowSchema),
    })
    .superRefine((report, ctx) => {
        // A user-authored grid can now produce duplicate / non-contiguous installment
        // numbers — `LoanSchedule` has `@@unique([loanId, installmentNo])`, so a duplicate
        // becomes a `createMany` P2002 mid-transaction. Catch it here with a clear message.
        const seen = new Set<number>();
        for (const row of report.scheduleRows) {
            if (seen.has(row.installmentNo)) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: `Duplicate installment number ${row.installmentNo} in the Loan Card schedule — each row must have a unique #`,
                    path: ['scheduleRows'],
                });
            }
            seen.add(row.installmentNo);
        }
    });

export const repaymentEventSchema = z.object({
    dueNo: z.string(),
    dueDate: z.string().nullable(),
    dueAmount: z.number(),
    transactionDate: z.string().min(1),
    transactionType: z.string(),
    amount: z.number(),
    principalAmount: z.number(),
    interestAmount: z.number(),
    loanBalance: z.number(),
    walletAdvanceAmount: z.number(),
    walletAdvanceDate: z.string().nullable(),
    walletPayAmount: z.number(),
    walletPayDate: z.string().nullable(),
    walletBalance: z.number(),
});

export const repaymentReportSchema = z.object({
    memberId: z.string(),
    clientName: z.string(),
    events: z.array(repaymentEventSchema),
});

export type LoanCardReportInput = z.infer<typeof loanCardReportSchema>;
export type RepaymentReportInput = z.infer<typeof repaymentReportSchema>;
