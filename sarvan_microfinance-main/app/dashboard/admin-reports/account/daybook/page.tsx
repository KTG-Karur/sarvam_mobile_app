'use client';
import { useState, useRef, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BookOpen, FileText, FileSpreadsheet, FileType, FileOutput, Printer, Loader2 } from 'lucide-react';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { useToast } from '@/hooks/use-toast';
import { useBrandNames } from '@/app/lib/brand-context';
import { usePermission } from '@/app/hooks/usePermission';
import { branchStorage } from '@/app/lib/branch-storage';
import { DaybookResult } from '@/app/lib/actions/reports';
import jsPDF from 'jspdf';
import * as XLSX from 'xlsx-js-style';
import { format, parse, isValid } from 'date-fns';
import { DENOMINATION_UI_ROWS } from '@/components/utilities/denomination-ui-rows';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { drawDaybookReport } from '@/app/lib/reports/daybook-pdf';
import { reportHtmlHeader } from '@/app/lib/reports/report-html-header';
import { buildReportSheet, autoSizeColumns, applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { exportToCSV, exportToWord, type WordExportOptions } from '@/app/lib/report-export-utils';
import { formatReportAmount } from '@/app/lib/utils/format-amount';
import { DateInput } from '@/components/ui/date-input';
import { toDisplayDateTime } from '@/app/lib/date-format';

// ─── Formatters ───────────────────────────────────────────────────────────────
// Whole rupees, no decimals (report/export amount-format requirement).

const fmtAmt = (amount: number): string => `₹${formatReportAmount(amount)}`;

const fmtNum = (amount: number): string => formatReportAmount(amount);

/** Server sends "02 Jun 2026" → we display "02-06-2026" */
const fmtDate = (dateStr: string): string => {
  try {
    const d = parse(dateStr, 'dd/MM/yyyy', new Date());
    return format(d, 'dd/MM/yyyy');
  } catch {
    return dateStr;
  }
};

/** Guards against an empty/incomplete `<input type="date">` value (e.g. mid-edit or
 * cleared) so a stray keystroke can't crash the page with date-fns's "Invalid time value". */
const safeFmtInputDate = (dateStr: string, pattern: string): string => {
  const d = new Date(dateStr);
  return isValid(d) ? format(d, pattern) : '';
};

const voucherTypeLabel = (type: string): string => {
  const t = (type ?? '').toUpperCase();
  if (t === 'CR') return 'Cash Receipt';
  if (t === 'CP' || t === 'DR') return 'Cash Payment';
  return type;
};

// ─── Denomination helper types ────────────────────────────────────────────────
interface DenominationEntry {
  d500: number; d200: number; d100: number;
  d50: number; d20: number; d10: number; d5: number;
  d2: number; d1: number; upi: number;
  remarks?: string; updatedAt?: string;
}

// ─── Page ────────────────────────────────────────────────────────────────────
export default function DaybookPage() {
  const { toast } = useToast();
  const { companyNameFull } = useBrandNames();
  const { canExportReport, getReportExportMode } = usePermission();
  const todayStr = new Date().toISOString().split('T')[0];

  const [fromDate, setFromDate] = useState<string>(todayStr);
  const [toDate, setToDate] = useState<string>(todayStr);
  // Submitted (applied) date snapshot — frozen until the next Show click, so pagination and
  // exports keep using the last-submitted range even if fromDate/toDate above are edited
  // afterward without clicking Show again.
  const [submittedFromDate, setSubmittedFromDate] = useState<string>(fromDate);
  const [submittedToDate, setSubmittedToDate] = useState<string>(toDate);
  const [isLoading, setIsLoading] = useState(false);
  const [data, setData] = useState<DaybookResult | null>(null);
  const [hasFetched, setHasFetched] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [isExporting, setIsExporting] = useState(false);
  const PAGE_SIZE = 50;

  const [denominationEntry, setDenominationEntry] = useState<DenominationEntry | null>(null);
  const [isLoadingDenom, setIsLoadingDenom] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  const [adminUser, setAdminUser] = useState<{ id?: string; role: string; branchId?: string | null; assignedBranchIds?: string[] } | null>(null);
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [branches, setBranches] = useState<{ id: string; name: string; code: string }[]>([]);
  const [isBranchesLoading, setIsBranchesLoading] = useState(false);
  const isAdmin = adminUser?.role === 'ADMIN';
  const isAreaManager = adminUser?.role === 'AREA_MANAGER';
  // Any other role explicitly assigned more than one branch (UserBranchAssignment,
  // embedded at login as assignedBranchIds) — same rule as InlineBranchSwitcher.
  const isMultiBranchOther = !!adminUser && !isAdmin && !isAreaManager && (adminUser.assignedBranchIds?.length ?? 0) > 1;
  const canPickBranch = isAdmin || isAreaManager || isMultiBranchOther;
  // Non-admins only see the picker when they actually have a choice to make.
  const showBranchPicker = isAdmin || (canPickBranch && branches.length > 1);
  const branchParam = canPickBranch && selectedBranchId && selectedBranchId !== 'all' ? selectedBranchId : '';
  const selectedBranch = branches.find(b => b.id === selectedBranchId);

  // ── Auth init ───────────────────────────────────────────────────────────────
  useEffect(() => {
    try {
      const raw = localStorage.getItem('user');
      if (raw) setAdminUser(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);

  // Branch options: ADMIN → every branch; AREA_MANAGER → AreaManagerBranch assignments;
  // other multi-branch users → their UserBranchAssignment set. The daybook API
  // re-checks the requested branch against the same permitted set server-side.
  useEffect(() => {
    if (!canPickBranch || !adminUser) return;
    type BranchOption = { id: string; name: string; code: string };
    let cancelled = false;
    setIsBranchesLoading(true);
    (async () => {
      let list: BranchOption[] = [];
      if (isAreaManager && adminUser.id) {
        const d = await fetch(`/api/area-manager-branches?userId=${adminUser.id}`).then(r => r.json());
        list = (Array.isArray(d?.data) ? d.data : []).map((a: { branch: BranchOption }) => a.branch).filter(Boolean);
      } else {
        const d = await fetch('/api/branches').then(r => r.json());
        const all = (Array.isArray(d?.data ?? d) ? (d?.data ?? d) : []) as BranchOption[];
        list = isAdmin ? all : all.filter(b => adminUser.assignedBranchIds?.includes(b.id));
      }
      if (cancelled) return;
      setBranches(list.map(b => ({ id: b.id, name: b.name, code: b.code })));
      // Default to the session's active branch, then the home branch, then the first option.
      const preferred = [branchStorage.getActiveBranch()?.id, adminUser.branchId].find(
        id => !!id && list.some(b => b.id === id),
      );
      setSelectedBranchId(prev => prev || preferred || (isAdmin ? '' : list[0]?.id ?? ''));
    })()
      .catch(() => { /* picker stays empty; API falls back to the home branch */ })
      .finally(() => { if (!cancelled) setIsBranchesLoading(false); });
    return () => { cancelled = true; };
  }, [canPickBranch, isAdmin, isAreaManager, adminUser]);

  // ── Denomination fetch ──────────────────────────────────────────────────────
  const fetchDenominationEntry = async (date: string, branchId?: string) => {
    setIsLoadingDenom(true);
    try {
      const p = new URLSearchParams({ date });
      if (canPickBranch && branchId && branchId !== 'all') p.append('branchId', branchId);
      const res = await fetch(`/api/denomination-entry?${p}`);
      const result = await res.json();
      if (result.success && result.data?.entry) {
        const e = result.data.entry;
        setDenominationEntry({
          d500: +e.d500 || 0, d200: +e.d200 || 0,
          d100: +e.d100 || 0, d50: +e.d50 || 0, d20: +e.d20 || 0,
          d10: +e.d10 || 0, d5: +e.d5 || 0, d2: +e.d2 || 0, d1: +e.d1 || 0,
          upi: Math.max(0, +e.upi || 0),
          remarks: e.remarks, updatedAt: e.updatedAt,
        });
      } else {
        setDenominationEntry(null);
      }
    } catch {
      setDenominationEntry(null);
    } finally {
      setIsLoadingDenom(false);
    }
  };

  const calcDenomTotal = (e: DenominationEntry | null) => !e ? 0 :
    e.d500 * 500 + e.d200 * 200 + e.d100 * 100 +
    e.d50 * 50 + e.d20 * 20 + e.d10 * 10 + e.d5 * 5 + e.d2 * 2 + e.d1 + e.upi;

  // Flat continuation rows (same 7-column shape as the main table) appended after
  // Closing Balance, so CSV/Excel/Word/Print — which all share buildDaybookExportRows —
  // pick up the denomination breakdown without a separate export path each.
  const buildDenominationSectionRows = (closingBalance: number): (string | number)[][] => {
    if (!denominationEntry) return [];
    const rows: (string | number)[][] = [];
    rows.push(['', '', '', '', '', '', '']);
    rows.push(['', '', '', '', 'EOD CASH VERIFICATION', '', '']);
    DENOMINATION_UI_ROWS.forEach(denom => {
      const count = (denominationEntry[denom.key as keyof DenominationEntry] as number) || 0;
      if (count === 0) return;
      rows.push(['', '', '', '', `${denom.label} x ${count}`, fmtNum(count * denom.value), '']);
    });
    if (denominationEntry.upi > 0) {
      rows.push(['', '', '', '', `UPI / Digital x ${denominationEntry.upi}`, fmtNum(denominationEntry.upi), '']);
    }
    const denomTotal = calcDenomTotal(denominationEntry);
    rows.push(['', '', '', '', 'Denomination Total', fmtNum(denomTotal), '']);
    rows.push(['', '', '', '', 'System Balance', fmtNum(closingBalance), '']);
    rows.push(['', '', '', '', 'Difference', fmtNum(denomTotal - closingBalance), '']);
    if (denominationEntry.remarks) {
      rows.push(['', '', '', '', `Remarks: ${denominationEntry.remarks}`, '', '']);
    }
    return rows;
  };

  // ── Data fetch ──────────────────────────────────────────────────────────────
  // `dateOverride` lets handleGenerateReport pass the just-read draft dates straight through
  // on the same click — reading submittedFromDate/submittedToDate here would otherwise use
  // the pre-update (stale) state, since the setSubmitted* calls haven't re-rendered yet.
  // Callers other than handleGenerateReport (pagination, export) omit it and get the
  // last-submitted snapshot, which is the frozen-until-next-Show behavior they need.
  const fetchDaybook = async (page: number = 1, dateOverride?: { fromDate: string; toDate: string }) => {
    const effFromDate = dateOverride?.fromDate ?? submittedFromDate;
    const effToDate = dateOverride?.toDate ?? submittedToDate;
    setIsLoading(true);
    try {
      const p = new URLSearchParams({ fromDate: effFromDate, toDate: effToDate, page: page.toString(), pageSize: PAGE_SIZE.toString() });
      if (branchParam) p.set('branchId', branchParam);
      const res = await fetch(`/api/reports/daybook?${p}`);
      if (!res.ok) throw new Error('Failed to fetch daybook');
      const result = await res.json();
      setData(result);
      setTotalPages(result.totalPages || 1);
      setHasFetched(true);
      await fetchDenominationEntry(effToDate, selectedBranchId);
    } catch {
      toast({ title: 'Error', description: 'Failed to load Daybook.', variant: 'destructive' });
      setData(null);
    } finally {
      setIsLoading(false);
    }
  };

  // ── Full (unpaginated) fetch for export/print ─────────────────────────────
  const fetchAllForExport = async (): Promise<DaybookResult | null> => {
    setIsExporting(true);
    try {
      const p = new URLSearchParams({ fromDate: submittedFromDate, toDate: submittedToDate, exportAll: 'true' });
      if (branchParam) p.set('branchId', branchParam);
      const res = await fetch(`/api/reports/daybook?${p}`);
      if (!res.ok) throw new Error('Failed to fetch daybook');
      const result = await res.json();
      return result as DaybookResult;
    } catch {
      toast({ title: 'Export Error', description: 'Failed to fetch all data for export.', variant: 'destructive' });
      return null;
    } finally {
      setIsExporting(false);
    }
  };

  const sortDaybookTransactions = (txns: DaybookResult['transactions']) =>
    txns.slice().sort((a, b) => {
      try {
        const da = parse(a.date, 'dd/MM/yyyy', new Date()).getTime();
        const db = parse(b.date, 'dd/MM/yyyy', new Date()).getTime();
        if (da !== db) return da - db;
        const aR = a.credit > 0; const bR = b.credit > 0;
        if (aR && !bR) return -1;
        if (!aR && bR) return 1;
        return (a.particulars || '').localeCompare(b.particulars || '');
      } catch { return 0; }
    });

  const handleGenerateReport = () => {
    const snapshot = { fromDate, toDate };
    setSubmittedFromDate(fromDate);
    setSubmittedToDate(toDate);
    setCurrentPage(1);
    fetchDaybook(1, snapshot);
  };
  const handleReset = () => {
    setFromDate(todayStr); setToDate(todayStr);
    setSubmittedFromDate(todayStr); setSubmittedToDate(todayStr);
    setData(null);
    setHasFetched(false); setDenominationEntry(null); setCurrentPage(1);
  };
  const handlePageChange = (p: number) => { setCurrentPage(p); fetchDaybook(p); };

  // Prints the FULL filtered dataset in a dedicated window, not the on-screen
  // (paginated) DOM — window.print() on the page itself would only print the
  // currently-visible page's rows.
  const handlePrint = async () => {
    if (!data) return;
    const full = await fetchAllForExport();
    if (!full) return;
    const { headers, rows } = buildDaybookExportRows(full);

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast({ title: 'Popup blocked', description: 'Please allow popups to print the report.', variant: 'destructive' });
      return;
    }

    const tableRows = rows.map((r) => `<tr>${r.map((c, i) =>
      `<td style="border:1px solid #888;padding:4px 6px;text-align:${i >= 5 ? 'right' : i === 4 ? 'left' : 'center'};">${c}</td>`
    ).join('')}</tr>`).join('');

    printWindow.document.write(`<!DOCTYPE html><html><head><title>Daybook_${submittedFromDate}_${submittedToDate}</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 16px; font-size: 12px; }
        table { width: 100%; border-collapse: collapse; margin-top: 8px; }
        th, td { border: 1px solid #888; padding: 6px; }
        th { background: #1e1e1e; color: #fff; }
        @media print { @page { margin: 8mm; size: landscape; } }
      </style></head><body>
      ${reportHtmlHeader('DAYBOOK REPORT')}
      <div style="text-align:center;font-size:12px;margin-bottom:8px;">${branchHeaderLabel ? branchHeaderLabel + ' &bull; ' : ''}${dateRangeLabel}</div>
      <table>
        <thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
      <script>window.onload = () => { window.print(); };<\/script>
      </body></html>`);
    printWindow.document.close();
  };

  // ── Derived labels ──────────────────────────────────────────────────────────
  const dateRangeLabel = submittedFromDate === submittedToDate
    ? safeFmtInputDate(submittedFromDate, 'dd/MM/yyyy')
    : `${safeFmtInputDate(submittedFromDate, 'dd/MM/yyyy')} TO ${safeFmtInputDate(submittedToDate, 'dd/MM/yyyy')}`;

  const branchHeaderLabel = selectedBranch
    ? `${selectedBranch.code} - ${selectedBranch.name.toUpperCase()}`
    : '';

  // All transactions (current page) sorted by raw date ascending
  const sortedTransactions = sortDaybookTransactions(data?.transactions ?? []);

  // Balancing totals (traditional daybook: Dr total = Cr total)
  const ob = data?.openingBalance ?? 0;
  const totalReceipts = data?.totalCredits ?? 0;   // sum of all Cash Receipt amounts
  const totalPayments = data?.totalDebits  ?? 0;   // sum of all Cash Payment amounts
  const cb = data?.closingBalance ?? 0;

  // Simple column sums — totals match exactly what the user sees in each column.
  // Do NOT embed CB into the totals; CB is shown as its own separate row below.
  //   Debit Rs. Total  = OB + all Cash Receipt amounts   (sum of every green Debit row)
  //   Credit Rs. Total = all Cash Payment amounts        (sum of every red Credit row)
  const cbNegative = cb < 0;
  const drTotal = ob + totalReceipts;   // OB row + all receipt rows visible in Debit column
  const crTotal = totalPayments;        // all payment rows visible in Credit column

  // ── PDF Export ──────────────────────────────────────────────────────────────
  const handleExportPdf = async () => {
    if (!data) return;
    const full = await fetchAllForExport();
    if (!full) return;

    const doc = new jsPDF({ orientation: 'landscape' });
    // Poppins to match the app UI (falls back to Helvetica if the TTFs aren't in public/fonts/).
    const reportFont = await ensureReportFont(doc);

    await drawDaybookReport(
      doc,
      full,
      denominationEntry,
      { fromDate: submittedFromDate, toDate: submittedToDate, subtitle: `${branchHeaderLabel ? branchHeaderLabel + '  •  ' : ''}${dateRangeLabel.toUpperCase()}` },
      reportFont
    );

    doc.save(`Daybook_${submittedFromDate}_${submittedToDate}.pdf`);
  };

  // ── Excel / CSV / Word export (mirrors the same field mapping used by
  // handleExportPdf above, kept separate so handleExportPdf is left untouched) ──

  const buildDaybookExportRows = (full: DaybookResult): { headers: string[]; rows: (string | number)[][] } => {
    const fullSorted = sortDaybookTransactions(full.transactions);
    const fullOb = full.openingBalance;
    const fullDrTotal = full.openingBalance + full.totalCredits;
    const fullCrTotal = full.totalDebits;
    const fullCb = full.closingBalance;
    const fullCbNegative = fullCb < 0;

    const headers = ['S.No', 'Date', 'Voucher Type', 'Voucher No', 'Particulars', 'Debit Rs.', 'Credit Rs.'];
    const rows: (string | number)[][] = [];
    rows.push(['', safeFmtInputDate(submittedFromDate, 'dd/MM/yyyy'), 'Opening Balance', '', '', fmtNum(fullOb), '']);

    fullSorted.forEach((tx, i) => {
      const isRcpt = tx.credit > 0;
      rows.push([
        String(i + 1),
        fmtDate(tx.date),
        voucherTypeLabel(tx.type),
        tx.refNo || '',
        (tx.particulars || '') + (tx.description ? ` - ${tx.description}` : ''),
        isRcpt ? fmtNum(tx.credit) : '',
        !isRcpt ? fmtNum(tx.debit) : '',
      ]);
    });

    rows.push(['', '', 'Total', '', '', fmtNum(fullDrTotal), fmtNum(fullCrTotal)]);
    if (fullCbNegative) {
      rows.push(['', safeFmtInputDate(submittedToDate, 'dd/MM/yyyy'), 'Closing Balance (Overdraft)', '', '', '', fmtNum(Math.abs(fullCb))]);
    } else {
      rows.push(['', safeFmtInputDate(submittedToDate, 'dd/MM/yyyy'), 'Closing Balance', '', '', fmtNum(fullCb), '']);
    }
    rows.push(...buildDenominationSectionRows(fullCb));
    return { headers, rows };
  };

  const handleExportExcel = async () => {
    if (!data) return;
    const full = await fetchAllForExport();
    if (!full) return;
    const { headers, rows } = buildDaybookExportRows(full);
    const excelRows = rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
    const ws = buildReportSheet('Daybook Report', excelRows);
    autoSizeColumns(ws);
    applyExcelReportFont(ws);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Daybook');
    XLSX.writeFile(wb, `Daybook_${submittedFromDate}_${submittedToDate}.xlsx`);
  };

  const handleExportCSV = async () => {
    if (!data) return;
    const full = await fetchAllForExport();
    if (!full) return;
    const { headers, rows } = buildDaybookExportRows(full);
    exportToCSV(`Daybook_${submittedFromDate}_${submittedToDate}`, `DAYBOOK REPORT — ${dateRangeLabel}`, headers, rows);
  };

  // Word-only presentation: same rows as Excel/CSV above. The "Total"/"Closing Balance"
  // rows sit in the middle of this report (a denomination breakdown section follows
  // them), not at the end, so there's no single trailing row to safely extract as a
  // distinct total without reordering data — just professional header/zebra/alignment
  // styling on the flat 7 columns.
  const daybookWordOptions: WordExportOptions = {
    columnAlignments: ['center', 'center', 'left', 'center', 'left', 'right', 'right'],
    columnWidthWeights: [5, 9, 10, 8, 18, 8, 8],
  };

  const handleExportWord = async () => {
    if (!data) return;
    const full = await fetchAllForExport();
    if (!full) return;
    const { headers, rows } = buildDaybookExportRows(full);
    await exportToWord(`Daybook_${submittedFromDate}_${submittedToDate}`, `DAYBOOK REPORT — ${dateRangeLabel}`, headers, rows, daybookWordOptions);
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <ProtectedRoute requiredRoles={['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER', 'FDO']}>
      <div className="relative min-h-screen bg-green-50">
        <div className="container mx-auto px-3 sm:px-6 py-4 sm:py-8">

          {/* Page Header */}
          <div className="mb-5 print:hidden">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">Daybook Report</h1>
            <p className="text-sm text-sidebar-accent mt-0.5">Cash daybook — receipts (Debit) and payments (Credit)</p>
          </div>

          {/* Filter Card */}
          <Card className="border shadow-md mb-5 print:hidden bg-white">
            <CardHeader className="bg-green-50 pb-3">
              <CardTitle className="text-base">Report Criteria</CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
                {showBranchPicker && (
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold">Branch</Label>
                    <Select value={selectedBranchId} onValueChange={setSelectedBranchId} disabled={isBranchesLoading}>
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder={isBranchesLoading ? 'Loading…' : 'Select Branch'} />
                      </SelectTrigger>
                      <SelectContent>
                        {isAdmin && <SelectItem value="all">All Branches</SelectItem>}
                        {branches.map(b => (
                          <SelectItem key={b.id} value={b.id}>{b.code} — {b.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="space-y-1">
                  <Label className="text-xs font-semibold">From Date</Label>
                  <DateInput value={fromDate} onChange={e => { if (e.target.value) setFromDate(e.target.value); }} className="h-9" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-semibold">To Date</Label>
                  <DateInput value={toDate} min={fromDate} onChange={e => { if (e.target.value) setToDate(e.target.value); }} className="h-9" />
                </div>
                <div className="flex gap-2 md:col-span-2">
                  <Button onClick={handleGenerateReport} disabled={isLoading} className="flex-1 h-9 bg-primary hover:bg-sidebar-accent text-white">
                    {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Show'}
                  </Button>
                  <Button onClick={handleReset} variant="destructive" className="h-9 px-4">Reset</Button>
                  <ExportDropdown
                    onExportPDF={hasFetched && data && !isExporting ? handleExportPdf : undefined}
                    onExportExcel={hasFetched && data && !isExporting ? handleExportExcel : undefined}
                    onExportCSV={hasFetched && data && !isExporting ? handleExportCSV : undefined}
                    onExportWord={hasFetched && data && !isExporting ? handleExportWord : undefined}
                    // Queue mode needs exactly one resolved branch (a daybook is inherently
                    // single-branch — see fetchDaybook in report-registry.ts), so only offer it
                    // once a specific branch (not "All Branches") is selected.
                    reportSlug={hasFetched && data && !isExporting && selectedBranchId && selectedBranchId !== 'all' && getReportExportMode('daybook') === 'REQUEST_QUEUE' ? 'daybook' : undefined}
                    canExport={canExportReport('daybook')}
                    exportParams={{
                      fromDate: submittedFromDate,
                      toDate: submittedToDate,
                      branchIds: selectedBranchId && selectedBranchId !== 'all' ? [selectedBranchId] : 'ALL',
                    }}
                    className="h-9 px-3 border-green-600 text-green-700 hover:bg-green-50"
                  />
                  <Button variant="outline" onClick={handlePrint} disabled={!hasFetched || isExporting} className="h-9 px-3">
                    <Printer className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Report */}
          <div className="bg-white border rounded-lg shadow min-h-[400px]">
            {!hasFetched ? (
              <div className="flex flex-col items-center justify-center h-64 text-slate-500">
                <BookOpen className="h-10 w-10 mb-3 opacity-20" />
                <p className="text-sm">Select a date range and click Show</p>
              </div>
            ) : !data ? (
              <div className="flex items-center justify-center h-40 text-slate-500 text-sm">No data found</div>
            ) : (
              <div ref={printRef} className="p-4 sm:p-8 print:p-4">

                {/* Print Header */}
                <div className="text-center mb-5">
                  <ReportHeader
                    title="DAYBOOK REPORT"
                    subtitle={`${branchHeaderLabel ? branchHeaderLabel + '  •  ' : ''}${dateRangeLabel}`}
                  />
                </div>

                {/* Main Table — 8 columns (Status removed) */}
                <div className="overflow-x-auto mb-4">
                  <table className="w-full border-collapse text-sm daybook-table">
                    <thead>
                      <tr className="bg-gray-800 text-white">
                        <th className="border border-gray-600 px-2 py-2 text-center w-10">S.No</th>
                        <th className="border border-gray-600 px-2 py-2 text-center w-28">Date</th>
                        <th className="border border-gray-600 px-2 py-2 text-center w-32">Voucher Type</th>
                        <th className="border border-gray-600 px-2 py-2 text-center w-28">Voucher No</th>
                        <th className="border border-gray-600 px-2 py-2 text-left">Particulars</th>
                        <th className="border border-gray-600 px-2 py-2 text-right w-32">Debit Rs.</th>
                        <th className="border border-gray-600 px-2 py-2 text-right w-32">Credit Rs.</th>
                        <th className="border border-gray-600 px-2 py-2 text-center w-12 print:hidden">Print</th>
                      </tr>
                    </thead>
                    <tbody>

                      {/* Opening Balance */}
                      {currentPage === 1 && (
                        <tr className="bg-amber-50 font-semibold">
                          <td className="border border-gray-300 px-2 py-2 text-center text-gray-400">—</td>
                          <td className="border border-gray-300 px-2 py-2 text-center">
                            {safeFmtInputDate(submittedFromDate, 'dd/MM/yyyy')}
                          </td>
                          <td className="border border-gray-300 px-2 py-2 text-center text-xs text-gray-600">Opening Balance</td>
                          <td className="border border-gray-300 px-2 py-2" />
                          <td className="border border-gray-300 px-2 py-2 font-bold">Opening Balance</td>
                          <td className="border border-gray-300 px-2 py-2 text-right font-bold text-green-700">
                            {fmtAmt(ob)}
                          </td>
                          <td className="border border-gray-300 px-2 py-2 text-right text-gray-300">—</td>
                          <td className="border border-gray-300 px-2 py-2 print:hidden" />
                        </tr>
                      )}

                      {/* Transactions */}
                      {sortedTransactions.length === 0 && (
                        <tr>
                          <td colSpan={8} className="text-center py-10 text-gray-500 italic text-sm">
                            No transactions found for this period.
                          </td>
                        </tr>
                      )}
                      {sortedTransactions.map((tx, idx) => {
                        const isRcpt = tx.credit > 0;
                        const sNo = (currentPage - 1) * PAGE_SIZE + idx + 1;
                        return (
                          <tr
                            key={idx}
                            className={`border-b border-gray-200 transition-colors ${isRcpt ? 'hover:bg-green-50' : 'hover:bg-red-50'}`}
                          >
                            <td className="border border-gray-300 px-2 py-2 text-center text-gray-500 text-xs font-medium">
                              {sNo}
                            </td>
                            <td className="border border-gray-300 px-2 py-2 text-center text-gray-700 text-xs whitespace-nowrap">
                              {fmtDate(tx.date)}
                            </td>
                            <td className="border border-gray-300 px-2 py-2 text-center">
                              <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${
                                isRcpt ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                              }`}>
                                {voucherTypeLabel(tx.type)}
                              </span>
                            </td>
                            <td className="border border-gray-300 px-2 py-2 text-center text-gray-500 font-mono text-xs break-all">
                              {tx.refNo || '—'}
                            </td>
                            <td className="border border-gray-300 px-2 py-2">
                              <div className="font-semibold text-gray-800 leading-snug text-sm">{tx.particulars}</div>
                              {tx.description && (
                                <div className="text-xs text-gray-500 mt-0.5 leading-snug">{tx.description}</div>
                              )}
                            </td>
                            {/* Debit Rs. = Cash Receipts (money IN) */}
                            <td className="border border-gray-300 px-2 py-2 text-right font-medium">
                              {isRcpt
                                ? <span className="text-green-700">{fmtAmt(tx.credit)}</span>
                                : <span className="text-gray-300 text-xs">—</span>}
                            </td>
                            {/* Credit Rs. = Cash Payments (money OUT) */}
                            <td className="border border-gray-300 px-2 py-2 text-right font-medium">
                              {!isRcpt
                                ? <span className="text-red-600">{fmtAmt(tx.debit)}</span>
                                : <span className="text-gray-300 text-xs">—</span>}
                            </td>
                            {/* Per-row print voucher */}
                            <td className="border border-gray-300 px-2 py-2 text-center print:hidden">
                              <button
                                onClick={() => {
                                  const w = window.open('', '_blank', 'width=600,height=360');
                                  if (!w) return;
                                  w.document.write(`<!DOCTYPE html><html><head><title>Voucher ${tx.refNo}</title>
                                    <style>body{font-family:Arial,sans-serif;padding:20px;font-size:13px}
                                    h3,h4{text-align:center;margin:4px 0}table{width:100%;border-collapse:collapse;margin-top:12px}
                                    td,th{border:1px solid #888;padding:6px 10px}
                                    .dr{color:green;font-weight:bold}.cr{color:red;font-weight:bold}</style></head><body>
                                    <h3>${companyNameFull.toUpperCase()}</h3>${branchHeaderLabel ? `<h4>${branchHeaderLabel}</h4>` : ''}
                                    <table>
                                      <tr><th>Field</th><th>Value</th></tr>
                                      <tr><td>Voucher Type</td><td>${voucherTypeLabel(tx.type)}</td></tr>
                                      <tr><td>Voucher No</td><td>${tx.refNo || '—'}</td></tr>
                                      <tr><td>Date</td><td>${fmtDate(tx.date)}</td></tr>
                                      <tr><td>Particulars</td><td>${tx.particulars}${tx.description ? '<br/><small style="color:#666">' + tx.description + '</small>' : ''}</td></tr>
                                      ${isRcpt
                                        ? `<tr><td>Debit Rs.</td><td class="dr">${fmtAmt(tx.credit)}</td></tr><tr><td>Credit Rs.</td><td>—</td></tr>`
                                        : `<tr><td>Debit Rs.</td><td>—</td></tr><tr><td>Credit Rs.</td><td class="cr">${fmtAmt(tx.debit)}</td></tr>`}
                                    </table>
                                    <script>window.onload=()=>{window.print();setTimeout(()=>window.close(),900)}<\/script>
                                    </body></html>`);
                                  w.document.close();
                                }}
                                className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors"
                                title="Print this voucher"
                              >
                                <Printer className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}

                      {/* ── Total & Closing Balance (last page only) ── */}
                      {currentPage === totalPages && (
                        <>
                          {/* Total row — both sides must equal */}
                          <tr className="font-bold bg-gray-100 border-t-2 border-gray-600">
                            <td colSpan={5} className="border border-gray-400 px-2 py-2 text-right pr-4 uppercase tracking-wide text-sm">
                              Total
                            </td>
                            <td className="border border-gray-400 px-2 py-2 text-right text-green-700">{fmtAmt(drTotal)}</td>
                            <td className="border border-gray-400 px-2 py-2 text-right text-red-600">{fmtAmt(crTotal)}</td>
                            <td className="border border-gray-400 px-2 py-2 print:hidden" />
                          </tr>

                          {/* Closing Balance row */}
                          {cbNegative ? (
                            // Negative CB (overdraft) → show on Credit side
                            <tr className="font-semibold bg-red-50">
                              <td className="border border-gray-300 px-2 py-2 text-center text-gray-400">—</td>
                              <td className="border border-gray-300 px-2 py-2 text-center text-xs">
                                {safeFmtInputDate(submittedToDate, 'dd/MM/yyyy')}
                              </td>
                              <td className="border border-gray-300 px-2 py-2 text-center text-xs text-red-600">Closing Balance</td>
                              <td className="border border-gray-300 px-2 py-2" />
                              <td className="border border-gray-300 px-2 py-2 font-bold text-red-700">
                                Closing Balance (Overdraft)
                              </td>
                              <td className="border border-gray-300 px-2 py-2 text-right text-gray-300 text-xs">—</td>
                              <td className="border border-gray-300 px-2 py-2 text-right font-bold text-red-700">
                                {fmtAmt(Math.abs(cb))}
                              </td>
                              <td className="border border-gray-300 px-2 py-2 print:hidden" />
                            </tr>
                          ) : (
                            // Normal CB → show on Debit side
                            <tr className="font-semibold bg-amber-50">
                              <td className="border border-gray-300 px-2 py-2 text-center text-gray-400">—</td>
                              <td className="border border-gray-300 px-2 py-2 text-center text-xs">
                                {safeFmtInputDate(submittedToDate, 'dd/MM/yyyy')}
                              </td>
                              <td className="border border-gray-300 px-2 py-2 text-center text-xs text-gray-600">Closing Balance</td>
                              <td className="border border-gray-300 px-2 py-2" />
                              <td className="border border-gray-300 px-2 py-2 font-bold">Closing Balance</td>
                              <td className="border border-gray-300 px-2 py-2 text-right font-bold text-green-700">
                                {fmtAmt(cb)}
                              </td>
                              <td className="border border-gray-300 px-2 py-2 text-right text-gray-300 text-xs">—</td>
                              <td className="border border-gray-300 px-2 py-2 print:hidden" />
                            </tr>
                          )}
                        </>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between border-t py-2 print:hidden mb-4">
                    <span className="text-xs text-slate-500">Page {currentPage} of {totalPages}</span>
                    <div className="flex gap-1">
                      <Button variant="outline" size="sm" onClick={() => handlePageChange(currentPage - 1)} disabled={currentPage <= 1} className="h-7 px-2 text-xs">&lt;</Button>
                      {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                        const p = totalPages > 5 && currentPage > 3 ? currentPage - 2 + i : i + 1;
                        if (p > totalPages) return null;
                        return (
                          <Button key={p} variant={p === currentPage ? 'default' : 'outline'} size="sm" onClick={() => handlePageChange(p)} className="h-7 w-7 p-0 text-xs">{p}</Button>
                        );
                      })}
                      <Button variant="outline" size="sm" onClick={() => handlePageChange(currentPage + 1)} disabled={currentPage >= totalPages} className="h-7 px-2 text-xs">&gt;</Button>
                    </div>
                  </div>
                )}

                {/* EOD Denomination Section */}
                <div className="mt-6 border-t-2 border-black pt-4">
                  <h3 className="font-bold mb-3 text-center uppercase text-sm tracking-widest">EOD Cash Verification</h3>
                  {isLoadingDenom ? (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 className="h-5 w-5 animate-spin text-primary" />
                      <span className="ml-2 text-sm">Loading…</span>
                    </div>
                  ) : denominationEntry ? (
                    <>
                      {denominationEntry.updatedAt && (
                        <p className="text-center text-xs text-gray-500 mb-2">
                          Entered on:{' '}
                          {toDisplayDateTime(new Date(denominationEntry.updatedAt))}
                        </p>
                      )}
                      <div className="max-w-sm mx-auto">
                        <table className="w-full border-collapse text-sm">
                          <thead>
                            <tr className="bg-gray-100">
                              <th className="border border-black px-3 py-1.5 text-left text-xs font-bold">Denomination</th>
                              <th className="border border-black px-3 py-1.5 text-center text-xs font-bold">Count</th>
                              <th className="border border-black px-3 py-1.5 text-right text-xs font-bold">Amount (₹)</th>
                            </tr>
                          </thead>
                          <tbody>
                            {DENOMINATION_UI_ROWS.map(denom => {
                              const count = denominationEntry[denom.key as keyof DenominationEntry] as number || 0;
                              if (count === 0) return null;
                              return (
                                <tr key={denom.key}>
                                  <td className="border border-black px-3 py-1">{denom.label} ×</td>
                                  <td className="border border-black px-3 py-1 text-center">{count.toLocaleString('en-IN')}</td>
                                  <td className="border border-black px-3 py-1 text-right">{fmtAmt(count * denom.value)}</td>
                                </tr>
                              );
                            })}
                            {denominationEntry.upi > 0 && (
                              <tr>
                                <td className="border border-black px-3 py-1">UPI / Digital × 1</td>
                                <td className="border border-black px-3 py-1 text-center">{denominationEntry.upi.toLocaleString('en-IN')}</td>
                                <td className="border border-black px-3 py-1 text-right">{fmtAmt(denominationEntry.upi)}</td>
                              </tr>
                            )}
                            <tr className="font-bold bg-gray-50">
                              <td className="border border-black px-3 py-1">Total</td>
                              <td className="border border-black px-3 py-1 text-center">—</td>
                              <td className="border border-black px-3 py-1 text-right">{fmtAmt(calcDenomTotal(denominationEntry))}</td>
                            </tr>
                            <tr>
                              <td className="border border-black px-3 py-1">System Balance</td>
                              <td className="border border-black px-3 py-1 text-center">—</td>
                              <td className="border border-black px-3 py-1 text-right">{fmtAmt(cb)}</td>
                            </tr>
                            {(() => {
                              const diff = calcDenomTotal(denominationEntry) - cb;
                              return (
                                <tr className={Math.abs(diff) < 0.01 ? 'bg-green-50' : 'bg-red-50'}>
                                  <td className="border border-black px-3 py-1 font-semibold">Difference</td>
                                  <td className="border border-black px-3 py-1 text-center">—</td>
                                  <td className="border border-black px-3 py-1 text-right font-semibold">{fmtAmt(diff)}</td>
                                </tr>
                              );
                            })()}
                            {denominationEntry.remarks && (
                              <tr>
                                <td colSpan={3} className="border border-black px-3 py-1 text-xs">
                                  <span className="font-bold">Remarks:</span> {denominationEntry.remarks}
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </>
                  ) : (
                    <div className="bg-yellow-50 border border-yellow-300 rounded p-3 text-center text-sm text-yellow-800">
                      No denomination entry found for {safeFmtInputDate(submittedToDate, 'dd/MM/yyyy')}.
                    </div>
                  )}
                </div>

              </div>
            )}
          </div>
        </div>
      </div>

      <style jsx global>{`
        @media print {
          @page { margin: 8mm; size: landscape; }
          body { background: white !important; color: black; }
          .print\\:hidden { display: none !important; }
          .daybook-table th, .daybook-table td { font-size: 9px !important; padding: 3px 5px !important; }
          .daybook-table tr { page-break-inside: avoid; }
        }
      `}</style>
    </ProtectedRoute>
  );
}
