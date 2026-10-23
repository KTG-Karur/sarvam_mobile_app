'use client';

import React, { useState, useTransition, useRef, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Calendar, RefreshCw, Download, Loader2, FileText, FileBarChart, FileSpreadsheet, FileOutput, Printer } from 'lucide-react';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { reportHtmlHeader } from '@/app/lib/reports/report-html-header';
import { exportToWord, type WordExportOptions } from '@/app/lib/report-export-utils';
import { buildReportSheet, autoSizeColumns, applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import {
    getDCRData,
    DCRRow,
    DCRFunderMeta,
    DCRResult,
} from '@/app/lib/actions/reports';
import { getCentersForDropdown, CenterOption } from '@/app/lib/actions/centers';
import { usePermission } from '@/app/hooks/usePermission';
import { useLoanAdvanceEnabled } from '@/app/hooks/useLoanAdvanceEnabled';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';
import { formatReportAmount, truncateReportAmount } from '@/app/lib/utils/format-amount';
import { DateInput } from '@/components/ui/date-input';
import { toDisplayDate, toDisplayDateTime } from '@/app/lib/date-format';

// ── helpers ───────────────────────────────────────────────────────────────────

// Truncates (not rounds) to whole rupees, matches the project-wide report-amount convention.
const fmt = formatReportAmount;

function zeroBreakdown() {
    return {
        principal: 0, interest: 0, preclosurePrincipal: 0, preclosureInterest: 0,
        writeOffCashPrincipal: 0, writeOffCashInterest: 0, writeOffGoldPrincipal: 0, writeOffGoldInterest: 0,
        totalPrincipal: 0, totalInterest: 0,
    };
}

// ── component ─────────────────────────────────────────────────────────────────

type BranchOption = { id: string; name: string; code: string };

export function DCRClient() {
    const { toast }                           = useToast();
    const { canExportReport, getReportExportMode } = usePermission();
    const { enabled: loanAdvanceEnabled } = useLoanAdvanceEnabled();
    const [reportDate, setReportDate]         = useState<string>(new Date().toISOString().split('T')[0]);
    // Submitted (applied) date snapshot — frozen until the next Show click. Filenames,
    // PDF/Word/print subtitles, on-screen labels and the Request-Queue exportParams all
    // read this (not the live reportDate draft), so editing the date input after Show has
    // no effect on export/label output until Show is clicked again.
    const [submittedReportDate, setSubmittedReportDate] = useState<string>(reportDate);
    const [selectedBranch, setSelectedBranch] = useState<string>('all');
    const [selectedCenter, setSelectedCenter] = useState<string>('all');
    const [branches, setBranches]             = useState<BranchOption[]>([]);
    const [centers, setCenters]               = useState<CenterOption[]>([]);
    const [isPending, startTransition]        = useTransition();
    const [showReport, setShowReport]         = useState(false);
    const [data, setData]                     = useState<DCRRow[]>([]);
    const [funders, setFunders]               = useState<DCRFunderMeta[]>([]);
    const reportRef                           = useRef<HTMLDivElement>(null);

    const filteredCenters = selectedBranch === 'all'
        ? centers
        : centers.filter((c) => c.branchId === selectedBranch);

    useEffect(() => {
        getCentersForDropdown().then(setCenters).catch(() => {});
        fetch('/api/branches')
            .then((r) => r.json())
            .then((d) => setBranches(Array.isArray(d) ? d : (d.data ?? [])))
            .catch(() => {});
    }, []);

    // ── fetch ─────────────────────────────────────────────────────────────────

    const fetchReport = () => {
        if (!reportDate) {
            toast({ title: 'Date required', description: 'Please select Report Date.', variant: 'destructive' });
            return;
        }

        startTransition(async () => {
            try {
                const result: DCRResult = await getDCRData(reportDate, selectedBranch, selectedCenter);
                setData(result.rows);
                setFunders(result.funders);
                setShowReport(true);
                setSubmittedReportDate(reportDate);
                toast({ title: 'Report generated', description: `Found ${result.rows.length} center record(s) for ${reportDate}.` });
            } catch (error) {
                console.error('Failed to fetch DCR report:', error);
                toast({ title: 'Error', description: 'Failed to generate report. Please try again.', variant: 'destructive' });
            }
        });
    };

    const handleReset = () => {
        setReportDate(new Date().toISOString().split('T')[0]);
        setSelectedBranch('all');
        setSelectedCenter('all');
        setShowReport(false);
        setData([]);
        setFunders([]);
        setSubmittedReportDate(new Date().toISOString().split('T')[0]);
    };

    // ── grand-total helpers ───────────────────────────────────────────────────

    const sum = (key: keyof DCRRow, source: DCRRow[] = data) => source.reduce((s, r) => s + (r[key] as number), 0);

    type DCRFunderField = 'principal' | 'interest' | 'preclosurePrincipal' | 'preclosureInterest'
        | 'writeOffCashPrincipal' | 'writeOffCashInterest' | 'writeOffGoldPrincipal' | 'writeOffGoldInterest'
        | 'totalPrincipal' | 'totalInterest';

    const sumFunderField = (funderId: string, field: DCRFunderField, source: DCRRow[] = data) =>
        source.reduce((s, r) => s + (r.funderBreakdown[funderId]?.[field] ?? 0), 0);

    // Overall (all-funders-combined) collection figures — derived from the same per-funder
    // breakdown the table renders, so they always reconcile with the funder columns 1:1
    // (unlike the old row.principal/preclosurePrincipal fields, which excluded write-offs).
    // totalPrincipal/totalInterest already fold in gold write-off cash (see getDCRData) — gold is
    // a loan-type flag, not a separate column.
    const overallPrincipal = (row: DCRRow) => Object.values(row.funderBreakdown).reduce((s, b) => s + b.totalPrincipal, 0);
    const overallInterest  = (row: DCRRow) => Object.values(row.funderBreakdown).reduce((s, b) => s + b.totalInterest, 0);

    const grandOverallPrincipal = funders.reduce((s, f) => s + sumFunderField(f.id, 'totalPrincipal'), 0);
    const grandOverallInterest  = funders.reduce((s, f) => s + sumFunderField(f.id, 'totalInterest'), 0);

    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(data);

    // ── export ────────────────────────────────────────────────────────────────

    const handleExport = () => {
        if (!showReport || data.length === 0) {
            toast({ title: 'No data', description: 'Generate the report first.', variant: 'destructive' });
            return;
        }

        const { headers, rows } = buildDCRExportRows();

        const csvRows = rows.map(row => row.map(cell =>
            typeof cell === 'string' ? `"${cell}"` : cell
        ).join(','));

        const csv = [headers.join(','), ...csvRows].join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `DCR_Report_${submittedReportDate}.csv`;
        a.click();

        toast({ title: 'Export successful', description: 'DCR exported to CSV.' });
    };

    // ── Excel / PDF / Word export (mirrors the same field mapping used by
    // handleExport above, kept separate so handleExport is left untouched) ──────

    const buildDCRExportRows = (): { headers: string[]; rows: (string | number)[][] } => {
        const headers = [
            'Center ID', 'Center Name',
            'Admin Fees', 'Doc. Charges', 'Ins. Fees',
            ...funders.flatMap(f => [`${f.name} - Principal`, `${f.name} - Interest`]),
            'Total Principal', 'Total Interest',
            ...(loanAdvanceEnabled ? ['Loan Advance'] : []), 'Total Amount',
        ];
        const rows: (string | number)[][] = searchedRows.map(r => [
            r.centerCode, r.centerName,
            truncateReportAmount(r.adminFees), truncateReportAmount(r.docCharges), truncateReportAmount(r.insFees),
            ...funders.flatMap(f => {
                const b = r.funderBreakdown[f.id] ?? zeroBreakdown();
                return [truncateReportAmount(b.totalPrincipal), truncateReportAmount(b.totalInterest)];
            }),
            truncateReportAmount(overallPrincipal(r)), truncateReportAmount(overallInterest(r)),
            ...(loanAdvanceEnabled ? [truncateReportAmount(r.savings)] : []), truncateReportAmount(r.totalAmount),
        ]);
        if (searchedRows.length > 0) {
            const filteredGrandOverallPrincipal = funders.reduce((s, f) => s + sumFunderField(f.id, 'totalPrincipal', searchedRows), 0);
            const filteredGrandOverallInterest  = funders.reduce((s, f) => s + sumFunderField(f.id, 'totalInterest', searchedRows), 0);
            rows.push([
                'Grand Total', '',
                truncateReportAmount(sum('adminFees', searchedRows)), truncateReportAmount(sum('docCharges', searchedRows)), truncateReportAmount(sum('insFees', searchedRows)),
                ...funders.flatMap(f => [
                    truncateReportAmount(sumFunderField(f.id, 'totalPrincipal', searchedRows)), truncateReportAmount(sumFunderField(f.id, 'totalInterest', searchedRows)),
                ]),
                truncateReportAmount(filteredGrandOverallPrincipal), truncateReportAmount(filteredGrandOverallInterest),
                ...(loanAdvanceEnabled ? [truncateReportAmount(sum('savings', searchedRows))] : []), truncateReportAmount(sum('totalAmount', searchedRows)),
            ]);
        }
        return { headers, rows };
    };

    const handleExportExcel = async () => {
        if (!showReport || data.length === 0) {
            toast({ title: 'No data', description: 'Generate the report first.', variant: 'destructive' });
            return;
        }
        const XLSX = await import('xlsx-js-style');
        const { headers, rows } = buildDCRExportRows();
        const excelRows = rows.map(r => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
        const ws = buildReportSheet('Daily Collection Report', excelRows);
        autoSizeColumns(ws);
        applyExcelReportFont(ws);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'DCR');
        XLSX.writeFile(wb, `DCR_Report_${submittedReportDate}.xlsx`);
        toast({ title: 'Export successful', description: 'DCR exported to Excel.' });
    };

    const handleExportPDF = async () => {
        if (!showReport || data.length === 0) {
            toast({ title: 'No data', description: 'Generate the report first.', variant: 'destructive' });
            return;
        }
        const { default: jsPDF } = await import('jspdf');
        const { ensureReportFont } = await import('@/app/lib/reports/pdf-fonts');
        const { drawDcrReport } = await import('@/app/lib/reports/dcr-pdf');
        const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
        const reportFont = await ensureReportFont(doc);
        await drawDcrReport(doc, searchedRows, funders, { subtitle: `Date: ${toDisplayDate(new Date(submittedReportDate))}` }, reportFont, undefined, loanAdvanceEnabled);
        doc.save(`DCR_Report_${submittedReportDate}.pdf`);
        toast({ title: 'Export successful', description: 'DCR exported to PDF.' });
    };

    // Word-only presentation: same rows as PDF/CSV above, but the trailing Grand Total
    // row is split off for distinct styling. This report's column count is dynamic (2
    // columns per active funder), so the grouped header — one group per funder, plus a
    // TOTALS group for the summed columns — is built from `funders` at render time
    // rather than a fixed array; page size switches to A3 once the funder columns push
    // the total past what A4 can hold, mirroring the PDF export's own A3 default.
    const buildDCRWordOptions = (
        rows: (string | number)[][]
    ): { bodyRows: (string | number)[][]; options: WordExportOptions } => {
        const funderGroups = funders.map(f => ({ label: f.name.toUpperCase(), span: 2 }));
        const funderSubHeaders = funders.flatMap(() => ['Principal', 'Interest']);
        const funderAlignments = funders.flatMap((): ('left' | 'center' | 'right')[] => ['right', 'right']);
        const funderWidths = funders.flatMap(() => [7, 7]);
        const totalColumns = 5 + funders.length * 2 + 2 + 2;

        return {
            bodyRows: rows.slice(0, -1),
            options: {
                groupHeaders: [
                    { label: 'Center ID', span: 1 }, { label: 'Center Name', span: 1 },
                    { label: 'Admin Fees', span: 1 }, { label: 'Doc. Charges', span: 1 }, { label: 'Ins. Fees', span: 1 },
                    ...funderGroups,
                    { label: 'TOTALS', span: 2 },
                    ...(loanAdvanceEnabled ? [{ label: 'Loan Advance', span: 1 }] : []), { label: 'Total Amount', span: 1 },
                ],
                subHeaders: [...funderSubHeaders, 'Principal', 'Interest'],
                columnAlignments: [
                    'center', 'left', 'right', 'right', 'right', ...funderAlignments, 'right', 'right',
                    ...(loanAdvanceEnabled ? (['right'] as const) : []), 'right',
                ],
                columnWidthWeights: [6, 10, 7, 7, 7, ...funderWidths, 7, 7, ...(loanAdvanceEnabled ? [8] : []), 9],
                totalsRow: rows[rows.length - 1],
                pageSize: totalColumns > 20 ? { widthMm: 297, heightMm: 420 } : undefined,
            },
        };
    };

    const handleExportWord = async () => {
        if (!showReport || data.length === 0) {
            toast({ title: 'No data', description: 'Generate the report first.', variant: 'destructive' });
            return;
        }
        const { headers, rows } = buildDCRExportRows();
        const { bodyRows, options } = buildDCRWordOptions(rows);
        await exportToWord(`DCR_Report_${submittedReportDate}`, 'DAILY COLLECTION REPORT', headers, bodyRows, options);
        toast({ title: 'Export successful', description: 'DCR exported to Word.' });
    };

    // ── print ─────────────────────────────────────────────────────────────────

    const handlePrint = () => {
        if (!showReport || data.length === 0) {
            toast({ title: 'No data', description: 'Generate the report first.', variant: 'destructive' });
            return;
        }

        const pw = window.open('', '_blank');
        if (!pw) {
            toast({ title: 'Popup blocked', description: 'Allow popups to print.', variant: 'destructive' });
            return;
        }

        // Build dynamic column headers — Principal/Interest already include preclosure + cash
        // and gold write-offs (see getDCRData; gold is a loan-type flag, not a separate funder
        // or column). Funder segregation is [Funder] → Principal, Interest only.
        const funderHeaders = funders.flatMap(f => [
            `<th class="tr">${f.name}<br/>Principal</th>`,
            `<th class="tr">${f.name}<br/>Interest</th>`,
        ]).join('');

        const dataRows = searchedRows.map(r => {
            const funderCells = funders.flatMap(f => {
                const b = r.funderBreakdown[f.id] ?? zeroBreakdown();
                return [
                    `<td class="tr">${fmt(b.totalPrincipal)}</td>`,
                    `<td class="tr">${fmt(b.totalInterest)}</td>`,
                ];
            }).join('');
            return `
                <tr>
                    <td>${r.centerCode}</td>
                    <td>${r.centerName}</td>
                    <td class="tr">${fmt(r.adminFees)}</td>
                    <td class="tr">${fmt(r.docCharges)}</td>
                    <td class="tr">${fmt(r.insFees)}</td>
                    ${funderCells}
                    <td class="tr">${fmt(overallPrincipal(r))}</td>
                    <td class="tr">${fmt(overallInterest(r))}</td>
                    ${loanAdvanceEnabled ? `<td class="tr">${fmt(r.savings)}</td>` : ''}
                    <td class="tr"><strong>${fmt(r.totalAmount)}</strong></td>
                </tr>`;
        }).join('');

        const grandFunderCells = funders.flatMap(f => [
            `<td class="tr"><strong>${fmt(sumFunderField(f.id, 'totalPrincipal', searchedRows))}</strong></td>`,
            `<td class="tr"><strong>${fmt(sumFunderField(f.id, 'totalInterest', searchedRows))}</strong></td>`,
        ]).join('');

        const printGrandOverallPrincipal = funders.reduce((s, f) => s + sumFunderField(f.id, 'totalPrincipal', searchedRows), 0);
        const printGrandOverallInterest  = funders.reduce((s, f) => s + sumFunderField(f.id, 'totalInterest', searchedRows), 0);

        pw.document.write(`<!DOCTYPE html>
<html><head><title>DCR - ${submittedReportDate}</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  body { font-family: Arial, sans-serif; font-size: 11px; margin: 16px; }
  h2 { text-align: center; margin: 0; }
  p  { text-align: center; margin: 4px 0 12px; color: #555; }
  table { width: auto; border-collapse: collapse; }
  th, td { border: 1px solid #ccc; padding: 4px 6px; white-space: nowrap; }
  th { background: #d4edda; font-weight: bold; }
  .tr { text-align: right; }
  .gt { background: #f0f0f0; }
  @media print { button { display: none; } }
</style></head><body>
${reportHtmlHeader('Daily Collection Report')}
<p>Date: ${toDisplayDate(new Date(submittedReportDate))}&nbsp;&nbsp;|&nbsp;&nbsp;Generated: ${toDisplayDateTime(new Date())}</p>
<div id="tableWrap" style="width: max-content;">
<table>
  <thead>
    <tr>
      <th>Center ID</th><th>Center Name</th>
      <th class="tr">Admin Fees</th><th class="tr">Doc. Charges</th><th class="tr">Ins. Fees</th>
      ${funderHeaders}
      <th class="tr">Total Principal</th><th class="tr">Total Interest</th>
      ${loanAdvanceEnabled ? '<th class="tr">Loan Advance</th>' : ''}<th class="tr">Total Amount</th>
    </tr>
  </thead>
  <tbody>
    ${dataRows}
    <tr class="gt">
      <td colspan="2"><strong>Grand Total</strong></td>
      <td class="tr"><strong>${fmt(sum('adminFees', searchedRows))}</strong></td>
      <td class="tr"><strong>${fmt(sum('docCharges', searchedRows))}</strong></td>
      <td class="tr"><strong>${fmt(sum('insFees', searchedRows))}</strong></td>
      ${grandFunderCells}
      <td class="tr"><strong>${fmt(printGrandOverallPrincipal)}</strong></td>
      <td class="tr"><strong>${fmt(printGrandOverallInterest)}</strong></td>
      ${loanAdvanceEnabled ? `<td class="tr"><strong>${fmt(sum('savings', searchedRows))}</strong></td>` : ''}
      <td class="tr"><strong>${fmt(sum('totalAmount', searchedRows))}</strong></td>
    </tr>
  </tbody>
</table>
</div>
<script>
window.onload = function () {
  var wrap = document.getElementById('tableWrap');
  var availablePx = 1030;
  if (wrap && wrap.scrollWidth > availablePx) {
    wrap.style.zoom = (availablePx / wrap.scrollWidth);
  }
  window.print();
  setTimeout(function(){window.close();},1200);
};
</script>
</body></html>`);
        pw.document.close();

        toast({ title: 'Print initiated', description: 'Print dialog opened.' });
    };

    // ── number of fixed left columns (Center ID + Center Name + fees × 3) ────
    const fixedCols = 5; // Center ID, Center Name, Admin, Doc, Ins

    // ── render ────────────────────────────────────────────────────────────────

    return (
        <div className="space-y-6">
            {/* Filter Section */}
            <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                <CardHeader>
                    <CardTitle className="text-lg">Report Parameters</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-8 gap-6">
                        {/* Date */}
                        <div className="space-y-2">
                            <Label htmlFor="reportDate" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                Report Date
                            </Label>
                            <div className="relative">
                                <DateInput
                                    id="reportDate"
                                    value={reportDate}
                                    onChange={(e) => setReportDate(e.target.value)}
                                    className="h-11 pl-10"
                                    disabled={isPending}
                                />
                                <Calendar className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 pointer-events-none" />
                            </div>
                        </div>

                        {/* Branch */}
                        <div className="space-y-2">
                            <Label htmlFor="branchName" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                Branch
                            </Label>
                            <Select
                                value={selectedBranch}
                                onValueChange={(v) => { setSelectedBranch(v); setSelectedCenter('all'); }}
                                disabled={isPending}
                            >
                                <SelectTrigger id="branchName" className="h-11">
                                    <SelectValue placeholder="-- ALL BRANCHES --" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">-- ALL BRANCHES --</SelectItem>
                                    {branches.map((branch) => (
                                        <SelectItem key={branch.id} value={branch.id}>
                                            {branch.code} - {branch.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Center */}
                        <div className="space-y-2">
                            <Label htmlFor="centerName" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                Center
                            </Label>
                            <Select value={selectedCenter} onValueChange={setSelectedCenter} disabled={isPending}>
                                <SelectTrigger id="centerName" className="h-11">
                                    <SelectValue placeholder="-- ALL CENTERS --" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">-- ALL CENTERS --</SelectItem>
                                    {filteredCenters.map((center) => (
                                        <SelectItem key={center.id} value={center.id}>
                                            {center.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Show */}
                        <div className="space-y-2">
                            <Label className="text-sm font-semibold opacity-0">Show</Label>
                            <Button onClick={fetchReport} disabled={isPending}
                                className="h-11 w-full bg-gradient-to-r from-primary to-primary text-white shadow-lg hover:from-sidebar-accent hover:to-primary">
                                {isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading...</> : 'Show'}
                            </Button>
                        </div>

                        {/* Export */}
                        <div className="space-y-2">
                            <Label className="text-sm font-semibold opacity-0">Export</Label>
                            <ExportDropdown
                                onExportPDF={!isPending && showReport ? handleExportPDF : undefined}
                                onExportExcel={!isPending && showReport ? handleExportExcel : undefined}
                                onExportCSV={!isPending && showReport ? handleExport : undefined}
                                onExportWord={!isPending && showReport ? handleExportWord : undefined}
                                reportSlug={!isPending && showReport && getReportExportMode('dcr') === 'REQUEST_QUEUE' ? 'dcr' : undefined}
                                canExport={canExportReport('dcr')}
                                exportParams={{
                                    fromDate: submittedReportDate,
                                    branchIds: selectedBranch === 'all' ? 'ALL' : [selectedBranch],
                                    filters: selectedCenter !== 'all' ? { centerId: selectedCenter } : null,
                                }}
                                className="h-11 w-full bg-gradient-to-r from-purple-600 to-primary text-white border-purple-600 shadow-lg hover:from-purple-700 hover:to-sidebar-accent"
                            />
                        </div>

                        {/* Print */}
                        <div className="space-y-2">
                            <Label className="text-sm font-semibold opacity-0">Print</Label>
                            <Button onClick={handlePrint} disabled={isPending || !showReport} variant="outline"
                                className="h-11 w-full bg-gradient-to-r from-green-600 to-teal-600 text-white border-green-600 shadow-lg hover:from-green-700 hover:to-teal-700">
                                <Printer className="mr-2 h-4 w-4" />Print
                            </Button>
                        </div>

                        {/* Reset */}
                        <div className="space-y-2">
                            <Label className="text-sm font-semibold opacity-0">Reset</Label>
                            <Button onClick={handleReset} disabled={isPending} variant="destructive"
                                className="h-11 w-full shadow-lg">
                                <RefreshCw className="mr-2 h-4 w-4" />Reset
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Report Table */}
            {showReport && (
                <div ref={reportRef}>
                    <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                        <CardHeader className="pb-2">
                            <ReportHeader
                                title="Daily Collection Report"
                                subtitle={`Date: ${toDisplayDate(new Date(submittedReportDate))}`}
                            />
                        </CardHeader>
                        <div className="flex flex-wrap items-center gap-4 px-6 pt-4">
                            <TableSearchInput
                                value={tableSearchQuery}
                                onChange={setTableSearchQuery}
                                placeholder="Search DCR report..."
                                className="ml-auto"
                            />
                        </div>
                        <CardContent>
                            <div className="rounded-md border border-primary/20 dark:border-sidebar-accent overflow-x-auto">
                                <Table>
                                    <TableHeader className="bg-brand-green-tint dark:bg-sidebar-accent">
                                        {/* ── Row 1: group headers ───────────────────────── */}
                                        <TableRow>
                                            <TableHead rowSpan={2} className="font-bold text-sidebar-accent dark:text-slate-200 align-middle whitespace-nowrap border-r">
                                                Center ID
                                            </TableHead>
                                            <TableHead rowSpan={2} className="font-bold text-sidebar-accent dark:text-slate-200 align-middle whitespace-nowrap border-r">
                                                Center Name
                                            </TableHead>
                                            <TableHead rowSpan={2} className="font-bold text-sidebar-accent dark:text-slate-200 align-middle text-right whitespace-nowrap border-r">
                                                Admin Fees
                                            </TableHead>
                                            <TableHead rowSpan={2} className="font-bold text-sidebar-accent dark:text-slate-200 align-middle text-right whitespace-nowrap border-r">
                                                Doc. Charges
                                            </TableHead>
                                            <TableHead rowSpan={2} className="font-bold text-sidebar-accent dark:text-slate-200 align-middle text-right whitespace-nowrap border-r">
                                                Ins. Fees
                                            </TableHead>

                                            {/* Per-funder group spanning 2 sub-columns each — Principal/Interest include preclosure and
                                                both cash and gold-loan write-offs (gold is a loan-type flag, not a separate funder). */}
                                            {funders.map(f => (
                                                <TableHead key={f.id} colSpan={2}
                                                    className="font-bold text-center text-blue-700 dark:text-blue-300 whitespace-nowrap border-r bg-blue-50 dark:bg-blue-900/30">
                                                    {f.name}
                                                </TableHead>
                                            ))}

                                            {/* Overall totals — same 2-column shape as each funder group, summed across all funders */}
                                            <TableHead colSpan={2} className="font-bold text-center text-sidebar-accent dark:text-slate-200 whitespace-nowrap border-r bg-green-50 dark:bg-green-900/20">
                                                Overall Collection
                                            </TableHead>
                                            {loanAdvanceEnabled && (
                                                <TableHead rowSpan={2} className="font-bold text-sidebar-accent dark:text-slate-200 align-middle text-right whitespace-nowrap border-r">
                                                    Loan Advance
                                                </TableHead>
                                            )}
                                            <TableHead rowSpan={2} className="font-bold text-sidebar-accent dark:text-slate-200 align-middle text-right whitespace-nowrap">
                                                Total Amount
                                            </TableHead>
                                        </TableRow>

                                        {/* ── Row 2: sub-column headers ──────────────────── */}
                                        <TableRow>
                                            {funders.map(f => (
                                                <React.Fragment key={f.id}>
                                                    <TableHead className="font-semibold text-right text-blue-700 dark:text-blue-300 whitespace-nowrap bg-blue-50 dark:bg-blue-900/30">
                                                        Principal
                                                    </TableHead>
                                                    <TableHead className="font-semibold text-right text-blue-700 dark:text-blue-300 whitespace-nowrap bg-blue-50 dark:bg-blue-900/30 border-r">
                                                        Interest
                                                    </TableHead>
                                                </React.Fragment>
                                            ))}

                                            {/* Overall sub-headers */}
                                            <TableHead className="font-semibold text-right text-sidebar-accent dark:text-green-300 whitespace-nowrap bg-green-50 dark:bg-green-900/20">
                                                Principal
                                            </TableHead>
                                            <TableHead className="font-semibold text-right text-sidebar-accent dark:text-green-300 whitespace-nowrap bg-green-50 dark:bg-green-900/20 border-r">
                                                Interest
                                            </TableHead>
                                        </TableRow>
                                    </TableHeader>

                                    <TableBody>
                                        {searchedRows.length > 0 ? (
                                            <>
                                                {searchedRows.map((row) => (
                                                    <TableRow key={row.centerId} className="hover:bg-green-50 dark:hover:bg-sidebar-accent/50">
                                                        <TableCell className="font-medium border-r">{row.centerCode}</TableCell>
                                                        <TableCell className="border-r">{row.centerName}</TableCell>
                                                        <TableCell className="text-right border-r">{fmt(row.adminFees)}</TableCell>
                                                        <TableCell className="text-right border-r">{fmt(row.docCharges)}</TableCell>
                                                        <TableCell className="text-right border-r">{fmt(row.insFees)}</TableCell>

                                                        {/* Per-funder cells — Principal/Interest include preclosure, cash write-offs, and gold-loan write-offs */}
                                                        {funders.map(f => {
                                                            const b = row.funderBreakdown[f.id] ?? zeroBreakdown();
                                                            return (
                                                                <React.Fragment key={f.id}>
                                                                    <TableCell className="text-right">{fmt(b.totalPrincipal)}</TableCell>
                                                                    <TableCell className="text-right border-r">{fmt(b.totalInterest)}</TableCell>
                                                                </React.Fragment>
                                                            );
                                                        })}

                                                        {/* Overall totals — summed across all funders above */}
                                                        <TableCell className="text-right font-medium">{fmt(overallPrincipal(row))}</TableCell>
                                                        <TableCell className="text-right font-medium border-r">{fmt(overallInterest(row))}</TableCell>

                                                        {loanAdvanceEnabled && (
                                                            <TableCell className="text-right text-emerald-700 dark:text-emerald-400 border-r">{fmt(row.savings)}</TableCell>
                                                        )}
                                                        <TableCell className="text-right font-bold">{fmt(row.totalAmount)}</TableCell>
                                                    </TableRow>
                                                ))}

                                                {/* Grand Total row */}
                                                <TableRow className="bg-green-50 dark:bg-sidebar-accent/40 font-bold">
                                                    <TableCell colSpan={2} className="font-bold border-r">Grand Total</TableCell>
                                                    <TableCell className="text-right border-r">{fmt(sum('adminFees'))}</TableCell>
                                                    <TableCell className="text-right border-r">{fmt(sum('docCharges'))}</TableCell>
                                                    <TableCell className="text-right border-r">{fmt(sum('insFees'))}</TableCell>

                                                    {funders.map(f => (
                                                        <React.Fragment key={f.id}>
                                                            <TableCell className="text-right">{fmt(sumFunderField(f.id, 'totalPrincipal'))}</TableCell>
                                                            <TableCell className="text-right border-r">{fmt(sumFunderField(f.id, 'totalInterest'))}</TableCell>
                                                        </React.Fragment>
                                                    ))}

                                                    <TableCell className="text-right">{fmt(grandOverallPrincipal)}</TableCell>
                                                    <TableCell className="text-right border-r">{fmt(grandOverallInterest)}</TableCell>
                                                    {loanAdvanceEnabled && (
                                                        <TableCell className="text-right text-emerald-700 dark:text-emerald-400 border-r">{fmt(sum('savings'))}</TableCell>
                                                    )}
                                                    <TableCell className="text-right">{fmt(sum('totalAmount'))}</TableCell>
                                                </TableRow>
                                            </>
                                        ) : (
                                            <TableRow>
                                                <TableCell
                                                    colSpan={fixedCols + funders.length * 2 + 2 + (loanAdvanceEnabled ? 2 : 1)}
                                                    className="h-24 text-center text-slate-500"
                                                >
                                                    No collection data found for this date.
                                                </TableCell>
                                            </TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </div>

                            {/* Legend */}
                            <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-500">
                                <span><span className="inline-block w-3 h-3 rounded bg-blue-100 border border-blue-300 mr-1" />Funder-wise Collection (Principal &amp; Interest include Preclosure and all loan closures/write-offs, cash and gold alike)</span>
                                <span><span className="inline-block w-3 h-3 rounded bg-green-100 border border-green-300 mr-1" />Overall Totals</span>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            )}

            {!showReport && (
                <Card className="border-primary/20 bg-green-50/60 p-12 text-center dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                    <FileText className="mx-auto h-12 w-12 text-slate-400 dark:text-slate-500" />
                    <p className="mt-4 text-sm font-medium text-sidebar-accent dark:text-slate-400">
                        Select a date and click Show to generate the funder-wise Daily Collection Report
                    </p>
                </Card>
            )}
        </div>
    );
}
