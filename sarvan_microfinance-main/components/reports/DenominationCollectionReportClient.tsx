'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import type { UserRole } from '@/app/types';
import { Download, FileDown, FileType, Loader2, RefreshCw, RotateCcw, BarChart3, Coins, Building2 } from 'lucide-react';
import { jsPDF } from 'jspdf';
import * as XLSX from 'xlsx';
import { useReactToPrint } from 'react-to-print';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { drawDenominationCollectionReport } from '@/app/lib/reports/denomination-collection-pdf';
import { reportHeaderRows, autoSizeColumns, normalizeWorkbookNumbers } from '@/app/lib/reports/excel-report-header';
import { exportToWord, type WordExportOptions } from '@/app/lib/report-export-utils';
import { usePermission } from '@/app/hooks/usePermission';
import { DateInput } from '@/components/ui/date-input';
import { toDisplayDate } from '@/app/lib/date-format';

type BranchOption = { id: string; name: string; code: string };

type DenominationKey = '500' | '100' | '50' | '20' | '10' | 'coins';

type ReportResponse = {
  summary: {
    totalAmount: number;
    denominations: Record<DenominationKey, number>;
  };
  dailyBreakdown: Array<
    {
      date: string;
      total: number;
    } & Record<DenominationKey, number>
  >;
};

interface User {
  id: string;
  employeeId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  branchId: string;
  isActive: boolean;
  assignedBranchIds?: string[];
}

interface ActiveBranch {
  id: string;
  name: string;
  code: string;
  address: string;
}

const DENOM_COLUMNS: Array<{ key: DenominationKey; label: string }> = [
  { key: '500', label: '₹500' },
  { key: '100', label: '₹100' },
  { key: '50', label: '₹50' },
  { key: '20', label: '₹20' },
  { key: '10', label: '₹10' },
  { key: 'coins', label: 'Coins' },
];

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(
    Number.isFinite(amount) ? Math.trunc(amount) : 0
  );
}

function formatDateLabel(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return ymd;
  return toDisplayDate(d);
}

