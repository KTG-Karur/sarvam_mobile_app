// ============================================================
// PUBLIC ONBOARDING TOKEN VALIDATION — shared by every unauthenticated
// app/api/public/hr-onboarding/[token]/* route.
//
// Extracted out of app/api/public/hr-onboarding/[token]/route.ts (where this
// started as a private, unexported function) so the new
// app/api/public/hr-onboarding/[token]/documents/* routes can reuse the exact
// same token/status/expiry checks — a route.ts file's non-HTTP-method exports
// aren't meant to be imported by other route.ts files.
// ============================================================

import type { EmployeeOnboardingRequest } from '@prisma/client';
import { prisma } from '@/app/lib/db';

export type DraftLookupResult =
    | { ok: false; error: string }
    | { ok: true; request: EmployeeOnboardingRequest };

/**
 * A valid, still-editable draft: token exists, not yet used, status is still
 * DRAFT, and (if set) not expired. This same check is what makes document
 * upload/delete naturally impossible once the joinee has submitted — no
 * separate status check is needed in the document routes.
 */
export async function loadValidDraft(token: string): Promise<DraftLookupResult> {
    const request = await prisma.employeeOnboardingRequest.findUnique({ where: { publicToken: token } });
    if (!request) return { ok: false, error: 'This link is not valid.' };
    if (request.tokenUsedAt || request.status !== 'DRAFT') return { ok: false, error: 'This link has already been used.' };
    if (request.tokenExpiresAt && request.tokenExpiresAt < new Date()) return { ok: false, error: 'This link has expired. Please ask HR to send a new one.' };
    return { ok: true, request };
}
