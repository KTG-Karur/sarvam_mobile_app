import type { Prisma } from '@prisma/client';
import type {
    ParsedLoanCardReport,
    ParsedRepaymentReport,
    RepaymentEvent,
} from '@/app/lib/services/uploan-loan-history.service';

/**
 * Approximate reconstruction of a backup/migrated loan's `{ loanCard, repayment,
 * savingsPaid }` source envelope from its real `LoanSchedule` + `LoanTransaction` rows —
 * the fallback the Loan History Edit tool uses for loans imported BEFORE
 * `Loan.migratedLoanSource` existed (loans imported after it carry the exact source and
 * never need this).
 *
 * Deliberately different from the display-only reconstruction in
 * `app/api/ongoing-loan-backup/eligible-clients/route.ts`: that one emits
 * `transactionType: <raw Prisma enum>`, which `replayRepaymentEvents` (backup-loan.service.ts)
 * would mis-handle — every non-"disbursement" type falls into its repayment branch, so a
 * reconstructed `SAVINGS_COLLECTION` becomes a bogus REPAYMENT *and* re-posts itself via the
 * wallet-advance block. This version:
 *  - emits only `Demand Collection` / `Disbursement` events (the two `replayRepaymentEvents`
 *    understands), from `REPAYMENT` / `DISBURSEMENT` transactions only;
 *  - keeps `walletAdvanceAmount` / `walletPayAmount` at 0 on every event;
 *  - folds `SAVINGS_COLLECTION` (+) and `ADJUSTMENT` (−, wallet drawdown) into a single net
 *    `savingsPaid` lump, replayed once by `applySavingsLumpSum`.
 *
 * It is LOSSY — due dates / cumulative balances aren't stored, multiple payments against one
 * installment collapse, `dueNo` is best-effort from `lines[0]`. The UI labels loans that go
 * through this path as "approximate".
 */

type ReconstructLoanInput = {
    loanNumber: string;
    amount: Prisma.Decimal | number;
    interestRate: Prisma.Decimal | number;
    disbursedByBMAt: Date | null;
    clientClientId: string;
    clientName: string;
    officerName: string;
    funderName: string;
    schedules: {
        installmentNo: number;
        dueDate: Date;
        principalDue: Prisma.Decimal | number;
        interestDue: Prisma.Decimal | number;
        savingsDue: Prisma.Decimal | number;
        feesDue: Prisma.Decimal | number;
        totalDue: Prisma.Decimal | number;
        totalPaid: Prisma.Decimal | number;
        paidAt: Date | null;
    }[];
    transactions: {
        type: string;
        transactionDate: Date;
        amount: Prisma.Decimal | number;
        principalAmount: Prisma.Decimal | number | null;
        interestAmount: Prisma.Decimal | number | null;
        lines: { installmentNo: number }[];
    }[];
};

export interface ReconstructedBackupLoanSource {
    loanCard: ParsedLoanCardReport;
    repayment: ParsedRepaymentReport;
    savingsPaid: number;
}

const n = (v: Prisma.Decimal | number | null | undefined): number => (v == null ? 0 : Number(v));

export function reconstructBackupLoanSource(loan: ReconstructLoanInput): ReconstructedBackupLoanSource {
    const orderedTxns = [...loan.transactions].sort(
        (a, b) => a.transactionDate.getTime() - b.transactionDate.getTime()
    );

    let runningLoanBalance = n(loan.amount);
    let savingsPaid = 0;
    const events: RepaymentEvent[] = [];

    for (const t of orderedTxns) {
        if (t.type === 'SAVINGS_COLLECTION') {
            savingsPaid += n(t.amount);
            continue;
        }
        if (t.type === 'ADJUSTMENT') {
            // Migrated wallet drawdown — advance drawn down to cover a due (see
            // replayRepaymentEvents' walletPay branch). Nets against the savings lump.
            savingsPaid -= n(t.amount);
            continue;
        }
        if (t.type !== 'REPAYMENT' && t.type !== 'DISBURSEMENT') continue;

        const isDisbursement = t.type === 'DISBURSEMENT';
        if (!isDisbursement) runningLoanBalance -= n(t.principalAmount);

        events.push({
            dueNo: t.lines[0]?.installmentNo != null ? String(t.lines[0].installmentNo) : '',
            dueDate: null,
            dueAmount: 0,
            transactionDate: t.transactionDate.toISOString(),
            transactionType: isDisbursement ? 'Disbursement' : 'Demand Collection',
            amount: n(t.amount),
            principalAmount: n(t.principalAmount),
            interestAmount: n(t.interestAmount),
            loanBalance: Math.max(0, Number(runningLoanBalance.toFixed(2))),
            // Kept at 0 on purpose — the netted `savingsPaid` lump carries all wallet
            // movement; a non-zero here would double-post it through replayRepaymentEvents.
            walletAdvanceAmount: 0,
            walletAdvanceDate: null,
            walletPayAmount: 0,
            walletPayDate: null,
            walletBalance: 0,
        });
    }

    const orderedSchedules = [...loan.schedules].sort((a, b) => a.installmentNo - b.installmentNo);

    const loanCard: ParsedLoanCardReport = {
        memberId: loan.clientClientId,
        contractCode: loan.loanNumber,
        officerName: loan.officerName,
        groupName: '',
        amount: n(loan.amount),
        funderName: loan.funderName,
        installments: orderedSchedules.length,
        interestRate: n(loan.interestRate),
        disbursementDate: loan.disbursedByBMAt ? loan.disbursedByBMAt.toISOString() : null,
        scheduleRows: orderedSchedules.map((s) => ({
            installmentNo: s.installmentNo,
            dueDate: s.dueDate.toISOString(),
            principalDue: n(s.principalDue),
            interestDue: n(s.interestDue),
            savingsDue: n(s.savingsDue),
            feesDue: n(s.feesDue),
            totalDue: n(s.totalDue),
            // Per-installment remaining (totalDue − totalPaid), not a cumulative whole-loan
            // balance — that figure isn't stored. Display/edit only; replay recomputes it.
            outstandingBalance: Math.max(0, n(s.totalDue) - n(s.totalPaid)),
            receivedDate: s.paidAt ? s.paidAt.toISOString() : null,
            receivedAmount: n(s.totalPaid) > 0 ? n(s.totalPaid) : null,
        })),
    };

    const repayment: ParsedRepaymentReport = {
        memberId: loan.clientClientId,
        clientName: loan.clientName,
        events,
    };

    // A net-negative carried advance can't be re-applied as a positive lump — clamp to 0
    // (the PUT validator also requires >= 0). Rare: only when migrated ADJUSTMENT drawdowns
    // exceeded SAVINGS_COLLECTION credits in the reconstructed trail.
    return { loanCard, repayment, savingsPaid: Math.max(0, Number(savingsPaid.toFixed(2))) };
}
