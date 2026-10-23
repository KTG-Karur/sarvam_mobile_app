'use client';

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowRight } from 'lucide-react';

export interface InterBranchTransferRow {
  id: string;
  slNo: number;
  date: string;
  transferFrom: string;
  transferTo: string;
  amount: number;
  toAmount: number;
  narration: string;
}

interface InterBranchTransferTableProps {
  rows: InterBranchTransferRow[];
}

export function InterBranchTransferTable({ rows }: InterBranchTransferTableProps) {
  if (rows.length === 0) {
    return null;
  }

  // Calculate totals
  const totalAmount = rows.reduce((sum, row) => sum + row.amount, 0);
  const totalToAmount = rows.reduce((sum, row) => sum + row.toAmount, 0);
  const difference = totalToAmount - totalAmount;

  return (
    <div className="mt-6 overflow-hidden rounded-2xl border border-primary/20 bg-green-50/60 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
      <div className="max-h-[520px] overflow-auto scrollbar-thin scrollbar-track-brand-green-darker scrollbar-thumb-sidebar-accent">
        <Table className="min-w-full text-xs">
          <TableHeader className="bg-gradient-to-r from-primary via-primary to-primary text-white">
            <TableRow className="hover:bg-primary/80">
              <TableHead className="px-4 py-3 text-center font-semibold text-white">SL No.</TableHead>
              <TableHead className="px-4 py-3 font-semibold text-white">Date</TableHead>
              <TableHead className="px-4 py-3 font-semibold text-white">Transfer From</TableHead>
              <TableHead className="px-4 py-3 font-semibold text-white">Transfer To</TableHead>
              <TableHead className="px-4 py-3 text-right font-semibold text-white">Amount</TableHead>
              <TableHead className="px-4 py-3 text-right font-semibold text-white">To Amount</TableHead>
              <TableHead className="px-4 py-3 font-semibold text-white">Narration</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="bg-white dark:bg-green-950/30">
            {rows.map((row) => (
              <TableRow
                key={row.id}
                className="bg-white odd:bg-green-50/70 hover:bg-green-50/60 transition-colors dark:bg-brand-green-darker dark:odd:bg-brand-green-darker/80 dark:hover:bg-sidebar-accent/80"
              >
                <TableCell className="px-4 py-3 text-center text-sidebar-accent dark:text-slate-300">
                  {row.slNo}
                </TableCell>
                <TableCell className="px-4 py-3 text-sidebar-accent dark:text-slate-300">
                  {row.date}
                </TableCell>
                <TableCell className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sidebar-accent dark:text-slate-200">{row.transferFrom}</span>
                  </div>
                </TableCell>
                <TableCell className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <ArrowRight className="h-3.5 w-3.5 text-primary" />
                    <span className="text-sidebar-accent dark:text-slate-200">{row.transferTo}</span>
                  </div>
                </TableCell>
                <TableCell className="px-4 py-3 text-right font-medium text-foreground dark:text-slate-100">
                  {row.amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </TableCell>
                <TableCell className="px-4 py-3 text-right font-medium text-foreground dark:text-slate-100">
                  {row.toAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </TableCell>
                <TableCell className="px-4 py-3 text-sidebar-accent dark:text-slate-300">
                  {row.narration}
                </TableCell>
              </TableRow>
            ))}
            
            {/* Total Row */}
            <TableRow className="bg-gradient-to-r from-green-50/80 via-green-50/60 to-green-50/80 border-t-2 border-primary/30 dark:from-brand-green-darker/40 dark:via-brand-green-darker/30 dark:to-brand-green-darker/40 dark:border-sidebar-accent">
              <TableCell className="px-4 py-3 text-center font-semibold text-sidebar-accent dark:text-slate-200">
                0
              </TableCell>
              <TableCell className="px-4 py-3 font-semibold text-sidebar-accent dark:text-slate-200">
                {/* Empty */}
              </TableCell>
              <TableCell className="px-4 py-3 font-semibold text-sidebar-accent dark:text-slate-200">
                {/* Empty */}
              </TableCell>
              <TableCell className="px-4 py-3 font-semibold text-sidebar-accent dark:text-green-300">
                TOTAL
              </TableCell>
              <TableCell className="px-4 py-3 text-right font-bold text-foreground dark:text-slate-100">
                {totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </TableCell>
              <TableCell className="px-4 py-3 text-right font-bold text-foreground dark:text-slate-100">
                {totalToAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </TableCell>
              <TableCell className="px-4 py-3">
                <span className="inline-flex items-center gap-1.5 rounded-md bg-brand-green-tint px-2.5 py-1 text-xs font-semibold text-sidebar-accent dark:bg-green-950/60 dark:text-green-300">
                  DIFF = {difference.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

