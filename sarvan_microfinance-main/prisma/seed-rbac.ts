// ============================================================
// RBAC DATABASE SEEDER
// prisma/seed-rbac.ts
//
// Run: npx tsx prisma/seed-rbac.ts
//
// This seeds:
//   1. Standard modules (Loan, Collection, Gold Loan, etc.)
//   2. Standard actions (view, create, edit, delete, approve, etc.)
//   3. Permissions (module + action combinations)
//   4. System roles (migrated from UserRole enum)
//   5. Role permissions (migrated from hardcoded PERMISSIONS object)
//   6. Menu items
// ============================================================

import { PrismaClient } from '@prisma/client';
import { DEFAULT_WORKFLOWS } from '../app/lib/approval/default-workflows';

const prisma = new PrismaClient();

// ─────────────────────────────────────────────
// MODULES — Replace hardcoded route sections
// ─────────────────────────────────────────────
const MODULES = [
  { name: 'Dashboard', slug: 'dashboard', icon: 'LayoutDashboard', sortOrder: 1, isSystem: true },
  { name: 'Branch', slug: 'branch', icon: 'Building2', sortOrder: 2, isSystem: true },
  { name: 'Centers', slug: 'centers', icon: 'MapPin', sortOrder: 3, isSystem: true },
  { name: 'Clients', slug: 'clients', icon: 'Users', sortOrder: 4, isSystem: true },
  { name: 'KYC', slug: 'kyc', icon: 'FileCheck', sortOrder: 5, isSystem: true },
  { name: 'Loan', slug: 'loan', icon: 'CreditCard', sortOrder: 6, isSystem: true },
  { name: 'Collection', slug: 'collection', icon: 'Receipt', sortOrder: 7, isSystem: true },
  { name: 'Gold Loan', slug: 'gold-loan', icon: 'Gem', sortOrder: 8, isSystem: true },
  { name: 'Savings', slug: 'savings', icon: 'PiggyBank', sortOrder: 9, isSystem: true },
  { name: 'Accounts', slug: 'accounts', icon: 'BookOpen', sortOrder: 10, isSystem: true },
  { name: 'Transactions', slug: 'transactions', icon: 'ArrowLeftRight', sortOrder: 11, isSystem: true },
  { name: 'Reports', slug: 'reports', icon: 'BarChart3', sortOrder: 12, isSystem: true },
  { name: 'MIS Reports', slug: 'mis-reports', icon: 'FileSpreadsheet', sortOrder: 13, isSystem: true },
  { name: 'Daily Monitoring', slug: 'daily-monitoring', icon: 'Activity', sortOrder: 14, isSystem: true },
  { name: 'Payroll', slug: 'payroll', icon: 'Banknote', sortOrder: 15, isSystem: true },
  { name: 'Insurance', slug: 'insurance', icon: 'Shield', sortOrder: 16, isSystem: true },
  { name: 'Audit', slug: 'audit', icon: 'ClipboardCheck', sortOrder: 17, isSystem: true },
  { name: 'Questionnaire', slug: 'questionnaire', icon: 'HelpCircle', sortOrder: 18, isSystem: true },
  { name: 'Utilities', slug: 'utilities', icon: 'Settings', sortOrder: 19, isSystem: true },
  { name: 'Masters', slug: 'masters', icon: 'Database', sortOrder: 20, isSystem: true },
  // ── HR Management (phased rollout — see .claude/plans/hr-management-module-1-rosy-wind.md) ──
  { name: 'HR Management', slug: 'hr', icon: 'Users2', sortOrder: 21, isSystem: true },
  { name: 'HR Employee', slug: 'hr-employee', icon: 'IdCard', sortOrder: 22, isSystem: true },
  { name: 'HR Confirmation', slug: 'hr-confirmation', icon: 'BadgeCheck', sortOrder: 23, isSystem: true },
  { name: 'HR Promotion', slug: 'hr-promotion', icon: 'TrendingUp', sortOrder: 24, isSystem: true },
  { name: 'HR Transfer', slug: 'hr-transfer', icon: 'ArrowRightLeft', sortOrder: 25, isSystem: true },
  { name: 'HR Exit', slug: 'hr-exit', icon: 'LogOut', sortOrder: 26, isSystem: true },
  { name: 'HR Attendance', slug: 'hr-attendance', icon: 'CalendarCheck', sortOrder: 27, isSystem: true },
  { name: 'HR Leave', slug: 'hr-leave', icon: 'CalendarRange', sortOrder: 28, isSystem: true },
  { name: 'HR Payroll', slug: 'hr-payroll', icon: 'Banknote', sortOrder: 29, isSystem: true },
  { name: 'HR Incentive', slug: 'hr-incentive', icon: 'Award', sortOrder: 30, isSystem: true },
  { name: 'HR Performance', slug: 'hr-performance', icon: 'Target', sortOrder: 31, isSystem: true },
  { name: 'HR Tracking', slug: 'hr-tracking', icon: 'MapPinned', sortOrder: 32, isSystem: true },
  { name: 'HR Policy', slug: 'hr-policy', icon: 'FileText', sortOrder: 33, isSystem: true },
  { name: 'HR Onboarding', slug: 'hr-onboarding', icon: 'UserPlus', sortOrder: 34, isSystem: true },
  { name: 'Admin', slug: 'admin', icon: 'ShieldCheck', sortOrder: 99, isSystem: true },
] as const;

