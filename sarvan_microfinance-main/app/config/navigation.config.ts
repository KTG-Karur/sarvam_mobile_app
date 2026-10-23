import {
    LayoutDashboard,
    Users,
    Building2,
    FileText,
    CreditCard,
    Settings,
    BarChart3,
    UserCog,
    Wallet,
    ArrowLeftRight,
    PlusCircle,
    Database,
    UserX,
    UserCheck,
    Key,
    MapPin,
    Map,
    FileUser,
    FileBarChart,
    FileBarChart2,
    UserSearch,
    UserPlus,
    UsersRound,
    ShieldCheck,
    MonitorSmartphone,
    ClipboardCheck,
    FileCheck,
    Trash2,
    Receipt,
    UserCircle,
    ClipboardList,
    XCircle,
    Clock,
    Network,
    Sunset,
    FolderTree,
    type LucideIcon,
    Banknote,
    CheckCircle,
    Coins,
    Activity,
    Palette,
    BookOpen,
    CalendarX,
    CalendarCheck,
    CalendarClock,
    CalendarDays,
    CalendarRange,
    IndianRupee,
    Settings2,
    HandCoins,
    Ban,
    PhoneCall,
    TrendingUp,
    Landmark,
    Book,
    Library,
    Tags,
    Tag,
    Package,
    Target,
    MapPinned,
    HelpCircle,
    Save,
    ListChecks,
    ListTodo,
    Undo2,
    Layers,
    NotebookText,
    NotebookPen,
    Wallet2,
    ArrowDownCircle,
    ArrowUpCircle,
    ArrowDownToLine,
    ArrowUpFromLine,
    Shuffle,
    PencilLine,
    Repeat,
    PieChart,
    MoreHorizontal,
    FileSpreadsheet,
    FileClock,
    Scale,
    AlertTriangle,
    Printer,
    GitCompare,
    Award,
    Percent,
    RefreshCw,
    History,
    MessageSquareText,
    Copy,
    UserMinus,
    Briefcase,
    Download,
    ScanFace,
    Users2,
    IdCard,
    BadgeCheck,
    LogOut,
    Clock3,
} from 'lucide-react';
import type { UserRole } from '@/app/types';

export interface NavigationItem {
    name: string;
    href: string;
    icon: LucideIcon;
    children?: NavigationItem[];
    /**
     * Optional array of allowed roles for this navigation item.
     * If not specified, the item is visible to all authenticated users.
     * If specified, only users with one of these roles can see the item.
     */
    allowedRoles?: UserRole[];
    /**
     * If true, this item (and its children) always use the legacy allowedRoles filter
     * regardless of whether page-level permissions are configured for the user's role.
     * Use this for sections that should be accessible by default to all applicable roles
     * without requiring an Admin to explicitly grant them via the Role Permissions UI.
     */
    alwaysVisible?: boolean;
    /**
     * If true, this item is hidden project-wide when the admin-controlled
     * Loan Advance feature switch (Hub → Settings) is disabled — see
     * app/lib/loan-advance-config.ts / useLoanAdvanceEnabled hook.
     */
    requiresLoanAdvance?: boolean;
}

