import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { errorResponse, successResponse, withRole, handleCorsPreflight } from '@/app/lib/api-utils';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';
import { z } from 'zod';
import { buildPayrollSharedContext, computeEmployeePayroll, toGridRowBase } from '@/app/lib/payroll/run-payroll';
import { mapWithConcurrency } from '@/app/lib/payroll/map-with-concurrency';
import type { BulkGridRow } from '@/app/lib/payroll/bulk-grid-types';
import { describeUnpaidDays } from '@/app/lib/payroll/attendance-days';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/** How many employees are computed at once (bounded so a company-wide run cannot exhaust the DB pool). */
const PREVIEW_CONCURRENCY = 8;

const previewSchema = z.object({
    branchId: z.string().min(1),
    month: z.number().min(1).max(12),
    year: z.number().min(2020),
});

/**
 * POST /api/payroll/salary-pay/bulk-run/preview — read-only. For every active
 * employee in scope, returns the identity/org columns of the org's Payroll
 * excel sheet plus the server-computed baseline (attendance-derived days/LOP,
 * Salary Master CTC, every salary component) that the Bulk Payroll grid
 * recomputes live while cells are edited. Nothing is written.
 */
export async function POST(request: NextRequest) {
    return withRole(['AREA_MANAGER', 'ADMIN'], async (req, user) => {
        try {
            const body = await req.json();
            const validation = previewSchema.safeParse(body);
            if (!validation.success) return errorResponse(validation.error.errors[0].message, 400);
            const { branchId, month, year } = validation.data;

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

            const employees = await prisma.user.findMany({
                where: { isActive: true, ...(branchWhere ? { branchId: branchWhere } : {}) },
                select: {
                    id: true, employeeId: true, firstName: true, lastName: true, dateOfJoining: true, isActive: true, branchId: true,
                    branch: {
                        select: {
                            code: true, name: true,
                            areas: { select: { name: true, division: { select: { name: true, region: { select: { name: true } } } } }, take: 1 },
                        },
                    },
                    designation: { select: { name: true } },
                    department: { select: { name: true } },
                },
                orderBy: { firstName: 'asc' },
            });

            // Everything that is the same for all employees is read once, not once per employee:
            // the existing payslips (one query), the salary components and every FDO's incentive (one
            // incentive-engine run instead of one per FDO).
            const [existingRecords, shared] = await Promise.all([
                prisma.salaryPayRecord.findMany({
                    where: { month, year, employeeId: { in: employees.map((e) => e.id) } },
                    select: { employeeId: true, status: true },
                }),
                buildPayrollSharedContext(month, year, employees.map((e) => e.branchId).filter((id): id is string => !!id)),
            ]);
            const existingByEmployee = new Map(existingRecords.map((r) => [r.employeeId, r]));

            // Read-only, so employees are computed several at a time (order of the result is preserved).
            const rows: BulkGridRow[] = await mapWithConcurrency(employees, PREVIEW_CONCURRENCY, async (emp) => {
                const existing = existingByEmployee.get(emp.id) ?? null;
                const computation = await computeEmployeePayroll(emp.id, month, year, undefined, shared);
                const base = toGridRowBase(computation);
                const hasCtc = (base?.monthlyCtc ?? 0) > 0;

                let willRun = true;
                let reason: string | undefined;
                if (existing?.status === 'PAID') { willRun = false; reason = 'Already paid for this period'; }
                else if (existing?.status === 'APPROVED') { willRun = false; reason = 'Already approved on the individual flow'; }
                else if (!hasCtc) { willRun = false; reason = 'No Month CTC Pay set'; }

                const area = emp.branch?.areas?.[0];
                return {
                    employeeId: emp.id,
                    employeeCode: emp.employeeId ?? '',
                    employeeName: `${emp.firstName} ${emp.lastName}`.trim(),
                    status: emp.isActive ? 'Live' : 'Exit',
                    dateOfJoining: emp.dateOfJoining ? emp.dateOfJoining.toISOString() : null,
                    region: area?.division?.region?.name ?? null,
                    division: area?.division?.name ?? null,
                    area: area?.name ?? null,
                    branchCode: emp.branch?.code ?? null,
                    branchName: emp.branch?.name ?? null,
                    designation: emp.designation?.name ?? null,
                    department: emp.department?.name ?? null,
                    existingStatus: existing?.status ?? null,
                    hasCtc, willRun, reason, base,
                    lopNote: describeUnpaidDays(computation.ctcInfo?.lopBreakdown),
                } satisfies BulkGridRow;
            });

            return successResponse({
                total: rows.length,
                willRunCount: rows.filter((r) => r.willRun).length,
                blockedCount: rows.filter((r) => !r.willRun).length,
                rows,
            }, 'Preview loaded');
        } catch (error: any) {
            console.error('[Bulk Payroll Preview] Error:', error);
            return errorResponse(error.message || 'Failed to load bulk payroll preview', 500);
        }
    })(request);
}
