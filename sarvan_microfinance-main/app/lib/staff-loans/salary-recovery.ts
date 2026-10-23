import { randomUUID } from 'crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '@/app/lib/db';
import { getKolkataMonthBounds } from '@/app/lib/attendance-leave-permission';
import { allocateAcrossSchedules } from './allocation';

type Db = PrismaClient | Prisma.TransactionClient;

const scheduleWithAllocations = {
    orderBy: { installmentNo: 'asc' as const },
    include: {
        allocations: {
            where: { transaction: { status: 'POSTED' as const } },
            select: { principal: true, interest: true },
        },
    },
} satisfies Prisma.StaffLoan$schedulesArgs;

export type SalaryRecoveryLoanDue = {
    loanId: string;
    loanNumber: string;
    scheduleId: string;
    installmentNo: number;
    principal: number;
    interest: number;
    amount: number;
    dueDate: string;
};

/**
 * For each of the employee's ACTIVE staff loans with recoveryMethod=SALARY,
 * finds the single next unpaid StaffLoanSchedule installment (oldest first)
 * whose dueDate falls on/before the selected payroll month's end — this is
 * "the month's due EMI" the Payroll excel sheet's STAFF LOAN column captures,
 * not a catch-up of every overdue installment at once. An employee can hold
 * more than one active SALARY-recovery loan, so this returns one row per
 * loan plus the combined total.
 */
export async function getSalaryRecoveryDue(employeeId: string, month: number, year: number, db: Db = prisma) {
    const { monthEndExclusiveUtc } = getKolkataMonthBounds({ month, year });
    const monthEnd = new Date(monthEndExclusiveUtc.getTime() - 1);

    const loans = await db.staffLoan.findMany({
        where: { employeeId, status: 'ACTIVE', recoveryMethod: 'SALARY' },
        select: {
            id: true, loanNumber: true,
            schedules: { ...scheduleWithAllocations, where: { dueDate: { lte: monthEnd } } },
        },
    });

    const breakdown: SalaryRecoveryLoanDue[] = [];
    for (const loan of loans) {
        const nextUnpaid = loan.schedules.find(s => {
            const pPaid = s.allocations.reduce((acc, a) => acc.plus(a.principal), new Prisma.Decimal(0));
            const iPaid = s.allocations.reduce((acc, a) => acc.plus(a.interest), new Prisma.Decimal(0));
            const pRem = new Prisma.Decimal(s.principalDue).minus(pPaid);
            const iRem = new Prisma.Decimal(s.interestDue).minus(iPaid);
            return pRem.plus(iRem).greaterThan(0.001);
        });
        if (!nextUnpaid) continue;

        const pPaid = nextUnpaid.allocations.reduce((acc, a) => acc.plus(a.principal), new Prisma.Decimal(0));
        const iPaid = nextUnpaid.allocations.reduce((acc, a) => acc.plus(a.interest), new Prisma.Decimal(0));
        const principal = Prisma.Decimal.max(0, new Prisma.Decimal(nextUnpaid.principalDue).minus(pPaid));
        const interest = Prisma.Decimal.max(0, new Prisma.Decimal(nextUnpaid.interestDue).minus(iPaid));

        breakdown.push({
            loanId: loan.id,
            loanNumber: loan.loanNumber,
            scheduleId: nextUnpaid.id,
            installmentNo: nextUnpaid.installmentNo,
            principal: principal.toNumber(),
            interest: interest.toNumber(),
            amount: principal.plus(interest).toNumber(),
            dueDate: nextUnpaid.dueDate.toISOString().split('T')[0],
        });
    }

    return { totalAmount: breakdown.reduce((sum, b) => sum + b.amount, 0), breakdown };
}

