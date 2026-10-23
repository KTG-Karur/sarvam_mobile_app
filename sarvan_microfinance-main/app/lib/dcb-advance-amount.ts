import { getKolkataCalendarYmd } from '@/app/lib/branch-lock';

function transactionDateIsBeforeDueDateIst(transactionDate: Date, dueDate: Date): boolean {
    return getKolkataCalendarYmd(transactionDate) < getKolkataCalendarYmd(dueDate);
}

const NON_DEMAND_COLLECTION_LABEL = 'Non Demand Collection';

function safeNum(value: unknown): number {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : 0;
}

function normalizeCollectionType(raw: string | null | undefined): string {
    return (raw ?? '').trim();
}

/**
 * Legacy rows may have no transaction lines; those used `collectionType` only.
 */
export function isLegacyNonDemandCollection(collectionType: string | null | undefined): boolean {
    return normalizeCollectionType(collectionType).toLowerCase() === NON_DEMAND_COLLECTION_LABEL.toLowerCase();
}

export type DcbRepaymentLineInput = {
    lineTotal?: unknown;
    principalAmount?: unknown;
    interestAmount?: unknown;
    schedule: { dueDate: Date | string } | null | undefined;
};

export type SplitRepaymentForDcbInput = {
    transactionDate: Date;
    lines: DcbRepaymentLineInput[] | null | undefined;
    principalAmount: unknown;
    interestAmount: unknown;
    amount: unknown;
    collectionType: string | null | undefined;
};

export type SplitRepaymentForDcbResult = {
    /**
     * Sum of `lineTotal` for lines where payment date is strictly before schedule due date.
     * Matches `/api/reports/daily-monitoring/advance-collection` semantics.
     */
    advanceFromEarlyInstallments: number;
    /**
     * Principal + interest that is not attributed to early installments — drives demand waterfall.
     */
    demandSidePrincipalInterest: number;
    /**
     * Total cash for `totalColl` (prefers header `amount`, includes fees/penalties when present).
     */
    repaymentGrossAmount: number;
};

/**
 * Splits an approved repayment for DCB: advance (paid before installment due) vs demand-side P+I.
 */
export function splitRepaymentForDcb(input: SplitRepaymentForDcbInput): SplitRepaymentForDcbResult {
    const principalInterest = safeNum(input.principalAmount) + safeNum(input.interestAmount);
    const headerAmount = safeNum(input.amount);
    const repaymentGrossAmount =
        headerAmount > 0 ? headerAmount : principalInterest > 0 ? principalInterest : 0;

    const lines = input.lines ?? [];
    const hasLines = lines.length > 0;

    let advanceFromEarlyInstallments = 0;
    let earlyPrincipalInterest = 0;

    for (const line of lines) {
        if (!line.schedule?.dueDate) {
            continue;
        }
        if (!transactionDateIsBeforeDueDateIst(input.transactionDate, new Date(line.schedule.dueDate))) {
            continue;
        }
        advanceFromEarlyInstallments += safeNum(line.lineTotal);
        earlyPrincipalInterest += safeNum(line.principalAmount) + safeNum(line.interestAmount);
    }

    if (!hasLines && isLegacyNonDemandCollection(input.collectionType)) {
        advanceFromEarlyInstallments = repaymentGrossAmount;
        earlyPrincipalInterest = principalInterest;
    }

    earlyPrincipalInterest = Math.min(earlyPrincipalInterest, principalInterest);
    const demandSidePrincipalInterest = Math.max(0, principalInterest - earlyPrincipalInterest);

    return {
        advanceFromEarlyInstallments,
        demandSidePrincipalInterest,
        repaymentGrossAmount,
    };
}
