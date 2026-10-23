export interface DefaultStageConfig {
  name: string;
  stageOrder: number;
  approverRoleSlug: string;
  allowedActions: string[];
}

export interface DefaultWorkflowConfig {
  moduleSlug: string;
  /** Used only to create the Module row if a database doesn't have it yet. */
  moduleName: string;
  moduleIcon: string;
  name: string;
  description: string;
  isDefault: boolean;
  stages: DefaultStageConfig[];
}

const adminOnlyStages = (stageName: string): DefaultStageConfig[] => [
  {
    name: stageName,
    stageOrder: 1,
    approverRoleSlug: 'admin',
    allowedActions: ['approve', 'reject'],
  },
];

// Every approval starts as a single Admin stage. Admins add, remove or
// re-order stages per module afterward in /dashboard/hr/approval-settings.
// A default is only ever created for a module that has no workflow at all
// (see ensure-defaults.ts and seed-rbac.ts), so editing these never touches a
// database that is already configured.
export const DEFAULT_WORKFLOWS: DefaultWorkflowConfig[] = [
  {
    moduleSlug: 'hr-onboarding',
    moduleName: 'HR Onboarding',
    moduleIcon: 'UserPlus',
    name: 'Admin-Only Onboarding Approval',
    description: 'Single stage — Admin approval only, no BM/AM involvement',
    isDefault: true,
    stages: adminOnlyStages('Admin Approval'),
  },
  {
    moduleSlug: 'hr-transfer',
    moduleName: 'HR Transfer',
    moduleIcon: 'ArrowRightLeft',
    name: 'Admin-Only Transfer Approval',
    description: 'Single stage — Admin approval only',
    isDefault: true,
    stages: adminOnlyStages('Admin Approval'),
  },
  {
    moduleSlug: 'hr-confirmation',
    moduleName: 'HR Confirmation',
    moduleIcon: 'BadgeCheck',
    name: 'Admin-Only Confirmation Approval',
    description: 'Single stage — Admin approval only',
    isDefault: true,
    stages: adminOnlyStages('Admin Approval'),
  },
  {
    moduleSlug: 'hr-leave',
    moduleName: 'HR Leave',
    moduleIcon: 'CalendarRange',
    name: 'Admin-Only Leave Approval',
    description: 'Single stage — Admin approval only',
    isDefault: true,
    stages: adminOnlyStages('Admin Approval'),
  },
  {
    moduleSlug: 'hr-permission',
    moduleName: 'HR Permission',
    moduleIcon: 'Clock',
    name: 'Admin-Only Permission Approval',
    description: 'Single stage — Admin approval only',
    isDefault: true,
    stages: adminOnlyStages('Admin Approval'),
  },
  {
    moduleSlug: 'hr-promotion',
    moduleName: 'HR Promotion',
    moduleIcon: 'TrendingUp',
    name: 'Admin-Only Promotion Approval',
    description: 'Single stage — Admin approval only',
    isDefault: true,
    stages: adminOnlyStages('Admin Approval'),
  },
  {
    moduleSlug: 'hr-exit',
    moduleName: 'HR Exit',
    moduleIcon: 'LogOut',
    name: 'Admin-Only Exit Approval',
    description: 'Single stage — Admin final approval, runs after every clearance item is cleared',
    isDefault: true,
    stages: adminOnlyStages('Admin Approval'),
  },
];
