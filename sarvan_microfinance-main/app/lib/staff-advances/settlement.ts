import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/app/lib/db';
import { getKolkataCalendarYmd } from '@/app/lib/branch-lock';
import { StaffLoanConfigurationError } from '@/app/lib/staff-loans/configuration-service';
import { SETTLEMENT_PAYMENT_MODES } from '@/app/lib/staff-loans/application';
import type { StaffLoanActor } from '@/app/lib/staff-loans/application-access';

const dec = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);

/** Same rules as a Staff Loan early settlement: Cash or Bank Transfer only, and a bank transfer carries its UTR. */
export const advanceSettlementSchema = z.object({
    advanceId: z.string().min(1, 'Advance is required'),
    paymentMode: z.enum(SETTLEMENT_PAYMENT_MODES),
    reference: z.string().trim().max(100).optional().nullable(),
    remarks: z.string().max(500).optional().nullable(),
    expectedVersion: z.number().int().positive('Expected version required'),
    /** The amount the user was quoted; the settlement is refused if the server now computes a different one. */
    expectedAmount: z.number().finite().nonnegative().optional(),
}).strict().superRefine((data, ctx) => {
    if (data.paymentMode === 'BANK_TRANSFER' && !data.reference) {
        ctx.addIssue({ code: 'custom', path: ['reference'], message: 'Enter the payment reference / UTR number for a bank transfer' });
    }
});
export type AdvanceSettlementInput = z.infer<typeof advanceSettlementSchema>;

/**
 * Pays off the whole outstanding balance of an ACTIVE Staff Advance in one go. The amount is always derived from
 * the schedule and its POSTED allocations (never supplied by the caller); an advance carries no interest, so the
 * settlement is exactly the unpaid principal.
 *
 * Everything happens in one serializable transaction: the settlement transaction, one allocation per unpaid
 * installment, the COMPLETED status and the audit rows. A settlement can only happen once: the status/version
 * guard rejects a second attempt, and the fixed idempotency key makes the database reject it too.
 */
export async function settleAdvance(actor: StaffLoanActor, input: AdvanceSettlementInput) {
    const data = advanceSettlementSchema.parse(input);
    try {
        return await prisma.$transaction(async tx => {
            const advance = await tx.staffAdvance.findUnique({
                where: { id: data.advanceId },
                include: {
                    // A payroll deduction that is submitted but not yet marked paid still holds allocations against the
                    // schedule; settling now and marking it paid later would collect the same installment twice.
                    transactions: { where: { status: 'PENDING' }, select: { id: true } },
                    schedules: {
                        orderBy: { installmentNo: 'asc' },
                        include: { allocations: { where: { transaction: { status: 'POSTED' } }, select: { amount: true } } },
                    },
                },
            });
            if (!advance) throw new StaffLoanConfigurationError('Staff advance not found', 404);
            if (actor.branchIds !== null && !actor.branchIds.includes(advance.branchId) && !actor.isAdmin) {
                throw new StaffLoanConfigurationError('You are not authorized to settle advances for this branch.', 403);
            }
            if (advance.status !== 'ACTIVE') throw new StaffLoanConfigurationError('Only ACTIVE staff advances can be settled.', 400);
            if (advance.version !== data.expectedVersion) throw new StaffLoanConfigurationError('Staff advance was modified by another operation. Please reload.', 409);
            if (advance.transactions.length > 0) {
                throw new StaffLoanConfigurationError('A payroll deduction for this advance is still pending. Mark that payroll as paid (or clear it) before settling.', 409);
            }

            const balances = advance.schedules.map(s => {
                const paid = s.allocations.reduce((sum, a) => sum.plus(a.amount), dec(0));
                return { scheduleId: s.id, remaining: Prisma.Decimal.max(0, dec(s.amountDue).minus(paid)) };
            });
            const settlementAmount = balances.reduce((sum, b) => sum.plus(b.remaining), dec(0));
            if (settlementAmount.lessThanOrEqualTo(0)) throw new StaffLoanConfigurationError('This advance has no outstanding balance to settle.', 400);
            if (data.expectedAmount !== undefined && settlementAmount.minus(data.expectedAmount).abs().greaterThan(0.01)) {
                throw new StaffLoanConfigurationError(`The settlement amount has changed to ₹${settlementAmount.toFixed(2)}. Reload before proceeding.`, 409);
            }

            const settlementDate = getKolkataCalendarYmd(new Date());
            const txRecord = await tx.staffAdvanceTransaction.create({
                data: {
                    advanceId: advance.id,
                    status: 'POSTED',
                    transactionDate: new Date(settlementDate),
                    amount: settlementAmount,
                    paymentMode: data.paymentMode,
                    reference: data.reference || null,
                    remarks: data.remarks || 'Early settlement full payoff',
                    idempotencyKey: `ADVSETTLE-${advance.id}`,
                    createdById: actor.userId,
                    postedAt: new Date(),
                },
            });
            await tx.staffAdvanceRepaymentAllocation.createMany({
                data: balances.filter(b => b.remaining.greaterThan(0)).map(b => ({
                    advanceId: advance.id, transactionId: txRecord.id, scheduleId: b.scheduleId, amount: b.remaining,
                })),
            });

            const updated = await tx.staffAdvance.updateMany({
                where: { id: advance.id, version: data.expectedVersion, status: 'ACTIVE' },
                data: { status: 'COMPLETED', completedAt: new Date(), version: { increment: 1 } },
            });
            if (updated.count !== 1) throw new StaffLoanConfigurationError('Settlement collision. Reload before proceeding.', 409);

            const how = [
                `${data.paymentMode === 'BANK_TRANSFER' ? 'Bank transfer' : 'Cash'} on ${settlementDate}`,
                data.reference ? `Ref ${data.reference}` : null,
                data.remarks || null,
            ].filter(Boolean).join(' - ');
            await tx.staffAdvanceDecision.createMany({
                data: [
                    { advanceId: advance.id, action: 'REPAYMENT', actedById: actor.userId, remarks: `Early settlement - ₹${settlementAmount.toFixed(2)} paid (${how})` },
                    { advanceId: advance.id, action: 'COMPLETE', actedById: actor.userId, remarks: 'Advance settled early' },
                ],
            });

            return { advanceNumber: advance.advanceNumber, transactionId: txRecord.id, settlementAmount: settlementAmount.toNumber() };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
        // The fixed idempotency key: a second settlement of the same advance can never be recorded.
        if ((error as { code?: string })?.code === 'P2002') {
            throw new StaffLoanConfigurationError('This staff advance has already been settled.', 409);
        }
        throw error;
    }
}
