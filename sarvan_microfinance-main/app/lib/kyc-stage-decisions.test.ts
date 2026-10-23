import { describe, expect, it, vi } from 'vitest';

vi.mock('@/app/lib/prisma', () => ({ prisma: {} }));

import {
    findRetakeFlag,
    getAllStageDecisions,
    getClientReviewerFields,
    getDocumentAuditAction,
    getStageDecision,
    hasAnyRetakeFlag,
} from './kyc-stage-decisions';
import {
    getAllStageRetakeStatuses,
    getAllStageStatuses,
    getPendingStatusForStage,
    getStageForStatus,
    userHoldsStage,
    type WorkflowStage,
} from './workflow-config';

// QC → BM → custom "credit-officer" — the reordered + custom-role case.
const STAGES: WorkflowStage[] = [
    { levelOrder: 1, roleSlug: 'quality-checkers', stageName: 'QC Check' },
    { levelOrder: 2, roleSlug: 'branch-manager', stageName: 'BM Approval' },
    { levelOrder: 3, roleSlug: 'credit-officer', stageName: 'Credit Review' },
];

describe('workflow stage resolution', () => {
    it('SUBMITTED belongs to the first configured stage, whoever holds it', () => {
        expect(getStageForStatus('SUBMITTED', STAGES)?.roleSlug).toBe('quality-checkers');
    });

    it('built-in roles keep their named statuses at any level; custom roles use the level status', () => {
        expect(getPendingStatusForStage(STAGES[1])).toBe('PENDING_BM_REVIEW');
        expect(getPendingStatusForStage(STAGES[2])).toBe('PENDING_LEVEL_3');
        expect(getStageForStatus('PENDING_BM_REVIEW', STAGES)?.levelOrder).toBe(2);
        expect(getStageForStatus('PENDING_LEVEL_3', STAGES)?.roleSlug).toBe('credit-officer');
        expect(getStageForStatus('LEVEL_3_RETAKE_REQUIRED', STAGES)?.roleSlug).toBe('credit-officer');
    });

    it('statuses with no configured stage resolve to null', () => {
        expect(getStageForStatus('PENDING_AM_REVIEW', STAGES)).toBeNull();
        expect(getStageForStatus('PENDING_FINAL_REVIEW', STAGES)).toBeNull();
    });

    it('lists every in-chain and retake status for the config', () => {
        expect(getAllStageStatuses(STAGES)).toEqual(expect.arrayContaining([
            'SUBMITTED', 'PENDING_QC_VERIFICATION', 'QC_VERIFICATION_RETAKE_REQUIRED',
            'PENDING_BM_REVIEW', 'BM_RETAKE_REQUIRED', 'PENDING_LEVEL_3', 'LEVEL_3_RETAKE_REQUIRED',
        ]));
        expect(getAllStageRetakeStatuses(STAGES)).toEqual([
            'QC_VERIFICATION_RETAKE_REQUIRED', 'BM_RETAKE_REQUIRED', 'LEVEL_3_RETAKE_REQUIRED',
        ]);
    });

    it('treats background-verification-team as the quality-checkers alias', () => {
        const legacy: WorkflowStage = { levelOrder: 1, roleSlug: 'background-verification-team', stageName: 'BVT' };
        expect(userHoldsStage(legacy, new Set(['quality-checkers']))).toBe(true);
        expect(userHoldsStage(STAGES[2], new Set(['quality-checkers']))).toBe(false);
    });
});

describe('per-document stage decisions', () => {
    const doc = {
        bmDecision: 'VERIFIED', amDecision: 'PENDING', qcDecision: 'VERIFIED',
        stageReviews: [{ roleSlug: 'credit-officer', decision: 'RETAKE_REQUIRED', remark: 'blurry', reviewedAt: null, reviewer: null }],
    };

    it('reads built-in roles from their columns and custom roles from stage rows', () => {
        expect(getStageDecision(doc, 'branch-manager').decision).toBe('VERIFIED');
        expect(getStageDecision(doc, 'background-verification-team').decision).toBe('VERIFIED');
        expect(getStageDecision(doc, 'credit-officer')).toMatchObject({ decision: 'RETAKE_REQUIRED', remark: 'blurry' });
    });

    it('a custom role with no row yet is PENDING', () => {
        expect(getStageDecision(doc, 'zonal-head').decision).toBe('PENDING');
    });

    it('returns decisions for every configured stage in level order', () => {
        expect(getAllStageDecisions(doc, STAGES).map(d => [d.stageName, d.decision])).toEqual([
            ['QC Check', 'VERIFIED'], ['BM Approval', 'VERIFIED'], ['Credit Review', 'RETAKE_REQUIRED'],
        ]);
    });

    it('detects retake flags from custom-role rows too', () => {
        expect(hasAnyRetakeFlag(doc)).toBe(true);
        expect(findRetakeFlag(doc, STAGES)).toMatchObject({ roleSlug: 'credit-officer', stageName: 'Credit Review', remark: 'blurry' });
        expect(hasAnyRetakeFlag({ bmDecision: 'VERIFIED', amDecision: 'PENDING', qcDecision: 'PENDING', stageReviews: [] })).toBe(false);
    });

    it('built-in stages keep BM/AM/QC audit actions and reviewer columns; custom stages use LEVEL_*', () => {
        expect(getDocumentAuditAction('quality-checkers', 'VERIFIED')).toBe('QC_VERIFIED_DOCUMENT');
        expect(getDocumentAuditAction('credit-officer', 'RETAKE_REQUIRED')).toBe('LEVEL_RETAKE_DOCUMENT');
        const at = new Date('2026-10-01T00:00:00Z');
        expect(getClientReviewerFields('quality-checkers', 'u1', at, 'ok')).toEqual({ qcVerifiedById: 'u1', qcVerifiedAt: at, qcRemarks: 'ok' });
        expect(getClientReviewerFields('credit-officer', 'u1', at, 'ok')).toEqual({});
    });
});
