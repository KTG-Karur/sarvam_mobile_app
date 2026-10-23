'use client';

import React, { useMemo, useState } from 'react';
import * as XLSX from 'xlsx-js-style';
import { FileSpreadsheet, Loader2 } from 'lucide-react';
import { apiClient } from '@/app/lib/api-client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { DateInput } from '@/components/ui/date-input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toDisplayDate, toDisplayDateTime } from '@/app/lib/date-format';
import { buildReportSheet, autoSizeColumns, applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { cn } from '@/lib/utils';
import type { ApprovedExportRow, StageApproval } from '@/app/api/loans/approved-export/route';

type Period = 'day' | 'week' | 'month' | 'year' | 'custom';
type StageFilter = 'any' | 'bm' | 'am' | 'qc' | 'admin';
type LoanTypeFilter = 'all' | 'new' | 'renewal';
type StageKey = 'bm' | 'am' | 'qc' | 'admin';

const PERIODS: { value: Period; label: string }[] = [
  { value: 'day', label: 'Day Wise' },
  { value: 'week', label: 'Week Wise' },
  { value: 'month', label: 'Month Wise' },
  { value: 'year', label: 'Year Wise' },
  { value: 'custom', label: 'From – To' },
];

const STAGES: { key: StageKey; label: string }[] = [
  { key: 'bm', label: 'BM Approved' },
  { key: 'am', label: 'AM Approved' },
  { key: 'qc', label: 'QC Approved' },
  { key: 'admin', label: 'Admin Approved' },
];

/** YYYY-MM-DD for an instant, in Asia/Kolkata. */
function istYmd(d: Date | string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(typeof d === 'string' ? new Date(d) : d);
}

/** Calendar arithmetic on a bare YYYY-MM-DD (UTC noon avoids any DST/offset drift). */
function shiftYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** [from, to] for the period containing `ref` (weeks run Monday–Sunday). */
function periodRange(period: Exclude<Period, 'custom'>, ref: string): [string, string] {
  const [y, m] = ref.split('-').map(Number);
  if (period === 'day') return [ref, ref];
  if (period === 'week') {
    const dow = new Date(`${ref}T12:00:00Z`).getUTCDay(); // 0 = Sunday
    const monday = shiftYmd(ref, -((dow + 6) % 7));
    return [monday, shiftYmd(monday, 6)];
  }
  if (period === 'month') {
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return [`${y}-${String(m).padStart(2, '0')}-01`, `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`];
  }
  return [`${y}-01-01`, `${y}-12-31`];
}

function statusLabel(s: string) {
  return s.toLowerCase().split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function approvalCells(label: string, a: StageApproval | null) {
  return {
    [`${label} Approved By`]: a ? `${a.by}${a.employeeId ? ` (${a.employeeId})` : ''}` : '',
    [`${label} Approved Date`]: a ? toDisplayDate(a.at) : '',
    [`${label} Approved Time`]: a ? toDisplayDateTime(a.at).slice(11) : '',
  };
}

function toExcelRows(rows: ApprovedExportRow[]) {
  return rows.map((r, i) => ({
    'S.No': i + 1,
    'Loan Type': r.loanType === 'NEW' ? 'New Loan' : 'Renewal Loan',
    'Loan ID': r.loanId,
    'Member ID': r.memberId,
    'Member Name': r.memberName,
    'Mobile': r.mobile,
    'Region': r.region,
    'Division': r.division,
    'Area': r.area,
    'Branch': r.branch,
    'Branch Code': r.branchCode,
    'Center': r.center,
    'FDO': r.fdo,
    'Loan Product': r.product,
    'Loan Amount': r.amount ?? '',
    'Current Status': statusLabel(r.status),
    'Submitted On': toDisplayDateTime(r.submittedAt),
    ...approvalCells('BM', r.bm),
    ...approvalCells('AM', r.am),
    ...approvalCells('QC', r.qc),
    ...approvalCells('Admin', r.admin),
    'Other Stage Approvals': r.otherStages,
  }));
}

interface Branch { id: string; name: string; code: string }

export function ApprovedExportDialog({
  open,
  onOpenChange,
  branches,
  canFilterByBranch,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branches: Branch[];
  canFilterByBranch: boolean;
}) {
  const { toast } = useToast();
  const today = istYmd(new Date());
  const [loanType, setLoanType] = useState<LoanTypeFilter>('all');
  const [stage, setStage] = useState<StageFilter>('any');
  const [period, setPeriod] = useState<Period>('day');
  const [refDate, setRefDate] = useState(today);
  const [customFrom, setCustomFrom] = useState(today);
  const [customTo, setCustomTo] = useState(today);
  const [branchId, setBranchId] = useState('all');
  const [isExporting, setIsExporting] = useState(false);

  const [from, to] = useMemo<[string, string]>(
    () => (period === 'custom' ? [customFrom, customTo] : periodRange(period, refDate || today)),
    [period, refDate, customFrom, customTo, today]
  );

  const handleExport = async () => {
    if (!from || !to) {
      toast({ title: 'Select dates', description: 'Choose both From and To dates.', variant: 'destructive' });
      return;
    }
    if (from > to) {
      toast({ title: 'Invalid range', description: 'From date must be on or before To date.', variant: 'destructive' });
      return;
    }
    setIsExporting(true);
    try {
      const qs = new URLSearchParams({ from, to, stage, loanType });
      if (canFilterByBranch && branchId !== 'all') qs.set('branchId', branchId);
      const res = await apiClient.get<{ rows: ApprovedExportRow[]; truncated: boolean }>(`/loans/approved-export?${qs}`);
      if (!res.success || !res.data) {
        toast({ title: 'Export failed', description: res.error || 'Could not load approved records.', variant: 'destructive' });
        return;
      }
      const { rows, truncated } = res.data;
      if (rows.length === 0) {
        toast({ title: 'Nothing to export', description: 'No approvals found for the selected filters.' });
        return;
      }

      const range = from === to ? toDisplayDate(from) : `${toDisplayDate(from)} to ${toDisplayDate(to)}`;
      const typeLabel = loanType === 'all' ? 'New & Renewal Loans' : loanType === 'new' ? 'New Loans' : 'Renewal Loans';
      const wb = XLSX.utils.book_new();
      const addSheet = (sheetName: string, title: string, data: ApprovedExportRow[]) => {
        const ws = buildReportSheet(`${title} — ${typeLabel} — ${range}`, toExcelRows(data));
        autoSizeColumns(ws);
        applyExcelReportFont(ws);
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
      };

      if (stage === 'any') {
        // All stages: one combined sheet plus a separate sheet per stage
        // (members whose that-stage approval falls inside the range).
        addSheet('All Approvals', 'Approved Members', rows);
        for (const s of STAGES) {
          const inStage = rows.filter((r) => {
            const at = r[s.key]?.at;
            if (!at) return false;
            const ymd = istYmd(at);
            return ymd >= from && ymd <= to;
          });
          addSheet(s.label, s.label, inStage);
        }
      } else {
        const s = STAGES.find((x) => x.key === stage)!;
        addSheet(s.label, s.label, rows);
      }

      const stem = stage === 'any' ? 'Approved_Members' : STAGES.find((x) => x.key === stage)!.label.replace(/\s+/g, '_');
      XLSX.writeFile(wb, `${stem}_${loanType === 'all' ? 'All' : loanType === 'new' ? 'New' : 'Renewal'}_${from}_to_${to}.xlsx`);
      toast({
        title: 'Export successful',
        description: truncated
          ? `${rows.length} record(s) exported — the range was too large, so the list was cut off. Narrow the dates to get everything.`
          : `${rows.length} record(s) exported to Excel.`,
      });
      onOpenChange(false);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-teal-600" />
            Export Approved Members
          </DialogTitle>
          <DialogDescription>
            New and renewal loans with BM, AM, QC and Admin approval date, time and approver, plus Region, Division, Area and Branch.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Loan Type</Label>
              <Select value={loanType} onValueChange={(v) => setLoanType(v as LoanTypeFilter)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">New + Renewal Loans</SelectItem>
                  <SelectItem value="new">New Loans</SelectItem>
                  <SelectItem value="renewal">Renewal Loans</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Approved By</Label>
              <Select value={stage} onValueChange={(v) => setStage(v as StageFilter)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">All Stages (separate sheets)</SelectItem>
                  {STAGES.map((s) => (
                    <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {canFilterByBranch && (
            <div className="space-y-1.5">
              <Label>Branch</Label>
              <Select value={branchId} onValueChange={setBranchId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Branches</SelectItem>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name} ({b.code})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Period</Label>
            <div className="flex flex-wrap gap-1.5">
              {PERIODS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setPeriod(p.value)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                    period === p.value
                      ? 'bg-teal-600 border-teal-600 text-white'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {period === 'custom' ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>From Date</Label>
                <DateInput value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>To Date</Label>
                <DateInput value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label>
                {period === 'day' ? 'Date' : period === 'week' ? 'Any date in the week' : period === 'month' ? 'Any date in the month' : 'Any date in the year'}
              </Label>
              <DateInput value={refDate} onChange={(e) => setRefDate(e.target.value)} />
            </div>
          )}

          <p className="text-xs text-slate-500 dark:text-slate-400">
            Approvals between <span className="font-semibold">{toDisplayDate(from)}</span> and{' '}
            <span className="font-semibold">{toDisplayDate(to)}</span>
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isExporting}>Cancel</Button>
          <Button onClick={handleExport} disabled={isExporting} className="bg-teal-600 hover:bg-teal-700 text-white">
            {isExporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileSpreadsheet className="mr-2 h-4 w-4" />}
            Export Excel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
