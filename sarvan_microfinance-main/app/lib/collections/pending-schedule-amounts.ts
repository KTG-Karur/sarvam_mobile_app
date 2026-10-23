/**
 * Shared query helper: how much of each LoanSchedule's due amount is already
 * "reserved" by a PENDING (not yet approved, not rejected/reversed) collection
 * — regardless of which page created it, and regardless of how long it has
 * been awaiting Branch Manager approval. Every collection page's remaining-due
 * calculation must subtract this before showing/accepting a new collection,
 * so the same due can never be collected twice while a prior submission is
 * still awaiting approval. A REJECTED transaction naturally drops out of this
 * query (status is no longer 'PENDING'), so rejection restores availability
 * with no extra step needed.
 */

import type { Prisma } from '@prisma/client';
import { prisma } from '@/app/lib/prisma';

type AnyPrismaClient = typeof prisma | Prisma.TransactionClient;

export type PendingScheduleComponents = {
    principal: number;
    interest: number;
    fees: number;
    penalty: number;
    total: number;
};

export async function getPendingScheduleAmounts(
    scheduleIds: string[],
    /**
     * Optional cutoff: only counts PENDING lines with `transactionDate` strictly
     * before this. Used where a caller already separately accounts for today's
     * pending via its own today-scoped query (e.g. arrear/route.ts POST's
     * same-day cumulative-resubmission logic) and only needs this helper to add
     * netting for older, still-pending collections without double-counting
     * today's ones. Omit for the normal "net everything still pending" case.
     */
    opts?: { beforeDate?: Date; client?: AnyPrismaClient }
): Promise<Map<string, PendingScheduleComponents>> {
    const result = new Map<string, PendingScheduleComponents>();
    if (scheduleIds.length === 0) return result;

    const db = opts?.client ?? prisma;
    const lines = await db.loanTransactionLine.findMany({
        where: {
            scheduleId: { in: scheduleIds },
            transaction: {
                type: 'REPAYMENT',
                status: 'PENDING' as any,
                isReversed: false,
                ...(opts?.beforeDate ? { transactionDate: { lt: opts.beforeDate } } : {}),
            },
        },
        select: {
            scheduleId: true,
            principalAmount: true,
            interestAmount: true,
            feesAmount: true,
            penaltyAmount: true,
        },
    });

    for (const line of lines) {
        const prev = result.get(line.scheduleId) ?? { principal: 0, interest: 0, fees: 0, penalty: 0, total: 0 };
        const principal = prev.principal + Number(line.principalAmount || 0);
        const interest = prev.interest + Number(line.interestAmount || 0);
        const fees = prev.fees + Number(line.feesAmount || 0);
        const penalty = prev.penalty + Number(line.penaltyAmount || 0);
        result.set(line.scheduleId, {
            principal,
            interest,
            fees,
            penalty,
            total: principal + interest + fees + penalty,
        });
    }

    return result;
}
