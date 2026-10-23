'use client';

import { useState, useRef, useCallback } from 'react';
import * as XLSX from 'xlsx-js-style';
import jsPDF from 'jspdf';
import { useReactToPrint } from 'react-to-print';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
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
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Percent,
    Download,
    FileText,
    FileSpreadsheet,
    FileType,
    Printer,
    RefreshCw,
    Filter,
    TrendingUp,
    IndianRupee,
    Calendar,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { useToast } from '@/hooks/use-toast';
import { usePermission } from '@/app/hooks/usePermission';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { drawFunderInterestReport } from '@/app/lib/reports/funder-interest-pdf';
import { reportHeaderRows, applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { exportToCSV, exportToWord, type WordExportOptions } from '@/app/lib/report-export-utils';
import { formatReportAmount, truncateReportAmount } from '@/app/lib/utils/format-amount';
import { toDisplayDateTime } from '@/app/lib/date-format';

const FY_MONTHS = ['apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec', 'jan', 'feb', 'mar'] as const;
type FYMonth = typeof FY_MONTHS[number];

const MONTH_LABELS: Record<FYMonth, string> = {
    apr: 'Apr', may: 'May', jun: 'Jun', jul: 'Jul', aug: 'Aug', sep: 'Sep',
    oct: 'Oct', nov: 'Nov', dec: 'Dec', jan: 'Jan', feb: 'Feb', mar: 'Mar',
};

interface FunderRow {
    funderId: string;
    funderName: string;
    interestGLName: string;
    apr: number; may: number; jun: number; jul: number; aug: number; sep: number;
    oct: number; nov: number; dec: number; jan: number; feb: number; mar: number;
    totalPayment: number;
}

interface ReportData {
    rows: FunderRow[];
    grandTotals: Record<FYMonth, number>;
    grandTotal: number;
}

const currentCalYear = new Date().getFullYear();
const REPORT_YEARS = Array.from({ length: 8 }, (_, i) => String(currentCalYear - i));

const fmt = (n: number) => formatReportAmount(n);

const fmtFull = (n: number) => formatReportAmount(n);

export default function FunderInterestPage() {
    const { toast } = useToast();
    const { canExportReport, getReportExportMode } = usePermission();
    const [reportYear, setReportYear] = useState(String(currentCalYear - 1));
    const [isLoading, setIsLoading] = useState(false);
    const [reportData, setReportData] = useState<ReportData | null>(null);
    const printRef = useRef<HTMLDivElement>(null);

    const fyLabel = reportData
        ? `FY ${reportYear}-${String(Number(reportYear) + 1).slice(-2)}`
        : `FY ${reportYear}-${String(Number(reportYear) + 1).slice(-2)}`;

    const fetchReport = async () => {
        setIsLoading(true);
        toast({ title: 'Generating Report', description: `Fetching funder interest data for ${fyLabel}...` });
        try {
            const res = await fetch(`/api/reports/funder-interest?year=${reportYear}`);
            const result = await res.json();
            if (result.success) {
                setReportData(result.data);
                const active = result.data.rows.filter((r: FunderRow) => r.totalPayment > 0).length;
                toast({
                    title: 'Report Ready',
                    description: `${result.data.rows.length} funders loaded, ${active} with interest payments.`,
                });
            } else {
                toast({ variant: 'destructive', title: 'Error', description: result.message || 'Failed to generate report.' });
            }
        } catch {
            toast({ variant: 'destructive', title: 'Network Error', description: 'Unable to connect to server.' });
        } finally {
            setIsLoading(false);
        }
    };

    const handlePrint = useReactToPrint({
        contentRef: printRef,
        documentTitle: `Funder_Interest_${fyLabel}`,
        onBeforePrint: async () => {
            if (!reportData) {
                toast({ variant: 'destructive', title: 'No Data', description: 'Generate the report first.' });
                throw new Error('No data');
            }
        },
    });

    const handleExportExcel = useCallback(() => {
        if (!reportData) {
            toast({ variant: 'destructive', title: 'No Data', description: 'Generate the report first.' });
            return;
        }
        try {
            const header = ['Funder Name', ...FY_MONTHS.map(m => MONTH_LABELS[m]), 'Total Payment'];
            const rows = reportData.rows.map(r => [
                r.funderName,
                ...FY_MONTHS.map(m => truncateReportAmount(r[m])),
                truncateReportAmount(r.totalPayment),
            ]);
            const totalsRow = [
                'TOTAL',
                ...FY_MONTHS.map(m => truncateReportAmount(reportData.grandTotals[m])),
                truncateReportAmount(reportData.grandTotal),
            ];

            const ws = XLSX.utils.aoa_to_sheet([
                ...reportHeaderRows(`FUNDER INTEREST REPORT — ${fyLabel}`),
                header,
                ...rows,
                totalsRow,
            ]);
            ws['!cols'] = [{ wch: 28 }, ...FY_MONTHS.map(() => ({ wch: 12 })), { wch: 16 }];
            applyExcelReportFont(ws);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Funder Interest');
            const fileName = `Funder_Interest_${reportYear}.xlsx`;
            XLSX.writeFile(wb, fileName);
            toast({ title: 'Export Successful', description: `Saved as ${fileName}` });
        } catch {
            toast({ variant: 'destructive', title: 'Export Failed', description: 'Failed to export Excel file.' });
        }
    }, [reportData, reportYear, fyLabel, toast]);

    const handleExportPDF = useCallback(async () => {
        if (!reportData) {
            toast({ variant: 'destructive', title: 'No Data', description: 'Generate the report first.' });
            return;
        }
        try {
            const doc = new jsPDF({ orientation: 'landscape' });
            const reportFont = await ensureReportFont(doc);
            await drawFunderInterestReport(
                doc, reportData.rows, reportData.grandTotals, reportData.grandTotal, { fyLabel }, reportFont
            );

            const fileName = `Funder_Interest_${reportYear}.pdf`;
            doc.save(fileName);
            toast({ title: 'Export Successful', description: `Saved as ${fileName}` });
        } catch {
            toast({ variant: 'destructive', title: 'Export Failed', description: 'Failed to export PDF.' });
        }
    }, [reportData, reportYear, fyLabel, toast]);

    // Mirrors the same field mapping used by handleExportExcel above (kept separate so
    // handleExportExcel is left untouched).
    const buildFunderInterestExportRows = (): { headers: string[]; rows: (string | number)[][] } => {
        if (!reportData) return { headers: [], rows: [] };
        const headers = ['Funder Name', ...FY_MONTHS.map(m => MONTH_LABELS[m]), 'Total Payment'];
        const rows: (string | number)[][] = reportData.rows.map(r => [
            r.funderName,
            ...FY_MONTHS.map(m => truncateReportAmount(r[m])),
            truncateReportAmount(r.totalPayment),
        ]);
        rows.push([
            'TOTAL',
            ...FY_MONTHS.map(m => truncateReportAmount(reportData.grandTotals[m])),
            truncateReportAmount(reportData.grandTotal),
        ]);
        return { headers, rows };
    };

    const handleExportCSV = useCallback(() => {
        if (!reportData) {
            toast({ variant: 'destructive', title: 'No Data', description: 'Generate the report first.' });
            return;
        }
        const { headers, rows } = buildFunderInterestExportRows();
        exportToCSV(`Funder_Interest_${reportYear}`, `FUNDER INTEREST REPORT — ${fyLabel}`, headers, rows);
    }, [reportData, reportYear, fyLabel, toast]);

    // Word-only presentation: same rows as CSV above, but the trailing "TOTAL" row is
    // split off for distinct styling, and the FY_MONTHS columns (derived from the same
    // list used to build headers, so the span always matches) get a grouped header —
    // genuine related fields, all monthly interest figures.
    const buildFunderInterestWordOptions = (
        rows: (string | number)[][]
    ): { bodyRows: (string | number)[][]; options: WordExportOptions } => ({
        bodyRows: rows.slice(0, -1),
        options: {
            groupHeaders: [
                { label: 'Funder Name', span: 1 },
                { label: 'MONTHLY INTEREST', span: FY_MONTHS.length },
                { label: 'Total Payment', span: 1 },
            ],
            subHeaders: FY_MONTHS.map((m) => MONTH_LABELS[m]),
            columnAlignments: ['left', ...FY_MONTHS.map(() => 'right' as const), 'right'],
            columnWidthWeights: [14, ...FY_MONTHS.map(() => 7), 9],
            totalsRow: rows[rows.length - 1],
        },
    });

    const handleExportWord = useCallback(async () => {
        if (!reportData) {
            toast({ variant: 'destructive', title: 'No Data', description: 'Generate the report first.' });
            return;
        }
        const { headers, rows } = buildFunderInterestExportRows();
        const { bodyRows, options } = buildFunderInterestWordOptions(rows);
        await exportToWord(`Funder_Interest_${reportYear}`, `FUNDER INTEREST REPORT — ${fyLabel}`, headers, bodyRows, options);
    }, [reportData, reportYear, fyLabel, toast]);

    const activeFunders = reportData?.rows.filter(r => r.totalPayment > 0).length ?? 0;
    const avgMonthly = reportData ? reportData.grandTotal / 12 : 0;

    return (
        <ProtectedRoute requiredRoles={['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER']}>
            <div className="relative min-h-screen bg-gradient-to-br from-background via-emerald-50/30 to-teal-50/30 dark:from-background dark:via-brand-green-darker dark:to-green-950">
                <div className="container mx-auto px-3 sm:px-6 py-4 sm:py-8">

                    {/* Header */}
                    <div className="mb-8">
                        <div className="flex items-center gap-4">
                            <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-600 shadow-lg shadow-emerald-500/30">
                                <Percent className="h-7 w-7 text-white" />
                                <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/20 to-transparent" />
                            </div>
                            <div>
                                <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-foreground dark:text-white">
                                    Funder Interest Report
                                </h1>
                                <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                                    Month-wise interest payments to funders for the financial year (Apr {'–'} Mar)
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Summary Cards */}
                    {reportData && (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                            <Card className="border-2 border-emerald-200/50 dark:border-emerald-800/50 bg-gradient-to-br from-emerald-50 to-teal-50/50 dark:from-emerald-950/20 dark:to-teal-950/20">
                                <CardContent className="pt-6">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">Total Interest</p>
                                            <p className="text-2xl font-bold text-emerald-900 dark:text-emerald-100 mt-1">
                                                ₹ {fmtFull(reportData.grandTotal)}
                                            </p>
                                            <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">Annual payment</p>
                                        </div>
                                        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100 dark:bg-emerald-900/50">
                                            <IndianRupee className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>

                            <Card className="border-2 border-teal-200/50 dark:border-teal-800/50 bg-gradient-to-br from-teal-50 to-cyan-50/50 dark:from-teal-950/20 dark:to-cyan-950/20">
                                <CardContent className="pt-6">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <p className="text-sm font-medium text-teal-700 dark:text-teal-300">Active Funders</p>
                                            <p className="text-3xl font-bold text-teal-900 dark:text-teal-100 mt-1">{activeFunders}</p>
                                            <p className="text-xs text-teal-600 dark:text-teal-400 mt-1">With interest payments</p>
                                        </div>
                                        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-teal-100 dark:bg-teal-900/50">
                                            <Percent className="h-6 w-6 text-teal-600 dark:text-teal-400" />
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>

                            <Card className="border-2 border-primary/30/50 dark:border-sidebar-accent/50 bg-gradient-to-br from-green-50 to-green-50/50 dark:from-brand-green-darker/20 dark:to-brand-green-darker/20">
                                <CardContent className="pt-6">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <p className="text-sm font-medium text-sidebar-accent dark:text-green-300">Avg Monthly</p>
                                            <p className="text-2xl font-bold text-foreground dark:text-green-100 mt-1">
                                                ₹ {fmtFull(avgMonthly)}
                                            </p>
                                            <p className="text-xs text-primary dark:text-primary mt-1">Per month</p>
                                        </div>
                                        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-green-tint dark:bg-brand-green-darker/50">
                                            <TrendingUp className="h-6 w-6 text-primary dark:text-primary" />
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>

                            <Card className="border-2 border-purple-200/50 dark:border-purple-800/50 bg-gradient-to-br from-purple-50 to-pink-50/50 dark:from-purple-950/20 dark:to-pink-950/20">
                                <CardContent className="pt-6">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <p className="text-sm font-medium text-purple-700 dark:text-purple-300">Financial Year</p>
                                            <p className="text-2xl font-bold text-purple-900 dark:text-purple-100 mt-1">{fyLabel}</p>
                                            <p className="text-xs text-purple-600 dark:text-purple-400 mt-1">Apr {'–'} Mar</p>
                                        </div>
                                        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-100 dark:bg-purple-900/50">
                                            <Calendar className="h-6 w-6 text-purple-600 dark:text-purple-400" />
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    )}

                    {/* Filters Card */}
                    <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden mb-6">
                        <div className="h-1.5 bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600" />
                        <CardHeader className="bg-gradient-to-r from-slate-50 via-emerald-50/60 to-teal-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                                <div className="flex items-center gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
                                        <Filter className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                                    </div>
                                    <div>
                                        <CardTitle className="text-xl">Report Parameters</CardTitle>
                                        <CardDescription>Select financial year to generate interest report</CardDescription>
                                    </div>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <ExportDropdown
                                        onExportPDF={reportData ? handleExportPDF : undefined}
                                        onExportExcel={reportData ? handleExportExcel : undefined}
                                        onExportCSV={reportData ? handleExportCSV : undefined}
                                        onExportWord={reportData ? handleExportWord : undefined}
                                        reportSlug={!!reportData && getReportExportMode('funder-interest') === 'REQUEST_QUEUE' ? 'funder-interest' : undefined}
                                        canExport={canExportReport('funder-interest')}
                                        exportParams={{ filters: { year: reportYear } }}
                                        className="border-green-300 text-green-700 hover:bg-green-50"
                                    />
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handlePrint()}
                                        disabled={!reportData}
                                        className="border-primary/30 text-sidebar-accent hover:bg-green-50 disabled:opacity-40"
                                    >
                                        <Printer className="h-4 w-4 mr-2" />
                                        Print
                                    </Button>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="pt-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-2">
                                    <Label htmlFor="reportYear" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Report Year (Start of FY) <span className="text-red-500">*</span>
                                    </Label>
                                    <Select value={reportYear} onValueChange={setReportYear}>
                                        <SelectTrigger id="reportYear" className="h-11 border-primary/30 dark:border-sidebar-accent">
                                            <SelectValue placeholder="Select year" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {REPORT_YEARS.map((year) => (
                                                <SelectItem key={year} value={year}>
                                                    {year} {'–'} {String(Number(year) + 1).slice(-2)} (Apr{'–'}Mar)
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-200 opacity-0">Action</Label>
                                    <Button
                                        onClick={fetchReport}
                                        disabled={isLoading}
                                        className="h-11 w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white shadow-lg shadow-emerald-500/30"
                                    >
                                        {isLoading ? (
                                            <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Generating...</>
                                        ) : (
                                            <><Percent className="h-4 w-4 mr-2" />Show Report</>
                                        )}
                                    </Button>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Report Table */}
                    <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
                        <div className="h-1.5 bg-gradient-to-r from-green-600 via-emerald-600 to-teal-600" />

                        <div ref={printRef}>
                            <CardHeader className="bg-gradient-to-r from-slate-50 via-emerald-50/60 to-teal-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker border-b">
                                <ReportHeader
                                    title={`FUNDER INTEREST REPORT — ${fyLabel}`}
                                    subtitle={reportData ? `${reportData.rows.length} funders  •  Total: ₹ ${fmtFull(reportData.grandTotal)}` : undefined}
                                />
                            </CardHeader>

                            <CardContent className="p-0">
                                {!reportData && !isLoading && (
                                    <div className="flex flex-col items-center justify-center h-48 text-slate-500 dark:text-slate-400">
                                        <Percent className="h-12 w-12 mb-3 opacity-30" />
                                        <p className="text-lg font-medium">No report generated yet</p>
                                        <p className="text-sm">Select a year and click &quot;Show Report&quot;</p>
                                    </div>
                                )}

                                {isLoading && (
                                    <div className="flex flex-col items-center justify-center h-48 text-slate-500">
                                        <RefreshCw className="h-10 w-10 mb-3 animate-spin text-emerald-500" />
                                        <p className="text-lg font-medium">Generating report...</p>
                                    </div>
                                )}

                                {reportData && !isLoading && (
                                    <div className="overflow-x-auto">
                                        <Table>
                                            <TableHeader>
                                                <TableRow className="bg-primary dark:bg-sidebar-accent hover:bg-primary dark:hover:bg-sidebar-accent">
                                                    <TableHead className="font-bold text-white sticky left-0 bg-primary dark:bg-sidebar-accent z-10 min-w-[180px]">
                                                        Funder Name
                                                    </TableHead>
                                                    {FY_MONTHS.map(m => (
                                                        <TableHead key={m} className="text-right font-bold text-white w-24">
                                                            {MONTH_LABELS[m]}
                                                        </TableHead>
                                                    ))}
                                                    <TableHead className="text-right font-bold text-white w-32 bg-sidebar-accent dark:bg-brand-green-darker">
                                                        Total Payment
                                                    </TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {reportData.rows.length === 0 ? (
                                                    <TableRow>
                                                        <TableCell colSpan={14} className="text-center py-12 text-slate-500">
                                                            No funder data found for this financial year.
                                                        </TableCell>
                                                    </TableRow>
                                                ) : (
                                                    reportData.rows.map((funder, idx) => (
                                                        <TableRow
                                                            key={funder.funderId}
                                                            className={cn(
                                                                'transition-colors hover:bg-emerald-50/50 dark:hover:bg-emerald-950/20',
                                                                idx % 2 === 0 ? 'bg-white dark:bg-brand-green-darker' : 'bg-green-50/50 dark:bg-brand-green-darker/50'
                                                            )}
                                                        >
                                                            <TableCell className="font-semibold text-foreground dark:text-slate-100 sticky left-0 bg-inherit z-10">
                                                                {funder.funderName}
                                                            </TableCell>
                                                            {FY_MONTHS.map(m => (
                                                                <TableCell
                                                                    key={m}
                                                                    className={cn(
                                                                        'text-right text-sm tabular-nums',
                                                                        funder[m] > 0 ? 'text-sidebar-accent dark:text-slate-200' : 'text-slate-400 dark:text-sidebar-accent'
                                                                    )}
                                                                >
                                                                    {fmt(funder[m])}
                                                                </TableCell>
                                                            ))}
                                                            <TableCell className="text-right font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                                                                {fmt(funder.totalPayment)}
                                                            </TableCell>
                                                        </TableRow>
                                                    ))
                                                )}

                                                {/* Grand Total Row */}
                                                {reportData.rows.length > 0 && (
                                                    <TableRow className="bg-gradient-to-r from-emerald-100 to-teal-100 dark:from-emerald-950/50 dark:to-teal-950/50 border-t-2 border-emerald-400 dark:border-emerald-700 hover:from-emerald-100 hover:to-teal-100">
                                                        <TableCell className="font-bold text-base text-emerald-900 dark:text-emerald-100 sticky left-0 bg-emerald-100 dark:bg-emerald-950/50 z-10">
                                                            TOTAL
                                                        </TableCell>
                                                        {FY_MONTHS.map(m => (
                                                            <TableCell key={m} className="text-right font-bold text-emerald-800 dark:text-emerald-300 tabular-nums">
                                                                {fmt(reportData.grandTotals[m])}
                                                            </TableCell>
                                                        ))}
                                                        <TableCell className="text-right font-bold text-base text-emerald-800 dark:text-emerald-300 tabular-nums">
                                                            {fmt(reportData.grandTotal)}
                                                        </TableCell>
                                                    </TableRow>
                                                )}
                                            </TableBody>
                                        </Table>
                                    </div>
                                )}
                            </CardContent>
                        </div>
                    </Card>

                    {/* Footer */}
                    {reportData && (
                        <div className="mt-4 flex items-center justify-between text-sm text-slate-500 dark:text-slate-400 print:hidden">
                            <p>Generated on {toDisplayDateTime(new Date())}</p>
                            <p>
                                Total Annual Interest:{' '}
                                <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                                    ₹ {fmtFull(reportData.grandTotal)}
                                </span>
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </ProtectedRoute>
    );
}