/**
 * Submit-time posting (inside the caller's payroll $transaction): re-derives
 * the due amount from schedules again (never trusts a client-supplied
 * figure), and for each loan with a nonzero due amount creates a PENDING
 * SALARY_RECOVERY StaffLoanTransaction + allocation against that one
 * schedule row. PENDING transactions are excluded from every "outstanding"
 * calculation elsewhere in the staff-loan module (allocations filter
 * `transaction: { status: 'POSTED' }`), so this is safe to write before the
 * payroll run is actually approved/paid — it only becomes real recovery once
 * markSalaryRecoveryPosted flips it to POSTED at Mark-Paid time.
 */
export async function postSalaryRecoveryForPayroll(
    tx: Prisma.TransactionClient,
    actorUserId: string,
    employeeId: string,
    month: number,
    year: number,
    salaryPayRecordId: string,
) {
    const { breakdown } = await getSalaryRecoveryDue(employeeId, month, year, tx);
    const transactionIds: string[] = [];

    for (const due of breakdown) {
        if (due.amount <= 0) continue;
        const txRecord = await tx.staffLoanTransaction.create({
            data: {
                loanId: due.loanId,
                type: 'SALARY_RECOVERY',
                status: 'PENDING',
                transactionDate: new Date(Date.UTC(year, month - 1, 1)),
                amount: due.amount,
                salaryPayRecordId,
                remarks: `Payroll ${month}/${year} — installment #${due.installmentNo}`,
                idempotencyKey: `SALREC-${due.loanId}-${salaryPayRecordId}-${randomUUID()}`,
                createdById: actorUserId,
            },
        });
        await allocateAcrossSchedules(tx, due.loanId, [{
            id: due.scheduleId,
            principalDue: due.principal,
            interestDue: due.interest,
            allocations: [],
        }], txRecord.id, new Prisma.Decimal(due.amount));
        transactionIds.push(txRecord.id);
    }

    return { totalAmount: breakdown.reduce((sum, b) => sum + b.amount, 0), transactionIds };
}

/**
 * Mark-Paid time: flips every PENDING SALARY_RECOVERY transaction tied to
 * this payroll record to POSTED, then re-evaluates each affected loan's
 * total outstanding (now counting the newly-POSTED allocations) to decide
 * ACTIVE vs CLOSED, bumping StaffLoan.version — mirrors the close logic in
 * application-service.ts's recordRepayment.
 */
export async function markSalaryRecoveryPosted(tx: Prisma.TransactionClient, salaryPayRecordId: string) {
    const pending = await tx.staffLoanTransaction.findMany({
        where: { salaryPayRecordId, type: 'SALARY_RECOVERY', status: 'PENDING' },
        select: { id: true, loanId: true },
    });
    if (!pending.length) return;

    await tx.staffLoanTransaction.updateMany({
        where: { id: { in: pending.map(p => p.id) } },
        data: { status: 'POSTED', postedAt: new Date() },
    });

    const loanIds = [...new Set(pending.map(p => p.loanId))];
    for (const loanId of loanIds) {
        const loan = await tx.staffLoan.findUnique({
            where: { id: loanId },
            select: { version: true, status: true, schedules: { ...scheduleWithAllocations } },
        });
        if (!loan || loan.status !== 'ACTIVE') continue;

        let outstanding = new Prisma.Decimal(0);
        for (const s of loan.schedules) {
            const pPaid = s.allocations.reduce((acc, a) => acc.plus(a.principal), new Prisma.Decimal(0));
            const iPaid = s.allocations.reduce((acc, a) => acc.plus(a.interest), new Prisma.Decimal(0));
            outstanding = outstanding
                .plus(Prisma.Decimal.max(0, new Prisma.Decimal(s.principalDue).minus(pPaid)))
                .plus(Prisma.Decimal.max(0, new Prisma.Decimal(s.interestDue).minus(iPaid)));
        }
        const isClosed = outstanding.lessThanOrEqualTo(0.01);
        await tx.staffLoan.update({
            where: { id: loanId },
            data: {
                status: isClosed ? 'CLOSED' : 'ACTIVE',
                closedAt: isClosed ? new Date() : null,
                version: { increment: 1 },
            },
        });
    }
}
