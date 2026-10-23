import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { withRole, errorResponse, successResponse } from '@/app/lib/api-utils';
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

      // Also include FDOs with no task record yet (for display)
      const allFdos = await prisma.user.findMany({
        where: { role: 'FDO', isActive: true },
        select: {
          id: true,
          employeeId: true,
          firstName: true,
          lastName: true,
          branchId: true,
          branch: { select: { code: true, name: true } },
          fdoTasks: {
            where: { month: monthNum, year: yearNum },
            select: {
              id: true,
              enrollmentTarget: true,
              newMemberTarget: true,
              renewalMemberTarget: true,
              loanDisbursementTarget: true,
            },
          },
        },
        orderBy: { firstName: 'asc' },
      });

      const formatted = allFdos.map((fdo) => {
        const task = fdo.fdoTasks[0];
        return {
          id: task?.id ?? `new_${fdo.id}`,
          userId: fdo.id,
          employeeId: fdo.employeeId,
          name: `${fdo.firstName} ${fdo.lastName}`.trim(),
          branchId: fdo.branchId,
          branch: fdo.branch ? `${fdo.branch.code} - ${fdo.branch.name}` : 'N/A',
          month: monthNum,
          year: yearNum,
          enrollmentTarget: task?.enrollmentTarget ?? 0,
          newMemberTarget: task?.newMemberTarget ?? 0,
          renewalMemberTarget: task?.renewalMemberTarget ?? 0,
          loanDisbursementTarget: task ? Number(task.loanDisbursementTarget) : 0,
        };
      });

      return successResponse(formatted, 'FDO tasks retrieved');
    } catch (error) {
      console.error('Error fetching FDO tasks:', error);
      return errorResponse('Failed to fetch FDO tasks', 500);
    }
  })(request);
}

export async function POST(request: NextRequest) {
  return withRole(['ADMIN'], async (req) => {
    try {
      const contentType = req.headers.get('content-type') || '';

      // Handle single JSON upsert (inline edit)
      if (contentType.includes('application/json')) {
        const body = await req.json();
        const { employeeId, month, year, enrollmentTarget, newMemberTarget, renewalMemberTarget, loanDisbursementTarget } = body;

        if (!employeeId || !month || !year) {
          return errorResponse('employeeId, month, and year are required', 400);
        }

        const fdo = await prisma.user.findFirst({
          where: { employeeId, role: 'FDO', isActive: true },
          select: { id: true },
        });

        if (!fdo) {
          return errorResponse(`FDO with Employee ID "${employeeId}" not found`, 404);
        }

        const data = {
          enrollmentTarget: enrollmentTarget ?? 0,
          newMemberTarget: newMemberTarget ?? 0,
          renewalMemberTarget: renewalMemberTarget ?? 0,
          loanDisbursementTarget: loanDisbursementTarget ?? 0,
        };

        const task = await prisma.fdoTask.upsert({
          where: { userId_month_year: { userId: fdo.id, month, year } },
          update: data,
          create: { userId: fdo.id, month, year, ...data },
        });

        return successResponse(task, 'FDO task updated');
      }

      // Handle Excel bulk upload
      const searchParams = req.nextUrl.searchParams;
      const month = parseInt(searchParams.get('month') || '0', 10);
      const year = parseInt(searchParams.get('year') || '0', 10);

      if (!month || month < 1 || month > 12 || !year || year < 2020) {
        return errorResponse('Invalid month (1-12) or year query parameters', 400);
      }

      const formData = await req.formData();
      const file = formData.get('file') as File;

      if (!file) {
        return errorResponse('No file provided', 400);
      }

      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<any>(worksheet, { defval: '' });

      if (rows.length === 0) {
        return errorResponse('Excel file is empty', 400);
      }

      let totalUploaded = 0;
      let totalCreated = 0;
      let totalUpdated = 0;
      let totalFailed = 0;
      const errors: string[] = [];

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const employeeId = String(row['Employee ID'] || '').trim();

        if (!employeeId) {
          totalFailed++;
          errors.push(`Row ${i + 2}: Employee ID is required`);
          continue;
        }

        const enrollmentTarget = parseInt(String(row['Enrollment Target'] || '0'), 10);
        const newMemberTarget = parseInt(String(row['New Member Target'] || '0'), 10);
        const renewalMemberTarget = parseInt(String(row['Renewal Target'] || '0'), 10);
        const loanDisbursementTarget = parseFloat(String(row['Loan Disbursement Target'] || '0'));

        if (isNaN(enrollmentTarget) || enrollmentTarget < 0) {
          totalFailed++;
          errors.push(`Row ${i + 2}: Enrollment Target must be a non-negative number`);
          continue;
        }

        const fdo = await prisma.user.findFirst({
          where: { employeeId, role: 'FDO', isActive: true },
          select: { id: true },
        });

        if (!fdo) {
          totalFailed++;
          errors.push(`Row ${i + 2}: FDO "${employeeId}" not found or inactive`);
          continue;
        }

        const data = {
          enrollmentTarget: isNaN(enrollmentTarget) ? 0 : enrollmentTarget,
          newMemberTarget: isNaN(newMemberTarget) ? 0 : newMemberTarget,
          renewalMemberTarget: isNaN(renewalMemberTarget) ? 0 : renewalMemberTarget,
          loanDisbursementTarget: isNaN(loanDisbursementTarget) ? 0 : loanDisbursementTarget,
        };

        const existing = await prisma.fdoTask.findUnique({
          where: { userId_month_year: { userId: fdo.id, month, year } },
        });

        if (existing) {
          await prisma.fdoTask.update({
            where: { userId_month_year: { userId: fdo.id, month, year } },
            data,
          });
          totalUpdated++;
        } else {
          await prisma.fdoTask.create({ data: { userId: fdo.id, month, year, ...data } });
          totalCreated++;
        }

        totalUploaded++;
      }

      return successResponse(
        { totalUploaded, totalCreated, totalUpdated, totalFailed, errors: errors.slice(0, 10) },
        'FDO tasks uploaded'
      );
    } catch (error) {
      console.error('Error processing FDO tasks:', error);
      return errorResponse('Failed to process FDO tasks', 500);
    }
  })(request);
}
