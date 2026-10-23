import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/app/lib/db';
import { errorResponse, handleCorsPreflight } from '@/app/lib/api-utils';
import { requirePermission, isUserContext } from '@/app/lib/permissions/guards';
import { buildSalaryLetterPdf } from '@/app/lib/reports/salary-letter-pdf';
import { toDisplayDate } from '@/app/lib/date-format';

export async function OPTIONS() {
    return handleCorsPreflight();
}

// POST /api/hr/salary-letter/[employeeId] — generates a Salary Letter (CTC
// breakdown) on demand from the employee's current EmployeeSalaryMaster
// components, and streams the PDF back directly (not stored — regenerable at
// any time from the same source data).
export async function POST(request: NextRequest, { params }: { params: Promise<{ employeeId: string }> }) {
    const ctx = await requirePermission(request, 'hr-payroll', 'edit');
    if (!isUserContext(ctx)) return ctx;

    try {
        const { employeeId } = await params;

        const employee = await prisma.user.findUnique({
            where: { id: employeeId },
            select: {
                firstName: true, lastName: true, employeeId: true,
                designation: { select: { name: true } },
                department: { select: { name: true } },
                branch: { select: { name: true } },
            },
        });
        if (!employee) return errorResponse('Employee not found', 404);

        const masterAmounts = await prisma.employeeSalaryMaster.findMany({
            where: { employeeId, isActive: true },
            include: { salaryComponent: true },
        });
        const earnings = masterAmounts.filter((m) => m.salaryComponent.type === 'EARNINGS');
        if (earnings.length === 0) {
            return errorResponse('This employee has no configured salary structure to generate a letter from', 400);
        }

        const pdfBuffer = await buildSalaryLetterPdf({
            employeeName: `${employee.firstName} ${employee.lastName}`,
            employeeCode: employee.employeeId ?? 'N/A',
            designation: employee.designation?.name ?? 'N/A',
            department: employee.department?.name ?? 'N/A',
            branchName: employee.branch?.name ?? 'N/A',
            issueDate: toDisplayDate(new Date()),
            components: earnings.map((m) => ({ name: m.salaryComponent.name, monthlyAmount: Number(m.amount) })),
        });

        return new NextResponse(new Uint8Array(pdfBuffer), {
            status: 200,
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="salary-letter-${employee.employeeId ?? employeeId}.pdf"`,
            },
        });
    } catch (error: any) {
        console.error('Error generating salary letter:', error);
        return errorResponse(error.message || 'Failed to generate salary letter', 500);
    }
}
