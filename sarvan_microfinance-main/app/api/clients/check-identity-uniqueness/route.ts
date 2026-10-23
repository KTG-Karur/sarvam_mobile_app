import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/prisma';
import { withAuth, errorResponse, successResponse, handleCorsPreflight } from '@/app/lib/api-utils';
import {
    checkIdentityUniqueness,
    valuesMatchAfterNormalization,
    IDENTITY_FIELD_LABELS,
    type IdentityField,
} from '@/app/lib/services/identity-uniqueness.service';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const checkSchema = z.object({
    field: z.enum(['MOBILE', 'AADHAAR', 'PAN', 'VOTER_ID', 'BANK_ACCOUNT']),
    value: z.string().min(1),
    side: z.enum(['CLIENT', 'COAPPLICANT']),
    // Client.id (cuid) of the family this value belongs to — present on client-update /
    // co-applicant-update, absent on brand-new enrollment.
    familyClientId: z.string().optional(),
    // Enrollment forms have both sides in local state already — pass the sibling's
    // current value directly instead of triggering a DB fetch.
    siblingValue: z.string().optional(),
});

type SiblingField = Exclude<IdentityField, 'BANK_ACCOUNT'>;

// A client may have several co-applicants over time — sibling-uniqueness
// checks compare against the Primary one (first-ever created).
async function fetchCoApplicantSiblingValue(field: SiblingField, familyClientId: string): Promise<string | null | undefined> {
    switch (field) {
        case 'MOBILE':
            return (await prisma.coApplicant.findFirst({ where: { clientId: familyClientId, isPrimary: true }, select: { mobileNumber: true } }))?.mobileNumber;
        case 'AADHAAR':
            return (await prisma.coApplicant.findFirst({ where: { clientId: familyClientId, isPrimary: true }, select: { otherIdNo: true } }))?.otherIdNo;
        case 'PAN':
            return (await prisma.coApplicant.findFirst({ where: { clientId: familyClientId, isPrimary: true }, select: { pancardNo: true } }))?.pancardNo;
        case 'VOTER_ID':
            return (await prisma.coApplicant.findFirst({ where: { clientId: familyClientId, isPrimary: true }, select: { voterIdNo: true } }))?.voterIdNo;
    }
}

async function fetchClientSiblingValue(field: SiblingField, familyClientId: string): Promise<string | null | undefined> {
    switch (field) {
        case 'MOBILE':
            return (await prisma.client.findUnique({ where: { id: familyClientId }, select: { mobileNumber: true } }))?.mobileNumber;
        case 'AADHAAR':
            return (await prisma.client.findUnique({ where: { id: familyClientId }, select: { otherIdNo: true } }))?.otherIdNo;
        case 'PAN':
            return (await prisma.client.findUnique({ where: { id: familyClientId }, select: { pancardNo: true } }))?.pancardNo;
        case 'VOTER_ID':
            return (await prisma.client.findUnique({ where: { id: familyClientId }, select: { votersIdNo: true } }))?.votersIdNo;
    }
}

export async function POST(request: NextRequest) {
    return withAuth(async (req) => {
        try {
            const body = await req.json();
            const parsed = checkSchema.safeParse(body);
            if (!parsed.success) {
                return errorResponse(parsed.error.errors[0]?.message || 'Invalid request', 400);
            }
            const { field, value, side, familyClientId, siblingValue } = parsed.data;

            // 1. Same-family sibling compare first (cheap, and avoids a global query
            //    when it already fails). Bank Account has no co-applicant equivalent.
            let effectiveSiblingValue = siblingValue;
            if (field !== 'BANK_ACCOUNT' && familyClientId && effectiveSiblingValue === undefined) {
                effectiveSiblingValue =
                    (side === 'CLIENT'
                        ? await fetchCoApplicantSiblingValue(field, familyClientId)
                        : await fetchClientSiblingValue(field, familyClientId)) ?? undefined;
            }

            if (effectiveSiblingValue && valuesMatchAfterNormalization(field, value, effectiveSiblingValue)) {
                return successResponse({
                    isDuplicate: true,
                    conflictScope: 'FAMILY_SIBLING',
                    message: `Client and Co-Applicant cannot use the same ${IDENTITY_FIELD_LABELS[field]}.`,
                });
            }

            // 2. Global uniqueness check, family excluded
            const result = await checkIdentityUniqueness(field, value, { excludeFamilyClientId: familyClientId });
            return successResponse({
                isDuplicate: result.isDuplicate,
                conflictScope: result.isDuplicate ? 'UNRELATED' : null,
                message: result.isDuplicate ? result.message : null,
            });
        } catch (error) {
            console.error('Error checking identity uniqueness:', error);
            return errorResponse(error instanceof Error ? error.message : 'Failed to check uniqueness', 500);
        }
    })(request);
}
