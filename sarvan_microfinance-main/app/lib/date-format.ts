/**
 * Project-wide date display format: DD/MM/YYYY (e.g. 01/10/2026), and
 * DD/MM/YYYY hh:mm AM/PM for date-times — always in India time (Asia/Kolkata),
 * so server-rendered PDFs/exports match what users see in the browser.
 *
 * Use these for anything a person reads. Machine formats (yyyy-MM-dd for API
 * params / input values, yyyyMMdd in file names) are NOT display formats and
 * must keep using date-fns `format` directly.
 *
 * Client- and server-safe (no Node or Prisma imports).
 */

/** date-fns pattern for the display date — for code already using `format()`. */
export const DISPLAY_DATE_FORMAT = 'dd/MM/yyyy';
/** date-fns pattern for the display date-time. */
export const DISPLAY_DATE_TIME_FORMAT = 'dd/MM/yyyy hh:mm a';

type DateLike = Date | string | number | null | undefined;

const TZ = 'Asia/Kolkata';
const ISO_DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

const dateParts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric',
});
const dateTimeParts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
});

function toDate(value: DateLike): Date | null {
    if (value === null || value === undefined || value === '') return null;
    const d = value instanceof Date ? value : new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
}

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
    return parts.find(p => p.type === type)?.value ?? '';
}

/** 01/10/2026 — `fallback` (default '') when the value is empty or not a date. */
export function toDisplayDate(value: DateLike, fallback = ''): string {
    // A bare calendar date ('2026-10-01') has no time zone — reorder it as-is.
    if (typeof value === 'string') {
        const m = ISO_DATE_ONLY.exec(value);
        if (m) return `${m[3]}/${m[2]}/${m[1]}`;
    }
    const d = toDate(value);
    if (!d) return fallback;
    const p = dateParts.formatToParts(d);
    return `${part(p, 'day')}/${part(p, 'month')}/${part(p, 'year')}`;
}

/** 01/10/2026 02:30 PM — `fallback` (default '') when the value is empty or not a date. */
export function toDisplayDateTime(value: DateLike, fallback = ''): string {
    const d = toDate(value);
    if (!d) return fallback;
    const p = dateTimeParts.formatToParts(d);
    const hour = part(p, 'hour') === '00' ? '12' : part(p, 'hour');
    return `${part(p, 'day')}/${part(p, 'month')}/${part(p, 'year')} ${hour}:${part(p, 'minute')} ${part(p, 'dayPeriod').toUpperCase()}`;
}

/** 'dd/mm/yyyy' (typed by a user) → 'yyyy-MM-dd', or null if it isn't a real date. */
export function parseDisplayDate(text: string): string | null {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text.trim());
    if (!m) return null;
    const day = Number(m[1]);
    const month = Number(m[2]);
    const year = Number(m[3]);
    const d = new Date(Date.UTC(year, month - 1, day));
    if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
