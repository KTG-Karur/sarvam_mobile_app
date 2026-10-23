// ============================================================
// AUTH STORE — Zustand global state for auth & permissions
// app/store/authStore.ts
//
// Replaces old localStorage-based token storage.
// Holds the full permission context client-side.
// ============================================================

'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────
export interface ClientPermissions {
  granted: Set<string>;  // "module:action" strings
  denied: Set<string>;
}

export type PageActionPermissions = {
  view: boolean;
  add: boolean;
  edit: boolean;
  delete: boolean;
  approve: boolean;
};

export type PagePermissionsMap = Record<string, PageActionPermissions>;

export interface RoleSummary {
  roleId: string;
  roleName: string;
  roleSlug: string;
  priority: number;
  branchId: string | null;
}

export interface BranchAccessSummary {
  branchId: string;
  branchName: string;
  branchCode: string;
  accessType: 'FULL' | 'OPERATIONAL' | 'READONLY' | 'REPORTING';
  isPrimary: boolean;
  isHeadOffice: boolean;
}

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  employeeId: string | null;
}

export interface BranchInfo {
  id: string;
  name: string;
  code: string;
  isHeadOffice: boolean;
}

// ─────────────────────────────────────────────
// STORE STATE
// ─────────────────────────────────────────────
interface AuthState {
  // Auth
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;

  // Branch
  activeBranch: BranchInfo | null;
  isHeadOffice: boolean;

  // RBAC — loaded from /api/auth/permissions after login
  roles: RoleSummary[];
  permissions: ClientPermissions | null;
  branchAccess: BranchAccessSummary[];
  fieldPermissions: Record<string, { access: string }> | null;
  reportPermissions: Record<string, {
    canView: boolean;
    canExport: boolean;
    canPrint: boolean;
    branchScope: string;
    maskFinancial: boolean;
    exportMode: 'DIRECT' | 'REQUEST_QUEUE';
  }> | null;

  // Page-level permissions — loaded from /api/auth/permissions after login
  // null = not configured (role-based allowedRoles from navigation.config.ts applies)
  // Record<href, actions> = explicit page-level access control
  pagePermissions: PagePermissionsMap | null;

  // True once the /api/auth/permissions fetch has settled at least once
  // (success or failure) for the current session. Route guards use this to
  // avoid making an "insufficient permission" decision before RBAC data —
  // in particular pagePermissions — has actually loaded.
  permissionsHydrated: boolean;

  // Menu
  menuItems: unknown[];

  // Version — for cache invalidation
  permVersion: number;

  // Actions
  setAuth: (data: {
    user: AuthUser;
    accessToken: string;
    refreshToken: string;
    branch: BranchInfo | null;
    roles: RoleSummary[];
    permVersion: number;
  }) => void;
  setPermissions: (data: {
    granted: string[];
    roles: RoleSummary[];
    branchAccess: BranchAccessSummary[];
    fieldPermissions: Record<string, { access: string }>;
    reportPermissions: Record<string, unknown>;
    menu: unknown[];
    pagePermissions?: PagePermissionsMap | null;
  }) => void;
  setActiveBranch: (branch: BranchInfo) => void;
  setTokens: (accessToken: string, refreshToken: string) => void;
  setPermissionsHydrated: () => void;
  logout: () => void;
}

// ─────────────────────────────────────────────
// STORE
// ─────────────────────────────────────────────
export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      activeBranch: null,
      isHeadOffice: false,
      roles: [],
      permissions: null,
      branchAccess: [],
      fieldPermissions: null,
      reportPermissions: null,
      pagePermissions: null,
      permissionsHydrated: false,
      menuItems: [],
      permVersion: 1,

      setAuth: (data) =>
        set({
          user: data.user,
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
          isAuthenticated: true,
          activeBranch: data.branch,
          isHeadOffice: data.branch?.isHeadOffice ?? false,
          roles: data.roles,
          permVersion: data.permVersion,
        }),

      setPermissions: (data) =>
        set({
          permissions: {
            granted: new Set(data.granted),
            denied: new Set<string>(),
          },
          roles: data.roles,
          branchAccess: data.branchAccess,
          fieldPermissions: data.fieldPermissions,
          reportPermissions: data.reportPermissions as Record<string, {
            canView: boolean;
            canExport: boolean;
            canPrint: boolean;
            branchScope: string;
            maskFinancial: boolean;
            exportMode: 'DIRECT' | 'REQUEST_QUEUE';
          }>,
          pagePermissions: data.pagePermissions !== undefined ? data.pagePermissions : null,
          menuItems: data.menu,
          permissionsHydrated: true,
        }),

      setPermissionsHydrated: () =>
        set((state) => (state.permissionsHydrated ? state : { permissionsHydrated: true })),

      setActiveBranch: (branch) =>
        set({
          activeBranch: branch,
          isHeadOffice: branch.isHeadOffice,
        }),

      setTokens: (accessToken, refreshToken) =>
        set({ accessToken, refreshToken }),

      logout: () =>
        set({
          user: null,
          accessToken: null,
          refreshToken: null,
          isAuthenticated: false,
          activeBranch: null,
          isHeadOffice: false,
          roles: [],
          permissions: null,
          branchAccess: [],
          fieldPermissions: null,
          reportPermissions: null,
          pagePermissions: null,
          permissionsHydrated: false,
          menuItems: [],
          permVersion: 1,
        }),
    }),
    {
      name: 'sarvan-auth',
      storage: createJSONStorage(() => localStorage),
      // Don't persist permissions — always reload fresh from API
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        isAuthenticated: state.isAuthenticated,
        activeBranch: state.activeBranch,
        isHeadOffice: state.isHeadOffice,
        roles: state.roles,
        permVersion: state.permVersion,
        // Permissions are NOT persisted — always fetch fresh
      }),
    }
  )
);
