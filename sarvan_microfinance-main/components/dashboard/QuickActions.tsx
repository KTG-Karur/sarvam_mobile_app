'use client';

import { type LucideIcon } from 'lucide-react';
import {
  PlusCircle,
  FileText,
  Users,
  ShieldCheck,
  Receipt,
  UserSearch,
  FileCheck,
  FileUser,
  Sunset,
  BarChart3,
  Building2,
  UserCog,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { tokenStorage } from '@/app/lib/token-storage';
import type { UserRole } from '@/app/types';
import { navigationConfig, type NavigationItem } from '@/app/config/navigation.config';

interface QuickAction {
  label: string;
  icon: LucideIcon;
  description: string;
  onClick: () => void;
  gradient: 'blue' | 'green' | 'purple' | 'orange';
}

type QuickActionTemplate = Omit<QuickAction, 'onClick'> & {
  href: string;
};

const gradientClasses = {
  blue: 'from-primary to-primary hover:from-primary hover:to-sidebar-accent',
  green: 'from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700',
  purple: 'from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700',
  orange: 'from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700',
};

function isRoleAllowed(allowedRoles: UserRole[] | undefined, role: UserRole): boolean {
  if (!allowedRoles || allowedRoles.length === 0) return true;
  return allowedRoles.includes(role);
}

function collectAllowedHrefsForRole(items: NavigationItem[], role: UserRole): Set<string> {
  const allowed = new Set<string>();

  const walk = (node: NavigationItem, parentAllowed: boolean) => {
    const nodeAllowed = parentAllowed && isRoleAllowed(node.allowedRoles, role);
    if (nodeAllowed) allowed.add(node.href);
    for (const child of node.children ?? []) {
      walk(child, nodeAllowed);
    }
  };

  for (const item of items) walk(item, true);
  return allowed;
}

function normalizeRole(raw: string | undefined | null): UserRole | null {
  if (raw === 'ADMIN' || raw === 'BRANCH_MANAGER' || raw === 'AREA_MANAGER' || raw === 'FDO' || raw === 'DIVISION_MANAGER' || raw === 'ADMIN_NON_HO_BRANCH_SWITCH') return raw;
  return null;
}

export function QuickActions() {
  const router = useRouter();

  const quickActions = useMemo((): QuickAction[] => {
    const role = normalizeRole(tokenStorage.getUser()?.role);
    const safeRole: UserRole = role ?? 'FDO';

    const allowedHrefs = collectAllowedHrefsForRole(navigationConfig, safeRole);
    const isHrefAllowed = (href: string) => allowedHrefs.has(href);

    const templatesByRole: Record<UserRole, QuickActionTemplate[]> = {
      BRANCH_MANAGER: [
        {
          label: 'Member Approval',
          icon: ShieldCheck,
          description: 'Review and approve member onboarding',
          href: '/dashboard/approval/workbench',
          gradient: 'orange',
        },
        {
          label: 'Collection Approval',
          icon: Receipt,
          description: 'Approve submitted collections',
          href: '/dashboard/collections/approval',
          gradient: 'blue',
        },
        {
          label: 'Demand Collection',
          icon: Receipt,
          description: 'Capture meeting collections quickly',
          href: '/dashboard/collections/demand-collection',
          gradient: 'green',
        },
        {
          label: 'Loan Indexation',
          icon: FileText,
          description: 'Create and manage loan indexes',
          href: '/dashboard/loan-module/loan-indexation',
          gradient: 'purple',
        },
        {
          label: 'EOD Process',
          icon: Sunset,
          description: 'Close day operations and sync totals',
          href: '/dashboard/eod/eod-process',
          gradient: 'purple',
        },
        {
          label: 'Reports',
          icon: BarChart3,
          description: 'Operational and portfolio reports',
          href: '/dashboard/reports',
          gradient: 'blue',
        },
      ],
      FDO: [
        {
          label: 'Member Enrollment',
          icon: Users,
          description: 'Register a new member',
          href: '/dashboard/client/enrollment',
          gradient: 'green',
        },
        {
          label: 'Loan Application',
          icon: PlusCircle,
          description: 'Create a new loan application',
          href: '/dashboard/loan-module/application',
          gradient: 'blue',
        },
        {
          label: 'Demand Collection',
          icon: Receipt,
          description: 'Capture meeting collections quickly',
          href: '/dashboard/collections/demand-collection',
          gradient: 'orange',
        },
        {
          label: 'KYC Documents',
          icon: FileCheck,
          description: 'Upload client KYC documents',
          href: '/dashboard/client/kyc-documents',
          gradient: 'purple',
        },
        {
          label: 'KYC Update',
          icon: FileUser,
          description: 'Update client KYC details',
          href: '/dashboard/client/kyc-update',
          gradient: 'blue',
        },
        {
          label: 'Search Client',
          icon: UserSearch,
          description: 'Find and verify client records',
          href: '/dashboard/client-search',
          gradient: 'green',
        },
      ],
      AREA_MANAGER: [
        {
          label: 'Member Approval',
          icon: ShieldCheck,
          description: 'Final approval and retake decisions',
          href: '/dashboard/approval/workbench',
          gradient: 'orange',
        },
        {
          label: 'Daily Monitoring',
          icon: BarChart3,
          description: 'Track branch performance daily',
          href: '/dashboard/daily-monitoring/new-zero-collection',
          gradient: 'blue',
        },
        {
          label: 'Loan Disbursement',
          icon: FileText,
          description: 'Review disbursement reports',
          href: '/dashboard/reports/portfolio/loan-disbursement',
          gradient: 'purple',
        },
        {
          label: 'Reports',
          icon: BarChart3,
          description: 'Operations and portfolio reports',
          href: '/dashboard/reports',
          gradient: 'green',
        },
        {
          label: 'Change Branch',
          icon: Building2,
          description: 'Switch branch context',
          href: '/dashboard/branch/change',
          gradient: 'purple',
        },
        {
          label: 'User Management',
          icon: UserCog,
          description: 'Manage users and roles',
          href: '/dashboard/employees/management',
          gradient: 'orange',
        },
      ],
      ADMIN: [
        {
          label: 'User Management',
          icon: UserCog,
          description: 'Manage users and permissions',
          href: '/dashboard/employees/management',
          gradient: 'orange',
        },
        {
          label: 'Member Validation',
          icon: ShieldCheck,
          description: 'Configure enrollment field requirements',
          href: '/dashboard/client/enrollment-validation',
          gradient: 'purple',
        },
        {
          label: 'Working Date',
          icon: Building2,
          description: 'View current branch working (EOD) date',
          href: '/dashboard/branch/working-date',
          gradient: 'blue',
        },
        {
          label: 'Member Approval',
          icon: ShieldCheck,
          description: 'Audit and approve member onboarding',
          href: '/dashboard/approval/workbench',
          gradient: 'purple',
        },
        {
          label: 'Reports',
          icon: BarChart3,
          description: 'Company-wide reporting',
          href: '/dashboard/reports',
          gradient: 'green',
        },
        {
          label: 'Portfolio OS',
          icon: FileText,
          description: 'Outstanding portfolio by branch',
          href: '/dashboard/admin-reports/portfolio/os-branchwise',
          gradient: 'orange',
        },
      ],
      DIVISION_MANAGER: [
        {
          label: 'Reports',
          icon: BarChart3,
          description: 'Division-wide reporting',
          href: '/dashboard/reports',
          gradient: 'blue',
        },
        {
          label: 'Member Approval',
          icon: ShieldCheck,
          description: 'Review and approve member onboarding',
          href: '/dashboard/approval/workbench',
          gradient: 'orange',
        },
        {
          label: 'Daily Monitoring',
          icon: BarChart3,
          description: 'Track division performance daily',
          href: '/dashboard/daily-monitoring/new-zero-collection',
          gradient: 'green',
        },
      ],
      ADMIN_NON_HO_BRANCH_SWITCH: [
        {
          label: 'User Management',
          icon: UserCog,
          description: 'Manage users and permissions',
          href: '/dashboard/employees/management',
          gradient: 'orange',
        },
        {
          label: 'Working Date',
          icon: Building2,
          description: 'View current branch working (EOD) date',
          href: '/dashboard/branch/working-date',
          gradient: 'blue',
        },
        {
          label: 'Member Approval',
          icon: ShieldCheck,
          description: 'Audit and approve member onboarding',
          href: '/dashboard/approval/workbench',
          gradient: 'purple',
        },
        {
          label: 'Reports',
          icon: BarChart3,
          description: 'Company-wide reporting',
          href: '/dashboard/reports',
          gradient: 'green',
        },
        {
          label: 'Portfolio OS',
          icon: FileText,
          description: 'Outstanding portfolio by branch',
          href: '/dashboard/admin-reports/portfolio/os-branchwise',
          gradient: 'orange',
        },
        {
          label: 'Change Branch',
          icon: Building2,
          description: 'Switch branch context',
          href: '/dashboard/branch/change',
          gradient: 'blue',
        },
      ],
    };

    const candidates = templatesByRole[safeRole] ?? templatesByRole.FDO;
    const filtered: QuickActionTemplate[] = [];
    const seen = new Set<string>();

    for (const t of candidates) {
      if (!isHrefAllowed(t.href)) continue;
      if (seen.has(t.href)) continue;
      filtered.push(t);
      seen.add(t.href);
      if (filtered.length >= 6) break;
    }

    // Guaranteed fallback to avoid empty state due to config mismatch.
    if (filtered.length === 0 && isHrefAllowed('/dashboard/reports')) {
      filtered.push({
        label: 'Reports',
        icon: BarChart3,
        description: 'View operational reports',
        href: '/dashboard/reports',
        gradient: 'blue',
      });
    }

    return filtered.map((t) => ({
      label: t.label,
      icon: t.icon,
      description: t.description,
      gradient: t.gradient,
      onClick: () => router.push(t.href),
    }));
  }, [router]);

  return (
    <div className="rounded-xl border border-primary/20 bg-white p-6 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker">
      <div className="mb-6">
        <h3 className="text-xl font-bold text-foreground dark:text-white">
          Quick Actions
        </h3>
        <p className="mt-1 text-sm text-sidebar-accent dark:text-slate-400">
          Frequently used actions and shortcuts
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {quickActions.map((action, index) => {
          const Icon = action.icon;
          return (
            <button
              key={index}
              onClick={action.onClick}
              className={cn(
                'group relative overflow-hidden rounded-lg border border-primary/20 bg-white p-4 text-left transition-all duration-300 hover:scale-105 hover:shadow-xl dark:border-sidebar-accent dark:bg-sidebar-accent',
                'focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 dark:focus:ring-offset-brand-green-darker'
              )}
            >
              {/* Gradient Background on Hover */}
              <div
                className={cn(
                  'absolute inset-0 bg-gradient-to-br opacity-0 transition-opacity duration-300 group-hover:opacity-5',
                  gradientClasses[action.gradient]
                )}
              />

              <div className="relative flex items-start gap-4">
                {/* Icon */}
                <div
                  className={cn(
                    'flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br shadow-md transition-transform duration-300 group-hover:scale-110',
                    gradientClasses[action.gradient]
                  )}
                >
                  <Icon className="h-6 w-6 text-white" />
                </div>

                {/* Content */}
                <div className="flex-1">
                  <h4 className="font-semibold text-foreground dark:text-white">
                    {action.label}
                  </h4>
                  <p className="mt-1 text-xs text-sidebar-accent dark:text-slate-400">
                    {action.description}
                  </p>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

