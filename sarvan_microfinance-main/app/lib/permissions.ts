import type { UserRole } from '@/app/types';

/**
 * Permission configuration for different features/screens
 * Based on RBAC matrix from microfinance_migration_megadoc.md
 */
export const PERMISSIONS = {
    // Center Operations
    CENTER_CREATE: ['BRANCH_MANAGER'] as UserRole[],
    CENTER_TRANSFER: ['BRANCH_MANAGER', 'AREA_MANAGER'] as UserRole[],
    CENTER_LOCATE: ['BRANCH_MANAGER', 'AREA_MANAGER'] as UserRole[],

    // Client Operations
    CLIENT_ENROLLMENT: ['FDO'] as UserRole[],
    CLIENT_SEARCH: ['ADMIN', 'BRANCH_MANAGER', 'FDO', 'AREA_MANAGER'] as UserRole[],

    // KYC Operations
    KYC_UPLOAD: ['FDO', 'ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH'] as UserRole[],
    KYC_UPDATE: ['FDO', 'ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH'] as UserRole[],
    KYC_VERIFICATION: ['BRANCH_MANAGER', 'AREA_MANAGER'] as UserRole[],
    CO_APPLICANT: ['FDO', 'ADMIN'] as UserRole[],

    // Loan Operations
    LOAN_APPLICATION: ['FDO'] as UserRole[],
    LOAN_INDUCTION: ['BRANCH_MANAGER', 'AREA_MANAGER'] as UserRole[],
    LOAN_DISBURSEMENT: ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'] as UserRole[],

    // Collections
    COLLECTIONS: ['BRANCH_MANAGER', 'FDO', 'AREA_MANAGER'] as UserRole[],
    DEMAND_COLLECTION: ['BRANCH_MANAGER', 'FDO', 'AREA_MANAGER'] as UserRole[],
    SINGLE_COLLECTION: ['BRANCH_MANAGER', 'FDO', 'AREA_MANAGER'] as UserRole[],
    BULK_COLLECTION: ['BRANCH_MANAGER', 'FDO', 'AREA_MANAGER'] as UserRole[],

    // Accounts & Transactions (Admin only, AM excluded per megadoc)
    ACCOUNTS: ['ADMIN'] as UserRole[],
    ACCOUNTS_GROUP: ['ADMIN'] as UserRole[],
    ACCOUNTS_LEDGER: ['ADMIN'] as UserRole[],
    TRANSACTIONS: ['ADMIN'] as UserRole[],

    // Masters (Admin only, AM excluded per megadoc)
    MASTERS: ['ADMIN'] as UserRole[],
    FUNDER: ['ADMIN'] as UserRole[],
    LOAN_PRODUCT: ['ADMIN'] as UserRole[],

    // Employee Operations
    EMPLOYEE_CREATE: ['ADMIN', 'AREA_MANAGER'] as UserRole[],
    EMPLOYEE_MANAGEMENT: ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'] as UserRole[],
    EMPLOYEE_PASSWORD_RESET: ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'] as UserRole[],

    // Reports
    REPORTS: ['BRANCH_MANAGER', 'FDO', 'AREA_MANAGER'] as UserRole[],
    MIS_REPORTS: ['ADMIN', 'AREA_MANAGER'] as UserRole[],

    // Field Officer Reports - Demand
    DEMAND_SHEET: ['ADMIN', 'BRANCH_MANAGER', 'FDO', 'AREA_MANAGER'] as UserRole[],
    DEMAND: ['ADMIN', 'BRANCH_MANAGER', 'FDO', 'AREA_MANAGER'] as UserRole[],

    // Admin Reports - Portfolio
    ADMIN_REPORTS: ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'] as UserRole[],
    PORTFOLIO_REPORTS: ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'] as UserRole[],
    OS_BRANCHWISE: ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'] as UserRole[],
    INDIVIDUAL_LEDGER: ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'] as UserRole[],
    LOAN_DISBURSEMENT_REPORT: ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'] as UserRole[],
    LOAN_ADVANCE_REFUND_REPORT: ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'] as UserRole[],
    OS_CENTERWISE: ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'] as UserRole[],
    OS_CLIENTWISE: ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'] as UserRole[],
    CLIENTWISE_DCB: ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'] as UserRole[],
    PAR_REPORT: ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'] as UserRole[],
    PRECLOSURE_REPORT: ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'] as UserRole[],
    AGEWISE_ARREAR: ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'] as UserRole[],

    // Admin Reports - Account
    ACCOUNT_REPORTS: ['ADMIN'] as UserRole[],
    DAYBOOK: ['ADMIN'] as UserRole[],
    GL_ONE: ['ADMIN'] as UserRole[],
    GL_ALL: ['ADMIN'] as UserRole[],
    RECEIPTS_PAYMENTS: ['ADMIN'] as UserRole[],
    TRAIL_BALANCE: ['ADMIN'] as UserRole[],
    VOUCHER_PRINT: ['ADMIN'] as UserRole[],
    COMPARE_ILGL: ['ADMIN'] as UserRole[],

    // Admin Reports - Funders
    FUNDER_REPORTS: ['ADMIN'] as UserRole[],
    FUNDER_REPORT: ['ADMIN'] as UserRole[],
    FUNDER_INTEREST: ['ADMIN'] as UserRole[],

    // Admin Reports - Others
    OTHER_REPORTS: ['ADMIN'] as UserRole[],
    HIGHMARK_UPDATE: ['ADMIN'] as UserRole[],
    SMS_FORMAT: ['ADMIN'] as UserRole[],
    UCRF_EXPORT: ['ADMIN'] as UserRole[],

    // Monitoring & Utilities
    DAILY_MONITORING: ['ADMIN', 'AREA_MANAGER'] as UserRole[],
    UTILITIES: ['ADMIN', 'AREA_MANAGER'] as UserRole[],

    // Branch Management
    BRANCH_MANAGEMENT: ['ADMIN', 'AREA_MANAGER'] as UserRole[],
    BRANCH_CREATE: ['ADMIN'] as UserRole[],
    BRANCH_CHANGE: ['ADMIN', 'AREA_MANAGER'] as UserRole[],
} as const;

