/**
 * Formats a monetary amount for report display/export: whole rupees, no decimal
 * places, TRUNCATED (not rounded) toward zero — 25000.75 -> "25,000", not "25,001".
 * Keeps Indian-style thousands grouping (existing report convention); never adds a
 * currency symbol — prepend one at the call site if that report already shows one.
 *
 * Only for monetary/amount fields. Do not use this for percentages, weights,
 * counts, IDs, phone numbers, or any other non-monetary numeric field.
 */
export function formatReportAmount(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '0';
  return Math.trunc(value).toLocaleString('en-IN');
}

/** Same as formatReportAmount but without thousands grouping — for exports (e.g. CSV) that need a plain numeric string. */
export function formatReportAmountPlain(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '0';
  return String(Math.trunc(value));
}

/**
 * Numeric (not string) truncation for Excel cells — writing a real number (rather than a
 * formatted string) keeps the cell sortable/filterable/summable in Excel while still showing
 * no decimal places, since the value itself has none.
 */
export function truncateReportAmount(value: number | null | undefined): number {
  if (value === null || value === undefined || Number.isNaN(value)) return 0;
  return Math.trunc(value);
}