// ─────────────────────────────────────────────
// ACTIONS — Standard set for all modules
// ─────────────────────────────────────────────
const ACTIONS = [
  { name: 'View', slug: 'view', isSystem: true },
  { name: 'Create', slug: 'create', isSystem: true },
  { name: 'Edit', slug: 'edit', isSystem: true },
  { name: 'Delete', slug: 'delete', isSystem: true },
  { name: 'Approve', slug: 'approve', isSystem: true },
  { name: 'Reject', slug: 'reject', isSystem: true },
  { name: 'Verify', slug: 'verify', isSystem: true },
  { name: 'Export', slug: 'export', isSystem: true },
  { name: 'Print', slug: 'print', isSystem: true },
  { name: 'Disburse', slug: 'disburse', isSystem: true },
  { name: 'Reverse', slug: 'reverse', isSystem: true },
  { name: 'Close', slug: 'close', isSystem: true },
  { name: 'Reopen', slug: 'reopen', isSystem: true },
  { name: 'Assign', slug: 'assign', isSystem: true },
  { name: 'Reschedule', slug: 'reschedule', isSystem: true },
  { name: 'Waive', slug: 'waive', isSystem: true },
  { name: 'Override', slug: 'override', isSystem: true },
  { name: 'Upload', slug: 'upload', isSystem: true },
  { name: 'Download', slug: 'download', isSystem: true },
  { name: 'Transfer', slug: 'transfer', isSystem: true },
  { name: 'Lock', slug: 'lock', isSystem: true },
  { name: 'Unlock', slug: 'unlock', isSystem: true },
  { name: 'Generate', slug: 'generate', isSystem: true },
] as const;

// ─────────────────────────────────────────────
// SYSTEM ROLES — Migration from UserRole enum
// These replace the hardcoded ADMIN/BM/FDO/AM roles
// ─────────────────────────────────────────────
const SYSTEM_ROLES = [
  {
    name: 'Administrator',
    slug: 'admin',
    description: 'Full system access. Head Office administrator.',
    color: '#ef4444',
    priority: 1000,
    isSystem: true,
    /** Stored in User.role and Role.legacyRole. Must match the system role code exactly. */
    legacyRole: 'ADMIN',
  },
  {
    name: 'Area Manager',
    slug: 'area-manager',
    description: 'Manages multiple branches. Reports to admin.',
    color: '#8b5cf6',
    priority: 300,
    isSystem: true,
    legacyRole: 'AREA_MANAGER',
  },
  {
    name: 'Branch Manager',
    slug: 'branch-manager',
    description: 'Manages a single branch.',
    color: '#3b82f6',
    priority: 200,
    isSystem: true,
    legacyRole: 'BRANCH_MANAGER',
  },
  {
    name: 'Field Development Officer',
    slug: 'fdo',
    description: 'Field officer. Client enrollment and loan processing.',
    color: '#22c55e',
    priority: 100,
    isSystem: true,
    legacyRole: 'FDO',
  },
  {
    name: 'Quality Checkers',
    slug: 'quality-checkers',
    description: 'Background verification and QC team for client approvals.',
    color: '#0d9488',
    priority: 150,
    isSystem: true,
    legacyRole: 'QC',
  },
  {
    name: 'Division Manager',
    slug: 'division-manager',
    description: 'Regional oversight across multiple areas.',
    color: '#f59e0b',
    priority: 350,
    isSystem: true,
    legacyRole: 'DIVISION_MANAGER',
  },
];

// ─────────────────────────────────────────────
// PERMISSION MATRIX — Migrated from PERMISSIONS object in permissions.ts
// Maps role slugs to module:action permissions
// ─────────────────────────────────────────────
const ROLE_PERMISSIONS: Record<string, string[]> = {
  // ADMIN — all permissions
  'admin': [
    'dashboard:view',
    'branch:view', 'branch:create', 'branch:edit', 'branch:lock', 'branch:unlock',
    'centers:view', 'centers:create', 'centers:edit', 'centers:transfer',
    'clients:view', 'clients:create', 'clients:edit', 'clients:verify', 'clients:transfer',
    'kyc:view', 'kyc:upload', 'kyc:verify', 'kyc:edit', 'kyc:delete',
    'loan:view', 'loan:create', 'loan:approve', 'loan:disburse', 'loan:close', 'loan:reverse', 'loan:reschedule', 'loan:waive',
    'collection:view', 'collection:create', 'collection:approve', 'collection:export',
    'gold-loan:view', 'gold-loan:create', 'gold-loan:approve', 'gold-loan:disburse',
    'savings:view', 'savings:create', 'savings:close',
    'accounts:view', 'accounts:create', 'accounts:edit',
    'transactions:view', 'transactions:create', 'transactions:approve', 'transactions:reverse',
    'reports:view', 'reports:export', 'reports:print',
    'mis-reports:view', 'mis-reports:export',
    'daily-monitoring:view',
    'payroll:view', 'payroll:create', 'payroll:edit', 'payroll:approve',
    'insurance:view', 'insurance:create',
    'audit:view', 'audit:create', 'audit:approve',
    'questionnaire:view', 'questionnaire:create', 'questionnaire:edit',
    'utilities:view', 'utilities:edit', 'utilities:generate',
    'masters:view', 'masters:create', 'masters:edit', 'masters:delete',
    'admin:view', 'admin:create', 'admin:edit', 'admin:delete',
    'hr:view',
  ],

  // AREA MANAGER
  'area-manager': [
    'dashboard:view',
    'branch:view',
    'centers:view', 'centers:transfer',
    'clients:view', 'clients:verify', 'clients:transfer',
    'kyc:view', 'kyc:verify',
    'loan:view', 'loan:approve', 'loan:disburse',
    'collection:view', 'collection:approve', 'collection:export',
    'gold-loan:view', 'gold-loan:approve',
    'savings:view',
    'transactions:view', 'transactions:approve',
    'reports:view', 'reports:export',
    'mis-reports:view', 'mis-reports:export',
    'daily-monitoring:view',
    'payroll:view',
    'audit:view', 'audit:create',
    'questionnaire:view',
    'utilities:view',
    'hr:view', 'hr-employee:view', 'hr-employee:edit', 'hr-employee:verify',
    'hr-confirmation:view', 'hr-confirmation:create', 'hr-confirmation:approve', 'hr-confirmation:reject',
    'hr-promotion:view', 'hr-promotion:create', 'hr-promotion:approve', 'hr-promotion:reject',
    'hr-transfer:view', 'hr-transfer:create', 'hr-transfer:approve', 'hr-transfer:reject',
    // Exit final sign-off ("Final HR Approval") is deliberately HR-staff-only —
    // AM only handles the parallel clearance-item step (hr-exit:edit), not the
    // final approve action (see app/api/hr/exit-requests/[id]/final-approve).
    'hr-exit:view', 'hr-exit:create', 'hr-exit:edit',
    // hr-attendance:edit = can save Working Hours (shift timing, half/full-day
    // hours, permission-cycle limit) — mirrors the old withRole(['ADMIN','AREA_MANAGER']).
    'hr-attendance:view', 'hr-attendance:edit',
    'hr-leave:view', 'hr-leave:create', 'hr-leave:approve', 'hr-leave:reject',
    'hr-payroll:view', 'hr-payroll:edit', 'hr-incentive:view',
    'hr-performance:view', 'hr-performance:create', 'hr-performance:edit',
    'hr-policy:view',
    'hr-tracking:view',
    'hr-onboarding:view', 'hr-onboarding:create', 'hr-onboarding:edit', 'hr-onboarding:approve', 'hr-onboarding:reject', 'hr-onboarding:delete',
  ],

  // BRANCH MANAGER
  'branch-manager': [
    'dashboard:view',
    'centers:view', 'centers:create', 'centers:edit',
    'clients:view', 'clients:verify', 'clients:transfer',
    'kyc:view', 'kyc:verify',
    'loan:view', 'loan:approve', 'loan:disburse',
    'collection:view', 'collection:create', 'collection:approve',
    'gold-loan:view', 'gold-loan:approve',
    'savings:view', 'savings:create',
    'transactions:view', 'transactions:create',
    'reports:view',
    'daily-monitoring:view',
    'payroll:view',
    'audit:view', 'audit:create',
    'questionnaire:view',
    'utilities:view', 'utilities:generate',
    'hr:view', 'hr-employee:view', 'hr-employee:edit', 'hr-employee:verify',
    'hr-confirmation:view', 'hr-confirmation:create',
    'hr-promotion:view', 'hr-promotion:create',
    'hr-transfer:view', 'hr-transfer:create',
    'hr-exit:view', 'hr-exit:create', 'hr-exit:edit',
    'hr-attendance:view',
    'hr-leave:view', 'hr-leave:create', 'hr-leave:approve', 'hr-leave:reject',
    'hr-payroll:view', 'hr-payroll:edit', 'hr-incentive:view',
    'hr-performance:view', 'hr-performance:create', 'hr-performance:edit',
    'hr-policy:view',
    'hr-tracking:view',
    // BM can initiate onboarding requests (manual entry) and view the queue, but
    // final approval is reserved for higher stages by default — an Admin can still
    // configure BM as an approval stage dynamically via the Approval Settings page.
    'hr-onboarding:view', 'hr-onboarding:create',
  ],

  // FDO (Field Development Officer)
  'fdo': [
    'dashboard:view',
    'clients:view', 'clients:create', 'clients:edit',
    'kyc:view', 'kyc:upload', 'kyc:edit',
    'loan:view', 'loan:create',
    'collection:view', 'collection:create',
    'gold-loan:view',
    'savings:view',
    'questionnaire:view', 'questionnaire:create',
    'hr:view', 'hr-employee:view',
    'hr-attendance:view',
    'hr-leave:view', 'hr-leave:create',
    'hr-performance:view', 'hr-performance:create',
    'hr-policy:view',
  ],
};

