import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { errorResponse, successResponse, withRole, handleCorsPreflight } from '@/app/lib/api-utils';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';
import { z } from 'zod';
import {
    computeCtcBreakdown,
    getAttendanceDerivedPaidDays,
    resolvePercentDeduction,
} from '@/app/lib/payroll/calculation';
import { computeEmployeePayroll } from '@/app/lib/payroll/run-payroll';
import { getSalaryRecoveryDue, postSalaryRecoveryForPayroll, markSalaryRecoveryPosted } from '@/app/lib/staff-loans/salary-recovery';
import { getAdvanceRecoveryDue, postAdvanceRecoveryForPayroll, markAdvanceRecoveryPosted, clearPendingAdvanceRecovery } from '@/app/lib/staff-advances/salary-recovery';
// Leave-balance rollover (attendance-hr/plan-leave-carry-forward.md): the
// Attendance module owns this logic; this route only calls it once payroll
// is marked PAID for the employee, which is this codebase's stand-in for
// "the month is locked/closed" (there is no separate attendance-lock cron).
import { rolloverLeaveBalancesForNextMonth } from '@/app/lib/attendance-leave-permission';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const submitPaySchema = z.object({
    employeeId: z.string().min(1),
    month: z.number().min(1).max(12),
    year: z.number().min(2020),
    paymentType: z.string().min(1),
    // Only { salaryComponentId, amount } — the component's type/name is always
    // resolved server-side (never trust a client-sent type: audit finding
    // C3), and Basic/HRA/Staff Loan amounts are always recomputed server-side
    // regardless of what's sent here.
    components: z.array(z.object({
        salaryComponentId: z.string().min(1),
        amount: z.number().min(0),
    })),
});

const actionSchema = z.object({
    id: z.string().min(1),
    action: z.enum(['approve', 'pay']),
});

async function loadEmployeeInScope(employeeId: string, permittedBranchIds: string[] | null) {
    const employee = await prisma.user.findUnique({
        where: { id: employeeId },
        select: {
            id: true, role: true, branchId: true,
            designation: { select: { basicPercent: true, hraPercent: true } },
        },
    });
    if (!employee) return { employee: null, forbidden: false };
    const forbidden = permittedBranchIds !== null && (!employee.branchId || !permittedBranchIds.includes(employee.branchId));
    return { employee, forbidden };
}

export async function GET(request: NextRequest) {
    return withRole(['AREA_MANAGER', 'ADMIN'], async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const employeeId = searchParams.get('employeeId');
            const month = searchParams.get('month');
            const year = searchParams.get('year');
            if (!employeeId) return errorResponse('Employee ID is required', 400);

            const permittedBranchIds = await getPermittedBranchIds(user);
            const { employee, forbidden } = await loadEmployeeInScope(employeeId, permittedBranchIds);
            if (!employee) return errorResponse('Employee not found', 404);
            if (forbidden) return errorResponse('You do not have access to this employee\'s payroll', 403);

            let existingRecord: any = null;
            if (month && year) {
                existingRecord = await prisma.salaryPayRecord.findUnique({
                    where: { employeeId_month_year: { employeeId, month: parseInt(month), year: parseInt(year) } },
                    include: { lineItems: true },
                });
            }

            let components: Awaited<ReturnType<typeof computeEmployeePayroll>>['components'] = [];
            let ctcInfo: Awaited<ReturnType<typeof computeEmployeePayroll>>['ctcInfo'] = null;
            let permissionHoursThisMonth = 0;

            if (month && year) {
                const m = parseInt(month);
                const y = parseInt(year);
                // Existing (not-yet-locked) saved amounts win for free-entry
                // components, same as before — Basic/HRA/Staff Loan/percent
                // deductions are always recomputed fresh regardless.
                const existingLineItemAmounts = existingRecord
                    ? new Map<string, number>(existingRecord.lineItems.map((li: any): [string, number] => [li.salaryComponentId, Number(li.amount)]))
                    : undefined;
                const result = await computeEmployeePayroll(employeeId, m, y, existingLineItemAmounts);
                components = result.components;
                ctcInfo = result.ctcInfo;
            }

            return successResponse({
                components,
                ctcInfo,
                permissionHoursThisMonth,
                existingRecord: existingRecord ? {
                    id: existingRecord.id,
                    paymentType: existingRecord.paymentType,
                    totalEarnings: Number(existingRecord.totalEarnings),
                    totalDeductions: Number(existingRecord.totalDeductions),
                    netPayable: Number(existingRecord.netPayable),
                    status: existingRecord.status,
                    totalPaidDays: existingRecord.totalPaidDays,
                    lopDays: existingRecord.lopDays ? Number(existingRecord.lopDays) : null,
                    approvedAt: existingRecord.approvedAt,
                    paidAt: existingRecord.paidAt,
                } : null,
            });
        } catch (error: any) {
            console.error('[Payroll GET] Error:', error);
            return errorResponse(error.message || 'Failed to fetch payroll data', 500);
        }
    })(request);
}

