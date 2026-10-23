/**
 * Single source of truth for every report the /dashboard/hr/reports/[slug]
 * dynamic route can run — mirrors app/api/hr/reports/[slug]/route.ts's
 * REPORTS dispatch table exactly (same slugs). Used by the per-report page,
 * the Reports landing page (cards), and nowhere else.
 */
export type ReportCatalogEntry = {
    slug: string;
    label: string;
    category: 'Employee' | 'Attendance' | 'Leave' | 'Payroll' | 'Staff Loans & Advances' | 'Live Tracking';
    /** Report needs a From/To date filter to run (matches the API's rangeDates() usage per slug). */
    needsRange?: boolean;
    /** Shows a per-employee dropdown filter alongside the branch filter — only
     * reports the user asked for: Absentee, Late Attendance, Leave Balance,
     * Travel & Client Visit. The API supports employeeId on a few others too
     * (Leave Register, Salary/Deduction reports), but no UI filter was asked
     * for those, so it stays unused there for now. */
    supportsEmployeeFilter?: boolean;
    /** Shows a shift dropdown filter — for Late Attendance report. */
    supportsShiftFilter?: boolean;
    /** Shows a role dropdown filter (User.role) — for Missed Punch In report. */
    supportsRoleFilter?: boolean;
    /** Short explanatory note shown under the report title — for a report whose
     * numbers need a bit of context to read correctly (e.g. Travel Path
     * Similarity's Shared Distance figure). */
    note?: string;
    /** Staff Loan / Staff Advance reports: search box, department filter, cards, pagination (see StaffReportResult). */
    supportsSearch?: boolean;
    supportsDepartmentFilter?: boolean;
    /** A report-specific status dropdown; the first option is the "all" choice. */
    statusFilter?: { label: string; options: { value: string; label: string }[] };
    /** A Staff Loan / Staff Advance type dropdown; the first option is the "all" choice. */
    typeFilter?: { label: string; options: { value: string; label: string }[] };
    /** Month + Year selectors (payroll-month based reports). Defaults to the current month; 'All' is offered where the report spans months. */
    supportsMonthYear?: boolean;
    /** With needsRange: the From / To dates are shown but not required. */
    rangeOptional?: boolean;
    /** Shows the table 25 rows at a time (the export still contains every row). */
    paginated?: boolean;
};

