import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { withRole, errorResponse } from '@/app/lib/api-utils';
import * as XLSX from 'xlsx';

export async function GET(request: NextRequest) {
  return withRole(['ADMIN'], async (req) => {
    try {
      const month = req.nextUrl.searchParams.get('month');
      const year = req.nextUrl.searchParams.get('year');

      if (!month || !year) {
        return errorResponse('month and year parameters are required', 400);
      }

      const monthNum = parseInt(month, 10);
      const yearNum = parseInt(year, 10);

      if (monthNum < 1 || monthNum > 12 || isNaN(yearNum)) {
        return errorResponse('Invalid month (1-12) or year', 400);
      }

      const fdos = await prisma.user.findMany({
        where: { role: 'FDO', isActive: true },
        select: {
          id: true,
          employeeId: true,
          firstName: true,
          lastName: true,
          branch: { select: { code: true, name: true } },
          fdoTasks: {
            where: { month: monthNum, year: yearNum },
            select: {
              enrollmentTarget: true,
              newMemberTarget: true,
              renewalMemberTarget: true,
              loanDisbursementTarget: true,
            },
          },
        },
        orderBy: { firstName: 'asc' },
      });

      const headerRow = [
        'Employee ID',
        'Employee Name',
        'Branch',
        'Enrollment Target',
        'New Member Target',
        'Renewal Target',
        'Loan Disbursement Target',
      ];

      const dataRows = fdos.map((fdo) => {
        const task = fdo.fdoTasks[0];
        return [
          fdo.employeeId || '',
          `${fdo.firstName} ${fdo.lastName}`.trim(),
          fdo.branch ? `${fdo.branch.code} - ${fdo.branch.name}` : '',
          task?.enrollmentTarget ?? '',
          task?.newMemberTarget ?? '',
          task?.renewalMemberTarget ?? '',
          task ? Number(task.loanDisbursementTarget) : '',
        ];
      });

      const ws = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows]);
      ws['!cols'] = [
        { wch: 15 },
        { wch: 25 },
        { wch: 30 },
        { wch: 18 },
        { wch: 18 },
        { wch: 16 },
        { wch: 24 },
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'FDO Targets');

      const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });

      return new NextResponse(buffer, {
        status: 200,
        headers: {
          'Content-Disposition': `attachment; filename="FDO_Targets_${monthNum}_${yearNum}.xlsx"`,
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
      });
    } catch (error) {
      console.error('Error generating FDO template:', error);
      return errorResponse('Failed to generate template', 500);
    }
  })(request);
}
