import { prisma } from '@/app/lib/prisma';
import type { ClientApprovalStatus } from '@prisma/client';

export interface WorkflowStage {
    levelOrder: number;
    roleSlug: string;
    stageName: string;
}

// Known roles use their existing named statuses (backward compat)
const ROLE_PENDING_STATUS: Record<string, ClientApprovalStatus> = {
    'branch-manager': 'PENDING_BM_REVIEW' as ClientApprovalStatus,
    'area-manager': 'PENDING_AM_REVIEW' as ClientApprovalStatus,
    'quality-checkers': 'PENDING_QC_VERIFICATION' as ClientApprovalStatus,
    'background-verification-team': 'PENDING_QC_VERIFICATION' as ClientApprovalStatus, // legacy slug alias
};

const ROLE_RETAKE_STATUS: Record<string, ClientApprovalStatus> = {
    'branch-manager': 'BM_RETAKE_REQUIRED' as ClientApprovalStatus,
    'area-manager': 'AM_RETAKE_REQUIRED' as ClientApprovalStatus,
    'quality-checkers': 'QC_VERIFICATION_RETAKE_REQUIRED' as ClientApprovalStatus,
    'background-verification-team': 'QC_VERIFICATION_RETAKE_REQUIRED' as ClientApprovalStatus, // legacy slug alias
};

// Generic level statuses for any other role
const LEVEL_PENDING: Record<number, string> = {
    1: 'PENDING_LEVEL_1',
    2: 'PENDING_LEVEL_2',
    3: 'PENDING_LEVEL_3',
    4: 'PENDING_LEVEL_4',
    5: 'PENDING_LEVEL_5',
};

const LEVEL_RETAKE: Record<number, string> = {
    1: 'LEVEL_1_RETAKE_REQUIRED',
    2: 'LEVEL_2_RETAKE_REQUIRED',
    3: 'LEVEL_3_RETAKE_REQUIRED',
    4: 'LEVEL_4_RETAKE_REQUIRED',
    5: 'LEVEL_5_RETAKE_REQUIRED',
};

export function getPendingStatusForStage(stage: WorkflowStage): ClientApprovalStatus {
    return (
        ROLE_PENDING_STATUS[stage.roleSlug] ??
        (LEVEL_PENDING[stage.levelOrder] as ClientApprovalStatus)
    );
}

export function getRetakeStatusForStage(stage: WorkflowStage): ClientApprovalStatus {
    return (
        ROLE_RETAKE_STATUS[stage.roleSlug] ??
        (LEVEL_RETAKE[stage.levelOrder] as ClientApprovalStatus)
    );
}

// Built-in user.role codes → the RBAC slug they act as in a workflow stage.
// Custom roles are resolved only through UserRoleAssignment (their user.role is
// an auto-generated code that doesn't identify a slug on its own).
const BUILTIN_ROLE_SLUG: Record<string, string> = {
    BRANCH_MANAGER: 'branch-manager',
    AREA_MANAGER: 'area-manager',
    QC: 'quality-checkers',
};

// 'background-verification-team' is the legacy slug of 'quality-checkers'.
function canonicalSlug(slug: string): string {
    return slug === 'background-verification-team' ? 'quality-checkers' : slug;
}

