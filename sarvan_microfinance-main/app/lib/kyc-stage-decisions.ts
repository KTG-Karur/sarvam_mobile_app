import type { KYCDocumentDecision, Prisma } from '@prisma/client';
import { prisma } from '@/app/lib/prisma';
import type { WorkflowStage } from '@/app/lib/workflow-config';

/**
 * Per-KYC-document decisions for the client approval workflow — the single
 * place that knows WHERE a stage's decision is stored:
 *
 *  - branch-manager / area-manager / quality-checkers → the built-in
 *    bm* / am* / qc* columns on KYC (other screens — tracker, FDO recheck,
 *    renewal — read those columns directly, so they stay the source of truth).
 *  - any other role → a KycStageReview row keyed by (kycId, roleSlug);
 *    a missing row means PENDING.
 *
 * Decisions are keyed by ROLE, never by level/status, so a reordered workflow
 * (QC → BM → AM, or a custom role at any level) reviews into the right slot.
 */

type BuiltinColumns = {
    decision: 'bmDecision' | 'amDecision' | 'qcDecision';
    remark: 'bmRemark' | 'amRemark' | 'qcRemark';
    reviewerId: 'bmReviewerId' | 'amReviewerId' | 'qcReviewerId';
    reviewedAt: 'bmReviewedAt' | 'amReviewedAt' | 'qcReviewedAt';
    reviewer: 'bmReviewer' | 'amReviewer' | 'qcReviewer';
    /** Short label used by the legacy BM/AM/QC audit actions. */
    auditPrefix: 'BM' | 'AM' | 'QC';
};

const BM: BuiltinColumns = { decision: 'bmDecision', remark: 'bmRemark', reviewerId: 'bmReviewerId', reviewedAt: 'bmReviewedAt', reviewer: 'bmReviewer', auditPrefix: 'BM' };
const AM: BuiltinColumns = { decision: 'amDecision', remark: 'amRemark', reviewerId: 'amReviewerId', reviewedAt: 'amReviewedAt', reviewer: 'amReviewer', auditPrefix: 'AM' };
const QC: BuiltinColumns = { decision: 'qcDecision', remark: 'qcRemark', reviewerId: 'qcReviewerId', reviewedAt: 'qcReviewedAt', reviewer: 'qcReviewer', auditPrefix: 'QC' };

const BUILTIN_COLUMNS: Record<string, BuiltinColumns> = {
    'branch-manager': BM,
    'area-manager': AM,
    'quality-checkers': QC,
    'background-verification-team': QC, // legacy slug alias
};

export function getBuiltinColumns(roleSlug: string): BuiltinColumns | null {
    return BUILTIN_COLUMNS[roleSlug] ?? null;
}

const reviewerSelect = { select: { firstName: true, lastName: true, employeeId: true } } as const;

/** Prisma `select` fragment for a KYC row — everything stage-decision lookups need. */
export const KYC_STAGE_DECISION_SELECT = {
    bmDecision: true, bmRemark: true, bmReviewedAt: true, bmReviewer: reviewerSelect,
    amDecision: true, amRemark: true, amReviewedAt: true, amReviewer: reviewerSelect,
    qcDecision: true, qcRemark: true, qcReviewedAt: true, qcReviewer: reviewerSelect,
    stageReviews: {
        select: { roleSlug: true, decision: true, remark: true, reviewedAt: true, reviewer: reviewerSelect },
    },
} satisfies Prisma.KYCSelect;

type ReviewerRef = { firstName: string; lastName: string; employeeId: string | null } | null;

/** Loose shape — any KYC row selected with (a subset of) KYC_STAGE_DECISION_SELECT. */
export type KycWithStageDecisions = {
    bmDecision?: KYCDocumentDecision | string | null;
    amDecision?: KYCDocumentDecision | string | null;
    qcDecision?: KYCDocumentDecision | string | null;
    stageReviews?: Array<{
        roleSlug: string;
        decision: KYCDocumentDecision | string;
        remark?: string | null;
        reviewedAt?: Date | string | null;
        reviewer?: ReviewerRef;
    }>;
    [key: string]: unknown;
};

export type StageDecision = {
    decision: string;
    remark: string | null;
    reviewedAt: Date | string | null;
    reviewer: ReviewerRef;
};

/** This document's decision for the stage held by `roleSlug` (PENDING when never reviewed). */
export function getStageDecision(doc: KycWithStageDecisions, roleSlug: string): StageDecision {
    const cols = getBuiltinColumns(roleSlug);
    if (cols) {
        return {
            decision: (doc[cols.decision] as string | null | undefined) ?? 'PENDING',
            remark: (doc[cols.remark] as string | null | undefined) ?? null,
            reviewedAt: (doc[cols.reviewedAt] as Date | string | null | undefined) ?? null,
            reviewer: (doc[cols.reviewer] as ReviewerRef | undefined) ?? null,
        };
    }
    const row = doc.stageReviews?.find(r => r.roleSlug === roleSlug);
    return {
        decision: row?.decision ?? 'PENDING',
        remark: row?.remark ?? null,
        reviewedAt: row?.reviewedAt ?? null,
        reviewer: row?.reviewer ?? null,
    };
}

/** Per-stage decisions for every configured stage, in level order (for UI chips/trails). */
export function getAllStageDecisions(doc: KycWithStageDecisions, stages: WorkflowStage[]) {
    return stages.map(s => ({
        levelOrder: s.levelOrder,
        roleSlug: s.roleSlug,
        stageName: s.stageName,
        ...getStageDecision(doc, s.roleSlug),
    }));
}

