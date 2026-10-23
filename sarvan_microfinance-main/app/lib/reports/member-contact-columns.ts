// Client-safe (no prisma) column labels + search matcher for the Aadhaar / member
// mobile / co-applicant mobile columns that every member-level report shows.
// Server-side lookup lives in ./member-contacts.ts.

export const AADHAAR_HEADER = 'Aadhaar No';
export const MEMBER_MOBILE_HEADER = 'Member Mobile';
export const CO_APPLICANT_MOBILE_HEADER = 'Co-Applicant Mobile';
export const MEMBER_CONTACT_HEADERS = [AADHAAR_HEADER, MEMBER_MOBILE_HEADER, CO_APPLICANT_MOBILE_HEADER] as const;

export type MemberContactFields = {
    aadhaarNumber?: string | null;
    mobileNumber?: string | null;
    coApplicantMobile?: string | null;
};

/** The three values in MEMBER_CONTACT_HEADERS order, '-' when blank — for table cells / export rows. */
export function memberContactValues(r: MemberContactFields): [string, string, string] {
    return [r.aadhaarNumber || '-', r.mobileNumber || '-', r.coApplicantMobile || '-'];
}

/** Excel/CSV row fragment keyed by header — spread into a json_to_sheet row object. */
export function memberContactExcelCells(r: MemberContactFields): Record<string, string> {
    const [a, m, c] = memberContactValues(r);
    return { [AADHAAR_HEADER]: a, [MEMBER_MOBILE_HEADER]: m, [CO_APPLICANT_MOBILE_HEADER]: c };
}

/**
 * Extends a report's rich Word layout for the three contact columns appended to the end
 * of its rows: one standalone group header each, centered, and width weights — so a
 * grouped-header / fixed-width table still lines up. A totals row gets three blank cells.
 * Pass-through when `options` is undefined (flat layout needs nothing).
 */
export function withMemberContactWordColumns<
    T extends {
        groupHeaders?: { label: string; span: number }[];
        columnAlignments?: ('left' | 'center' | 'right')[];
        columnWidthWeights?: number[];
        totalsRow?: unknown[];
    } | undefined,
>(headers: readonly string[], options: T): T {
    if (!options) return options;
    // All three appended, or — for reports that already showed Aadhaar / phone — just
    // the trailing Co-Applicant Mobile column.
    const extra = endsWithMemberContactHeaders(headers) ? MEMBER_CONTACT_HEADERS.length
        : headers[headers.length - 1] === CO_APPLICANT_MOBILE_HEADER ? 1
        : 0;
    if (extra === 0) return options;
    const added = headers.slice(headers.length - extra);
    // Only extend arrays still sized for the pre-contact columns, so a report whose
    // options already cover the new columns is never padded twice.
    const base = headers.length - extra;
    const spanTotal = options.groupHeaders?.reduce((s, g) => s + g.span, 0);
    return {
        ...options,
        ...(options.groupHeaders && spanTotal === base && { groupHeaders: [...options.groupHeaders, ...added.map((label) => ({ label, span: 1 }))] }),
        ...(options.columnAlignments?.length === base && { columnAlignments: [...options.columnAlignments, ...added.map(() => 'center' as const)] }),
        ...(options.columnWidthWeights?.length === base && { columnWidthWeights: [...options.columnWidthWeights, ...[11, 9, 9].slice(-extra)] }),
        ...(options.totalsRow && options.totalsRow.length < headers.length && {
            totalsRow: [...options.totalsRow, ...new Array(headers.length - options.totalsRow.length).fill('')],
        }),
    };
}

/** True when the last three headers are the member contact columns (appended by every member-level report). */
export function endsWithMemberContactHeaders(headers: readonly string[]): boolean {
    const n = MEMBER_CONTACT_HEADERS.length;
    return headers.length >= n && MEMBER_CONTACT_HEADERS.every((h, i) => headers[headers.length - n + i] === h);
}

/**
 * True when the search term matches any of the given text fields (name, IDs, ...)
 * or the member's Aadhaar / mobile / co-applicant mobile. Digits-only comparison
 * for the numbers, so "9876 543 210" and "98765-43210" both match.
 */
export function matchesMemberSearch(term: string, r: MemberContactFields, ...text: Array<string | null | undefined>): boolean {
    const q = term.trim().toLowerCase();
    if (!q) return true;
    if (text.some((t) => t?.toLowerCase().includes(q))) return true;
    const digits = q.replace(/\D/g, '');
    if (!digits) return false;
    return [r.aadhaarNumber, r.mobileNumber, r.coApplicantMobile].some((v) => v?.replace(/\D/g, '').includes(digits));
}
