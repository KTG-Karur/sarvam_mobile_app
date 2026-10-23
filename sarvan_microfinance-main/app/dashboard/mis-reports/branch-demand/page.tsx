'use client';

import { useState, useRef, useCallback } from 'react';
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
import { Badge } from '@/components/ui/badge';
import {
    Building2,
    Download,
    FileText,
    FileBarChart,
    FileSpreadsheet,
    FileOutput,
    Printer,
    Filter,
    Calendar,
    Users,
    IndianRupee,
    Loader2,
    SearchX,
    ChevronLeft,
    ChevronRight,
    RotateCcw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { useToast } from '@/hooks/use-toast';
import { usePermission } from '@/app/hooks/usePermission';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import * as XLSX from 'xlsx-js-style';
import jsPDF from 'jspdf';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { drawMisBranchDemandReport } from '@/app/lib/reports/mis-branch-demand-pdf';
import { buildReportSheet, autoSizeColumns, applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { formatReportAmount } from '@/app/lib/utils/format-amount';
import { exportToWord, type WordExportOptions } from '@/app/lib/report-export-utils';
import { PageLoader } from '@/components/ui/page-loader';
import { DateInput } from '@/components/ui/date-input';
import { toDisplayDate, toDisplayDateTime } from '@/app/lib/date-format';

// â”€â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface BranchDemandData {
    meetingDate: string;
    branchCode: string;
    branchName: string;
    fdoCode: string;
    fdoName: string;
    centers: number;
    loanOS: number;
    arrear: number;
    currDemand: number;
    totalDemand: number;
}

interface BranchDemandTotals {
    totalRows: number;
    totalCenters: number;
    totalLoanOS: number;
    totalArrear: number;
    totalCurrDemand: number;
    totalDemand: number;
    uniqueBranches: number;
    uniqueFDOs: number;
}

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const formatCurrency = (amount: number) => formatReportAmount(amount);

const getTodayStr = (): string => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
};

const formatDateDisplay = (dateString: string) => {
    return toDisplayDate(new Date(dateString));
};