function todayYmd(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function startOfMonthYmd(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
}

function DenominationBarChart(props: { denoms: Record<DenominationKey, number> }) {
  const items = DENOM_COLUMNS.map((c) => ({ ...c, value: props.denoms[c.key] ?? 0 }));
  const max = Math.max(1, ...items.map((i) => i.value));

  return (
    <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
      <div className="h-1.5 bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500" />
      <CardHeader className="bg-gradient-to-r from-slate-50 via-amber-50/60 to-orange-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30">
            <BarChart3 className="h-5 w-5 text-amber-700 dark:text-amber-300" />
          </div>
          <div>
            <CardTitle className="text-xl">Denomination Distribution</CardTitle>
            <CardDescription>Share of collected cash by denomination</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-6">
        <div className="space-y-3">
          {items.map((i) => (
            <div key={i.key} className="grid grid-cols-12 items-center gap-3">
              <div className="col-span-3 text-sm font-semibold text-sidebar-accent dark:text-slate-300">{i.label}</div>
              <div className="col-span-7">
                <div className="h-2.5 w-full rounded-full bg-brand-green-tint/70 dark:bg-sidebar-accent">
                  <div
                    className="h-2.5 rounded-full bg-gradient-to-r from-amber-500 to-orange-500"
                    style={{ width: `${Math.round((i.value / max) * 100)}%` }}
                  />
                </div>
              </div>
              <div className="col-span-2 text-right text-sm font-bold text-foreground dark:text-white">
                ₹ {formatCurrency(i.value)}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function DenominationCollectionReportClient() {
  const { toast } = useToast();
  const { canExportReport, getReportExportMode } = usePermission();
  const printRef = useRef<HTMLDivElement>(null);

  const [user, setUser] = useState<User | null>(null);
  const [activeBranch, setActiveBranch] = useState<ActiveBranch | null>(null);
  const [fromDate, setFromDate] = useState<string>(startOfMonthYmd());
  const [toDate, setToDate] = useState<string>(todayYmd());
  const [branchId, setBranchId] = useState<string>('all');

  // Submitted snapshot — updated only when "Show" is clicked (fetchReport succeeds).
  // Export filenames/subtitles/exportParams read these, not the live draft state above.
  const [submittedFromDate, setSubmittedFromDate] = useState<string>(fromDate);
  const [submittedToDate, setSubmittedToDate] = useState<string>(toDate);
  const [submittedBranchId, setSubmittedBranchId] = useState<string>(branchId);

  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [branchesLoading, setBranchesLoading] = useState<boolean>(true);

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [hasFetched, setHasFetched] = useState<boolean>(false);
  const [data, setData] = useState<ReportResponse | null>(null);

  // Load user and active branch from localStorage
  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      try {
        const parsedUser = JSON.parse(storedUser);
        setUser(parsedUser);
      } catch (error) {
        console.error('Failed to parse user from localStorage:', error);
      }
    }

    const storedActiveBranch = localStorage.getItem('activeBranch');
    if (storedActiveBranch) {
      try {
        const parsedBranch = JSON.parse(storedActiveBranch);
        setActiveBranch(parsedBranch);
      } catch (error) {
        console.error('Failed to parse active branch from localStorage:', error);
      }
    }
  }, []);

  const role = user?.role as UserRole | undefined;
  const isAdmin = role === 'ADMIN';
  const isAreaManager = role === 'AREA_MANAGER';
  const isBranchManager = role === 'BRANCH_MANAGER';
  const canChooseBranch = isAdmin || isAreaManager;

  // Set branch filter based on user role
  useEffect(() => {
    if (user && activeBranch) {
      if (isAdmin) {
        // Admin can see all branches, default to 'all'
        setBranchId('all');
      } else if (isBranchManager) {
        // Branch Manager - only their assigned branch
        if (user.branchId) {
          setBranchId(user.branchId);
        } else if (activeBranch.id) {
          setBranchId(activeBranch.id);
        }
      } else if (isAreaManager) {
        // Area Manager - defaults to aggregating across all of their assigned
        // branches (the API resolves 'all' to their full assigned-branch set);
        // they can narrow to one via the dropdown.
        setBranchId('all');
      }
    }
  }, [user, activeBranch, isAdmin, isBranchManager, isAreaManager]);

  // Fetch branches based on user role
  useEffect(() => {
    const fetchBranches = async () => {
      if (!canChooseBranch) {
        setBranches([]);
        setBranchesLoading(false);
        return;
      }

      try {
        setBranchesLoading(true);
        const res = await fetch('/api/branches');
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || 'Failed to load branches');
        let list = (json.data || []).map((b: any) => ({ id: b.id, name: b.name, code: b.code })) as BranchOption[];
        
        // Filter branches for Area Manager to their full assigned set (not just one)
        if (isAreaManager) {
          const assignedBranchIds = user?.assignedBranchIds ?? [];
          if (assignedBranchIds.length > 0) {
            list = list.filter((b) => assignedBranchIds.includes(b.id));
          }
        }
        
        setBranches(list);
      } catch (e) {
        toast({
          title: 'Error',
          description: e instanceof Error ? e.message : 'Failed to load branch list',
          variant: 'destructive',
        });
      } finally {
        setBranchesLoading(false);
      }
    };
    fetchBranches();
  }, [canChooseBranch, isAreaManager, user, toast]);

  const fetchReport = useCallback(async () => {
    if (!fromDate || !toDate) {
      toast({
        title: 'Validation Error',
        description: 'Please select From Date and To Date',
        variant: 'destructive',
      });
      return;
    }

    // For non-admin users, ensure branch is selected
    if (!isAdmin && !branchId) {
      toast({
        title: 'Validation Error',
        description: 'Branch information is missing',
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);
    try {
      const params = new URLSearchParams({ fromDate, toDate });
      
      // For non-admin users, always send branchId (their assigned branch)
      // For admin, send only if not 'all'
      if (!isAdmin && branchId) {
        params.set('branchId', branchId);
      } else if (isAdmin && branchId && branchId !== 'all') {
        params.set('branchId', branchId);
      } else if (isAdmin && branchId === 'all') {
        params.set('branchId', 'all');
      }

      const res = await fetch(`/api/reports/denomination-collection?${params.toString()}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
      if (!json.success || !json.data) throw new Error(json.error || 'Invalid response');

      setData(json.data as ReportResponse);
      setHasFetched(true);
      setSubmittedFromDate(fromDate);
      setSubmittedToDate(toDate);
      setSubmittedBranchId(branchId);
      toast({
        title: 'Report Loaded',
        description: `Denomination collection aggregated from ${formatDateLabel(fromDate)} to ${formatDateLabel(
          toDate
        )}.`,
      });
    } catch (e) {
      setData(null);
      setHasFetched(true);
      toast({
        title: 'Error',
        description: e instanceof Error ? e.message : 'Failed to load report',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [fromDate, toDate, isAdmin, branchId, toast]);

  const handleReset = () => {
    const resetFromDate = startOfMonthYmd();
    const resetToDate = todayYmd();
    setFromDate(resetFromDate);
    setToDate(resetToDate);
    setSubmittedFromDate(resetFromDate);
    setSubmittedToDate(resetToDate);
    let resetBranchId = 'all';
    if (isAdmin) {
      resetBranchId = 'all';
    } else if (user?.branchId) {
      resetBranchId = user.branchId;
    } else if (activeBranch?.id) {
      resetBranchId = activeBranch.id;
    }
    setBranchId(resetBranchId);
    setSubmittedBranchId(resetBranchId);
    setHasFetched(false);
    setData(null);
  };

  const tableTotals = useMemo(() => {
    const denoms: Record<DenominationKey, number> = {
      '500': 0,
      '100': 0,
      '50': 0,
      '20': 0,
      '10': 0,
      coins: 0,
    };
    let total = 0;
    for (const row of data?.dailyBreakdown ?? []) {
      for (const c of DENOM_COLUMNS) denoms[c.key] += row[c.key] ?? 0;
      total += row.total ?? 0;
    }
    return { denoms, total };
  }, [data]);

  const handleExportCsv = () => {
    if (!data) {
      toast({
        title: 'No Data',
        description: 'Generate the report before exporting.',
        variant: 'destructive',
      });
      return;
    }

    const headers = ['Date', ...DENOM_COLUMNS.map((c) => c.label), 'Total'];
    const rows = data.dailyBreakdown.map((r) => [
      r.date,
      ...DENOM_COLUMNS.map((c) => String(r[c.key] ?? 0)),
      String(r.total ?? 0),
    ]);
    rows.push([
      'TOTAL',
      ...DENOM_COLUMNS.map((c) => String(tableTotals.denoms[c.key] ?? 0)),
      String(tableTotals.total),
    ]);

    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `denomination-collection-${submittedFromDate}-to-${submittedToDate}.csv`;
    link.click();
    URL.revokeObjectURL(url);

    toast({ title: 'Exported', description: 'CSV downloaded successfully.' });
  };

  const buildDenominationExportRows = (): { headers: (string | number)[]; rows: (string | number)[][] } => {
    const headers = ['Date', ...DENOM_COLUMNS.map((c) => c.label), 'Total'];
    const rows: (string | number)[][] = (data?.dailyBreakdown ?? []).map((r) => [
      formatDateLabel(r.date),
      ...DENOM_COLUMNS.map((c) => r[c.key] ?? 0),
      r.total ?? 0,
    ]);
    rows.push([
      'TOTAL',
      ...DENOM_COLUMNS.map((c) => tableTotals.denoms[c.key] ?? 0),
      tableTotals.total,
    ]);
    return { headers, rows };
  };

  const handleExportExcelReal = () => {
    if (!data) {
      toast({
        title: 'No Data',
        description: 'Generate the report before exporting.',
        variant: 'destructive',
      });
      return;
    }

    const { headers, rows } = buildDenominationExportRows();
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ...reportHeaderRows('Denomination Collection Report'),
      headers,
      ...rows,
    ]);
    autoSizeColumns(ws);
    XLSX.utils.book_append_sheet(wb, ws, 'Denomination Collection');
    normalizeWorkbookNumbers(wb);
    XLSX.writeFile(wb, `denomination-collection-${submittedFromDate}-to-${submittedToDate}.xlsx`);

    toast({ title: 'Exported', description: 'Excel file downloaded successfully.' });
  };

  // Word-only presentation: same rows as Excel/CSV above, but the trailing "TOTAL" row
  // is split off for distinct styling, and the denomination columns (derived from the
  // same DENOM_COLUMNS list used everywhere else) get a light 2-row grouped header.
  const buildDenominationWordOptions = (
    rows: (string | number)[][]
  ): { bodyRows: (string | number)[][]; options: WordExportOptions } => ({
    bodyRows: rows.slice(0, -1),
    options: {
      groupHeaders: [
        { label: 'Date', span: 1 },
        { label: 'DENOMINATIONS', span: DENOM_COLUMNS.length },
        { label: 'Total', span: 1 },
      ],
      subHeaders: DENOM_COLUMNS.map((c) => c.label),
      columnAlignments: ['center', ...DENOM_COLUMNS.map(() => 'right' as const), 'right'],
      columnWidthWeights: [10, ...DENOM_COLUMNS.map(() => 8), 9],
      totalsRow: rows[rows.length - 1],
    },
  });

  const handleExportWord = async () => {
    if (!data) {
      toast({
        title: 'No Data',
        description: 'Generate the report before exporting.',
        variant: 'destructive',
      });
      return;
    }

    const { headers, rows } = buildDenominationExportRows();
    const { bodyRows, options } = buildDenominationWordOptions(rows);
    await exportToWord(
      `denomination-collection-${submittedFromDate}-to-${submittedToDate}`,
      'DENOMINATION COLLECTION REPORT',
      headers,
      bodyRows,
      options
    );
    toast({ title: 'Exported', description: 'Word document downloaded successfully.' });
  };

  const handlePdfExport = async () => {
    if (!data) return;

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const reportFont = await ensureReportFont(doc);

    await drawDenominationCollectionReport(doc, data, { fromDate: submittedFromDate, toDate: submittedToDate }, reportFont);

    doc.save(`denomination-collection-${submittedFromDate}-to-${submittedToDate}.pdf`);
    toast({ title: 'Exported', description: 'PDF downloaded successfully.' });
  };

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: 'Denomination_Collection_Report',
  });

  const summaryDenoms = data?.summary.denominations ?? tableTotals.denoms;

  // Get display branch name for non-admin users
  const getDisplayBranchName = () => {
    if (isAdmin) return null;
    if (activeBranch) return activeBranch.name;
    if (user?.branchId) {
      const branch = branches.find(b => b.id === user.branchId);
      return branch?.name || 'Assigned Branch';
    }
    return 'Loading...';
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Filters */}
      <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
        <div className="h-1.5 bg-gradient-to-r from-primary via-primary to-purple-600" />
        <CardHeader className="bg-gradient-to-r from-slate-50 via-green-50/60 to-green-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <CardTitle className="text-xl">Denomination Collection</CardTitle>
              <CardDescription>Aggregated from EOD denomination entries (cash actually collected)</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={() => handlePrint()}
                variant="outline"
                className="h-10 border-primary/30 dark:border-sidebar-accent"
                disabled={!data}
              >
                Print
              </Button>
              <Button
                onClick={fetchReport}
                className="h-10 bg-gradient-to-r from-primary to-primary hover:from-sidebar-accent hover:to-primary text-white shadow-lg shadow-primary/30"
                disabled={isLoading || (!isAdmin && !branchId)}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Loading...
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Show
                  </>
                )}
              </Button>
              <Button
                onClick={handleReset}
                variant="outline"
                className="h-10 border-primary/30 dark:border-sidebar-accent"
                disabled={isLoading}
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                Reset
              </Button>
              <ExportDropdown
                onExportPDF={!isLoading && data ? handlePdfExport : undefined}
                onExportExcel={!isLoading && data ? handleExportExcelReal : undefined}
                onExportWord={!isLoading && data ? handleExportWord : undefined}
                reportSlug={!isLoading && data && getReportExportMode('denomination-collection') === 'REQUEST_QUEUE' ? 'denomination-collection' : undefined}
                canExport={canExportReport('denomination-collection')}
                exportParams={{
                  fromDate: submittedFromDate,
                  toDate: submittedToDate,
                  branchIds: submittedBranchId === 'all' ? 'ALL' : [submittedBranchId],
                }}
                className="h-10 border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-300"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {/* Branch Selection - Only show for ADMIN and AREA_MANAGER */}
            {canChooseBranch ? (
              <div className="space-y-2">
                <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">Branch</Label>
                <Select value={branchId} onValueChange={setBranchId} disabled={branchesLoading || isLoading}>
                  <SelectTrigger className="h-11 border-primary/30 dark:border-sidebar-accent">
                    <SelectValue placeholder={branchesLoading ? 'Loading...' : 'Select branch'} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">-- ALL BRANCHES --</SelectItem>
                    {branches.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.code} - {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              // For non-admin users, show read-only branch
              user && (
                <div className="space-y-2">
                  <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">Branch</Label>
                  <div className="h-11 px-3 py-2 rounded-md border border-primary/30 dark:border-sidebar-accent bg-green-50 dark:bg-sidebar-accent text-sidebar-accent dark:text-slate-300 flex items-center">
                    <Building2 className="h-4 w-4 mr-2 text-primary" />
                    {getDisplayBranchName()}
                  </div>
                </div>
              )
            )}
            <div className="space-y-2">
              <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                From Date <span className="text-red-500">*</span>
              </Label>
              <DateInput
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="h-11 border-primary/30 dark:border-sidebar-accent"
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                To Date <span className="text-red-500">*</span>
              </Label>
              <DateInput
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="h-11 border-primary/30 dark:border-sidebar-accent"
                disabled={isLoading}
              />
            </div>
            <div className="hidden lg:block" />
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-2 border-primary/30/50 dark:border-sidebar-accent/50 bg-gradient-to-br from-green-50 to-green-50/50 dark:from-brand-green-darker/20 dark:to-brand-green-darker/20">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-sidebar-accent dark:text-green-300">Total Collection</p>
                <p className="text-3xl font-bold text-foreground dark:text-green-100 mt-2">
                  ₹ {formatCurrency(data?.summary.totalAmount ?? 0)}
                </p>
                <p className="text-xs text-primary dark:text-primary mt-1">
                  {hasFetched ? `${(data?.dailyBreakdown.length ?? 0).toString()} day(s)` : '—'}
                </p>
              </div>
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-green-tint dark:bg-brand-green-darker/50">
                <Coins className="h-6 w-6 text-primary dark:text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>

        {DENOM_COLUMNS.slice(0, 3).map((c) => (
          <Card
            key={c.key}
            className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 bg-white/70 dark:bg-brand-green-darker/70 backdrop-blur-sm shadow-lg"
          >
            <CardContent className="pt-6">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {c.label}
              </p>
              <p className="text-2xl font-bold text-foreground dark:text-white mt-2">
                ₹ {formatCurrency(summaryDenoms[c.key] ?? 0)}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Remaining denom cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {DENOM_COLUMNS.slice(3).map((c) => (
          <Card
            key={c.key}
            className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 bg-white/70 dark:bg-brand-green-darker/70 backdrop-blur-sm shadow-lg"
          >
            <CardContent className="pt-6">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {c.label}
              </p>
              <p className="text-2xl font-bold text-foreground dark:text-white mt-2">
                ₹ {formatCurrency(summaryDenoms[c.key] ?? 0)}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Optional visualization */}
      {data && <DenominationBarChart denoms={data.summary.denominations} />}

      {/* Table + printable container */}
      <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
        <div className="h-1.5 bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600" />
        <CardHeader className="bg-gradient-to-r from-slate-50 via-emerald-50/60 to-teal-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
          <CardTitle className="text-xl">Daily Breakdown</CardTitle>
          <CardDescription>Sticky header, totals footer, right-aligned amounts</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading && (
            <div className="p-6">
              <div className="space-y-3">
                <Skeleton className="h-6 w-2/3" />
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-full" />
              </div>
            </div>
          )}

          {!isLoading && !hasFetched && (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-green-tint/80 dark:bg-brand-green-darker/30">
                <BarChart3 className="h-8 w-8 text-primary" />
              </div>
              <div className="text-center">
                <p className="text-lg font-semibold text-sidebar-accent dark:text-slate-300">
                  Select filters and click &quot;Show&quot;
                </p>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                  We aggregate EOD denomination entries within the selected date range.
                </p>
              </div>
            </div>
          )}

          {!isLoading && hasFetched && (data?.dailyBreakdown.length ?? 0) === 0 && (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-100/80 dark:bg-amber-900/30">
                <Coins className="h-8 w-8 text-amber-500" />
              </div>
              <div className="text-center">
                <p className="text-lg font-semibold text-sidebar-accent dark:text-slate-300">No data found</p>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                  No denomination entries exist for this date range.
                </p>
              </div>
            </div>
          )}

          {!isLoading && data && data.dailyBreakdown.length > 0 && (
            <div ref={printRef} className="overflow-x-auto">
              <div className="hidden print:block mb-4 px-4 pt-4">
                <ReportHeader
                  title="Denomination Collection Report"
                  subtitle={`${formatDateLabel(submittedFromDate)} → ${formatDateLabel(submittedToDate)}`}
                />
              </div>
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-gradient-to-r from-emerald-600 to-teal-600">
                    <th className="px-4 py-3 text-left font-bold text-white">Date</th>
                    {DENOM_COLUMNS.map((c) => (
                      <th key={c.key} className="px-4 py-3 text-right font-bold text-white">
                        {c.label}
                      </th>
                    ))}
                    <th className="px-4 py-3 text-right font-bold text-white">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-sidebar-accent">
                  {data.dailyBreakdown.map((row, idx) => (
                    <tr
                      key={row.date}
                      className={idx % 2 === 0 ? 'bg-white dark:bg-brand-green-darker' : 'bg-green-50/50 dark:bg-brand-green-darker/50'}
                    >
                      <td className="px-4 py-3 font-semibold text-foreground dark:text-slate-100">
                        {formatDateLabel(row.date)}
                      </td>
                      {DENOM_COLUMNS.map((c) => (
                        <td key={c.key} className="px-4 py-3 text-right font-semibold text-sidebar-accent dark:text-slate-200">
                          {formatCurrency(row[c.key] ?? 0)}
                        </td>
                      ))}
                      <td className="px-4 py-3 text-right font-bold text-emerald-700 dark:text-emerald-400">
                        {formatCurrency(row.total ?? 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-gradient-to-r from-emerald-100 to-teal-100 dark:from-emerald-950/40 dark:to-teal-950/40 border-t-2 border-emerald-300 dark:border-emerald-700">
                    <td className="px-4 py-3 font-bold text-foreground dark:text-slate-100">TOTAL</td>
                    {DENOM_COLUMNS.map((c) => (
                      <td key={c.key} className="px-4 py-3 text-right font-bold text-foreground dark:text-slate-100">
                        {formatCurrency(tableTotals.denoms[c.key] ?? 0)}
                      </td>
                    ))}
                    <td className="px-4 py-3 text-right font-extrabold text-emerald-800 dark:text-emerald-300">
                      {formatCurrency(tableTotals.total)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}