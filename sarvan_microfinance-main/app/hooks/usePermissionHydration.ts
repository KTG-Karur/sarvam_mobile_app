// ============================================================
// PERMISSION HYDRATION HOOK
// app/hooks/usePermissionHydration.ts
//
// Re-fetches RBAC permissions from /api/auth/permissions and
// populates the authStore on every page load / mount.
// Also re-fetches every PERMISSION_TTL_MS so that permission
// changes made by an Admin propagate to active sessions
// without requiring a full logout/login cycle.
// ============================================================

'use client';

import { useEffect } from 'react';
import { useAuthStore } from '@/app/store/authStore';

/** How often to automatically re-fetch permissions (3 minutes) */
const PERMISSION_TTL_MS = 3 * 60 * 1000;

// Module-level (not per-hook-instance) so a manual refreshPermissions() call
// (e.g. right after Report Permissions Save) and the hook's own mount/interval
// fetch can never race each other into two concurrent requests.
let isFetchingPermissions = false;

/**
 * Fetches the current user's RBAC/report/page permissions from
 * /api/auth/permissions and populates the authStore — the same logic
 * usePermissionHydration runs on mount and on its 3-minute poll, exposed
 * here so other places (e.g. the Report Permissions admin screen, right
 * after a successful Save) can trigger an on-demand refresh instead of
 * waiting for the next interval tick or a full page reload.
 */
export async function refreshPermissions(): Promise<void> {
  const { accessToken, setPermissions, setPermissionsHydrated } = useAuthStore.getState();
  if (!accessToken) return;

  // Prevent concurrent fetches
  if (isFetchingPermissions) return;
  isFetchingPermissions = true;
  try {
    const res = await fetch('/api/auth/permissions', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return;

    const data = await res.json();
    if (!data.success) return;

    setPermissions({
      granted:           data.permissions?.granted ?? [],
      roles:             data.roles ?? [],
      branchAccess:      data.branchAccess ?? [],
      fieldPermissions:  data.fieldPermissions ?? {},
      reportPermissions: data.reportPermissions ?? {},
      menu:              data.menu ?? [],
      pagePermissions:   data.pagePermissions ?? null,
    });

    // Sync to localStorage (used by sidebar / legacy checks)
    if (Array.isArray(data.permissions?.granted)) {
      localStorage.setItem('sarvan-rbac-permissions', JSON.stringify(data.permissions.granted));
    }
    if (data.pagePermissions !== undefined) {
      localStorage.setItem('sarvan-page-permissions', JSON.stringify(data.pagePermissions));
    }
  } catch {
    // Non-fatal — permissions can be retried on the next interval tick
  } finally {
    // Mark hydration as settled even on failure/non-ok response, so route
    // guards waiting on this (see resolvePageAuthorization's 'pending'
    // state) don't hang forever if the very first fetch fails.
    setPermissionsHydrated();
    isFetchingPermissions = false;
  }
}

export function usePermissionHydration() {
  const accessToken = useAuthStore((s) => s.accessToken);

  useEffect(() => {
    if (!accessToken) return;

    // Fetch immediately on mount
    refreshPermissions();

    // Re-fetch periodically so Admin permission changes propagate to live sessions
    const interval = setInterval(refreshPermissions, PERMISSION_TTL_MS);

    return () => clearInterval(interval);
  }, [accessToken]);
}
