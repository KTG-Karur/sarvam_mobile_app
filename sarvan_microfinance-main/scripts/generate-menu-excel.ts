import * as XLSX from "xlsx";
import path from "path";

const Y = "✓";
const N = "";

type Row = {
  Section: string;
  "Sub-Menu": string;
  Path: string;
  Description: string;
  ADMIN: string;
  BRANCH_MANAGER: string;
  AREA_MANAGER: string;
  FDO: string;
  ADMIN_NON_HO: string;
};

function r(
  section: string,
  sub: string,
  pathUrl: string,
  desc: string,
  admin: boolean,
  bm: boolean,
  am: boolean,
  fdo: boolean,
  nonHo: boolean
): Row {
  return {
    Section: section,
    "Sub-Menu": sub,
    Path: pathUrl,
    Description: desc,
    ADMIN: admin ? Y : N,
    BRANCH_MANAGER: bm ? Y : N,
    AREA_MANAGER: am ? Y : N,
    FDO: fdo ? Y : N,
    ADMIN_NON_HO: nonHo ? Y : N,
  };
}

const rows: Row[] = [
  // ── Dashboard ──────────────────────────────────────────────────────────────
  r("Dashboard", "Dashboard", "/dashboard", "Main overview dashboard for all users", true, true, true, true, true),

  // ── Branch ─────────────────────────────────────────────────────────────────
  r("Branch", "Create Branch", "/dashboard/branch/create", "Create a new branch", true, false, false, false, false),
  r("Branch", "Product Map", "/dashboard/branch/product-map", "Map loan products to branches", true, false, false, false, false),
  r("Branch", "Branch Working Date", "/dashboard/branch/working-date", "View the current working (EOD) date for every branch", true, false, false, false, false),

  // ── Center Operations ───────────────────────────────────────────────────────
  r("Center Operations", "Create Center", "/dashboard/centers/create-center", "Create a new collection center", false, true, false, false, false),
  r("Center Operations", "Center Approval", "/dashboard/centers/create-center", "Approve pending center creation requests", false, false, true, false, true),
  r("Center Operations", "Groups", "/dashboard/centers/groups", "Manage client groups within centers", false, true, false, false, true),
  r("Center Operations", "Transfer", "/dashboard/centers/transfer", "Transfer clients between centers", false, true, true, false, true),
  r("Center Operations", "Locate Center", "/dashboard/centers/locate", "View center locations on map", false, true, true, false, true),

  // ── Client ─────────────────────────────────────────────────────────────────
  r("Client", "Search & Locate", "/dashboard/client-search", "Search and locate clients across branches", true, true, true, true, true),
  r("Client", "Client Enrollment", "/dashboard/client/enrollment", "Enroll new clients into the system", false, false, false, true, false),
  r("Client", "KYC Documents", "/dashboard/client/kyc-documents", "Upload and manage KYC documents", true, false, false, true, true),
  r("Client", "KYC Update", "/dashboard/client/kyc-update", "Update existing KYC information", true, false, false, true, true),
  r("Client", "Client Approval", "/dashboard/approval/workbench", "Review and approve client enrollment applications", true, true, true, false, true),
  r("Client", "Co Applicant", "/dashboard/client/co-applicant", "Add or manage co-applicant details", true, false, false, true, true),
  r("Client", "Client Update", "/dashboard/client/client-update", "Update existing client profile information", true, false, false, true, true),
  r("Client", "Group Assign", "/dashboard/client-operations/group-assign", "Assign clients to collection groups", false, true, false, false, true),
  r("Client", "Transfer", "/dashboard/client-operations/transfer", "Transfer a client to another branch or center", false, true, true, false, true),
  r("Client", "Inactive", "/dashboard/client-operations/inactive", "Mark a client as inactive", false, true, false, false, true),
  r("Client", "Re-active", "/dashboard/client-operations/reactive", "Reactivate a previously inactive client", false, true, false, false, true),
  r("Client", "Client Validation", "/dashboard/client/enrollment-validation", "Validate bulk client enrollment data", true, false, false, false, false),

  // ── Collections ────────────────────────────────────────────────────────────
  r("Collections", "Collection Approval", "/dashboard/collections/approval", "Approve pending loan repayment collections", false, true, false, false, false),
  r("Collections", "Demand Collection", "/dashboard/collections/demand-collection", "Collect scheduled EMI demand from center meetings", false, false, false, true, false),
  r("Collections", "Single Collection", "/dashboard/collections/client-late-collection/single-collection", "Collect late repayment from a single client", false, false, false, true, false),
  r("Collections", "Bulk Collection", "/dashboard/collections/client-late-collection/bulk-collection", "Collect late repayments from multiple clients at once", false, false, false, true, false),
  r("Collections", "Preclosure", "/dashboard/collections/foreclosure", "Initiate early loan closure for a client", false, true, false, false, true),
  r("Collections", "Loan Advance Refund", "/dashboard/collections/savings-refund", "Refund loan advance / savings to client", true, true, false, false, false),
  r("Collections", "Preclosure Approval", "/dashboard/collections/foreclosure-approval", "Approve pending preclosure requests", true, false, true, false, false),
  r("Collections", "Delete Demand Collection", "/dashboard/collections/delete-demand-collection", "Delete an incorrectly entered demand collection", false, true, false, false, true),
  r("Collections", "Delete Client Collection", "/dashboard/collections/delete-client-collection", "Delete an incorrectly entered client collection", false, true, false, false, true),
  r("Collections", "Delete Preclosure", "/dashboard/collections/delete-foreclosure", "Delete an incorrectly initiated preclosure", false, true, false, false, true),

  // ── HR — Attendance / Leave / Permission ────────────────────────────────────
  r("HR Management", "Attendance", "/dashboard/hr/attendance", "Record and view staff attendance", false, true, true, false, false),
  r("Leave Management", "Apply Leave", "/dashboard/hr/leave/apply", "Apply for and track your own leave", false, true, false, false, false),
  r("Leave Management", "Leave Approval", "/dashboard/hr/leave/approval", "Review and approve team leave requests", false, false, true, false, false),
  r("Leave Management", "Leave Balance", "/dashboard/hr/leave-balance", "View and adjust staff leave balances", false, false, true, false, false),
  r("Permission Management", "Apply Permission", "/dashboard/hr/permission/apply", "Apply for and track your own short permission (gate-pass)", false, true, false, false, false),
  r("Permission Management", "Permission Approval", "/dashboard/hr/permission/approval", "Review and approve team permission requests", false, false, true, false, false),
  r("HR Administration", "Leave Type", "/dashboard/hr/leave-type", "Configure leave type categories", false, false, true, false, false),
  r("HR Administration", "Permission Type", "/dashboard/hr/permission-type", "Configure short-duration permission (gate-pass) categories", false, false, true, false, false),
  r("HR Administration", "Working Hours", "/dashboard/hr/working-hours", "Configure shift timing and Half Day / Full Day hour thresholds", false, false, true, false, false),
  r("HR Administration", "Week Configuration", "/dashboard/hr/attendance/week-configuration", "Configure per-branch weekly off days", false, false, true, false, false),
  r("HR Administration", "Holiday Calendar", "/dashboard/hr/attendance/holiday-calendar", "Manage per-branch holidays and working-day overrides", false, false, true, false, false),
  r("Payroll & Compensation", "Salary", "/dashboard/hr/salary", "View employee salary details", false, false, true, false, false),
  r("Payroll & Compensation", "Salary Master", "/dashboard/hr/salary-master", "Configure base salary structures", false, false, true, false, false),
  r("Payroll & Compensation", "Salary Pay", "/dashboard/hr/salary-pay", "Process monthly salary payments", false, false, true, false, false),
  r("Payroll & Compensation", "Payroll", "/dashboard/hr/payroll", "Generate and manage payroll runs", false, true, true, false, true),

  // ── Loan Module ─────────────────────────────────────────────────────────────
  r("Loan Module", "Application", "/dashboard/loan-module/application", "Create new loan applications for clients", false, false, false, true, false),
  r("Loan Module", "Loan Indexation", "/dashboard/loan-module/loan-indexation", "Index and verify loan applications before approval", false, true, false, false, true),
  r("Loan Module", "Disbursement", "/dashboard/loan-module/disbursement", "Approve Level-2 disbursement of loans", false, false, true, false, false),
  r("Loan Module", "Final Disbursement", "/dashboard/loan-module/final-disbursement", "Execute final cash/bank disbursement to clients", false, true, false, false, true),
  r("Loan Module", "Change Funder", "/dashboard/loan-module/change-funder", "Change the funding source for a disbursed loan", false, true, false, false, false),
  r("Loan Module", "Delete Disbursement", "/dashboard/loan-module/delete-disbursement", "Delete an erroneous disbursement record", false, true, false, false, false),
  r("Loan Module", "Member Individual", "/dashboard/loan-module/member-individual", "Collect Cash Flow, Loan Appraisal, House Hold Visit and GRT details per indexed client", true, true, true, false, true),
  r("Loan Module", "Loan Tracker", "/dashboard/loan-module/loan-tracker", "Track loan status across the lifecycle", true, true, true, true, true),

  // ── Daily Monitoring ────────────────────────────────────────────────────────
  r("Daily Monitoring", "New Zero Collection", "/dashboard/daily-monitoring/new-zero-collection", "Monitor new clients with zero collection today", true, true, true, false, false),
  r("Daily Monitoring", "Collection Followup", "/dashboard/daily-monitoring/collection-followup", "Follow up on pending and overdue collections", true, true, true, false, false),
  r("Daily Monitoring", "Advance Collection", "/dashboard/daily-monitoring/advance-collection", "Track advance payments received from clients", true, true, true, false, false),
  r("Daily Monitoring", "Inter Branch", "/dashboard/daily-monitoring/inter-branch", "Monitor inter-branch fund movements", true, false, true, false, false),

  // ── Masters ─────────────────────────────────────────────────────────────────
  r("Masters", "Role Management", "/dashboard/admin/roles", "Create and manage RBAC roles and permissions", true, false, false, false, false),
  r("Masters", "Client Approval Workflow", "/dashboard/masters/client-approval-workflow", "Configure the client CR-3 approval workflow stages", true, false, false, false, false),
  r("Masters", "Funder", "/dashboard/masters/funder", "Manage external funding institutions", true, false, false, false, false),
  r("Masters", "GL Master", "/dashboard/masters/gl", "Configure general ledger accounts", true, false, false, false, false),
  r("Masters", "Loan Product Type", "/dashboard/masters/loan-product-type", "Define loan product categories", true, false, false, false, false),
  r("Masters", "Loan Product", "/dashboard/masters/loan-product", "Create and configure loan products", true, false, false, false, false),
  r("Masters", "Loan Purpose Type", "/dashboard/masters/loan-purpose-type", "Define loan purpose categories", true, false, false, false, false),
  r("Masters", "Loan Purpose", "/dashboard/masters/loan-purpose", "Configure specific loan purpose options", true, false, false, false, false),
  r("Masters", "Leave Type", "/dashboard/masters/leave-type", "Define HR leave type options", true, false, false, false, false),
  r("Masters", "Economic Activity Type", "/dashboard/masters/economic-activity-type", "Define economic activity categories for clients", true, false, false, false, false),
  r("Masters", "Economic Activity", "/dashboard/masters/economic-activity", "Configure specific economic activities", true, false, false, false, false),
  r("Masters", "Questionnaire", "/dashboard/masters/questionnaire", "Manage client enrollment questionnaire", true, false, false, false, false),
  r("Masters", "Bulk Create", "/dashboard/masters/bulk-create", "Bulk import clients, loans, or centers via Excel", true, false, false, false, false),
  r("Masters", "Ongoing Loan Backup", "/dashboard/masters/ongoing-loan-backup", "Backup and restore active loan data", true, false, false, false, false),
  r("Masters", "Regions", "/dashboard/masters/regions", "Configure geographic regions", true, false, false, false, false),
  r("Masters", "Divisions", "/dashboard/masters/divisions", "Configure divisions within regions", true, false, false, false, false),
  r("Masters", "Areas", "/dashboard/masters/areas", "Configure areas within divisions", true, false, false, false, false),

  // ── Gold Loan ───────────────────────────────────────────────────────────────
  r("Gold Loan", "Gold Return", "/dashboard/gold-return", "Initiate and approve gold collateral return to client", true, true, true, false, false),

  // ── Employees ───────────────────────────────────────────────────────────────
  r("Employees", "User Management", "/dashboard/employees/management", "Create, edit, and deactivate staff user accounts", true, true, true, false, false),
  r("Employees", "Reset Password", "/dashboard/employees/reset-password", "Reset staff account passwords", true, true, true, true, false),

  // ── Accounts ────────────────────────────────────────────────────────────────
  r("Accounts", "Accounts Group", "/dashboard/accounts/group", "Manage GL account groups", true, false, false, false, false),
  r("Accounts", "Accounts Ledger", "/dashboard/accounts/ledger", "Manage individual GL ledger accounts", true, false, false, false, false),
  r("Accounts", "Self Accounts", "/dashboard/accounts/self-accounts", "Manage branch-own fund accounts", true, false, false, false, false),

  // ── Transactions ────────────────────────────────────────────────────────────
  r("Transactions", "Cash Receipt", "/dashboard/transactions/cash-receipt", "Record cash received at branch", true, true, false, false, false),
  r("Transactions", "Cash Payment", "/dashboard/transactions/cash-payment", "Record cash paid out from branch", true, true, false, false, false),
  r("Transactions", "Bank Receipt", "/dashboard/transactions/bank-receipt", "Record funds received via bank transfer", true, true, false, false, false),
  r("Transactions", "Bank Payment", "/dashboard/transactions/bank-payment", "Record payments made via bank transfer", true, true, false, false, false),
  r("Transactions", "Journal", "/dashboard/transactions/journal", "Pass manual journal entries for GL adjustments", true, true, false, false, false),
  r("Transactions", "Contra", "/dashboard/transactions/contra", "Record cash-to-bank or bank-to-cash transfers", true, true, false, false, false),
  r("Transactions", "Transaction Approval", "/dashboard/transactions/approval", "Approve pending financial transactions", true, false, true, false, false),
  r("Transactions", "Modification", "/dashboard/transactions/modification", "Modify or correct approved transaction entries", true, false, false, false, false),

  // ── Reports › Demand ────────────────────────────────────────────────────────
  r("Reports › Demand", "Demand Sheet", "/dashboard/reports/demand/demand-sheet", "Daily EMI demand sheet for a center meeting", true, true, true, true, true),
  r("Reports › Demand", "Future Demand", "/dashboard/reports/demand/future-demand", "Upcoming EMI demand for selected date range", true, true, true, true, true),
  r("Reports › Demand", "Branch Demand", "/dashboard/reports/demand/branch-demand", "Branch-level consolidated demand summary", true, true, true, true, true),

  // ── Reports › Client ────────────────────────────────────────────────────────
  r("Reports › Client", "Application Form", "/dashboard/reports/client/application-form", "Print client loan application form", true, true, true, true, true),
  r("Reports › Client", "Balance Information", "/dashboard/reports/client/balance-information", "Outstanding balance summary per client", true, true, true, true, true),
  r("Reports › Client", "Loan Schedule", "/dashboard/reports/client/loan-schedule", "Full repayment schedule for a client loan", true, true, true, true, true),
  r("Reports › Client", "Loan Ledger", "/dashboard/reports/client/loan-ledger", "Transaction-level loan ledger for a client", true, true, true, true, true),
  r("Reports › Client", "Addition Deletion", "/dashboard/reports/client/addition-deletion", "Report of clients added or removed in a period", true, true, true, true, true),
  r("Reports › Client", "Addition Disbursed", "/dashboard/reports/client/addition-disbursed", "Newly added clients with loan disbursement details", true, true, true, true, true),
  r("Reports › Client", "Dropouts", "/dashboard/reports/client/dropouts", "List of clients who have dropped out", true, true, true, true, true),
  r("Reports › Client", "Meeting Attendance", "/dashboard/reports/client/meeting-attendance", "Client attendance records for center meetings", true, true, true, true, true),
  r("Reports › Client", "Transfer", "/dashboard/reports/client/transfer", "History of client transfers between centers/branches", true, true, true, true, true),
  r("Reports › Client", "Double Clients", "/dashboard/reports/client/double-clients", "Detect duplicate client records across branches", true, true, true, true, true),
  r("Reports › Client", "Waiting Borrowers", "/dashboard/reports/client/waiting-borrowers", "Clients approved but awaiting loan disbursement", true, true, true, true, true),
  r("Reports › Client", "Loan Advance Ledger", "/dashboard/reports/client/loan-advance", "Ledger of advance / savings amounts per client", true, true, true, true, true),

  // ── Reports › Collection ────────────────────────────────────────────────────
  r("Reports › Collection", "MCR", "/dashboard/reports/collection/mcr", "Monthly Collection Report per center", true, true, true, true, true),
  r("Reports › Collection", "DCR", "/dashboard/reports/collection/dcr", "Daily Collection Report for a date", true, true, true, true, true),
  r("Reports › Collection", "DCB", "/dashboard/reports/collection/dcb", "Demand, Collection & Balance report", true, true, true, true, true),
  r("Reports › Collection", "CCR", "/dashboard/reports/collection/ccr", "Center Collection Report with member breakdown", true, true, true, true, true),
  r("Reports › Collection", "Meeting Check", "/dashboard/reports/collection/meeting-check", "Verify collection entries against meeting records", true, true, true, true, true),
  r("Reports › Collection", "Receipts", "/dashboard/reports/collection/receipts", "Print official payment receipts for collections", true, true, true, true, true),
  r("Reports › Collection", "Loan Advance", "/dashboard/reports/collection/loan-savings", "Collection report for loan advance / savings", true, true, true, true, true),

  // ── Reports › Portfolio ─────────────────────────────────────────────────────
  r("Reports › Portfolio", "OS Branchwise", "/dashboard/admin-reports/portfolio/os-branchwise", "Outstanding loan portfolio by branch", true, true, true, true, true),
  r("Reports › Portfolio", "Individual Ledger", "/dashboard/reports/portfolio/individual-ledger", "Individual loan ledger for portfolio review", true, true, true, true, true),
  r("Reports › Portfolio", "Loan Disbursement", "/dashboard/reports/portfolio/loan-disbursement", "Summary of disbursements for a date range", true, true, true, true, true),
  r("Reports › Portfolio", "OS Centerwise", "/dashboard/reports/portfolio/os-centerwise", "Outstanding portfolio broken down by center", true, true, true, true, true),
  r("Reports › Portfolio", "OS Clientwise", "/dashboard/admin-reports/portfolio/os-clientwise", "Outstanding portfolio per client", true, true, true, true, true),
  r("Reports › Portfolio", "Clientwise DCB", "/dashboard/admin-reports/portfolio/clientwise-dcb", "Demand, Collection & Balance per client", true, true, true, true, true),
  r("Reports › Portfolio", "PAR", "/dashboard/reports/portfolio/par", "Portfolio at Risk report by aging buckets", true, true, true, true, true),
  r("Reports › Portfolio", "Preclosure", "/dashboard/reports/portfolio/preclosure", "List of foreclosed loans in a period", true, true, true, true, true),
  r("Reports › Portfolio", "Agewise Arrear", "/dashboard/admin-reports/portfolio/agewise-arrear", "Arrear aging analysis across the portfolio", true, true, true, true, true),
  r("Reports › Portfolio", "Center Master Report", "/dashboard/admin-reports/portfolio/center-master-report", "Master data summary for all centers", true, true, true, true, true),

  // ── Reports › Account ───────────────────────────────────────────────────────
  r("Reports › Account", "Daybook", "/dashboard/admin-reports/account/daybook", "Daily GL transaction daybook", true, true, true, true, true),
  r("Reports › Account", "GL One", "/dashboard/admin-reports/account/gl-one", "Ledger statement for a single GL account", true, true, true, true, true),
  r("Reports › Account", "GL All", "/dashboard/admin-reports/account/gl-all", "Statement for all GL accounts in a period", true, true, true, true, true),
  r("Reports › Account", "Receipts & Payments", "/dashboard/admin-reports/account/receipts-payments", "Receipts and payments summary statement", true, true, true, true, true),
  r("Reports › Account", "Trial Balance", "/dashboard/admin-reports/account/trial-balance", "Trial balance as of a selected date", true, true, true, true, true),
  r("Reports › Account", "Voucher Print", "/dashboard/admin-reports/account/voucher-print", "Print accounting vouchers for transactions", true, true, true, true, true),
  r("Reports › Account", "Compare ILGL", "/dashboard/admin-reports/account/compare-ilgl", "Compare individual loan GL vs ledger balances", true, true, true, true, true),

  // ── Reports › Employee ──────────────────────────────────────────────────────
  r("Reports › Employee", "Attendance Detailed", "/dashboard/reports/employee/attendance-detailed", "Detailed daily attendance log per employee", true, true, true, true, true),
  r("Reports › Employee", "Attendance Summary", "/dashboard/reports/employee/attendance-summary", "Monthly attendance summary per employee", true, true, true, true, true),
  r("Reports › Employee", "FDO Performance", "/dashboard/reports/employee/fdo-performance", "FDO productivity and collection performance", true, true, true, true, true),
  r("Reports › Employee", "Task Report", "/dashboard/reports/employee/task-report", "Status report for FDO-assigned tasks", true, true, true, true, true),
  r("Reports › Employee", "Payslip", "/dashboard/reports/employee/payslip", "Monthly payslip for a selected employee", true, true, true, true, true),

  // ── Reports › Funders ───────────────────────────────────────────────────────
  r("Reports › Funders", "Funder Report", "/dashboard/admin-reports/funders/funder-report", "Loan portfolio split by funding institution", true, true, true, true, true),
  r("Reports › Funders", "Funder Interest", "/dashboard/admin-reports/funders/funder-interest", "Interest accrued per funder for a period", true, true, true, true, true),

  // ── Reports › Others ────────────────────────────────────────────────────────
  r("Reports › Others", "Denomination", "/dashboard/reports/others/denomination-collection", "Cash denomination breakdown of collections", true, true, true, true, true),
  r("Reports › Others", "Branch Profile", "/dashboard/reports/others/branch-profile", "Branch configuration and KPI snapshot", true, true, true, true, true),
  r("Reports › Others", "Center Master", "/dashboard/reports/others/center-master", "Master list of all centers in a branch", true, true, true, true, true),
  r("Reports › Others", "Insurance", "/dashboard/reports/others/insurance", "Client insurance coverage and premium report", true, true, true, true, true),
  r("Reports › Others", "Loan Index", "/dashboard/reports/others/loan-index", "Index of all loans with key parameters", true, true, true, true, true),
  r("Reports › Others", "Pending Items", "/dashboard/reports/others/pending-items", "List of items pending approval or action", true, true, true, true, true),
  r("Reports › Others", "Highmark Update", "/dashboard/admin-reports/others/highmark-update", "Credit bureau (Highmark) update status", true, true, true, true, true),
  r("Reports › Others", "SMS Format", "/dashboard/admin-reports/others/sms-format", "SMS notification log and format report", true, true, true, true, true),
  r("Reports › Others", "NEFT Format", "/dashboard/reports/others/neft-format", "NEFT disbursement file format export", true, true, true, true, true),

  // ── Reports › Gold ──────────────────────────────────────────────────────────
  r("Reports › Gold", "Gold Taken", "/dashboard/reports/gold", "Report of gold items taken as collateral", true, true, true, true, true),

  // ── MIS Reports ─────────────────────────────────────────────────────────────
  r("MIS Reports", "Company Profile", "/dashboard/mis-reports/company-profile", "Organisation-level KPI and profile summary", true, false, false, false, false),
  r("MIS Reports", "All DCB", "/dashboard/mis-reports/all-dcb", "Consolidated DCB across all branches", true, false, true, false, false),
  r("MIS Reports", "Branch Demand", "/dashboard/mis-reports/branch-demand", "Branch-level demand MIS for management", true, false, true, false, false),
  r("MIS Reports", "Disbursement", "/dashboard/mis-reports/disbursement", "MIS disbursement summary across branches", true, false, true, false, false),
  r("MIS Reports", "Loan OS Details", "/dashboard/mis-reports/loan-os-details", "Outstanding loan details MIS across branches", true, false, true, false, false),
  r("MIS Reports", "Arrear Report", "/dashboard/mis-reports/agewise-arrear", "MIS aging arrear analysis for management", true, false, false, false, false),
  r("MIS Reports", "Preclosure", "/dashboard/mis-reports/preclosure", "MIS preclosure summary across branches", true, false, true, false, false),
  r("MIS Reports", "Performance", "/dashboard/mis-reports/performance", "Branch and staff performance MIS", true, false, true, false, false),
  r("HR - Performance", "FDO Task Management", "/dashboard/hr/performance/tasks", "Assign and manage monthly targets for FDO staff", true, false, false, false, false),
  r("MIS Reports", "Ledger Report", "/dashboard/mis-reports/ledger-report", "GL ledger report for management review", true, false, true, false, false),

  // ── EOD ─────────────────────────────────────────────────────────────────────
  r("EOD", "EOD Process", "/dashboard/eod/eod-process", "Run End-of-Day processing to close the business date", false, true, false, false, true),

  // ── Utilities ───────────────────────────────────────────────────────────────
  r("Utilities", "Set GL Balance", "/dashboard/utilities/set-gl-balance", "Manually set opening GL balances for a branch", true, true, true, false, false),
];

const wb = XLSX.utils.book_new();
const ws = XLSX.utils.json_to_sheet(rows);

// Column widths
ws["!cols"] = [
  { wch: 22 },  // Section
  { wch: 28 },  // Sub-Menu
  { wch: 52 },  // Path
  { wch: 58 },  // Description
  { wch: 8 },   // ADMIN
  { wch: 17 },  // BRANCH_MANAGER
  { wch: 15 },  // AREA_MANAGER
  { wch: 6 },   // FDO
  { wch: 14 },  // ADMIN_NON_HO
];

XLSX.utils.book_append_sheet(wb, ws, "Side Menus");

const outPath = path.join(__dirname, "..", "sample excel", "menu-roles.xlsx");
XLSX.writeFile(wb, outPath);
console.log(`Written to: ${outPath}`);
console.log(`Total rows: ${rows.length}`);