/** Every workflow role slug this user can act as (base role + active RBAC assignments). */
export async function getUserWorkflowRoleSlugs(user: { userId: string; role: string }): Promise<Set<string>> {
    const slugs = new Set<string>();
    const builtin = BUILTIN_ROLE_SLUG[user.role];
    if (builtin) slugs.add(builtin);
    const assignments = await prisma.userRoleAssignment.findMany({
        where: {
            userId: user.userId,
            isActive: true,
            role: { isActive: true },
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        select: { role: { select: { slug: true } } },
    });
    for (const a of assignments) slugs.add(canonicalSlug(a.role.slug));
    return slugs;
}

export function userHoldsStage(stage: WorkflowStage, userSlugs: Set<string>): boolean {
    return userSlugs.has(canonicalSlug(stage.roleSlug));
}

/**
 * The configured stage a client at `status` is waiting on — SUBMITTED belongs
 * to the first stage; otherwise the stage whose pending/retake status matches.
 * null = not at any configured stage (final review, approved, rejected, …).
 */
export function getStageForStatus(status: string, stages: WorkflowStage[]): WorkflowStage | null {
    if (status === 'SUBMITTED') return stages[0] ?? null;
    return stages.find(s =>
        status === getPendingStatusForStage(s) || status === getRetakeStatusForStage(s)
    ) ?? null;
}

/** All statuses that mean "still inside the configured stages" (incl. SUBMITTED). */
export function getAllStageStatuses(stages: WorkflowStage[]): ClientApprovalStatus[] {
    const out = new Set<ClientApprovalStatus>(['SUBMITTED' as ClientApprovalStatus]);
    for (const s of stages) {
        out.add(getPendingStatusForStage(s));
        out.add(getRetakeStatusForStage(s));
    }
    return [...out];
}

/** Every stage's retake status (what FDO_RESUBMIT accepts while a workflow is active). */
export function getAllStageRetakeStatuses(stages: WorkflowStage[]): ClientApprovalStatus[] {
    return [...new Set(stages.map(getRetakeStatusForStage))];
}

export function isDynamicStatus(status: string): boolean {
    return /^(PENDING_LEVEL|LEVEL)_[1-5](_RETAKE_REQUIRED)?$/.test(status);
}

export function getLevelFromStatus(status: string): number | null {
    const m = status.match(/(?:PENDING_LEVEL|LEVEL)_([1-5])/);
    return m ? parseInt(m[1]) : null;
}

export function isPendingLevelStatus(status: string): boolean {
    return /^PENDING_LEVEL_[1-5]$/.test(status);
}

// Simple in-process cache (15-second TTL — each server process caches separately,
// and only the process that saved a config invalidates immediately)
let _cache: { stages: WorkflowStage[] } | null = null;
let _cacheExpiry = 0;

export async function getActiveWorkflowConfig(): Promise<{ stages: WorkflowStage[] } | null> {
    const now = Date.now();
    if (_cache && now < _cacheExpiry) return _cache;

    const config = await prisma.clientWorkflowConfig.findFirst({
        where: { isActive: true },
        include: { stages: { orderBy: { levelOrder: 'asc' } } },
    });

    if (!config || config.stages.length === 0) {
        _cache = null;
    } else {
        _cache = { stages: config.stages };
    }
    _cacheExpiry = now + 15_000;
    return _cache;
}

export function invalidateWorkflowCache() {
    _cache = null;
    _cacheExpiry = 0;
}

// Given a roleSlug, return all approval statuses that role should see in the queue
export function getQueueStatusesForRole(
    roleSlug: string,
    stages: WorkflowStage[]
): ClientApprovalStatus[] {
    const statuses: ClientApprovalStatus[] = [];
    stages.forEach((stage) => {
        if (canonicalSlug(stage.roleSlug) === canonicalSlug(roleSlug)) {
            statuses.push(getPendingStatusForStage(stage));
            statuses.push(getRetakeStatusForStage(stage));
        }
    });
    return statuses;
}

/**
 * Whether a client currently at `status` is within the given role's own
 * review stage — true for either the role's legacy named status(es) or, when
 * a dynamic ClientWorkflowConfig is active, the level status(es) configured
 * for that roleSlug. Used to restrict AM/QC edit access on the Approval Page
 * to only while the client is actually pending at their stage.
 */
export async function isClientPendingForRole(
    status: string,
    roleSlug: string,
    legacyStatuses: string[]
): Promise<boolean> {
    if (legacyStatuses.includes(status)) return true;

    const config = await getActiveWorkflowConfig();
    if (!config) return false;

    const stage = getStageForStatus(status, config.stages);
    return !!stage && canonicalSlug(stage.roleSlug) === canonicalSlug(roleSlug);
}

// All level retake statuses (for FDO resubmit)
export const ALL_LEVEL_RETAKE_STATUSES = [
    'LEVEL_1_RETAKE_REQUIRED',
    'LEVEL_2_RETAKE_REQUIRED',
    'LEVEL_3_RETAKE_REQUIRED',
    'LEVEL_4_RETAKE_REQUIRED',
    'LEVEL_5_RETAKE_REQUIRED',
] as ClientApprovalStatus[];
