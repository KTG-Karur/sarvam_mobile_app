import { Prisma } from '@prisma/client';
import { prisma } from '@/app/lib/db';
import { getKolkataCalendarYmd } from '@/app/lib/branch-lock';
import { computeEmployeePayroll } from '@/app/lib/payroll/run-payroll';
import { previewInstallments } from '@/app/lib/staff-loans/application';
import { computeRepayment } from '@/app/lib/staff-loans/application-service';
import type { AdvanceSalarySummary, AdvanceScheduleRow, ObligationRow } from './advance';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const dec = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);

/**
 * Salary picture for an employee from the EXISTING payroll calculation (computeEmployeePayroll is the single
 * source of truth the payroll run itself uses), for the current Indian calendar month. Nothing is recomputed
 * here: earnings and deductions are read from its components, and in-hand is earnings minus deductions,
 * exactly how payroll derives netPayable.
 *
 * The advance deduction line already includes any advance installment due this month (payroll integration),
 * so "existing advance deduction" is what payroll would deduct today.
 */
export async function getAdvanceSalarySummary(employeeId: string, now: Date = new Date()): Promise<AdvanceSalarySummary> {
    const today = getKolkataCalendarYmd(now);
    const year = Number(today.slice(0, 4));
    const month = Number(today.slice(5, 7));
    const payroll = await computeEmployeePayroll(employeeId, month, year);

    const components = payroll.components;
    const earnings = components.filter(c => c.type === 'EARNINGS').map(c => ({ name: c.name, amount: c.amount }));
    const deductionLines = components.filter(c => c.type === 'DEDUCTIONS').map(c => {
        const name = c.name.trim().toLowerCase();
        return { name: c.name, amount: c.amount, kind: name === 'staff loan' ? 'LOAN' as const : name === 'staff advance' ? 'ADVANCE' as const : 'OTHER' as const };
    });

    const grossSalary = round2(earnings.reduce((sum, e) => sum + e.amount, 0));
    const totalDeductions = round2(deductionLines.reduce((sum, d) => sum + d.amount, 0));
    const sumKind = (kind: 'LOAN' | 'ADVANCE' | 'OTHER') => round2(deductionLines.filter(d => d.kind === kind).reduce((sum, d) => sum + d.amount, 0));

    return {
        month, year,
        monthlyCtc: payroll.ctcInfo?.monthlyCtc ?? 0,
        basicSalary: components.find(c => c.name.trim().toLowerCase() === 'basic')?.amount ?? 0,
        grossSalary,
        earnings,
        deductionLines,
        totalDeductions,
        existingLoanDeduction: sumKind('LOAN'),
        existingAdvanceDeduction: sumKind('ADVANCE'),
        otherDeductions: sumKind('OTHER'),
        currentInHand: round2(grossSalary - totalDeductions),
    };
}

// ── existing loans & advances ─────────────────────────────────────────────


/**
 * Every Staff Loan and Staff Advance of the employee (cancelled/draft ones never existed as obligations),
 * newest first, so an approver sees what is already being deducted before approving another advance.
 */
