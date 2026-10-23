/**
 * Pure normalization/comparison helpers for identity/contact uniqueness
 * validation. No server-only imports (no Prisma) — safe to import from both
 * client components and server code. Server-only DB lookups live in
 * app/lib/services/identity-uniqueness.service.ts, which re-exports these.
 */

export type IdentityField = 'MOBILE' | 'AADHAAR' | 'PAN' | 'VOTER_ID' | 'BANK_ACCOUNT';

export const IDENTITY_FIELD_LABELS: Record<IdentityField, string> = {
    MOBILE: 'Mobile Number',
    AADHAAR: 'Aadhaar Number',
    PAN: 'PAN Card Number',
    VOTER_ID: 'Voter ID Number',
    BANK_ACCOUNT: 'Bank Account Number',
};

export function normalizeMobile(v?: string | null): string {
    if (!v) return '';
    const digits = v.replace(/\D/g, '');
    if (!digits) return '';
    return digits.length > 10 ? digits.slice(-10) : digits;
}

export function normalizeAadhaar(v?: string | null): string {
    if (!v) return '';
    return v.replace(/\s/g, '');
}

export function normalizePAN(v?: string | null): string {
    if (!v) return '';
    return v.trim().toUpperCase();
}

export function normalizeVoterId(v?: string | null): string {
    if (!v) return '';
    return v.replace(/\s/g, '').toUpperCase();
}

export function normalizeBankAccount(v?: string | null): string {
    if (!v) return '';
    return v.replace(/\D/g, '');
}

export function normalizeIdentityValue(field: IdentityField, v?: string | null): string {
    switch (field) {
        case 'MOBILE':
            return normalizeMobile(v);
        case 'AADHAAR':
            return normalizeAadhaar(v);
        case 'PAN':
            return normalizePAN(v);
        case 'VOTER_ID':
            return normalizeVoterId(v);
        case 'BANK_ACCOUNT':
            return normalizeBankAccount(v);
        default:
            return '';
    }
}

/**
 * True only when both sides are non-empty and equal after normalization.
 * Used for the "Client and Co-Applicant cannot use the same X" rule — this is
 * a separate check from checkIdentityUniqueness, which excludes same-family
 * records and therefore can never itself detect a same-family collision.
 */
export function valuesMatchAfterNormalization(
    field: IdentityField,
    a?: string | null,
    b?: string | null
): boolean {
    const na = normalizeIdentityValue(field, a);
    const nb = normalizeIdentityValue(field, b);
    return na !== '' && nb !== '' && na === nb;
}
