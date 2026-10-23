/**
 * Group assignment service.
 *
 * `createNextGroupForCenter` is the ONLY function that creates a `Group` row.
 * It's called from the Centers → Groups management page (`POST /api/groups`,
 * manual "Add Group") and from center approval (`POST /api/centers/[id]/approve`,
 * auto-creates the center's first group). Every other flow (group-assign,
 * center-group-assign, transfer) only picks among EXISTING groups that have
 * spare capacity — they never create a group.
 *
 * Capacity is always counted by ACTIVE clients only (`Client.isActive: true`).
 * A client marked inactive still has a `GroupMember` row (never deleted), but
 * that row is excluded from capacity counts everywhere in this module.
 *
 * `validateGroupCapacity()` and `createNextGroupForCenter()` must be called
 * INSIDE a prisma.$transaction() callback: both take a per-center pg advisory
 * xact lock, so concurrent writers touching the same center's groups serialize
 * and can never overfill a group or create duplicate group numbers. The
 * @@unique([centerId, groupNumber]) and code @unique constraints are DB-level
 * backstops.
 */

import type { Prisma } from '@prisma/client';

export interface GroupFillCandidate {
    memberCount: number;
}

export interface GroupNumberSource {
    groupNumber: number | null;
    name: string;
}

export interface AutoAssignedGroup {
    id: string;
    name: string;
    code: string | null;
    groupNumber: number | null;
    created: boolean;
}