// ─────────────────────────────────────────────
// MENU ITEMS — Dynamic sidebar configuration
// ─────────────────────────────────────────────
const MENU_ITEMS = [
  { label: 'Dashboard', path: '/dashboard', icon: 'LayoutDashboard', sortOrder: 1, moduleSlug: 'dashboard', actionSlug: 'view' },
  { label: 'Branch Management', path: '/dashboard/branch', icon: 'Building2', sortOrder: 2, moduleSlug: 'branch', actionSlug: 'view' },
  { label: 'Centers', path: '/dashboard/centers', icon: 'MapPin', sortOrder: 3, moduleSlug: 'centers', actionSlug: 'view' },
  { label: 'Client Operations', icon: 'Users', sortOrder: 4, children: [
    { label: 'Client List', path: '/dashboard/client-operations', moduleSlug: 'clients', actionSlug: 'view' },
    { label: 'Client Transfer', path: '/dashboard/client-operations/transfer', moduleSlug: 'clients', actionSlug: 'transfer' },
    { label: 'KYC Verification', path: '/dashboard/client-operations/kyc', moduleSlug: 'kyc', actionSlug: 'verify' },
  ]},
  { label: 'Loan Module', icon: 'CreditCard', sortOrder: 5, children: [
    { label: 'Applications', path: '/dashboard/loan-module/application', moduleSlug: 'loan', actionSlug: 'create' },
    { label: 'Induction', path: '/dashboard/loan-module/induction', moduleSlug: 'loan', actionSlug: 'approve' },
    { label: 'Disbursement', path: '/dashboard/loan-module/disbursement', moduleSlug: 'loan', actionSlug: 'disburse' },
    { label: 'Loan History', path: '/dashboard/loan-module/history', moduleSlug: 'loan', actionSlug: 'view' },
  ]},
  { label: 'Collections', icon: 'Receipt', sortOrder: 6, children: [
    { label: 'Daily Collection', path: '/dashboard/collections', moduleSlug: 'collection', actionSlug: 'view' },
    { label: 'Approval', path: '/dashboard/collections/approval', moduleSlug: 'collection', actionSlug: 'approve' },
  ]},
  { label: 'Gold Loan', icon: 'Gem', sortOrder: 7, children: [
    { label: 'Gold Transactions', path: '/dashboard/gold-loan', moduleSlug: 'gold-loan', actionSlug: 'view' },
  ]},
  { label: 'Transactions', path: '/dashboard/transactions', icon: 'ArrowLeftRight', sortOrder: 8, moduleSlug: 'transactions', actionSlug: 'view' },
  { label: 'Reports', icon: 'BarChart3', sortOrder: 9, children: [
    { label: 'MIS Reports', path: '/dashboard/mis-reports', moduleSlug: 'mis-reports', actionSlug: 'view' },
    { label: 'Daily Monitoring', path: '/dashboard/daily-monitoring', moduleSlug: 'daily-monitoring', actionSlug: 'view' },
  ]},
  { label: 'Payroll', path: '/dashboard/payroll-attendance', icon: 'Banknote', sortOrder: 10, moduleSlug: 'payroll', actionSlug: 'view' },
  { label: 'Audit', path: '/dashboard/audit', icon: 'ClipboardCheck', sortOrder: 11, moduleSlug: 'audit', actionSlug: 'view' },
  { label: 'Utilities', path: '/dashboard/utilities', icon: 'Settings', sortOrder: 12, moduleSlug: 'utilities', actionSlug: 'view' },
  { label: 'Masters', path: '/dashboard/masters', icon: 'Database', sortOrder: 13, moduleSlug: 'masters', actionSlug: 'view' },
  { label: 'Accounts', path: '/dashboard/accounts', icon: 'BookOpen', sortOrder: 14, moduleSlug: 'accounts', actionSlug: 'view' },
  // ── HR Management (phased rollout — see .claude/plans/hr-management-module-1-rosy-wind.md) ──
  // More children (Lifecycle, Attendance, Leave, Payroll, Incentive, Performance,
  // Live Tracking, Policies, Reports) are added incrementally as each phase ships.
  { label: 'HR Management', icon: 'Users2', sortOrder: 15, children: [
    { label: 'HR Dashboard', path: '/dashboard/hr', moduleSlug: 'hr', actionSlug: 'view' },
    { label: 'New Employee Requests', path: '/dashboard/hr/onboarding', moduleSlug: 'hr-onboarding', actionSlug: 'view' },
    { label: 'Employee List', path: '/dashboard/hr/employees', moduleSlug: 'hr-employee', actionSlug: 'view' },
    { label: 'My Profile', path: '/dashboard/hr/my-profile', moduleSlug: 'hr', actionSlug: 'view' },
    { label: 'Employee Documents', path: '/dashboard/hr/employee-documents', moduleSlug: 'hr-employee', actionSlug: 'view' },
    { label: 'Belongings', path: '/dashboard/hr/belongings', moduleSlug: 'hr-employee', actionSlug: 'view' },
    { label: 'Confirmation', path: '/dashboard/hr/lifecycle/confirmation', moduleSlug: 'hr-confirmation', actionSlug: 'view' },
    { label: 'Promotion', path: '/dashboard/hr/lifecycle/promotion', moduleSlug: 'hr-promotion', actionSlug: 'view' },
    { label: 'Transfer', path: '/dashboard/hr/lifecycle/transfer', moduleSlug: 'hr-transfer', actionSlug: 'view' },
    { label: 'Exit / Clearance', path: '/dashboard/hr/lifecycle/exit', moduleSlug: 'hr-exit', actionSlug: 'view' },
    // Attendance/Leave-Balance/Leave-Type pages already existed at these URLs
    // (under the old, path-less "Payroll" menu item) but had no direct sidebar
    // entry of their own — these are new, direct links, not a relocation.
    { label: 'Attendance', path: '/dashboard/hr/attendance', moduleSlug: 'hr-attendance', actionSlug: 'view' },
    { label: 'Apply Leave', path: '/dashboard/hr/leave/apply', moduleSlug: 'hr-leave', actionSlug: 'view' },
    { label: 'Leave Approval', path: '/dashboard/hr/leave/approval', moduleSlug: 'hr-leave', actionSlug: 'approve' },
    { label: 'Leave Balance', path: '/dashboard/hr/leave-balance', moduleSlug: 'hr-leave', actionSlug: 'view' },
    { label: 'Leave Types', path: '/dashboard/hr/leave-type', moduleSlug: 'hr-leave', actionSlug: 'view' },
    { label: 'Permission Types', path: '/dashboard/hr/permission-type', moduleSlug: 'hr-leave', actionSlug: 'view' },
    { label: 'Apply Permission', path: '/dashboard/hr/permission/apply', moduleSlug: 'hr-leave', actionSlug: 'view' },
    { label: 'Permission Approval', path: '/dashboard/hr/permission/approval', moduleSlug: 'hr-leave', actionSlug: 'approve' },
    { label: 'Working Hours', path: '/dashboard/hr/working-hours', moduleSlug: 'hr-attendance', actionSlug: 'view' },
    { label: 'Week Configuration', path: '/dashboard/hr/attendance/week-configuration', moduleSlug: 'hr-attendance', actionSlug: 'view' },
    { label: 'Holiday Calendar', path: '/dashboard/hr/attendance/holiday-calendar', moduleSlug: 'hr-attendance', actionSlug: 'view' },
    { label: 'Shift Management', path: '/dashboard/hr/shift-management', moduleSlug: 'hr-attendance', actionSlug: 'view' },
    // Salary Components (Earnings/Deductions catalog), Salary Master (per-employee
    // amounts) and Payroll Processing already existed at these URLs — new direct
    // HR sidebar links, not a relocation (same as Attendance/Leave above).
    { label: 'Salary Components', path: '/dashboard/hr/salary', moduleSlug: 'hr-payroll', actionSlug: 'view' },
    { label: 'Salary Master', path: '/dashboard/hr/salary-master', moduleSlug: 'hr-payroll', actionSlug: 'view' },
    { label: 'Payroll Processing', path: '/dashboard/hr/salary-pay', moduleSlug: 'hr-payroll', actionSlug: 'view' },
    { label: 'Incentive Report', path: '/dashboard/reports/employee/incentive-report', moduleSlug: 'hr-incentive', actionSlug: 'view' },
    { label: 'Performance Goals', path: '/dashboard/hr/performance/goals', moduleSlug: 'hr-performance', actionSlug: 'view' },
    { label: 'Performance Review', path: '/dashboard/hr/performance/reviews', moduleSlug: 'hr-performance', actionSlug: 'view' },
    { label: 'Performance Analysis', path: '/dashboard/hr/performance/analysis', moduleSlug: 'hr-performance', actionSlug: 'view' },
    { label: 'Policies & Documents', path: '/dashboard/hr/policies', moduleSlug: 'hr-policy', actionSlug: 'view' },
    // Reports — split from the single "HRIS Reports" hub into one entry per
    // report (each its own page under /dashboard/hr/reports/[slug]); all still
    // share the same hr-payroll:view permission the combined hub used before.
    { label: 'Reports', path: '/dashboard/hr/reports', moduleSlug: 'hr-payroll', actionSlug: 'view' },
    { label: 'Employee Master Report', path: '/dashboard/hr/reports/employee-master', moduleSlug: 'hr-payroll', actionSlug: 'view' },
    { label: 'Joining Report', path: '/dashboard/hr/reports/joining', moduleSlug: 'hr-payroll', actionSlug: 'view' },
    { label: 'Exit Report', path: '/dashboard/hr/reports/exit', moduleSlug: 'hr-payroll', actionSlug: 'view' },
    { label: 'Transfer Report', path: '/dashboard/hr/reports/transfer', moduleSlug: 'hr-payroll', actionSlug: 'view' },
    { label: 'Promotion Report', path: '/dashboard/hr/reports/promotion', moduleSlug: 'hr-payroll', actionSlug: 'view' },
    { label: 'Confirmation Report', path: '/dashboard/hr/reports/confirmation', moduleSlug: 'hr-payroll', actionSlug: 'view' },
    { label: 'Absentee Report', path: '/dashboard/hr/reports/absentee', moduleSlug: 'hr-payroll', actionSlug: 'view' },
    { label: 'Missed Punch In Report', path: '/dashboard/hr/reports/missed-punch-in', moduleSlug: 'hr-payroll', actionSlug: 'view' },
    { label: 'Holiday Report', path: '/dashboard/hr/reports/holiday-register', moduleSlug: 'hr-payroll', actionSlug: 'view' },
    { label: 'Late Attendance Report', path: '/dashboard/hr/reports/late-attendance', moduleSlug: 'hr-payroll', actionSlug: 'view' },
    { label: 'Leave Register Report', path: '/dashboard/hr/reports/leave-register', moduleSlug: 'hr-payroll', actionSlug: 'view' },
    { label: 'Leave Balance Report', path: '/dashboard/hr/reports/leave-balance', moduleSlug: 'hr-payroll', actionSlug: 'view' },
    { label: 'Payroll Report', path: '/dashboard/hr/reports/salary-register', moduleSlug: 'hr-payroll', actionSlug: 'view' },
    { label: 'Staff Loan Deduction Report', path: '/dashboard/hr/reports/staff-loan-deduction', moduleSlug: 'hr-payroll', actionSlug: 'view' },
    { label: 'Staff Advance Deduction Report', path: '/dashboard/hr/reports/staff-advance-deduction', moduleSlug: 'hr-payroll', actionSlug: 'view' },
    { label: 'Total Staff Outstanding Report', path: '/dashboard/hr/reports/staff-outstanding', moduleSlug: 'hr-payroll', actionSlug: 'view' },
    { label: 'Active Staff Loan Report', path: '/dashboard/hr/reports/active-staff-loans', moduleSlug: 'hr-payroll', actionSlug: 'view' },
    { label: 'Active Staff Advance Report', path: '/dashboard/hr/reports/active-staff-advances', moduleSlug: 'hr-payroll', actionSlug: 'view' },
    { label: 'Staff Loan Schedule Report', path: '/dashboard/hr/reports/staff-loan-schedule', moduleSlug: 'hr-payroll', actionSlug: 'view' },
    { label: 'Staff Advance Schedule Report', path: '/dashboard/hr/reports/staff-advance-schedule', moduleSlug: 'hr-payroll', actionSlug: 'view' },
    { label: 'Staff Loan Closure Report', path: '/dashboard/hr/reports/staff-loan-closure', moduleSlug: 'hr-payroll', actionSlug: 'view' },
    { label: 'Staff Advance Closure Report', path: '/dashboard/hr/reports/staff-advance-closure', moduleSlug: 'hr-payroll', actionSlug: 'view' },
    { label: 'Travel & Client Visit Report', path: '/dashboard/hr/reports/travel-client-visit', moduleSlug: 'hr-payroll', actionSlug: 'view' },
    { label: 'Travel Path Similarity Report', path: '/dashboard/hr/reports/travel-similarity', moduleSlug: 'hr-payroll', actionSlug: 'view' },
    { label: 'Live Employee Map', path: '/dashboard/hr/tracking/live', moduleSlug: 'hr-tracking', actionSlug: 'view' },
    // Generic, admin-configurable approval-workflow editor (any module, any
    // number of stages, any role per stage) — see ApprovalWorkflowConfigPage.tsx.
    // Gated by admin:edit like the other config pages below (Department Master
    // etc.), since it's a cross-module config screen, not onboarding-specific.
    { label: 'Approval Settings', path: '/dashboard/hr/approval-settings', moduleSlug: 'admin', actionSlug: 'edit' },
    { label: 'Onboarding Field Validation', path: '/dashboard/admin/hr-onboarding-field-config', moduleSlug: 'admin', actionSlug: 'edit' },
    { label: 'Probation Period Config', path: '/dashboard/admin/hr-probation-config', moduleSlug: 'admin', actionSlug: 'edit' },
  ]},
  { label: 'Admin Panel', icon: 'ShieldCheck', sortOrder: 99, children: [
    { label: 'Role Management', path: '/dashboard/admin/roles', moduleSlug: 'admin', actionSlug: 'view' },
    { label: 'User Management', path: '/dashboard/admin/users', moduleSlug: 'admin', actionSlug: 'view' },
    { label: 'Trained Faces', path: '/dashboard/admin/face-templates', moduleSlug: 'admin', actionSlug: 'view' },
    { label: 'Module Config', path: '/dashboard/admin/modules', moduleSlug: 'admin', actionSlug: 'edit' },
    { label: 'Approval Workflows', path: '/dashboard/admin/workflows', moduleSlug: 'admin', actionSlug: 'edit' },
    { label: 'Department Master', path: '/dashboard/admin/hr-departments', moduleSlug: 'admin', actionSlug: 'edit' },
    { label: 'Designation Master', path: '/dashboard/admin/hr-designations', moduleSlug: 'admin', actionSlug: 'edit' },
    { label: 'Employee Field Config', path: '/dashboard/admin/hr-field-config', moduleSlug: 'admin', actionSlug: 'edit' },
    { label: 'Belonging Catalog', path: '/dashboard/admin/hr-belonging-catalog', moduleSlug: 'admin', actionSlug: 'edit' },
    { label: 'Exit Clearance Config', path: '/dashboard/admin/hr-exit-clearance-config', moduleSlug: 'admin', actionSlug: 'edit' },
  ]},
];

