'use client';

import { Calendar, Code, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useBrandNames } from '@/app/lib/brand-context';

interface DashboardFooterProps {
  workingDate?: string;
  version?: string;
  className?: string;
}

export function DashboardFooter({
  workingDate = '26-11-2026',
  version = '2.5.4',
  className,
}: DashboardFooterProps) {
  const { companyNameFull } = useBrandNames();

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-between gap-4 border-t border-primary/20 pt-6 dark:border-sidebar-accent sm:flex-row',
        className
      )}
    >
      {/* <div className="flex flex-wrap items-center gap-6 text-xs text-sidebar-accent dark:text-slate-400">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4" />
          <span>
            Current Working Date: <strong className="font-semibold text-foreground dark:text-white">{workingDate}</strong>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Code className="h-4 w-4" />
          <span>
            Version: <strong className="font-semibold text-foreground dark:text-white">{version}</strong>
          </span>
        </div>
      </div> */}

      <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-500">
        <Sparkles className="h-4 w-4 text-primary" />
        <span>{companyNameFull} Management System</span>
      </div>
    </div>
  );
}