// â”€â”€â”€ Component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export default function BranchDemandPage() {
    const { toast } = useToast();
    const { canExportReport, getReportExportMode } = usePermission();

    // Filter state
    const [fromDate, setFromDate] = useState<string>(getTodayStr());
    const [toDate, setToDate] = useState<string>(getTodayStr());
    // Snapshot of fromDate/toDate as of the last successful "Show" fetch — used for
    // export filenames, PDF/Word subtitles, on-screen labels, and exportParams so a
    // draft date edit (without clicking Show) never changes what's displayed/exported.
    const [submittedFromDate, setSubmittedFromDate] = useState<string>(fromDate);
    const [submittedToDate, setSubmittedToDate] = useState<string>(toDate);

    // Data state
    const [data, setData] = useState<BranchDemandData[]>([]);
    const [totals, setTotals] = useState<BranchDemandTotals>({
        totalRows: 0,
        totalCenters: 0,
        totalLoanOS: 0,
        totalArrear: 0,
        totalCurrDemand: 0,
        totalDemand: 0,
        uniqueBranches: 0,
        uniqueFDOs: 0,
    });
    const [isLoading, setIsLoading] = useState(false);
    const [showReport, setShowReport] = useState(false);

    // Pagination
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 15;
    const totalPages = Math.ceil(data.length / itemsPerPage);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const currentData = data.slice(startIndex, endIndex);

    const printRef = useRef<HTMLDivElement>(null);

    // â”€â”€â”€ Fetch Data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    const fetchData = useCallback(async () => {
        if (!fromDate || !toDate) {
            toast({
                title: 'Validation Error',
                description: 'Please select both From Date and Till Date',
                variant: 'destructive',
            });
            return;
        }

        if (new Date(fromDate) > new Date(toDate)) {
            toast({
                title: 'Validation Error',
                description: 'From Date cannot be after Till Date',
                variant: 'destructive',
            });
            return;
        }

        setIsLoading(true);
        setCurrentPage(1);

        try {
            const params = new URLSearchParams({
                fromDate,
                tillDate: toDate,
            });

            const res = await fetch(`/api/reports/mis-branch-demand?${params.toString()}`);
            if (!res.ok) {
                const errBody = await res.json().catch(() => ({}));
                throw new Error(errBody.error || `Request failed with status ${res.status}`);
            }

            const json = await res.json();

            setData(json.data || []);
            setTotals(json.totals || {
                totalRows: 0,
                totalCenters: 0,
                totalLoanOS: 0,
                totalArrear: 0,
                totalCurrDemand: 0,
                totalDemand: 0,
                uniqueBranches: 0,
                uniqueFDOs: 0,
            });
            setSubmittedFromDate(fromDate);
            setSubmittedToDate(toDate);
            setShowReport(true);

            if ((json.data || []).length === 0) {
                toast({
                    title: 'No Data Found',
                    description: 'No center meetings found for the selected date range',
                });
            } else {
                toast({
                    title: 'Report Generated',
                    description: `${json.totals?.totalRows || 0} rows loaded for ${formatDateDisplay(fromDate)} to ${formatDateDisplay(toDate)}`,
                });
            }
        } catch (err: any) {
            console.error('Error fetching MIS branch demand data:', err);
            toast({
                title: 'Error',
                description: err.message || 'Failed to fetch report data',
                variant: 'destructive',
            });
            setData([]);
        } finally {
            setIsLoading(false);
        }
    }, [fromDate, toDate, toast]);

    // â”€â”€â”€ Handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    const handleReset = () => {
        const today = getTodayStr();
        setFromDate(today);
        setToDate(today);
        setSubmittedFromDate(today);
        setSubmittedToDate(today);
        setShowReport(false);
        setData([]);
        setTotals({
            totalRows: 0,
            totalCenters: 0,
            totalLoanOS: 0,
            totalArrear: 0,
            totalCurrDemand: 0,
            totalDemand: 0,
            uniqueBranches: 0,
            uniqueFDOs: 0,
        });
        setCurrentPage(1);
    };

    const handleExport = () => {
        if (data.length === 0) {
            toast({
                title: 'No Data',
                description: 'Please generate the report first before exporting',
                variant: 'destructive',
            });
            return;
        }

        const headers = [
            'Meeting Date',
            'Branch Code',
            'Branch Name',
            'FDO Code',
            'FDO Name',
            'Centers',
            'Loan OS',
            'Arrear',
            'Curr Demand',
            'Total Demand',
        ];
        const rows = data.map((e) => [
            e.meetingDate,
            e.branchCode,
            e.branchName,
            e.fdoCode,
            e.fdoName,
            e.centers,
            formatReportAmount(e.loanOS),
            formatReportAmount(e.arrear),
            formatReportAmount(e.currDemand),
            formatReportAmount(e.totalDemand),
        ]);
        // Add totals row
        rows.push([
            'TOTAL',
            '',
            '',
            '',
            '',
            totals.totalCenters,
            formatReportAmount(totals.totalLoanOS),
            formatReportAmount(totals.totalArrear),
            formatReportAmount(totals.totalCurrDemand),
            formatReportAmount(totals.totalDemand),
        ] as any);

        const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `MIS-Branch-Demand-${submittedFromDate}-to-${submittedToDate}.csv`;
        link.click();
        URL.revokeObjectURL(url);

        toast({
            title: 'Export Successful',
            description: 'CSV file downloaded successfully',
        });
    };

    const handlePrint = () => {
        window.print();
    };

    // ── Excel / PDF / Word export (mirrors the exact same field mapping used by
    // handleExport (CSV) above, kept separate so handleExport is left untouched) ──

    const buildBranchDemandExportRows = (): { headers: string[]; rows: (string | number)[][] } => {
        const headers = ['Meeting Date', 'Branch Code', 'Branch Name', 'FDO Code', 'FDO Name', 'Centers', 'Loan OS', 'Arrear', 'Curr Demand', 'Total Demand'];
        const rows: (string | number)[][] = data.map((e) => [
            e.meetingDate, e.branchCode, e.branchName, e.fdoCode, e.fdoName,
            e.centers, formatReportAmount(e.loanOS), formatReportAmount(e.arrear), formatReportAmount(e.currDemand), formatReportAmount(e.totalDemand),
        ]);
        rows.push([
            'TOTAL', '', '', '', '',
            totals.totalCenters, formatReportAmount(totals.totalLoanOS), formatReportAmount(totals.totalArrear), formatReportAmount(totals.totalCurrDemand), formatReportAmount(totals.totalDemand),
        ]);
        return { headers, rows };
    };

    const handleExportExcel = () => {
        if (data.length === 0) {
            toast({ title: 'No Data', description: 'Please generate the report first before exporting', variant: 'destructive' });
            return;
        }
        const { headers, rows } = buildBranchDemandExportRows();
        const excelRows = rows.map(row => Object.fromEntries(headers.map((h, i) => [h, row[i]])));
        const ws = buildReportSheet('MIS Branch Demand', excelRows);
        autoSizeColumns(ws);
        applyExcelReportFont(ws);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Branch Demand');
        XLSX.writeFile(wb, `MIS-Branch-Demand-${submittedFromDate}-to-${submittedToDate}.xlsx`);
        toast({ title: 'Export Successful', description: 'Excel file downloaded successfully' });
    };

    const handleExportPDF = async () => {
        if (data.length === 0) {
            toast({ title: 'No Data', description: 'Please generate the report first before exporting', variant: 'destructive' });
            return;
        }
        const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
        const reportFont = await ensureReportFont(doc);
        await drawMisBranchDemandReport(doc, data, totals, { fromDate: submittedFromDate, toDate: submittedToDate }, reportFont);
        doc.save(`MIS-Branch-Demand-${submittedFromDate}-to-${submittedToDate}.pdf`);
        toast({ title: 'Export Successful', description: 'PDF file downloaded successfully' });
    };

    // Word-only presentation: same rows as Excel/PDF above, but the trailing 'TOTAL' row
    // is split off for distinct styling. 10 flat columns — no genuine repeated-prefix
    // pairs here, so no grouped headers.
    const wordOptions: WordExportOptions = {
        columnAlignments: ['center', 'center', 'left', 'center', 'left', 'right', 'right', 'right', 'right', 'right'],
        columnWidthWeights: [9, 8, 14, 8, 12, 7, 8, 8, 9, 9],
    };

    const handleExportWord = async () => {
        if (data.length === 0) {
            toast({ title: 'No Data', description: 'Please generate the report first before exporting', variant: 'destructive' });
            return;
        }
        const { headers, rows } = buildBranchDemandExportRows();
        const bodyRows = rows.slice(0, -1);
        const totalsRow = rows[rows.length - 1];
        await exportToWord(`MIS-Branch-Demand-${submittedFromDate}-to-${submittedToDate}`, 'MIS BRANCH DEMAND REPORT', headers, bodyRows, { ...wordOptions, totalsRow });
        toast({ title: 'Export Successful', description: 'Word file downloaded successfully' });
    };

    // â”€â”€â”€ Render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    return (
        <ProtectedRoute requiredPermission="MIS_REPORTS">
            <div className="relative min-h-screen bg-gradient-to-br from-background via-green-50/30 to-cyan-50/30 dark:from-background dark:via-brand-green-darker dark:to-green-950">
                <div className="container mx-auto px-3 sm:px-6 py-4 sm:py-8">
                    {/* Header Section */}
                    <div className="mb-8">
                        <div className="flex items-center gap-4 mb-4">
                            <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-cyan-600 shadow-lg shadow-primary/30">
                                <Calendar className="h-7 w-7 text-white" />
                                <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/20 to-transparent" />
                            </div>
                            <div className="flex-1">
                                <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-foreground dark:text-white">
                                    Branch Demand
                                </h1>
                                <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                                    Branch-wise demand report with FDO assignments and financial metrics
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Summary Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                        <Card className="border-2 border-primary/30/50 dark:border-sidebar-accent/50 bg-gradient-to-br from-green-50 to-cyan-50/50 dark:from-brand-green-darker/20 dark:to-cyan-950/20">
                            <CardContent className="pt-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-sidebar-accent dark:text-green-300">
                                            Total Centers
                                        </p>
                                        <p className="text-3xl font-bold text-foreground dark:text-green-100 mt-2">
                                            {totals.totalCenters}
                                        </p>
                                        <p className="text-xs text-primary dark:text-primary mt-1">
                                            {totals.uniqueBranches} branches, {totals.uniqueFDOs} FDOs
                                        </p>
                                    </div>
                                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-green-tint dark:bg-brand-green-darker/50">
                                        <Building2 className="h-6 w-6 text-primary dark:text-primary" />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="border-2 border-purple-200/50 dark:border-purple-800/50 bg-gradient-to-br from-purple-50 to-pink-50/50 dark:from-purple-950/20 dark:to-pink-950/20">
                            <CardContent className="pt-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-purple-700 dark:text-purple-300">
                                            Loan Outstanding
                                        </p>
                                        <p className="text-2xl font-bold text-purple-900 dark:text-purple-100 mt-2">
                                            ₹ {formatCurrency(totals.totalLoanOS)}
                                        </p>
                                        <p className="text-xs text-purple-600 dark:text-purple-400 mt-1">
                                            Total OS amount
                                        </p>
                                    </div>
                                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-100 dark:bg-purple-900/50">
                                        <IndianRupee className="h-6 w-6 text-purple-600 dark:text-purple-400" />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="border-2 border-orange-200/50 dark:border-orange-800/50 bg-gradient-to-br from-orange-50 to-red-50/50 dark:from-orange-950/20 dark:to-red-950/20">
                            <CardContent className="pt-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-orange-700 dark:text-orange-300">
                                            Total Arrear
                                        </p>
                                        <p className="text-2xl font-bold text-orange-900 dark:text-orange-100 mt-2">
                                            ₹ {formatCurrency(totals.totalArrear)}
                                        </p>
                                        <p className="text-xs text-orange-600 dark:text-orange-400 mt-1">
                                            Outstanding arrears
                                        </p>
                                    </div>
                                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-orange-100 dark:bg-orange-900/50">
                                        <IndianRupee className="h-6 w-6 text-orange-600 dark:text-orange-400" />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="border-2 border-cyan-200/50 dark:border-cyan-800/50 bg-gradient-to-br from-cyan-50 to-green-50/50 dark:from-cyan-950/20 dark:to-brand-green-darker/20">
                            <CardContent className="pt-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-cyan-700 dark:text-cyan-300">
                                            Total Demand
                                        </p>
                                        <p className="text-2xl font-bold text-cyan-900 dark:text-cyan-100 mt-2">
                                            ₹ {formatCurrency(totals.totalDemand)}
                                        </p>
                                        <p className="text-xs text-cyan-600 dark:text-cyan-400 mt-1">
                                            Arrear + Current
                                        </p>
                                    </div>
                                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-100 dark:bg-cyan-900/50">
                                        <IndianRupee className="h-6 w-6 text-cyan-600 dark:text-cyan-400" />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Filters Card */}
                    <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden mb-6">
                        <div className="h-1.5 bg-gradient-to-r from-primary via-cyan-600 to-teal-600" />
                        <CardHeader className="bg-gradient-to-r from-slate-50 via-green-50/60 to-cyan-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                                <div className="flex items-center gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-green-tint dark:bg-brand-green-darker/30">
                                        <Filter className="h-5 w-5 text-primary dark:text-primary" />
                                    </div>
                                    <div>
                                        <CardTitle className="text-xl">Report Parameters</CardTitle>
                                        <CardDescription>
                                            Select date range for branch demand report
                                        </CardDescription>
                                    </div>
                                </div>
                                {showReport && data.length > 0 && (
                                    <div className="flex flex-wrap gap-2">
                                        <ExportDropdown
                                            onExportPDF={handleExportPDF}
                                            onExportExcel={handleExportExcel}
                                            onExportCSV={handleExport}
                                            onExportWord={handleExportWord}
                                            reportSlug={getReportExportMode('mis-branch-demand') === 'REQUEST_QUEUE' ? 'mis-branch-demand' : undefined}
                                            canExport={canExportReport('mis-branch-demand')}
                                            exportParams={{ fromDate: submittedFromDate, toDate: submittedToDate, branchIds: 'ALL' }}
                                            className="border-emerald-400/50 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-300"
                                        />
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={handlePrint}
                                            className="border-primary/30 text-sidebar-accent hover:bg-green-50 dark:border-sidebar-accent dark:text-slate-300"
                                        >
                                            <Printer className="h-4 w-4 mr-2" />
                                            Print
                                        </Button>
                                    </div>
                                )}
                            </div>
                        </CardHeader>
                        <CardContent className="pt-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                                {/* From Date */}
                                <div className="space-y-2">
                                    <Label htmlFor="fromDate" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        From Date <span className="text-red-500">*</span>
                                    </Label>
                                    <div className="relative">
                                        <DateInput
                                            id="fromDate"
                                            value={fromDate}
                                            onChange={(e) => setFromDate(e.target.value)}
                                            className="h-11 border-primary/30 dark:border-sidebar-accent pl-10"
                                            disabled={isLoading}
                                        />
                                        <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                                    </div>
                                </div>

                                {/* To Date */}
                                <div className="space-y-2">
                                    <Label htmlFor="toDate" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Till Date <span className="text-red-500">*</span>
                                    </Label>
                                    <div className="relative">
                                        <DateInput
                                            id="toDate"
                                            value={toDate}
                                            onChange={(e) => setToDate(e.target.value)}
                                            className="h-11 border-primary/30 dark:border-sidebar-accent pl-10"
                                            disabled={isLoading}
                                        />
                                        <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                                    </div>
                                </div>

                                {/* Show Button */}
                                <div className="space-y-2">
                                    <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-200 opacity-0">
                                        Action
                                    </Label>
                                    <Button
                                        onClick={fetchData}
                                        disabled={isLoading}
                                        className="h-11 w-full bg-gradient-to-r from-primary to-cyan-600 hover:from-sidebar-accent hover:to-cyan-700 text-white shadow-lg shadow-primary/30"
                                    >
                                        {isLoading ? (
                                            <>
                                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                                Loading...
                                            </>
                                        ) : (
                                            <>
                                                <FileText className="h-4 w-4 mr-2" />
                                                Show
                                            </>
                                        )}
                                    </Button>
                                </div>

                                {/* Reset Button */}
                                <div className="space-y-2">
                                    <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-200 opacity-0">
                                        Action
                                    </Label>
                                    <Button
                                        onClick={handleReset}
                                        variant="outline"
                                        className="h-11 w-full border-red-300 text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-300"
                                        disabled={isLoading}
                                    >
                                        <RotateCcw className="h-4 w-4 mr-2" />
                                        Reset
                                    </Button>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Loading State */}
                    {isLoading && (
                        <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
                            <PageLoader label="Generating branch demand report, please wait..." fullScreen={false} />
                        </Card>
                    )}

                    {/* Pre-fetch State */}
                    {!isLoading && !showReport && (
                        <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
                            <div className="flex flex-col items-center justify-center py-20 gap-4">
                                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-green-tint/80 dark:bg-brand-green-darker/30">
                                    <FileText className="h-8 w-8 text-primary" />
                                </div>
                                <div className="text-center">
                                    <p className="text-lg font-semibold text-sidebar-accent dark:text-slate-300">
                                        Select date range and click &quot;Show&quot;
                                    </p>
                                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                                        Choose From and Till dates to generate the branch demand report
                                    </p>
                                </div>
                            </div>
                        </Card>
                    )}

                    {/* No Results State */}
                    {!isLoading && showReport && data.length === 0 && (
                        <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
                            <div className="flex flex-col items-center justify-center py-20 gap-4">
                                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-100/80 dark:bg-amber-900/30">
                                    <SearchX className="h-8 w-8 text-amber-500" />
                                </div>
                                <div className="text-center">
                                    <p className="text-lg font-semibold text-sidebar-accent dark:text-slate-300">
                                        No data found
                                    </p>
                                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                                        No center meetings with outstanding loans found for the selected date range
                                    </p>
                                </div>
                            </div>
                        </Card>
                    )}

                    {/* Demand Report Table */}
                    {!isLoading && showReport && data.length > 0 && (
                        <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
                            <div className="h-1.5 bg-gradient-to-r from-primary via-cyan-600 to-teal-600" />

                            {/* Print-friendly content */}
                            <div ref={printRef} className="print:p-8">
                                {/* Report Header */}
                                <CardHeader className="bg-gradient-to-r from-slate-50 via-green-50/60 to-cyan-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker print:bg-white">
                                    <div className="flex items-center justify-between">
                                        <div className="flex-1">
                                            <ReportHeader
                                                title="Branch Demand Report"
                                                subtitle={`Period: ${formatDateDisplay(submittedFromDate)} to ${formatDateDisplay(submittedToDate)}`}
                                            />
                                        </div>
                                        <Badge variant="outline" className="text-sm px-3 py-1">
                                            {data.length} Records
                                        </Badge>
                                    </div>
                                </CardHeader>

                                <CardContent className="p-0">
                                    <div className="overflow-x-auto">
                                        <Table>
                                            <TableHeader>
                                                <TableRow className="bg-gradient-to-r from-sidebar-accent to-cyan-700 dark:from-sidebar-accent dark:to-cyan-800 hover:from-sidebar-accent hover:to-cyan-700">
                                                    <TableHead className="font-bold text-white text-sm">Meeting Date</TableHead>
                                                    <TableHead className="font-bold text-white text-sm">Branch</TableHead>
                                                    <TableHead className="font-bold text-white text-sm">FDO</TableHead>
                                                    <TableHead className="font-bold text-white text-sm text-center"># Centers</TableHead>
                                                    <TableHead className="font-bold text-white text-sm text-right">Loan OS</TableHead>
                                                    <TableHead className="font-bold text-white text-sm text-right">Arrear</TableHead>
                                                    <TableHead className="font-bold text-white text-sm text-right">Curr Demand</TableHead>
                                                    <TableHead className="font-bold text-white text-sm text-right">Total Demand</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {currentData.map((item, index) => (
                                                    <TableRow
                                                        key={`${item.meetingDate}-${item.branchCode}-${item.fdoCode}-${index}`}
                                                        className={cn(
                                                            'transition-colors',
                                                            index % 2 === 0
                                                                ? 'bg-white dark:bg-brand-green-darker hover:bg-green-50 dark:hover:bg-green-950/20'
                                                                : 'bg-green-50/50 dark:bg-brand-green-darker/50 hover:bg-green-50 dark:hover:bg-green-950/20',
                                                            item.arrear > 0 && 'border-l-4 border-red-400'
                                                        )}
                                                    >
                                                        <TableCell className="font-medium text-foreground dark:text-slate-100">
                                                            {item.meetingDate}
                                                        </TableCell>
                                                        <TableCell className="font-semibold text-sidebar-accent dark:text-primary">
                                                            {item.branchCode} - {item.branchName}
                                                        </TableCell>
                                                        <TableCell className="font-medium text-sidebar-accent dark:text-slate-300">
                                                            {item.fdoCode} - {item.fdoName}
                                                        </TableCell>
                                                        <TableCell className="text-center">
                                                            <Badge variant="secondary" className="text-xs min-w-[2rem] justify-center">
                                                                {item.centers}
                                                            </Badge>
                                                        </TableCell>
                                                        <TableCell className="text-right font-semibold text-primary dark:text-primary">
                                                            {formatCurrency(item.loanOS)}
                                                        </TableCell>
                                                        <TableCell className={cn(
                                                            "text-right font-semibold",
                                                            item.arrear > 0 ? "text-red-700 dark:text-red-400" : "text-green-700 dark:text-green-400"
                                                        )}>
                                                            {formatCurrency(item.arrear)}
                                                        </TableCell>
                                                        <TableCell className="text-right font-semibold text-teal-700 dark:text-teal-400">
                                                            {formatCurrency(item.currDemand)}
                                                        </TableCell>
                                                        <TableCell className="text-right font-bold text-cyan-700 dark:text-cyan-400">
                                                            {formatCurrency(item.totalDemand)}
                                                        </TableCell>
                                                    </TableRow>
                                                ))}

                                                {/* Totals Row */}
                                                <TableRow className="font-bold bg-gradient-to-r from-brand-green-tint to-cyan-100 dark:from-brand-green-darker/50 dark:to-cyan-950/50 border-t-2 border-primary/50 dark:border-sidebar-accent">
                                                    <TableCell className="text-lg text-foreground dark:text-green-100" colSpan={3}>
                                                        GRAND TOTAL
                                                    </TableCell>
                                                    <TableCell className="text-center text-sidebar-accent dark:text-green-300">
                                                        {totals.totalCenters}
                                                    </TableCell>
                                                    <TableCell className="text-right text-sidebar-accent dark:text-green-300">
                                                        {formatCurrency(totals.totalLoanOS)}
                                                    </TableCell>
                                                    <TableCell className="text-right text-sidebar-accent dark:text-green-300">
                                                        {formatCurrency(totals.totalArrear)}
                                                    </TableCell>
                                                    <TableCell className="text-right text-sidebar-accent dark:text-green-300">
                                                        {formatCurrency(totals.totalCurrDemand)}
                                                    </TableCell>
                                                    <TableCell className="text-right text-sidebar-accent dark:text-green-300">
                                                        {formatCurrency(totals.totalDemand)}
                                                    </TableCell>
                                                </TableRow>
                                            </TableBody>
                                        </Table>
                                    </div>

                                    {/* Pagination */}
                                    {totalPages > 1 && (
                                        <div className="flex items-center justify-between border-t border-primary/20 dark:border-sidebar-accent px-6 py-4">
                                            <div className="text-sm text-sidebar-accent dark:text-slate-400">
                                                Showing {startIndex + 1} to {Math.min(endIndex, data.length)} of {data.length} records
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                                                    disabled={currentPage === 1}
                                                    className="border-primary/50 text-sidebar-accent hover:bg-green-50"
                                                >
                                                    <ChevronLeft className="h-4 w-4 mr-1" />
                                                    Previous
                                                </Button>
                                                <div className="flex items-center gap-1">
                                                    {Array.from({ length: Math.min(totalPages, 10) }, (_, i) => {
                                                        let page: number;
                                                        if (totalPages <= 10) {
                                                            page = i + 1;
                                                        } else if (currentPage <= 5) {
                                                            page = i + 1;
                                                        } else if (currentPage >= totalPages - 4) {
                                                            page = totalPages - 9 + i;
                                                        } else {
                                                            page = currentPage - 4 + i;
                                                        }
                                                        return (
                                                            <Button
                                                                key={page}
                                                                variant={currentPage === page ? 'default' : 'outline'}
                                                                size="sm"
                                                                onClick={() => setCurrentPage(page)}
                                                                className={cn(
                                                                    'w-8 h-8 p-0',
                                                                    currentPage === page
                                                                        ? 'bg-primary text-white hover:bg-primary'
                                                                        : 'border-primary/50 text-sidebar-accent hover:bg-green-50'
                                                                )}
                                                            >
                                                                {page}
                                                            </Button>
                                                        );
                                                    })}
                                                </div>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                                                    disabled={currentPage === totalPages}
                                                    className="border-primary/50 text-sidebar-accent hover:bg-green-50"
                                                >
                                                    Next
                                                    <ChevronRight className="h-4 w-4 ml-1" />
                                                </Button>
                                            </div>
                                        </div>
                                    )}
                                </CardContent>
                            </div>
                        </Card>
                    )}

                    {/* Footer Info */}
                    {showReport && data.length > 0 && (
                        <div className="mt-6 flex items-center justify-between text-sm text-sidebar-accent dark:text-slate-400 print:hidden">
                            <p>
                                Report generated on {toDisplayDateTime(new Date())}
                            </p>
                            <p>
                                {data.length} records | {totals.uniqueBranches} branches | {totals.uniqueFDOs} FDOs
                            </p>
                        </div>
                    )}
                </div>
            </div>

            {/* Print Styles */}
            <style jsx global>{`
                @media print {
                    body * {
                        visibility: hidden;
                    }
                    .print\\:p-8, .print\\:p-8 * {
                        visibility: visible;
                    }
                    .print\\:p-8 {
                        position: absolute;
                        left: 0;
                        top: 0;
                        width: 100%;
                    }
                    @page {
                        margin: 1cm;
                    }
                }
            `}</style>
        </ProtectedRoute>
    );
}
