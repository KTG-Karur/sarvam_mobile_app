'use client';

import { Button } from '@/components/ui/button';
import { type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PageHeaderProps {
  title: string;
  description?: string;
  badge?: string;
  actions?: {
    label: string;
    onClick: () => void;
    icon?: LucideIcon;
    variant?: 'default' | 'outline' | 'secondary' | 'ghost';
  }[];
}

export function PageHeader({
  title,
  description,
  badge,
  actions,
}: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-3 pt-3 sm:pt-4 md:pt-6 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-1 sm:space-y-2 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight text-foreground leading-tight">
            {title}
          </h1>
          {badge && (
            <span className="inline-flex items-center rounded-full bg-primary px-2.5 py-0.5 text-xs font-semibold text-white shadow-lg">
              {badge}
            </span>
          )}
        </div>
        {description && (
          <p className="text-sm sm:text-base text-muted-foreground">
            {description}
          </p>
        )}
      </div>

      {actions && actions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {actions.map((action, index) => {
            const Icon = action.icon;
            return (
              <Button
                key={index}
                onClick={action.onClick}
                variant={action.variant || 'default'}
                size="sm"
                className={cn(
                  // No color override here — the default Button variant's own
                  // bg-primary/text-primary-foreground is already theme-reactive.
                  action.variant === 'default' && 'shadow-lg transition-all hover:shadow-xl',
                  action.variant === 'outline' &&
                    'border-2 transition-all hover:scale-105'
                )}
              >
                {Icon && <Icon className="mr-2 h-4 w-4" />}
                {action.label}
              </Button>
            );
          })}
        </div>
      )}
    </div>
  );
}
