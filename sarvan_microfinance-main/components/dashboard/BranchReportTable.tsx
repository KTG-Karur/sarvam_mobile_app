'use client';

import { cn } from '@/lib/utils';
import { CheckCircle2, AlertCircle, Building2 } from 'lucide-react';

export interface ReportRow {
  code: string;
  branch: string;
  centers: number;
  clients: number;
  openingArr: number;
  demand: number;
  collection: number;
  closingArr: number;
  status: 'Collected' | 'Pending' | 'Overdue';
}

function StatusBadge({ status }: { status: ReportRow['status'] }) {
  const config = {
    Collected: {
      icon: CheckCircle2,
      className:
        'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400',
      iconClassName: 'text-emerald-600 dark:text-emerald-400',
    },
    Pending: {
      icon: AlertCircle,
      className:
        'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400',
      iconClassName: 'text-amber-600 dark:text-amber-400',
    },
    Overdue: {
      icon: AlertCircle,
      className:
        'bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-400',
      iconClassName: 'text-rose-600 dark:text-rose-400',
    },
  };

  const { icon: Icon, className, iconClassName } = config[status] || config['Pending'];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold',
        className
      )}
    >
      <Icon className={cn('h-3.5 w-3.5', iconClassName)} />
      {status}
    </span>
  );
}

