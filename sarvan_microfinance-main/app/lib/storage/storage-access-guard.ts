import { prisma } from '@/app/lib/db';
import type { UserContext } from '@/app/lib/permissions/types';
import { checkPermission } from '@/app/lib/permissions/engine';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';
import { isHeadOfficeBranch } from '@/app/lib/head-office-branch';

/**
 * Can this user see data of `branchId`? Deliberately the SAME branch scope the
 * data APIs use (getPermittedBranchIds — client lists, approvals, trackers,
 * reports), so anyone who can open a member can always load that member's
 * images, for every role (ADMIN, QC, AM, BM, FDO, custom RBAC roles). A
 * narrower rule here is what previously blanked images for BMs (no
 * UserBranchAccess rows) and AMs (branches only in AreaManagerBranch).
 * UserBranchAccess grants are honoured on top as an extra allowance.
 */
async function canSeeBranch(ctx: UserContext, branchId: string): Promise<boolean> {
    if (ctx.branchId === branchId) return true;
    if (ctx.branchAccess.some((ba) => ba.branchId === branchId)) return true;

    const user = await prisma.user.findUnique({
        where: { id: ctx.userId },
        select: { role: true, branchId: true },
    });
    if (!user) return false;
    if (user.branchId === branchId) return true;
    // HO-based staff (QC, HO admins, ...) currently switched into a branch.
    if (user.branchId && (await isHeadOfficeBranch(user.branchId))) return true;

    const permitted = await getPermittedBranchIds({ userId: ctx.userId, role: user.role, branchId: ctx.branchId });
    return permitted === null || permitted.includes(branchId);
}

/**
 * Checks whether an authenticated user is permitted to access a given GCS object key.
 *
 * Scoping rules:
 * Every branch check goes through canSeeBranch() — the same scope as the data APIs.
 *
 * 1. Head Office staff have access across all branches.
 * 2. Onboarding documents (`hr-onboarding/{requestId}/...`):
 *    - Validates caller's branch access against the onboarding request's assigned branch.
 *    - Unassigned requests (draft link) require 'hr-onboarding:view'.
 * 3. Employee documents (`.../employee-{employeeId}/...` or `employees/{employeeId}/...`):
 *    - An employee can always access their own files (`ctx.userId === employeeId`).
 *    - Accessing another employee's files requires 'hr-employee:view' or 'hr-onboarding:view'
 *      AND the caller must be able to see the target employee's branch.
 * 4. Branch-hierarchy documents (`.../branch-{branchId}/...`):
 *    - The caller must be able to see that branch, or the client's CURRENT branch
 *      (the folder keeps the upload-time branch, which goes stale after a transfer).
 * 5. Other keys (report-exports, general assets) are allowed for authenticated users.
 */
export async function canAccessStorageKey(ctx: UserContext, key: string): Promise<boolean> {
    if (ctx.isHeadOffice) return true;

    // 1. Onboarding request documents: hr-onboarding/{requestId}/documents/...
    const onboardingMatch = key.match(/^hr-onboarding\/([^/]+)\//);
    if (onboardingMatch) {
        const requestId = onboardingMatch[1];
        const req = await prisma.employeeOnboardingRequest.findUnique({
            where: { id: requestId },
            select: { branchId: true },
        });
        if (!req) return false;
        if (!req.branchId) {
            // Unassigned draft request — allowed if user has hr-onboarding view permission
            return checkPermission(ctx, { moduleSlug: 'hr-onboarding', actionSlug: 'view' }).allowed;
        }
        return canSeeBranch(ctx, req.branchId);
    }

    // 2. Employee documents: .../employee-{employeeId}/...
    const employeeMatch = key.match(/(?:^|\/)employee-([^/]+)/);
    if (employeeMatch) {
        const employeeId = employeeMatch[1];
        if (employeeId === 'unassigned') return true;
        // Self-access is always allowed
        if (employeeId === ctx.userId) return true;

        // Otherwise check target employee's branch against caller's branch access
        const emp = await prisma.user.findUnique({
            where: { id: employeeId },
            select: { branchId: true },
        });
        if (!emp) return false;

        const hasViewPerm =
            checkPermission(ctx, { moduleSlug: 'hr-employee', actionSlug: 'view' }).allowed ||
            checkPermission(ctx, { moduleSlug: 'hr-onboarding', actionSlug: 'view' }).allowed;
        if (!hasViewPerm) return false;

        if (!emp.branchId) return true;
        return canSeeBranch(ctx, emp.branchId);
    }

    // 3. Branch ancestry documents: .../branch-{branchId}/.../client-{id}/[loan-{id}/]...
    const branchMatch = key.match(/(?:^|\/)branch-([^/]+)/);
    if (branchMatch) {
        const branchId = branchMatch[1];
        if (branchId === 'unassigned') return true;
        if (await canSeeBranch(ctx, branchId)) return true;

        // The folder records the branch at upload time. After a client transfer
        // the member lives in another branch, so check where they are NOW.
        const clientId = key.match(/(?:^|\/)client-([^/]+)/)?.[1];
        if (clientId && clientId !== 'unassigned') {
            const client = await prisma.client.findUnique({
                where: { id: clientId },
                select: { center: { select: { branchId: true } } },
            });
            const currentBranchId = client?.center?.branchId;
            if (currentBranchId && currentBranchId !== branchId && (await canSeeBranch(ctx, currentBranchId))) return true;
        }
        return false;
    }

    // 4. Default: authenticated user access for general/export keys
    return true;
}

