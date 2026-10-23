import { NextRequest } from 'next/server';
import { handleCorsPreflight, successResponse } from '@/app/lib/api-utils';
import { withStaffLoanActor } from '@/app/lib/staff-loans/application-access';
import { getStaffScheduleDetail, listStaffSchedules, runStaffReport, staffReportFilterSchema, type StaffReportSlug } from './service';
import type { ScheduleKind } from './schedule-types';

/**
 * GET handler shared by the five Staff Loan / Staff Advance report routes under /api/hr/reports/<slug>. They sit
 * next to the generic [slug] HR report route (a static folder wins over the dynamic one) because these reports are
 * scoped by the Staff Loan register access, not by the payroll permission the generic route checks.
 */
export const staffReportOptions = () => handleCorsPreflight();

export function staffReportGet(slug: StaffReportSlug) {
    return (request: NextRequest) => withStaffLoanActor(async (req, actor) => {
        const { searchParams } = new URL(req.url);
        const filters = staffReportFilterSchema.parse({
            search: searchParams.get('search') || undefined,
            branchId: searchParams.get('branchId') || undefined,
            departmentId: searchParams.get('departmentId') || undefined,
            employeeId: searchParams.get('employeeId') || undefined,
            status: searchParams.get('status') || undefined,
            type: searchParams.get('type') || undefined,
            fromDate: searchParams.get('fromDate') || undefined,
            toDate: searchParams.get('toDate') || undefined,
        });
        const result = await runStaffReport(slug, actor, filters);
        return successResponse(result, `${result.reportName} fetched successfully`);
    })(request);
}

/**
 * GET handler of the two schedule reports: the list of loans / advances, or (with `id`) one repayment schedule.
 */
export function staffScheduleGet(kind: ScheduleKind) {
    return (request: NextRequest) => withStaffLoanActor(async (req, actor) => {
        const { searchParams } = new URL(req.url);
        const id = searchParams.get('id');
        if (id) return successResponse(await getStaffScheduleDetail(kind, actor, id), 'Schedule fetched successfully');
        const filters = staffReportFilterSchema.parse({
            search: searchParams.get('search') || undefined,
            branchId: searchParams.get('branchId') || undefined,
            departmentId: searchParams.get('departmentId') || undefined,
            employeeId: searchParams.get('employeeId') || undefined,
            status: searchParams.get('status') || undefined,
        });
        return successResponse(await listStaffSchedules(kind, actor, filters), 'Schedule list fetched successfully');
    })(request);
}
