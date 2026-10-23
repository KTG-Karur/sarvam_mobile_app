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

// Basic/HRA are derived from CTC + the employee's Designation %, never
// client-entered — filter them (and Staff Loan, which is payroll-time-only,
// never a static master amount) out of whatever the client sends.
const DERIVED_OR_EXCLUDED_COMPONENT_NAMES = new Set(['basic', 'hra', 'staff loan']);

const saveSalaryMasterSchema = z.object({
    employeeId: z.string().min(1, 'Employee ID is required'),
    monthlyCtc: z.number().min(0, 'Month CTC Pay must be non-negative'),
    components: z.array(z.object({
        salaryComponentId: z.string().min(1, 'Component ID is required'),
        amount: z.number().min(0, 'Amount must be non-negative'),
        // Only meaningful for a component with a defaultPercent configured
        // (e.g. PF, ESI) — this employee's own rate, overriding the org
        // default. Null/omitted = use the component's default %.
        percentOverride: z.number().min(0).max(100).optional().nullable(),
    })),
});

async function assertEmployeeInScope(employeeId: string, permittedBranchIds: string[] | null) {
    const employee = await prisma.user.findUnique({
        where: { id: employeeId },
        select: { id: true, branchId: true, designationId: true, designation: { select: { basicPercent: true, hraPercent: true, name: true } } },
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
            if (!employeeId) return errorResponse('Employee ID is required', 400);

            const permittedBranchIds = await getPermittedBranchIds(user);
            const { employee, forbidden } = await assertEmployeeInScope(employeeId, permittedBranchIds);
            if (!employee) return errorResponse('Employee not found', 404);
            if (forbidden) return errorResponse('You do not have access to this employee\'s salary master', 403);

            const basicPercent = Number(employee.designation?.basicPercent ?? 70);
            const hraPercent = Number(employee.designation?.hraPercent ?? 30);

            const [salaryComponents, existingMasters, ctcMaster] = await Promise.all([
                prisma.salaryComponent.findMany({ where: { isActive: true }, orderBy: { salaryId: 'asc' } }),
                prisma.employeeSalaryMaster.findMany({ where: { employeeId, isActive: true } }),
                prisma.employeeCtcMaster.findUnique({ where: { employeeId } }),
            ]);

            const monthlyCtc = ctcMaster ? Number(ctcMaster.monthlyCtc) : 0;
            const { basic, hra } = computeCtcBreakdown({ monthlyCtc, basicPercent, hraPercent, workingDays: 30, totalPaidDays: 30 });

            const components = salaryComponents
                .filter((sc) => !DERIVED_OR_EXCLUDED_COMPONENT_NAMES.has(sc.name.trim().toLowerCase()))
                .map((sc) => {
                    const master = existingMasters.find((m) => m.salaryComponentId === sc.id);
                    const defaultPercent = sc.defaultPercent !== null ? Number(sc.defaultPercent) : null;
                    const percentOverride = master?.percentOverride !== null && master?.percentOverride !== undefined ? Number(master.percentOverride) : null;
                    const maxAmount = sc.maxAmount != null ? Number(sc.maxAmount) : null;
                    const ctcEligibilityLimit = sc.ctcEligibilityLimit != null ? Number(sc.ctcEligibilityLimit) : null;
                    const isPercentBased = defaultPercent !== null && sc.percentBasis !== null;
                    const previewAmount = isPercentBased
                        ? resolvePercentDeduction({ defaultPercent, percentBasis: sc.percentBasis, percentOverride, actualBasic: basic, actualGross: basic + hra, maxAmount, monthlyCtc, ctcEligibilityLimit })
                        : null;

                    return {
                        id: sc.id,
                        salaryId: sc.salaryId,
                        name: sc.name,
                        type: sc.type,
                        amount: isPercentBased ? (previewAmount ?? 0) : (master ? Number(master.amount) : 0),
                        masterId: master?.id || null,
                        isPercentBased,
                        defaultPercent,
                        percentBasis: sc.percentBasis,
                        maxAmount,
                        ctcEligibilityLimit,
                        percentOverride,
                    };
                });

            return successResponse({
                monthlyCtc,
                yearCtc: yearCtcFromMonthly(monthlyCtc),
                designationName: employee.designation?.name ?? null,
                basicPercent,
                hraPercent,
                basic,
                hra,
                components,
            }, 'Salary master fetched successfully');
        } catch (error: any) {
            console.error('[SalaryMaster GET] Error:', error);
            return errorResponse(error.message || 'Failed to fetch salary master', 500);
        }
    })(request);
}

export async function POST(request: NextRequest) {
    return withRole(['AREA_MANAGER', 'ADMIN'], async (req, user) => {
        try {
            const body = await req.json();
            const validation = saveSalaryMasterSchema.safeParse(body);
            if (!validation.success) {
                return errorResponse(validation.error.errors[0].message, 400);
            }
            const { employeeId, monthlyCtc, components } = validation.data;

            const permittedBranchIds = await getPermittedBranchIds(user);
            const { employee, forbidden } = await assertEmployeeInScope(employeeId, permittedBranchIds);
            if (!employee) return errorResponse('Employee not found', 404);
            if (forbidden) return errorResponse('You do not have access to this employee\'s salary master', 403);

            const basicPercent = Number(employee.designation?.basicPercent ?? 70);
            const hraPercent = Number(employee.designation?.hraPercent ?? 30);

            await prisma.$transaction(async (tx) => {
                await saveEmployeeMonthlyCtc(tx, { employeeId, monthlyCtc, basicPercent, hraPercent, actorUserId: user.userId });

                // Only ever write against components the client is allowed to
                // edit here (everything except Basic/HRA/Staff Loan).
                const editableComponents = await tx.salaryComponent.findMany({
                    where: { isActive: true, NOT: { name: { in: ['Basic', 'HRA', 'Staff Loan'], mode: 'insensitive' } } },
                    select: { id: true, defaultPercent: true, percentBasis: true },
                });
                const editableById = new Map(editableComponents.map((c) => [c.id, c]));

                // Never trust client-sent Basic/HRA/Staff Loan amounts — only
                // persist components the client is actually allowed to edit here.
                for (const c of components) {
                    const sc = editableById.get(c.salaryComponentId);
                    if (!sc) continue;
                    const isPercentBased = sc.defaultPercent !== null && sc.percentBasis !== null;
                    // Percentage-based components (PF/ESI, ...) store only the
                    // employee's rate override — the amount is always
                    // recomputed fresh at payroll time, never read back from
                    // a stored `amount` here.
                    await tx.employeeSalaryMaster.upsert({
                        where: { employeeId_salaryComponentId: { employeeId, salaryComponentId: c.salaryComponentId } },
                        update: isPercentBased ? { percentOverride: c.percentOverride ?? null } : { amount: c.amount },
                        create: isPercentBased
                            ? { employeeId, salaryComponentId: c.salaryComponentId, amount: 0, percentOverride: c.percentOverride ?? null }
                            : { employeeId, salaryComponentId: c.salaryComponentId, amount: c.amount },
                    });
                }
            });

            return successResponse(null, 'Salary master saved successfully');
        } catch (error: any) {
            console.error('[SalaryMaster POST] Error:', error);
            return errorResponse(error.message || 'Failed to save salary master', 500);
        }
    })(request);
}