export function BranchReportTable({ data }: { data?: ReportRow[] }) {
  const rows = data || [];

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(amount);
  };

  // Calculate Totals
  const totals = rows.reduce((acc, row) => ({
    centers: acc.centers + row.centers,
    clients: acc.clients + row.clients,
    openingArr: acc.openingArr + row.openingArr,
    demand: acc.demand + row.demand,
    collection: acc.collection + row.collection,
    closingArr: acc.closingArr + row.closingArr,
  }), {
    centers: 0,
    clients: 0,
    openingArr: 0,
    demand: 0,
    collection: 0,
    closingArr: 0,
  });

  return (
    <div className="overflow-hidden rounded-xl border border-primary/20 bg-white shadow-xl dark:border-sidebar-accent dark:bg-brand-green-darker">
      {/* Enhanced Header */}
      <div className="bg-gradient-to-r from-primary via-sidebar-accent to-primary px-4 sm:px-8 py-5">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/20 backdrop-blur-sm shadow-lg">
            <Building2 className="h-6 w-6 text-white" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-white">Branch Report</h3>
            <p className="mt-1 text-sm text-green-100">
              Real-time collection and disbursement overview across all branches
            </p>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b-2 border-primary/20 bg-gradient-to-r from-slate-50 to-slate-100 dark:border-sidebar-accent dark:from-sidebar-accent/80 dark:to-sidebar-accent/50">
              <th className="px-4 sm:px-8 py-5 text-left text-xs font-bold uppercase tracking-wider text-sidebar-accent dark:text-slate-300">
                Code
              </th>
              <th className="px-4 sm:px-8 py-5 text-left text-xs font-bold uppercase tracking-wider text-sidebar-accent dark:text-slate-300">
                Branch
              </th>
              <th className="px-4 sm:px-8 py-5 text-right text-xs font-bold uppercase tracking-wider text-sidebar-accent dark:text-slate-300">
                Centers
              </th>
              <th className="px-4 sm:px-8 py-5 text-right text-xs font-bold uppercase tracking-wider text-sidebar-accent dark:text-slate-300">
                Clients
              </th>
              <th className="px-4 sm:px-8 py-5 text-right text-xs font-bold uppercase tracking-wider text-sidebar-accent dark:text-slate-300">
                Opening Arr
              </th>
              <th className="px-4 sm:px-8 py-5 text-right text-xs font-bold uppercase tracking-wider text-sidebar-accent dark:text-slate-300">
                Demand
              </th>
              <th className="px-4 sm:px-8 py-5 text-right text-xs font-bold uppercase tracking-wider text-sidebar-accent dark:text-slate-300">
                Collection
              </th>
              <th className="px-4 sm:px-8 py-5 text-right text-xs font-bold uppercase tracking-wider text-sidebar-accent dark:text-slate-300">
                Closing Arr
              </th>
              <th className="px-4 sm:px-8 py-5 text-center text-xs font-bold uppercase tracking-wider text-sidebar-accent dark:text-slate-300">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-sidebar-accent">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 sm:px-8 py-10 text-center text-muted-foreground">
                  No branch data available.
                </td>
              </tr>
            ) : (
              rows.map((row, index) => (
                <tr
                  key={index}
                  className={cn(
                    'transition-all duration-200 hover:bg-green-50/50 hover:shadow-sm dark:hover:bg-sidebar-accent/70',
                    index % 2 === 0
                      ? 'bg-white dark:bg-brand-green-darker'
                      : 'bg-green-50/50 dark:bg-brand-green-darker/50'
                  )}
                >
                  <td className="whitespace-nowrap px-4 sm:px-8 py-5">
                    <span className="font-mono text-sm font-bold text-primary dark:text-primary">
                      {row.code}
                    </span>
                  </td>
                  <td className="px-4 sm:px-8 py-5">
                    <span className="text-sm font-semibold text-foreground dark:text-slate-100">
                      {row.branch}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 sm:px-8 py-5 text-right">
                    <span className="text-sm font-bold text-sidebar-accent dark:text-slate-300">
                      {row.centers}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 sm:px-8 py-5 text-right">
                    <span className="text-sm font-bold text-sidebar-accent dark:text-slate-300">
                      {row.clients}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 sm:px-8 py-5 text-right">
                    <span className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                      {formatCurrency(row.openingArr)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 sm:px-8 py-5 text-right">
                    <span className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                      {formatCurrency(row.demand)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 sm:px-8 py-5 text-right">
                    <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                      {formatCurrency(row.collection)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 sm:px-8 py-5 text-right">
                    <span className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                      {formatCurrency(row.closingArr)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 sm:px-8 py-5 text-center">
                    <StatusBadge status={row.status} />
                  </td>
                </tr>
              ))
            )}

            {/* Total Row */}
            {rows.length > 0 && (
              <tr className="border-t-2 border-primary/30 bg-gradient-to-r from-green-50 via-green-50 to-green-50 font-bold dark:border-sidebar-accent dark:from-brand-green-darker/30 dark:via-brand-green-darker/30 dark:to-brand-green-darker/30">
                <td className="px-4 sm:px-8 py-5">
                  <span className="text-sm text-sidebar-accent dark:text-slate-300">{rows.length}</span>
                </td>
                <td className="px-4 sm:px-8 py-5">
                  <span className="text-base text-foreground dark:text-white">Total</span>
                </td>
                <td className="whitespace-nowrap px-4 sm:px-8 py-5 text-right">
                  <span className="text-base text-foreground dark:text-white">{totals.centers}</span>
                </td>
                <td className="whitespace-nowrap px-4 sm:px-8 py-5 text-right">
                  <span className="text-base text-foreground dark:text-white">{totals.clients}</span>
                </td>
                <td className="whitespace-nowrap px-4 sm:px-8 py-5 text-right">
                  <span className="text-base text-foreground dark:text-white">
                    {formatCurrency(totals.openingArr)}
                  </span>
                </td>
                <td className="whitespace-nowrap px-4 sm:px-8 py-5 text-right">
                  <span className="text-base text-foreground dark:text-white">
                    {formatCurrency(totals.demand)}
                  </span>
                </td>
                <td className="whitespace-nowrap px-4 sm:px-8 py-5 text-right">
                  <span className="text-base font-bold text-emerald-700 dark:text-emerald-400">
                    {formatCurrency(totals.collection)}
                  </span>
                </td>
                <td className="whitespace-nowrap px-4 sm:px-8 py-5 text-right">
                  <span className="text-base text-foreground dark:text-white">
                    {formatCurrency(totals.closingArr)}
                  </span>
                </td>
                <td className="px-4 sm:px-8 py-5"></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
