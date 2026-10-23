// ============================================================
// PUBLIC HR ONBOARDING FORM API — no authentication
// app/api/public/hr-onboarding/[token]/route.ts
//
// The joinee-facing counterpart to app/apply/onboarding/[token]/page.tsx.
// Deliberately excluded from JWT validation (app/middleware.ts's
// PUBLIC_PREFIXES) — the opaque, single-use, expiring publicToken on
// EmployeeOnboardingRequest is the access control here, checked fresh on
// every request rather than trusted from a session. Uses the bare
// errorResponse/successResponse/handleCorsPreflight helpers with no
// withAuth/requirePermission wrapper, the same pattern already used by
// app/api/mobile/otp/send/route.ts for its own unauthenticated route.
// ============================================================

import { NextRequest } from 'next/server';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse } from '@/app/lib/api-utils';
import {
    onboardingFormFieldsSchema, childrenJsonInput, validateOnboardingServerRules, FIELD_PATTERNS, FIELD_ERROR_MESSAGES,
    CONFIGURABLE_ONBOARDING_FIELD_KEYS, CHILD_FIELD_CONFIG_KEYS, getOnboardingSkipKeys, buildChildRequiredChecks,
} from '@/app/lib/hr/onboarding-form-fields';
import { checkOnboardingDuplicates, formatPublicDuplicateMessage, normalizeOnboardingIdentityFields } from '@/app/lib/hr/onboarding-duplicate-check';
import { rateLimiter, getClientIp } from '@/app/lib/rate-limit';
import { loadValidDraft } from '@/app/lib/hr/onboarding-token';
import { hrOnboardingValidationService } from '@/app/lib/services/hr-onboarding-validation.service';

export async function OPTIONS() {
    return handleCorsPreflight();
}

// Generous enough for a real joinee re-checking/retrying a link by hand, tight
// enough to blunt a scripted flood against the one endpoint in this app that
// needs no session to hit.
const GET_LIMIT = { count: 100, windowMs: 60_000 };
const POST_LIMIT = { count: 30, windowMs: 60_000 };

// GET /api/public/hr-onboarding/[token] — validate the link and return only
// the non-sensitive reference data the form's dropdowns need. Deliberately
// omits any employee list (e.g. reporting managers) — a public, unauthenticated
// visitor gets no visibility into who works here, only where/what.
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
    try {
        const { token } = await params;
        const ip = getClientIp(request);
        if (!(await rateLimiter.check(`hr-onboarding:get:${token}:${ip}`, GET_LIMIT.count, GET_LIMIT.windowMs))) {
            return errorResponse('Too many requests. Please wait a moment and try again.', 429);
        }
        const result = await loadValidDraft(token);
        if (!result.ok) return errorResponse(result.error, 410);

        const [branches, departments, designations, documents, allFieldConfig] = await Promise.all([
            prisma.branch.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
            prisma.department.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
            prisma.designation.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
            // No fileUrl here — this page has no signed-url access (unauthenticated).
            // Just enough so a joinee reloading mid-fill doesn't lose track of
            // what they've already attached.
            prisma.onboardingDocument.findMany({
                where: { onboardingRequestId: result.request.id },
                select: { id: true, category: true, subtype: true, fileName: true, uploaderType: true, status: true },
                orderBy: { uploadedAt: 'desc' },
            }),
            // Which of these fields the admin currently marks Required (Onboarding
            // Field Validation) — same required-toggle Manual Entry's form already
            // shows via an authenticated fetch. Not sensitive (labels/booleans
            // only), so it's safe to expose to this unauthenticated page too; without
            // it the joinee form could show no asterisks at all for anything beyond
            // the hard-required identity basics, and submission wouldn't enforce
            // whatever else the admin requires.
            hrOnboardingValidationService.getConfig(),
        ]);
        const publicFieldKeys: readonly string[] = [...CONFIGURABLE_ONBOARDING_FIELD_KEYS, ...Object.values(CHILD_FIELD_CONFIG_KEYS)];
        const fieldConfig = allFieldConfig.filter((c) => publicFieldKeys.includes(c.fieldKey));

        return successResponse({ branches, departments, designations, documents, fieldConfig }, 'Link is valid');
    } catch (error: unknown) {
        console.error('Error validating onboarding link:', error);
        const message = error instanceof Error ? error.message : 'Failed to validate link';
        return errorResponse(message, 500);
    }
}

