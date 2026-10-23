'use client';

import { cn } from '@/lib/utils';
import { CheckCircle2, Clock, Calendar } from 'lucide-react';

export interface EODRow {
  branch: string;
  eodDate: string;
  doneAt: string;
  status: 'Completed' | 'Pending' | 'In Progress';
  openingBalance: number;
  totalReceipts: number;
  totalPayments: number;
  closingBalance: number;
}

function EODStatusBadge({ status }: { status: EODRow['status'] }) {
  const config = {
    Completed: {
      icon: CheckCircle2,
      className:
        'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400',
      iconClassName: 'text-emerald-600 dark:text-emerald-400',
    },
    Pending: {
      icon: Clock,
      className:
        'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400',
      iconClassName: 'text-amber-600 dark:text-amber-400',
    },
    'In Progress': {
      icon: Clock,
      className:
        'bg-green-50 text-sidebar-accent dark:bg-green-950/30 dark:text-primary',
      iconClassName: 'text-primary dark:text-primary',
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

export function EODStatusTable({ data }: { data?: EODRow[] }) {
  const rows = data || [];

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 2,
    }).format(amount);
  };

  // Calculate Totals
  const totals = rows.reduce((acc, row) => ({
    openingBalance: acc.openingBalance + row.openingBalance,
    totalReceipts: acc.totalReceipts + row.totalReceipts,
    totalPayments: acc.totalPayments + row.totalPayments,
    closingBalance: acc.closingBalance + row.closingBalance,
  }), {
    openingBalance: 0,
    totalReceipts: 0,
    totalPayments: 0,
    closingBalance: 0,
  });

  return (
    <div className="overflow-hidden rounded-xl border border-primary/20 bg-white shadow-xl dark:border-sidebar-accent dark:bg-brand-green-darker">
      {/* Enhanced Header */}
      <div className="bg-gradient-to-r from-primary via-purple-600 to-primary px-4 sm:px-8 py-5">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/20 backdrop-blur-sm shadow-lg">
            <Calendar className="h-6 w-6 text-white" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-white">End of Day Status</h3>
            <p className="mt-1 text-sm text-primary">
              Daily transaction summary and balance tracking across all branches
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
                Branch
              </th>
              <th className="px-4 sm:px-8 py-5 text-left text-xs font-bold uppercase tracking-wider text-sidebar-accent dark:text-slate-300">
                EOD Date
              </th>
              <th className="px-4 sm:px-8 py-5 text-left text-xs font-bold uppercase tracking-wider text-sidebar-accent dark:text-slate-300">
                Done At
              </th>
              <th className="px-4 sm:px-8 py-5 text-center text-xs font-bold uppercase tracking-wider text-sidebar-accent dark:text-slate-300">
                Status
              </th>
              <th className="px-4 sm:px-8 py-5 text-right text-xs font-bold uppercase tracking-wider text-sidebar-accent dark:text-slate-300">
                Opening Balance
              </th>
              <th className="px-4 sm:px-8 py-5 text-right text-xs font-bold uppercase tracking-wider text-sidebar-accent dark:text-slate-300">
                Total Receipts
              </th>
              <th className="px-4 sm:px-8 py-5 text-right text-xs font-bold uppercase tracking-wider text-sidebar-accent dark:text-slate-300">
                Total Payments
              </th>
              <th className="px-4 sm:px-8 py-5 text-right text-xs font-bold uppercase tracking-wider text-sidebar-accent dark:text-slate-300">
                Closing Balance
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-sidebar-accent">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 sm:px-8 py-10 text-center text-muted-foreground">
                  No EOD data available.
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
                  <td className="px-4 sm:px-8 py-5">
                    <span className="text-sm font-semibold text-foreground dark:text-slate-100">
                      {row.branch}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 sm:px-8 py-5">
                    <span className="text-sm font-medium text-sidebar-accent dark:text-slate-300">
                      {row.eodDate}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 sm:px-8 py-5">
                    <span className="text-sm text-sidebar-accent dark:text-slate-400">
                      {row.doneAt}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 sm:px-8 py-5 text-center">
                    <EODStatusBadge status={row.status} />
                  </td>
                  <td className="whitespace-nowrap px-4 sm:px-8 py-5 text-right">
                    <span className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                      {formatCurrency(row.openingBalance)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 sm:px-8 py-5 text-right">
                    <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                      {formatCurrency(row.totalReceipts)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 sm:px-8 py-5 text-right">
                    <span className="text-sm font-bold text-rose-600 dark:text-rose-400">
                      {formatCurrency(row.totalPayments)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 sm:px-8 py-5 text-right">
                    <span className="text-sm font-bold text-primary dark:text-primary">
                      {formatCurrency(row.closingBalance)}
                    </span>
                  </td>
                </tr>
              ))
            )}

            {/* Grand Total Row */}
            {rows.length > 0 && (
              <tr className="border-t-2 border-primary/30 bg-gradient-to-r from-green-50 via-purple-50 to-green-50 font-bold dark:border-sidebar-accent dark:from-brand-green-darker/30 dark:via-purple-950/30 dark:to-brand-green-darker/30">
                <td className="px-4 sm:px-8 py-5" colSpan={4}>
                  <span className="text-base text-foreground dark:text-white">
                    Grand Total:
                  </span>
                </td>
                <td className="whitespace-nowrap px-4 sm:px-8 py-5 text-right">
                  <span className="text-base text-foreground dark:text-white">
                    {formatCurrency(totals.openingBalance)}
                  </span>
                </td>
                <td className="whitespace-nowrap px-4 sm:px-8 py-5 text-right">
                  <span className="text-base font-bold text-emerald-700 dark:text-emerald-400">
                    {formatCurrency(totals.totalReceipts)}
                  </span>
                </td>
                <td className="whitespace-nowrap px-4 sm:px-8 py-5 text-right">
                  <span className="text-base font-bold text-rose-700 dark:text-rose-400">
                    {formatCurrency(totals.totalPayments)}
                  </span>
                </td>
                <td className="whitespace-nowrap px-4 sm:px-8 py-5 text-right">
                  <span className="text-base font-bold text-sidebar-accent dark:text-primary">
                    {formatCurrency(totals.closingBalance)}
                  </span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
