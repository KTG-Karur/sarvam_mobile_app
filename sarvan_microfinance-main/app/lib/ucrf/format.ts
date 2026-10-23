/** Pure formatting helpers for the UCRF/CDF writer. No DB or framework imports. */

const KOLKATA = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
});

/** Calendar date (YYYY-MM-DD) of an instant in Asia/Kolkata. */
export function toKolkataYmd(d: Date | null | undefined): string | null {
    if (!d || Number.isNaN(d.getTime())) return null;
    return KOLKATA.format(d);
}

export function isValidYmd(ymd: string | null | undefined): ymd is string {
    if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
    const [y, m, d] = ymd.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** YYYY-MM-DD → DDMMYYYY (UCRF date format). Empty string for null. */
export function ymdToDdmmyyyy(ymd: string | null | undefined): string {
    if (!ymd) return '';
    return `${ymd.slice(8, 10)}${ymd.slice(5, 7)}${ymd.slice(0, 4)}`;
}

export function ddmmyyyyToYmd(s: string): string | null {
    if (!/^\d{8}$/.test(s)) return null;
    const ymd = `${s.slice(4, 8)}-${s.slice(2, 4)}-${s.slice(0, 2)}`;
    return isValidYmd(ymd) ? ymd : null;
}

export function daysBetweenYmd(fromYmd: string, toYmd: string): number {
    const a = Date.UTC(+fromYmd.slice(0, 4), +fromYmd.slice(5, 7) - 1, +fromYmd.slice(8, 10));
    const b = Date.UTC(+toYmd.slice(0, 4), +toYmd.slice(5, 7) - 1, +toYmd.slice(8, 10));
    return Math.round((b - a) / 86_400_000);
}

export function monthStartYmd(ymd: string): string {
    return `${ymd.slice(0, 7)}-01`;
}

/** Money is held as integer paise inside calculations so sums never accumulate float error. */
export function toPaise(v: number | string | { toString(): string } | null | undefined): number {
    if (v === null || v === undefined || v === '') return 0;
    const n = typeof v === 'number' ? v : Number(v.toString());
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * 100);
}

/** UCRF amounts are whole rupees: "the value up to the decimal point will be considered" → truncate. */
export function paiseToRupeesTrunc(paise: number): number {
    return paise < 0 ? -Math.trunc(-paise / 100) : Math.trunc(paise / 100);
}

export function paiseToRupees(paise: number): number {
    return Math.round(paise) / 100;
}

/**
 * Make a free-text value safe for a pipe-delimited line: the delimiter and any line breaks or
 * control characters would corrupt the record, so they become spaces; runs of spaces collapse.
 */
export function cleanText(v: string | null | undefined): string {
    if (!v) return '';
    return v
        .replace(/[|\r\n\t\u0000-\u001f\u007f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export const PRINTABLE_ASCII = /^[\x20-\x7E]*$/;

/** Right-pad (never truncate) to a fixed width. */
export function padRight(v: string, width: number): string {
    return v.length >= width ? v : v + ' '.repeat(width - v.length);
}

export function digitsOnly(v: string | null | undefined): string {
    return (v ?? '').replace(/\D+/g, '');
}

/** Mask all but the last 4 characters (IDs, phones, account numbers) for display/log safety. */
export function maskValue(v: string): string {
    if (v.length <= 4) return '*'.repeat(v.length);
    return `${'*'.repeat(v.length - 4)}${v.slice(-4)}`;
}
