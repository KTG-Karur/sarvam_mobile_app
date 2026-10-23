import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '@/app/lib/db';
import { getKolkataMonthBounds } from '@/app/lib/attendance-leave-permission';

/**
 * Payroll integration for Staff Advance: the second (and only) way an advance is repaid is a salary
 * deduction. Mirrors the Staff Loan salary recovery: the payroll preview/save derive the month's due
 * amount from the schedule (never from the client), submit writes PENDING transactions that do not yet
 * count as repaid, and Mark Paid flips them to POSTED, which is what updates the advance.
 */

type Db = PrismaClient | Prisma.TransactionClient;

export type SalaryRecoveryAdvanceDue = {
    advanceId: string;
    advanceNumber: string;
    scheduleId: string;
    installmentNo: number;
    amount: number;
    dueDate: string;
};

const dec = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);

/**
 * For each ACTIVE advance, the single next unpaid installment whose due date falls on or before the end
 * of the payroll month (one installment per advance per month, oldest first, never a catch-up of both).
 */
export async function getAdvanceRecoveryDue(employeeId: string, month: number, year: number, db: Db = prisma) {
    const { monthEndExclusiveUtc } = getKolkataMonthBounds({ month, year });
    const monthEnd = new Date(monthEndExclusiveUtc.getTime() - 1);

    const advances = await db.staffAdvance.findMany({
        where: { employeeId, status: 'ACTIVE' },
        select: {
            id: true, advanceNumber: true,
            schedules: {
                where: { dueDate: { lte: monthEnd } },
                orderBy: { installmentNo: 'asc' },
                include: { allocations: { where: { transaction: { status: 'POSTED' } }, select: { amount: true } } },
            },
        },
    });

    const breakdown: SalaryRecoveryAdvanceDue[] = [];
    for (const advance of advances) {
        for (const schedule of advance.schedules) {
            const paid = schedule.allocations.reduce((sum, a) => sum.plus(a.amount), dec(0));
            const remaining = dec(schedule.amountDue).minus(paid);
            if (remaining.lessThanOrEqualTo(0.001)) continue;
            breakdown.push({
                advanceId: advance.id,
                advanceNumber: advance.advanceNumber,
                scheduleId: schedule.id,
                installmentNo: schedule.installmentNo,
                amount: remaining.toNumber(),
                dueDate: schedule.dueDate.toISOString().split('T')[0],
            });
            break;
        }
    }
    return { totalAmount: breakdown.reduce((sum, b) => sum + b.amount, 0), breakdown };
}

/** Removes PENDING deductions of one payroll record so a resubmit re-derives them instead of stacking. */
export async function clearPendingAdvanceRecovery(tx: Prisma.TransactionClient, salaryPayRecordId: string) {
    const pending = { transaction: { salaryPayRecordId, status: 'PENDING' as const } };
    await tx.staffAdvanceRepaymentAllocation.deleteMany({ where: pending });
    await tx.staffAdvanceTransaction.deleteMany({ where: { salaryPayRecordId, status: 'PENDING' } });
}

/**
 * Submit-time posting inside the payroll transaction: re-derives the due amount from the schedule and
 * records one PENDING deduction + allocation per advance. The idempotency key is derived from the payroll
 * record and installment, so the same deduction can never be posted twice.
 */
export async function postAdvanceRecoveryForPayroll(
    tx: Prisma.TransactionClient,
    actorUserId: string,
    employeeId: string,
    month: number,
    year: number,
    salaryPayRecordId: string,
) {
    const { breakdown } = await getAdvanceRecoveryDue(employeeId, month, year, tx);
    const transactionIds: string[] = [];
    for (const due of breakdown) {
        if (due.amount <= 0) continue;
        const record = await tx.staffAdvanceTransaction.create({
            data: {
                advanceId: due.advanceId,
                status: 'PENDING',
                transactionDate: new Date(Date.UTC(year, month - 1, 1)),
                amount: due.amount,
                remarks: `Payroll ${month}/${year} - installment #${due.installmentNo}`,
                idempotencyKey: `ADVREC-${due.advanceId}-${due.scheduleId}-${salaryPayRecordId}`,
                salaryPayRecordId,
                createdById: actorUserId,
            },
        });
        await tx.staffAdvanceRepaymentAllocation.create({
            data: { advanceId: due.advanceId, transactionId: record.id, scheduleId: due.scheduleId, amount: due.amount },
        });
        transactionIds.push(record.id);
    }
    return { totalAmount: breakdown.reduce((sum, b) => sum + b.amount, 0), transactionIds };
}

/**
 * Mark-Paid time: flips the record's PENDING deductions to POSTED, writes the Repayment history entry, and
 * completes any advance whose outstanding amount reached zero (status COMPLETED + Completion history entry).
 */
export async function markAdvanceRecoveryPosted(tx: Prisma.TransactionClient, salaryPayRecordId: string) {
    const pending = await tx.staffAdvanceTransaction.findMany({
        where: { salaryPayRecordId, status: 'PENDING' },
        select: { id: true, advanceId: true, amount: true, remarks: true, createdById: true },
    });
    if (!pending.length) return;

    await tx.staffAdvanceTransaction.updateMany({
        where: { id: { in: pending.map(p => p.id) } },
        data: { status: 'POSTED', postedAt: new Date() },
    });

    for (const advanceId of [...new Set(pending.map(p => p.advanceId))]) {
        const advance = await tx.staffAdvance.findUnique({
            where: { id: advanceId },
            select: {
                status: true,
                schedules: { include: { allocations: { where: { transaction: { status: 'POSTED' } }, select: { amount: true } } } },
            },
        });
        if (!advance || advance.status !== 'ACTIVE') continue;

        const outstanding = advance.schedules.reduce((sum, s) => {
            const paid = s.allocations.reduce((inner, a) => inner.plus(a.amount), dec(0));
            return sum.plus(Prisma.Decimal.max(0, dec(s.amountDue).minus(paid)));
        }, dec(0));
        const completed = outstanding.lessThanOrEqualTo(0.01);
        const actor = pending.find(p => p.advanceId === advanceId)!.createdById;

        for (const posted of pending.filter(p => p.advanceId === advanceId)) {
            await tx.staffAdvanceDecision.create({
                data: { advanceId, action: 'REPAYMENT', actedById: posted.createdById, remarks: `${posted.remarks ?? 'Salary deduction'} - ₹${dec(posted.amount).toFixed(2)} recovered` },
            });
        }
        if (completed) {
            await tx.staffAdvanceDecision.create({ data: { advanceId, action: 'COMPLETE', actedById: actor, remarks: 'Advance fully repaid' } });
        }
        await tx.staffAdvance.update({
            where: { id: advanceId },
            data: { ...(completed ? { status: 'COMPLETED', completedAt: new Date() } : {}), version: { increment: 1 } },
        });
    }
}
