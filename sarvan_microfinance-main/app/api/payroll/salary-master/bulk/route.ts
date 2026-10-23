import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { errorResponse, successResponse, withRole, handleCorsPreflight } from '@/app/lib/api-utils';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';
import { computeCtcBreakdown, yearCtcFromMonthly, resolvePercentDeduction } from '@/app/lib/payroll/calculation';
import { saveEmployeeMonthlyCtc } from '@/app/lib/payroll/save-employee-ctc';
import { z } from 'zod';

export async function OPTIONS() {
    return handleCorsPreflight();
}

function resolveBranchWhere(branchId: string, permittedBranchIds: string[] | null): { in: string[] } | undefined | 'forbidden' {
    if (branchId === 'all') {
        return permittedBranchIds !== null ? { in: permittedBranchIds } : undefined;
    }
    if (permittedBranchIds !== null && !permittedBranchIds.includes(branchId)) return 'forbidden';
    return { in: [branchId] };
}

// GET /api/payroll/salary-master/bulk?branchId=X|all
export async function GET(request: NextRequest) {
    return withRole(['AREA_MANAGER', 'ADMIN'], async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const branchId = searchParams.get('branchId') || 'all';

            const permittedBranchIds = await getPermittedBranchIds(user);
            const branchWhere = resolveBranchWhere(branchId, permittedBranchIds);
            if (branchWhere === 'forbidden') return errorResponse('You do not have access to this branch', 403);

            const [employees, pfEsiComponents] = await Promise.all([
                prisma.user.findMany({
                    where: { isActive: true, ...(branchWhere ? { branchId: branchWhere } : {}) },
                    select: {
                        id: true, firstName: true, lastName: true, employeeId: true,
                        branch: { select: { name: true } },
                        designation: { select: { name: true, basicPercent: true, hraPercent: true } },
                        employeeCtcMaster: { select: { monthlyCtc: true } },
                    },
                    orderBy: { firstName: 'asc' },
                }),
                prisma.salaryComponent.findMany({
                    where: { isActive: true, defaultPercent: { not: null } },
                    select: { id: true, name: true, defaultPercent: true, percentBasis: true, maxAmount: true, ctcEligibilityLimit: true },
                }),
            ]);

            const employeeIds = employees.map((e) => e.id);
            const percentMasters = employeeIds.length
                ? await prisma.employeeSalaryMaster.findMany({
                    where: { employeeId: { in: employeeIds }, salaryComponentId: { in: pfEsiComponents.map((c) => c.id) } },
                    select: { employeeId: true, salaryComponentId: true, percentOverride: true },
                })
                : [];

            const rows = employees.map((emp) => {
                const basicPercent = Number(emp.designation?.basicPercent ?? 70);
                const hraPercent = Number(emp.designation?.hraPercent ?? 30);
                const monthlyCtc = emp.employeeCtcMaster ? Number(emp.employeeCtcMaster.monthlyCtc) : 0;
                const { basic, hra } = computeCtcBreakdown({ monthlyCtc, basicPercent, hraPercent, workingDays: 30, totalPaidDays: 30 });

                const percentDeductions = pfEsiComponents.map((sc) => {
                    const master = percentMasters.find((m) => m.employeeId === emp.id && m.salaryComponentId === sc.id);
                    const percentOverride = master?.percentOverride !== null && master?.percentOverride !== undefined ? Number(master.percentOverride) : null;
                    const amount = resolvePercentDeduction({
                        defaultPercent: sc.defaultPercent !== null ? Number(sc.defaultPercent) : null,
                        percentBasis: sc.percentBasis, percentOverride, actualBasic: basic, actualGross: basic + hra,
                        maxAmount: sc.maxAmount != null ? Number(sc.maxAmount) : null,
                        monthlyCtc,
                        ctcEligibilityLimit: sc.ctcEligibilityLimit != null ? Number(sc.ctcEligibilityLimit) : null,
                    });
                    return { name: sc.name, amount: amount ?? 0 };
                });

                return {
                    employeeId: emp.id,
                    employeeName: `${emp.firstName} ${emp.lastName}`.trim(),
                    employeeCode: emp.employeeId,
                    branchName: emp.branch?.name ?? null,
                    designationName: emp.designation?.name ?? null,
                    basicPercent, hraPercent,
                    monthlyCtc, yearCtc: yearCtcFromMonthly(monthlyCtc),
                    basic, hra,
                    percentDeductions,
                };
            });

            return successResponse({ total: rows.length, rows }, 'Bulk salary master loaded');
        } catch (error: any) {
            console.error('[SalaryMaster Bulk GET] Error:', error);
            return errorResponse(error.message || 'Failed to load bulk salary master', 500);
        }
    })(request);
}

const bulkSaveSchema = z.object({
    updates: z.array(z.object({
        employeeId: z.string().min(1),
        monthlyCtc: z.number().min(0),
    })).min(1, 'No changes to save'),
});

// POST /api/payroll/salary-master/bulk — { updates: [{ employeeId, monthlyCtc }] }
export async function POST(request: NextRequest) {
    return withRole(['AREA_MANAGER', 'ADMIN'], async (req, user) => {
        try {
            const body = await req.json();
            const validation = bulkSaveSchema.safeParse(body);
            if (!validation.success) return errorResponse(validation.error.errors[0].message, 400);
            const { updates } = validation.data;

            const permittedBranchIds = await getPermittedBranchIds(user);
            const employees = await prisma.user.findMany({
                where: { id: { in: updates.map((u) => u.employeeId) } },
                select: { id: true, branchId: true, designation: { select: { basicPercent: true, hraPercent: true } } },
            });
            const employeeById = new Map(employees.map((e) => [e.id, e]));

            const results: { employeeId: string; status: 'saved' | 'failed'; reason?: string }[] = [];
            for (const update of updates) {
                const employee = employeeById.get(update.employeeId);
                if (!employee) { results.push({ employeeId: update.employeeId, status: 'failed', reason: 'Employee not found' }); continue; }
                if (permittedBranchIds !== null && (!employee.branchId || !permittedBranchIds.includes(employee.branchId))) {
                    results.push({ employeeId: update.employeeId, status: 'failed', reason: 'You do not have access to this employee' });
                    continue;
                }
                try {
                    const basicPercent = Number(employee.designation?.basicPercent ?? 70);
                    const hraPercent = Number(employee.designation?.hraPercent ?? 30);
                    await prisma.$transaction(async (tx) => {
                        await saveEmployeeMonthlyCtc(tx, { employeeId: update.employeeId, monthlyCtc: update.monthlyCtc, basicPercent, hraPercent, actorUserId: user.userId });
                    });
                    results.push({ employeeId: update.employeeId, status: 'saved' });
                } catch (err: any) {
                    results.push({ employeeId: update.employeeId, status: 'failed', reason: err.message || 'Unknown error' });
                }
            }

            const saved = results.filter((r) => r.status === 'saved').length;
            const failed = results.filter((r) => r.status === 'failed').length;
            return successResponse({ saved, failed, results }, `Saved ${saved} employee(s)${failed ? `, ${failed} failed` : ''}`);
        } catch (error: any) {
            console.error('[SalaryMaster Bulk POST] Error:', error);
            return errorResponse(error.message || 'Failed to save bulk salary master', 500);
        }
    })(request);
}
