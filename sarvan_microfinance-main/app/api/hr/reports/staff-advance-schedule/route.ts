import { staffReportOptions, staffScheduleGet } from '@/app/lib/staff-reports/route-handler';

export const OPTIONS = staffReportOptions;
export const GET = staffScheduleGet('ADVANCE');
