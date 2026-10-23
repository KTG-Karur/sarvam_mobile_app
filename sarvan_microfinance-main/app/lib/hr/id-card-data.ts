// ============================================================
// EMPLOYEE ID CARD DATA — single source for every ID card render
// app/lib/hr/id-card-data.ts
//
// Used by GET /api/hr/employees/me/id-card (the employee's own card, mobile)
// and GET /api/hr/employees/[id]/id-card (HR printing someone's card, web), so
// the printed card, the mobile card and the QR verification page
// (/api/public/verify-employee) all read the same live `User` row.
//
// The User row is the only source. Onboarding provisioning copies every card
// field onto it, and after approval the onboarding request is locked — edits
// happen in Employee Master (PATCH /api/hr/employees/[id]) on the User row. An
// earlier per-field fallback to the onboarding request made a field HR had
// deliberately cleared reappear with its stale onboarding value; employees
// provisioned before the copy existed are covered by
// scripts/backfill-employee-id-card-fields.ts instead.
//
// Every result carries its eligibility (app/lib/hr/id-card-eligibility.ts);
// the routes return card data only when it is eligible. The batch variant also
// reports whether an already-printed card is out of date (id-card-reprint.ts).
// ============================================================

import { prisma } from '@/app/lib/prisma';
import { resolveEmployeePhotoKeys } from '@/app/lib/hr/employee-photo';
import { resolveDisplayBranches, DISPLAY_BRANCH_USER_SELECT, type DisplayBranch } from '@/app/lib/hr/employee-display-branch';
import { evaluateIdCardEligibility, PLACEHOLDER_ORG_CODE, type IdCardEligibility } from '@/app/lib/hr/id-card-eligibility';
import { computeIdCardFingerprint } from '@/app/lib/hr/id-card-reprint';

export interface EmployeeIdCardPayload {
    employeeId: string | null;
    fullName: string;
    designation: string | null;
    department: string | null;
    branchName: string | null;
    branchCode: string | null;
    dateOfJoining: Date | null;
    dateOfBirth: Date | null;
    bloodGroup: string | null;
    address: string | null;
    mobileNumber: string | null;
    emergencyContactName: string | null;
    emergencyContactRelation: string | null;
    emergencyContactMobile: string | null;
    /** Storage key (private bucket) — resolve via /api/storage/proxy or signed-url before display. */
    photoKey: string | null;
}

const CARD_USER_SELECT = {
    id: true,
    employeeId: true,
    firstName: true,
    lastName: true,
    isActive: true,
    dateOfExit: true,
    dateOfJoining: true,
    dob: true,
    bloodGroup: true,
    address: true,
    mobileNumber: true,
    emergencyContactName: true,
    emergencyContactRelation: true,
    emergencyContactMobile: true,
    profilePhotoUrl: true,
    idCardIssuedAt: true,
    idCardFingerprint: true,
    ...DISPLAY_BRANCH_USER_SELECT,
    designation: { select: { name: true, code: true } },
    department: { select: { name: true } },
} as const;

type CardUser = NonNullable<Awaited<ReturnType<typeof findCardUsers>>>[number];

function findCardUsers(userIds: string[]) {
    return prisma.user.findMany({ where: { id: { in: userIds } }, select: CARD_USER_SELECT });
}

