import { staffReportGet, staffReportOptions } from '@/app/lib/staff-reports/route-handler';

export const OPTIONS = staffReportOptions;
export const GET = staffReportGet('active-staff-advances');
