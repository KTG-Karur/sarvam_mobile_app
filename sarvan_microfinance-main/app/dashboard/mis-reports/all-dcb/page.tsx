'use client';

import { useState, useRef } from 'react';
import jsPDF from 'jspdf';
import * as XLSX from 'xlsx-js-style';
import { reportHeaderRows, autoSizeColumns, applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { formatReportAmount } from '@/app/lib/utils/format-amount';
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
    Building2,
    Download,
    FileText,
    FileBarChart,
    FileType,
    FileOutput,
    Printer,
    RefreshCw,
    Filter,
    Calendar,
    TrendingUp,
    IndianRupee,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { useToast } from '@/hooks/use-toast';
import { usePermission } from '@/app/hooks/usePermission';
import { useLoanAdvanceEnabled } from '@/app/hooks/useLoanAdvanceEnabled';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { drawMisAllDcbReport } from '@/app/lib/reports/mis-all-dcb-pdf';
import { exportToCSV, exportToWord, type WordExportOptions } from '@/app/lib/report-export-utils';
import { DateInput } from '@/components/ui/date-input';
import { toDisplayDate, toDisplayDateTime } from '@/app/lib/date-format';

// Branch DCB data interface
interface BranchDCBData {
    branchCode: string;
    branchName: string;
    meetingDate: string;
    centers: number;
    clients: number;
    openingArr: number;
    demand: number;
    currentColl: number;
    recPercentage: number;
    currArrColl: number;
    odArrColl: number;
    advanceColl: number;
    preclosure: number;
    totalColl: number;
    currArrear: number;
    closingArr: number;
}



// Calculate grand totals
const calculateGrandTotals = (data: BranchDCBData[]) => {
    return {
        centers: data.reduce((sum, item) => sum + item.centers, 0),
        clients: data.reduce((sum, item) => sum + item.clients, 0),
        openingArr: data.reduce((sum, item) => sum + item.openingArr, 0),
        demand: data.reduce((sum, item) => sum + item.demand, 0),
        currentColl: data.reduce((sum, item) => sum + item.currentColl, 0),
        recPercentage: 0, // Will calculate separately
        currArrColl: data.reduce((sum, item) => sum + item.currArrColl, 0),
        odArrColl: data.reduce((sum, item) => sum + item.odArrColl, 0),
        advanceColl: data.reduce((sum, item) => sum + item.advanceColl, 0),
        preclosure: data.reduce((sum, item) => sum + item.preclosure, 0),
        totalColl: data.reduce((sum, item) => sum + item.totalColl, 0),
        currArrear: data.reduce((sum, item) => sum + item.currArrear, 0),
        closingArr: data.reduce((sum, item) => sum + item.closingArr, 0),
    };
};

// Format currency (whole rupees, truncated — not rounded)
const formatCurrency = (amount: number) => formatReportAmount(amount);

// Format percentage
const formatPercentage = (value: number) => {
    return value.toFixed(2);
};

// Format date
const formatDate = (dateString: string) => {
    return toDisplayDate(new Date(dateString));
};

export default function AllBranchDCBPage() {
    const { toast } = useToast();
    const { canExportReport, getReportExportMode } = usePermission();
    const { enabled: loanAdvanceEnabled } = useLoanAdvanceEnabled();
    const [fromDate, setFromDate] = useState<string>(
        new Date().toISOString().split('T')[0]
    );
    const [toDate, setToDate] = useState<string>(
        new Date().toISOString().split('T')[0]
    );
    // Snapshot of fromDate/toDate as of the last "Show" click — used for export
    // filenames, PDF/Word subtitles, on-screen labels, and exportParams so a
    // draft date edit (without clicking Show) never changes what's displayed/exported.
    const [submittedFromDate, setSubmittedFromDate] = useState<string>(fromDate);
    const [submittedToDate, setSubmittedToDate] = useState<string>(toDate);
    const [isLoading, setIsLoading] = useState(false);
    const [showReport, setShowReport] = useState(false);
    const [dcbData, setDcbData] = useState<BranchDCBData[]>([]);
    const printRef = useRef<HTMLDivElement>(null);

    const grandTotals = calculateGrandTotals(dcbData);
    // Calculate recovery percentage for grand total
    grandTotals.recPercentage = grandTotals.demand > 0
        ? (grandTotals.currentColl / grandTotals.demand) * 100
        : 0;

    const handleShowReport = async () => {
        setIsLoading(true);
        try {
            const params = new URLSearchParams({
                fromDate,
                toDate,
            });
            const response = await fetch(`/api/reports/all-dcb?${params}`);
            if (!response.ok) {
                throw new Error('Failed to fetch DCB data');
            }
            const result = await response.json();
            setDcbData(result.data || []);
            setSubmittedFromDate(fromDate);
            setSubmittedToDate(toDate);
            setShowReport(true);
            toast({
                title: "Success",
                description: "DCB report generated successfully.",
            });
        } catch (error) {
            console.error('Error fetching DCB data:', error);
            toast({
                title: "Error",
                description: "Failed to fetch DCB report. Please try again.",
                variant: "destructive",
            });
            setDcbData([]);
            setShowReport(false);
        } finally {
            setIsLoading(false);
        }
    };

    const handleReset = () => {
        const today = new Date().toISOString().split('T')[0];
        setFromDate(today);
        setToDate(today);
        setSubmittedFromDate(today);
        setSubmittedToDate(today);
        setShowReport(false);
        setDcbData([]);
    };

    const handleExport = () => {
        if (!dcbData || dcbData.length === 0) {
            toast({
                title: "No Data",
                description: "There is no data to export.",
                variant: "destructive",
            });
            return;
        }

        const { headers, rows } = buildAllDCBExportRows();
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet([...reportHeaderRows('ALL BRANCH DCB REPORT'), headers, ...rows]);
        autoSizeColumns(ws);
        applyExcelReportFont(ws);
        XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
        XLSX.writeFile(wb, `${exportFileBase()}.xlsx`);

        toast({
            title: "Export Successful",
            description: "The DCB report has been downloaded.",
        });
    };

    const handlePrint = () => {
        window.print();
    };

    // ── PDF / CSV / Word export (mirrors the same field mapping used by handleExport
    // above, kept separate so handleExport is left untouched) ──────────────────────
    const buildAllDCBExportRows = (): { headers: string[]; rows: (string | number)[][] } => {
        const headers = [
            'Branch Name', 'Meeting Date', '# Centers', '# Clients', 'Opening Arr', 'Demand',
            'Current Coll', 'Rec %', 'Curr Arr Coll', 'OD Arr Coll',
            ...(loanAdvanceEnabled ? ['Advance Coll'] : []),
            'Preclosure', 'Total Coll', 'Curr Arrear', 'Closing Arr',
        ];
        const rows: (string | number)[][] = dcbData.map((branch) => [
            `${branch.branchCode} - ${branch.branchName}`, branch.meetingDate, branch.centers, branch.clients,
            formatReportAmount(branch.openingArr), formatReportAmount(branch.demand), formatReportAmount(branch.currentColl), Number(branch.recPercentage.toFixed(2)),
            formatReportAmount(branch.currArrColl), formatReportAmount(branch.odArrColl),
            ...(loanAdvanceEnabled ? [formatReportAmount(branch.advanceColl)] : []),
            formatReportAmount(branch.preclosure),
            formatReportAmount(branch.totalColl), formatReportAmount(branch.currArrear), formatReportAmount(branch.closingArr),
        ]);
        rows.push([
            'Grand Total', '', grandTotals.centers, grandTotals.clients, formatReportAmount(grandTotals.openingArr), formatReportAmount(grandTotals.demand),
            formatReportAmount(grandTotals.currentColl), Number(grandTotals.recPercentage.toFixed(2)), formatReportAmount(grandTotals.currArrColl),
            formatReportAmount(grandTotals.odArrColl),
            ...(loanAdvanceEnabled ? [formatReportAmount(grandTotals.advanceColl)] : []),
            formatReportAmount(grandTotals.preclosure),
            formatReportAmount(grandTotals.totalColl), formatReportAmount(grandTotals.currArrear), formatReportAmount(grandTotals.closingArr),
        ]);
        return { headers, rows };
    };

    const exportFileBase = () => {
        const formatExportDate = (dateStr: string) => {
            const d = new Date(dateStr);
            const day = d.getDate().toString().padStart(2, '0');
            const month = (d.getMonth() + 1).toString().padStart(2, '0');
            const year = d.getFullYear();
            return `${day}/${month}/${year}`;
        };
        return `ConsolidatedDCB_${formatExportDate(submittedFromDate)}_To_${formatExportDate(submittedToDate)}`;
    };

    const handleExportPDF = async () => {
        if (!dcbData || dcbData.length === 0) {
            toast({ title: "No Data", description: "There is no data to export.", variant: "destructive" });
            return;
        }
        const { headers, rows } = buildAllDCBExportRows();
        const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
        const reportFont = await ensureReportFont(doc);
        await drawMisAllDcbReport(
            doc,
            { headers, rows },
            { subtitle: `Period: ${formatDate(submittedFromDate)} to ${formatDate(submittedToDate)}` },
            reportFont
        );
        doc.save(`${exportFileBase()}.pdf`);
        toast({ title: "PDF Exported", description: "The DCB report has been downloaded." });
    };

    const handleExportCSV = () => {
        if (!dcbData || dcbData.length === 0) {
            toast({ title: "No Data", description: "There is no data to export.", variant: "destructive" });
            return;
        }
        const { headers, rows } = buildAllDCBExportRows();
        exportToCSV(exportFileBase(), 'ALL BRANCH DCB REPORT', headers, rows);
    };

    // Word-only presentation: same rows as PDF/CSV above, but the trailing Grand Total
    // row is split off for distinct styling. 15 flat columns — each is a distinct
    // branch-level metric (Demand, Rec %, Preclosure, ...), no genuine repeated-prefix
    // pairs to group.
    const buildWordOptions = (): WordExportOptions => loanAdvanceEnabled
        ? {
            columnAlignments: ['left', 'center', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right'],
            columnWidthWeights: [14, 8, 6, 6, 7, 7, 7, 6, 7, 7, 7, 7, 7, 7, 7],
        }
        : {
            columnAlignments: ['left', 'center', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right'],
            columnWidthWeights: [14, 8, 6, 6, 7, 7, 7, 6, 7, 7, 7, 7, 7, 7],
        };

    const handleExportWord = async () => {
        if (!dcbData || dcbData.length === 0) {
            toast({ title: "No Data", description: "There is no data to export.", variant: "destructive" });
            return;
        }
        const { headers, rows } = buildAllDCBExportRows();
        const bodyRows = rows.slice(0, -1);
        const totalsRow = rows[rows.length - 1];
        await exportToWord(exportFileBase(), 'ALL BRANCH DCB REPORT', headers, bodyRows, { ...buildWordOptions(), totalsRow });
    };

    return (
        <ProtectedRoute requiredPermission="MIS_REPORTS">
            <div className="relative min-h-screen bg-gradient-to-br from-background via-emerald-50/30 to-teal-50/30 dark:from-background dark:via-brand-green-darker dark:to-green-950">
                <div className="container mx-auto px-3 sm:px-6 py-4 sm:py-8">
                    {/* Header Section */}
                    <div className="mb-8">
                        <div className="flex items-center gap-4 mb-4">
                            <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-600 shadow-lg shadow-emerald-500/30">
                                <Building2 className="h-7 w-7 text-white" />
                                <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/20 to-transparent" />
                            </div>
                            <div className="flex-1">
                                <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-foreground dark:text-white">
                                    All Branch DCB
                                </h1>
                                <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                                    Branch-wise Demand Collection Book report with comprehensive financial metrics
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Summary Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                        <Card className="border-2 border-emerald-200/50 dark:border-emerald-800/50 bg-gradient-to-br from-emerald-50 to-teal-50/50 dark:from-emerald-950/20 dark:to-teal-950/20">
                            <CardContent className="pt-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
                                            Total Branches
                                        </p>
                                        <p className="text-3xl font-bold text-emerald-900 dark:text-emerald-100 mt-2">
                                            {dcbData.length}
                                        </p>
                                        <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">
                                            Active branches
                                        </p>
                                    </div>
                                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100 dark:bg-emerald-900/50">
                                        <Building2 className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="border-2 border-primary/30/50 dark:border-sidebar-accent/50 bg-gradient-to-br from-green-50 to-green-50/50 dark:from-brand-green-darker/20 dark:to-brand-green-darker/20">
                            <CardContent className="pt-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-sidebar-accent dark:text-green-300">
                                            Total Demand
                                        </p>
                                        <p className="text-2xl font-bold text-foreground dark:text-green-100 mt-2">
                                            ₹ {formatCurrency(grandTotals.demand)}
                                        </p>
                                        <p className="text-xs text-primary dark:text-primary mt-1">
                                            Overall demand
                                        </p>
                                    </div>
                                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-green-tint dark:bg-brand-green-darker/50">
                                        <IndianRupee className="h-6 w-6 text-primary dark:text-primary" />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="border-2 border-green-200/50 dark:border-green-800/50 bg-gradient-to-br from-green-50 to-emerald-50/50 dark:from-green-950/20 dark:to-emerald-950/20">
                            <CardContent className="pt-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-green-700 dark:text-green-300">
                                            Total Collection
                                        </p>
                                        <p className="text-2xl font-bold text-green-900 dark:text-green-100 mt-2">
                                            ₹ {formatCurrency(grandTotals.totalColl)}
                                        </p>
                                        <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                                            Overall collection
                                        </p>
                                    </div>
                                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-green-100 dark:bg-green-900/50">
                                        <TrendingUp className="h-6 w-6 text-green-600 dark:text-green-400" />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="border-2 border-purple-200/50 dark:border-purple-800/50 bg-gradient-to-br from-purple-50 to-pink-50/50 dark:from-purple-950/20 dark:to-pink-950/20">
                            <CardContent className="pt-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-purple-700 dark:text-purple-300">
                                            Recovery %
                                        </p>
                                        <p className="text-3xl font-bold text-purple-900 dark:text-purple-100 mt-2">
                                            {formatPercentage(grandTotals.recPercentage)}%
                                        </p>
                                        <p className="text-xs text-purple-600 dark:text-purple-400 mt-1">
                                            Overall recovery
                                        </p>
                                    </div>
                                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-100 dark:bg-purple-900/50">
                                        <TrendingUp className="h-6 w-6 text-purple-600 dark:text-purple-400" />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </div>

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
                                        <CardDescription>
                                            Select date range for branch DCB report
                                        </CardDescription>
                                    </div>
                                </div>
                                {showReport && (
                                    <div className="flex flex-wrap gap-2">
                                        <ExportDropdown
                                            onExportPDF={handleExportPDF}
                                            onExportExcel={handleExport}
                                            onExportCSV={handleExportCSV}
                                            onExportWord={handleExportWord}
                                            reportSlug={getReportExportMode('mis-all-dcb') === 'REQUEST_QUEUE' ? 'mis-all-dcb' : undefined}
                                            canExport={canExportReport('mis-all-dcb')}
                                            exportParams={{ fromDate: submittedFromDate, toDate: submittedToDate, branchIds: 'ALL' }}
                                            className="border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-300"
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
                                    <DateInput
                                        id="fromDate"
                                        value={fromDate}
                                        onChange={(e) => setFromDate(e.target.value)}
                                        className="h-11 border-primary/30 dark:border-sidebar-accent"
                                    />
                                </div>

                                {/* To Date */}
                                <div className="space-y-2">
                                    <Label htmlFor="toDate" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Till Date <span className="text-red-500">*</span>
                                    </Label>
                                    <DateInput
                                        id="toDate"
                                        value={toDate}
                                        onChange={(e) => setToDate(e.target.value)}
                                        className="h-11 border-primary/30 dark:border-sidebar-accent"
                                    />
                                </div>

                                {/* Show Button */}
                                <div className="space-y-2">
                                    <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-200 opacity-0">
                                        Action
                                    </Label>
                                    <Button
                                        onClick={handleShowReport}
                                        disabled={isLoading}
                                        className="h-11 w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white shadow-lg shadow-emerald-500/30"
                                    >
                                        {isLoading ? (
                                            <>
                                                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
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
                                    >
                                        Reset
                                    </Button>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* DCB Report Table */}
                    {showReport && (
                        <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
                            <div className="h-1.5 bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600" />

                            {/* Print-friendly content */}
                            <div ref={printRef} className="print:p-8">
                                {/* Report Header */}
                                <CardHeader className="bg-gradient-to-r from-slate-50 via-emerald-50/60 to-teal-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker print:bg-white">
                                    <ReportHeader
                                        title="All Branch DCB Report"
                                        subtitle={`Period: ${formatDate(submittedFromDate)} to ${formatDate(submittedToDate)}`}
                                    />
                                </CardHeader>

                                <CardContent className="p-0">
                                    <div className="overflow-x-auto">
                                        <Table>
                                            <TableHeader>
                                                <TableRow className="bg-gradient-to-r from-emerald-700 to-teal-700 dark:from-emerald-800 dark:to-teal-800 hover:from-emerald-700 hover:to-teal-700">
                                                    <TableHead className="font-bold text-white text-xs sticky left-0 bg-emerald-700 z-10">Branch Name</TableHead>
                                                    <TableHead className="font-bold text-white text-xs text-center">Meeting Date</TableHead>
                                                    <TableHead className="font-bold text-white text-xs text-center"># Centers</TableHead>
                                                    <TableHead className="font-bold text-white text-xs text-center"># Clients</TableHead>
                                                    <TableHead className="font-bold text-white text-xs text-right">Opening Arr</TableHead>
                                                    <TableHead className="font-bold text-white text-xs text-right">Demand</TableHead>
                                                    <TableHead className="font-bold text-white text-xs text-right">Current Coll</TableHead>
                                                    <TableHead className="font-bold text-white text-xs text-center">Rec %</TableHead>
                                                    <TableHead className="font-bold text-white text-xs text-right">Curr Arr Coll</TableHead>
                                                    <TableHead className="font-bold text-white text-xs text-right">OD Arr Coll</TableHead>
                                                    {loanAdvanceEnabled && (
                                                        <TableHead className="font-bold text-white text-xs text-right">Advance Coll</TableHead>
                                                    )}
                                                    <TableHead className="font-bold text-white text-xs text-right">Preclosure</TableHead>
                                                    <TableHead className="font-bold text-white text-xs text-right">Total Coll</TableHead>
                                                    <TableHead className="font-bold text-white text-xs text-right">Curr Arrear</TableHead>
                                                    <TableHead className="font-bold text-white text-xs text-right">Closing Arr</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {dcbData.map((branch, index) => (
                                                    <TableRow
                                                        key={index}
                                                        className={cn(
                                                            'transition-colors',
                                                            index % 2 === 0
                                                                ? 'bg-white dark:bg-brand-green-darker hover:bg-emerald-50 dark:hover:bg-emerald-950/20'
                                                                : 'bg-green-50/50 dark:bg-brand-green-darker/50 hover:bg-emerald-50 dark:hover:bg-emerald-950/20'
                                                        )}
                                                    >
                                                        <TableCell className="font-semibold text-foreground dark:text-slate-100 sticky left-0 bg-inherit">
                                                            {branch.branchCode} - {branch.branchName}
                                                        </TableCell>
                                                        <TableCell className="text-center text-sm">{branch.meetingDate}</TableCell>
                                                        <TableCell className="text-center font-semibold text-sidebar-accent dark:text-primary">{branch.centers}</TableCell>
                                                        <TableCell className="text-center font-semibold text-purple-700 dark:text-purple-400">{branch.clients}</TableCell>
                                                        <TableCell className="text-right font-semibold text-orange-700 dark:text-orange-400">{formatCurrency(branch.openingArr)}</TableCell>
                                                        <TableCell className="text-right font-semibold text-sidebar-accent dark:text-primary">{formatCurrency(branch.demand)}</TableCell>
                                                        <TableCell className="text-right font-semibold text-green-700 dark:text-green-400">{formatCurrency(branch.currentColl)}</TableCell>
                                                        <TableCell className="text-center font-semibold text-purple-700 dark:text-purple-400">{formatPercentage(branch.recPercentage)}</TableCell>
                                                        <TableCell className="text-right font-semibold text-teal-700 dark:text-teal-400">{formatCurrency(branch.currArrColl)}</TableCell>
                                                        <TableCell className="text-right font-semibold text-cyan-700 dark:text-cyan-400">{formatCurrency(branch.odArrColl)}</TableCell>
                                                        {loanAdvanceEnabled && (
                                                            <TableCell className="text-right font-semibold text-primary dark:text-primary">{formatCurrency(branch.advanceColl)}</TableCell>
                                                        )}
                                                        <TableCell className="text-right font-semibold text-pink-700 dark:text-pink-400">{formatCurrency(branch.preclosure)}</TableCell>
                                                        <TableCell className="text-right font-bold text-emerald-700 dark:text-emerald-400">{formatCurrency(branch.totalColl)}</TableCell>
                                                        <TableCell className="text-right font-semibold text-red-700 dark:text-red-400">{formatCurrency(branch.currArrear)}</TableCell>
                                                        <TableCell className="text-right font-semibold text-orange-700 dark:text-orange-400">{formatCurrency(branch.closingArr)}</TableCell>
                                                    </TableRow>
                                                ))}

                                                {/* Grand Total Row */}
                                                <TableRow className="bg-gradient-to-r from-emerald-100 to-teal-100 dark:from-emerald-950/50 dark:to-teal-950/50 border-t-2 border-emerald-300 dark:border-emerald-700 hover:from-emerald-100 hover:to-teal-100">
                                                    <TableCell className="font-bold text-lg text-emerald-900 dark:text-emerald-100 sticky left-0 bg-gradient-to-r from-emerald-100 to-teal-100 dark:from-emerald-950/50 dark:to-teal-950/50">
                                                        Grand Total
                                                    </TableCell>
                                                    <TableCell className="text-center font-bold">-</TableCell>
                                                    <TableCell className="text-center font-bold text-sidebar-accent dark:text-green-300">{grandTotals.centers}</TableCell>
                                                    <TableCell className="text-center font-bold text-purple-800 dark:text-purple-300">{grandTotals.clients}</TableCell>
                                                    <TableCell className="text-right font-bold text-orange-800 dark:text-orange-300">{formatCurrency(grandTotals.openingArr)}</TableCell>
                                                    <TableCell className="text-right font-bold text-sidebar-accent dark:text-green-300">{formatCurrency(grandTotals.demand)}</TableCell>
                                                    <TableCell className="text-right font-bold text-green-800 dark:text-green-300">{formatCurrency(grandTotals.currentColl)}</TableCell>
                                                    <TableCell className="text-center font-bold text-purple-800 dark:text-purple-300">{formatPercentage(grandTotals.recPercentage)}</TableCell>
                                                    <TableCell className="text-right font-bold text-teal-800 dark:text-teal-300">{formatCurrency(grandTotals.currArrColl)}</TableCell>
                                                    <TableCell className="text-right font-bold text-cyan-800 dark:text-cyan-300">{formatCurrency(grandTotals.odArrColl)}</TableCell>
                                                    {loanAdvanceEnabled && (
                                                        <TableCell className="text-right font-bold text-primary dark:text-primary">{formatCurrency(grandTotals.advanceColl)}</TableCell>
                                                    )}
                                                    <TableCell className="text-right font-bold text-pink-800 dark:text-pink-300">{formatCurrency(grandTotals.preclosure)}</TableCell>
                                                    <TableCell className="text-right font-bold text-lg text-emerald-800 dark:text-emerald-300">{formatCurrency(grandTotals.totalColl)}</TableCell>
                                                    <TableCell className="text-right font-bold text-red-800 dark:text-red-300">{formatCurrency(grandTotals.currArrear)}</TableCell>
                                                    <TableCell className="text-right font-bold text-orange-800 dark:text-orange-300">{formatCurrency(grandTotals.closingArr)}</TableCell>
                                                </TableRow>
                                            </TableBody>
                                        </Table>
                                    </div>
                                </CardContent>
                            </div>
                        </Card>
                    )}

                    {/* Footer Info */}
                    {showReport && (
                        <div className="mt-6 flex items-center justify-between text-sm text-sidebar-accent dark:text-slate-400 print:hidden">
                            <p>
                                Report generated on {toDisplayDateTime(new Date())}
                            </p>
                            <p>
                                Total Branches: <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                                    {dcbData.length}
                                </span>
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
                        size: landscape;
                    }
                }
            `}</style>
        </ProtectedRoute>
    );
}
