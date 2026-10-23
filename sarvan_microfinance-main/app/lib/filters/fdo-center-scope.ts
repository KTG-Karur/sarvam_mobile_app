import type { Prisma } from '@prisma/client';
import { prisma } from '@/app/lib/prisma';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';
import type { JWTPayload } from '@/app/lib/auth';

export type ScopeAuthUser = {
    userId: string;
    role: string;
    branchId?: string | null;
};

/**
 * Center-visibility scoping for FDO role.
 * FDO -> only centers where Center.fdoId === userId. No branch fallback.
 * Non-FDO roles get {} (caller applies its own branch/role scoping).
 */
export function buildFdoCenterScope(user: ScopeAuthUser | null | undefined): Prisma.CenterWhereInput | {} {
    if (user?.role === 'FDO') {
        return { fdoId: user.userId };
    }
    return {};
}

/**
 * Pure ownership check for a single already-fetched center.
 * Callers should add `fdoId: true` to their existing center `select`
 * (used for branchId/lock checks) and pass the result in here, instead
 * of issuing a second query.
 */
export function assertFdoOwnsCenter(user: ScopeAuthUser, center: { fdoId: string | null }): boolean {
    if (user.role !== 'FDO') return true;
    return center.fdoId === user.userId;
}

export const FDO_CENTER_FORBIDDEN_MESSAGE = 'You do not have access to this center';

/**
 * Full role-aware center-access guard, shared by collection routes and
 * report routes that previously each carried their own copy-pasted version.
 * ADMIN and AREA_MANAGER are unconditionally unrestricted (unchanged from
 * the original per-route copies); FDO is scoped to Center.fdoId; everyone
 * else (BRANCH_MANAGER, and any dynamic-RBAC role such as "Zonal Head" /
 * "Division Manager") is scoped via getPermittedBranchIds — which is
 * Head-Office-aware, so an HO-based non-ADMIN role is treated as
 * unrestricted rather than being pinned to the empty HO branch (the bug
 * that made every center/collection lookup 403 for such users).
 */
export async function checkCenterAccess(
    user: JWTPayload,
    center: { branchId: string; fdoId: string | null }
): Promise<string | null> {
    if (user.role === 'ADMIN' || user.role === 'AREA_MANAGER') return null;

    if (user.role === 'FDO') {
        return assertFdoOwnsCenter(user, center) ? null : FDO_CENTER_FORBIDDEN_MESSAGE;
    }

    let effectiveUser = user;
    if (!user.branchId) {
        const dbUser = await prisma.user.findUnique({
            where: { id: user.userId },
            select: { branchId: true },
        });
        effectiveUser = { ...user, branchId: dbUser?.branchId ?? undefined };
    }

    const permitted = await getPermittedBranchIds(effectiveUser);
    if (permitted === null) return null;
    return permitted.includes(center.branchId) ? null : FDO_CENTER_FORBIDDEN_MESSAGE;
}