// The base shape is all-optional; the joinee's own self-submission requires
// a stricter subset (personal identity basics) than an HR-side edit does.
// branchId/designationId/departmentId/dateOfJoining are deliberately NOT
// overridden here — branch is admin-preset before the link ever exists (see
// POST /api/hr/onboarding's 'LINK' variant), and designation/department/
// dateOfJoining are now collected by the admin at final approval instead.
// Leaving them at the base schema's optional(...) means an omitted/blank
// value in the joinee's POST body becomes `undefined`, which Prisma's
// update() treats as "leave unchanged" — so the admin-preset branchId is
// never clobbered by this submission.
const submitSchema = onboardingFormFieldsSchema.extend({
    employeeName: z.string().min(1, 'Name is required'),
    mobileNumber: z.string().regex(FIELD_PATTERNS.MOBILE, FIELD_ERROR_MESSAGES.MOBILE),
    email: z.string().email(FIELD_ERROR_MESSAGES.EMAIL).optional().nullable().or(z.literal('')),
    dateOfBirth: z.coerce.date(),
    gender: z.string().min(1, 'Gender is required'),
}).superRefine(validateOnboardingServerRules);

// POST /api/public/hr-onboarding/[token] — the joinee's one-time submission.
// Re-validates the token server-side (never trusts a prior GET) and marks it
// used in the same write, so the same link can never be submitted twice.
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
    try {
        const { token } = await params;
        const ip = getClientIp(request);
        if (!(await rateLimiter.check(`hr-onboarding:post:${token}:${ip}`, POST_LIMIT.count, POST_LIMIT.windowMs))) {
            return errorResponse('Too many requests. Please wait a moment and try again.', 429);
        }
        const result = await loadValidDraft(token);
        if (!result.ok) return errorResponse(result.error, 410);

        const body = await request.json();
        const data = submitSchema.parse(body);

        // Whatever the admin marks Required in Onboarding Field Validation must
        // block the joinee's own submission too, not just Manual Entry's later
        // "Submit for Approval" — otherwise a request could sail through here
        // missing a field HR requires, then get stuck with no way to fix it once
        // HR reviews it (this route is the joinee's only chance to enter it).
        const skipKeys = getOnboardingSkipKeys(data.maritalStatus, data.gender);
        const fieldsToCheck = CONFIGURABLE_ONBOARDING_FIELD_KEYS
            .filter((key) => !skipKeys.includes(key))
            .map((key) => ({ configKey: key, value: (data as Record<string, unknown>)[key] }) as { configKey: string; value: unknown; label?: string })
            .concat(buildChildRequiredChecks(data.children, data.maritalStatus));
        const validation = await hrOnboardingValidationService.assertRequiredFieldsPresent(fieldsToCheck);
        if (!validation.ok) {
            return errorResponse(`Please fill in: ${validation.missing.join(', ')}`, 400);
        }

        // No excludeRequestId: a DRAFT link row carries null identity fields
        // until this exact submission, so it can never match itself — the
        // check runs against submitted values vs. what's already stored
        // elsewhere, before this write ever happens. Generic message only —
        // never name the holder to an anonymous, unauthenticated caller.
        // rejoinerHint is intentionally discarded here — an anonymous joinee
        // must never learn that they've been matched against an ex-employee's
        // identity. This route is the one place that hint is deliberately
        // thrown away rather than wired into the response.
        const { hit: duplicateHit } = await checkOnboardingDuplicates(prisma, data);
        if (duplicateHit) {
            return errorResponse(formatPublicDuplicateMessage(duplicateHit), 409);
        }

        await prisma.employeeOnboardingRequest.update({
            where: { id: result.request.id },
            data: {
                ...data,
                ...normalizeOnboardingIdentityFields(data),
                children: childrenJsonInput(data.children),
                email: data.email || null,
                status: 'SUBMITTED',
                tokenUsedAt: new Date(),
            } satisfies Prisma.EmployeeOnboardingRequestUncheckedUpdateInput,
        });

        return successResponse(null, 'Your details have been submitted to HR for review.');
    } catch (error: unknown) {
        if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
        console.error('Error submitting onboarding form:', error);
        const message = error instanceof Error ? error.message : 'Failed to submit';
        return errorResponse(message, 500);
    }
}
