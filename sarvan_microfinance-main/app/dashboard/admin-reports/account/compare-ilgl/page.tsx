'use client';

import { useState, useRef, useEffect } from 'react';
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
    GitCompare,
    Download,
    FileText,
    FileType,
    FileOutput,
    Printer,
    RefreshCw,
    Filter,
    Calendar,
    AlertTriangle,
    CheckCircle2,
    XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { useToast } from '@/hooks/use-toast';
import { usePermission } from '@/app/hooks/usePermission';
import { apiClient } from '@/app/lib/api-client';
import { tokenStorage } from '@/app/lib/token-storage';
import { LocalBranchFilter } from '@/components/branch/LocalBranchFilter';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { buildReportSheet, autoSizeColumns, applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { exportToCSV, exportToWord, type WordExportOptions } from '@/app/lib/report-export-utils';
import { formatReportAmount, truncateReportAmount } from '@/app/lib/utils/format-amount';
import { DateInput } from '@/components/ui/date-input';
import { toDisplayDate, toDisplayDateTime } from '@/app/lib/date-format';

// Format currency — whole rupees, no decimals (report/export amount-format requirement).
const formatCurrency = (amount: number) => formatReportAmount(amount);

export default function CompareILGLPage() {
    const { canExportReport, getReportExportMode } = usePermission();
    const [comparisonDate, setComparisonDate] = useState<string>(
        new Date().toISOString().split('T')[0]
    );
    // Submitted (applied) date snapshot — frozen until the next "Show Comparison" click.
    // Export filenames/subtitle/exportParams read this, not the live draft `comparisonDate`,
    // so editing the date input alone never changes what gets exported/printed.
    const [submittedComparisonDate, setSubmittedComparisonDate] = useState<string>(comparisonDate);
    // Page-local branch filter — does not touch the session-wide active branch
    // (see LocalBranchFilter's doc comment). BRANCH_MANAGER never sees the picker
    // (LocalBranchFilter renders nothing for them), so default to their own branch.
    const [selectedBranchId, setSelectedBranchId] = useState<string>('');
    const [isLoading, setIsLoading] = useState(false);
    const [comparisonData, setComparisonData] = useState<any[]>([]);
    const printRef = useRef<HTMLDivElement>(null);
    const { toast } = useToast();

    useEffect(() => {
        const storedUser = tokenStorage.getUser();
        if (storedUser?.role === 'BRANCH_MANAGER' && storedUser.branchId) {
            setSelectedBranchId(storedUser.branchId);
        }
    }, []);

    // Calculate statistics
    const totalEntries = comparisonData.length;
    const matchedEntries = comparisonData.filter(e => e.difference === 0).length;
    const mismatchedEntries = comparisonData.filter(e => e.difference !== 0).length;
    const totalDifference = comparisonData.reduce((sum, e) => sum + Math.abs(e.difference), 0);

    const handleGenerateReport = async () => {
        if (!comparisonDate) {
            toast({
                title: "Date Required",
                description: "Please select a comparison date.",
                variant: "destructive"
            });
            return;
        }

        if (!selectedBranchId) {
            toast({
                title: "Branch Required",
                description: "Please select a branch first.",
                variant: "destructive"
            });
            return;
        }

        setIsLoading(true);
        try {
            const response = await apiClient.get<{ ledger: string; tb: number; il: number; difference: number }[]>(
                `/admin-reports/account/compare-ilgl?date=${comparisonDate}&branchId=${selectedBranchId}`
            );

            if (response.success && response.data) {
                setComparisonData(response.data);
                setSubmittedComparisonDate(comparisonDate);
                toast({
                    title: "Comparison Completed",
                    description: `Loaded IL/GL differences for ${toDisplayDate(new Date(comparisonDate))}.`,
                });
            } else {
                toast({
                    title: "Report Error",
                    description: response.error || "Failed to fetch comparison data.",
                    variant: "destructive"
                });
                setComparisonData([]);
            }
        } catch (error) {
            console.error("API error:", error);
            toast({
                title: "System Error",
                description: "Unable to generate the comparison report.",
                variant: "destructive"
            });
        } finally {
            setIsLoading(false);
        }
    };

    const handleExport = async (format: 'pdf' | 'excel') => {
        if (comparisonData.length === 0) {
            toast({ title: "No Data", description: "Generate the report first before exporting." });
            return;
        }

        const dateStr = toDisplayDate(new Date(submittedComparisonDate));
        const fileName = `IL_GL_Comparison_${dateStr.replace(/\//g, '-')}`;

        if (format === 'pdf') {
            const { jsPDF } = await import('jspdf');
            const { ensureReportFont } = await import('@/app/lib/reports/pdf-fonts');
            const { drawCompareIlglReport } = await import('@/app/lib/reports/compare-ilgl-pdf');
            const doc = new jsPDF({ orientation: 'landscape' });
            const reportFont = await ensureReportFont(doc);

            await drawCompareIlglReport(doc, comparisonData, { subtitle: `As On: ${dateStr}` }, reportFont);

            doc.save(`${fileName}.pdf`);
            toast({ title: "PDF Exported Successfully" });

        } else if (format === 'excel') {
            const XLSX = await import('xlsx-js-style');
            const worksheet = buildReportSheet("IL GL Comparison Report", comparisonData.map(item => ({
                'Ledger': item.ledger,
                'Trial Balance (TB) INR': truncateReportAmount(item.tb),
                'Individual Ledger (IL) INR': truncateReportAmount(item.il),
                'Difference INR': truncateReportAmount(item.difference)
            })));
            autoSizeColumns(worksheet);
            applyExcelReportFont(worksheet);

            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, "IL_GL_Comparison");
            XLSX.writeFile(workbook, `${fileName}.xlsx`);
            toast({ title: "Excel Exported Successfully" });
        }
    };

    // Mirrors the same field mapping used by handleExport('excel') above (kept separate so
    // handleExport is left untouched).
    const buildCompareILGLExportRows = (): { headers: string[]; rows: (string | number)[][] } => {
        const headers = ['Ledger', 'Trial Balance (TB) INR', 'Individual Ledger (IL) INR', 'Difference INR'];
        const rows: (string | number)[][] = comparisonData.map(item => [
            item.ledger,
            formatCurrency(item.tb),
            formatCurrency(item.il),
            formatCurrency(item.difference),
        ]);
        return { headers, rows };
    };

    const handleExportCSV = () => {
        if (comparisonData.length === 0) {
            toast({ title: "No Data", description: "Generate the report first before exporting." });
            return;
        }
        const dateStr = toDisplayDate(new Date(submittedComparisonDate));
        const { headers, rows } = buildCompareILGLExportRows();
        exportToCSV(`IL_GL_Comparison_${dateStr.replace(/\//g, '-')}`, 'IL GL COMPARISON REPORT', headers, rows);
    };

    // Word-only presentation: same rows as CSV above. No totals row exists in this
    // report and 4 flat columns don't warrant grouped headers — just professional
    // header/zebra/alignment/width styling.
    const wordOptions: WordExportOptions = {
        columnAlignments: ['left', 'right', 'right', 'right'],
        columnWidthWeights: [14, 11, 11, 10],
    };

    const handleExportWord = async () => {
        if (comparisonData.length === 0) {
            toast({ title: "No Data", description: "Generate the report first before exporting." });
            return;
        }
        const dateStr = toDisplayDate(new Date(submittedComparisonDate));
        const { headers, rows } = buildCompareILGLExportRows();
        await exportToWord(`IL_GL_Comparison_${dateStr.replace(/\//g, '-')}`, 'IL GL COMPARISON REPORT', headers, rows, wordOptions);
    };

    const handlePrint = () => {
        if (comparisonData.length === 0) {
            toast({ title: "No Data", description: "Generate the report first before printing." });
            return;
        }
        window.print();
    };

    return (
        <ProtectedRoute>
            <div className="relative min-h-screen bg-gradient-to-br from-background via-purple-50/30 to-pink-50/30 dark:from-background dark:via-brand-green-darker dark:to-green-950">
                <div className="container mx-auto px-3 sm:px-6 py-4 sm:py-8">
                    {/* Header Section */}
                    <div className="mb-8">
                        <div className="flex items-center gap-4 mb-4">
                            <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-600 to-pink-600 shadow-lg shadow-purple-500/30">
                                <GitCompare className="h-7 w-7 text-white" />
                                <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/20 to-transparent" />
                            </div>
                            <div className="flex-1">
                                <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-foreground dark:text-white">
                                    Compare IL GL Values
                                </h1>
                                <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                                    Compare Individual Ledger balances with General Ledger to identify discrepancies
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Summary Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                        <Card className="border-2 border-purple-200/50 dark:border-purple-800/50 bg-gradient-to-br from-purple-50 to-pink-50/50 dark:from-purple-950/20 dark:to-pink-950/20">
                            <CardContent className="pt-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-purple-700 dark:text-purple-300">
                                            Total Ledgers
                                        </p>
                                        <p className="text-3xl font-bold text-purple-900 dark:text-purple-100 mt-2">
                                            {totalEntries}
                                        </p>
                                        <p className="text-xs text-purple-600 dark:text-purple-400 mt-1">
                                            Accounts compared
                                        </p>
                                    </div>
                                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-100 dark:bg-purple-900/50">
                                        <GitCompare className="h-6 w-6 text-purple-600 dark:text-purple-400" />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="border-2 border-green-200/50 dark:border-green-800/50 bg-gradient-to-br from-green-50 to-emerald-50/50 dark:from-green-950/20 dark:to-emerald-950/20">
                            <CardContent className="pt-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-green-700 dark:text-green-300">
                                            Matched
                                        </p>
                                        <p className="text-3xl font-bold text-green-900 dark:text-green-100 mt-2">
                                            {matchedEntries}
                                        </p>
                                        <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                                            No discrepancies
                                        </p>
                                    </div>
                                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-green-100 dark:bg-green-900/50">
                                        <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="border-2 border-red-200/50 dark:border-red-800/50 bg-gradient-to-br from-red-50 to-rose-50/50 dark:from-red-950/20 dark:to-rose-950/20">
                            <CardContent className="pt-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-red-700 dark:text-red-300">
                                            Mismatched
                                        </p>
                                        <p className="text-3xl font-bold text-red-900 dark:text-red-100 mt-2">
                                            {mismatchedEntries}
                                        </p>
                                        <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                                            Needs review
                                        </p>
                                    </div>
                                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-100 dark:bg-red-900/50">
                                        <XCircle className="h-6 w-6 text-red-600 dark:text-red-400" />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="border-2 border-amber-200/50 dark:border-amber-800/50 bg-gradient-to-br from-amber-50 to-orange-50/50 dark:from-amber-950/20 dark:to-orange-950/20">
                            <CardContent className="pt-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
                                            Total Difference
                                        </p>
                                        <p className="text-2xl font-bold text-amber-900 dark:text-amber-100 mt-2">
                                            ₹ {formatCurrency(totalDifference)}
                                        </p>
                                        <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                                            Absolute variance
                                        </p>
                                    </div>
                                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-100 dark:bg-amber-900/50">
                                        <AlertTriangle className="h-6 w-6 text-amber-600 dark:text-amber-400" />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Filters Card */}
                    <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden mb-6">
                        <div className="h-1.5 bg-gradient-to-r from-purple-600 via-pink-600 to-rose-600" />
                        <CardHeader className="bg-gradient-to-r from-slate-50 via-purple-50/60 to-pink-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                                <div className="flex items-center gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-900/30">
                                        <Filter className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                                    </div>
                                    <div>
                                        <CardTitle className="text-xl">Comparison Parameters</CardTitle>
                                        <CardDescription>
                                            Select date to compare IL and GL values
                                        </CardDescription>
                                    </div>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <ExportDropdown
                                        onExportPDF={() => handleExport('pdf')}
                                        onExportExcel={() => handleExport('excel')}
                                        onExportCSV={handleExportCSV}
                                        onExportWord={handleExportWord}
                                        reportSlug={getReportExportMode('compare-ilgl') === 'REQUEST_QUEUE' ? 'compare-ilgl' : undefined}
                                        canExport={canExportReport('compare-ilgl')}
                                        exportParams={{
                                            fromDate: submittedComparisonDate,
                                            branchIds: selectedBranchId ? [selectedBranchId] : 'ALL',
                                        }}
                                        className="border-green-300 text-green-700 hover:bg-green-50 dark:border-green-700 dark:text-green-300"
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
                            </div>
                        </CardHeader>
                        <CardContent className="pt-6">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                {/* Branch — page-local filter only (ADMIN/AREA_MANAGER see the picker;
                                    BRANCH_MANAGER is defaulted to their own branch above). Does NOT
                                    switch the session-wide active branch. */}
                                <LocalBranchFilter value={selectedBranchId} onChange={setSelectedBranchId} />

                                {/* Comparison Date */}
                                <div className="space-y-2">
                                    <Label htmlFor="comparisonDate" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Comparison Date <span className="text-red-500">*</span>
                                    </Label>
                                    <DateInput
                                        id="comparisonDate"
                                        value={comparisonDate}
                                        onChange={(e) => setComparisonDate(e.target.value)}
                                        className="h-11 border-primary/30 dark:border-sidebar-accent"
                                    />
                                </div>

                                {/* Generate Button */}
                                <div className="space-y-2">
                                    <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-200 opacity-0">
                                        Action
                                    </Label>
                                    <Button
                                        onClick={handleGenerateReport}
                                        disabled={isLoading}
                                        className="h-11 w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white shadow-lg shadow-purple-500/30"
                                    >
                                        {isLoading ? (
                                            <>
                                                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                                                Comparing...
                                            </>
                                        ) : (
                                            <>
                                                <GitCompare className="h-4 w-4 mr-2" />
                                                Show Comparison
                                            </>
                                        )}
                                    </Button>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Comparison Report Card */}
                    <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
                        <div className="h-1.5 bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600" />

                        {/* Print-friendly content */}
                        <div ref={printRef} className="print:p-8">
                            {/* Report Header */}
                            <CardHeader className="bg-gradient-to-r from-slate-50 via-purple-50/60 to-pink-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker print:bg-white">
                                <ReportHeader
                                    title="IL GL COMPARISON REPORT"
                                    subtitle={`AS ON ${toDisplayDate(new Date(submittedComparisonDate))}`}
                                />
                            </CardHeader>

                            <CardContent className="p-0">
                                <div className="overflow-x-auto">
                                    <Table>
                                        <TableHeader>
                                            <TableRow className="bg-primary dark:bg-primary hover:bg-primary dark:hover:bg-primary">
                                                <TableHead className="font-bold text-white">Ledger</TableHead>
                                                <TableHead className="text-right font-bold text-white w-40">TB</TableHead>
                                                <TableHead className="text-right font-bold text-white w-40">IL</TableHead>
                                                <TableHead className="text-right font-bold text-white w-40">Difference</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {comparisonData.length === 0 ? (
                                                <TableRow>
                                                    <TableCell colSpan={4} className="text-center py-12">
                                                        <div className="flex flex-col items-center gap-3">
                                                            <GitCompare className="h-12 w-12 text-slate-400" />
                                                            <p className="text-sidebar-accent dark:text-slate-400 font-medium">
                                                                No comparison data available
                                                            </p>
                                                            <p className="text-sm text-slate-500 dark:text-slate-500">
                                                                Select a date and click "Show Comparison"
                                                            </p>
                                                        </div>
                                                    </TableCell>
                                                </TableRow>
                                            ) : (
                                                comparisonData.map((entry, index) => (
                                                    <TableRow
                                                        key={index}
                                                        className={cn(
                                                            'transition-colors',
                                                            entry.difference !== 0
                                                                ? 'bg-red-50 dark:bg-red-950/20 hover:bg-red-100 dark:hover:bg-red-950/30 border-l-4 border-red-500'
                                                                : index % 2 === 0
                                                                    ? 'bg-white dark:bg-brand-green-darker hover:bg-green-50 dark:hover:bg-sidebar-accent'
                                                                    : 'bg-green-50/50 dark:bg-brand-green-darker/50 hover:bg-brand-green-tint dark:hover:bg-sidebar-accent'
                                                        )}
                                                    >
                                                        <TableCell className="font-semibold text-foreground dark:text-slate-100">
                                                            {entry.ledger}
                                                            {entry.difference !== 0 && (
                                                                <Badge variant="destructive" className="ml-2">
                                                                    Mismatch
                                                                </Badge>
                                                            )}
                                                        </TableCell>
                                                        <TableCell className="text-right font-medium text-sidebar-accent dark:text-primary">
                                                            ₹ {formatCurrency(entry.tb)}
                                                        </TableCell>
                                                        <TableCell className="text-right font-medium text-purple-700 dark:text-purple-400">
                                                            ₹ {formatCurrency(entry.il)}
                                                        </TableCell>
                                                        <TableCell className="text-right">
                                                            {entry.difference === 0 ? (
                                                                <span className="font-semibold text-green-700 dark:text-green-400 flex items-center justify-end gap-1">
                                                                    <CheckCircle2 className="h-4 w-4" />
                                                                    ₹ 0
                                                                </span>
                                                            ) : (
                                                                <span className="font-bold text-red-700 dark:text-red-400 flex items-center justify-end gap-1">
                                                                    <XCircle className="h-4 w-4" />
                                                                    ₹ {formatCurrency(Math.abs(entry.difference))}
                                                                </span>
                                                            )}
                                                        </TableCell>
                                                    </TableRow>
                                                ))
                                            )}
                                        </TableBody>
                                    </Table>
                                </div>
                            </CardContent>
                        </div>
                    </Card>

                    {/* Footer Info */}
                    <div className="mt-6 flex items-center justify-between text-sm text-sidebar-accent dark:text-slate-400 print:hidden">
                        <p>
                            Report generated on {toDisplayDateTime(new Date())}
                        </p>
                        <p>
                            Status: <span className={cn(
                                "font-semibold",
                                mismatchedEntries === 0 ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"
                            )}>
                                {mismatchedEntries === 0 ? 'âœ“ All Matched' : `âœ— ${mismatchedEntries} Mismatches Found`}
                            </span>
                        </p>
                    </div>
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
