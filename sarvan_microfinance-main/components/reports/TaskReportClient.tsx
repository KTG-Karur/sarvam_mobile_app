'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Download, RefreshCw, ChevronLeft, ChevronRight, FileText, FileType, FileOutput } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import * as XLSX from 'xlsx-js-style';
import { cn } from '@/lib/utils';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { usePermission } from '@/app/hooks/usePermission';
import { buildReportSheet, autoSizeColumns, applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { truncateReportAmount } from '@/app/lib/utils/format-amount';
import jsPDF from 'jspdf';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { drawTaskReportReport } from '@/app/lib/reports/task-report-pdf';
import { exportToCSV, exportToWord, type WordExportOptions } from '@/app/lib/report-export-utils';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';

const PAGE_SIZE = 10;

interface TaskRow {
  employeeId: string | null;
  name: string;
  branch: string;
  // Targets
  enrollmentTarget: number;
  newMemberTarget: number;
  renewalTarget: number;
  loanDisbursementTarget: number;
  // Achievement
  enrollmentAchieved: number;
  enrollmentBalance: number;
  newMemberAchieved: number;
  renewalAchieved: number;
  loanDisbursementAchieved: number;
  // Collection
  collectionTargetPct: number;
  actualCollectionPct: number;
  collectionDifferencePct: number;
  // Operations
  numberOfCenters: number;
  activeClients: number;
  activeMembers: number;
  activeClientsWithLoan: number;
  totalDisbursementMembers: number;
  // Gold Loan
  goldLoanMembers: number;
  goldLoanAmount: number;
  goldReturn: number;
  // Portfolio
  portfolioPrincipal: number;
  portfolioInterest: number;
  // Arrears
  arrearClients: number;
  arrearPrincipal: number;
  arrearInterest: number;
  arrearMemberPct: number;
}

interface TaskReportData {
  fdo: TaskRow[];
  bm: TaskRow[];
  am: TaskRow[];
  dm: TaskRow[];
  totals: TaskRow;
}

function fmt(v: number) {
  if (v >= 10000000) return `₹${(v / 10000000).toFixed(2)}Cr`;
  if (v >= 100000) return `₹${(v / 100000).toFixed(2)}L`;
  if (v >= 1000) return `₹${(v / 1000).toFixed(1)}K`;
  return `₹${v.toFixed(0)}`;
}

function GroupHead({ children, colSpan }: { children: React.ReactNode; colSpan: number }) {
  return (
    <TableHead colSpan={colSpan} className="text-center bg-brand-green-tint dark:bg-[#014d20] font-bold text-xs border-x border-white">
      {children}
    </TableHead>
  );
}

function ReportTable({ rows, currentPage, onPageChange }: { rows: TaskRow[]; currentPage: number; onPageChange: (p: number) => void }) {
  const totalPages = Math.ceil(rows.length / PAGE_SIZE);
  const paged = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <Table className="text-xs min-w-[1600px]">
          <TableHeader>
            {/* Group headers */}
            <TableRow>
              <TableHead className="bg-brand-green-tint" colSpan={3} />
              <GroupHead colSpan={4}>Targets</GroupHead>
              <GroupHead colSpan={5}>Achievement</GroupHead>
              <GroupHead colSpan={3}>Operations</GroupHead>
              <GroupHead colSpan={3}>Gold Loan</GroupHead>
              <GroupHead colSpan={2}>Portfolio</GroupHead>
              <GroupHead colSpan={4}>Arrears</GroupHead>
            </TableRow>
            {/* Column headers */}
            <TableRow className="bg-brand-green-tint dark:bg-brand-green-darker">
              <TableHead className="font-bold sticky left-0 bg-brand-green-tint dark:bg-brand-green-darker">Emp ID</TableHead>
              <TableHead className="font-bold sticky left-16 bg-brand-green-tint dark:bg-brand-green-darker">Name</TableHead>
              <TableHead className="font-bold">Branch</TableHead>
              {/* Targets */}
              <TableHead className="font-bold text-right">Enr.</TableHead>
              <TableHead className="font-bold text-right">New Mbr</TableHead>
              <TableHead className="font-bold text-right">Renewal</TableHead>
              <TableHead className="font-bold text-right">Disbmt (₹)</TableHead>
              {/* Achievement */}
              <TableHead className="font-bold text-right">Enr. Done</TableHead>
              <TableHead className="font-bold text-right">Bal</TableHead>
              <TableHead className="font-bold text-right">New Done</TableHead>
              <TableHead className="font-bold text-right">Ren. Done</TableHead>
              <TableHead className="font-bold text-right">Disbmt Done</TableHead>
              {/* Operations */}
              <TableHead className="font-bold text-right">Centers</TableHead>
              <TableHead className="font-bold text-right">Active (Total)</TableHead>
              <TableHead className="font-bold text-right">Act.Mbr</TableHead>
              <TableHead className="font-bold text-right">Act.Cl</TableHead>
              <TableHead className="font-bold text-right">Coll%</TableHead>
              {/* Gold Loan */}
              <TableHead className="font-bold text-right">Mbrs</TableHead>
              <TableHead className="font-bold text-right">Amount</TableHead>
              <TableHead className="font-bold text-right">Returns</TableHead>
              {/* Portfolio */}
              <TableHead className="font-bold text-right">Prin. O/S</TableHead>
              <TableHead className="font-bold text-right">Int. O/S</TableHead>
              {/* Arrears */}
              <TableHead className="font-bold text-right">Clients</TableHead>
              <TableHead className="font-bold text-right">Principal</TableHead>
              <TableHead className="font-bold text-right">Interest</TableHead>
              <TableHead className="font-bold text-right">Arr%</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paged.map((row, idx) => (
              <TableRow key={idx} className="hover:bg-green-50 dark:hover:bg-brand-green-darker">
                <TableCell className="sticky left-0 bg-white dark:bg-green-950">{row.employeeId || '—'}</TableCell>
                <TableCell className="font-medium sticky left-16 bg-white dark:bg-green-950">{row.name}</TableCell>
                <TableCell>{row.branch}</TableCell>
                {/* Targets */}
                <TableCell className="text-right">{row.enrollmentTarget}</TableCell>
                <TableCell className="text-right">{row.newMemberTarget}</TableCell>
                <TableCell className="text-right">{row.renewalTarget}</TableCell>
                <TableCell className="text-right">{fmt(row.loanDisbursementTarget)}</TableCell>
                {/* Achievement */}
                <TableCell className="text-right">{row.enrollmentAchieved}</TableCell>
                <TableCell className={cn('text-right', row.enrollmentBalance > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-green-700 dark:text-green-400')}>
                  {row.enrollmentBalance}
                </TableCell>
                <TableCell className="text-right">{row.newMemberAchieved}</TableCell>
                <TableCell className="text-right">{row.renewalAchieved}</TableCell>
                <TableCell className="text-right">{fmt(row.loanDisbursementAchieved)}</TableCell>
                {/* Operations */}
                <TableCell className="text-right">{row.numberOfCenters}</TableCell>
                <TableCell className="text-right">{row.activeClients}</TableCell>
                <TableCell className="text-right">{row.activeMembers}</TableCell>
                <TableCell className="text-right">{row.activeClientsWithLoan}</TableCell>
                <TableCell className={cn('text-right font-medium', {
                  'text-green-700 dark:text-green-400': row.actualCollectionPct >= 100,
                  'text-amber-700 dark:text-amber-400': row.actualCollectionPct >= 80 && row.actualCollectionPct < 100,
                  'text-red-700 dark:text-red-400': row.actualCollectionPct < 80,
                })}>
                  {row.actualCollectionPct}%
                </TableCell>
                {/* Gold Loan */}
                <TableCell className="text-right">{row.goldLoanMembers}</TableCell>
                <TableCell className="text-right">{fmt(row.goldLoanAmount)}</TableCell>
                <TableCell className="text-right">{row.goldReturn}</TableCell>
                {/* Portfolio */}
                <TableCell className="text-right">{fmt(row.portfolioPrincipal)}</TableCell>
                <TableCell className="text-right">{fmt(row.portfolioInterest)}</TableCell>
                {/* Arrears */}
                <TableCell className="text-right">{row.arrearClients}</TableCell>
                <TableCell className="text-right">{fmt(row.arrearPrincipal)}</TableCell>
                <TableCell className="text-right">{fmt(row.arrearInterest)}</TableCell>
                <TableCell className={cn('text-right font-medium', {
                  'text-green-700 dark:text-green-400': row.arrearMemberPct < 10,
                  'text-amber-700 dark:text-amber-400': row.arrearMemberPct >= 10 && row.arrearMemberPct < 20,
                  'text-red-700 dark:text-red-400': row.arrearMemberPct >= 20,
                })}>
                  {row.arrearMemberPct.toFixed(1)}%
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-sidebar-accent">Page {currentPage} of {totalPages}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onPageChange(Math.max(1, currentPage - 1))} disabled={currentPage === 1}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))} disabled={currentPage === totalPages}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function rowToExcelObj(r: TaskRow) {
  return {
    'Employee ID': r.employeeId || '',
    'Name': r.name,
    'Branch': r.branch,
    'Enr. Target': r.enrollmentTarget,
    'New Member Target': r.newMemberTarget,
    'Renewal Target': r.renewalTarget,
    'Disbmt Target (₹)': truncateReportAmount(r.loanDisbursementTarget),
    'Enr. Achieved': r.enrollmentAchieved,
    'Enr. Balance': r.enrollmentBalance,
    'New Member Achieved': r.newMemberAchieved,
    'Renewal Achieved': r.renewalAchieved,
    'Disbmt Achieved (₹)': truncateReportAmount(r.loanDisbursementAchieved),
    'Coll. Target %': r.collectionTargetPct,
    'Actual Coll. %': r.actualCollectionPct,
    'Coll. Diff %': r.collectionDifferencePct,
    'No. Centers': r.numberOfCenters,
    'Active (Total)': r.activeClients,
    'Active Members': r.activeMembers,
    'Active Clients': r.activeClientsWithLoan,
    'Disbmt Members': r.totalDisbursementMembers,
    'Gold Loan Members': r.goldLoanMembers,
    'Gold Loan Amount (₹)': truncateReportAmount(r.goldLoanAmount),
    'Gold Returns': r.goldReturn,
    'Portfolio Principal (₹)': truncateReportAmount(r.portfolioPrincipal),
    'Portfolio Interest (₹)': truncateReportAmount(r.portfolioInterest),
    'Arrear Clients': r.arrearClients,
    'Arrear Principal (₹)': truncateReportAmount(r.arrearPrincipal),
    'Arrear Interest (₹)': truncateReportAmount(r.arrearInterest),
    'Arrear Member %': r.arrearMemberPct,
  };
}

type BranchOption = { id: string; name: string; code: string };

export function TaskReportClient() {
  const { toast } = useToast();
  const { canExportReport, getReportExportMode } = usePermission();
  const [month, setMonth] = useState<string>(String(new Date().getMonth() + 1));
  const [year, setYear] = useState<string>(String(new Date().getFullYear()));
  const [selectedBranch, setSelectedBranch] = useState<string>('all');
  const [branches, setBranches] = useState<BranchOption[]>([]);

  // Submitted snapshot — updated only when "Load Report" is clicked. Export
  // filenames/subtitles/exportParams read these, not the live draft state above.
  const [submittedMonth, setSubmittedMonth] = useState<string>(month);
  const [submittedYear, setSubmittedYear] = useState<string>(year);
  const [submittedBranch, setSubmittedBranch] = useState<string>(selectedBranch);

  const [isLoading, setIsLoading] = useState(false);
  const [data, setData] = useState<TaskReportData | null>(null);
  const [page, setPage] = useState(1);
  const [activeTab, setActiveTab] = useState<'fdo' | 'bm' | 'am' | 'dm'>('fdo');

  const activeRows: TaskRow[] = data ? data[activeTab] : [];
  const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(activeRows);

  useEffect(() => {
    setPage(1);
  }, [tableSearchQuery]);

  useEffect(() => {
    fetch('/api/branches')
      .then((r) => r.json())
      .then((d) => setBranches(Array.isArray(d) ? d : (d.data ?? [])))
      .catch(() => {});
  }, []);

  const months = [
    { label: 'January', value: '1' }, { label: 'February', value: '2' },
    { label: 'March', value: '3' }, { label: 'April', value: '4' },
    { label: 'May', value: '5' }, { label: 'June', value: '6' },
    { label: 'July', value: '7' }, { label: 'August', value: '8' },
    { label: 'September', value: '9' }, { label: 'October', value: '10' },
    { label: 'November', value: '11' }, { label: 'December', value: '12' },
  ];
  const years = Array.from({ length: 5 }, (_, i) => String(new Date().getFullYear() - 2 + i));

  // Task report has no date-range UI (month/year select only) — derive a
  // calendar-month fromDate/toDate for the export queue payload so the
  // registry fetch adapter has a date range to work with if it needs one;
  // filters.month/filters.year are also sent so it can use those directly instead.
  // Submitted-derived date range for the export queue payload — computed from the
  // submitted (not draft) month/year snapshot, so it only changes when Load Report is clicked.
  const submittedMonthNum = parseInt(submittedMonth, 10);
  const submittedYearNum = parseInt(submittedYear, 10);
  const taskReportFromDate = `${submittedYear}-${String(submittedMonthNum).padStart(2, '0')}-01`;
  const taskReportToDate = `${submittedYear}-${String(submittedMonthNum).padStart(2, '0')}-${String(new Date(submittedYearNum, submittedMonthNum, 0).getDate()).padStart(2, '0')}`;

  const handleLoadReport = async () => {
    setIsLoading(true);
    setPage(1);
    try {
      const branchParam = selectedBranch !== 'all' ? `&branchId=${selectedBranch}` : '';
      const result = await apiClient.get<TaskReportData>(`/reports/employee/task-report?month=${month}&year=${year}${branchParam}`);
      if (result.success && result.data) {
        setData(result.data);
        setSubmittedMonth(month);
        setSubmittedYear(year);
        setSubmittedBranch(selectedBranch);
        toast({ title: 'Success', description: 'Task report loaded successfully.' });
      } else {
        toast({ title: 'Error', description: result.error || 'Failed to load report.', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to load task report.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportExcel = () => {
    if (!data) return toast({ title: 'No Data', description: 'Please load a report first.', variant: 'destructive' });

    const wb = XLSX.utils.book_new();

    if (data.fdo.length > 0) {
      const wsFdo = buildReportSheet('FDO Task Report - FDO', data.fdo.map(rowToExcelObj));
      autoSizeColumns(wsFdo);
      applyExcelReportFont(wsFdo);
      XLSX.utils.book_append_sheet(wb, wsFdo, 'FDO');
    }
    if (data.bm.length > 0) {
      const wsBm = buildReportSheet('FDO Task Report - Branch Manager', data.bm.map(rowToExcelObj));
      autoSizeColumns(wsBm);
      applyExcelReportFont(wsBm);
      XLSX.utils.book_append_sheet(wb, wsBm, 'Branch Manager');
    }
    if (data.am.length > 0) {
      const wsAm = buildReportSheet('FDO Task Report - Area Manager', data.am.map(rowToExcelObj));
      autoSizeColumns(wsAm);
      applyExcelReportFont(wsAm);
      XLSX.utils.book_append_sheet(wb, wsAm, 'Area Manager');
    }
    if (data.dm.length > 0) {
      const wsDm = buildReportSheet('FDO Task Report - Division Manager', data.dm.map(rowToExcelObj));
      autoSizeColumns(wsDm);
      applyExcelReportFont(wsDm);
      XLSX.utils.book_append_sheet(wb, wsDm, 'Division Manager');
    }
    const wsSummary = buildReportSheet('FDO Task Report - Summary', [rowToExcelObj(data.totals)]);
    autoSizeColumns(wsSummary);
    applyExcelReportFont(wsSummary);
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

    XLSX.writeFile(wb, `Task_Report_${submittedMonth}_${submittedYear}.xlsx`);
    toast({ title: 'Exported', description: 'Report exported to Excel successfully.' });
  };

  // ── CSV / Word / PDF export — flattens the multi-sheet Excel data (FDO, Branch
  // Manager, Area Manager, Division Manager, Overall Summary) into one table with
  // a "Level" column, since CSV/Word/PDF don't support multiple sheets. Reuses the
  // same reusable rowToExcelObj mapping used by handleExportExcel above. ─────────

  const buildTaskReportExportRows = (): { headers: string[]; rows: (string | number)[][] } => {
    if (!data) return { headers: [], rows: [] };
    const sample = rowToExcelObj(data.totals);
    const headers = ['Level', ...Object.keys(sample)];
    const levelGroups: [string, TaskRow[]][] = [
      ['FDO', data.fdo],
      ['Branch Manager', data.bm],
      ['Area Manager', data.am],
      ['Division Manager', data.dm],
    ];
    const rows: (string | number)[][] = [];
    for (const [label, group] of levelGroups) {
      for (const r of group) {
        rows.push([label, ...Object.values(rowToExcelObj(r))]);
      }
    }
    rows.push(['Overall Summary', ...Object.values(sample)]);
    return { headers, rows };
  };

  const handleExportPDF = async () => {
    if (!data) return toast({ title: 'No Data', description: 'Please load a report first.', variant: 'destructive' });
    const { headers, rows } = buildTaskReportExportRows();
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
    const reportFont = await ensureReportFont(doc);
    await drawTaskReportReport(
      doc,
      { headers, rows },
      { subtitle: `${months.find((m) => m.value === submittedMonth)?.label} ${submittedYear}` },
      reportFont
    );
    doc.save(`Task_Report_${submittedMonth}_${submittedYear}.pdf`);
    toast({ title: 'Exported', description: 'Report exported to PDF successfully.' });
  };

  const handleExportCSV = () => {
    if (!data) return toast({ title: 'No Data', description: 'Please load a report first.', variant: 'destructive' });
    const { headers, rows } = buildTaskReportExportRows();
    exportToCSV(`Task_Report_${submittedMonth}_${submittedYear}`, `FDO TASK REPORT — ${months.find((m) => m.value === submittedMonth)?.label} ${submittedYear}`, headers, rows);
    toast({ title: 'Exported', description: 'Report exported to CSV successfully.' });
  };

  // Word-only presentation: same rows as PDF/CSV above, but the trailing "Overall
  // Summary" row is split off for distinct styling, and genuinely related metric
  // clusters (Targets, Achieved, Collection %, Active counts, Gold, Portfolio
  // Principal-Interest, Arrear) get a 2-row grouped header. `rowToExcelObj`'s field set
  // is fixed (not actually data-dependent despite the dynamic-looking headers), so this
  // 30-column grouping is safe to hardcode; at 30 columns this needs A3 landscape,
  // matching the PDF export's existing precedent.
  const buildTaskReportWordOptions = (
    rows: (string | number)[][]
  ): { bodyRows: (string | number)[][]; options: WordExportOptions } => ({
    bodyRows: rows.slice(0, -1),
    options: {
      groupHeaders: [
        { label: 'Level', span: 1 }, { label: 'Employee ID', span: 1 }, { label: 'Name', span: 1 }, { label: 'Branch', span: 1 },
        { label: 'TARGETS', span: 4 }, { label: 'ACHIEVED', span: 5 }, { label: 'COLLECTION %', span: 3 },
        { label: 'No. Centers', span: 1 }, { label: 'ACTIVE', span: 3 }, { label: 'Disbmt Members', span: 1 },
        { label: 'GOLD', span: 3 }, { label: 'PORTFOLIO', span: 2 }, { label: 'ARREAR', span: 4 },
      ],
      subHeaders: [
        'Enrollment', 'New Member', 'Renewal', 'Disbursement (₹)',
        'Enrollment', 'Balance', 'New Member', 'Renewal', 'Disbursement (₹)',
        'Target', 'Actual', 'Diff',
        'Total', 'Members', 'Clients',
        'Members', 'Amount (₹)', 'Returns',
        'Principal (₹)', 'Interest (₹)',
        'Clients', 'Principal (₹)', 'Interest (₹)', 'Member %',
      ],
      columnAlignments: ['left', 'center', 'left', 'left', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right'],
      columnWidthWeights: [7, 7, 10, 9, 7, 8, 7, 8, 7, 6, 8, 7, 8, 7, 6, 6, 6, 6, 6, 7, 7, 6, 7, 7, 7, 8, 8, 8, 7, 7],
      totalsRow: rows[rows.length - 1],
      pageSize: { widthMm: 297, heightMm: 420 },
    },
  });

  const handleExportWord = async () => {
    if (!data) return toast({ title: 'No Data', description: 'Please load a report first.', variant: 'destructive' });
    const { headers, rows } = buildTaskReportExportRows();
    const { bodyRows, options } = buildTaskReportWordOptions(rows);
    await exportToWord(`Task_Report_${submittedMonth}_${submittedYear}`, `FDO TASK REPORT — ${months.find((m) => m.value === submittedMonth)?.label} ${submittedYear}`, headers, bodyRows, options);
    toast({ title: 'Exported', description: 'Report exported to Word successfully.' });
  };

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">FDO Task Report</h1>
        <p className="text-sidebar-accent mt-2">Monthly performance targets and achievement tracking across all levels</p>
      </div>

      <Card>
        <CardHeader><CardTitle>Report Controls</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="text-sm font-medium">Branch</label>
              <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                <SelectTrigger><SelectValue placeholder="-- ALL BRANCHES --" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">-- ALL BRANCHES --</SelectItem>
                  {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.code} - {b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Month</label>
              <Select value={month} onValueChange={setMonth}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {months.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Year</label>
              <Select value={year} onValueChange={setYear}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {years.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2 items-end">
              <Button onClick={handleLoadReport} disabled={isLoading} className="flex-1">
                {isLoading && <RefreshCw className="h-4 w-4 mr-2 animate-spin" />}
                Load Report
              </Button>
              <ExportDropdown
                onExportPDF={data ? () => { void handleExportPDF(); } : undefined}
                onExportExcel={data ? () => { void handleExportExcel(); } : undefined}
                onExportCSV={data ? () => { void handleExportCSV(); } : undefined}
                canExport={canExportReport('task-report')}
                onExportWord={data ? () => { void handleExportWord(); } : undefined}
                reportSlug={data && getReportExportMode('task-report') === 'REQUEST_QUEUE' ? 'task-report' : undefined}
                exportParams={{
                  fromDate: taskReportFromDate,
                  toDate: taskReportToDate,
                  branchIds: submittedBranch !== 'all' ? [submittedBranch] : 'ALL',
                  filters: { month: submittedMonth, year: submittedYear },
                }}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {data && (
        <Card>
          <CardHeader>
            <ReportHeader title="FDO Task Report" />
            <CardTitle>Report Results</CardTitle>
            <CardDescription>{months.find((m) => m.value === submittedMonth)?.label} {submittedYear}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center justify-end gap-4 mb-4">
              <TableSearchInput
                value={tableSearchQuery}
                onChange={setTableSearchQuery}
                placeholder="Search employees..."
              />
            </div>
            <Tabs
              value={activeTab}
              className="w-full"
              onValueChange={(v) => { setActiveTab(v as 'fdo' | 'bm' | 'am' | 'dm'); setPage(1); }}
            >
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="fdo">FDO Level</TabsTrigger>
                <TabsTrigger value="bm">Branch Manager</TabsTrigger>
                <TabsTrigger value="am">Area Manager</TabsTrigger>
                <TabsTrigger value="dm">Division Manager</TabsTrigger>
              </TabsList>

              <TabsContent value="fdo" className="space-y-4">
                {(activeTab === 'fdo' ? searchedRows : data.fdo).length > 0
                  ? <ReportTable rows={activeTab === 'fdo' ? searchedRows : data.fdo} currentPage={page} onPageChange={setPage} />
                  : <div className="text-center py-8 text-slate-500">No FDO data available</div>}
              </TabsContent>

              <TabsContent value="bm" className="space-y-4">
                {(activeTab === 'bm' ? searchedRows : data.bm).length > 0
                  ? <ReportTable rows={activeTab === 'bm' ? searchedRows : data.bm} currentPage={page} onPageChange={setPage} />
                  : <div className="text-center py-8 text-slate-500">No Branch Manager data available</div>}
              </TabsContent>

              <TabsContent value="am" className="space-y-4">
                {(activeTab === 'am' ? searchedRows : data.am).length > 0
                  ? <ReportTable rows={activeTab === 'am' ? searchedRows : data.am} currentPage={page} onPageChange={setPage} />
                  : <div className="text-center py-8 text-slate-500">No Area Manager data available</div>}
              </TabsContent>

              <TabsContent value="dm" className="space-y-4">
                {(activeTab === 'dm' ? searchedRows : data.dm).length > 0
                  ? <ReportTable rows={activeTab === 'dm' ? searchedRows : data.dm} currentPage={page} onPageChange={setPage} />
                  : <div className="text-center py-8 text-slate-500">No Division Manager data available</div>}
              </TabsContent>
            </Tabs>

            <div className="mt-6 p-4 bg-green-50 dark:bg-brand-green-darker rounded-lg">
              <h3 className="font-bold mb-3 text-sm">Overall Summary</h3>
              <ReportTable rows={[data.totals]} currentPage={1} onPageChange={() => {}} />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
