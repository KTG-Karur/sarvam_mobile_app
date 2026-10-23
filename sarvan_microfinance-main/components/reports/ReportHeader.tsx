'use client';

import { useBrandNames } from '@/app/lib/brand-context';

interface ReportHeaderProps {
  title: string;
  subtitle?: string;
}

/**
 * Standard trust header shown at the top of every report — on screen and in print
 * (place inside whatever DOM node is passed to useReactToPrint's contentRef so it
 * appears identically in both).
 */
export function ReportHeader({ title, subtitle }: ReportHeaderProps) {
  const { companyNameFull, logoVersion } = useBrandNames();
  const companyNameCaps = companyNameFull.toUpperCase();
  return (
    <div className="flex flex-col items-center text-center gap-1 border-b-2 border-black pb-3 mb-4 print:pb-2 print:mb-3">
      <div className="flex items-center gap-3">
        <img
          src={`/api/branding/asset/logo-wordmark?v=${logoVersion}`}
          alt={companyNameCaps}
          className="h-12 w-auto max-w-[160px] object-contain shrink-0"
        />
        <div className="text-left">
          <p className="text-lg font-bold tracking-wide text-foreground leading-tight">
            {companyNameCaps}
          </p>
          <p className="text-sm font-semibold text-primary leading-tight">
            {title}
          </p>
        </div>
      </div>
      {subtitle && (
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p>
      )}
    </div>
  );
}
