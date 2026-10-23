'use client';

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export interface AdvanceCollectionRow {
  id: string;
  branchName: string;
  centerName: string;
  memberName: string;
  loanId: string;
  dueAmount: number;
  collAmount: number;
  toBeCollected: number;
  dueDate: string;
  paidDate: string;
  status: string;
  arrear: number;
  loanOs: number;
  meetingDay: string;
  nextMeetingDate: string;
  fieldOfficer: string;
}

interface AdvanceCollectionTableProps {
  rows: AdvanceCollectionRow[];
}

export function AdvanceCollectionTable({ rows }: AdvanceCollectionTableProps) {
  if (rows.length === 0) {
    return null;
  }

  return (
    <div className="mt-6 overflow-hidden rounded-2xl border border-primary/20 bg-green-50/60 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
      <div className="max-h-[520px] overflow-auto scrollbar-thin scrollbar-track-brand-green-darker scrollbar-thumb-sidebar-accent">
        <Table className="min-w-full text-xs">
          <TableHeader className="bg-gradient-to-r from-primary via-primary to-primary text-white">
            <TableRow className="hover:bg-primary/80">
              <TableHead className="px-4 py-3 font-semibold text-white">Branch</TableHead>
              <TableHead className="px-4 py-3 font-semibold text-white">Center</TableHead>
              <TableHead className="px-4 py-3 font-semibold text-white">Member</TableHead>
              <TableHead className="px-4 py-3 font-semibold text-white">Loan ID</TableHead>
              <TableHead className="px-4 py-3 text-right font-semibold text-white">Due Amt</TableHead>
              <TableHead className="px-4 py-3 text-right font-semibold text-white">Coll Amt</TableHead>
              <TableHead className="px-4 py-3 text-right font-semibold text-white">To Be Collected</TableHead>
              <TableHead className="px-4 py-3 font-semibold text-white">Due Date</TableHead>
              <TableHead className="px-4 py-3 font-semibold text-white">Paid Date</TableHead>
              <TableHead className="px-4 py-3 font-semibold text-white">Status</TableHead>
              <TableHead className="px-4 py-3 text-right font-semibold text-white">Arrear</TableHead>
              <TableHead className="px-4 py-3 text-right font-semibold text-white">Loan OS</TableHead>
              <TableHead className="px-4 py-3 font-semibold text-white">Meeting Day</TableHead>
              <TableHead className="px-4 py-3 font-semibold text-white">Next Meeting</TableHead>
              <TableHead className="px-4 py-3 font-semibold text-white">Field Officer</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="bg-white dark:bg-green-950/30">
            {rows.map((row) => (
              <TableRow
                key={row.id}
                className="bg-white odd:bg-green-50/70 hover:bg-green-50/60 transition-colors dark:bg-brand-green-darker dark:odd:bg-brand-green-darker/80 dark:hover:bg-sidebar-accent/80"
              >
                <TableCell className="px-4 py-3 text-sidebar-accent dark:text-slate-200">
                  {row.branchName}
                </TableCell>
                <TableCell className="px-4 py-3 text-sidebar-accent dark:text-slate-200">
                  {row.centerName}
                </TableCell>
                <TableCell className="px-4 py-3 text-sidebar-accent dark:text-slate-200">
                  {row.memberName}
                </TableCell>
                <TableCell className="px-4 py-3 font-semibold text-foreground dark:text-slate-100">
                  {row.loanId}
                </TableCell>
                <TableCell className="px-4 py-3 text-right font-medium text-foreground dark:text-slate-100">
                  {row.dueAmount.toLocaleString('en-IN')}
                </TableCell>
                <TableCell className="px-4 py-3 text-right font-medium text-foreground dark:text-slate-100">
                  {row.collAmount.toLocaleString('en-IN')}
                </TableCell>
                <TableCell className="px-4 py-3 text-right font-semibold text-foreground dark:text-slate-100">
                  {row.toBeCollected.toLocaleString('en-IN')}
                </TableCell>
                <TableCell className="px-4 py-3 text-sidebar-accent dark:text-slate-300">
                  {row.dueDate}
                </TableCell>
                <TableCell className="px-4 py-3 text-sidebar-accent dark:text-slate-300">
                  {row.paidDate || '-'}
                </TableCell>
                <TableCell className="px-4 py-3">
                  <span
                    className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                      row.status === 'COLLECTED'
                        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
                        : row.status === 'PENDING'
                          ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400'
                          : 'bg-green-50 text-sidebar-accent dark:bg-sidebar-accent dark:text-slate-300'
                    }`}
                  >
                    {row.status}
                  </span>
                </TableCell>
                <TableCell className="px-4 py-3 text-right font-medium text-foreground dark:text-slate-100">
                  {row.arrear.toLocaleString('en-IN')}
                </TableCell>
                <TableCell className="px-4 py-3 text-right font-medium text-foreground dark:text-slate-100">
                  {row.loanOs.toLocaleString('en-IN')}
                </TableCell>
                <TableCell className="px-4 py-3 text-sidebar-accent dark:text-slate-300">
                  {row.meetingDay}
                </TableCell>
                <TableCell className="px-4 py-3 text-sidebar-accent dark:text-slate-300">
                  {row.nextMeetingDate}
                </TableCell>
                <TableCell className="px-4 py-3 text-sidebar-accent dark:text-slate-200">
                  {row.fieldOfficer}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}


