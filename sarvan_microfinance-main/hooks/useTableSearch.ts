import { useMemo, useState } from 'react';

// Always non-user-facing regardless of what the value looks like.
const ALWAYS_SKIP_KEY = /(password|token|signature|__typename)/i;
// Key shape of a raw/foreign-key id field, at any nesting depth.
const ID_KEY = /(^id$|Id$|_id$)/i;
// This app's generated cuids (Prisma @default(cuid())): a lowercase letter
// followed by 20+ lowercase alphanumeric chars, no separators — e.g.
// "cmty943um0007sv08h5vm0tj1". A human-facing business code stored in an
// *Id-suffixed field (e.g. employeeId "EMP-520") never matches this, so it
// stays searchable; only the opaque generated ids get filtered out.
const OPAQUE_ID_VALUE = /^[a-z][a-z0-9]{20,}$/i;
// e.g. area -> division -> region.name is depth 2; stops before pathological cycles.
const MAX_DEPTH = 3;

function collect(value: unknown, depth: number, out: string[]): void {
    if (value == null || depth > MAX_DEPTH) return;
    if (typeof value === 'string') {
        if (value.trim()) out.push(value);
        return;
    }
    if (typeof value === 'number') {
        out.push(String(value));
        return;
    }
    if (typeof value !== 'object') return;
    if (Array.isArray(value)) {
        for (const v of value) collect(v, depth + 1, out);
        return;
    }
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (ALWAYS_SKIP_KEY.test(k)) continue;
        if (ID_KEY.test(k)) {
            if (typeof v === 'string' && !OPAQUE_ID_VALUE.test(v)) collect(v, depth + 1, out);
            continue;
        }
        collect(v, depth + 1, out);
    }
}

export interface UseTableSearchOptions<T> {
    /**
     * Escape hatch for values a row doesn't expose as a matchable primitive —
     * e.g. a boolean rendered as "Active"/"Inactive", or a formatted date/enum
     * label. Only wire this up if a real gap surfaces; don't pre-emptively add it.
     */
    extraText?: (row: T) => string;
}

/**
 * Generic "search everything visible in this row" filter for client-side
 * table/list pages. Recursively collects string/number leaf values from each
 * row (skipping id-like fields) and matches all whitespace-separated query
 * tokens against that row's collected text (AND across tokens).
 */
export function useTableSearch<T>(rows: T[], options?: UseTableSearchOptions<T>) {
    const [query, setQuery] = useState('');

    const haystacks = useMemo(
        () =>
            rows.map((row) => {
                const parts: string[] = [];
                collect(row, 0, parts);
                if (options?.extraText) parts.push(options.extraText(row));
                return parts.join(' ').toLowerCase();
            }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [rows]
    );

    const filtered = useMemo(() => {
        const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
        if (tokens.length === 0) return rows;
        return rows.filter((_, i) => tokens.every((tok) => haystacks[i].includes(tok)));
    }, [rows, haystacks, query]);

    return { query, setQuery, filtered } as const;
}
