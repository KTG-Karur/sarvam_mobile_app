import type { ClientApprovalStatus } from '@prisma/client';
import {
    getActiveWorkflowConfig,
    getStageForStatus,
    getPendingStatusForStage,
    getRetakeStatusForStage,
    getLevelFromStatus,
    isDynamicStatus,
    ALL_LEVEL_RETAKE_STATUSES,
    type WorkflowStage,
} from '@/app/lib/workflow-config';

/**
 * Renewal loan approval chain (Loan.renewalApprovalStatus) — follows the SAME
 * ClientWorkflowConfig as member approval, in whatever order/roles the admin
 * configured (e.g. QC → BM → AM). With no active config it falls back to the
 * legacy BM → AM → QC chain, expressed as stages so every caller has one code path.
 *
 * Never map a status to BM/AM/QC directly — resolve the stage here, then use
 * kyc-stage-decisions.ts for where that stage's per-document decision lives.
 */

export const LEGACY_RENEWAL_STAGES: WorkflowStage[] = [
    { levelOrder: 1, roleSlug: 'branch-manager', stageName: 'BM' },
    { levelOrder: 2, roleSlug: 'area-manager', stageName: 'AM' },
    { levelOrder: 3, roleSlug: 'quality-checkers', stageName: 'QC' },
];

export async function getRenewalStages(): Promise<{ stages: WorkflowStage[]; isDynamic: boolean }> {
    const config = await getActiveWorkflowConfig();
    return config
        ? { stages: config.stages, isDynamic: true }
        : { stages: LEGACY_RENEWAL_STAGES, isDynamic: false };
}

/**
 * The stage a renewal at `status` is waiting on (SUBMITTED = first stage).
 * Also resolves rows the old positional chain left at a generic
 * PENDING_LEVEL_n / LEVEL_n_RETAKE_REQUIRED status to the stage at that level.
 */
export function resolveRenewalStage(status: string, stages: WorkflowStage[]): WorkflowStage | null {
    const stage = getStageForStatus(status, stages);
    if (stage) return stage;
    if (isDynamicStatus(status)) {
        const level = getLevelFromStatus(status);
        return stages.find((s) => s.levelOrder === level) ?? null;
    }
    return null;
}

/** Where a renewal goes after `stage` approves: the next configured stage, else Admin final review. */
export function getNextRenewalStatus(stage: WorkflowStage, stages: WorkflowStage[]): ClientApprovalStatus {
    const idx = stages.findIndex((s) => s.levelOrder === stage.levelOrder);
    const next = idx >= 0 ? stages[idx + 1] : undefined;
    return next ? getPendingStatusForStage(next) : ('PENDING_FINAL_REVIEW' as ClientApprovalStatus);
}

/** Status a renewal (re)starts at — the first configured stage's pending status. */
export function getFirstRenewalStatus(stages: WorkflowStage[]): ClientApprovalStatus {
    return stages.length > 0 ? getPendingStatusForStage(stages[0]) : ('SUBMITTED' as ClientApprovalStatus);
}

/** Every renewal status that lands in `stage`'s queue. */
export function getRenewalStatusesForStage(stage: WorkflowStage, stages: WorkflowStage[]): ClientApprovalStatus[] {
    const out = new Set<ClientApprovalStatus>([getPendingStatusForStage(stage), getRetakeStatusForStage(stage)]);
    if (stages[0]?.levelOrder === stage.levelOrder) out.add('SUBMITTED' as ClientApprovalStatus);
    // Rows left at generic level statuses by the old positional chain
    out.add(`PENDING_LEVEL_${stage.levelOrder}` as ClientApprovalStatus);
    out.add(`LEVEL_${stage.levelOrder}_RETAKE_REQUIRED` as ClientApprovalStatus);
    return [...out];
}

/** Every retake status FDO_RESUBMIT / re-upload accepts (named + generic levels + final). */
export const RENEWAL_RETAKE_STATUSES: ClientApprovalStatus[] = [
    'BM_RETAKE_REQUIRED', 'AM_RETAKE_REQUIRED', 'QC_VERIFICATION_RETAKE_REQUIRED', 'FINAL_RETAKE_REQUIRED',
    ...ALL_LEVEL_RETAKE_STATUSES,
] as ClientApprovalStatus[];

/**
 * Minimum co-applicant approval rank (BM=0, AM=1, QC=2, ADMIN=3, APPROVED=4 —
 * see /api/co-applicants/[id]/action, a fixed BM → AM → QC → Admin chain) a new
 * co-applicant must have reached before the stage held by `roleSlug` may forward
 * the renewal: that role must have cleared the co-applicant itself. Custom roles
 * have no co-applicant stage of their own, so they aren't gated (final still is).
 */
export function getCoApplicantRequiredRank(roleSlug: string): number {
    switch (roleSlug) {
        case 'branch-manager': return 1;
        case 'area-manager': return 2;
        case 'quality-checkers':
        case 'background-verification-team': return 3;
        default: return 0;
    }
}
