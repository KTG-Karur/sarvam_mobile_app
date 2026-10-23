import { prisma } from '@/app/lib/prisma';
import type { JWTPayload } from '@/app/lib/auth';
import { resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';
import { applyOrgScope } from '@/app/lib/permissions/org-scope';
import {
    getStageForStatus,
    getUserWorkflowRoleSlugs,
    userHoldsStage,
    type WorkflowStage,
} from '@/app/lib/workflow-config';

/** The branch a client's approval belongs to (assigned center → requested center → enroller). */
export function getClientApprovalBranchId(client: {
    center?: { branchId: string } | null;
    requestedCenter?: { branchId: string } | null;
    enrolledBy?: { branchId: string | null } | null;
}): string | null {
    return client.center?.branchId ?? client.requestedCenter?.branchId ?? client.enrolledBy?.branchId ?? null;
}

/**
 * Whether `user` may act on a client in `clientBranchId` — same canonical
 * branch scope as the approval queue (BM re-read fresh from DB so a branch
 * transfer applies immediately; HO-based users are unrestricted).
 */
export async function canAccessClientBranch(user: JWTPayload, clientBranchId: string | null): Promise<boolean> {
    let effectiveUser = user;
    if (user.role === 'BRANCH_MANAGER') {
        const row = await prisma.user.findUnique({ where: { id: user.userId }, select: { branchId: true } });
        if (!row?.branchId) return false;
        effectiveUser = { ...user, branchId: row.branchId };
    }
    // Narrowed by the user's Region/Division/Area/Branch org scope, if any.
    const scope = await applyOrgScope(user.userId, await resolveScopedBranchIds(effectiveUser));
    if (scope === null) return true;
    return !!clientBranchId && scope.includes(clientBranchId);
}

export type ActingStageResult =
    | { ok: true; stage: WorkflowStage; stages: WorkflowStage[] }
    | { ok: false; error: string; status: number };

/**
 * With a dynamic workflow active: the stage the client at `approvalStatus` is
 * waiting on, provided `user` holds that stage's role. Works for ANY role —
 * built-in or admin-created — at any level.
 */
export async function resolveActingStage(
    user: JWTPayload,
    approvalStatus: string,
    stages: WorkflowStage[]
): Promise<ActingStageResult> {
    const stage = getStageForStatus(approvalStatus, stages);
    if (!stage) {
        return { ok: false, error: `This client is not at an approval stage (status: ${approvalStatus})`, status: 400 };
    }
    const slugs = await getUserWorkflowRoleSlugs(user);
    if (!userHoldsStage(stage, slugs)) {
        return { ok: false, error: `This client is waiting for "${stage.stageName}" — your role cannot act at this stage`, status: 403 };
    }
    return { ok: true, stage, stages };
}