export async function POST(request: NextRequest) {
    return withRole(['AREA_MANAGER', 'ADMIN'], async (req, user) => {
        try {
            const body = await req.json();
            const validation = submitPaySchema.safeParse(body);
            if (!validation.success) return errorResponse(validation.error.errors[0].message, 400);
            const { employeeId, month, year, paymentType, components } = validation.data;

            const permittedBranchIds = await getPermittedBranchIds(user);
            const { employee, forbidden } = await loadEmployeeInScope(employeeId, permittedBranchIds);
            if (!employee) return errorResponse('Employee not found', 404);
            if (forbidden) return errorResponse('You do not have access to this employee\'s payroll', 403);

            const existing = await prisma.salaryPayRecord.findUnique({ where: { employeeId_month_year: { employeeId, month, year } } });
            if (existing && (existing.status === 'APPROVED' || existing.status === 'PAID')) {
                return errorResponse(`This payroll record is already ${existing.status.toLowerCase()} and can no longer be edited.`, 409);
            }

            // Resolve every component's real name/type server-side — never
            // trust the client for either (audit C3). Recompute Basic/HRA/
            // Staff Loan/percent-based deductions fresh regardless of what
            // the client sent.
            const [allComponents, masterAmounts, ctcMaster, days, loanDue, advanceDue] = await Promise.all([
                prisma.salaryComponent.findMany({ where: { isActive: true } }),
                prisma.employeeSalaryMaster.findMany({ where: { employeeId, isActive: true } }),
                prisma.employeeCtcMaster.findUnique({ where: { employeeId } }),
                getAttendanceDerivedPaidDays(employeeId, month, year),
                getSalaryRecoveryDue(employeeId, month, year),
                getAdvanceRecoveryDue(employeeId, month, year),
            ]);
            const monthlyCtc = ctcMaster ? Number(ctcMaster.monthlyCtc) : 0;
            const basicPercent = Number(employee.designation?.basicPercent ?? 70);
            const hraPercent = Number(employee.designation?.hraPercent ?? 30);
            const breakdown = computeCtcBreakdown({ monthlyCtc, basicPercent, hraPercent, workingDays: days.workingDays, totalPaidDays: days.totalPaidDays });

            // Every active component gets a line item — same full-round-trip
            // shape GET returns. Basic/HRA/Staff Loan/percent-based deductions
            // (PF/ESI, or anything else configured that way) are always
            // server-computed; everything else uses whatever the client
            // submitted (0 if the client didn't include it).
            const clientAmountByComponentId = new Map(components.map((c) => [c.salaryComponentId, c.amount]));
            const resolvedLineItems = allComponents.map((sc) => {
                const nameLower = sc.name.trim().toLowerCase();
                const masterAmount = masterAmounts.find((m) => m.salaryComponentId === sc.id);
                const percentAmount = resolvePercentDeduction({
                    defaultPercent: sc.defaultPercent !== null ? Number(sc.defaultPercent) : null,
                    percentBasis: sc.percentBasis,
                    percentOverride: masterAmount?.percentOverride !== null && masterAmount?.percentOverride !== undefined ? Number(masterAmount.percentOverride) : null,
                    actualBasic: breakdown.actualBasic,
                    actualGross: breakdown.actualGross,
                    maxAmount: sc.maxAmount != null ? Number(sc.maxAmount) : null,
                    monthlyCtc,
                    ctcEligibilityLimit: sc.ctcEligibilityLimit != null ? Number(sc.ctcEligibilityLimit) : null,
                });
                let amount: number;
                if (nameLower === 'basic') amount = breakdown.actualBasic;
                else if (nameLower === 'hra') amount = breakdown.actualHra;
                else if (nameLower === 'staff loan') amount = loanDue.totalAmount;
                // Only overrides the free-entry Staff Advance amount when a Staff Advance module installment is due.
                else if (nameLower === 'staff advance' && advanceDue.totalAmount > 0) amount = advanceDue.totalAmount;
                else if (percentAmount !== null) amount = percentAmount;
                else amount = clientAmountByComponentId.get(sc.id) ?? 0;
                return { salaryComponentId: sc.id, type: sc.type, amount };
            });

            const totalEarnings = resolvedLineItems.filter((c) => c.type === 'EARNINGS').reduce((sum, c) => sum + c.amount, 0);
            const totalDeductions = resolvedLineItems.filter((c) => c.type === 'DEDUCTIONS').reduce((sum, c) => sum + c.amount, 0);
            const netPayable = totalEarnings - totalDeductions;

            await prisma.$transaction(async (tx) => {
                const record = existing
                    ? await tx.salaryPayRecord.update({
                        where: { id: existing.id },
                        data: {
                            paymentType, totalEarnings, totalDeductions, netPayable,
                            status: 'PENDING_APPROVAL',
                            totalPaidDays: days.totalPaidDays, lopDays: days.lopDays, monthlyCtc,
                            approvedById: null, approvedAt: null, paidAt: null,
                        },
                    })
                    : await tx.salaryPayRecord.create({
                        data: {
                            employeeId, month, year, paymentType, totalEarnings, totalDeductions, netPayable,
                            status: 'PENDING_APPROVAL',
                            totalPaidDays: days.totalPaidDays, lopDays: days.lopDays, monthlyCtc,
                        },
                    });

                await tx.salaryPayLineItem.deleteMany({ where: { salaryPayRecordId: record.id } });
                if (resolvedLineItems.length) {
                    await tx.salaryPayLineItem.createMany({
                        data: resolvedLineItems.map((li) => ({ salaryPayRecordId: record.id, salaryComponentId: li.salaryComponentId, amount: li.amount })),
                    });
                }

                // Resubmitting must not stack duplicate pending recoveries —
                // clear any previous PENDING SALARY_RECOVERY postings for this
                // record before re-deriving them from the current schedule.
                await tx.staffLoanTransaction.deleteMany({ where: { salaryPayRecordId: record.id, type: 'SALARY_RECOVERY', status: 'PENDING' } });
                if (loanDue.totalAmount > 0) {
                    await postSalaryRecoveryForPayroll(tx, user.userId, employeeId, month, year, record.id);
                }

                // Same for Staff Advance deductions: clear this record's earlier PENDING ones, then re-derive.
                await clearPendingAdvanceRecovery(tx, record.id);
                if (advanceDue.totalAmount > 0) {
                    await postAdvanceRecoveryForPayroll(tx, user.userId, employeeId, month, year, record.id);
                }
            });

            return successResponse(null, existing ? 'Salary payment updated successfully' : 'Salary payment submitted successfully');
        } catch (error: any) {
            console.error('[Payroll POST] Error:', error);
            return errorResponse(error.message || 'Failed to submit salary payment', 500);
        }
    })(request);
}

