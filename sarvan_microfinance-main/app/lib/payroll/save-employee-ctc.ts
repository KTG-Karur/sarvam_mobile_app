import { Prisma } from '@prisma/client';
import { computeCtcBreakdown } from './calculation';
import { applyCtcChange } from '@/app/lib/hr/apply-ctc-change';
import { getKolkataCalendarYmd } from '@/app/lib/branch-lock';

/**
 * Saves an employee's Month CTC Pay: logs the change to EmployeeCtcHistory
 * (via applyCtcChange, source MANUAL_EDIT — Salary Master is a direct edit,
 * same as Employee Master's Organization tab) and recomputes/writes the
 * derived Basic/HRA amounts into EmployeeSalaryMaster. Shared by the
 * individual Salary Master save and Bulk Salary Master save so both write
 * CTC the exact same way.
 */
export async function saveEmployeeMonthlyCtc(tx: Prisma.TransactionClient, params: {
    employeeId: string;
    monthlyCtc: number;
    basicPercent: number;
    hraPercent: number;
    actorUserId: string;
}) {
    await applyCtcChange(tx, {
        employeeId: params.employeeId,
        newMonthlyCtc: params.monthlyCtc,
        source: 'MANUAL_EDIT',
        effectiveDate: new Date(getKolkataCalendarYmd(new Date())),
        actorUserId: params.actorUserId,
    });

    const { basic, hra } = computeCtcBreakdown({
        monthlyCtc: params.monthlyCtc, basicPercent: params.basicPercent, hraPercent: params.hraPercent,
        workingDays: 30, totalPaidDays: 30,
    });

    const basicHraComponents = await tx.salaryComponent.findMany({
        where: { isActive: true, name: { in: ['Basic', 'HRA'], mode: 'insensitive' } },
        select: { id: true, name: true },
    });
    for (const comp of basicHraComponents) {
        const amount = comp.name.trim().toLowerCase() === 'basic' ? basic : hra;
        await tx.employeeSalaryMaster.upsert({
            where: { employeeId_salaryComponentId: { employeeId: params.employeeId, salaryComponentId: comp.id } },
            update: { amount },
            create: { employeeId: params.employeeId, salaryComponentId: comp.id, amount },
        });
    }

    return { basic, hra };
}