// ─────────────────────────────────────────────
// MAIN SEED FUNCTION
// ─────────────────────────────────────────────
async function main() {
  console.log('🌱 Starting RBAC seed...\n');

  // ── 1. Seed Modules ──
  console.log('📦 Seeding modules...');
  const moduleMap = new Map<string, string>();

  for (const mod of MODULES) {
    const module = await prisma.module.upsert({
      where: { slug: mod.slug },
      create: mod,
      update: { name: mod.name, icon: mod.icon, sortOrder: mod.sortOrder },
    });
    moduleMap.set(mod.slug, module.id);
    console.log(`  ✓ Module: ${mod.name}`);
  }

  // ── 2. Seed Actions (per module) ──
  console.log('\n⚡ Seeding actions...');
  const actionMap = new Map<string, string>(); // "moduleSlug:actionSlug" -> actionId

  for (const [moduleSlug, moduleId] of moduleMap) {
    for (const action of ACTIONS) {
      const moduleAction = await prisma.moduleAction.upsert({
        where: { moduleId_slug: { moduleId, slug: action.slug } },
        create: { moduleId, ...action },
        update: { name: action.name },
      });
      actionMap.set(`${moduleSlug}:${action.slug}`, moduleAction.id);
    }
  }
  console.log(`  ✓ Created actions for ${moduleMap.size} modules`);

  // ── 3. Seed Permissions (module + action combos) ──
  console.log('\n🔐 Seeding permissions...');
  const permissionMap = new Map<string, string>(); // "moduleSlug:actionSlug" -> permissionId

  for (const [key, actionId] of actionMap) {
    const [moduleSlug, actionSlug] = key.split(':');
    const moduleId = moduleMap.get(moduleSlug)!;

    const permission = await prisma.permission.upsert({
      where: { moduleId_actionId: { moduleId, actionId } },
      create: {
        moduleId,
        actionId,
        name: `${moduleSlug}.${actionSlug}`,
      },
      update: {},
    });
    permissionMap.set(key, permission.id);
  }
  console.log(`  ✓ Created ${permissionMap.size} permissions`);

  // ── 4. Seed System Roles ──
  console.log('\n👥 Seeding system roles...');
  const roleMap = new Map<string, string>();

  for (const role of SYSTEM_ROLES) {
    const created = await prisma.role.upsert({
      where: { slug: role.slug },
      create: role,
      // Always update legacyRole so stale "FDO" defaults get corrected on re-seed
      update: {
        name: role.name,
        description: role.description,
        color: role.color,
        legacyRole: role.legacyRole,
      },
    });
    roleMap.set(role.slug, created.id);
    console.log(`  ✓ Role: ${role.name} (legacyRole: ${role.legacyRole})`);
  }

  // ── 5. Seed Role Permissions ──
  console.log('\n🔗 Assigning permissions to roles...');

  for (const [roleSlug, permKeys] of Object.entries(ROLE_PERMISSIONS)) {
    const roleId = roleMap.get(roleSlug);
    if (!roleId) {
      console.warn(`  ⚠ Role '${roleSlug}' not found, skipping`);
      continue;
    }

    for (const permKey of permKeys) {
      const permissionId = permissionMap.get(permKey);
      if (!permissionId) {
        console.warn(`  ⚠ Permission '${permKey}' not found, skipping`);
        continue;
      }

      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId, permissionId } },
        create: { roleId, permissionId, effect: 'ALLOW' },
        update: {},
      });
    }

    console.log(`  ✓ ${roleSlug}: ${permKeys.length} permissions`);
  }

  // ── 5b. ADMIN gets every permission unconditionally ──
  // The ROLE_PERMISSIONS['admin'] list above is a hand-curated snapshot that
  // drifts as modules/actions are added; this guarantees admin can never
  // silently lose access to a newly seeded module:action combo.
  const adminRoleId = roleMap.get('admin');
  if (adminRoleId) {
    for (const permissionId of permissionMap.values()) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: adminRoleId, permissionId } },
        create: { roleId: adminRoleId, permissionId, effect: 'ALLOW' },
        update: { effect: 'ALLOW' },
      });
    }
    console.log(`  ✓ admin: granted all ${permissionMap.size} permissions unconditionally`);
  }

  // ── 5c. HR permissions for DYNAMIC custom roles (HR/HRM/CM-HR/etc.) ──
  // ROLE_PERMISSIONS above only covers the 4 fixed legacy slugs
  // (admin/area-manager/branch-manager/fdo). This DB already has admin-created
  // custom roles (Human Resources, Human Resources Manager, CM-HR, COO, CEO,
  // Zonal Head, Assistant Branch Manager, Senior FDO, Quality Checkers, ...)
  // that never got any hr* RolePermission row — even though several of their
  // exact legacyRole codes ('HR', 'HRM', 'CM-HR') are hardcoded into every HR
  // API route's withRole()/HR_STAFF_ROLES-style access-control arrays
  // throughout the module. Without this step those roles' users can call the
  // APIs successfully but never see the HR menu at all (sidebar visibility is
  // a separate RBAC Permission check, not the same string match withRole uses).
  console.log('\n🧑‍💼 Granting HR permissions to custom roles...');
  await seedHrPermissionsForDynamicRoles(permissionMap);

  // ── 6. Seed Menu Items ──
  console.log('\n📋 Seeding menu items...');
  await seedMenuItems(MENU_ITEMS, moduleMap, null);

  // ── 7. Migrate existing users ──
  console.log('\n👤 Migrating existing users to new role system...');
  await migrateExistingUsers(roleMap);

  // ── 7b. Seed default Leave Types (HR Phase 3) ──
  console.log('\n🌴 Seeding default leave types...');
  await seedLeaveTypes();

  // ── 7c. Seed default Salary Components (HR Phase 4) ──
  console.log('\n💰 Seeding default salary components...');
  await seedSalaryComponents();

  // ── 8. Seed default HR approval workflows ──
  // Onboarding, Transfer, Leave, Permission, Promotion and Exit each start as a
  // single Admin approval stage (see DEFAULT_WORKFLOWS). Extra stages — e.g. a
  // Branch Manager or HR review — are added afterward per module in
  // /dashboard/hr/approval-settings; this is just the day-one default.
  console.log('\n🔀 Seeding default HR approval workflows...');
  await seedDefaultApprovalWorkflows();

  console.log('\n✅ RBAC seed complete!');
}

