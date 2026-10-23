'use client';

import { type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown } from 'lucide-react';

export interface MetricCardProps {
  title: string;
  value: string;
  subtitle?: string;
  icon: LucideIcon;
  href?: string;
  trend?: {
    value: number;
    isPositive: boolean;
    label?: string;
  };
  gradient?: 'blue' | 'green' | 'purple' | 'orange' | 'indigo' | 'rose';
  className?: string;
}

const gradientConfig = {
  blue: {
    iconBg: 'from-primary to-primary',
    iconBgDark: 'from-primary to-sidebar-accent',
    border: 'border-primary/30 dark:border-sidebar-accent',
    glow: 'shadow-primary/20',
    accent: 'text-primary dark:text-primary',
  },
  green: {
    iconBg: 'from-emerald-500 to-emerald-600',
    iconBgDark: 'from-emerald-600 to-emerald-700',
    border: 'border-emerald-200 dark:border-emerald-800',
    glow: 'shadow-emerald-500/20',
    accent: 'text-emerald-600 dark:text-emerald-400',
  },
  purple: {
    iconBg: 'from-purple-500 to-purple-600',
    iconBgDark: 'from-purple-600 to-purple-700',
    border: 'border-purple-200 dark:border-purple-800',
    glow: 'shadow-purple-500/20',
    accent: 'text-purple-600 dark:text-purple-400',
  },
  orange: {
    iconBg: 'from-orange-500 to-orange-600',
    iconBgDark: 'from-orange-600 to-orange-700',
    border: 'border-orange-200 dark:border-orange-800',
    glow: 'shadow-orange-500/20',
    accent: 'text-orange-600 dark:text-orange-400',
  },
  indigo: {
    iconBg: 'from-primary to-primary',
    iconBgDark: 'from-primary to-primary',
    border: 'border-primary dark:border-primary',
    glow: 'shadow-primary/20',
    accent: 'text-primary dark:text-primary',
  },
  rose: {
    iconBg: 'from-rose-500 to-rose-600',
    iconBgDark: 'from-rose-600 to-rose-700',
    border: 'border-rose-200 dark:border-rose-800',
    glow: 'shadow-rose-500/20',
    accent: 'text-rose-600 dark:text-rose-400',
  },
};

export function MetricCard({
  title,
  value,
  subtitle,
  icon: Icon,
  href,
  trend,
  gradient = 'blue',
  className,
}: MetricCardProps) {
  const config = gradientConfig[gradient];

  const Container: React.ElementType = href ? 'a' : 'div';
  const containerProps = href
    ? ({
        href,
        className: cn(
          'group relative overflow-hidden rounded-xl border bg-white/80 backdrop-blur-sm transition-all duration-300 hover:scale-[1.02] hover:shadow-xl dark:bg-brand-green-darker/80',
          config.border,
          config.glow,
          'hover:shadow-lg',
          'block focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 dark:focus:ring-offset-brand-green-darker',
          className
        ),
      } as const)
    : ({
        className: cn(
          'group relative overflow-hidden rounded-xl border bg-white/80 backdrop-blur-sm transition-all duration-300 hover:scale-[1.02] hover:shadow-xl dark:bg-brand-green-darker/80',
          config.border,
          config.glow,
          'hover:shadow-lg',
          className
        ),
      } as const);

  return (
    <Container {...containerProps}>
      {/* Animated Background Gradient */}
      <div
        className={cn(
          'absolute inset-0 bg-gradient-to-br opacity-0 transition-opacity duration-300 group-hover:opacity-5',
          gradient === 'blue' && 'from-primary to-primary',
          gradient === 'green' && 'from-emerald-400 to-emerald-600',
          gradient === 'purple' && 'from-purple-400 to-purple-600',
          gradient === 'orange' && 'from-orange-400 to-orange-600',
          gradient === 'indigo' && 'from-primary to-primary',
          gradient === 'rose' && 'from-rose-400 to-rose-600'
        )}
      />

      {/* Content */}
      <div className="relative p-6">
        <div className="flex items-start justify-between">
          {/* Icon Section */}
          <div
            className={cn(
              'flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br shadow-lg transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3',
              config.iconBg
            )}
          >
            <Icon className="h-7 w-7 text-white" />
          </div>

          {/* Trend Indicator */}
          {trend && (
            <div
              className={cn(
                'flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold',
                trend.isPositive
                  ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400'
                  : 'bg-rose-50 text-rose-600 dark:bg-rose-950/30 dark:text-rose-400'
              )}
            >
              {trend.isPositive ? (
                <TrendingUp className="h-3.5 w-3.5" />
              ) : (
                <TrendingDown className="h-3.5 w-3.5" />
              )}
              <span>{Math.abs(trend.value)}%</span>
            </div>
          )}
        </div>

        {/* Content Section */}
        <div className="mt-6 space-y-1">
          <p className="text-sm font-medium text-sidebar-accent dark:text-slate-400">
            {title}
          </p>
          <h3 className="text-3xl font-bold tracking-tight text-foreground dark:text-white">
            {value}
          </h3>
          {subtitle && (
            <p className="text-xs text-slate-500 dark:text-slate-500">
              {subtitle}
            </p>
          )}
          {trend?.label && (
            <p className={cn('text-xs font-medium', config.accent)}>
              {trend.label}
            </p>
          )}
        </div>

        {/* Decorative Elements */}
        <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-gradient-to-br opacity-10 blur-2xl transition-opacity duration-300 group-hover:opacity-20" />
      </div>
    </Container>
  );
}

