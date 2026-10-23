import type { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { extractUploanMemberId } from '@/app/lib/services/uploan-import.service';

/**
 * Client + CoApplicant creation, shared by BOTH legacy bulk-import flows: the ongoing-loan
 * "Member Upload" (uploan-import-row.service.ts) and "Closed Loan Member Upload"
 * (closed-member-import-row.service.ts). Extracted verbatim from the block that used to
 * live inline in importSingleUploanRow — kept byte-identical for the existing importer
 * (its own test coverage guards against drift) — with one behavior now parameterized:
 * whether a MATCHED_EXISTING client already holding an active DISBURSED loan blocks this
 * row. The ongoing-loan importer needs that block (a live active loan and a second backup
 * loan for the same client are mutually exclusive); the closed-loan importer does not (a
 * client can very much have an active loan AND a previously-closed one with unreturned
 * savings/gold still pending).
 */

/** The subset of a validated job row's fields this helper needs — both
 *  UploanJobRowData and ClosedMemberJobRowData satisfy this shape structurally. */
export interface LegacyMemberClientRowData {
    raw: Record<string, unknown>;
    resolved: {
        clientStatus: 'MATCHED_EXISTING' | 'NEW';
        clientId?: string;
    };
    memberStatus?: unknown;
    firstName?: unknown;
    lastName?: unknown;
    mobileNumber?: unknown;
    email?: unknown;
    otherIdNo?: unknown;
    pancardNo?: unknown;
    dateOfBirthResolved?: unknown;
    age?: unknown;
    gender?: unknown;
    caste?: unknown;
    country?: unknown;
    occupation?: unknown;
    spouseName?: unknown;
    spouseDobResolved?: unknown;
    permanentAddress?: unknown;
    address?: unknown;
    district?: unknown;
    state?: unknown;
    pincode?: unknown;
    latitude?: unknown;
    longitude?: unknown;
    bankAcNo?: unknown;
    ifscCode?: unknown;
    bankName?: unknown;
    bankBranch?: unknown;
    bankAccountType?: unknown;
    annualIncome?: unknown;
    nomineeName?: unknown;
    nomineeDateOfBirthResolved?: unknown;
    nomineeAge?: unknown;
    nomineeRelation?: unknown;
    nomineePhone?: unknown;
    nomineeVoterId?: unknown;
    nomineeAadhaar?: unknown;
}

export interface CreateOrMatchLegacyMemberClientResult {
    clientId: string;
    coApplicantId?: string;
}

export async function createOrMatchLegacyMemberClient(
    tx: Prisma.TransactionClient,
    row: LegacyMemberClientRowData,
    ids: { centerId: string; groupId: string },
    createdById: string,
    /** True (the ongoing-loan importer's behavior): a MATCHED_EXISTING client already
     *  holding an active DISBURSED loan throws instead of proceeding. False (the
     *  closed-loan importer's behavior): that client state is fine, proceed normally. */
    blockIfActiveLoan: boolean = true
): Promise<CreateOrMatchLegacyMemberClientResult> {
    const { centerId, groupId } = ids;

    if (row.resolved.clientStatus === 'MATCHED_EXISTING' && row.resolved.clientId) {
        const existing = await tx.client.findUnique({
            where: { id: row.resolved.clientId },
            select: { id: true, isActive: true },
        });
        if (!existing || !existing.isActive) {
            throw new Error('Matched existing client is inactive');
        }
        if (blockIfActiveLoan) {
            const existingActiveLoan = await tx.loan.findFirst({
                where: { clientId: existing.id, disbursementStatus: 'DISBURSED', isActive: true },
                select: { id: true, loanNumber: true },
            });
            if (existingActiveLoan) {
                throw new Error(
                    `Client already has an active loan (${existingActiveLoan.loanNumber}) — skipping backup import for this row`
                );
            }
        }

        await tx.groupMember.upsert({
            where: { groupId_clientId: { groupId, clientId: existing.id } },
            update: {},
            create: { groupId, clientId: existing.id, joinedAt: new Date() },
        });

        return { clientId: existing.id, coApplicantId: undefined };
    }

    const isActive = String(row.memberStatus || '').trim().toLowerCase() !== 'inactive';
    const created = await tx.client.create({
        data: {
            // The legacy MemberID, preserved verbatim — the caller's validate step already
            // confirmed it parses and doesn't collide with an existing client.
            clientId: extractUploanMemberId(row.raw),
            firstName: row.firstName as string,
            lastName: (row.lastName as string) || '',
            phone: (row.mobileNumber as string) || null,
            mobileNumber: (row.mobileNumber as string) || null,
            email: (row.email as string) || null,
            centerId,
            groupId,
            otherIdNo: (row.otherIdNo as string)?.replace(/\s/g, '') || null,
            pancardNo: (row.pancardNo as string) || null,
            dateOfBirth: row.dateOfBirthResolved ? new Date(row.dateOfBirthResolved as string) : null,
            age: row.age ? parseInt(row.age as string, 10) : null,
            gender: (row.gender as string) || null,
            caste: (row.caste as string) || null,
            country: (row.country as string) || 'India',
            occupation: (row.occupation as string) || null,
            spouseName: (row.spouseName as string) || null,
            spouseDob: row.spouseDobResolved ? new Date(row.spouseDobResolved as string) : null,
            permanentAddress: (row.permanentAddress as string) || (row.address as string) || null,
            district: (row.district as string) || null,
            state: (row.state as string) || null,
            pincode: (row.pincode as string) || null,
            latitude: row.latitude ? Number(row.latitude) : null,
            longitude: row.longitude ? Number(row.longitude) : null,
            bankAcNo: (row.bankAcNo as string) || null,
            ifscCode: (row.ifscCode as string) || null,
            bankName: (row.bankName as string) || null,
            bankBranch: (row.bankBranch as string) || null,
            bankAccountType: (row.bankAccountType as string) || null,
            monthlyFamilyIncome: row.annualIncome
                ? new Decimal((Number(row.annualIncome) / 12).toFixed(2))
                : null,
            nomineeName: (row.nomineeName as string) || null,
            nomineeDateOfBirth: row.nomineeDateOfBirthResolved ? new Date(row.nomineeDateOfBirthResolved as string) : null,
            nomineeAge: row.nomineeAge ? parseInt(row.nomineeAge as string, 10) : null,
            nomineeRelation: (row.nomineeRelation as string) || null,
            nomineePhone: (row.nomineePhone as string) || null,
            verificationStatus: 'VERIFIED',
            approvalStatus: 'APPROVED',
            locationApprovalStatus: 'APPROVED',
            enrolledById: createdById,
            verifiedById: createdById,
            verifiedAt: new Date(),
            bmReviewedById: createdById,
            bmReviewedAt: new Date(),
            amReviewedById: createdById,
            amReviewedAt: new Date(),
            finalReviewedById: createdById,
            finalReviewedAt: new Date(),
            isActive,
        },
        select: { id: true },
    });

    await tx.groupMember.create({ data: { groupId, clientId: created.id, joinedAt: new Date() } });

    let createdCoApplicantId: string | undefined;

    // Nominee -> CoApplicant: mirrors client-enrollment.service.ts's own co-applicant
    // block ("the nominee entered during enrollment IS the co-applicant"). Auto-approved
    // since it rides along with this row's own already-approved bulk import. No "Nominee
    // Gender" column exists in any legacy export, so gender defaults to 'Other'. Identity-
    // uniqueness checks are intentionally skipped here, same as the enrollment path.
    if ((row.nomineeName as string)?.trim()) {
        const createdCoApplicant = await tx.coApplicant.create({
            data: {
                clientId: created.id,
                isPrimary: true,
                status: 'ACTIVE',
                currentStage: null,
                bmDecision: 'APPROVED',
                amDecision: 'APPROVED',
                qcDecision: 'APPROVED',
                adminDecision: 'APPROVED',
                activatedAt: new Date(),
                createdById,
                name: (row.nomineeName as string).trim(),
                gender: 'Other',
                dateOfBirth: row.nomineeDateOfBirthResolved
                    ? new Date(row.nomineeDateOfBirthResolved as string)
                    : new Date(),
                age: row.nomineeAge ? parseInt(row.nomineeAge as string, 10) || 0 : 0,
                relationWithClient: (row.nomineeRelation as string) || 'Other',
                mobileNumber: (row.nomineePhone as string) || '',
                voterIdNo: (row.nomineeVoterId as string) || null,
                otherIdNo: (row.nomineeAadhaar as string) || null,
            },
            select: { id: true },
        });
        await tx.coApplicantHistory.create({
            data: {
                coApplicantId: createdCoApplicant.id,
                action: 'CREATED',
                performedById: createdById,
                remarks: 'Created during bulk legacy-member import — nominee treated as primary co-applicant, approved as part of the import',
            },
        });
        createdCoApplicantId = createdCoApplicant.id;
    }

    return { clientId: created.id, coApplicantId: createdCoApplicantId };
}
