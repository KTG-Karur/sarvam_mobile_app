// ============================================================
// ENTERPRISE RBAC + ABAC — Core Types
// app/lib/permissions/types.ts
// ============================================================

// ─────────────────────────────────────────────
// JWT Payload — replaces old { role: UserRole }
// ─────────────────────────────────────────────
export interface JWTPayload {
  userId: string;
  email: string;
  // NO role enum — roles are loaded from DB/cache at runtime
  branchId: string | null;          // Currently active branch
  permVersion: number;              // Cache bust version — bump when permissions change
  isHeadOffice: boolean;            // True if current branch is HO
  iat?: number;
  exp?: number;
}

// ─────────────────────────────────────────────
// Resolved User Context — built on every request
// ─────────────────────────────────────────────
export interface UserContext {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  branchId: string | null;
  isHeadOffice: boolean;
  roles: UserRoleSummary[];
  permissions: PermissionSet;
  branchAccess: BranchAccessSummary[];
  fieldPermissions: FieldPermissionMap;
  reportPermissions: ReportPermissionMap;
}

export interface UserRoleSummary {
  roleId: string;
  roleName: string;
  roleSlug: string;
  priority: number;
  branchId: string | null; // null = applies to all branches
}

// ─────────────────────────────────────────────
// Permission Set — cached per user
// ─────────────────────────────────────────────
export interface PermissionSet {
  // Set of "moduleSlug:actionSlug" strings for O(1) lookup
  // e.g., "loan:approve", "collection:export", "gold-loan:disburse"
  granted: Set<string>;

  // Explicitly DENIED permissions (DENY wins over ALLOW)
  denied: Set<string>;

  // ABAC conditions per permission
  conditions: Map<string, PermissionConditions>;
}

export interface PermissionConditions {
  branchScope?: 'own' | 'assigned' | 'all';
  recordOwnership?: 'self' | 'any';
  timeRestriction?: 'business_hours' | 'always';
  requiresApproval?: boolean;
  maxAmount?: number;
  customConditions?: Record<string, unknown>;
}

// ─────────────────────────────────────────────
// Branch Access
// ─────────────────────────────────────────────
export interface BranchAccessSummary {
  branchId: string;
  branchName: string;
  branchCode: string;
  accessType: 'FULL' | 'OPERATIONAL' | 'READONLY' | 'REPORTING';
  isPrimary: boolean;
  isHeadOffice: boolean;
}

// ─────────────────────────────────────────────
// Field Permission Map
// ─────────────────────────────────────────────
// Key: "moduleSlug:fieldName"
// Value: access type
export type FieldPermissionMap = Map<string, FieldAccessResult>;

export interface FieldAccessResult {
  access: 'VISIBLE' | 'READONLY' | 'HIDDEN' | 'MASKED';
  conditions?: Record<string, unknown>;
}

// ─────────────────────────────────────────────
// Report Permission Map
// Key: reportSlug
// ─────────────────────────────────────────────
export type ReportPermissionMap = Map<string, ReportAccessResult>;

export interface ReportAccessResult {
  canView: boolean;
  canExport: boolean;
  canPrint: boolean;
  branchScope: 'OWN_BRANCH' | 'ASSIGNED' | 'ALL' | 'REGIONAL';
  maskFinancial: boolean;
  /** DIRECT = export downloads immediately in the browser. REQUEST_QUEUE = export only downloadable from /dashboard/reports/request-report. */
  exportMode: 'DIRECT' | 'REQUEST_QUEUE';
}

// ─────────────────────────────────────────────
// Permission Check Request
// ─────────────────────────────────────────────
export interface PermissionCheckRequest {
  moduleSlug: string;
  actionSlug: string;
  // ABAC context
  branchId?: string;
  recordOwnerId?: string;   // userId who owns the record
  recordBranchId?: string;  // branch the record belongs to
  metadata?: Record<string, unknown>;
}

export interface PermissionCheckResult {
  allowed: boolean;
  reason?: string;
  conditions?: PermissionConditions;
}

// ─────────────────────────────────────────────
// Auth Response — replaces old AuthResponse
// ─────────────────────────────────────────────
export interface AuthResponse {
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    employeeId: string | null;
    isActive: boolean;
    // NO role field — roles are in the roles array
    roles: UserRoleSummary[];
    primaryBranch: BranchSummary | null;
  };
  accessToken: string;
  refreshToken: string;
  branch?: BranchSummary;
  permissions: {
    granted: string[];     // Array of "module:action" strings for client
    version: number;
  };
}

export interface BranchSummary {
  id: string;
  name: string;
  code: string;
  address?: string | null;
  isHeadOffice: boolean;
}

// ─────────────────────────────────────────────
// Module Actions — all standard actions
// These are seeded into DB, not hardcoded in code
// ─────────────────────────────────────────────
export const STANDARD_ACTIONS = [
  'view',
  'create',
  'edit',
  'delete',
  'approve',
  'reject',
  'verify',
  'export',
  'print',
  'disburse',
  'reverse',
  'close',
  'reopen',
  'assign',
  'reschedule',
  'waive',
  'override',
  'upload',
  'download',
  'transfer',
  'lock',
  'unlock',
] as const;

export type StandardAction = typeof STANDARD_ACTIONS[number];
