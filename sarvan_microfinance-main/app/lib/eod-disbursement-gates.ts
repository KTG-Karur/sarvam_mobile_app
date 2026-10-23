import type { Prisma } from '@prisma/client';

/**
 * EOD checklist code 8 — loan indexation & disbursement pipeline.
 *
 * Unindexed predicate aligned with:
 * @see app/api/loan-indexes/route.ts (POST selected loans)
 * @see app/api/loan-indexes/unindexed-loans/route.ts
 */

export function indexedTodayUndisbursedWhere(
    branchId: string,
    dayStartUtc: Date,
    dayEndExclusiveUtc: Date
): Prisma.LoanWhereInput {
    return {
        branchId,
        indexId: { not: null },
        loanIndex: {
            indexDate: { gte: dayStartUtc, lt: dayEndExclusiveUtc },
            isActive: true,
        },
        disbursementStatus: { not: 'DISBURSED' },
        isActive: true,
    };
}

/** Loans eligible for index creation but still `indexId` null (branch-wide backlog). */
export function unindexedEligibleForIndexationWhere(branchId: string): Prisma.LoanWhereInput {
    return {
        branchId,
        isActive: true,
        indexId: null,
        applicationStatus: { in: ['VERIFIED', 'PENDING_VERIFICATION'] },
        // Excludes backup/legacy-imported loans (uploan import) — those are created with
        // indexId null but disbursementStatus DISBURSED, since they skip the live
        // indexation workflow entirely (see backup-loan.service.ts createLoanRecord).
        disbursementStatus: { not: 'DISBURSED' },
    };
}

export type EodDisbursementGateInput = {
    indexedTodayUndisbursedCount: number;
    unindexedPipelineCount: number;
    disbursedTodayCount: number;
};

export function evaluateEodDisbursementChecklist(
    input: EodDisbursementGateInput
): { issue: boolean; details: string } {
    const { indexedTodayUndisbursedCount, unindexedPipelineCount, disbursedTodayCount } = input;

    // Business rule:
    // EOD (Code 8) blocks only on *indexation* pending items.
    // Once a loan is indexed, the remaining BM/AM approval/disbursement workflow
    // must NOT block EOD.
    const issue = unindexedPipelineCount > 0;

    if (!issue) {
        const cleared = 'Indexation pipeline is clear.';
        return {
            issue: false,
            details:
                disbursedTodayCount > 0
                    ? `${disbursedTodayCount} loan(s) disbursed on this branch day. ${cleared}`
                    : `No loans disbursed on this branch day. ${cleared}`,
        };
    }

    const parts: string[] = [];
    if (unindexedPipelineCount > 0) {
        parts.push(
            `${unindexedPipelineCount} unindexed loan(s) awaiting indexation (verified or pending verification).`
        );
    }
    // Keep this as non-blocking context for operators.
    if (indexedTodayUndisbursedCount > 0) {
        parts.push(`${indexedTodayUndisbursedCount} loan(s) were indexed today and are not yet disbursed (non-blocking).`);
    }
    return { issue: true, details: parts.join(' ') };
}