/**
 * Check if a user role has permission for a specific feature
 * @param userRole - The role of the current user
 * @param permission - The permission key from PERMISSIONS
 * @returns true if the user has permission, false otherwise
 */
export function hasPermission(
    userRole: UserRole | null | undefined,
    permission: keyof typeof PERMISSIONS
): boolean {
    if (!userRole) return false;
    // Admin always has every permission — regardless of whether 'ADMIN' is
    // actually listed for this key, so newly-added permissions never silently
    // exclude Admin.
    if (userRole === 'ADMIN') return true;
    return PERMISSIONS[permission].includes(userRole);
}

/**
 * Check if a user role has any of the specified permissions
 * @param userRole - The role of the current user
 * @param permissions - Array of permission keys
 * @returns true if the user has at least one permission, false otherwise
 */
export function hasAnyPermission(
    userRole: UserRole | null | undefined,
    permissions: Array<keyof typeof PERMISSIONS>
): boolean {
    if (!userRole) return false;
    return permissions.some(permission => hasPermission(userRole, permission));
}

/**
 * Check if a user role has all of the specified permissions
 * @param userRole - The role of the current user
 * @param permissions - Array of permission keys
 * @returns true if the user has all permissions, false otherwise
 */
export function hasAllPermissions(
    userRole: UserRole | null | undefined,
    permissions: Array<keyof typeof PERMISSIONS>
): boolean {
    if (!userRole) return false;
    return permissions.every(permission => hasPermission(userRole, permission));
}

/**
 * Get all permissions for a specific role
 * @param userRole - The role to get permissions for
 * @returns Array of permission keys that the role has access to
 */
export function getRolePermissions(userRole: UserRole): Array<keyof typeof PERMISSIONS> {
    return (Object.keys(PERMISSIONS) as Array<keyof typeof PERMISSIONS>).filter(
        permission => hasPermission(userRole, permission)
    );
}