/**
 * The first stage (in workflow order) that has this document flagged
 * RETAKE_REQUIRED — or, with no workflow configured, BM/AM/QC in that order.
 */
export function findRetakeFlag(
    doc: KycWithStageDecisions,
    stages: WorkflowStage[] | null
): { roleSlug: string; stageName: string; remark: string | null } | null {
    const order = stages && stages.length > 0
        ? stages.map(s => ({ roleSlug: s.roleSlug, stageName: s.stageName }))
        : [
            { roleSlug: 'branch-manager', stageName: 'BM' },
            { roleSlug: 'area-manager', stageName: 'AM' },
            { roleSlug: 'quality-checkers', stageName: 'QC' },
        ];
    for (const s of order) {
        const d = getStageDecision(doc, s.roleSlug);
        if (d.decision === 'RETAKE_REQUIRED') return { ...s, remark: d.remark };
    }
    // A custom-role row not in the current config (workflow edited since) still counts.
    const orphan = doc.stageReviews?.find(r => r.decision === 'RETAKE_REQUIRED');
    return orphan ? { roleSlug: orphan.roleSlug, stageName: orphan.roleSlug, remark: orphan.remark ?? null } : null;
}

export function hasAnyRetakeFlag(doc: KycWithStageDecisions): boolean {
    return doc.bmDecision === 'RETAKE_REQUIRED'
        || doc.amDecision === 'RETAKE_REQUIRED'
        || doc.qcDecision === 'RETAKE_REQUIRED'
        || !!doc.stageReviews?.some(r => r.decision === 'RETAKE_REQUIRED');
}

type Tx = Prisma.TransactionClient;

/** Records `decision` for the stage held by `roleSlug` on one document. */
export async function writeStageDecision(
    tx: Tx,
    params: {
        kycId: string;
        roleSlug: string;
        decision: KYCDocumentDecision;
        remark: string | null;
        reviewerId: string;
        reviewedAt: Date;
        /** Extra KYC columns to set in the same update (status, isDeleted, retakeReason, …). */
        kycExtra?: Prisma.KYCUncheckedUpdateInput;
    }
): Promise<void> {
    const { kycId, roleSlug, decision, remark, reviewerId, reviewedAt, kycExtra } = params;
    const cols = getBuiltinColumns(roleSlug);
    if (cols) {
        await tx.kYC.update({
            where: { id: kycId },
            data: {
                ...kycExtra,
                [cols.decision]: decision,
                [cols.remark]: remark,
                [cols.reviewerId]: reviewerId,
                [cols.reviewedAt]: reviewedAt,
            },
        });
        return;
    }
    await tx.kycStageReview.upsert({
        where: { kycId_roleSlug: { kycId, roleSlug } },
        create: { kycId, roleSlug, decision, remark, reviewerId, reviewedAt },
        update: { decision, remark, reviewerId, reviewedAt },
    });
    if (kycExtra && Object.keys(kycExtra).length > 0) {
        await tx.kYC.update({ where: { id: kycId }, data: kycExtra });
    }
}

/**
 * Full restart (FDO resubmits after a retake): every stage re-reviews every
 * document from scratch — built-in columns and custom-role rows alike.
 * Returned as batch operations for an array-form prisma.$transaction.
 */
export function buildResetAllStageDecisionsOps(clientId: string) {
    return [
        prisma.kYC.updateMany({
            where: { clientId, isDeleted: false, loanId: null },
            data: {
                bmDecision: 'PENDING', bmRemark: null, bmReviewerId: null, bmReviewedAt: null,
                amDecision: 'PENDING', amRemark: null, amReviewerId: null, amReviewedAt: null,
                qcDecision: 'PENDING', qcRemark: null, qcReviewerId: null, qcReviewedAt: null,
                retakeReason: null,
            },
        }),
        prisma.kycStageReview.deleteMany({
            where: { kyc: { clientId, isDeleted: false, loanId: null } },
        }),
    ];
}

/**
 * Client-level "reviewed by" columns for a built-in stage (shown in the Approval
 * Trail). Custom-role stages have no such columns — their trail comes from
 * ClientApprovalHistory (LEVEL_* actions carry the stage in newState).
 */
export function getClientReviewerFields(
    roleSlug: string,
    userId: string,
    at: Date,
    remarks: string | null
): Record<string, string | Date | null> {
    switch (getBuiltinColumns(roleSlug)?.auditPrefix) {
        case 'BM': return { bmReviewedById: userId, bmReviewedAt: at, bmRemarks: remarks };
        case 'AM': return { amReviewedById: userId, amReviewedAt: at, amRemarks: remarks };
        case 'QC': return { qcVerifiedById: userId, qcVerifiedAt: at, qcRemarks: remarks };
        default: return {};
    }
}

/** Audit action for a per-document decision by the stage held by `roleSlug`. */
export function getDocumentAuditAction(roleSlug: string, decision: KYCDocumentDecision): string {
    const prefix = getBuiltinColumns(roleSlug)?.auditPrefix ?? 'LEVEL';
    switch (decision) {
        case 'DELETED': return `${prefix}_DELETED_DOCUMENT`;
        case 'RETAKE_REQUIRED': return `${prefix}_RETAKE_DOCUMENT`;
        case 'REJECTED': return `${prefix}_REJECTED_DOCUMENT`;
        default: return `${prefix}_VERIFIED_DOCUMENT`;
    }
}
