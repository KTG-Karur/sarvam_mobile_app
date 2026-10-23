// User types
// UserRole is now a plain string — the role field can hold system enum values
// (ADMIN, BRANCH_MANAGER, FDO, AREA_MANAGER) OR auto-generated codes for custom
// RBAC roles (e.g. "QC" for Quality Checkers, "HRE" for Human Resource Executive, "PUNE" for Pune).
export type UserRole = string;

/** Well-known built-in system roles for use in comparisons / withRole() guards. */
export type SystemRole = 'ADMIN' | 'BRANCH_MANAGER' | 'FDO' | 'AREA_MANAGER' | 'DIVISION_MANAGER' | 'ADMIN_NON_HO_BRANCH_SWITCH';

export interface User {
  id: string;
  employeeId?: string | null;
  mobileNumber?: string | null;
  email: string;
  firstName: string;
  lastName: string;
  role: string;  // dynamic role code — system or custom RBAC role
  branchId?: string | null;
  /** For AREA_MANAGER: list of all assigned branch IDs (from junction table). */
  assignedBranchIds?: string[];
  /** Active RBAC role slug — custom roles like 'background-verification-team' */
  rbacRoleSlug?: string | null;
  /** Human-readable RBAC role name — e.g. 'Background Verification Team'. Use getRoleDisplayName() for display. */
  rbacRoleName?: string | null;
  /** True when the active RBAC role is flagged Role.isSubAdmin — grants final client-approval actions. */
  isSubAdmin?: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  // Extended profile fields
  fatherName?: string | null;
  motherName?: string | null;
  address?: string | null;
  education?: string | null;
  aadhaarNumber?: string | null;
  aadhaarDocUrl?: string | null;
  panNumber?: string | null;
  panDocUrl?: string | null;
  profilePhotoUrl?: string | null;
  esiNumber?: string | null;
  pfNumber?: string | null;
  esiPfDocUrl?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  locationPhotoUrl?: string | null;
  hasChangedPassword?: boolean;
  hasChangedProfilePhoto?: boolean;
  /** Bound mobile device ID for mobile app login restriction — null/unset means no device bound yet. */
  mobileDeviceId?: string | null;
  /** Bcrypt hash of the employee's mobile MPIN — server-only, must never be sent in any API response. */
  mpinHash?: string | null;
  /** Server-only mobile MPIN lockout state — must never be sent in any API response. */
  mpinFailedAttempts?: number;
  mpinLastFailedAt?: Date | null;
}

// Auth types
export interface LoginCredentials {
  employeeId: string;
  password: string;
}

export interface AuthResponse {
  user: Omit<User, 'password' | 'mpinHash' | 'mpinFailedAttempts' | 'mpinLastFailedAt'>;
  accessToken: string;
  refreshToken: string;
  branch?: {
    id: string;
    name: string;
    code: string;
    address?: string | null;
    isHeadOffice: boolean;
  };
}

export interface JWTPayload {
  userId: string;
  email: string;
  role: string;
}

// Branch types
export interface Branch {
  id: string;
  name: string;
  code: string;
  address?: string | null;
  state?: string | null;
  district?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  isActive: boolean;
  branchStartDate?: string | Date | null;
  eodStartDate?: string | Date | null;
  /** True once this branch has closed at least one EOD (BranchLock.lastEodClosedAt is set) — locks eodStartDate from further edits. */
  eodCompleted?: boolean;
  /** Display-only, only set when eodStartDate is null: earliest real activity (denomination entry / collection / transaction) recorded for this branch, as a hint for what eodStartDate actually should be. Never written to the DB automatically. */
  derivedEodStartDate?: string | Date | null;
  areas?: { id: string; name: string; code: string }[];
  createdAt: Date;
  updatedAt: Date;
}

// Common types
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  /** Machine-readable error/status code for clients that need to branch on it (e.g. mobile MPIN flow). */
  code?: string;
  /** Whether the mobile app is authorized to route straight to the set-new-MPIN screen. */
  canChangeMpin?: boolean;
}

// Area Manager branch assignment type
export interface AreaManagerBranchAssignment {
  id: string;
  isPrimary: boolean;
  createdAt: Date;
  branch: {
    id: string;
    name: string;
    code: string;
    address?: string | null;
    isActive: boolean;
  };
}

