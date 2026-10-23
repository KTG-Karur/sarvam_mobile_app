'use client';

import { Clock, CheckCircle2, AlertCircle, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Activity {
  id: string;
  type: 'success' | 'info' | 'warning' | 'transaction';
  title: string;
  description: string;
  time: string;
  icon: React.ElementType;
}

const activities: Activity[] = [
  {
    id: '1',
    type: 'success',
    title: 'EOD Completed',
    description: 'End of day process completed for Branch 001 - GUDALUR',
    time: '2 minutes ago',
    icon: CheckCircle2,
  },
  {
    id: '2',
    type: 'transaction',
    title: 'Loan Disbursed',
    description: 'New loan of ₹ 50,000 disbursed to client #1234',
    time: '15 minutes ago',
    icon: TrendingUp,
  },
  {
    id: '3',
    type: 'info',
    title: 'Collection Updated',
    description: 'Daily collection updated for Branch 003 - KARUR',
    time: '1 hour ago',
    icon: Clock,
  },
  {
    id: '4',
    type: 'warning',
    title: 'Pending Approval',
    description: '5 loan applications pending approval',
    time: '2 hours ago',
    icon: AlertCircle,
  },
  {
    id: '5',
    type: 'success',
    title: 'Member Added',
    description: 'New member registered in Branch 002 - ERODE',
    time: '3 hours ago',
    icon: CheckCircle2,
  },
];

const typeConfig = {
  success: {
    iconBg: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400',
    border: 'border-emerald-200 dark:border-emerald-800',
  },
  info: {
    iconBg: 'bg-brand-green-tint text-primary dark:bg-green-950/30 dark:text-primary',
    border: 'border-primary/30 dark:border-sidebar-accent',
  },
  warning: {
    iconBg: 'bg-amber-100 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400',
    border: 'border-amber-200 dark:border-amber-800',
  },
  transaction: {
    iconBg: 'bg-purple-100 text-purple-600 dark:bg-purple-950/30 dark:text-purple-400',
    border: 'border-purple-200 dark:border-purple-800',
  },
};

export function ActivityFeed() {
  return (
    <div className="rounded-xl border border-primary/20 bg-white p-6 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker">
      <div className="mb-6">
        <h3 className="text-xl font-bold text-foreground dark:text-white">
          Recent Activity
        </h3>
        <p className="mt-1 text-sm text-sidebar-accent dark:text-slate-400">
          Latest system activities and updates
        </p>
      </div>

      <div className="space-y-4">
        {activities.map((activity, index) => {
          const Icon = activity.icon;
          const config = typeConfig[activity.type];
          const isLast = index === activities.length - 1;

          return (
            <div key={activity.id} className="relative flex gap-4">
              {/* Timeline Line */}
              {!isLast && (
                <div className="absolute left-5 top-12 h-full w-0.5 bg-brand-green-tint dark:bg-sidebar-accent" />
              )}

              {/* Icon */}
              <div
                className={cn(
                  'relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 transition-transform duration-200 hover:scale-110',
                  config.iconBg,
                  config.border
                )}
              >
                <Icon className="h-5 w-5" />
              </div>

              {/* Content */}
              <div className="flex-1 pb-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <h4 className="font-semibold text-foreground dark:text-white">
                      {activity.title}
                    </h4>
                    <p className="mt-1 text-sm text-sidebar-accent dark:text-slate-400">
                      {activity.description}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-slate-500 dark:text-slate-500">
                    {activity.time}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <button className="mt-4 w-full rounded-lg border border-primary/20 bg-green-50 px-4 py-2 text-sm font-medium text-sidebar-accent transition-colors hover:bg-brand-green-tint dark:border-sidebar-accent dark:bg-sidebar-accent dark:text-slate-300 dark:hover:bg-sidebar-accent">
        View All Activities
      </button>
    </div>
  );
}

