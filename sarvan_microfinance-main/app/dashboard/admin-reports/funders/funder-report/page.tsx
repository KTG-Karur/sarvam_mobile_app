'use client';

import { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import {
    Landmark,
    Download,
    RefreshCw,
    Loader2,
    TrendingUp,
    TrendingDown,
    IndianRupee,
    Calendar,
    Building2,
    FileText,
    FileType,
    FileOutput,
} from 'lucide-react';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { useToast } from '@/hooks/use-toast';
import { usePermission } from '@/app/hooks/usePermission';
import { format } from 'date-fns';
import * as XLSX from 'xlsx-js-style';
import jsPDF from 'jspdf';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { drawFunderReportPdf } from '@/app/lib/reports/funder-report-pdf';
import { exportToCSV, exportToWord, type WordExportOptions } from '@/app/lib/report-export-utils';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { formatReportAmount, truncateReportAmount } from '@/app/lib/utils/format-amount';
import { DateInput } from '@/components/ui/date-input';

type FunderRow = {
    funderId: string;
    funderName: string;  // This is the ledger name (principal GL name) per legacy design
    openingBalance: number;
    debit: number;
    credit: number;
    closingBalance: number;
};

type Totals = {
    openingBalance: number;
    debit: number;
    credit: number;
    closingBalance: number;
};

const fmt = (n: number) => formatReportAmount(n);

const fmtDate = (iso: string) => {
    try { return format(new Date(iso), 'dd/MM/yyyy'); } catch { return iso; }
};

export default function FunderReportPage() {
    const { toast } = useToast();
    const { canExportReport, getReportExportMode } = usePermission();
    const today = new Date().toISOString().split('T')[0];

    const [fromDate, setFromDate] = useState(today);
    const [toDate, setToDate] = useState(today);
    // Submitted (applied) date snapshot — frozen until the next "Show Report" click.
    // Export filenames/subtitles/exportParams read this, not the live draft from/toDate,
    // so editing the date inputs alone never changes what's shown for the fetched report.
    const [submittedFromDate, setSubmittedFromDate] = useState(fromDate);
    const [submittedToDate, setSubmittedToDate] = useState(toDate);
    const [isLoading, setIsLoading] = useState(false);
    const [showReport, setShowReport] = useState(false);
    const [rows, setRows] = useState<FunderRow[]>([]);
    const [totals, setTotals] = useState<Totals | null>(null);

    const handleShow = useCallback(async () => {
        if (!fromDate || !toDate) {
            toast({ title: 'Date required', description: 'Please select both From Date and Till Date.', variant: 'destructive' });
            return;
        }
        if (new Date(fromDate) > new Date(toDate)) {
            toast({ title: 'Invalid range', description: 'From Date cannot be after Till Date.', variant: 'destructive' });
            return;
        }

        setIsLoading(true);
        setShowReport(false);
        setRows([]);
        setTotals(null);

        try {
            const res = await fetch(`/api/reports/funder-report?fromDate=${fromDate}&toDate=${toDate}`);
            const json = await res.json();

            if (!res.ok || !json.success) throw new Error(json.message || 'Failed to fetch report');

            setRows(json.data.rows);
            setTotals(json.data.totals);
            setShowReport(true);
            setSubmittedFromDate(fromDate);
            setSubmittedToDate(toDate);

            if (json.data.rows.length === 0) {
                toast({ title: 'No records', description: 'No funder ledger data found for the selected period.' });
            } else {
                toast({ title: 'Report generated', description: `${json.data.rows.length} funder ledger(s) loaded.` });
            }
        } catch (err: any) {
            toast({ title: 'Error', description: err.message || 'Failed to load report.', variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
    }, [fromDate, toDate, toast]);

    const handleReset = () => {
        setFromDate(today);
        setToDate(today);
        setShowReport(false);
        setRows([]);
        setTotals(null);
    };

    const handleExport = () => {
        if (!showReport || rows.length === 0) {
            toast({ title: 'No data', description: 'Generate the report before exporting.', variant: 'destructive' });
            return;
        }
        try {
            const headerMeta = [
                [`Funder Report`],
                [`Period: ${fmtDate(submittedFromDate)} to ${fmtDate(submittedToDate)}`],
                [],
                ['Funder Name', 'Opening Balance', 'Debit Rs.', 'Credit Rs.', 'Closing Balance'],
            ];

            const dataRows = rows.map((r) => [
                r.funderName,
                truncateReportAmount(r.openingBalance),
                truncateReportAmount(r.debit),
                truncateReportAmount(r.credit),
                truncateReportAmount(r.closingBalance),
            ]);

            const totalRow = totals
                ? ['TOTAL', truncateReportAmount(totals.openingBalance), truncateReportAmount(totals.debit), truncateReportAmount(totals.credit), truncateReportAmount(totals.closingBalance)]
                : [];

            const ws = XLSX.utils.aoa_to_sheet([...headerMeta, ...dataRows, totalRow]);
            ws['!cols'] = [{ wch: 32 }, { wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 18 }];
            applyExcelReportFont(ws);

            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Funder Report');

            const fileName = `FunderReport_${format(new Date(submittedFromDate), 'ddMMMyyyy')}_to_${format(new Date(submittedToDate), 'ddMMMyyyy')}.xlsx`;
            XLSX.writeFile(wb, fileName);
            toast({ title: 'Export successful', description: `Saved as ${fileName}` });
        } catch {
            toast({ title: 'Export failed', description: 'Could not generate Excel file.', variant: 'destructive' });
        }
    };

    // Mirrors the same field mapping used by handleExport above (kept separate so
    // handleExport is left untouched).
    const buildFunderReportExportRows = (): { headers: string[]; rows: (string | number)[][] } => {
        const headers = ['Funder Name', 'Opening Balance', 'Debit Rs.', 'Credit Rs.', 'Closing Balance'];
        const exportRows: (string | number)[][] = rows.map((r) => [
            r.funderName, truncateReportAmount(r.openingBalance), truncateReportAmount(r.debit), truncateReportAmount(r.credit), truncateReportAmount(r.closingBalance),
        ]);
        if (totals) {
            exportRows.push(['TOTAL', truncateReportAmount(totals.openingBalance), truncateReportAmount(totals.debit), truncateReportAmount(totals.credit), truncateReportAmount(totals.closingBalance)]);
        }
        return { headers, rows: exportRows };
    };

    const handleExportPDF = async () => {
        if (!showReport || rows.length === 0) {
            toast({ title: 'No data', description: 'Generate the report before exporting.', variant: 'destructive' });
            return;
        }
        const { headers, rows: exportRows } = buildFunderReportExportRows();
        const doc = new jsPDF({ orientation: 'landscape' });
        const reportFont = await ensureReportFont(doc);
        await drawFunderReportPdf(doc, headers, exportRows, { subtitle: `Period: ${fmtDate(submittedFromDate)} to ${fmtDate(submittedToDate)}` }, reportFont);
        const fileName = `FunderReport_${format(new Date(submittedFromDate), 'ddMMMyyyy')}_to_${format(new Date(submittedToDate), 'ddMMMyyyy')}.pdf`;
        doc.save(fileName);
        toast({ title: 'Export successful', description: `Saved as ${fileName}` });
    };

    const handleExportCSV = () => {
        if (!showReport || rows.length === 0) {
            toast({ title: 'No data', description: 'Generate the report before exporting.', variant: 'destructive' });
            return;
        }
        const { headers, rows: exportRows } = buildFunderReportExportRows();
        exportToCSV(
            `FunderReport_${format(new Date(submittedFromDate), 'ddMMMyyyy')}_to_${format(new Date(submittedToDate), 'ddMMMyyyy')}`,
            'FUNDER REPORT',
            headers,
            exportRows
        );
    };

    // Word-only presentation: same rows as PDF/CSV above, but the trailing "TOTAL" row
    // (when present) is split off for distinct styling. 5 flat columns — no grouping
    // needed.
    const buildFunderReportWordOptions = (
        exportRows: (string | number)[][]
    ): { bodyRows: (string | number)[][]; options: WordExportOptions } => {
        const hasTotals = exportRows.length > 0 && exportRows[exportRows.length - 1][0] === 'TOTAL';
        return {
            bodyRows: hasTotals ? exportRows.slice(0, -1) : exportRows,
            options: {
                columnAlignments: ['left', 'right', 'right', 'right', 'right'],
                columnWidthWeights: [16, 10, 9, 9, 10],
                totalsRow: hasTotals ? exportRows[exportRows.length - 1] : undefined,
            },
        };
    };

    const handleExportWord = async () => {
        if (!showReport || rows.length === 0) {
            toast({ title: 'No data', description: 'Generate the report before exporting.', variant: 'destructive' });
            return;
        }
        const { headers, rows: exportRows } = buildFunderReportExportRows();
        const { bodyRows, options } = buildFunderReportWordOptions(exportRows);
        await exportToWord(
            `FunderReport_${format(new Date(submittedFromDate), 'ddMMMyyyy')}_to_${format(new Date(submittedToDate), 'ddMMMyyyy')}`,
            'FUNDER REPORT',
            headers,
            bodyRows,
            options
        );
    };

    const netMovement = totals ? totals.closingBalance - totals.openingBalance : 0;

    return (
        <ProtectedRoute requiredPermission="FUNDER_REPORT">
            <div className="min-h-screen bg-gradient-to-br from-background via-teal-50/30 to-cyan-50/20 dark:from-background dark:via-brand-green-darker dark:to-green-950">
                <div className="mx-auto max-w-7xl px-3 sm:px-6 py-4 sm:py-8 space-y-6">

                    {/* Page Header */}
                    <div className="flex items-center gap-4">
                        <div className="flex items-center justify-center rounded-2xl bg-gradient-to-br from-teal-600 to-cyan-600 p-3 shadow-lg shadow-teal-500/25">
                            <Landmark className="h-7 w-7 text-white" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold tracking-tight text-foreground dark:text-white">
                                Funder Report
                            </h1>
                            <p className="text-sm text-slate-500 dark:text-slate-400">
                                Funder principal ledger balances — opening, debit, credit and closing for selected period
                            </p>
                        </div>
                    </div>

                    {/* Filter Card */}
                    <Card className="overflow-hidden border-none bg-white/80 shadow-xl backdrop-blur-md dark:bg-brand-green-darker/60">
                        <div className="h-1.5 w-full bg-gradient-to-r from-teal-500 via-cyan-500 to-teal-500" />
                        <CardHeader className="border-b border-slate-100/60 bg-white/50 px-6 py-4 dark:border-sidebar-accent/50 dark:bg-brand-green-darker/50">
                            <div className="flex items-center gap-3">
                                <div className="rounded-lg bg-teal-100 p-2 text-teal-600 dark:bg-teal-900/30 dark:text-teal-400">
                                    <Building2 className="h-5 w-5" />
                                </div>
                                <div>
                                    <CardTitle className="text-base font-bold text-sidebar-accent dark:text-slate-100">
                                        Report Parameters
                                    </CardTitle>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">
                                        Select date range to generate the funder report
                                    </p>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="p-6">
                            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-12 items-end">
                                <div className="space-y-2 lg:col-span-4">
                                    <Label className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                        <Calendar className="h-3 w-3" />
                                        From Date
                                    </Label>
                                    <DateInput
                                        value={fromDate}
                                        onChange={(e) => setFromDate(e.target.value)}
                                        className="h-11 border-primary/20 bg-white shadow-sm transition-all hover:bg-green-50 focus:ring-2 focus:ring-teal-500/20 dark:border-sidebar-accent dark:bg-sidebar-accent"
                                        disabled={isLoading}
                                    />
                                </div>

                                <div className="space-y-2 lg:col-span-4">
                                    <Label className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                        <Calendar className="h-3 w-3" />
                                        Till Date
                                    </Label>
                                    <DateInput
                                        value={toDate}
                                        onChange={(e) => setToDate(e.target.value)}
                                        className="h-11 border-primary/20 bg-white shadow-sm transition-all hover:bg-green-50 focus:ring-2 focus:ring-teal-500/20 dark:border-sidebar-accent dark:bg-sidebar-accent"
                                        disabled={isLoading}
                                    />
                                </div>

                                <div className="flex gap-2 lg:col-span-4">
                                    <Button
                                        onClick={handleShow}
                                        disabled={isLoading}
                                        className="h-11 flex-1 bg-gradient-to-r from-teal-600 to-cyan-600 font-semibold text-white shadow-lg shadow-teal-500/20 transition-all hover:from-teal-700 hover:to-cyan-700 active:scale-[0.98]"
                                    >
                                        {isLoading ? (
                                            <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Generating...</>
                                        ) : (
                                            <><Landmark className="mr-2 h-4 w-4" />Show Report</>
                                        )}
                                    </Button>
                                    <Button
                                        onClick={handleReset}
                                        disabled={isLoading}
                                        variant="outline"
                                        className="h-11 w-11 shrink-0 border-primary/20 bg-white p-0 text-slate-500 shadow-sm transition-all hover:bg-brand-green-tint hover:text-foreground active:scale-[0.98] dark:border-sidebar-accent dark:bg-sidebar-accent"
                                        title="Reset"
                                    >
                                        <RefreshCw className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Summary Cards */}
                    {showReport && totals && (
                        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                            <Card className="border-none bg-gradient-to-br from-primary to-sidebar-accent p-4 text-white shadow-lg">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-xs font-medium uppercase tracking-wider text-green-100">Total Funders</p>
                                        <p className="mt-1 text-3xl font-bold">{rows.length}</p>
                                    </div>
                                    <Building2 className="h-8 w-8 text-green-200" />
                                </div>
                            </Card>
                            <Card className="border-none bg-gradient-to-br from-teal-600 to-teal-700 p-4 text-white shadow-lg">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-xs font-medium uppercase tracking-wider text-teal-100">Opening Balance</p>
                                        <p className="mt-1 text-lg font-bold">₹ {fmt(totals.openingBalance)}</p>
                                    </div>
                                    <IndianRupee className="h-8 w-8 text-teal-200" />
                                </div>
                            </Card>
                            <Card className="border-none bg-gradient-to-br from-purple-600 to-purple-700 p-4 text-white shadow-lg">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-xs font-medium uppercase tracking-wider text-purple-100">Closing Balance</p>
                                        <p className="mt-1 text-lg font-bold">₹ {fmt(totals.closingBalance)}</p>
                                    </div>
                                    <Landmark className="h-8 w-8 text-purple-200" />
                                </div>
                            </Card>
                            <Card className={`border-none p-4 text-white shadow-lg ${netMovement >= 0 ? 'bg-gradient-to-br from-emerald-600 to-emerald-700' : 'bg-gradient-to-br from-rose-600 to-rose-700'}`}>
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-xs font-medium uppercase tracking-wider opacity-80">Net Movement</p>
                                        <p className="mt-1 text-lg font-bold">₹ {fmt(Math.abs(netMovement))}</p>
                                        <p className="text-xs opacity-70">{netMovement >= 0 ? 'Increase' : 'Decrease'}</p>
                                    </div>
                                    {netMovement >= 0
                                        ? <TrendingUp className="h-8 w-8 opacity-70" />
                                        : <TrendingDown className="h-8 w-8 opacity-70" />
                                    }
                                </div>
                            </Card>
                        </div>
                    )}

                    {/* Report Table */}
                    {showReport && (
                        <Card className="overflow-hidden border-none bg-white shadow-xl dark:bg-green-950">
                            <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100 bg-green-50/50 px-6 py-4 dark:border-sidebar-accent dark:bg-brand-green-darker/50">
                                <div>
                                    <CardTitle className="text-base font-bold text-sidebar-accent dark:text-slate-100">
                                        Funder Report
                                    </CardTitle>
                                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                                        Period: <span className="font-semibold text-sidebar-accent dark:text-slate-300">
                                            {fmtDate(submittedFromDate)} to {fmtDate(submittedToDate)}
                                        </span>
                                        {' · '}
                                        <span className="font-medium text-teal-600 dark:text-teal-400">{rows.length} funder(s)</span>
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <ExportDropdown
                                        onExportPDF={rows.length > 0 ? handleExportPDF : undefined}
                                        onExportExcel={rows.length > 0 ? handleExport : undefined}
                                        onExportCSV={rows.length > 0 ? handleExportCSV : undefined}
                                        onExportWord={rows.length > 0 ? handleExportWord : undefined}
                                        reportSlug={rows.length > 0 && getReportExportMode('funder-report') === 'REQUEST_QUEUE' ? 'funder-report' : undefined}
                                        canExport={canExportReport('funder-report')}
                                        exportParams={{ fromDate: submittedFromDate, toDate: submittedToDate, branchIds: 'ALL' }}
                                        className="bg-emerald-600 text-xs font-semibold text-white hover:bg-emerald-700"
                                    />
                                </div>
                            </CardHeader>
                            <CardContent className="p-0">
                                <Table className="w-full text-sm">
                                    <TableHeader>
                                        <TableRow className="border-b border-primary/20 bg-primary hover:bg-primary dark:border-sidebar-accent dark:bg-primary">
                                            <TableHead className="h-11 px-5 text-xs font-bold text-white">
                                                Funder Name
                                            </TableHead>
                                            <TableHead className="h-11 px-5 text-right text-xs font-bold text-white">
                                                Opening Balance
                                            </TableHead>
                                            <TableHead className="h-11 px-5 text-right text-xs font-bold text-white">
                                                Debit Rs.
                                            </TableHead>
                                            <TableHead className="h-11 px-5 text-right text-xs font-bold text-white">
                                                Credit Rs.
                                            </TableHead>
                                            <TableHead className="h-11 px-5 text-right text-xs font-bold text-white">
                                                Closing Balance
                                            </TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {rows.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan={5} className="py-12 text-center text-slate-400">
                                                    No funder ledger data found for the selected period.
                                                </TableCell>
                                            </TableRow>
                                        ) : (
                                            rows.map((row, idx) => (
                                                <TableRow
                                                    key={row.funderId}
                                                    className={`border-b border-slate-100 transition-colors hover:bg-teal-50/40 dark:border-sidebar-accent dark:hover:bg-brand-green-darker/60 ${idx % 2 === 0 ? 'bg-white dark:bg-green-950' : 'bg-green-50/50 dark:bg-brand-green-darker/30'}`}
                                                >
                                                    <TableCell className="px-5 py-3 font-semibold text-sidebar-accent dark:text-slate-200">
                                                        {row.funderName}
                                                    </TableCell>
                                                    <TableCell className="px-5 py-3 text-right font-semibold text-sidebar-accent dark:text-primary">
                                                        {fmt(row.openingBalance)}
                                                    </TableCell>
                                                    <TableCell className="px-5 py-3 text-right font-semibold text-rose-600 dark:text-rose-400">
                                                        {row.debit > 0 ? fmt(row.debit) : <span className="text-slate-400">0</span>}
                                                    </TableCell>
                                                    <TableCell className="px-5 py-3 text-right font-semibold text-emerald-600 dark:text-emerald-400">
                                                        {row.credit > 0 ? fmt(row.credit) : <span className="text-slate-400">0</span>}
                                                    </TableCell>
                                                    <TableCell className="px-5 py-3 text-right font-black text-foreground dark:text-white">
                                                        {fmt(row.closingBalance)}
                                                    </TableCell>
                                                </TableRow>
                                            ))
                                        )}
                                    </TableBody>
                                    {totals && rows.length > 0 && (
                                        <tfoot>
                                            <TableRow className="border-t-2 border-teal-400 bg-gradient-to-r from-teal-100 to-cyan-100 hover:from-teal-100 hover:to-cyan-100 dark:border-teal-700 dark:bg-teal-950 dark:from-teal-950 dark:to-cyan-950">
                                                <TableCell className="px-5 py-4 text-base font-black text-teal-900 dark:text-teal-100">
                                                    TOTAL
                                                </TableCell>
                                                <TableCell className="px-5 py-4 text-right text-base font-black text-sidebar-accent dark:text-green-300">
                                                    {fmt(totals.openingBalance)}
                                                </TableCell>
                                                <TableCell className="px-5 py-4 text-right text-base font-black text-rose-700 dark:text-rose-300">
                                                    {fmt(totals.debit)}
                                                </TableCell>
                                                <TableCell className="px-5 py-4 text-right text-base font-black text-emerald-700 dark:text-emerald-300">
                                                    {fmt(totals.credit)}
                                                </TableCell>
                                                <TableCell className="px-5 py-4 text-right text-base font-black text-teal-900 dark:text-teal-100">
                                                    {fmt(totals.closingBalance)}
                                                </TableCell>
                                            </TableRow>
                                        </tfoot>
                                    )}
                                </Table>
                            </CardContent>
                        </Card>
                    )}

                    {/* Empty state */}
                    {!showReport && !isLoading && (
                        <Card className="border-dashed border-primary/20 bg-green-50/50 transition-colors hover:bg-brand-green-tint/50 dark:border-sidebar-accent dark:bg-brand-green-darker/20">
                            <CardContent className="flex flex-col items-center justify-center py-20">
                                <div className="relative mb-6">
                                    <div className="absolute inset-0 animate-ping rounded-full bg-teal-100 opacity-20 dark:bg-teal-900/20" />
                                    <div className="relative rounded-full bg-teal-50 p-6 dark:bg-teal-900/30">
                                        <Landmark className="h-10 w-10 text-teal-400 dark:text-teal-500" />
                                    </div>
                                </div>
                                <h3 className="text-lg font-bold text-sidebar-accent dark:text-slate-100">Ready to generate report?</h3>
                                <p className="mt-2 max-w-xs text-center text-sm text-slate-500 dark:text-slate-400">
                                    Select a date range and click <span className="font-semibold text-teal-600">Show Report</span> to view funder principal ledger balances.
                                </p>
                            </CardContent>
                        </Card>
                    )}
                </div>
            </div>
        </ProtectedRoute>
    );
}
