import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { errorResponse, successResponse, withRole, handleCorsPreflight } from '@/app/lib/api-utils';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';
import { z } from 'zod';
import { buildPayrollSharedContext, computeEmployeePayroll, toGridRowBase } from '@/app/lib/payroll/run-payroll';
import { computeGridRow } from '@/app/lib/payroll/payroll-grid';
import { postSalaryRecoveryForPayroll, markSalaryRecoveryPosted } from '@/app/lib/staff-loans/salary-recovery';
import { postAdvanceRecoveryForPayroll, markAdvanceRecoveryPosted, clearPendingAdvanceRecovery } from '@/app/lib/staff-advances/salary-recovery';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const bulkRunSchema = z.object({
    // A specific branch id, or the literal 'all' for every branch the actor
    // is permitted to see.
    branchId: z.string().min(1),
    month: z.number().min(1).max(12),
    year: z.number().min(2020),
    paymentType: z.string().min(1),
    // Bulk Payroll grid: the employees to run and the cells the user edited.
    // Only explicit edits are sent — every other figure is recomputed here from
    // the server's own baseline via the shared grid formulas. Omitted = run
    // every eligible employee in scope with no edits (previous behaviour).
    rows: z.array(z.object({
        employeeId: z.string().min(1),
        edits: z.object({
            totalPaidDays: z.number().min(0).max(31).optional(),
            lopDays: z.number().min(0).max(31).optional(),
            monthlyCtc: z.number().min(0).optional(),
            proratedCtc: z.number().min(0).optional(),
            basic: z.number().min(0).optional(),
            hra: z.number().min(0).optional(),
            actualGross: z.number().min(0).optional(),
            actualBasic: z.number().min(0).optional(),
            actualHra: z.number().min(0).optional(),
            components: z.record(z.string(), z.number().min(0)).optional(),
        }),
    })).optional(),
});

type BulkRunRowResult = {
    employeeId: string;
    employeeName: string;
    status: 'paid' | 'skipped' | 'failed';
    reason?: string;
};

/**
 * POST /api/payroll/salary-pay/bulk-run — runs payroll for every active
 * employee in scope (one branch, or every permitted branch) for a period in
 * one action, straight to PAID (no per-employee review/approve step — that
 * stays available on the individual Payroll flow for one-off
 * corrections). Each employee is computed and committed independently so
 * one failure doesn't abort the whole batch.
 */