export const REPORT_CATALOG: ReportCatalogEntry[] = [
    // Attendance, Leave & Permission
    { slug: 'late-attendance', label: 'Late Attendance Report', category: 'Attendance', needsRange: true, supportsEmployeeFilter: true, supportsShiftFilter: true },
    { slug: 'absentee', label: 'Absentee Report', category: 'Attendance', needsRange: true, supportsEmployeeFilter: true },
    { slug: 'leave-register', label: 'Leave Register', category: 'Attendance', needsRange: true, supportsEmployeeFilter: true },
    { slug: 'leave-balance', label: 'Leave Balance Report', category: 'Attendance', supportsEmployeeFilter: true, supportsMonthYear: true },
    { slug: 'permission-register', label: 'Permission Register', category: 'Attendance', needsRange: true, supportsEmployeeFilter: true },
    { slug: 'missed-punch-in', label: 'Missed Punch In Report', category: 'Attendance', needsRange: true, supportsRoleFilter: true },
    {
        slug: 'holiday-register', label: 'Holiday Report', category: 'Attendance', needsRange: true,
        typeFilter: { label: 'Type', options: [{ value: 'all', label: 'Holidays + Working-day overrides' }, { value: 'HOLIDAY', label: 'Holidays only' }, { value: 'WORKING_DAY', label: 'Working-day overrides only' }] },
        note: 'Dates set in the Holiday Calendar, one row per branch. A working-day override is a week-off day that the branch works.',
    },

    // Employee Lifecycle
    {
        slug: 'employee-master', label: 'Employee Master Report', category: 'Employee', supportsEmployeeFilter: true,
        statusFilter: { label: 'Status', options: [{ value: 'all', label: 'Active only' }, { value: 'inactive', label: 'Inactive only' }, { value: 'everyone', label: 'Active + Inactive' }] },
    },
    { slug: 'joining', label: 'Joining Report', category: 'Employee', needsRange: true },
    { slug: 'exit', label: 'Exit Report', category: 'Employee', needsRange: true },
    { slug: 'transfer', label: 'Transfer Report', category: 'Employee', needsRange: true },
    { slug: 'promotion', label: 'Promotion Report', category: 'Employee', needsRange: true },
    { slug: 'confirmation', label: 'Confirmation Report', category: 'Employee', needsRange: true },
    { slug: 'salary-register', label: 'Payroll Report', category: 'Payroll', supportsMonthYear: true },
    { slug: 'staff-loan-deduction', label: 'Staff Loan Deduction', category: 'Payroll', supportsMonthYear: true },
    { slug: 'staff-advance-deduction', label: 'Staff Advance Deduction', category: 'Payroll', supportsMonthYear: true },

    // Staff Loans & Staff Advances — scoped by the Staff Loan / Staff Advance register access (their own API routes).
    {
        slug: 'staff-outstanding', label: 'Total Staff Outstanding', category: 'Staff Loans & Advances',
        supportsEmployeeFilter: true, supportsSearch: true, supportsDepartmentFilter: true, paginated: true,
        typeFilter: { label: 'Type', options: [{ value: 'all', label: 'Staff Loan + Staff Advance' }, { value: 'LOAN', label: 'Staff Loan' }, { value: 'ADVANCE', label: 'Staff Advance' }] },
        note: 'One row per employee across all active Staff Loans and Staff Advances. A Staff Advance carries no interest. Salary columns are for the current payroll month from the existing payroll calculation.',
    },
    {
        slug: 'active-staff-loans', label: 'Active Staff Loans', category: 'Staff Loans & Advances',
        supportsEmployeeFilter: true, supportsSearch: true, supportsDepartmentFilter: true, paginated: true,
        statusFilter: { label: 'Status', options: [{ value: 'all', label: 'All' }, { value: 'ACTIVE', label: 'Active (on schedule)' }, { value: 'OVERDUE', label: 'Overdue' }] },
        note: 'Only loans currently being repaid; completed or settled loans are not listed.',
    },
    {
        slug: 'active-staff-advances', label: 'Active Staff Advances', category: 'Staff Loans & Advances',
        supportsEmployeeFilter: true, supportsSearch: true, supportsDepartmentFilter: true, paginated: true,
        statusFilter: { label: 'Status', options: [{ value: 'all', label: 'All' }, { value: 'ACTIVE', label: 'Active (on schedule)' }, { value: 'OVERDUE', label: 'Overdue' }] },
        note: 'Only advances currently being repaid. A Staff Advance carries no interest.',
    },
    {
        slug: 'staff-loan-closure', label: 'Staff Loan Closure', category: 'Staff Loans & Advances',
        needsRange: true, rangeOptional: true, supportsEmployeeFilter: true, supportsSearch: true, supportsDepartmentFilter: true, paginated: true,
        statusFilter: { label: 'Closure Type', options: [{ value: 'all', label: 'All' }, { value: 'EARLY_SETTLEMENT', label: 'Early Settlement' }, { value: 'REGULAR', label: 'Regular Repayment' }] },
        note: 'Loans that are closed. The date range is the day the loan was closed; leave it empty for all closed loans. Interest Waived is the future interest an early settlement did not charge.',
    },
    {
        slug: 'staff-advance-closure', label: 'Staff Advance Closure', category: 'Staff Loans & Advances',
        needsRange: true, rangeOptional: true, supportsEmployeeFilter: true, supportsSearch: true, supportsDepartmentFilter: true, paginated: true,
        statusFilter: { label: 'Closure Type', options: [{ value: 'all', label: 'All' }, { value: 'EARLY_SETTLEMENT', label: 'Early Settlement' }, { value: 'SALARY', label: 'Salary Deduction' }] },
        note: 'Advances that are completed. The date range is the day the advance was closed; leave it empty for all completed advances. A Staff Advance carries no interest.',
    },
    // These two have their own pages (list, then "View Schedule" like the MFI loan schedule); the entries feed the hub cards.
    { slug: 'staff-loan-schedule', label: 'Staff Loan Schedule', category: 'Staff Loans & Advances' },
    { slug: 'staff-advance-schedule', label: 'Staff Advance Schedule', category: 'Staff Loans & Advances' },

    // Field Tracking
    { slug: 'travel-client-visit', label: 'Travel & Client Visit Report', category: 'Live Tracking', needsRange: true, supportsEmployeeFilter: true },
    // Same-branch pairs whose GPS paths overlapped the same ground for a meaningful
    // distance — see attendance-hr/plan-travel-similarity-report.md. A separate report
    // (not a tab on Travel & Client Visit above) since its rows are employee PAIRS, not
    // one row per employee per day.
    {
        slug: 'travel-similarity', label: 'Travel Path Similarity Report', category: 'Live Tracking', needsRange: true,
        note: 'Shared Distance is the average of what each employee\'s own GPS pings measured for the overlapping stretch — it can be slightly higher than one employee\'s own Total KM if their pings were sparser there than the other employee\'s, and is only ever bounded by the higher of the two Total KM figures, not the lower one.',
    },
];

/** Reports already generated on their own existing pages elsewhere in the app
 * — shown as quick-link cards on the Reports landing page, but deliberately
 * left out of REPORT_CATALOG/the sidebar submenu since they aren't run
 * through this dynamic [slug] flow. */
export const EXTERNAL_REPORT_LINKS: { label: string; href: string; category: ReportCatalogEntry['category'] }[] = [
    { label: 'Attendance Detailed Report', href: '/dashboard/reports/employee/attendance-detailed', category: 'Attendance' },
    { label: 'Attendance Summary Report', href: '/dashboard/reports/employee/attendance-summary', category: 'Attendance' },
    { label: 'Payslip', href: '/dashboard/mis-reports', category: 'Payroll' },
    { label: 'Incentive Report', href: '/dashboard/reports/employee/incentive-report', category: 'Payroll' },
    { label: 'Live Employee Map', href: '/dashboard/hr/tracking/live', category: 'Live Tracking' },
    { label: 'FDO Task Report', href: '/dashboard/reports/employee/task-report', category: 'Employee' },
];

export function getReportCatalogEntry(slug: string): ReportCatalogEntry | undefined {
    return REPORT_CATALOG.find((r) => r.slug === slug);
}
