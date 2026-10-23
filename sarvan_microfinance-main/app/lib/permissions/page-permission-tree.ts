// ============================================================
// PAGE PERMISSION TREE — Shared page/action/role tree builder
// app/lib/permissions/page-permission-tree.ts
//
// Single source of truth for which dashboard pages exist, which
// actions apply to each, and (via allowedRoles) which roles get
// them by default. Built once from navigationConfig.
//
// Used by:
//   - app/dashboard/admin/roles/[roleId]/permissions/page.tsx (admin UI)
//   - prisma/seed-page-permissions.ts (DB seeder)
//
// Keeping this logic in one place means the seeder can never drift
// from what the Role Permissions screen actually shows and saves.
// ============================================================

import { navigationConfig, type NavigationItem } from '@/app/config/navigation.config';

export type ActionKey = 'view' | 'add' | 'edit' | 'delete' | 'approve';

export interface PageActions {
  view: boolean;
  add: boolean;
  edit: boolean;
  delete: boolean;
  approve: boolean;
}

export function emptyActions(): PageActions {
  return { view: false, add: false, edit: false, delete: false, approve: false };
}

// Determine which actions are applicable to a page (per-page granularity)
export function getApplicableActions(href: string): ActionKey[] {
  // Dashboard — view only
  if (href === '/dashboard') return ['view'];

  // ── Report / MIS / Daily Monitoring — view only ──
  if (
    href.startsWith('/dashboard/reports/') ||
    href.startsWith('/dashboard/admin-reports/') ||
    href.startsWith('/dashboard/mis-reports/') ||
    href.startsWith('/dashboard/daily-monitoring/')
  ) return ['view'];

  // ── Delete pages — view + delete only ──
  if (
    href.includes('/delete-demand-collection') ||
    href.includes('/delete-client-collection') ||
    href.includes('/delete-foreclosure') ||
    href.includes('/delete-disbursement')
  ) return ['view', 'delete'];

  // ── Approval pages — view + approve only ──
  if (
    href.includes('/collections/approval') ||
    href.includes('/approval/workbench') ||
    href.includes('/foreclosure-approval') ||
    href.includes('/first-due-date-requests') ||
    href.includes('/eod-approval')
  ) return ['view', 'approve'];

  // ── Center Operations ──
  if (href === '/dashboard/centers/create-center') return ['view', 'add', 'edit', 'delete', 'approve'];
  if (href === '/dashboard/centers/groups')        return ['view', 'add', 'edit', 'delete'];
  if (href === '/dashboard/centers/transfer')      return ['view', 'edit'];
  if (href === '/dashboard/centers/locate')        return ['view'];

  // ── Client Operations ──
  if (href === '/dashboard/client/enrollment')             return ['view', 'add'];
  if (href === '/dashboard/client/kyc-documents')          return ['view', 'edit'];
  if (href === '/dashboard/client/co-applicant')           return ['view', 'add', 'edit'];
  if (href === '/dashboard/client-operations/group-assign') return ['view', 'edit'];
  if (href === '/dashboard/client-operations/transfer')    return ['view', 'edit'];
  if (href === '/dashboard/client-operations/inactive')    return ['view', 'edit'];
  if (href === '/dashboard/client-operations/reactive')    return ['view', 'edit'];

  // ── Collections ──
  if (href === '/dashboard/collections/demand-collection')                          return ['view', 'add'];
  if (href === '/dashboard/collections/client-late-collection/single-collection')   return ['view', 'add'];
  if (href === '/dashboard/collections/client-late-collection/bulk-collection')     return ['view', 'add'];
  if (href === '/dashboard/collections/foreclosure')                                return ['view', 'add', 'delete'];
  if (href === '/dashboard/collections/savings-refund')                             return ['view', 'add', 'approve'];

  // ── Loan Module ──
  if (href === '/dashboard/loan-module/application')      return ['view', 'add', 'delete'];
  if (href === '/dashboard/loan-module/loan-indexation')  return ['view', 'add'];
  if (href === '/dashboard/loan-module/disbursement')     return ['view', 'add', 'approve'];
  if (href === '/dashboard/loan-module/final-disbursement') return ['view', 'add', 'approve'];
  if (href === '/dashboard/loan-module/change-funder')    return ['view', 'edit'];

  // ── Payroll & Attendance ──
  if (href === '/dashboard/hr/payroll')    return ['view', 'add'];
  if (href === '/dashboard/hr/attendance') return ['view', 'edit'];
  if (href === '/dashboard/hr/punch-radius') return ['view', 'edit'];

  // ── Branch ──
  if (href === '/dashboard/branch/create') return ['view', 'add', 'edit', 'delete'];

  // ── Employees ──
  if (href === '/dashboard/employees/management') return ['view', 'delete'];
  if (href === '/dashboard/employees/login-access') return ['view', 'edit'];
  if (href === '/dashboard/employees/creation')   return ['view', 'add'];

  // ── Transactions ──
  if (
    href.includes('/transactions/cash-receipt') ||
    href.includes('/transactions/cash-payment')
  ) return ['view', 'add', 'edit', 'delete', 'approve'];
  if (
    href.includes('/transactions/bank-receipt') ||
    href.includes('/transactions/bank-payment') ||
    href.includes('/transactions/journal') ||
    href.includes('/transactions/contra')
  ) return ['view', 'add', 'approve'];
  if (href.includes('/transactions/modification')) return ['view', 'edit'];

  // ── Masters — admin-only, full CRUD ──
  if (
    href === '/dashboard/masters/staff-loan-schemes' ||
    href === '/dashboard/masters/staff-loan-approval-workflow'
  ) return ['view', 'add', 'edit'];

  if (href.startsWith('/dashboard/masters/') || href.startsWith('/dashboard/admin/')) {
    return ['view', 'add', 'edit', 'delete'];
  }

  // ── HR Management ──
  if (href === '/dashboard/hr')                              return ['view'];
  if (href === '/dashboard/hr/my-profile')                   return ['view'];
  if (href === '/dashboard/hr/performance/analysis')         return ['view'];
  if (href.startsWith('/dashboard/hr/reports'))                return ['view'];
  if (href === '/dashboard/hr/tracking/live')                 return ['view'];
  if (href === '/dashboard/hr/employees')                     return ['view', 'edit'];
  if (href === '/dashboard/hr/employee-documents')            return ['view', 'add', 'approve'];
  if (href === '/dashboard/hr/belongings')                    return ['view', 'add'];
  if (
    href === '/dashboard/hr/lifecycle/confirmation' ||
    href === '/dashboard/hr/lifecycle/promotion' ||
    href === '/dashboard/hr/lifecycle/transfer' ||
    href === '/dashboard/hr/lifecycle/exit'
  ) return ['view', 'add', 'approve'];
  if (href === '/dashboard/hr/leave/apply')                   return ['view', 'add', 'edit'];
  if (href === '/dashboard/hr/leave/approval')                return ['view', 'approve'];
  if (href === '/dashboard/hr/permission/apply')              return ['view', 'add', 'edit'];
  if (href === '/dashboard/hr/permission/approval')           return ['view', 'approve'];
  if (href === '/dashboard/hr/working-hours')                 return ['view', 'edit'];
  if (href === '/dashboard/hr/attendance/week-configuration') return ['view', 'edit'];
  if (href === '/dashboard/hr/attendance/holiday-calendar')   return ['view', 'edit'];
  if (href === '/dashboard/hr/performance/goals')             return ['view', 'add', 'edit'];
  if (href === '/dashboard/hr/performance/reviews')           return ['view', 'add'];
  if (href === '/dashboard/hr/onboarding')                    return ['view', 'add', 'edit', 'approve'];
  if (href === '/dashboard/hr/approval-settings')             return ['view', 'edit'];
  if (href === '/dashboard/hr/staff-loans/apply')             return ['view', 'add', 'edit'];
  if (href === '/dashboard/hr/staff-loans/management')        return ['view', 'edit', 'approve'];
  if (href === '/dashboard/hr/staff-settlement')               return ['view', 'add'];
  if (href === '/dashboard/hr/staff-advance/apply')            return ['view', 'add', 'edit'];
  if (href === '/dashboard/hr/staff-advance/approval')         return ['view', 'edit', 'approve'];
  if (href === '/dashboard/hr/staff-advance/management')       return ['view', 'add', 'edit'];

  // ── EOD ──
  if (href.startsWith('/dashboard/eod/')) return ['view', 'add'];

  // ── Utilities ──
  if (href.startsWith('/dashboard/utilities/')) return ['view', 'add'];

  // ── Gold Loan ──
  if (href.startsWith('/dashboard/gold-')) return ['view', 'add'];

  // ── Catch-all: view only for read-only pages ──
  return ['view', 'add', 'edit', 'delete', 'approve'];
}

