// ============================================================
// BELONGING RETURN — evidence rules
// app/lib/hr/belonging-return-rules.ts
//
// What closing an issued belonging needs, per outcome. Pure (no Prisma),
// shared by the Return Belonging modal (to show only the relevant fields) and
// POST /api/hr/belongings/issued/[id]/return (the real gate), so the two can
// never disagree.
//
//   RETURNED — photo(s) of the item; condition
//   DAMAGED  — photo(s) of the damage; condition; recovery amount optional
//   LOST     — no photo; recovery amount required (0 allowed when waived)
//   Remarks are optional for every outcome.
// ============================================================

export type BelongingReturnOutcome = 'RETURNED' | 'DAMAGED' | 'LOST';

export const BELONGING_PROOF_MAX_BYTES = 5 * 1024 * 1024;
export const BELONGING_PROOF_MAX_PHOTOS = 5;

export const BELONGING_CONDITIONS = ['Good', 'Fair', 'Poor'] as const;

export const OUTCOME_LABELS: Record<BelongingReturnOutcome, string> = {
    RETURNED: 'Returned',
    DAMAGED: 'Returned damaged',
    LOST: 'Lost / not returned',
};

export interface OutcomeFields {
    photos: boolean;
    condition: boolean;
    recoveryAmount: 'hidden' | 'optional' | 'required';
}

/** Which inputs each outcome uses — the modal renders only these. */
export const OUTCOME_FIELDS: Record<BelongingReturnOutcome, OutcomeFields> = {
    RETURNED: { photos: true, condition: true, recoveryAmount: 'hidden' },
    DAMAGED: { photos: true, condition: true, recoveryAmount: 'optional' },
    LOST: { photos: false, condition: false, recoveryAmount: 'required' },
};

/**
 * Returns the first problem with a return submission, or null when it's
 * complete. `recoveryAmount` is null/undefined when not entered.
 */
export function validateBelongingReturn(input: {
    status: BelongingReturnOutcome;
    photoCount: number;
    recoveryAmount?: number | null;
}): string | null {
    const { status, photoCount, recoveryAmount } = input;
    const fields = OUTCOME_FIELDS[status];

    if (fields.photos && photoCount < 1) return 'Add at least one photo of the returned item.';
    if (!fields.photos && photoCount > 0) return 'Photos are not recorded for a lost item.';
    if (photoCount > BELONGING_PROOF_MAX_PHOTOS) return `At most ${BELONGING_PROOF_MAX_PHOTOS} photos can be attached.`;

    if (recoveryAmount != null && (!Number.isFinite(recoveryAmount) || recoveryAmount < 0)) {
        return 'Recovery amount must be zero or more.';
    }
    if (fields.recoveryAmount === 'required' && recoveryAmount == null) {
        return 'Enter the recovery amount — ₹0 if the company will not charge the employee.';
    }
    return null;
}
