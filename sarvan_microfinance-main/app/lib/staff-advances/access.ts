import type { Prisma } from '@prisma/client';
import { resolveMasterCapabilities } from '@/app/lib/staff-loans/configuration';
import type { StaffLoanActor } from '@/app/lib/staff-loans/application-access';
import { ADVANCE_MANAGEMENT_PAGE } from './advance';

/**
 * Staff Advance access rules. The actor (user, roles, branch scope) is the same one the Staff Loan module
 * builds, so RBAC and branch restrictions behave identically; only the page grants differ.
 *
 * Note on Prisma: an empty filter object inside an OR list matches nothing, so an unrestricted scope must
 * short-circuit to the plain branch filter instead of being listed as an OR branch.
 */

function branchScope(actor: StaffLoanActor): Prisma.StaffAdvanceWhereInput {
    return actor.branchIds === null ? {} : { branchId: { in: actor.branchIds } };
}

/** May this actor apply on behalf of another employee (admin, HR, or "add" on Advance Management)? */
export function advanceCanApplyForOthers(actor: StaffLoanActor): boolean {
    if (actor.isAdmin || actor.isHR) return true;
    return actor.assignments.some(a => resolveMasterCapabilities(false, [a.pagePermissions], ADVANCE_MANAGEMENT_PAGE).add);
}

/** Advances a page grants visibility of (null = the actor has no view grant on that page). */
export function advancePageScope(actor: StaffLoanActor, page: string): Prisma.StaffAdvanceWhereInput | null {
    const scope = branchScope(actor);
    if (actor.isAdmin) return scope;
    const grants = actor.assignments.filter(a => resolveMasterCapabilities(false, [a.pagePermissions], page).view);
    if (!grants.length) return null;
    if (grants.some(g => g.branchId === null)) return scope;
    const branchIds = [...new Set(grants.map(g => g.branchId as string))];
    return { AND: [scope, { branchId: { in: branchIds } }] };
}

/** Advances a role assignment covers (branch-scoped or global), or null if the actor lacks the role. */
export function advanceRoleScope(actor: StaffLoanActor, roleId: string): Prisma.StaffAdvanceWhereInput | null {
    const assignments = actor.assignments.filter(a => a.roleId === roleId);
    if (!assignments.length) return null;
    const scope = branchScope(actor);
    if (assignments.some(a => a.branchId === null)) return scope;
    return { AND: [scope, { branchId: { in: [...new Set(assignments.map(a => a.branchId as string))] } }] };
}

/** True when the where-input filters nothing (so it cannot be one branch of an OR). */
export function isUnrestricted(where: Prisma.StaffAdvanceWhereInput): boolean {
    return Object.keys(where).length === 0;
}