// Full HR-staff access — same set already granted to branch-manager/area-manager
// above, and the exact role codes (legacyRole) these keys are checked against
// in every HR route's hardcoded role-gate arrays (e.g. HR_STAFF_ROLES, REVIEWER_ROLES).
const HR_STAFF_LEGACY_ROLES = ['HR', 'HRM', 'CM-HR'];
const HR_STAFF_PERMISSION_KEYS = [
  'hr:view', 'hr-employee:view', 'hr-employee:edit', 'hr-employee:verify',
  'hr-confirmation:view', 'hr-confirmation:create', 'hr-confirmation:approve', 'hr-confirmation:reject',
  'hr-promotion:view', 'hr-promotion:create', 'hr-promotion:approve', 'hr-promotion:reject',
  'hr-transfer:view', 'hr-transfer:create', 'hr-transfer:approve', 'hr-transfer:reject',
  'hr-exit:view', 'hr-exit:create', 'hr-exit:edit', 'hr-exit:approve',
  'hr-attendance:view',
  'hr-leave:view', 'hr-leave:create', 'hr-leave:approve', 'hr-leave:reject',
  'hr-payroll:view', 'hr-payroll:edit', 'hr-incentive:view',
  'hr-performance:view', 'hr-performance:create', 'hr-performance:edit',
  'hr-policy:view', 'hr-policy:edit',
  'hr-tracking:view',
  'hr-onboarding:view', 'hr-onboarding:create', 'hr-onboarding:edit', 'hr-onboarding:approve', 'hr-onboarding:reject', 'hr-onboarding:delete',
];

