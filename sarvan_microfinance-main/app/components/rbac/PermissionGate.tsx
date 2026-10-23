// ============================================================
// PERMISSION GATE — Conditional rendering based on permissions
// app/components/rbac/PermissionGate.tsx
//
// Usage examples:
//
// 1. Show/hide by permission:
//    <PermissionGate module="loan" action="approve">
//      <ApproveButton />
//    </PermissionGate>
//
// 2. Show/hide by role:
//    <PermissionGate roles={['branch-manager', 'area-manager']}>
//      <ManagerPanel />
//    </PermissionGate>
//
// 3. With fallback:
//    <PermissionGate module="loan" action="delete" fallback={<DisabledButton />}>
//      <DeleteButton />
//    </PermissionGate>
//
// 4. Head office only:
//    <PermissionGate headOfficeOnly>
//      <HOSettings />
//    </PermissionGate>
// ============================================================

'use client';

import { usePermission } from '@/app/hooks/usePermission';

interface PermissionGateProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;

  // Permission check
  module?: string;
  action?: string;

  // Role check
  roles?: string[];      // User must have ANY of these roles
  allRoles?: string[];   // User must have ALL of these roles

  // Multiple permissions — user needs any one
  anyOf?: Array<{ module: string; action: string }>;
  // Multiple permissions — user needs all
  allOf?: Array<{ module: string; action: string }>;

  // Branch check
  requiresHO?: boolean;  // Only visible if in Head Office context
}

export function PermissionGate({
  children,
  fallback = null,
  module,
  action,
  roles,
  allRoles,
  anyOf,
  allOf,
  requiresHO,
}: PermissionGateProps) {
  const { can, hasRole, hasAnyRole, canAny, canAll, isHeadOffice } = usePermission();

  let hasAccess = true;

  // Check single module:action permission
  if (module && action) {
    hasAccess = hasAccess && can(module, action);
  }

  // Check role (any)
  if (roles && roles.length > 0) {
    hasAccess = hasAccess && hasAnyRole(roles);
  }

  // Check all roles
  if (allRoles && allRoles.length > 0) {
    hasAccess = hasAccess && allRoles.every((r) => hasRole(r));
  }

  // Check anyOf permissions
  if (anyOf && anyOf.length > 0) {
    hasAccess = hasAccess && canAny(anyOf.map((p) => [p.module, p.action] as [string, string]));
  }

  // Check allOf permissions
  if (allOf && allOf.length > 0) {
    hasAccess = hasAccess && canAll(allOf.map((p) => [p.module, p.action] as [string, string]));
  }

  // Head office check
  if (requiresHO) {
    hasAccess = hasAccess && isHeadOffice;
  }

  return hasAccess ? <>{children}</> : <>{fallback}</>;
}
