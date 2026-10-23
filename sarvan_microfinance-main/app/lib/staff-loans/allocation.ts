import { Prisma } from '@prisma/client';

export type AllocatableSchedule = {
    id: string;
    principalDue: Prisma.Decimal | number | string;
    interestDue: Prisma.Decimal | number | string;
    /** Interest an early settlement waived for this installment; not owed and not paid. */
    interestWaived?: Prisma.Decimal | number | string | null;
    allocations: { principal: Prisma.Decimal | number | string; interest: Prisma.Decimal | number | string }[];
};

/**
 * Walks schedules oldest-installment-first, allocating a payment amount
 * across principal/interest per schedule (interest first, then principal)
 * until the amount is exhausted or every schedule row is fully paid.
 * Extracted from application-service.ts's recordRepayment so a manual
 * CASH_BANK_RECOVERY collection and an automatic payroll SALARY_RECOVERY
 * posting (app/lib/payroll/salary-recovery.ts) apply money to schedules
 * identically. Interest-first is the only policy this system uses — the
 * previously-dead PRINCIPAL_FIRST branch was dropped in this extraction.
 */
export async function allocateAcrossSchedules(
    tx: Prisma.TransactionClient,
    loanId: string,
    schedules: AllocatableSchedule[],
    transactionId: string,
    amount: Prisma.Decimal,
): Promise<void> {
    let remaining = new Prisma.Decimal(amount);
    for (const s of schedules) {
        if (remaining.lessThanOrEqualTo(0)) break;
        const pDue = new Prisma.Decimal(s.principalDue);
        const iDue = new Prisma.Decimal(s.interestDue);
        const pPaid = s.allocations.reduce((acc, a) => acc.plus(a.principal), new Prisma.Decimal(0));
        const iPaid = s.allocations.reduce((acc, a) => acc.plus(a.interest), new Prisma.Decimal(0));
        const pRem = Prisma.Decimal.max(0, pDue.minus(pPaid));
        const iRem = Prisma.Decimal.max(0, iDue.minus(iPaid).minus(s.interestWaived ?? 0));
        if (pRem.lessThanOrEqualTo(0) && iRem.lessThanOrEqualTo(0)) continue;

        const iAlloc = Prisma.Decimal.min(iRem, remaining);
        remaining = remaining.minus(iAlloc);
        const pAlloc = Prisma.Decimal.min(pRem, remaining);
        remaining = remaining.minus(pAlloc);

        if (pAlloc.greaterThan(0) || iAlloc.greaterThan(0)) {
            await tx.staffLoanRepaymentAllocation.create({
                data: { loanId, transactionId, scheduleId: s.id, principal: pAlloc, interest: iAlloc },
            });
        }
    }
}

/** Total outstanding (principal + interest) across a loan's schedules, given
 * each schedule row's POSTED allocations. Shared by recordRepayment and the
 * payroll salary-recovery due-amount calculation. */
export function totalOutstanding(schedules: AllocatableSchedule[]): { principal: Prisma.Decimal; interest: Prisma.Decimal; total: Prisma.Decimal } {
    let principal = new Prisma.Decimal(0);
    let interest = new Prisma.Decimal(0);
    for (const s of schedules) {
        const pPaid = s.allocations.reduce((acc, a) => acc.plus(a.principal), new Prisma.Decimal(0));
        const iPaid = s.allocations.reduce((acc, a) => acc.plus(a.interest), new Prisma.Decimal(0));
        principal = principal.plus(Prisma.Decimal.max(0, new Prisma.Decimal(s.principalDue).minus(pPaid)));
        interest = interest.plus(Prisma.Decimal.max(0, new Prisma.Decimal(s.interestDue).minus(iPaid).minus(s.interestWaived ?? 0)));
    }
    return { principal, interest, total: principal.plus(interest) };
}