// Baseline "every employee" access — same set already granted to fdo above —
// so a custom role with no special HR standing (COO, CEO, Zonal Head, Assistant
// Branch Manager, Senior FDO, Quality Checkers, or any future admin-created
// role) still gets My Profile / Attendance / Apply Leave / Goals / Policies.
const HR_BASELINE_PERMISSION_KEYS = [
  'hr:view', 'hr-employee:view',
  'hr-attendance:view',
  'hr-leave:view', 'hr-leave:create',
  'hr-performance:view', 'hr-performance:create',
  'hr-policy:view',
];

async function seedHrPermissionsForDynamicRoles(permissionMap: Map<string, string>) {
  const FIXED_SLUGS = ['admin', 'area-manager', 'branch-manager', 'fdo'];
  const allRoles = await prisma.role.findMany({ select: { id: true, name: true, slug: true, legacyRole: true } });

  for (const role of allRoles) {
    if (FIXED_SLUGS.includes(role.slug)) continue; // already handled by ROLE_PERMISSIONS / the admin unconditional grant

    const keys = HR_STAFF_LEGACY_ROLES.includes(role.legacyRole) ? HR_STAFF_PERMISSION_KEYS : HR_BASELINE_PERMISSION_KEYS;

    for (const key of keys) {
      const permissionId = permissionMap.get(key);
      if (!permissionId) continue;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId } },
        create: { roleId: role.id, permissionId, effect: 'ALLOW' },
        update: {},
      });
    }
    console.log(`  ✓ ${role.name} (${role.legacyRole}): ${keys.length} HR permissions granted`);
  }
}

