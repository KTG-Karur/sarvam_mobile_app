import { NextRequest } from 'next/server';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse } from '@/app/lib/api-utils';
import { requirePermission, isUserContext } from '@/app/lib/permissions/guards';
import { onboardingFormFieldsSchema, childrenJsonInput, validateOnboardingServerRules } from '@/app/lib/hr/onboarding-form-fields';
import { withLiveEmployeeData } from '@/app/lib/hr/onboarding-live-employee';
import { validateOnboardingOrgPlacement } from '@/app/lib/hr/onboarding-org-placement';
import { checkOnboardingDuplicates, formatInternalDuplicateMessage, normalizeOnboardingIdentityFields } from '@/app/lib/hr/onboarding-duplicate-check';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const DEFAULT_TOKEN_EXPIRY_DAYS = 7;

const createSchema = z.discriminatedUnion('source', [
    z.object({
        source: z.literal('LINK'),
        tokenExpiryDays: z.number().int().min(0).max(30).optional(),
        tokenExpiryHours: z.number().int().min(1).max(720).optional(),
        regionId: z.string().min(1).optional(),
        divisionId: z.string().min(1).optional(),
        shiftId: z.string().min(1).optional(),
    }),
    // `finalize` distinguishes an explicit "Create Request" from a Save
    // Draft / incidental autosave (e.g. opening the Documents tab needs a
    // real id to attach uploads to) — without it every such autosave would
    // otherwise land in the review queue mislabeled SUBMITTED.
    onboardingFormFieldsSchema.extend({ source: z.literal('MANUAL'), finalize: z.boolean().optional() }),
]).refine(
    (data) => {
        if (data.source === 'LINK') {
            if (data.tokenExpiryHours !== undefined) {
                return data.tokenExpiryHours >= 1 && data.tokenExpiryHours <= 720;
            }
            if (data.tokenExpiryDays !== undefined) {
                return data.tokenExpiryDays >= 1 && data.tokenExpiryDays <= 30;
            }
        }
        return true;
    },
    { message: 'Token expiry must be at least 1 hour and at most 30 days (720 hours)' }
).superRefine((data, ctx) => {
    if (data.source === 'MANUAL') {
        validateOnboardingServerRules(data, ctx);
    }
});

// GET /api/hr/onboarding — review queue, optionally filtered by ?status=
export async function GET(request: NextRequest) {
    const ctx = await requirePermission(request, 'hr-onboarding', 'view');
    if (!isUserContext(ctx)) return ctx;

    try {
        const { searchParams } = new URL(request.url);
        const status = searchParams.get('status');
        const permittedBranchIds = ctx.isHeadOffice ? null : ctx.branchAccess.map((ba) => ba.branchId);

        const requests = await prisma.employeeOnboardingRequest.findMany({
            where: {
                ...(status ? { status } : {}),
                // Branch is unset (null) from creation (LINK or MANUAL) until the
                // admin picks it at Submit for Approval time — keep those visible to
                // every branch-scoped viewer so someone can actually pick it up and
                // submit it, rather than hiding a request that doesn't belong to any
                // branch yet.
                ...(permittedBranchIds ? { OR: [{ branchId: { in: permittedBranchIds } }, { branchId: null }] } : {}),
            },
            include: {
                branch: { select: { name: true } },
                region: { select: { name: true } },
                division: { select: { name: true } },
                shift: { select: { name: true } },
                designation: { select: { name: true } },
                department: { select: { name: true } },
                createdBy: { select: { firstName: true, lastName: true } },
                createdUser: { select: { id: true, employeeId: true } },
            },
            orderBy: { createdAt: 'desc' },
        });

        return successResponse(await withLiveEmployeeData(requests), 'Onboarding requests fetched successfully');
    } catch (error: unknown) {
        console.error('Error fetching onboarding requests:', error);
        const message = error instanceof Error ? error.message : 'Failed to fetch onboarding requests';
        return errorResponse(message, 500);
    }
}

// POST /api/hr/onboarding — generate a shareable link, or enter details manually.
// Both converge on the same review → approval → provisioning pipeline.
export async function POST(request: NextRequest) {
    const ctx = await requirePermission(request, 'hr-onboarding', 'create');
    if (!isUserContext(ctx)) return ctx;

    try {
        const body = await request.json();
        const data = createSchema.parse(body);

        const placementError = await validateOnboardingOrgPlacement(data);
        if (placementError) return errorResponse(placementError, 400);

        if (data.source === 'LINK') {
            const now = new Date();
            const hours =
                data.tokenExpiryHours ??
                (data.tokenExpiryDays !== undefined ? data.tokenExpiryDays * 24 : DEFAULT_TOKEN_EXPIRY_DAYS * 24);

            const publicToken = randomBytes(32).toString('hex');
            const tokenExpiresAt = new Date(now.getTime() + hours * 3600_000);

            const created = await prisma.employeeOnboardingRequest.create({
                data: {
                    source: 'LINK', status: 'DRAFT', publicToken, tokenExpiresAt, createdByUserId: ctx.userId,
                    regionId: data.regionId ?? null, divisionId: data.divisionId ?? null, shiftId: data.shiftId ?? null,
                },
            });

            const appUrl = process.env.NEXT_PUBLIC_APP_URL || '';
            return successResponse(
                { request: created, publicUrl: `${appUrl}/apply/onboarding/${publicToken}` },
                'Onboarding link generated',
                201
            );
        }

        const { source, finalize, ...fields } = data;
        void source;

        const { hit: duplicateHit, rejoinerHint } = await checkOnboardingDuplicates(prisma, fields);
        if (duplicateHit) {
            return errorResponse(formatInternalDuplicateMessage(duplicateHit), 409);
        }

        const created = await prisma.employeeOnboardingRequest.create({
            data: {
                source: 'MANUAL',
                status: finalize ? 'SUBMITTED' : 'DRAFT',
                createdByUserId: ctx.userId,
                ...fields,
                ...normalizeOnboardingIdentityFields(fields),
                children: childrenJsonInput(fields.children),
            },
        });

        return successResponse(
            { ...created, rejoinerHint },
            finalize ? 'Onboarding request created' : 'Draft saved',
            201
        );
    } catch (error: unknown) {
        if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
        console.error('Error creating onboarding request:', error);
        const message = error instanceof Error ? error.message : 'Failed to create onboarding request';
        return errorResponse(message, 500);
    }
}
