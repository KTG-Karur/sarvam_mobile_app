import { Prisma, type CtcChangeSource } from '@prisma/client';

export type ApplyCtcChangeParams = {
    employeeId: string;
    newMonthlyCtc: number;
    source: CtcChangeSource;
    effectiveDate: Date;
    actorUserId: string;
    /** Only meaningful for source: 'PROMOTION' — links the history row back
     * to the promotion that caused it. */
    promotionId?: string;
};

/**
 * Upserts EmployeeCtcMaster and logs an EmployeeCtcHistory row — the single
 * place all three CTC entry points (Onboarding finalize, a direct
 * Organization-tab edit, an approved Promotion) apply a CTC change, so the
 * "record a change + keep history" logic exists exactly once. A no-op
 * (returns false, writes nothing) when newMonthlyCtc matches what's already
 * on file, so re-saving an unchanged figure doesn't spam the history log.
 */
export async function applyCtcChange(tx: Prisma.TransactionClient, params: ApplyCtcChangeParams): Promise<boolean> {
    const current = await tx.employeeCtcMaster.findUnique({
        where: { employeeId: params.employeeId },
        select: { monthlyCtc: true },
    });
    const fromMonthlyCtc = current ? Number(current.monthlyCtc) : null;
    if (fromMonthlyCtc === params.newMonthlyCtc) return false;

    await tx.employeeCtcMaster.upsert({
        where: { employeeId: params.employeeId },
        update: { monthlyCtc: params.newMonthlyCtc, updatedById: params.actorUserId },
        create: { employeeId: params.employeeId, monthlyCtc: params.newMonthlyCtc, updatedById: params.actorUserId },
    });
    await tx.employeeCtcHistory.create({
        data: {
            employeeId: params.employeeId,
            fromMonthlyCtc,
            toMonthlyCtc: params.newMonthlyCtc,
            effectiveDate: params.effectiveDate,
            source: params.source,
            promotionId: params.promotionId,
            changedById: params.actorUserId,
        },
    });
    return true;
}
