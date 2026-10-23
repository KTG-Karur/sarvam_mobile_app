import type { Prisma } from '@prisma/client';
import { prisma } from '@/app/lib/prisma';

/**
 * Aadhaar + member mobile + co-applicant mobile for member-level reports.
 *
 * - Aadhaar is `Client.otherIdNo` (the enrollment "Aadhaar No" field — same source
 *   every existing report already used).
 * - Co-applicant mobile prefers the co-applicant captured on the loan itself
 *   (`LoanCoApplicantSnapshot`), falling back to the member's current primary
 *   ACTIVE/APPROVED co-applicant (newest first) for member rows with no loan.
 *
 * One batched query per table — call once per report with every row's ids.
 */
export type MemberContact = {
    aadhaarNumber: string;
    mobileNumber: string;
    coApplicantMobile: string;
};

export const EMPTY_MEMBER_CONTACT: MemberContact = { aadhaarNumber: '', mobileNumber: '', coApplicantMobile: '' };

/**
 * Prisma `select` fragment for a Client relation — spread into an existing
 * `client: { select: { ... } }` so a query can map contacts synchronously via
 * `memberContactFromClient` instead of a second `getMemberContacts` round trip.
 */
export const memberContactClientSelect = {
    otherIdNo: true,
    mobileNumber: true,
    coApplicants: {
        where: { status: { in: ['ACTIVE', 'APPROVED'] } },
        select: { mobileNumber: true },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
        take: 1,
    },
} satisfies Prisma.ClientSelect;

type ClientWithContactSelect = {
    otherIdNo?: string | null;
    mobileNumber?: string | null;
    coApplicants?: { mobileNumber: string | null }[];
};

/** Maps a client loaded with `memberContactClientSelect` (plus an optional loan-level co-applicant mobile). */
export function memberContactFromClient(
    client: ClientWithContactSelect | null | undefined,
    loanCoApplicantMobile?: string | null
): MemberContact {
    return {
        aadhaarNumber: client?.otherIdNo?.replace(/\s+/g, '') ?? '',
        mobileNumber: client?.mobileNumber ?? '',
        coApplicantMobile: loanCoApplicantMobile || client?.coApplicants?.[0]?.mobileNumber || '',
    };
}

/**
 * Client-level OR conditions matching Aadhaar, member mobile/phone or co-applicant
 * mobile — spread into any member search's existing `OR` list. These are stored as
 * plain digits, so only the digits of the term are compared ("9455 3062 7246" still
 * hits). Empty for a term with fewer than 3 digits (plain name searches).
 */
export function memberIdSearchConditions(term: string | null | undefined): Prisma.ClientWhereInput[] {
    const digits = term?.replace(/\D/g, '') ?? '';
    if (digits.length < 3) return [];
    return [
        { otherIdNo: { contains: digits } },
        { mobileNumber: { contains: digits } },
        { phone: { contains: digits } },
        { coApplicants: { some: { mobileNumber: { contains: digits } } } },
    ];
}

/** `memberIdSearchConditions` for a Loan query — via its client, plus the loan's own co-applicant snapshot. */
export function loanMemberIdSearchConditions(term: string | null | undefined): Prisma.LoanWhereInput[] {
    const clientConditions = memberIdSearchConditions(term);
    if (clientConditions.length === 0) return [];
    const digits = term!.replace(/\D/g, '');
    return [
        ...clientConditions.map((client) => ({ client })),
        { coApplicantSnapshot: { mobileNumber: { contains: digits } } },
    ];
}

/**
 * Server-side search for paginated member reports: matches member name, member ID,
 * Aadhaar, member mobile or co-applicant mobile. Returns undefined for a blank term.
 */
export function buildMemberSearchWhere(term: string | null | undefined): Prisma.ClientWhereInput | undefined {
    const q = term?.trim();
    if (!q) return undefined;
    return {
        OR: [
            { firstName: { contains: q, mode: 'insensitive' } },
            { lastName: { contains: q, mode: 'insensitive' } },
            { clientId: { contains: q, mode: 'insensitive' } },
            ...memberIdSearchConditions(q),
        ],
    };
}

export type MemberContactLookup = (clientId: string | null | undefined, loanId?: string | null) => MemberContact;

export async function getMemberContacts(opts: {
    clientIds: Iterable<string | null | undefined>;
    loanIds?: Iterable<string | null | undefined>;
}): Promise<MemberContactLookup> {
    const clientIds = [...new Set([...opts.clientIds].filter((id): id is string => !!id))];
    const loanIds = [...new Set([...(opts.loanIds ?? [])].filter((id): id is string => !!id))];
    if (clientIds.length === 0 && loanIds.length === 0) return () => EMPTY_MEMBER_CONTACT;

    const [clients, coApplicants, snapshots] = await Promise.all([
        clientIds.length
            ? prisma.client.findMany({
                where: { id: { in: clientIds } },
                select: { id: true, otherIdNo: true, mobileNumber: true },
            })
            : [],
        clientIds.length
            ? prisma.coApplicant.findMany({
                where: { clientId: { in: clientIds }, status: { in: ['ACTIVE', 'APPROVED'] } },
                select: { clientId: true, mobileNumber: true, isPrimary: true },
                orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
            })
            : [],
        loanIds.length
            ? prisma.loanCoApplicantSnapshot.findMany({
                where: { loanId: { in: loanIds } },
                select: { loanId: true, mobileNumber: true },
            })
            : [],
    ]);

    const clientById = new Map(clients.map((c) => [c.id, c]));
    const coByClient = new Map<string, string>();
    for (const co of coApplicants) {
        // Ordered primary-first, newest-first — keep the first one seen.
        if (!coByClient.has(co.clientId) && co.mobileNumber) coByClient.set(co.clientId, co.mobileNumber);
    }
    const coByLoan = new Map(snapshots.map((s) => [s.loanId, s.mobileNumber]));

    return (clientId, loanId) => {
        const c = clientId ? clientById.get(clientId) : undefined;
        return {
            aadhaarNumber: c?.otherIdNo?.replace(/\s+/g, '') ?? '',
            mobileNumber: c?.mobileNumber ?? '',
            coApplicantMobile: (loanId ? coByLoan.get(loanId) : undefined) ?? (clientId ? coByClient.get(clientId) : undefined) ?? '',
        };
    };
}
