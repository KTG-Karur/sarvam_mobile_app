import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/app/lib/db';
import { withAuth, errorResponse } from '@/app/lib/api-utils';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';
import { isHeadOfficeBranch } from '@/app/lib/head-office-branch';
import { configurationError } from './configuration-api';
import { StaffLoanConfigurationError } from './configuration-service';
import { MANAGEMENT_PAGE, roleCanAct, type RoleAssignment } from './application';
import { resolveMasterCapabilities } from './configuration';

export type StaffLoanActor = {
    userId: string; isAdmin: boolean; isHR?: boolean; branchIds: string[] | null;
    assignments: (RoleAssignment & { pagePermissions: Prisma.JsonValue | null })[];
};
export function canApplyForOthers(actor: StaffLoanActor): boolean {
    if (actor.isAdmin || actor.isHR) return true;
    return actor.assignments.some(a => resolveMasterCapabilities(false, [a.pagePermissions], MANAGEMENT_PAGE).add);
}
export function actorRoleCanAct(actor: StaffLoanActor, roleId: string, branchId: string) {
    return (actor.branchIds === null || actor.branchIds.includes(branchId)) && roleCanAct(actor.assignments, roleId, branchId);
}
// A global (null-branch) assignment adds no branch restriction of its own; an empty filter cannot be one branch of an
// OR list, so it short-circuits to the plain branch scope (same rule as the Staff Advance access helpers).
export function registerScope(actor: StaffLoanActor): Prisma.StaffLoanWhereInput | null {
    const branchScope = actor.branchIds === null ? {} : { branchId: { in: actor.branchIds } };
    if (actor.isAdmin) return branchScope;
    const grants = actor.assignments.filter(a => resolveMasterCapabilities(false, [a.pagePermissions], MANAGEMENT_PAGE).view);
    if (!grants.length) return null;
    if (grants.some(g => g.branchId === null)) return branchScope;
    return { AND: [branchScope, { branchId: { in: [...new Set(grants.map(g => g.branchId as string))] } }] };
}
export function roleBranchScope(actor: StaffLoanActor, roleId: string): Prisma.StaffLoanWhereInput | null {
    const assignments = actor.assignments.filter(a => a.roleId === roleId);
    if (!assignments.length) return null;
    const branchScope = actor.branchIds === null ? {} : { branchId: { in: actor.branchIds } };
    if (assignments.some(a => a.branchId === null)) return branchScope;
    return { AND: [branchScope, { branchId: { in: [...new Set(assignments.map(a => a.branchId as string))] } }] };
}

export function withStaffLoanActor(handler: (req: NextRequest, actor: StaffLoanActor) => Promise<NextResponse>) {
    return withAuth(async (req, session) => {
        try {
            const user = await prisma.user.findUnique({ where: { id: session.userId }, select: {
                id: true, isActive: true, role: true, branchId: true,
                userRoles: { where: { isActive: true, role: { isActive: true }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
                    select: { branchId: true, roleId: true, role: { select: { slug: true, pagePermissions: true } } } },
            } });
            if (!user?.isActive) return errorResponse('Authentication required', 401);
            if (!prisma.staffLoan) throw new StaffLoanConfigurationError('Staff loan setup is not available yet.', 503);
            const branchIds = await getPermittedBranchIds({ userId: user.id, role: user.role, branchId: user.branchId });
            const userRoleCode = (user.role ?? '').toUpperCase();
            const matchingRoles = await prisma.role.findMany({
                where: {
                    isActive: true,
                    OR: [
                        { legacyRole: userRoleCode },
                        { slug: userRoleCode.toLowerCase().replace(/_/g, '-') },
                        ...(userRoleCode === 'BM' ? [{ slug: 'branch-manager' }, { legacyRole: 'BRANCH_MANAGER' }] : []),
                        ...(userRoleCode === 'AM' ? [{ slug: 'area-manager' }, { legacyRole: 'AREA_MANAGER' }] : []),
                    ],
                },
                select: { id: true, slug: true, pagePermissions: true },
            });
            const explicitRoleIds = new Set(user.userRoles.map(r => r.roleId));
            // A Head Office assignment is company-wide: HO has no clients of its own, so pinning it to the HO branch
            // would stop an HO approver acting on any branch's request. Same rule as getPermittedBranchIds.
            const assignmentBranch = async (branchId: string | null) => (branchId && await isHeadOfficeBranch(branchId) ? null : branchId);
            const assignments = [
                ...await Promise.all(user.userRoles.map(async r => ({ roleId: r.roleId, branchId: await assignmentBranch(r.branchId), pagePermissions: r.role.pagePermissions }))),
                ...await Promise.all(matchingRoles
                    .filter(mr => !explicitRoleIds.has(mr.id))
                    .map(async mr => ({
                        roleId: mr.id,
                        branchId: await assignmentBranch(user.branchId),
                        pagePermissions: mr.pagePermissions,
                    }))),
            ];
            const isAdmin = user.role === 'ADMIN' || user.userRoles.some(r => r.role.slug === 'admin' && r.branchId === null);
            const isHR = user.role === 'HR' || user.role === 'HR_MANAGER' || user.userRoles.some(r => r.role.slug === 'hr' || r.role.slug === 'hr-manager');
            return await handler(req, {
                userId: user.id, isAdmin, isHR, branchIds, assignments,
            });
        } catch (error) { return configurationError(error); }
    });
}
