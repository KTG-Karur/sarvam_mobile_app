/** Checklist row code for denomination in EOD (`app/api/utilities/eod-process`). */
export const EOD_DENOMINATION_CHECKLIST_CODE = 10;

export const DENOMINATION_VALUES = {
    d500: 500,
    d100: 100,
    d200: 200,
    d50: 50,
    d20: 20,
    d10: 10,
    d5: 5,
    d2: 2,
    d1: 1,
} as const;

export type DenominationCounts = {
    [K in keyof typeof DENOMINATION_VALUES]: number;
};

export function normalizeDenominationCounts(
    input: Partial<Record<keyof typeof DENOMINATION_VALUES, unknown>>
): DenominationCounts {
    return {
        d500: Math.max(0, Number(input.d500) || 0),
        d200: Math.max(0, Number(input.d200) || 0),
        d100: Math.max(0, Number(input.d100) || 0),
        d50: Math.max(0, Number(input.d50) || 0),
        d20: Math.max(0, Number(input.d20) || 0),
        d10: Math.max(0, Number(input.d10) || 0),
        d5: Math.max(0, Number(input.d5) || 0),
        d2: Math.max(0, Number(input.d2) || 0),
        d1: Math.max(0, Number(input.d1) || 0),
    };
}

export function calculateDenominationTotal(counts: DenominationCounts): number {
    return Object.entries(DENOMINATION_VALUES).reduce((sum, [key, value]) => {
        return sum + counts[key as keyof DenominationCounts] * value;
    }, 0);
}

/** Strict descending note order for greedy subtraction — DENOMINATION_VALUES' insertion order is not descending. */
const DENOMINATION_NOTE_ORDER = [500, 200, 100, 50, 20, 10, 5, 2, 1] as const;

/**
 * Greedy largest-note-first subtraction — used to keep a stored denomination
 * breakdown (e.g. CollectionMeetingRecord) truthful when cash is removed from
 * the pile by an action that has no denomination UI of its own (e.g. a loan
 * advance revert), so a later manual correction isn't the only way it stays in sync.
 */
export function subtractDenominationNotes(counts: DenominationCounts, amount: number): DenominationCounts {
    let remaining = Math.max(0, Math.round(amount));
    // DenominationCounts is a homomorphic mapped type over a `const` object, so it
    // inherits readonly modifiers — mutate through a plain Record instead.
    const next: Record<string, number> = { ...counts };
    for (const note of DENOMINATION_NOTE_ORDER) {
        if (remaining <= 0) break;
        const key = `d${note}`;
        const removable = Math.min(next[key], Math.floor(remaining / note));
        next[key] -= removable;
        remaining -= removable * note;
    }
    return next as unknown as DenominationCounts;
}

export function roundAmountToPaise(amount: number): number {
    const n = Number.isFinite(amount) ? amount : 0;
    return Math.round(n * 100);
}

/** Compare cash totals in minor units to avoid float drift from DB aggregates. */
export function amountsMatchForDenomination(a: number, b: number): boolean {
    return roundAmountToPaise(a) === roundAmountToPaise(b);
}

/**
 * Floors branch collection totals to whole rupees for EOD denomination display and matching.
 * Physical note/coin entry cannot represent paise; DB aggregates may still carry paise for audit.
 */
export function floorToWholeRupeesForDenomination(amount: number): number {
    const n = Number.isFinite(amount) ? amount : 0;
    return Math.floor(n);
}

/**
 * True when denomination total (whole rupees from note counts) matches collection total
 * after flooring collection to whole rupees (EOD / denomination gate only).
 */
export function denominationMatchesFlooredCollection(
    denominationTotal: number,
    rawCollectionTotal: number
): boolean {
    const target = floorToWholeRupeesForDenomination(rawCollectionTotal);
    return amountsMatchForDenomination(denominationTotal, target);
}
