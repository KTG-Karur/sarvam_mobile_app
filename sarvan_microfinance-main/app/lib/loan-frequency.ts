/**
 * Loan repayment frequency is a per-loan attribute. These helpers centralize
 * index/report labeling when multiple loans are grouped (e.g. one index batch).
 */

export const LOAN_INDEX_FREQUENCY_MIXED = 'MIXED';
export const LOAN_INDEX_FREQUENCY_ALL = 'ALL';

/** Fixed-day installment spacing for 'monthly'/'quarterly' — multiples of 7 so the
 *  due date's day-of-week never drifts off the center's meeting day, same as
 *  'weekly'(7) and 'forthnight'(14) already behave. NOT a calendar month/quarter. */
export const MONTHLY_INTERVAL_DAYS = 28;
export const QUARTERLY_INTERVAL_DAYS = 91;

/**
 * Normalize for equality checks only (case-insensitive, trimmed).
 */
export function normalizeFrequencyKey(value: string | null | undefined): string {
    if (value == null || !String(value).trim()) {
        return '';
    }
    return String(value).trim().toLowerCase();
}

/**
 * Label stored on LoanIndex when grouping loans that may differ in frequency.
 * - Explicit body value wins (legacy API).
 * - Single distinct frequency → that loan's stored value (first occurrence).
 * - Multiple → MIXED
 * - None → ALL
 */
export function deriveLoanIndexFrequency(params: {
    loanFrequencies: Array<string | null | undefined>;
    explicitBodyFrequency?: string | null;
}): string {
    const explicit = params.explicitBodyFrequency?.trim();
    if (explicit) {
        return explicit;
    }

    const nonNull = params.loanFrequencies.filter(
        (f): f is string => f != null && String(f).trim() !== ''
    );
    if (nonNull.length === 0) {
        return LOAN_INDEX_FREQUENCY_ALL;
    }

    const keys = nonNull.map((f) => normalizeFrequencyKey(f));
    const uniqueKeys = [...new Set(keys.filter((k) => k !== ''))];
    if (uniqueKeys.length === 0) {
        return LOAN_INDEX_FREQUENCY_ALL;
    }
    if (uniqueKeys.length === 1) {
        return nonNull[0].trim();
    }
    return LOAN_INDEX_FREQUENCY_MIXED;
}

/**
 * Prefer loan-level frequency; fall back to product default for legacy rows.
 */
export function resolveLoanFrequencyForDisplay(
    loanFrequency: string | null | undefined,
    productFrequency: string | null | undefined,
    fallback = 'MONTHLY'
): string {
    const lf = loanFrequency?.trim();
    if (lf) {
        return lf;
    }
    const pf = productFrequency?.trim();
    if (pf) {
        return pf;
    }
    return fallback;
}