/** First group (in the given order) with room for one more member, or null. */
export function pickGroupWithCapacity<T extends GroupFillCandidate>(
    groupsSorted: T[],
    maxMembers: number
): T | null {
    return groupsSorted.find((g) => g.memberCount < maxMembers) ?? null;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Leading "N-" number off a legacy source name (e.g. "1-MUTHIRI THOTTAM 01" -> 1,
 * "2-MUNTHIRI THOTTAM(PARAMANKURICHI)" -> 2). Bulk uploan imports carry the source
 * system's own center/group numbering baked into the name text this way — used to
 * seed Center.code / Group.groupNumber so this app's numbers agree with the legacy
 * ones instead of an unrelated internal auto-increment. Null if no such prefix.
 */
export function extractLegacyNumberPrefix(text: string): number | null {
    const match = text.trim().match(/^(\d+)-/);
    return match ? parseInt(match[1], 10) : null;
}

/** Parse the N out of a group named exactly "<Center Name> - N", else null. */
export function parseGroupNumberFromName(
    groupName: string,
    centerName: string
): number | null {
    const pattern = new RegExp(`^${escapeRegExp(centerName.trim())} - (\\d+)$`);
    const match = groupName.trim().match(pattern);
    return match ? parseInt(match[1], 10) : null;
}

/**
 * Next per-center group number: one past the max of all assigned groupNumbers
 * and any legacy names that already follow the "<Center Name> - N" convention.
 * Includes inactive groups so numbers are never reused. Starts at 1.
 */
export function computeNextGroupNumber(
    allCenterGroups: GroupNumberSource[],
    centerName: string
): number {
    let max = 0;
    for (const group of allCenterGroups) {
        const n = group.groupNumber ?? parseGroupNumberFromName(group.name, centerName);
        if (n !== null && n > max) max = n;
    }
    return max + 1;
}

export function buildGroupName(centerName: string, groupNumber: number): string {
    return `${centerName.trim()} - ${groupNumber}`;
}

/**
 * Next global group code: max numeric code + 1, unpadded (matches the
 * convention used by POST /api/groups). Null/non-numeric codes are ignored.
 */
export function nextGlobalGroupCode(existingCodes: (string | null)[]): string {
    let max = 0;
    for (const code of existingCodes) {
        if (!code) continue;
        const num = parseInt(code, 10);
        if (!isNaN(num) && num > max) max = num;
    }
    return (max + 1).toString();
}

/** A center's candidate groups in fill order, each with an active-only member count. */
export interface CandidateGroup {
    id: string;
    name: string;
    code: string | null;
    groupNumber: number | null;
    memberCount: number;
}

/**
 * Load a center's active groups (status ACTIVE, isActive true), sorted in
 * fill order — numbered groups ascending first, then legacy unnumbered groups
 * by age — each annotated with an ACTIVE-clients-only member count.
 *
 * Does not take any lock itself; callers that need to act on the result under
 * a consistent view (e.g. picking a group to fill) should take the per-center
 * advisory lock first, same key as `validateGroupCapacity`/`createNextGroupForCenter`.
 */
export async function listCandidateGroupsWithActiveCounts(
    tx: Prisma.TransactionClient,
    centerId: string
): Promise<CandidateGroup[]> {
    const allGroups = await tx.group.findMany({
        where: { centerId },
        select: {
            id: true,
            name: true,
            code: true,
            groupNumber: true,
            status: true,
            isActive: true,
            createdAt: true,
            _count: { select: { members: { where: { client: { isActive: true } } } } },
        },
    });

    return allGroups
        .filter((g) => g.isActive && g.status === 'ACTIVE')
        .map((g) => ({
            id: g.id,
            name: g.name,
            code: g.code,
            groupNumber: g.groupNumber,
            memberCount: g._count.members,
            createdAt: g.createdAt,
        }))
        .sort((a, b) => {
            if (a.groupNumber !== null && b.groupNumber !== null)
                return a.groupNumber - b.groupNumber;
            if (a.groupNumber !== null) return -1;
            if (b.groupNumber !== null) return 1;
            return a.createdAt.getTime() - b.createdAt.getTime();
        });
}

/**
 * Next client-ID sequence number for a given "{branchCode}-{centerCode}-{groupCode}"
 * prefix: one past the highest numeric suffix among ALL clients whose `clientId`
 * (globally unique) currently starts with that prefix.
 *
 * Deliberately NOT a `count()` of current combo members: `clientId` is only
 * reassigned when a client is later moved elsewhere, so if a member who isn't
 * the most-recently-added one leaves the combo (transferred out, reassigned),
 * the count drops but the remaining members keep their higher-numbered ids.
 * `count() + 1` then reissues a number still held by a member still in the
 * combo, colliding on the `clientId` unique constraint — and retrying doesn't
 * help because the count never changes. Taking the max instead always lands
 * one past every id still in use.
 *
 * Must run inside the same transaction/advisory-lock scope as the caller's
 * capacity check (validateGroupCapacity / the transfer route's manual lock)
 * so concurrent writers to the same combo can't compute the same sequence.
 */
export async function nextClientSequenceForPrefix(
    tx: Prisma.TransactionClient,
    prefix: string
): Promise<number> {
    const matches = await tx.client.findMany({
        where: { clientId: { startsWith: `${prefix}-` } },
        select: { clientId: true },
    });
    let max = 0;
    for (const { clientId } of matches) {
        const suffix = clientId.slice(prefix.length + 1);
        const n = parseInt(suffix, 10);
        if (!isNaN(n) && n > max) max = n;
    }
    return max + 1;
}

/** Exact user-facing message when a group has reached maxMembers (active clients only). */
export const GROUP_CAPACITY_FULL_MESSAGE =
    'Selected Group has reached the maximum member limit. Please select another Group.';

/** Message when the selected group doesn't belong to the center or isn't active. */
export const GROUP_NOT_AVAILABLE_MESSAGE =
    'Selected Group is not available for assignment. Please select another Group.';

/**
 * Re-validate that a specific group still has spare capacity (ACTIVE clients
 * only) right before committing an assignment into it. Must run inside an
 * interactive transaction — takes the per-center advisory lock first so
 * concurrent assignments to the same center serialize against each other and
 * against `createNextGroupForCenter`.
 *
 * Throws with GROUP_CAPACITY_FULL_MESSAGE if the group is full, or a distinct
 * message if the group doesn't belong to the center or isn't active.
 */
export async function validateGroupCapacity(
    tx: Prisma.TransactionClient,
    params: { groupId: string; centerId: string; maxMembers: number }
): Promise<void> {
    const { groupId, centerId, maxMembers } = params;

    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('auto-group-assign'), hashtext(${centerId}))`;

    const group = await tx.group.findUnique({
        where: { id: groupId },
        select: { id: true, centerId: true, status: true, isActive: true },
    });

    if (!group || group.centerId !== centerId || !group.isActive || group.status !== 'ACTIVE') {
        throw new Error(GROUP_NOT_AVAILABLE_MESSAGE);
    }

    const activeMemberCount = await tx.groupMember.count({
        where: { groupId, client: { isActive: true } },
    });

    if (activeMemberCount >= maxMembers) {
        throw new Error(GROUP_CAPACITY_FULL_MESSAGE);
    }
}

/**
 * Create the next auto-numbered/auto-named group for a center: "<Center Name> - N".
 * Must run inside an interactive transaction. This is the ONLY function in the
 * codebase that creates a `Group` row — called from the manual "Add Group" action
 * (Centers → Groups management page, `POST /api/groups`) and from center approval
 * (auto-creates the first group). Not gated on maxMembersPerGroup: creation is an
 * explicit/triggered action, not conditional on current fill level.
 */
export async function createNextGroupForCenter(
    tx: Prisma.TransactionClient,
    params: {
        centerId: string;
        createdById: string;
        legacySourceName?: string | null;
        /** Uploan-import-only override: use this exact group number/code (parsed from the
         *  source file's legacy MemberID) instead of the legacy-prefix-or-auto-increment
         *  logic below. Every other caller leaves this undefined and gets the normal
         *  auto-numbering behavior, unchanged. */
        exactGroupNumber?: number;
    }
): Promise<AutoAssignedGroup> {
    const { centerId, createdById, legacySourceName, exactGroupNumber } = params;

    // Same per-center lock key as validateGroupCapacity, so creation
    // serializes against concurrent capacity checks/assignments too.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('auto-group-assign'), hashtext(${centerId}))`;

    const center = await tx.center.findUnique({
        where: { id: centerId },
        select: { id: true, name: true },
    });
    if (!center) {
        throw new Error('Center not found for group creation');
    }

    // ALL groups of the center: inactive ones still block their number from
    // reuse, so numbers are never reused even if a group is later deactivated.
    const allGroups = await tx.group.findMany({
        where: { centerId },
        select: { name: true, groupNumber: true, code: true },
    });
    const takenNumbers = new Set(
        allGroups
            .map((g) => g.groupNumber ?? parseGroupNumberFromName(g.name, center.name))
            .filter((n): n is number => n !== null)
    );
    const takenCodes = new Set(allGroups.map((g) => g.code).filter((c): c is string => c !== null));

    let groupNumber: number;
    if (exactGroupNumber !== undefined) {
        // Uploan import: the number is already authoritative (parsed from the legacy
        // MemberID and pre-checked against existing groups during validation) — a
        // collision here means a genuine race since validation ran, not something to
        // silently increment past.
        if (takenNumbers.has(exactGroupNumber) || takenCodes.has(String(exactGroupNumber))) {
            throw new Error(`Group code "${exactGroupNumber}" already exists in this center — cannot import as a new group`);
        }
        groupNumber = exactGroupNumber;
    } else {
        // Prefer the legacy system's own number (from the source file's "N-..." group
        // name) so this app's per-center numbering agrees with the legacy one — fall
        // back to the auto-increment only when there's no usable legacy prefix, or it's
        // already taken by another group in this center.
        const legacyNumber = legacySourceName ? extractLegacyNumberPrefix(legacySourceName) : null;
        groupNumber =
            legacyNumber !== null && !takenNumbers.has(legacyNumber)
                ? legacyNumber
                : computeNextGroupNumber(allGroups, center.name);
        const existingNames = new Set(allGroups.map((g) => g.name.trim().toLowerCase()));
        while (
            existingNames.has(buildGroupName(center.name, groupNumber).toLowerCase()) ||
            takenNumbers.has(groupNumber) ||
            takenCodes.has(String(groupNumber))
        ) {
            groupNumber++;
        }
    }

    // Code mirrors groupNumber: a per-center sequence (the DB constraint is
    // @@unique([centerId, code]) — never globally unique despite the old
    // implementation scanning every group in the system).
    const code = String(groupNumber);

    const created = await tx.group.create({
        data: {
            name: buildGroupName(center.name, groupNumber),
            code,
            groupNumber,
            centerId,
            createdById,
            legacySourceName: legacySourceName?.trim() || null,
            status: 'ACTIVE',
            isActive: true,
        },
        select: { id: true, name: true, code: true, groupNumber: true },
    });

    return { ...created, created: true };
}