export const navigationConfig: NavigationItem[] = [
    {
        name: 'Dashboard',
        href: '/dashboard',
        icon: LayoutDashboard,
        // Dashboard visible to all authenticated users
    },
    {
        name: 'Hub',
        href: '/dashboard/hub',
        icon: Building2,
        allowedRoles: ['ADMIN', 'AREA_MANAGER'],
        children: [
            {
                name: 'Hub Create',
                href: '/dashboard/hub',
                icon: PlusCircle,
                allowedRoles: ['ADMIN'],
            },
            {
                name: 'Product Map',
                href: '/dashboard/branch/product-map',
                icon: Network,
                allowedRoles: ['ADMIN'],
            },
            {
                name: 'Branch Working Date',
                href: '/dashboard/branch/working-date',
                icon: CalendarClock,
                allowedRoles: ['ADMIN'],
            },
        ],
    },
    {
        name: 'Center Operations',
        href: '/dashboard/centers',
        icon: MapPin,
        allowedRoles: ['BRANCH_MANAGER', 'AREA_MANAGER', 'FDO', 'ADMIN_NON_HO_BRANCH_SWITCH'],
        children: [
            {
                name: 'Create Center',
                href: '/dashboard/centers/create-center',
                icon: PlusCircle,
                allowedRoles: ['FDO', 'ADMIN_NON_HO_BRANCH_SWITCH'],
            },
            {
                name: 'Center Approval',
                href: '/dashboard/centers/approve',
                icon: ShieldCheck,
                allowedRoles: ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
            },
            {
                name: 'Groups',
                href: '/dashboard/centers/groups',
                icon: FolderTree,
                allowedRoles: ['BRANCH_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
            },
            {
                name: 'CenterTransfer',
                href: '/dashboard/centers/transfer',
                icon: ArrowLeftRight,
                allowedRoles: ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
            },
            {
                name: 'Locate Center',
                href: '/dashboard/centers/locate',
                icon: Map,
                allowedRoles: ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
            },
        ],
    },
    {
        name: 'Client',
        href: '/dashboard/client',
        icon: Users,
        allowedRoles: ['ADMIN', 'BRANCH_MANAGER', 'FDO', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'], // All client-related operations
        children: [
            {
                name: 'Search & Locate',
                href: '/dashboard/client-search',
                icon: UserSearch,
                allowedRoles: ['ADMIN', 'BRANCH_MANAGER', 'FDO', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
            },
            {
                name: 'Member Enrollment',
                href: '/dashboard/client/enrollment',
                icon: UserPlus,
                allowedRoles: ['FDO'],
            },
            {
                name: 'Credit Check',
                href: '/dashboard/client/credit-check',
                icon: ShieldCheck,
                allowedRoles: ['BRANCH_MANAGER', 'FDO'],
            },
            // {
            //     name: 'KYC Verification',
            //     href: '/dashboard/verification/kyc-verification',
            //     icon: ShieldCheck,
            //     allowedRoles: ['BRANCH_MANAGER', 'AREA_MANAGER'],
            // },
            {
                name: 'Member Approval',
                href: '/dashboard/approval/workbench',
                icon: ClipboardCheck,
                allowedRoles: ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH', 'QC'],
            },
            {
                name: 'Member Update',
                href: '/dashboard/client/client-update',
                icon: UsersRound,
                allowedRoles: ['FDO', 'ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH'],
            },
            {
                name: 'Co-Applicant Management',
                href: '/dashboard/client/co-applicants',
                icon: UserPlus,
                allowedRoles: ['FDO', 'ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH'],
            },
            {
                name: 'Group Assign',
                href: '/dashboard/client-operations/group-assign',
                icon: UsersRound,
                allowedRoles: ['BRANCH_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
            },
            {
                name: 'Client Transfer',
                href: '/dashboard/client-operations/transfer',
                icon: ArrowLeftRight,
                allowedRoles: ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH'],
            },
            {
                name: 'Inactive',
                href: '/dashboard/client-operations/inactive',
                icon: UserX,
                allowedRoles: ['BRANCH_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
            },
            {
                name: 'Re-active',
                href: '/dashboard/client-operations/reactive',
                icon: UserCheck,
                allowedRoles: ['BRANCH_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
            },
            {
                name: 'Member Validation',
                href: '/dashboard/client/enrollment-validation',
                icon: ClipboardCheck,
                allowedRoles: ['ADMIN'],
            },
            // Renewal Loan Application is now handled inside Member Enrollment
            // ("Renewal Loan" mode) — the standalone page at
            // /dashboard/loan-module/application redirects there.
            {
                name: 'Client Loan Tracker',
                href: '/dashboard/loan-module/loan-tracker',
                icon: Activity,
                allowedRoles: ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER', 'FDO', 'ADMIN_NON_HO_BRANCH_SWITCH'],
            },
        ],
    },
    {
        name: 'Loan Module',
        href: '/dashboard/loan-module',
        icon: CreditCard,
        allowedRoles: ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER', 'FDO', 'ADMIN_NON_HO_BRANCH_SWITCH'],
        children: [
            {
                name: 'Loan Indexation',
                href: '/dashboard/loan-module/loan-indexation',
                icon: BookOpen,
                allowedRoles: ['BRANCH_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH', 'ADMIN'],
            },
             {
                name: 'Member Individual',
                href: '/dashboard/loan-module/member-individual',
                icon: UserCog,
                allowedRoles: ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH', 'ADMIN'],
            },
            {
                name: 'Disbursement',
                href: '/dashboard/loan-module/disbursement',
                icon: Banknote,
                allowedRoles: ['AREA_MANAGER', 'ADMIN'],
            },
            {
                name: 'Final Disbursement',
                href: '/dashboard/loan-module/final-disbursement',
                icon: CheckCircle,
                allowedRoles: ['BRANCH_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH', 'ADMIN'],
            },
            {
                name: 'First Due Date Requests',
                href: '/dashboard/loan-module/first-due-date-requests',
                icon: CalendarClock,
                // Static fallback: ADMIN only. Sub Admin (custom RBAC role) reaches this
                // page via the RBAC pagePermissions grant, same as MPIN Change Requests.
                allowedRoles: ['ADMIN'],
            },
            {
                name: 'Change Funder',
                href: '/dashboard/loan-module/change-funder',
                icon: ArrowLeftRight,
                allowedRoles: ['AREA_MANAGER', 'ADMIN', 'BRANCH_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
            },
            {
                name: 'Delete Disbursement',
                href: '/dashboard/loan-module/delete-disbursement',
                icon: Trash2,
                allowedRoles: ['BRANCH_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH', 'ADMIN'],
            },
        ],
    },
    {
        name: 'Collections',
        href: '/dashboard/collections',
        icon: Receipt,
        allowedRoles: ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH', 'ADMIN', 'FDO'], // All collection-related roles
        children: [
            {
                name: 'Collection Approval',
                href: '/dashboard/collections/approval',
                icon: ShieldCheck,
                allowedRoles: ['BRANCH_MANAGER'],
            },
            {
                name: 'Demand Collection',
                href: '/dashboard/collections/demand-collection',
                icon: Receipt,
                allowedRoles: [ 'FDO'], // BM and FDO can access demand collection
            },
            {
                name: 'Arrear Collection',
                href: '/dashboard/collections/arrear-collection',
                icon: FileClock,
                allowedRoles: ['FDO'],
            },
            {
                name: 'Advance Collection',
                href: '/dashboard/collections/client-late-collection',
                icon: UserCircle,
                allowedRoles: [ 'FDO'], // BM and FDO can access client/late collection
                children: [
                    {
                        name: 'Single Collection',
                        href: '/dashboard/collections/client-late-collection/single-collection',
                        icon: UserCircle,
                        allowedRoles: [ 'FDO'], // BM and FDO can access single collection
                    },
                    {
                        name: 'Bulk Collection',
                        href: '/dashboard/collections/client-late-collection/bulk-collection',
                        icon: UsersRound,
                        allowedRoles: [ 'FDO'], // BM and FDO can access bulk collection
                    },
                ],
            },
            {
                name: 'Preclosure',
                href: '/dashboard/collections/foreclosure',
                icon: XCircle,
                allowedRoles: ['BRANCH_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'], // BM initiates foreclosure; AM uses approval queue
            },
            {
                name: 'Loan Advance Refund',
                href: '/dashboard/collections/savings-refund',
                icon: Undo2,
                allowedRoles: ['BRANCH_MANAGER', 'ADMIN'], // BM initiates foreclosure; AM uses approval queue
                requiresLoanAdvance: true,
            },
            {
                name: 'Preclosure Approval',
                href: '/dashboard/collections/foreclosure-approval',
                icon: ShieldCheck,
                allowedRoles: ['AREA_MANAGER', 'ADMIN'],
            },
            {
                name: 'Loan Write-Off / Death Closure',
                href: '/dashboard/collections/loan-writeoff-closure',
                icon: Ban,
                allowedRoles: ['ADMIN'],
            },
            {
                name: 'Member Collection Details',
                href: '/dashboard/collections/member-collection-details',
                icon: ClipboardList,
                allowedRoles: ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER'],
            },
            {
                name: 'Delete Demand Collection',
                href: '/dashboard/collections/delete-demand-collection',
                icon: Trash2,
                allowedRoles: ['BRANCH_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'], // Only Branch Manager can access delete demand collection
            },
        ],
    },
    {
        name: 'Daily Monitoring',
        href: '/dashboard/daily-monitoring',
        icon: BarChart3,
        allowedRoles: ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER'], // Admin, Area Manager, and Branch Manager can access monitoring screens
        children: [
            {
                name: 'New Zero Collection',
                href: '/dashboard/daily-monitoring/new-zero-collection',
                icon: Ban,
                allowedRoles: ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER'],
            },
            {
                name: 'Collection Followup',
                href: '/dashboard/daily-monitoring/collection-followup',
                icon: PhoneCall,
                allowedRoles: ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER'],
            },
            {
                name: 'Advance Collection',
                href: '/dashboard/daily-monitoring/advance-collection',
                icon: TrendingUp,
                allowedRoles: ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER'],
            },
            {
                name: 'Inter Branch',
                href: '/dashboard/daily-monitoring/inter-branch',
                icon: ArrowLeftRight,
                allowedRoles: ['ADMIN', 'AREA_MANAGER'],
            },
        ],
    },
    {
        name: 'Masters',
        href: '/dashboard/masters',
        icon: Database,
        allowedRoles: ['ADMIN'], // Only Admin manages masters (AM excluded per megadoc)
        children: [
            // ── Role & Access Management ──────────────────
            {
                name: 'Role Management',
                href: '/dashboard/admin/roles',
                icon: ShieldCheck,
                allowedRoles: ['ADMIN'],
            },
            {
                name: 'Report Permissions',
                href: '/dashboard/admin/report-permissions',
                icon: FileBarChart2,
                allowedRoles: ['ADMIN'],
            },
            {
                name: 'Member Approval Workflow',
                href: '/dashboard/masters/client-approval-workflow',
                icon: CheckCircle,
                allowedRoles: ['ADMIN'],
            },
            {
                name: 'Funder',
                href: '/dashboard/masters/funder',
                icon: Landmark,
                allowedRoles: ['ADMIN'],
            },
            {
                name: 'GL Master',
                href: '/dashboard/masters/gl',
                icon: Book,
                allowedRoles: ['ADMIN'],
            },
            {
                name: 'Loan Product Type',
                href: '/dashboard/masters/loan-product-type',
                icon: Tags,
                allowedRoles: ['ADMIN'],
            },
            {
                name: 'Loan Product',
                href: '/dashboard/masters/loan-product',
                icon: Package,
                allowedRoles: ['ADMIN'],
            },
            {
                name: 'Loan Purpose Type',
                href: '/dashboard/masters/loan-purpose-type',
                icon: Tag,
                allowedRoles: ['ADMIN'],
            },
            {
                name: 'Loan Purpose',
                href: '/dashboard/masters/loan-purpose',
                icon: Target,
                allowedRoles: ['ADMIN'],
            },
            {
                name: 'Leave Type',
                href: '/dashboard/masters/leave-type',
                icon: CalendarX,
                allowedRoles: ['ADMIN'],
            },
            {
                name: 'Economic Activity Type',
                href: '/dashboard/masters/economic-activity-type',
                icon: Layers,
                allowedRoles: ['ADMIN'],
            },
            {
                name: 'Meeting Place',
                href: '/dashboard/masters/meeting-place',
                icon: MapPinned,
                allowedRoles: ['ADMIN'],
            },
            {
                name: 'Economic Activity',
                href: '/dashboard/masters/economic-activity',
                icon: Briefcase,
                allowedRoles: ['ADMIN'],
            },
            {
                name: 'Questionnaire',
                href: '/dashboard/masters/questionnaire',
                icon: HelpCircle,
                allowedRoles: ['ADMIN'],
            },
            {
                name: 'Super Control',
                href: '/dashboard/masters/super-control',
                icon: ShieldCheck,
                allowedRoles: ['ADMIN'],
                children: [
                    {
                        name: 'Individual Funder Change',
                        href: '/dashboard/masters/super-control/individual-funder-change',
                        icon: PencilLine,
                        allowedRoles: ['ADMIN'],
                    },
                    {
                        name: 'Live Loan Schedule Edit',
                        href: '/dashboard/masters/super-control/loan-schedule-edit',
                        icon: PencilLine,
                        allowedRoles: ['ADMIN'],
                    },
                    {
                        name: 'Member ID Edit',
                        href: '/dashboard/masters/super-control/member-id-edit',
                        icon: UsersRound,
                        allowedRoles: ['ADMIN'],
                    },
                    {
                        name: 'Bulk Funder Change',
                        href: '/dashboard/masters/super-control/bulk-funder-change',
                        icon: Repeat,
                        allowedRoles: ['ADMIN'],
                    },
                    {
                        name: 'Audit History',
                        href: '/dashboard/masters/super-control/audit-history',
                        icon: History,
                        allowedRoles: ['ADMIN'],
                    },
                ],
            },
            {
                name: 'Upload',
                href: '/dashboard/masters/uploan',
                icon: History,
                allowedRoles: ['ADMIN'],
                children: [
                    {
                        name: 'Member Upload',
                        href: '/dashboard/masters/uploan/member',
                        icon: UsersRound,
                        allowedRoles: ['ADMIN'],
                    },
                    {
                        name: 'Loan Upload',
                        href: '/dashboard/masters/uploan/loan',
                        icon: Save,
                        allowedRoles: ['ADMIN'],
                    },
                    {
                        name: 'Loan History Edit',
                        href: '/dashboard/masters/uploan/loan-history',
                        icon: PencilLine,
                        allowedRoles: ['ADMIN'],
                    },
                    {
                        name: 'Loan Advance Edit',
                        href: '/dashboard/masters/uploan/loan-advance',
                        icon: Coins,
                        allowedRoles: ['ADMIN'],
                    },
                    {
                        name: 'Closed Member Upload',
                        href: '/dashboard/masters/uploan/closed-member',
                        icon: Coins,
                        allowedRoles: ['ADMIN'],
                    },
                    {
                        name: 'Import History',
                        href: '/dashboard/masters/uploan/history',
                        icon: ClipboardList,
                        allowedRoles: ['ADMIN'],
                    },
                ],
            },
            {
                name: 'Brand Theme',
                href: '/dashboard/settings/brand',
                icon: Palette,
                allowedRoles: ['ADMIN'],
            },
            {
                name: 'Highmark Settings',
                href: '/dashboard/masters/highmark-settings',
                icon: ShieldCheck,
                allowedRoles: ['ADMIN'],
            },
        ],
    },
    {
        name: 'Gold Loan',
        href: '/dashboard/gold-return',
        icon: Coins,
        allowedRoles: ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'],
        children: [
            {
                name: 'Gold Return',
                href: '/dashboard/gold-return',
                icon: Undo2,
                allowedRoles: ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'],
            },
        ],
    },
    {
        name: 'Employees',
        href: '/dashboard/employees',
        icon: UserCog,
        allowedRoles: ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER', 'FDO'], // Employee operations
        children: [
            {
                name: 'User Management',
                href: '/dashboard/employees/management',
                icon: UserCog,
                allowedRoles: ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER'], // Combined Create & Manage
            },
            {
                name: 'Reset Password',
                href: '/dashboard/employees/reset-password',
                icon: Key,
                allowedRoles: ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER', 'FDO'], // Admin, BM, AM, and FDO can reset passwords
            },
            {
                name: 'Trained Faces',
                href: '/dashboard/admin/face-templates',
                icon: ScanFace,
                allowedRoles: ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER'],
            },
            { // Same audience as User Management
                name: 'MPIN Change Requests',
                href: '/dashboard/employees/mpin-change-requests',
                icon: ShieldCheck,
                // Static fallback: ADMIN only. A "Sub Admin" is a custom RBAC role
                // (Role.isSubAdmin flag, not a fixed role string) — it reaches this
                // page via the RBAC pagePermissions grant (Admin Settings > Role
                // Permissions), same as every other Sub-Admin-reachable page in this app.
                allowedRoles: ['ADMIN'],
            },
            {
                name: 'Login Access',
                href: '/dashboard/employees/login-access',
                icon: MonitorSmartphone,
                // ADMIN by default; Sub Admin (custom RBAC role) reaches it via a pagePermissions grant.
                allowedRoles: ['ADMIN'],
            },
        ],
    },
    {
        name: 'HR Management',
        href: '/dashboard/hr',
        icon: Users2,
        allowedRoles: ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER', 'FDO', 'HR', 'HRM', 'CM-HR'],
        children: [
            {
                name: 'HR Dashboard',
                href: '/dashboard/hr',
                icon: LayoutDashboard,
                allowedRoles: ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER', 'FDO', 'HR', 'HRM', 'CM-HR'],
            },
            {
                name: 'Attendance',
                href: '/dashboard/hr/attendance',
                icon: Clock,
                allowedRoles: ['BRANCH_MANAGER', 'AREA_MANAGER'],
            },
            {
                name: 'Employee Management',
                href: '/dashboard/hr/onboarding',
                icon: Users,
                children: [
                    {
                        name: 'New Employee Requests',
                        href: '/dashboard/hr/onboarding',
                        icon: UserPlus,
                        allowedRoles: ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER', 'HR', 'HRM', 'CM-HR'],
                    },
                    {
                        name: 'Employee List',
                        href: '/dashboard/hr/employees',
                        icon: IdCard,
                        allowedRoles: ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER', 'HR', 'HRM', 'CM-HR'],
                    },
                    {
                        name: 'My Profile',
                        href: '/dashboard/hr/my-profile',
                        icon: UserCircle,
                        allowedRoles: ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER', 'FDO', 'HR', 'HRM', 'CM-HR'],
                    },
                    {
                        name: 'Employee Documents',
                        href: '/dashboard/hr/employee-documents',
                        icon: FileUser,
                        allowedRoles: ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER', 'HR', 'HRM', 'CM-HR'],
                    },
                    {
                        name: 'Belongings',
                        href: '/dashboard/hr/belongings',
                        icon: Package,
                        allowedRoles: ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER', 'HR', 'HRM', 'CM-HR'],
                    },
                ],
            },
            {
                name: 'Employee Lifecycle',
                href: '/dashboard/hr/lifecycle/confirmation',
                icon: RefreshCw,
                children: [
                    {
                        name: 'Confirmation',
                        href: '/dashboard/hr/lifecycle/confirmation',
                        icon: BadgeCheck,
                        allowedRoles: ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER', 'HR', 'HRM', 'CM-HR'],
                    },
                    {
                        name: 'Promotion',
                        href: '/dashboard/hr/lifecycle/promotion',
                        icon: TrendingUp,
                        allowedRoles: ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER', 'HR', 'HRM', 'CM-HR'],
                    },
                    {
                        name: 'Transfer',
                        href: '/dashboard/hr/lifecycle/transfer',
                        icon: ArrowLeftRight,
                        allowedRoles: ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER', 'HR', 'HRM', 'CM-HR'],
                    },
                    {
                        name: 'Exit / Clearance',
                        href: '/dashboard/hr/lifecycle/exit',
                        icon: LogOut,
                        allowedRoles: ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER', 'HR', 'HRM', 'CM-HR'],
                    },
                ],
            },
            {
                name: 'Leave Management',
                href: '/dashboard/hr/leave/apply',
                icon: CalendarRange,
                children: [
                    {
                        name: 'Apply Leave',
                        href: '/dashboard/hr/leave/apply',
                        icon: CalendarRange,
                        allowedRoles: ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER', 'FDO', 'HR', 'HRM', 'CM-HR'],
                    },
                    {
                        name: 'Leave Approval',
                        href: '/dashboard/hr/leave/approval',
                        icon: CalendarCheck,
                        allowedRoles: ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER', 'HR', 'HRM', 'CM-HR'],
                    },
                    {
                        name: 'Leave Balance',
                        href: '/dashboard/hr/leave-balance',
                        icon: CalendarCheck,
                        allowedRoles: ['AREA_MANAGER'],
                    },
                ],
            },
            {
                name: 'Permission Management',
                href: '/dashboard/hr/permission/apply',
                icon: Clock,
                children: [
                    {
                        name: 'Apply Permission',
                        href: '/dashboard/hr/permission/apply',
                        icon: Clock,
                        allowedRoles: ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER', 'FDO', 'HR', 'HRM', 'CM-HR'],
                    },
                    {
                        name: 'Permission Approval',
                        href: '/dashboard/hr/permission/approval',
                        icon: CheckCircle,
                        allowedRoles: ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER', 'HR', 'HRM', 'CM-HR'],
                    },
                ],
            },
            {
                name: 'Payroll & Compensation',
                href: '/dashboard/hr/salary',
                icon: IndianRupee,
                children: [
                    {
                        name: 'Salary',
                        href: '/dashboard/hr/salary',
                        icon: IndianRupee,
                        allowedRoles: ['AREA_MANAGER'],
                    },
                    {
                        name: 'Salary Master',
                        href: '/dashboard/hr/salary-master',
                        icon: Settings2,
                        allowedRoles: ['AREA_MANAGER'],
                    },
                    {
                        name: 'Payroll',
                        href: '/dashboard/hr/payroll',
                        icon: Receipt,
                        allowedRoles: ['AREA_MANAGER', 'ADMIN'],
                    },
                ],
            },
            {
                name: 'Staff Loans',
                href: '/dashboard/hr/staff-loans',
                icon: HandCoins,
                allowedRoles: ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER', 'FDO', 'HR', 'HRM', 'CM-HR'],
                children: [
                    {
                        name: 'Apply Staff Loan',
                        href: '/dashboard/hr/staff-loans/apply',
                        icon: HandCoins,
                        allowedRoles: ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER', 'FDO', 'HR', 'HRM', 'CM-HR'],
                    },
                    {
                        name: 'Loan Management',
                        href: '/dashboard/hr/staff-loans/management',
                        icon: ShieldCheck,
                        allowedRoles: ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER', 'FDO', 'HR', 'HRM', 'CM-HR'],
                    },
                    {
                        name: 'Staff Loan Schemes',
                        href: '/dashboard/masters/staff-loan-schemes',
                        icon: HandCoins,
                        allowedRoles: ['ADMIN'],
                    },
                    {
                        name: 'Staff Loan Approval Workflow',
                        href: '/dashboard/masters/staff-loan-approval-workflow',
                        icon: CheckCircle,
                        allowedRoles: ['ADMIN'],
                    },
                ],
            },
            {
                name: 'Staff Advance',
                href: '/dashboard/hr/staff-advance',
                icon: HandCoins,
                allowedRoles: ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER', 'FDO', 'HR', 'HRM', 'CM-HR'],
                children: [
                    {
                        name: 'Apply Staff Advance',
                        href: '/dashboard/hr/staff-advance/apply',
                        icon: HandCoins,
                        allowedRoles: ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER', 'FDO', 'HR', 'HRM', 'CM-HR'],
                    },
                    {
                        name: 'Advance Approval',
                        href: '/dashboard/hr/staff-advance/approval',
                        icon: CheckCircle,
                        allowedRoles: ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER', 'FDO', 'HR', 'HRM', 'CM-HR'],
                    },
                    {
                        name: 'Advance Management',
                        href: '/dashboard/hr/staff-advance/management',
                        icon: ShieldCheck,
                        allowedRoles: ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER', 'HR', 'HRM', 'CM-HR'],
                    },
                ],
            },
            {
                name: 'Staff Settlement',
                href: '/dashboard/hr/staff-settlement',
                icon: Receipt,
                allowedRoles: ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER', 'HR', 'HRM', 'CM-HR'],
            },
            {
                name: 'Performance',
                href: '/dashboard/hr/performance/tasks',
                icon: Target,
                children: [
                    // Performance Goals / Review / Analysis menus are hidden for now
                    // (pages + APIs under /dashboard/hr/performance/{goals,reviews,analysis}
                    // still exist — re-add the entries here to bring them back).
                    {
                        name: 'FDO Tasks',
                        href: '/dashboard/hr/performance/tasks',
                        icon: ListChecks,
                        allowedRoles: ['ADMIN'],
                    },
                ],
            },
            {
                name: 'Policies & Documents',
                href: '/dashboard/hr/policies',
                icon: FileText,
                allowedRoles: ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER', 'FDO', 'HR', 'HRM', 'CM-HR'],
            },
            {
                name: 'Reports',
                href: '/dashboard/hr/reports',
                icon: FileBarChart2,
                children: [
                    {
                        name: 'Attendance Reports',
                        href: '/dashboard/hr/reports/late-attendance',
                        icon: Clock,
                        allowedRoles: ['ADMIN', 'AREA_MANAGER', 'HR', 'HRM', 'CM-HR', 'BRANCH_MANAGER'],
                        children: [
                            {
                                name: 'Attendance Detailed',
                                href: '/dashboard/reports/employee/attendance-detailed',
                                icon: Clock,
                                allowedRoles: ['ADMIN', 'AREA_MANAGER', 'HR', 'HRM', 'CM-HR', 'BRANCH_MANAGER'],
                            },
                            {
                                name: 'Attendance Summary',
                                href: '/dashboard/reports/employee/attendance-summary',
                                icon: CalendarDays,
                                allowedRoles: ['ADMIN', 'AREA_MANAGER', 'HR', 'HRM', 'CM-HR', 'BRANCH_MANAGER'],
                            },
                            {
                                name: 'Late Attendance Report',
                                href: '/dashboard/hr/reports/late-attendance',
                                icon: FileClock,
                                allowedRoles: ['ADMIN', 'AREA_MANAGER', 'HR', 'HRM', 'CM-HR'],
                            },
                            {
                                name: 'Absentee Report',
                                href: '/dashboard/hr/reports/absentee',
                                icon: UserX,
                                allowedRoles: ['ADMIN', 'AREA_MANAGER', 'HR', 'HRM', 'CM-HR'],
                            },
                            {
                                name: 'Leave Register',
                                href: '/dashboard/hr/reports/leave-register',
                                icon: CalendarRange,
                                allowedRoles: ['ADMIN', 'AREA_MANAGER', 'HR', 'HRM', 'CM-HR'],
                            },
                            {
                                name: 'Leave Balance Report',
                                href: '/dashboard/hr/reports/leave-balance',
                                icon: CalendarCheck,
                                allowedRoles: ['ADMIN', 'AREA_MANAGER', 'HR', 'HRM', 'CM-HR'],
                            },
                            {
                                name: 'Permission Register',
                                href: '/dashboard/hr/reports/permission-register',
                                icon: CalendarClock,
                                allowedRoles: ['ADMIN', 'AREA_MANAGER', 'HR', 'HRM', 'CM-HR'],
                            },
                            {
                                name: 'Missed Punch In Report',
                                href: '/dashboard/hr/reports/missed-punch-in',
                                icon: ScanFace,
                                allowedRoles: ['ADMIN', 'AREA_MANAGER', 'HR', 'HRM', 'CM-HR'],
                            },
                            {
                                name: 'Holiday Report',
                                href: '/dashboard/hr/reports/holiday-register',
                                icon: CalendarDays,
                                allowedRoles: ['ADMIN', 'AREA_MANAGER', 'HR', 'HRM', 'CM-HR'],
                            },
                        ],
                    },
                    {
                        name: 'Employee Lifecycle Reports',
                        href: '/dashboard/hr/reports/employee-master',
                        icon: FileUser,
                        allowedRoles: ['ADMIN', 'AREA_MANAGER', 'HR', 'HRM', 'CM-HR'],
                        children: [
                            {
                                name: 'Employee Master Report',
                                href: '/dashboard/hr/reports/employee-master',
                                icon: FileUser,
                                allowedRoles: ['ADMIN', 'AREA_MANAGER', 'HR', 'HRM', 'CM-HR'],
                            },
                            {
                                name: 'Joining Report',
                                href: '/dashboard/hr/reports/joining',
                                icon: UserPlus,
                                allowedRoles: ['ADMIN', 'AREA_MANAGER', 'HR', 'HRM', 'CM-HR'],
                            },
                            {
                                name: 'Exit Report',
                                href: '/dashboard/hr/reports/exit',
                                icon: LogOut,
                                allowedRoles: ['ADMIN', 'AREA_MANAGER', 'HR', 'HRM', 'CM-HR'],
                            },
                            {
                                name: 'Transfer Report',
                                href: '/dashboard/hr/reports/transfer',
                                icon: ArrowLeftRight,
                                allowedRoles: ['ADMIN', 'AREA_MANAGER', 'HR', 'HRM', 'CM-HR'],
                            },
                            {
                                name: 'Promotion Report',
                                href: '/dashboard/hr/reports/promotion',
                                icon: TrendingUp,
                                allowedRoles: ['ADMIN', 'AREA_MANAGER', 'HR', 'HRM', 'CM-HR'],
                            },
                            {
                                name: 'Confirmation Report',
                                href: '/dashboard/hr/reports/confirmation',
                                icon: BadgeCheck,
                                allowedRoles: ['ADMIN', 'AREA_MANAGER', 'HR', 'HRM', 'CM-HR'],
                            },
                        ],
                    },
                    {
                        name: 'Payroll Reports',
                        href: '/dashboard/hr/reports/salary-register',
                        icon: IndianRupee,
                        allowedRoles: ['ADMIN', 'AREA_MANAGER', 'HR', 'HRM', 'CM-HR'],
                        children: [
                            {
                                name: 'Salary Register',
                                href: '/dashboard/hr/reports/salary-register',
                                icon: IndianRupee,
                                allowedRoles: ['ADMIN', 'AREA_MANAGER', 'HR', 'HRM', 'CM-HR'],
                            },
                            {
                                name: 'Staff Loan Deduction',
                                href: '/dashboard/hr/reports/staff-loan-deduction',
                                icon: HandCoins,
                                allowedRoles: ['ADMIN', 'AREA_MANAGER', 'HR', 'HRM', 'CM-HR'],
                            },
                            {
                                name: 'Staff Advance Deduction',
                                href: '/dashboard/hr/reports/staff-advance-deduction',
                                icon: Wallet,
                                allowedRoles: ['ADMIN', 'AREA_MANAGER', 'HR', 'HRM', 'CM-HR'],
                            },
                            {
                                name: 'Incentive Report',
                                href: '/dashboard/reports/employee/incentive-report',
                                icon: Wallet,
                                allowedRoles: ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
                            },
                        ],
                    },
                    {
                        name: 'Staff Loan & Advance Reports',
                        href: '/dashboard/hr/reports/staff-outstanding',
                        icon: HandCoins,
                        allowedRoles: ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER', 'HR', 'HRM', 'CM-HR'],
                        children: [
                            {
                                name: 'Total Staff Outstanding',
                                href: '/dashboard/hr/reports/staff-outstanding',
                                icon: Wallet,
                                allowedRoles: ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER', 'HR', 'HRM', 'CM-HR'],
                            },
                            {
                                name: 'Active Staff Loans',
                                href: '/dashboard/hr/reports/active-staff-loans',
                                icon: HandCoins,
                                allowedRoles: ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER', 'HR', 'HRM', 'CM-HR'],
                            },
                            {
                                name: 'Active Staff Advances',
                                href: '/dashboard/hr/reports/active-staff-advances',
                                icon: Wallet,
                                allowedRoles: ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER', 'HR', 'HRM', 'CM-HR'],
                            },
                            {
                                name: 'Staff Loan Schedule',
                                href: '/dashboard/hr/reports/staff-loan-schedule',
                                icon: CalendarRange,
                                allowedRoles: ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER', 'HR', 'HRM', 'CM-HR'],
                            },
                            {
                                name: 'Staff Advance Schedule',
                                href: '/dashboard/hr/reports/staff-advance-schedule',
                                icon: CalendarRange,
                                allowedRoles: ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER', 'HR', 'HRM', 'CM-HR'],
                            },
                            {
                                name: 'Staff Loan Closure',
                                href: '/dashboard/hr/reports/staff-loan-closure',
                                icon: CheckCircle,
                                allowedRoles: ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER', 'HR', 'HRM', 'CM-HR'],
                            },
                            {
                                name: 'Staff Advance Closure',
                                href: '/dashboard/hr/reports/staff-advance-closure',
                                icon: CheckCircle,
                                allowedRoles: ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER', 'HR', 'HRM', 'CM-HR'],
                            },
                        ],
                    },
                    {
                        name: 'Field Tracking Reports',
                        href: '/dashboard/hr/reports/travel-client-visit',
                        icon: MapPinned,
                        allowedRoles: ['ADMIN', 'AREA_MANAGER', 'HR', 'HRM', 'CM-HR'],
                        children: [
                            {
                                name: 'Travel & Client Visit Report',
                                href: '/dashboard/hr/reports/travel-client-visit',
                                icon: MapPinned,
                                allowedRoles: ['ADMIN', 'AREA_MANAGER', 'HR', 'HRM', 'CM-HR'],
                            },
                            {
                                name: 'Travel Path Similarity Report',
                                href: '/dashboard/hr/reports/travel-similarity',
                                icon: GitCompare,
                                allowedRoles: ['ADMIN', 'AREA_MANAGER', 'HR', 'HRM', 'CM-HR'],
                            },
                            {
                                name: 'FDO Performance',
                                href: '/dashboard/reports/employee/fdo-performance',
                                icon: Award,
                                allowedRoles: ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
                            },
                            {
                                name: 'FDO Task Report',
                                href: '/dashboard/reports/employee/task-report',
                                icon: Target,
                                allowedRoles: ['ADMIN'],
                            },
                        ],
                    },
                ],
            },
            {
                name: 'Field Operations',
                href: '/dashboard/hr/tracking/live',
                icon: MapPinned,
                children: [
                    {
                        name: 'Live Employee Tracking',
                        href: '/dashboard/hr/tracking/live',
                        icon: MapPinned,
                        allowedRoles: ['ADMIN', 'AREA_MANAGER', 'HR', 'HRM', 'CM-HR'],
                    },
                ],
            },
            {
                name: 'HR Administration',
                href: '/dashboard/admin/hr-departments',
                icon: Settings,
                children: [
                    {
                        name: 'Leave Type',
                        href: '/dashboard/hr/leave-type',
                        icon: CalendarX,
                        allowedRoles: ['AREA_MANAGER'],
                    },
                    {
                        name: 'Permission Type',
                        href: '/dashboard/hr/permission-type',
                        icon: Clock,
                        allowedRoles: ['AREA_MANAGER'],
                    },
                    {
                        name: 'Working Hours',
                        href: '/dashboard/hr/working-hours',
                        icon: CalendarClock,
                        allowedRoles: ['ADMIN', 'AREA_MANAGER'],
                    },
                    {
                        name: 'Week Configuration',
                        href: '/dashboard/hr/attendance/week-configuration',
                        icon: CalendarClock,
                        allowedRoles: ['ADMIN', 'AREA_MANAGER'],
                    },
                    {
                        name: 'Holiday Calendar',
                        href: '/dashboard/hr/attendance/holiday-calendar',
                        icon: CalendarDays,
                        allowedRoles: ['ADMIN', 'AREA_MANAGER'],
                    },
                    {
                        name: 'Shift Management',
                        href: '/dashboard/hr/shift-management',
                        icon: Clock3,
                        allowedRoles: ['ADMIN', 'AREA_MANAGER'],
                    },
                    {
                        name: 'Punch Radius',
                        href: '/dashboard/hr/punch-radius',
                        icon: MapPinned,
                        allowedRoles: ['ADMIN', 'AREA_MANAGER'],
                    },
                    {
                        name: 'Department Master',
                        href: '/dashboard/admin/hr-departments',
                        icon: Building2,
                        allowedRoles: ['ADMIN'],
                    },
                    {
                        name: 'Designation Master',
                        href: '/dashboard/admin/hr-designations',
                        icon: Briefcase,
                        allowedRoles: ['ADMIN'],
                    },
                    {
                        name: 'Employee Field Config',
                        href: '/dashboard/admin/hr-field-config',
                        icon: Settings2,
                        allowedRoles: ['ADMIN'],
                    },
                    {
                        name: 'Belonging Catalog',
                        href: '/dashboard/admin/hr-belonging-catalog',
                        icon: ClipboardList,
                        allowedRoles: ['ADMIN'],
                    },
                    {
                        name: 'Exit Clearance Config',
                        href: '/dashboard/admin/hr-exit-clearance-config',
                        icon: ListChecks,
                        allowedRoles: ['ADMIN'],
                    },
                    {
                        name: 'Approval Settings',
                        href: '/dashboard/hr/approval-settings',
                        icon: ShieldCheck,
                        allowedRoles: ['ADMIN'],
                    },
                    {
                        name: 'Onboarding Field Validation',
                        href: '/dashboard/admin/hr-onboarding-field-config',
                        icon: ListChecks,
                        allowedRoles: ['ADMIN'],
                    },
                    {
                        name: 'Probation Period Config',
                        href: '/dashboard/admin/hr-probation-config',
                        icon: Clock,
                        allowedRoles: ['ADMIN'],
                    },
                    {
                        name: 'Incentive Configuration',
                        href: '/dashboard/masters/incentive-config',
                        icon: Settings2,
                        allowedRoles: ['ADMIN'],
                    },
                ],
            },
        ],
    },
    {
        name: 'Accounts',
        href: '/dashboard/accounts',
        icon: Wallet,
        allowedRoles: ['ADMIN'], // Only Admin has access to accounts (AM excluded per megadoc)
        children: [
            {
                name: 'Accounts Group',
                href: '/dashboard/accounts/group',
                icon: Layers,
                allowedRoles: ['ADMIN'],
            },
            {
                name: 'Accounts Ledger',
                href: '/dashboard/accounts/ledger',
                icon: NotebookText,
                allowedRoles: ['ADMIN'],
            },
            {
                name: 'Self Accounts',
                href: '/dashboard/accounts/self-accounts',
                icon: Wallet2,
                allowedRoles: ['ADMIN'],
            },
            {
                name: 'Opening Balance',
                href: '/dashboard/accounts/opening-balance',
                icon: Landmark,
                allowedRoles: ['ADMIN'],
            },
        ],
    },
    {
        name: 'Transactions',
        href: '/dashboard/transactions',
        icon: ArrowLeftRight,
        allowedRoles: ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'],
        children: [
            {
                name: 'Cash Receipt',
                href: '/dashboard/transactions/cash-receipt',
                icon: ArrowDownCircle,
                allowedRoles: ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'],
            },
            {
                name: 'Cash Payment',
                href: '/dashboard/transactions/cash-payment',
                icon: ArrowUpCircle,
                allowedRoles: ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'],
            },
            {
                name: 'Bank Receipt',
                href: '/dashboard/transactions/bank-receipt',
                icon: ArrowDownToLine,
                allowedRoles: ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'],
            },
            {
                name: 'Bank Payment',
                href: '/dashboard/transactions/bank-payment',
                icon: ArrowUpFromLine,
                allowedRoles: ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'],
            },
            {
                name: 'Journal',
                href: '/dashboard/transactions/journal',
                icon: NotebookPen,
                allowedRoles: ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'],
            },
            {
                name: 'Contra',
                href: '/dashboard/transactions/contra',
                icon: Shuffle,
                allowedRoles: ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'],
            },
            // {
            //     name: 'Modification',
            //     href: '/dashboard/transactions/modification',
            //     icon: PencilLine,
            //     allowedRoles: ['ADMIN'], // Modification remains ADMIN-only
            // },
        ],
    },
    // Unified Reports - Merged from Admin Reports and BM/FDO/AM Reports
    {
        name: 'Reports',
        href: '/dashboard/reports',
        icon: FileBarChart,
        alwaysVisible: true,  // Always shown for applicable roles — bypasses page-permission filter
        allowedRoles: ['ADMIN', 'BRANCH_MANAGER', 'FDO', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'], // All roles can access reports
        children: [
            {
                name: 'Request Report',
                href: '/dashboard/reports/request-report',
                icon: Download,
                allowedRoles: ['ADMIN', 'BRANCH_MANAGER', 'FDO', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
            },
            {
                name: 'Demand',
                href: '/dashboard/reports/demand',
                icon: TrendingUp,
                allowedRoles: ['BRANCH_MANAGER', 'FDO', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
                children: [
                    {
                        name: 'Demand Sheet',
                        href: '/dashboard/reports/demand/demand-sheet',
                        icon: FileSpreadsheet,
                        allowedRoles: ['BRANCH_MANAGER', 'FDO', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
                    },
                    {
                        name: 'Arrear Demand Sheet',
                        href: '/dashboard/reports/demand/arrear-demand-sheet',
                        icon: FileClock,
                        allowedRoles: ['BRANCH_MANAGER', 'FDO', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
                    },
                    {
                        name: 'Future Demand',
                        href: '/dashboard/reports/demand/future-demand',
                        icon: CalendarClock,
                        allowedRoles: ['BRANCH_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
                    },
                    {
                        name: 'Branch Demand',
                        href: '/dashboard/reports/demand/branch-demand',
                        icon: Building2,
                        allowedRoles: ['BRANCH_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
                    },
                ],
            },
            {
                name: 'Client',
                href: '/dashboard/reports/client',
                icon: Users,
                allowedRoles: ['BRANCH_MANAGER', 'FDO', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
                children: [
                    {
                        name: 'Member Report',
                        href: '/dashboard/reports/client/member-report',
                        icon: FileSpreadsheet,
                        allowedRoles: ['BRANCH_MANAGER', 'FDO', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
                    },
                    {
                        name: 'Application Form',
                        href: '/dashboard/reports/client/application-form',
                        icon: FileUser,
                        allowedRoles: ['BRANCH_MANAGER', 'FDO', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
                    },
                    {
                        name: 'Balance Information',
                        href: '/dashboard/reports/client/balance-information',
                        icon: Wallet2,
                        allowedRoles: ['BRANCH_MANAGER', 'FDO', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
                    },
                    {
                        name: 'Loan Schedule',
                        href: '/dashboard/reports/client/loan-schedule',
                        icon: CalendarDays,
                        allowedRoles: ['BRANCH_MANAGER', 'FDO', 'ADMIN_NON_HO_BRANCH_SWITCH'],
                    },
                    // {
                    //     name: 'Loan Ledger',
                    //     href: '/dashboard/reports/client/loan-ledger',
                    //     icon: NotebookText,
                    //     allowedRoles: ['BRANCH_MANAGER', 'FDO', 'ADMIN_NON_HO_BRANCH_SWITCH'],
                    // },
                    {
                        name: 'Addition Deletion',
                        href: '/dashboard/reports/client/addition-deletion',
                        icon: ListChecks,
                        allowedRoles: ['BRANCH_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
                    },
                    {
                        name: 'Addition Disbursed',
                        href: '/dashboard/reports/client/addition-disbursed',
                        icon: Banknote,
                        allowedRoles: ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
                    },
                    {
                        name: 'Dropouts',
                        href: '/dashboard/reports/client/dropouts',
                        icon: UserX,
                        allowedRoles: ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
                    },
                    {
                        name: 'Meeting Attendance',
                        href: '/dashboard/reports/client/meeting-attendance',
                        icon: CalendarCheck,
                        allowedRoles: ['BRANCH_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
                    },
                    {
                        name: ' Client Transfer',
                        href: '/dashboard/reports/client/transfer',
                        icon: ArrowLeftRight,
                        allowedRoles: ['BRANCH_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
                    },
                    {
                        name: 'Double Members',
                        href: '/dashboard/reports/client/double-clients',
                        icon: Copy,
                        allowedRoles: ['BRANCH_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
                    },
                    {
                        name: 'Waiting Borrowers',
                        href: '/dashboard/reports/client/waiting-borrowers',
                        icon: Clock,
                        allowedRoles: ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
                    },
                    {
                        name: 'Loan Advance Ledger',
                        href: '/dashboard/reports/client/loan-advance',
                        icon: NotebookText,
                        allowedRoles: ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
                        requiresLoanAdvance: true,
                    },
                    {
                        name: 'Death Member',
                        href: '/dashboard/reports/client/death-member',
                        icon: UserMinus,
                        allowedRoles: ['AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
                    },
                    {
                        name: 'Closed Loan Report',
                        href: '/dashboard/reports/client/closed-loan-report',
                        icon: FileCheck,
                        allowedRoles: ['AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
                    },
                ],
            },

            {
                name: 'Collection',
                href: '/dashboard/reports/collection',
                icon: Receipt,
                allowedRoles: ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
                children: [
                    {
                        name: 'MCR',
                        href: '/dashboard/reports/collection/mcr',
                        icon: CalendarRange,
                        allowedRoles: ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
                    },
                    {
                        name: 'DCR',
                        href: '/dashboard/reports/collection/dcr',
                        icon: CalendarDays,
                        allowedRoles: ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
                    },
                    {
                        name: 'DCB',
                        href: '/dashboard/reports/collection/dcb',
                        icon: Scale,
                        allowedRoles: ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
                    },
                    {
                        name: 'CCR',
                        href: '/dashboard/reports/collection/ccr',
                        icon: Banknote,
                        allowedRoles: ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
                    },
                    {
                        name: 'Meeting Check',
                        href: '/dashboard/reports/collection/meeting-check',
                        icon: CalendarCheck,
                        allowedRoles: ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
                    },
                    {
                        name: 'Receipts',
                        href: '/dashboard/reports/collection/receipts',
                        icon: Receipt,
                        allowedRoles: ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
                    },
                    {
                        name: 'Loan Advance Report',
                        href: '/dashboard/reports/collection/loan-savings',
                        icon: HandCoins,
                        allowedRoles: ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
                        requiresLoanAdvance: true,
                    },
                    {
                        name: 'Future Report',
                        href: '/dashboard/reports/collection/future-report',
                        icon: CalendarClock,
                        allowedRoles: ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
                    },
                ],
            },
            {
                name: 'Portfolio',
                href: '/dashboard/admin-reports/portfolio',
                icon: PieChart,
                allowedRoles: ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'],
                children: [
                    {
                        name: 'OS Branchwise',
                        href: '/dashboard/admin-reports/portfolio/os-branchwise',
                        icon: Building2,
                        allowedRoles: ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'],
                    },
                    {
                        name: 'Individual Ledger',
                        href: '/dashboard/reports/portfolio/individual-ledger',
                        icon: NotebookText,
                        allowedRoles: ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'],
                    },
                    {
                        name: 'Loan Disbursement',
                        href: '/dashboard/reports/portfolio/loan-disbursement',
                        icon: Banknote,
                        allowedRoles: ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'],
                    },
                    {
                        name: 'Loan Advance Refund',
                        href: '/dashboard/reports/portfolio/loan-advance-refund',
                        icon: Undo2,
                        allowedRoles: ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'],
                        requiresLoanAdvance: true,
                    },
                    {
                        name: 'OS Centerwise',
                        href: '/dashboard/reports/portfolio/os-centerwise',
                        icon: MapPin,
                        allowedRoles: ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'],
                    },
                    {
                        name: 'OS Clientwise',
                        href: '/dashboard/admin-reports/portfolio/os-clientwise',
                        icon: Users,
                        allowedRoles: ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'],
                    },
                    {
                        name: 'Clientwise DCB',
                        href: '/dashboard/admin-reports/portfolio/clientwise-dcb',
                        icon: FileSpreadsheet,
                        allowedRoles: ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'],
                    },
                    {
                        name: 'PAR',
                        href: '/dashboard/reports/portfolio/par',
                        icon: AlertTriangle,
                        allowedRoles: ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'],
                    },
                    {
                        name: 'Preclosure',
                        href: '/dashboard/reports/portfolio/preclosure',
                        icon: CheckCircle,
                        allowedRoles: ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'],
                    },
                    {
                        name: 'Agewise Arrear',
                        href: '/dashboard/admin-reports/portfolio/agewise-arrear',
                        icon: FileClock,
                        allowedRoles: ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'],
                    },
                    {
                        name: 'Center Master Report',
                        href: '/dashboard/admin-reports/portfolio/center-master-report',
                        icon: MapPinned,
                        allowedRoles: ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'],
                    },
                    {
                        name: 'Client Portfolio Report',
                        href: '/dashboard/admin-reports/portfolio/client-portfolio-report',
                        icon: PieChart,
                        allowedRoles: ['ADMIN'],
                    },
                ],
            },
            {
                name: 'Account',
                href: '/dashboard/admin-reports/account',
                icon: Landmark,
                allowedRoles: ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER'],
                children: [
                    {
                        name: 'Daybook',
                        href: '/dashboard/admin-reports/account/daybook',
                        icon: BookOpen,
                        allowedRoles: ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER'],
                    },
                    {
                        name: 'GL One',
                        href: '/dashboard/admin-reports/account/gl-one',
                        icon: Book,
                        allowedRoles: ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER'],
                    },
                    {
                        name: 'GL All',
                        href: '/dashboard/admin-reports/account/gl-all',
                        icon: Library,
                        allowedRoles: ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER'],
                    },
                    {
                        name: 'Receipts & Payments',
                        href: '/dashboard/admin-reports/account/receipts-payments',
                        icon: ArrowLeftRight,
                        allowedRoles: ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER'],
                    },
                    {
                        name: 'Trial Balance',
                        href: '/dashboard/admin-reports/account/trial-balance',
                        icon: Scale,
                        allowedRoles: ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER'],
                    },
                    {
                        name: 'Profit & Loss',
                        href: '/dashboard/admin-reports/account/profit-loss',
                        icon: TrendingUp,
                        allowedRoles: ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER'],
                    },
                    {
                        name: 'Balance Sheet',
                        href: '/dashboard/admin-reports/account/balance-sheet',
                        icon: Scale,
                        allowedRoles: ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER'],
                    },
                    {
                        name: 'Voucher Print',
                        href: '/dashboard/admin-reports/account/voucher-print',
                        icon: Printer,
                        allowedRoles: ['ADMIN', 'BRANCH_MANAGER'],
                    },
                    {
                        name: 'Compare ILGL',
                        href: '/dashboard/admin-reports/account/compare-ilgl',
                        icon: GitCompare,
                        allowedRoles: ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER'],
                    },
                ],
            },
            {
                name: 'Employee',
                href: '/dashboard/reports/employee',
                icon: UserCog,
                allowedRoles: ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH', 'ADMIN'],
                children: [
                    {
                        name: 'Attendance Detailed',
                        href: '/dashboard/reports/employee/attendance-detailed',
                        icon: Clock,
                        allowedRoles: ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
                    },
                    {
                        name: 'Attendance Summary',
                        href: '/dashboard/reports/employee/attendance-summary',
                        icon: ClipboardList,
                        allowedRoles: ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
                    },
                    {
                        name: 'Payslip',
                        href: '/dashboard/reports/employee/payslip',
                        icon: FileText,
                        allowedRoles: ['AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
                    },
                    {
                        name: 'Center Transfer History',
                        href: '/dashboard/reports/employee/center-transfer-history',
                        icon: ArrowLeftRight,
                        allowedRoles: ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
                    },
                    {
                        name: 'Center Assign History',
                        href: '/dashboard/reports/employee/center-assign-history',
                        icon: UserCog,
                        allowedRoles: ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
                    },
                ],
            },
            {
                name: 'Funders',
                href: '/dashboard/admin-reports/funders',
                icon: Landmark,
                allowedRoles: ['ADMIN'],
                children: [
                    {
                        name: 'Funder Report',
                        href: '/dashboard/admin-reports/funders/funder-report',
                        icon: FileText,
                        allowedRoles: ['ADMIN'],
                    },
                    {
                        name: 'Funder Interest',
                        href: '/dashboard/admin-reports/funders/funder-interest',
                        icon: Percent,
                        allowedRoles: ['ADMIN'],
                    },
                    {
                        name: 'Funder OS Report',
                        href: '/dashboard/admin-reports/funders/funder-os-report',
                        icon: IndianRupee,
                        allowedRoles: ['ADMIN'],
                    },
                ],
            },
            {
                name: 'Others',
                href: '/dashboard/reports/others',
                icon: MoreHorizontal,
                allowedRoles: ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
                children: [
                    {
                        name: 'Denomination',
                        href: '/dashboard/reports/others/denomination-collection',
                        icon: Banknote,
                        allowedRoles: ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER'],
                    },
                    {
                        name: 'Branch Profile',
                        href: '/dashboard/reports/others/branch-profile',
                        icon: Building2,
                        allowedRoles: ['BRANCH_MANAGER', 'AREA_MANAGER'],
                    },
                    {
                        name: 'Center Master',
                        href: '/dashboard/reports/others/center-master',
                        icon: MapPinned,
                        allowedRoles: ['BRANCH_MANAGER', 'AREA_MANAGER'],
                    },
                    {
                        name: 'Insurance',
                        href: '/dashboard/reports/others/insurance',
                        icon: ShieldCheck,
                        allowedRoles: ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER'],
                    },
                    {
                        name: 'Loan Index',
                        href: '/dashboard/reports/others/loan-index',
                        icon: BookOpen,
                        allowedRoles: ['BRANCH_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
                    },
                    {
                        name: 'Pending Items',
                        href: '/dashboard/reports/others/pending-items',
                        icon: ListTodo,
                        allowedRoles: ['BRANCH_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
                    },
                    {
                        name: 'Highmark Update',
                        href: '/dashboard/admin-reports/others/highmark-update',
                        icon: RefreshCw,
                        allowedRoles: ['ADMIN', 'BRANCH_MANAGER'],
                    },
                    {
                        name: 'User Login Activity',
                        href: '/dashboard/reports/others/user-login-activity',
                        icon: Activity,
                        allowedRoles: ['ADMIN'],
                    },
                    {
                        name: 'Highmark Log',
                        href: '/dashboard/reports/others/highmark-log',
                        icon: History,
                        allowedRoles: ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
                    },
                    {
                        name: 'SMS Format',
                        href: '/dashboard/admin-reports/others/sms-format',
                        icon: MessageSquareText,
                        allowedRoles: ['ADMIN', 'BRANCH_MANAGER'],
                    },
                    {
                        name: 'UCRF/CDF Export',
                        href: '/dashboard/admin-reports/others/ucrf-export',
                        icon: FileSpreadsheet,
                        allowedRoles: ['ADMIN'],
                    },
                    {
                        name: 'NEFT Format',
                        href: '/dashboard/reports/others/neft-format',
                        icon: Landmark,
                        allowedRoles: ['BRANCH_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
                    },
                ],
            },
            {
                name: 'Gold',
                href: '/dashboard/reports/gold',
                icon: Coins,
                allowedRoles: ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
                children: [
                    {
                        name: 'Gold Taken',
                        href: '/dashboard/reports/gold',
                        icon: Coins,
                        allowedRoles: ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
                    },
                ],
            },
        ],
    },
    {
        name: 'MIS Reports',
        href: '/dashboard/mis-reports',
        icon: FileBarChart2,
        allowedRoles: ['ADMIN', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'], // Admin and Area Manager access MIS reports
        children: [
            {
                name: 'Company Profile',
                href: '/dashboard/mis-reports/company-profile',
                icon: Building2,
                allowedRoles: ['ADMIN'],
            },
            {
                name: 'All DCB',
                href: '/dashboard/mis-reports/all-dcb',
                icon: FileSpreadsheet,
                allowedRoles: ['ADMIN', 'AREA_MANAGER'],
            },
            {
                name: 'Branch Demand',
                href: '/dashboard/mis-reports/branch-demand',
                icon: TrendingUp,
                allowedRoles: ['ADMIN', 'AREA_MANAGER'],
            },
            {
                name: 'Disbursement',
                href: '/dashboard/mis-reports/disbursement',
                icon: Banknote,
                allowedRoles: ['ADMIN', 'AREA_MANAGER'],
            },
            {
                name: 'Loan OS Details',
                href: '/dashboard/mis-reports/loan-os-details',
                icon: FileText,
                allowedRoles: ['ADMIN', 'AREA_MANAGER'],
            },
            {
                name: 'Arrear Report',
                href: '/dashboard/mis-reports/agewise-arrear',
                icon: FileClock,
                allowedRoles: ['ADMIN'],
            },
            {
                name: 'Preclosure',
                href: '/dashboard/mis-reports/preclosure',
                icon: CheckCircle,
                allowedRoles: ['ADMIN', 'AREA_MANAGER'],
            },
            {
                name: 'Performance',
                href: '/dashboard/mis-reports/performance',
                icon: Award,
                allowedRoles: ['ADMIN', 'AREA_MANAGER'],
            },
            {
                name: 'Ledger Report',
                href: '/dashboard/mis-reports/ledger-report',
                icon: NotebookText,
                allowedRoles: ['ADMIN', 'AREA_MANAGER'],
            },
        ],
    },
    {
        name: 'EOD',
        href: '/dashboard/eod',
        icon: Sunset,
        allowedRoles: ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER'],
        children: [
            {
                name: 'EOD Process',
                href: '/dashboard/eod/eod-process',
                icon: Sunset,
                allowedRoles: ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'], // BM submits EOD for AM approval; AM view-only here
            },
            // {
            //     name: 'EOD Approval',
            //     href: '/dashboard/eod/eod-approval',
            //     icon: ShieldCheck,
            //     allowedRoles: ['AREA_MANAGER', 'ADMIN'], // AM approves/rejects BM's EOD submissions
            // },
        ],
    },
    // {
    //     name: 'Utilities',
    //     href: '/dashboard/utilities',
    //     icon: Settings,
    //     allowedRoles: ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER'], // Admin utilities + FDO denomination
    //     children: [
            // {
            //     name: 'Set GL Balance',
            //     href: '/dashboard/utilities/set-gl-balance',
            //     icon: Scale,
            //     allowedRoles: ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER'], // Admin, Area Manager, and Branch Manager can set GL balance
            // },
            // {
            //     name: 'Denomination Entry',
            //     href: '/dashboard/utilities/denomination-entry',
            //     icon: Banknote,
            //     allowedRoles: ['BRANCH_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'], // Users involved in EOD can enter denominations
            // },
    //     ],
    // },
    {
        name: 'Revert',
        href: '/dashboard/revert',
        icon: Undo2,
        allowedRoles: ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER'],
        children: [
            {
                name: 'Collection Revert',
                href: '/dashboard/revert/collection-revert',
                icon: RefreshCw,
                allowedRoles: ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER'], // Mode-wise + center-batch revert workbench
            },
            // {
            //     name: 'Individual Member Collection Revert',
            //     href: '/dashboard/collections/delete-client-collection',
            //     icon: Trash2,
            //     allowedRoles: ['BRANCH_MANAGER', 'ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH'],
            // },
            {
                name: 'Pre-Closure Revert',
                href: '/dashboard/collections/delete-foreclosure',
                icon: XCircle,
                allowedRoles: ['BRANCH_MANAGER', 'ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH'],
            },
            {
                name: 'Allocation Revert',
                href: '/dashboard/revert/allocation-revert',
                icon: Banknote,
                allowedRoles: ['ADMIN'], // Undoes a funder's "Allocate for EOD" GL posting
            },
            {
                name: 'EOD Revert',
                href: '/dashboard/revert/eod-revert',
                icon: Sunset,
                allowedRoles: ['ADMIN'], // Reopens the previous working day; blocked if anything already happened on the current day
            },
            {
                name: 'Disbursement Revert',
                href: '/dashboard/revert/disbursement-revert',
                icon: ArrowDownToLine,
                allowedRoles: ['ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH'], // Undoes an already-disbursed loan back to APPROVED_LEVEL2; only while untouched downstream
            },
            {
                name: 'Loan Closure Revert',
                href: '/dashboard/revert/loan-closure-revert',
                icon: FileCheck,
                allowedRoles: ['ADMIN'], // Undoes a write-off/death closure and reopens the loan
            },
            {
                name: 'Death Revert',
                href: '/dashboard/revert/death-revert',
                icon: UserX,
                allowedRoles: ['ADMIN'], // Removes a death marking recorded in error
            },
            {
                name: 'Loan Advance Revert',
                href: '/dashboard/revert/loan-advance-revert',
                icon: HandCoins,
                allowedRoles: ['ADMIN'], // Savings collection revert + loan advance (savings) refund revert
                requiresLoanAdvance: true,
            },
        ],
    },
];

// ─────────────────────────────────────────────────────────────────────────
// HREF → allowedRoles LOOKUP
//
// Single flattened index built from navigationConfig so page-level route
// guards (ProtectedRoute, protectServerRoute) can derive their legacy role
// list from the SAME static source the sidebar uses, instead of each
// page.tsx hand-duplicating its own copy (which drifts — see e.g. Daybook,
// which had a page guard listing FDO that navigationConfig's entry omitted).
//
// This is only the fallback default: once an Admin configures RBAC page
// permissions for a role via the Role Permissions panel, that DB grant
// overrides this everywhere it's consulted.
// ─────────────────────────────────────────────────────────────────────────
function flattenNavigation(
    items: NavigationItem[],
    acc: Map<string, UserRole[] | undefined>
): void {
    for (const item of items) {
        acc.set(item.href, item.allowedRoles);
        if (item.children && item.children.length > 0) {
            flattenNavigation(item.children, acc);
        }
    }
}

let navRoleLookup: Map<string, UserRole[] | undefined> | null = null;

function getNavRoleLookup(): Map<string, UserRole[] | undefined> {
    if (!navRoleLookup) {
        // Qualified as globalThis.Map — the bare `Map` identifier in this file
        // is shadowed by the lucide-react `Map` icon imported above.
        navRoleLookup = new globalThis.Map();
        flattenNavigation(navigationConfig, navRoleLookup);
    }
    return navRoleLookup;
}

/**
 * Resolve the allowedRoles configured for a dashboard href in navigationConfig.
 * Exact match first; falls back to the longest matching parent prefix
 * (mirrors AppSidebar's isPageVisible), then to `undefined` — meaning no
 * restriction is configured here (open to all authenticated users) — when
 * the href isn't represented in navigationConfig at all.
 */
export function getAllowedRolesForHref(href: string): UserRole[] | undefined {
    const lookup = getNavRoleLookup();

    if (lookup.has(href)) return lookup.get(href);

    const segments = href.split('/');
    for (let len = segments.length - 1; len > 2; len--) {
        const parentHref = segments.slice(0, len).join('/');
        if (lookup.has(parentHref)) return lookup.get(parentHref);
    }

    return undefined;
}