export async function POST(request: NextRequest) {
    return withRole(['AREA_MANAGER', 'ADMIN'], async (req, user) => {
        try {
            const body = await req.json();
            const validation = bulkRunSchema.safeParse(body);
            if (!validation.success) return errorResponse(validation.error.errors[0].message, 400);
            const { branchId, month, year, paymentType, rows } = validation.data;

            const permittedBranchIds = await getPermittedBranchIds(user);
            let branchWhere: { in: string[] } | undefined;
            if (branchId === 'all') {
                if (permittedBranchIds !== null) branchWhere = { in: permittedBranchIds };
            } else {
                if (permittedBranchIds !== null && !permittedBranchIds.includes(branchId)) {
                    return errorResponse('You do not have access to this branch', 403);
                }
                branchWhere = { in: [branchId] };
            }

            const editsByEmployee = rows ? new Map(rows.map((r) => [r.employeeId, r.edits])) : null;
            const scopedEmployees = await prisma.user.findMany({
                where: { isActive: true, ...(branchWhere ? { branchId: branchWhere } : {}) },
                select: { id: true, firstName: true, lastName: true, branchId: true },
                orderBy: { firstName: 'asc' },
            });
            // With a grid submission only the rows the user sent are run — and
            // only if they are inside the actor's branch scope (never trust a
            // client-sent employeeId outside it).
            const employees = editsByEmployee ? scopedEmployees.filter((e) => editsByEmployee.has(e.id)) : scopedEmployees;
            if (employees.length === 0) return errorResponse('No active employees found in scope', 404);

            const results: BulkRunRowResult[] = [];
            // Salary components + every FDO's incentive, read once for the whole run (not once per employee).
            const shared = await buildPayrollSharedContext(month, year, employees.map((e) => e.branchId).filter((id): id is string => !!id));

            for (const emp of employees) {
                const employeeName = `${emp.firstName} ${emp.lastName}`.trim();
                try {
                    const existing = await prisma.salaryPayRecord.findUnique({
                        where: { employeeId_month_year: { employeeId: emp.id, month, year } },
                        select: { id: true, status: true },
                    });
                    if (existing?.status === 'PAID') {
                        results.push({ employeeId: emp.id, employeeName, status: 'skipped', reason: 'Already paid for this period' });
                        continue;
                    }
                    if (existing?.status === 'APPROVED') {
                        results.push({ employeeId: emp.id, employeeName, status: 'skipped', reason: 'Already approved on the individual flow — use Mark Paid there' });
                        continue;
                    }

                    const computation = await computeEmployeePayroll(emp.id, month, year, undefined, shared);
                    const gridBase = toGridRowBase(computation);
                    if (!computation.employeeFound || !computation.ctcInfo || !gridBase) {
                        results.push({ employeeId: emp.id, employeeName, status: 'skipped', reason: 'Employee not found' });
                        continue;
                    }
                    // Baseline + the user's explicit grid edits, through the same
                    // formulas the grid shows. Component ids the client sent that
                    // aren't active components are simply ignored.
                    const grid = computeGridRow(gridBase, editsByEmployee?.get(emp.id) ?? {});
                    if (grid.monthlyCtc <= 0) {
                        results.push({ employeeId: emp.id, employeeName, status: 'skipped', reason: 'No Month CTC Pay set — configure on Salary Master first' });
                        continue;
                    }

                    const finalComponents = computation.components.map((c) => ({ ...c, amount: grid.amounts[c.id] ?? c.amount }));
                    const totalEarnings = grid.totalEarnings;
                    const totalDeductions = grid.totalDeductions;
                    const netPayable = grid.netWithIncentive;
                    const { totalPaidDays, lopDays, monthlyCtc } = grid;
                    const now = new Date();
                    // Staff Loan / Staff Advance are posted from their own module's
                    // schedule regardless of an edited amount — say so in the result.
                    const scheduleNotes = finalComponents
                        .filter((c) => c.systemBacked && c.amount !== computation.components.find((x) => x.id === c.id)?.amount)
                        .map((c) => `${c.name} edited, but its schedule still posts the original installment`);

                    await prisma.$transaction(async (tx) => {
                        const record = existing
                            ? await tx.salaryPayRecord.update({
                                where: { id: existing.id },
                                data: {
                                    paymentType, totalEarnings, totalDeductions, netPayable,
                                    status: 'PAID', totalPaidDays, lopDays, monthlyCtc,
                                    approvedById: user.userId, approvedAt: now, paidAt: now,
                                },
                            })
                            : await tx.salaryPayRecord.create({
                                data: {
                                    employeeId: emp.id, month, year, paymentType, totalEarnings, totalDeductions, netPayable,
                                    status: 'PAID', totalPaidDays, lopDays, monthlyCtc,
                                    approvedById: user.userId, approvedAt: now, paidAt: now,
                                },
                            });

                        await tx.salaryPayLineItem.deleteMany({ where: { salaryPayRecordId: record.id } });
                        if (finalComponents.length) {
                            await tx.salaryPayLineItem.createMany({
                                data: finalComponents.map((c) => ({ salaryPayRecordId: record.id, salaryComponentId: c.id, amount: c.amount })),
                            });
                        }

                        await tx.staffLoanTransaction.deleteMany({ where: { salaryPayRecordId: record.id, type: 'SALARY_RECOVERY', status: 'PENDING' } });
                        if (computation.staffLoanDue && computation.staffLoanDue.totalAmount > 0) {
                            // Straight to PAID — post the recovery and settle it
                            // in the same transaction, no separate Mark Paid step.
                            await postSalaryRecoveryForPayroll(tx, user.userId, emp.id, month, year, record.id);
                            await markSalaryRecoveryPosted(tx, record.id);
                        }

                        await clearPendingAdvanceRecovery(tx, record.id);
                        if (computation.staffAdvanceDue && computation.staffAdvanceDue.totalAmount > 0) {
                            // Same straight-to-PAID handling for Staff Advance deductions.
                            await postAdvanceRecoveryForPayroll(tx, user.userId, emp.id, month, year, record.id);
                            await markAdvanceRecoveryPosted(tx, record.id);
                        }
                    });

                    results.push({ employeeId: emp.id, employeeName, status: 'paid', reason: scheduleNotes.length ? scheduleNotes.join('; ') : undefined });
                } catch (err: any) {
                    console.error(`[Bulk Payroll Run] Failed for employee ${emp.id}:`, err);
                    results.push({ employeeId: emp.id, employeeName, status: 'failed', reason: err.message || 'Unknown error' });
                }
            }

            const summary = {
                total: employees.length,
                paid: results.filter((r) => r.status === 'paid').length,
                skipped: results.filter((r) => r.status === 'skipped').length,
                failed: results.filter((r) => r.status === 'failed').length,
                results,
            };
            return successResponse(summary, `Bulk payroll run complete: ${summary.paid} paid, ${summary.skipped} skipped, ${summary.failed} failed`);
        } catch (error: any) {
            console.error('[Bulk Payroll Run] Error:', error);
            return errorResponse(error.message || 'Failed to run bulk payroll', 500);
        }
    })(request);
}
