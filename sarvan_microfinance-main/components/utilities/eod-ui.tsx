'use client';

import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Shared visual primitives for the EOD Process page (checklist, books, denomination). */

export function EodIconTile({ icon: Icon, className }: { icon: LucideIcon; className?: string }) {
    return (
        <div
            className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-white shadow-sm',
                className
            )}
        >
            <Icon className="h-[18px] w-[18px]" />
        </div>
    );
}

export function EodSectionCard({
    icon,
    title,
    subtitle,
    badge,
    actions,
    children,
    className,
    bodyClassName,
}: {
    icon: LucideIcon;
    title: ReactNode;
    subtitle?: ReactNode;
    badge?: ReactNode;
    actions?: ReactNode;
    children: ReactNode;
    className?: string;
    bodyClassName?: string;
}) {
    return (
        <section
            className={cn(
                'relative rounded-xl border border-slate-200 bg-card shadow-sm dark:border-slate-800',
                className
            )}
        >
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4 pb-3 sm:px-5">
                <div className="flex min-w-0 items-center gap-3">
                    <EodIconTile icon={icon} />
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <h2 className="text-base font-semibold text-foreground">{title}</h2>
                            {badge}
                        </div>
                        {subtitle ? <p className="text-xs text-muted-foreground">{subtitle}</p> : null}
                    </div>
                </div>
                {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
            </div>
            <div className={cn('px-4 pb-4 sm:px-5 sm:pb-5', bodyClassName)}>{children}</div>
        </section>
    );
}

export type EodPillTone = 'success' | 'warning' | 'danger' | 'neutral';

const PILL_TONES: Record<EodPillTone, string> = {
    success: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900',
    warning: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900',
    danger: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-900',
    neutral: 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700',
};

export function EodPill({
    tone,
    icon: Icon,
    children,
    className,
}: {
    tone: EodPillTone;
    icon?: LucideIcon;
    children: ReactNode;
    className?: string;
}) {
    return (
        <span
            className={cn(
                'inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset',
                PILL_TONES[tone],
                className
            )}
        >
            {Icon ? <Icon className="h-3 w-3" /> : null}
            {children}
        </span>
    );
}

/** Table wrapper: rounded border, muted header row, compact rows. */
export const eodTableWrapClass = 'overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800';
export const eodHeadRowClass = 'bg-slate-50 hover:bg-slate-50 dark:bg-slate-900/60 dark:hover:bg-slate-900/60';
export const eodHeadCellClass = 'h-9 text-xs font-semibold text-slate-600 dark:text-slate-300';