function buildCard(
    employee: CardUser,
    photoKey: string | null,
    branch: DisplayBranch | null
): { card: EmployeeIdCardPayload; eligibility: IdCardEligibility } {
    const card: EmployeeIdCardPayload = {
        employeeId: employee.employeeId,
        fullName: `${employee.firstName ?? ''} ${employee.lastName ?? ''}`.trim(),
        designation: employee.designation?.name ?? null,
        department: employee.department?.name ?? null,
        branchName: branch?.name ?? null,
        branchCode: branch?.code ?? null,
        dateOfJoining: employee.dateOfJoining,
        dateOfBirth: employee.dob,
        bloodGroup: employee.bloodGroup,
        address: employee.address,
        mobileNumber: employee.mobileNumber,
        emergencyContactName: employee.emergencyContactName,
        emergencyContactRelation: employee.emergencyContactRelation,
        emergencyContactMobile: employee.emergencyContactMobile,
        photoKey,
    };

    const eligibility = evaluateIdCardEligibility({
        isActive: employee.isActive,
        dateOfExit: employee.dateOfExit,
        employeeId: card.employeeId,
        fullName: card.fullName,
        designation: card.designation,
        designationIsPlaceholder: employee.designation?.code === PLACEHOLDER_ORG_CODE,
        branchName: card.branchName,
        dateOfJoining: card.dateOfJoining,
        bloodGroup: card.bloodGroup,
        emergencyContactMobile: card.emergencyContactMobile,
        photoKey: card.photoKey,
    });

    return { card, eligibility };
}

/**
 * Builds cards for many users with batched lookups. Photo: non-rejected KYC
 * "Photo" on the employee record → onboarding copy; the self-uploaded avatar
 * (profilePhotoUrl) is not an identity photo, so it never goes on a card.
 * Branch: Area Managers / org-wide staff have no branchId by design — see
 * employee-display-branch.ts.
 */
async function buildCards(userIds: string[]) {
    const employees = await findCardUsers(userIds);
    const [photoKeys, branches] = await Promise.all([
        resolveEmployeePhotoKeys(employees, { officialOnly: true }),
        resolveDisplayBranches(employees),
    ]);
    return employees.map((e) => ({
        employee: e,
        ...buildCard(e, photoKeys.get(e.id) ?? null, branches.get(e.id) ?? null),
    }));
}

/** Card data + eligibility for one employee (User.id), or null if there is no such user. */
export async function getEmployeeIdCard(
    userId: string
): Promise<{ card: EmployeeIdCardPayload; eligibility: IdCardEligibility } | null> {
    const [built] = await buildCards([userId]);
    return built ? { card: built.card, eligibility: built.eligibility } : null;
}

export interface IdCardListStatus {
    eligibility: IdCardEligibility;
    /** When HR last printed / downloaded the card (null = never issued). */
    issuedAt: Date | null;
    /** A card was issued, but a field printed on it has changed since. */
    reprintRequired: boolean;
}

/**
 * Eligibility + reprint status (no card data) for many employees at once — for
 * the Employee List's ID card column. Same rule as getEmployeeIdCard.
 */
export async function getIdCardStatusForUsers(userIds: string[]): Promise<Map<string, IdCardListStatus>> {
    const result = new Map<string, IdCardListStatus>();
    if (userIds.length === 0) return result;
    for (const { employee, card, eligibility } of await buildCards(userIds)) {
        result.set(employee.id, {
            eligibility,
            issuedAt: employee.idCardIssuedAt,
            reprintRequired:
                employee.idCardFingerprint !== null && employee.idCardFingerprint !== computeIdCardFingerprint(card),
        });
    }
    return result;
}

/** Eligibility only, for many employees at once. */
export async function getIdCardEligibilityForUsers(userIds: string[]): Promise<Map<string, IdCardEligibility>> {
    const statuses = await getIdCardStatusForUsers(userIds);
    return new Map([...statuses].map(([id, s]) => [id, s.eligibility]));
}

/**
 * Records that HR printed / downloaded this employee's card, fingerprinting the
 * printed fields so later edits flag a reprint. Only for an eligible card.
 */
export async function recordIdCardIssued(
    userId: string
): Promise<{ issued: true; issuedAt: Date } | { issued: false; eligibility: IdCardEligibility } | null> {
    const [built] = await buildCards([userId]);
    if (!built) return null;
    if (!built.eligibility.eligible) return { issued: false, eligibility: built.eligibility };
    const issuedAt = new Date();
    await prisma.user.update({
        where: { id: userId },
        data: { idCardIssuedAt: issuedAt, idCardFingerprint: computeIdCardFingerprint(built.card) },
    });
    return { issued: true, issuedAt };
}
