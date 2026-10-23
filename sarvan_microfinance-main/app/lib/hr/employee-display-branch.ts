// ============================================================
// EMPLOYEE DISPLAY BRANCH — which branch to *show* for an employee
// app/lib/hr/employee-display-branch.ts
//
// User.branchId is deliberately null for some staff, and must stay that way:
//   - Area Managers: their branches live in AreaManagerBranch (one isPrimary);
//     branchId is the BM/FDO source of truth only (see schema comment).
//   - Org-wide accounts (CEO, admins): no branch at all. Giving them one would
//     change their permission scope (checkIsHeadOffice in permissions/engine.ts).
// So instead of writing a branch onto those records, ID card / QR verification /
// the Employee List resolve one for display:
//   1. User.branch
//   2. primary AreaManagerBranch (else the first-assigned one)
//   3. the Head Office branch (code HO or name "Head Office", same rule as
//      checkIsHeadOffice) — for staff with no branch assignment of any kind
// Display only: never use this for access control or branch scoping.
// ============================================================

import { prisma } from '@/app/lib/prisma';

export type DisplayBranchSource = 'ASSIGNED' | 'AREA_MANAGER' | 'HEAD_OFFICE';

export interface DisplayBranch {
    name: string;
    code: string;
    address: string | null;
    district: string | null;
    state: string | null;
    source: DisplayBranchSource;
}

const BRANCH_SELECT = { name: true, code: true, address: true, district: true, state: true } as const;

type BranchFields = { name: string; code: string; address: string | null; district: string | null; state: string | null };

/** Batched: at most two extra queries for any number of users. */
export async function resolveDisplayBranches(
    users: ReadonlyArray<{ id: string; branch: BranchFields | null }>
): Promise<Map<string, DisplayBranch | null>> {
    const result = new Map<string, DisplayBranch | null>();
    const unassigned: string[] = [];
    for (const u of users) {
        if (u.branch) result.set(u.id, { ...u.branch, source: 'ASSIGNED' });
        else unassigned.push(u.id);
    }
    if (unassigned.length === 0) return result;

    const amRows = await prisma.areaManagerBranch.findMany({
        where: { userId: { in: unassigned } },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        select: { userId: true, branch: { select: BRANCH_SELECT } },
    });
    for (const row of amRows) {
        if (!result.has(row.userId)) result.set(row.userId, { ...row.branch, source: 'AREA_MANAGER' });
    }

    const stillUnassigned = unassigned.filter((id) => !result.has(id));
    if (stillUnassigned.length > 0) {
        const headOffice = await prisma.branch.findFirst({
            where: {
                isActive: true,
                OR: [{ code: { equals: 'HO', mode: 'insensitive' } }, { name: { contains: 'head office', mode: 'insensitive' } }],
            },
            select: BRANCH_SELECT,
        });
        for (const id of stillUnassigned) {
            result.set(id, headOffice ? { ...headOffice, source: 'HEAD_OFFICE' } : null);
        }
    }
    return result;
}

/** Full branch fields to select on a User for resolveDisplayBranches. */
export const DISPLAY_BRANCH_USER_SELECT = { branch: { select: BRANCH_SELECT } } as const;