async function seedLeaveTypes() {
  const DEFAULT_LEAVE_TYPES = ['CASUAL LEAVE', 'SICK LEAVE', 'PRIVILEGE LEAVE'];

  for (const [i, leaveType] of DEFAULT_LEAVE_TYPES.entries()) {
    const existing = await prisma.leaveType.findUnique({ where: { leaveType } });
    if (existing) {
      console.log(`  ✓ Leave type already exists: ${leaveType}`);
      continue;
    }

    const lastType = await prisma.leaveType.findFirst({ orderBy: { typeId: 'desc' } });
    const nextTypeId = (lastType?.typeId || 0) + 1;

    await prisma.leaveType.create({ data: { typeId: nextTypeId, leaveType } });
    console.log(`  ✓ Created leave type: ${leaveType}`);
  }
}

async function seedSalaryComponents() {
  const DEFAULT_COMPONENTS: { name: string; type: 'EARNINGS' | 'DEDUCTIONS' }[] = [
    { name: 'Basic', type: 'EARNINGS' },
    { name: 'HRA', type: 'EARNINGS' },
    { name: 'Other Allowance', type: 'EARNINGS' },
    { name: 'Incentives', type: 'EARNINGS' },
    { name: 'PF', type: 'DEDUCTIONS' },
    { name: 'ESI', type: 'DEDUCTIONS' },
    { name: 'Staff Loan', type: 'DEDUCTIONS' },
    { name: 'Staff Advance', type: 'DEDUCTIONS' },
    // Auto-filled from the employee's total APPROVED permission hours for the
    // month once Salary Pay opens that period — see
    // attendance-hr/plan-permission-hours-payroll.md. Matched by name (same
    // pattern as the 'Incentives' auto-fill), so the exact name matters.
    { name: 'Permission Deduction', type: 'DEDUCTIONS' },
    { name: 'Other Deduction', type: 'DEDUCTIONS' },
  ];

  for (const component of DEFAULT_COMPONENTS) {
    const existing = await prisma.salaryComponent.findUnique({ where: { name: component.name } });
    if (existing) {
      console.log(`  ✓ Salary component already exists: ${component.name}`);
      continue;
    }

    const lastComponent = await prisma.salaryComponent.findFirst({ orderBy: { salaryId: 'desc' } });
    const nextSalaryId = (lastComponent?.salaryId || 0) + 1;

    await prisma.salaryComponent.create({ data: { salaryId: nextSalaryId, ...component } });
    console.log(`  ✓ Created salary component: ${component.name} (${component.type})`);
  }
}