// PATCH /api/payroll/salary-pay — { id, action: 'approve' | 'pay' }
// approve: PENDING_APPROVAL -> APPROVED (locks further edits).
// pay: APPROVED -> PAID, and only at this point posts the linked
// SALARY_RECOVERY staff-loan transaction(s) from PENDING to POSTED.
export async function PATCH(request: NextRequest) {
    return withRole(['AREA_MANAGER', 'ADMIN'], async (req, user) => {
        try {
            const body = await req.json();
            const validation = actionSchema.safeParse(body);
            if (!validation.success) return errorResponse(validation.error.errors[0].message, 400);
            const { id, action } = validation.data;

            const record = await prisma.salaryPayRecord.findUnique({ where: { id }, select: { id: true, status: true, employeeId: true, month: true, year: true } });
            if (!record) return errorResponse('Payroll record not found', 404);

            const permittedBranchIds = await getPermittedBranchIds(user);
            const { employee, forbidden } = await loadEmployeeInScope(record.employeeId, permittedBranchIds);
            if (!employee) return errorResponse('Employee not found', 404);
            if (forbidden) return errorResponse('You do not have access to this employee\'s payroll', 403);

            if (action === 'approve') {
                if (record.status !== 'PENDING_APPROVAL') return errorResponse(`Cannot approve a record in '${record.status}' status`, 409);
                await prisma.salaryPayRecord.update({ where: { id }, data: { status: 'APPROVED', approvedById: user.userId, approvedAt: new Date() } });
                return successResponse(null, 'Payroll approved');
            }

            if (record.status !== 'APPROVED') return errorResponse(`Cannot mark paid a record in '${record.status}' status`, 409);
            await prisma.$transaction(async (tx) => {
                await tx.salaryPayRecord.update({ where: { id }, data: { status: 'PAID', paidAt: new Date() } });
                await markSalaryRecoveryPosted(tx, id);
                await markAdvanceRecoveryPosted(tx, id);
                await rolloverLeaveBalancesForNextMonth(tx, record.employeeId, record.month, record.year);
            });
            return successResponse(null, 'Payroll marked as paid');
        } catch (error: any) {
            console.error('[Payroll PATCH] Error:', error);
            return errorResponse(error.message || 'Failed to update payroll status', 500);
        }
    })(request);
}
