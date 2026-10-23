import { prisma } from '@/app/lib/prisma';
import type { Prisma } from '@prisma/client';
import { type IdentityField, IDENTITY_FIELD_LABELS, normalizeIdentityValue } from '@/app/lib/identity-normalization';

/**
 * Identity/contact fields that must be globally unique across Client and
 * CoApplicant records (see plan: unique-proof-validation).
 *
 * Pure normalization/comparison helpers live in app/lib/identity-normalization.ts
 * (no server-only imports, safe for client components) and are re-exported here
 * for existing server-side call sites.
 */
export * from '@/app/lib/identity-normalization';

export interface UniquenessMatch {
    source: 'CLIENT' | 'CO_APPLICANT';
    familyClientId: string; // Client.id (cuid) that owns the match
    displayClientId: string; // Client.clientId, human-readable
    enrolledById?: string | null;
    verificationStatus?: string | null;
    createdAt?: Date | null;
}

export interface UniquenessCheckResult {
    isDuplicate: boolean;
    normalizedValue: string;
    match?: UniquenessMatch;
    message: string;
}

/**
 * Checks a single identity field for global uniqueness across the Client
 * table (its own column plus, for co-applicant-type fields, the legacy
 * `ca*` mirror columns) and the CoApplicant table.
 *
 * `excludeFamilyClientId` must always be a Client.id (cuid) — never a
 * CoApplicant.id. Excluding by family (not by individual record id) is what
 * lets a co-applicant's own value, mirrored onto its parent Client.ca* column,
 * be edited without colliding with itself.
 */
export async function checkIdentityUniqueness(
    field: IdentityField,
    rawValue?: string | null,
    opts: { excludeFamilyClientId?: string; includeDrafts?: boolean } = {}
): Promise<UniquenessCheckResult> {
    const normalizedValue = normalizeIdentityValue(field, rawValue);
    const message = `${IDENTITY_FIELD_LABELS[field]} already exists.`;

    if (!normalizedValue) {
        return { isDuplicate: false, normalizedValue, message };
    }

    const { excludeFamilyClientId, includeDrafts = false } = opts;

    const clientWhere: Prisma.ClientWhereInput = {
        ...(includeDrafts ? {} : { approvalStatus: { not: 'DRAFT' } }),
        ...(excludeFamilyClientId ? { id: { not: excludeFamilyClientId } } : {}),
    };

    switch (field) {
        case 'MOBILE':
            clientWhere.mobileNumber = normalizedValue;
            break;
        case 'AADHAAR':
            clientWhere.OR = [{ otherIdNo: normalizedValue }, { caOtherIdNo: normalizedValue }];
            break;
        case 'PAN':
            clientWhere.OR = [{ pancardNo: normalizedValue }, { caPancardNo: normalizedValue }];
            break;
        case 'VOTER_ID':
            clientWhere.OR = [{ votersIdNo: normalizedValue }, { caVoterIdNo: normalizedValue }];
            break;
        case 'BANK_ACCOUNT':
            clientWhere.bankAcNo = normalizedValue;
            break;
    }

    const clientMatchPromise = prisma.client.findFirst({
        where: clientWhere,
        select: { id: true, clientId: true, enrolledById: true, verificationStatus: true, createdAt: true },
    });

    const coApplicantWhere: Prisma.CoApplicantWhereInput = {
        ...(excludeFamilyClientId ? { clientId: { not: excludeFamilyClientId } } : {}),
        ...(includeDrafts ? {} : { client: { approvalStatus: { not: 'DRAFT' } } }),
    };
    switch (field) {
        case 'MOBILE':
            coApplicantWhere.mobileNumber = normalizedValue;
            break;
        case 'AADHAAR':
            coApplicantWhere.otherIdNo = normalizedValue;
            break;
        case 'PAN':
            coApplicantWhere.pancardNo = normalizedValue;
            break;
        case 'VOTER_ID':
            coApplicantWhere.voterIdNo = normalizedValue;
            break;
    }

    const coApplicantMatchPromise =
        field === 'BANK_ACCOUNT'
            ? Promise.resolve(null)
            : prisma.coApplicant.findFirst({
                  where: coApplicantWhere,
                  select: {
                      clientId: true,
                      client: { select: { id: true, clientId: true, approvalStatus: true } },
                  },
              });

    const [clientMatch, coApplicantMatch] = await Promise.all([
        clientMatchPromise,
        coApplicantMatchPromise,
    ]);

    if (clientMatch) {
        return {
            isDuplicate: true,
            normalizedValue,
            message,
            match: {
                source: 'CLIENT',
                familyClientId: clientMatch.id,
                displayClientId: clientMatch.clientId,
                enrolledById: clientMatch.enrolledById,
                verificationStatus: clientMatch.verificationStatus,
                createdAt: clientMatch.createdAt,
            },
        };
    }

    if (coApplicantMatch) {
        return {
            isDuplicate: true,
            normalizedValue,
            message,
            match: {
                source: 'CO_APPLICANT',
                familyClientId: coApplicantMatch.client.id,
                displayClientId: coApplicantMatch.client.clientId,
            },
        };
    }

    return { isDuplicate: false, normalizedValue, message };
}
