// ============================================================
// ONBOARDING DUPLICATE-IDENTITY CHECK — shared helper
// app/lib/hr/onboarding-duplicate-check.ts
//
// Blocks the same mobile/Aadhaar/PAN/DL/Voter ID/UAN from being attached to
// more than one active employee or in-flight onboarding request. No Prisma
// schema change — none of these 5 (besides mobileNumber, which already
// carries a DB-level @unique on User) have a uniqueness constraint, so this
// is an app-level check, same pattern as generate-employee-id.ts's
// PrismaOrTx signature (works both outside and inside a $transaction).
//
// Normalization for mobile/PAN/Voter ID deliberately reuses the pure
// helpers already in app/lib/identity-normalization.ts (built for the
// Client/CoApplicant enrollment domain) rather than re-deriving equivalent
// logic — same real-world data shape, one definition. Aadhaar/DL/UAN have
// no equivalent there (that domain doesn't track DL/UAN, and its Aadhaar
// normalizer only strips whitespace) so those three are defined fresh here.
// ============================================================

import type { Prisma, PrismaClient } from '@prisma/client';
import { normalizeMobile, normalizePAN, normalizeVoterId } from '@/app/lib/identity-normalization';

type PrismaOrTx = PrismaClient | Prisma.TransactionClient;

export type OnboardingIdentityField =
    | 'mobileNumber'
    | 'aadhaarNumber'
    | 'panNumber'
    | 'dlNumber'
    | 'voterIdNumber'
    | 'uanNumber';

// Fixed check order — first match wins. Matches the field labels already
// used elsewhere in this module (OnboardingRequestForm / TILE_DEFS), not
// generic "X Number" phrasing, so an error message reads consistently with
// the form the admin/joinee is looking at.
export const ONBOARDING_IDENTITY_FIELDS: OnboardingIdentityField[] = [
    'mobileNumber', 'aadhaarNumber', 'panNumber', 'dlNumber', 'voterIdNumber', 'uanNumber',
];

export const ONBOARDING_IDENTITY_FIELD_LABELS: Record<OnboardingIdentityField, string> = {
    mobileNumber: 'Mobile',
    aadhaarNumber: 'Aadhaar',
    panNumber: 'PAN',
    dlNumber: 'DL / LLR',
    voterIdNumber: 'Voter ID',
    uanNumber: 'UAN',
};

function digitsOnly(v: string): string {
    return v.replace(/\D/g, '');
}

function alnumUpper(v: string): string {
    return v.replace(/\s/g, '').toUpperCase();
}

/**
 * Normalizes one identity field's value for comparison/storage.
 * Blank/whitespace-only input → null (never checked, never blocks, never
 * written over an existing value by the "normalize on write" call sites).
 */
export function normalize(field: OnboardingIdentityField, value?: string | null): string | null {
    if (!value) return null;
    const trimmed = value.trim();
    if (!trimmed) return null;

    let result: string;
    switch (field) {
        case 'mobileNumber':
            // Reused, not re-derived: strips non-digits AND takes the last 10
            // if longer (handles a stored "+91XXXXXXXXXX"/"0XXXXXXXXXX" prefix
            // correctly) — strictly more robust than a bare digit-strip, and
            // zod already constrains fresh onboarding input to exactly 10
            // digits anyway, so this only matters when comparing against
            // possibly-differently-formatted legacy User rows.
            result = normalizeMobile(trimmed);
            break;
        case 'aadhaarNumber':
        case 'uanNumber':
            result = digitsOnly(trimmed);
            break;
        case 'panNumber':
            result = normalizePAN(trimmed);
            break;
        case 'voterIdNumber':
            result = normalizeVoterId(trimmed);
            break;
        case 'dlNumber':
            result = alnumUpper(trimmed);
            break;
    }
    return result || null;
}

export interface OnboardingDuplicateHit {
    field: OnboardingIdentityField;
    label: string;
    /** Normalized value that matched. */
    value: string;
    source: 'employee' | 'request';
    holderName?: string;
    /** Only set when source is 'employee'. */
    holderId?: string | null;
    /** Only set when source is 'request'. */
    requestStatus?: string;
}

/** Informational-only "possible rejoiner" signal — never blocks, never
 * shown on the public route. Deliberately carries no PII beyond what an
 * HR admin already has in the employee master (name, employee ID, exit
 * date) — no old contact/identity numbers are echoed back. */
export interface OnboardingRejoinerHint {
    field: OnboardingIdentityField;
    employeeId: string | null;
    name: string;
    dateOfExit: Date | null;
}

export interface OnboardingDuplicateCheckResult {
    /** Blocking hit, or null if nothing blocks. */
    hit: OnboardingDuplicateHit | null;
    /** Informational only — only ever set when `hit` is null (see below). */
    rejoinerHint: OnboardingRejoinerHint | null;
}