// ─── Full nested tree from navigationConfig ────────────────────
// Every level of nesting (e.g. Reports → Portfolio → OS Branchwise) becomes a
// real node, so nothing shown in the sidebar is hidden from callers or
// silently inherited from an ancestor.
export interface PermNode {
  label: string;
  href: string;
  applicableActions: ActionKey[];
  allowedRoles?: string[];
  children: PermNode[];
}
export interface PermSection {
  name: string;
  sectionHref: string;
  allowedRoles?: string[];
  nodes: PermNode[];
  isLeaf: boolean;
}

export function buildNode(item: NavigationItem): PermNode {
  return {
    label: item.name,
    href: item.href,
    applicableActions: getApplicableActions(item.href),
    allowedRoles: item.allowedRoles,
    children: (item.children ?? []).map(buildNode),
  };
}

export function asNode(href: string, label = href): PermNode {
  return { label, href, applicableActions: getApplicableActions(href), children: [] };
}

// Every node in a subtree, itself included (depth-first).
export function collectSubtree(node: PermNode): PermNode[] {
  return [node, ...node.children.flatMap(collectSubtree)];
}

export function buildSections(items: NavigationItem[]): PermSection[] {
  const seen = new Map<string, PermSection>();
  for (const item of items) {
    if (!item.children || item.children.length === 0) {
      if (!seen.has(item.name)) {
        seen.set(item.name, {
          name: item.name,
          sectionHref: item.href,
          allowedRoles: item.allowedRoles,
          nodes: [],
          isLeaf: true,
        });
      }
    } else {
      const nodes = item.children.map(buildNode);
      const existing = seen.get(item.name);
      if (existing) {
        existing.nodes.push(...nodes);
      } else {
        seen.set(item.name, {
          name: item.name,
          sectionHref: item.href,
          allowedRoles: item.allowedRoles,
          nodes,
          isLeaf: false,
        });
      }
    }
  }
  return Array.from(seen.values());
}

export const SECTIONS: PermSection[] = buildSections(navigationConfig);

export interface PageEntry {
  href: string;
  applicableActions: ActionKey[];
  allowedRoles?: string[];
}

export function allPageEntries(sections: PermSection[] = SECTIONS): PageEntry[] {
  const result: PageEntry[] = [];
  for (const s of sections) {
    if (s.isLeaf) {
      result.push({
        href: s.sectionHref,
        applicableActions: getApplicableActions(s.sectionHref),
        allowedRoles: s.allowedRoles,
      });
    } else {
      for (const n of s.nodes.flatMap(collectSubtree)) {
        result.push({ href: n.href, applicableActions: n.applicableActions, allowedRoles: n.allowedRoles });
      }
    }
  }
  return result;
}
