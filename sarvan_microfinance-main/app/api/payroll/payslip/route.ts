import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { errorResponse, successResponse, withRole, handleCorsPreflight } from '@/app/lib/api-utils';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/payroll/payslip
 * Query params: employeeId (required), month (required, 1-12), year (required)
 *
 * Returns the full payslip data for the given employee & period.
 * Requires: AREA_MANAGER/ADMIN role — enforced here, not just at the page level,
 * and an AREA_MANAGER is further restricted to employees in their assigned branches.
 */
export async function GET(request: NextRequest) {
    return withRole(['ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH', 'AREA_MANAGER'], async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const employeeId = searchParams.get('employeeId')?.trim();
            const monthParam = searchParams.get('month');
            const yearParam = searchParams.get('year');

            // ── Validate inputs ────────────────────────────────────────────
            if (!employeeId) {
                return errorResponse('employeeId is required', 400);
            }

            const month = monthParam ? parseInt(monthParam, 10) : NaN;
            const year = yearParam ? parseInt(yearParam, 10) : NaN;

            if (isNaN(month) || month < 1 || month > 12) {
                return errorResponse('month must be a number between 1 and 12', 400);
            }
            if (isNaN(year) || year < 2020) {
                return errorResponse('year must be a valid year (>= 2020)', 400);
            }

            // ── Fetch employee details ─────────────────────────────────────
            const employee = await prisma.user.findUnique({
                where: { id: employeeId },
                select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    employeeId: true,
                    role: true,
                    branchId: true,
                    branch: {
                        select: {
                            id: true,
                            name: true,
                            code: true,
                        },
                    },
                },
            });

            if (!employee) {
                return errorResponse('Employee not found', 404);
            }

            // Multi-tenancy boundary — an AREA_MANAGER may only view payslips
            // for employees in branches they're assigned to.
            const permittedBranchIds = await getPermittedBranchIds(user);
            if (permittedBranchIds !== null && (!employee.branchId || !permittedBranchIds.includes(employee.branchId))) {
                return errorResponse('You do not have access to this employee\'s payslip', 403);
            }

            // ── Fetch the salary pay record for the period ─────────────────
            const payRecord = await prisma.salaryPayRecord.findUnique({
                where: {
                    employeeId_month_year: { employeeId, month, year },
                },
                include: {
                    lineItems: {
                        include: {
                            salaryComponent: {
                                select: {
                                    id: true,
                                    salaryId: true,
                                    name: true,
                                    type: true,
                                },
                            },
                        },
                        orderBy: {
                            salaryComponent: { salaryId: 'asc' },
                        },
                    },
                },
            });

            if (!payRecord) {
                return errorResponse(
                    `No salary record found for ${employee.firstName} ${employee.lastName} for the selected period.`,
                    404
                );
            }

            // ── Shape response payload ─────────────────────────────────────
            const components = payRecord.lineItems.map((item) => ({
                name: item.salaryComponent.name,
                type: item.salaryComponent.type as 'EARNINGS' | 'DEDUCTIONS',
                amount: Number(item.amount),
            }));

            const payload = {
                // Employee info
                employeeName: `${employee.firstName} ${employee.lastName}`,
                employeeCode: employee.employeeId ?? 'N/A',
                designation: employee.role,        // role used as designation proxy
                department: 'General',            // no dedicated dept field in schema
                branchName: employee.branch?.name ?? 'N/A',
                branchCode: employee.branch?.code ?? 'N/A',

                // Period
                month,
                year,

                // Payment info
                paymentType: payRecord.paymentType,
                status: payRecord.status,
                paidOn: payRecord.createdAt.toISOString(),

                // Salary breakdown
                components,
                totalEarnings: Number(payRecord.totalEarnings),
                totalDeductions: Number(payRecord.totalDeductions),
                netPayable: Number(payRecord.netPayable),
            };

            return successResponse(payload, 'Payslip fetched successfully');

        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            console.error('[Payslip GET] Error:', message);
            return errorResponse(message || 'Failed to fetch payslip', 500);
        }
    })(request);
}