/**
 * Checks the given fields (in fixed ONBOARDING_IDENTITY_FIELDS order) for a
 * collision against either an active employee or an in-flight (non-
 * REJECTED) onboarding request. Returns the first hit, or null.
 *
 * - Inactive Users never block — re-hires are allowed to reuse their old
 *   identity numbers. If nothing blocks, a second pass looks for an
 *   inactive-User match on the same fields and surfaces it as a
 *   non-blocking `rejoinerHint` — short-circuited entirely (zero extra
 *   queries) whenever a real block already fired, since the hint would
 *   never be shown anyway.
 * - `fields` may be a partial set (PATCH only needs to check whatever the
 *   payload actually touched); any field absent from `fields` is skipped
 *   entirely, distinct from a field present but blank (which normalizes to
 *   null and is also skipped — blank never blocks/hints).
 * - `excludeRequestId` excludes that request from the "another onboarding
 *   request" check — pass the record's own id when re-checking a request
 *   against itself (PATCH, submit-for-approval, final approval); omit it
 *   for a brand-new request (POST, public submit), which can never
 *   self-collide since nothing has been stored yet at check time.
 * - `excludeUserId` is for re-checking an EXISTING employee against everyone
 *   else (Employee Master edit): that employee is skipped, and so is the
 *   onboarding request they were created from (it still carries their own
 *   identity numbers, so it would otherwise block them forever).
 */
export async function checkOnboardingDuplicates(
    db: PrismaOrTx,
    fields: Partial<Record<OnboardingIdentityField, string | null | undefined>>,
    excludeRequestId?: string,
    excludeUserId?: string
): Promise<OnboardingDuplicateCheckResult> {
    for (const field of ONBOARDING_IDENTITY_FIELDS) {
        if (!(field in fields)) continue;
        const raw = fields[field];
        const normalized = normalize(field, raw);
        if (!normalized) continue;

        const userHit = await db.user.findFirst({
            where: {
                [field]: normalized,
                isActive: true,
                ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
            } as Prisma.UserWhereInput,
            select: { employeeId: true, firstName: true, lastName: true },
        });
        if (userHit) {
            return {
                hit: {
                    field,
                    label: ONBOARDING_IDENTITY_FIELD_LABELS[field],
                    value: normalized,
                    source: 'employee',
                    holderName: `${userHit.firstName} ${userHit.lastName}`.trim(),
                    holderId: userHit.employeeId,
                },
                rejoinerHint: null,
            };
        }

        // OR on the raw (trimmed, un-normalized) value covers rows written
        // before this normalize-on-write change landed — new writes are
        // always normalized (see POST/PATCH/public-submit), so this
        // converges over time rather than needing a backfill.
        const requestHit = await db.employeeOnboardingRequest.findFirst({
            where: {
                OR: [{ [field]: normalized }, { [field]: raw!.trim() }],
                status: { not: 'REJECTED' },
                ...(excludeRequestId ? { id: { not: excludeRequestId } } : {}),
                // `not` alone would also drop rows where createdUserId IS NULL
                // (SQL three-valued logic) — i.e. every request not yet approved.
                ...(excludeUserId ? { AND: [{ OR: [{ createdUserId: null }, { createdUserId: { not: excludeUserId } }] }] } : {}),
            } as Prisma.EmployeeOnboardingRequestWhereInput,
            select: { employeeName: true, status: true },
        });
        if (requestHit) {
            return {
                hit: {
                    field,
                    label: ONBOARDING_IDENTITY_FIELD_LABELS[field],
                    value: normalized,
                    source: 'request',
                    holderName: requestHit.employeeName ?? undefined,
                    requestStatus: requestHit.status,
                },
                rejoinerHint: null,
            };
        }
    }

    // Nothing blocks — only now look for a possible rejoiner (first hit
    // wins, same fixed field order as the block-check above).
    for (const field of ONBOARDING_IDENTITY_FIELDS) {
        if (!(field in fields)) continue;
        const normalized = normalize(field, fields[field]);
        if (!normalized) continue;

        const inactiveHit = await db.user.findFirst({
            where: {
                [field]: normalized,
                isActive: false,
                ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
            } as Prisma.UserWhereInput,
            select: { employeeId: true, firstName: true, lastName: true, dateOfExit: true },
        });
        if (inactiveHit) {
            return {
                hit: null,
                rejoinerHint: {
                    field,
                    employeeId: inactiveHit.employeeId,
                    name: `${inactiveHit.firstName} ${inactiveHit.lastName}`.trim(),
                    dateOfExit: inactiveHit.dateOfExit,
                },
            };
        }
    }

    return { hit: null, rejoinerHint: null };
}

/** Internal-facing message — names the holder. Never use this for the
 * public (unauthenticated) submission route; use the generic message there
 * instead so an anonymous caller can't learn who holds a given number. */
export function formatInternalDuplicateMessage(hit: OnboardingDuplicateHit): string {
    if (hit.source === 'employee') {
        return `${hit.label} ${hit.value} is already registered to ${hit.holderName} (${hit.holderId ?? 'no employee ID'})`;
    }
    return `${hit.label} ${hit.value} is already used in another onboarding request (${hit.holderName ?? 'unnamed'}, ${hit.requestStatus})`;
}

/** Public-facing message — never names the holder (anonymous caller, no info leak). */
export function formatPublicDuplicateMessage(hit: OnboardingDuplicateHit): string {
    return `${hit.label} is already registered in our records. Please contact HR.`;
}

/** Normalizes every identity field present in `fields`, returning a new
 * object with the same keys — call before persisting (POST/PATCH/public
 * submit) so stored values converge to one comparable form over time. */
export function normalizeOnboardingIdentityFields<T extends Partial<Record<OnboardingIdentityField, string | null | undefined>>>(
    fields: T
): T {
    const result = { ...fields };
    for (const field of ONBOARDING_IDENTITY_FIELDS) {
        if (field in fields) {
            (result as Record<string, unknown>)[field] = normalize(field, fields[field]);
        }
    }
    return result;
}