export async function loadObligations(employeeId: string, excludeAdvanceId?: string): Promise<ObligationRow[]> {
    const [loans, advances] = await Promise.all([
        prisma.staffLoan.findMany({
            where: { employeeId, status: { notIn: ['DRAFT', 'CANCELLED'] } },
            include: { schedules: { orderBy: { installmentNo: 'asc' }, include: { allocations: { where: { transaction: { status: 'POSTED' } }, select: { principal: true, interest: true, transaction: { select: { transactionDate: true } } } } } } },
        }),
        prisma.staffAdvance.findMany({
            where: { employeeId, status: { not: 'CANCELLED' }, ...(excludeAdvanceId ? { id: { not: excludeAdvanceId } } : {}) },
            include: { schedules: { orderBy: { installmentNo: 'asc' }, include: { allocations: { where: { transaction: { status: 'POSTED' } }, select: { amount: true, transaction: { select: { postedAt: true } } } } } } },
        }),
    ]);

    const rows: ObligationRow[] = [];
    const today = getKolkataCalendarYmd(new Date());

    for (const loan of loans) {
        const disbursed = loan.schedules.length > 0;
        const principal = Number(loan.approvedAmount ?? loan.requestedAmount);
        // Interest an early settlement waived is recorded on the installment, so a settled loan reads PAID (not PARTIAL).
        const track = computeRepayment(loan.schedules).schedules;
        const outstanding = track.reduce((sum, s) => sum.plus(s.totalOutstanding), dec(0));
        const paidInstallments = track.filter(s => s.status === 'PAID').length;
        let monthly = 0;
        if (loan.schedules[0]) monthly = dec(loan.schedules[0].principalDue).plus(loan.schedules[0].interestDue).toNumber();
        else {
            try { monthly = previewInstallments(principal, loan.tenureMonths, loan.interestType, Number(loan.annualInterestRate)).installments[0]?.total ?? 0; } catch { monthly = 0; }
        }
        rows.push({
            id: loan.id, number: loan.loanNumber, type: 'STAFF_LOAN', applicationDate: loan.createdAt.toISOString(),
            approvedAmount: principal, outstandingAmount: disbursed ? outstanding.toNumber() : null, monthlyDeduction: monthly,
            repaymentMonths: loan.tenureMonths, paidInstallments, remainingInstallments: disbursed ? loan.tenureMonths - paidInstallments : loan.tenureMonths,
            status: loan.status, completionDate: loan.closedAt ? loan.closedAt.toISOString() : null,
            // The loan's own track, in the same shape as an advance's, so each can be opened separately.
            schedule: disbursed ? track.map(s => ({
                id: s.id, installmentNo: s.installmentNo, dueDate: s.dueDate, principal: s.principalDue, interest: s.interestDue, totalDue: s.totalDue,
                paidAmount: s.totalPaid, paymentDate: s.paymentDate, outstanding: s.totalOutstanding, status: s.status,
            })) : null,
        });
    }

    for (const advance of advances) {
        const approved = advance.status === 'ACTIVE' || advance.status === 'COMPLETED';
        let outstanding = dec(0);
        let paidInstallments = 0;
        for (const s of advance.schedules) {
            const paid = s.allocations.reduce((sum, a) => sum.plus(a.amount), dec(0));
            outstanding = outstanding.plus(Prisma.Decimal.max(0, dec(s.amountDue).minus(paid)));
            if (dec(s.amountDue).minus(paid).lessThanOrEqualTo(0.001)) paidInstallments += 1;
        }
        rows.push({
            id: advance.id, number: advance.advanceNumber, type: 'STAFF_ADVANCE', applicationDate: advance.createdAt.toISOString(),
            approvedAmount: Number(advance.amount), outstandingAmount: approved ? outstanding.toNumber() : null,
            monthlyDeduction: advance.schedules[0] ? Number(advance.schedules[0].amountDue) : Number(advance.amount) / advance.repaymentMonths,
            repaymentMonths: advance.repaymentMonths, paidInstallments,
            remainingInstallments: approved ? advance.repaymentMonths - paidInstallments : advance.status === 'SUBMITTED' ? advance.repaymentMonths : 0,
            status: advance.status, completionDate: advance.completedAt ? advance.completedAt.toISOString() : null,
            schedule: approved ? advance.schedules.map((s): AdvanceScheduleRow => {
                const paid = s.allocations.reduce((sum, a) => sum.plus(a.amount), dec(0));
                const remaining = Prisma.Decimal.max(0, dec(s.amountDue).minus(paid));
                const dueDate = s.dueDate.toISOString().split('T')[0];
                const paidOn = s.allocations.map(a => a.transaction.postedAt).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0];
                return {
                    id: s.id, installmentNo: s.installmentNo, dueDate, principal: dec(s.amountDue).toNumber(), interest: 0, totalDue: dec(s.amountDue).toNumber(),
                    paidAmount: paid.toNumber(), paymentDate: paidOn ? getKolkataCalendarYmd(paidOn) : null, outstanding: remaining.toNumber(),
                    status: remaining.lessThanOrEqualTo(0.001) ? 'PAID' : paid.greaterThan(0) ? 'PARTIAL' : dueDate < today ? 'OVERDUE' : 'PENDING',
                };
            }) : null,
        });
    }

    return rows.sort((a, b) => b.applicationDate.localeCompare(a.applicationDate));
}