// One default workflow per module in DEFAULT_WORKFLOWS, created only for a
// module that has none at all. Re-running the seed therefore never adds a
// second (competing "default") workflow, and never touches one an admin has
// edited or replaced.
async function seedDefaultApprovalWorkflows() {
  for (const config of DEFAULT_WORKFLOWS) {
    // Most modules come from MODULES above; this only fills in one that isn't
    // there yet (e.g. HR Permission, which has no RBAC permissions of its own).
    const workflowModule = await prisma.module.upsert({
      where: { slug: config.moduleSlug },
      create: {
        name: config.moduleName,
        slug: config.moduleSlug,
        icon: config.moduleIcon,
        sortOrder: 35,
        isSystem: true,
      },
      update: {},
    });

    const existing = await prisma.approvalWorkflow.findFirst({
      where: { moduleId: workflowModule.id },
      select: { name: true },
    });
    if (existing) {
      console.log(`  ✓ ${config.moduleName} already has a workflow ("${existing.name}")`);
      continue;
    }

    await prisma.approvalWorkflow.create({
      data: {
        moduleId: workflowModule.id,
        name: config.name,
        description: config.description,
        isActive: true,
        isDefault: config.isDefault,
        stages: {
          create: config.stages.map((stage) => ({
            name: stage.name,
            stageOrder: stage.stageOrder,
            approverRoleSlug: stage.approverRoleSlug,
            allowedActions: stage.allowedActions,
          })),
        },
      },
    });
    console.log(`  ✓ Created ${config.name} workflow (${config.stages.length} stage${config.stages.length === 1 ? '' : 's'})`);
  }
}

// ─────────────────────────────────────────────
// MIGRATE EXISTING USERS
// Copies User.role (enum) to UserRole table
// ─────────────────────────────────────────────
async function migrateExistingUsers(roleMap: Map<string, string>) {
  // Old enum -> new slug mapping
  const ROLE_MIGRATION_MAP: Record<string, string> = {
    'ADMIN': 'admin',
    'AREA_MANAGER': 'area-manager',
    'BRANCH_MANAGER': 'branch-manager',
    'FDO': 'fdo',
  };

  const users = await prisma.user.findMany({
    select: { id: true, role: true, branchId: true },
  });

  let migrated = 0;
  for (const user of users) {
    const oldRole = user.role as string;
    const newSlug = ROLE_MIGRATION_MAP[oldRole];
    if (!newSlug) {
      console.warn(`  ⚠ Unknown role '${oldRole}' for user ${user.id}`);
      continue;
    }

    const roleId = roleMap.get(newSlug);
    if (!roleId) continue;

    // Create UserRoleAssignment entry (Prisma model name for the junction table).
    // Prisma's compound-unique `where` shape rejects `null` for the nullable
    // branchId field at runtime, so upsert-by-compound-key doesn't work here —
    // look it up with findFirst (which allows null in a plain where) instead.
    const existingAssignment = await prisma.userRoleAssignment.findFirst({
      where: { userId: user.id, roleId, branchId: user.branchId ?? null },
      select: { id: true },
    });
    if (!existingAssignment) {
      await prisma.userRoleAssignment.create({
        data: {
          userId: user.id,
          roleId,
          branchId: user.branchId,
          isActive: true,
        },
      });
    }

    // Create UserBranchAccess entry (if they have a branchId)
    if (user.branchId) {
      await prisma.userBranchAccess.upsert({
        where: { userId_branchId: { userId: user.id, branchId: user.branchId } },
        create: {
          userId: user.id,
          branchId: user.branchId,
          accessType: 'FULL',
          isPrimary: true,
        },
        update: {},
      });
    }

    migrated++;
  }

  // Migrate AreaManagerBranch to UserBranchAccess
  const amBranches = await prisma.areaManagerBranch.findMany();
  for (const amb of amBranches) {
    await prisma.userBranchAccess.upsert({
      where: { userId_branchId: { userId: amb.userId, branchId: amb.branchId } },
      create: {
        userId: amb.userId,
        branchId: amb.branchId,
        accessType: 'FULL',
        isPrimary: amb.isPrimary,
      },
      update: { isPrimary: amb.isPrimary },
    });
  }

  console.log(`  ✓ Migrated ${migrated} users`);
  console.log(`  ✓ Migrated ${amBranches.length} area manager branch assignments`);
}

// ─────────────────────────────────────────────
// SEED MENU ITEMS RECURSIVELY
// ─────────────────────────────────────────────
async function seedMenuItems(
  items: typeof MENU_ITEMS,
  moduleMap: Map<string, string>,
  parentId: string | null
): Promise<void> {
  for (const item of items) {
    const moduleId = (item as { moduleSlug?: string }).moduleSlug
      ? moduleMap.get((item as { moduleSlug: string }).moduleSlug)
      : null;

    const created = await prisma.menuItem.upsert({
      where: { id: `menu-${item.label.toLowerCase().replace(/\s+/g, '-')}` },
      create: {
        id: `menu-${item.label.toLowerCase().replace(/\s+/g, '-')}`,
        label: item.label,
        path: (item as { path?: string }).path ?? null,
        icon: item.icon ?? null,
        sortOrder: item.sortOrder,
        parentId,
        moduleId: moduleId ?? null,
        actionSlug: (item as { actionSlug?: string }).actionSlug ?? null,
        isActive: true,
      },
      update: {
        label: item.label,
        path: (item as { path?: string }).path ?? null,
        sortOrder: item.sortOrder,
      },
    });

    const children = (item as { children?: typeof MENU_ITEMS }).children;
    if (children && children.length > 0) {
      await seedMenuItems(children, moduleMap, created.id);
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
