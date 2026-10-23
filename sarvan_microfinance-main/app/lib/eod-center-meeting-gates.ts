import type { Prisma } from '@prisma/client';

/**
 * EOD checklist code 5 — scheduled center meetings vs activity.
 *
 * Demand-side repayment definition matches demand sheet / DCB:
 * @see app/lib/actions/demand.ts — `demandSheetCollectionTypeWhere`
 * (`Demand Collection`, or legacy null / empty — excludes "Non Demand Collection").
 */

const COLLECTION_TYPE_DEMAND = 'Demand Collection' as const;

/** Repayment rows that count as demand collection for EOD meeting checks. */
export function eodDemandRepaymentCollectionTypeWhere(): Prisma.LoanTransactionWhereInput {
    return {
        type: 'REPAYMENT',
        isReversed: false,
        OR: [
            { collectionType: COLLECTION_TYPE_DEMAND },
            { collectionType: null },
            { collectionType: '' },
        ],
    };
}

export type EodScheduledCenterForMeeting = {
    id: string;
    fdoId: string | null;
};

/**
 * User IDs with branch attendance marked present (PRESENT or HALF_DAY) for the EOD attendance window.
 */
export function buildFdoMarkedPresentUserIds(
    attendanceRecords: ReadonlyArray<{ userId: string; status: string }>
): Set<string> {
    const present = new Set<string>();
    for (const r of attendanceRecords) {
        if (r.status === 'PRESENT' || r.status === 'HALF_DAY') {
            present.add(r.userId);
        }
    }
    return present;
}

export type EodCenterMeetingEvaluationInput = {
    zeroRepaymentDay: boolean;
    scheduledCenters: ReadonlyArray<EodScheduledCenterForMeeting>;
    centersWithAnyTxn: ReadonlySet<string>;
    centersWithDemandRepayment: ReadonlySet<string>;
    fdoMarkedPresentUserIds: ReadonlySet<string>;
};

/**
 * - If assigned FDO is marked present: pending when no demand collection posted for that center today.
 * - If no FDO or FDO not marked present: legacy rule — pending when no loan activity at that center today.
 */
export function evaluateEodCenterMeeting(
    input: EodCenterMeetingEvaluationInput
): {
    issue: boolean;
    missedMeetingsCount: number;
    fdoPresentNoDemandCount: number;
    legacyNoActivityCount: number;
    details: string;
} {
    if (input.zeroRepaymentDay) {
        return {
            issue: false,
            missedMeetingsCount: 0,
            fdoPresentNoDemandCount: 0,
            legacyNoActivityCount: 0,
            details:
                'No repayments branch-wide for this day — center meeting check is not applied (use denomination ₹0 path if applicable).',
        };
    }

    if (input.scheduledCenters.length === 0) {
        return {
            issue: false,
            missedMeetingsCount: 0,
            fdoPresentNoDemandCount: 0,
            legacyNoActivityCount: 0,
            details: 'No centers have a meeting scheduled on this branch calendar weekday.',
        };
    }

    let fdoPresentNoDemandCount = 0;
    let legacyNoActivityCount = 0;

    for (const c of input.scheduledCenters) {
        const hasDemand = input.centersWithDemandRepayment.has(c.id);
        const hasAny = input.centersWithAnyTxn.has(c.id);
        const fdoId = c.fdoId;
        const fdoPresent = fdoId != null && input.fdoMarkedPresentUserIds.has(fdoId);

        if (fdoId != null && fdoPresent) {
            if (!hasDemand) {
                fdoPresentNoDemandCount += 1;
            }
        } else if (!hasAny) {
            legacyNoActivityCount += 1;
        }
    }

    const missedMeetingsCount = fdoPresentNoDemandCount + legacyNoActivityCount;
    if (missedMeetingsCount === 0) {
        return {
            issue: false,
            missedMeetingsCount: 0,
            fdoPresentNoDemandCount: 0,
            legacyNoActivityCount: 0,
            details: 'All scheduled centers have demand collection (FDO present) or recorded activity (other cases).',
        };
    }

    const parts: string[] = [];
    if (fdoPresentNoDemandCount > 0) {
        parts.push(
            `${fdoPresentNoDemandCount} center(s): assigned FDO marked present but no demand collection posted for the center today.`
        );
    }
    if (legacyNoActivityCount > 0) {
        parts.push(
            `${legacyNoActivityCount} center(s): no assigned FDO / FDO not marked present, and no loan activity recorded for the center today.`
        );
    }

    return {
        issue: true,
        missedMeetingsCount,
        fdoPresentNoDemandCount,
        legacyNoActivityCount,
        details: parts.join(' '),
    };
}

/** Whether this scheduled center counts as an EOD meeting issue (same rules as `evaluateEodCenterMeeting`). */
export function isScheduledCenterMeetingPendingForEod(
    center: EodScheduledCenterForMeeting,
    input: Omit<EodCenterMeetingEvaluationInput, 'scheduledCenters'>
): boolean {
    if (input.zeroRepaymentDay) {
        return false;
    }
    const hasDemand = input.centersWithDemandRepayment.has(center.id);
    const hasAny = input.centersWithAnyTxn.has(center.id);
    const fdoId = center.fdoId;
    const fdoPresent = fdoId != null && input.fdoMarkedPresentUserIds.has(fdoId);

    if (fdoId != null && fdoPresent) {
        return !hasDemand;
    }
    return !hasAny;
}
