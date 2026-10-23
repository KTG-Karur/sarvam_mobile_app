'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
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
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { RefreshCw, Download, Loader2, FileText, CreditCard, DollarSign, TrendingUp, Users, Printer, FileDown, FileSpreadsheet, FileType } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MetricCard } from '@/components/dashboard/MetricCard';
import { jsPDF } from 'jspdf';
import * as XLSX from 'xlsx-js-style';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { drawLoanIndexReport } from '@/app/lib/reports/loan-index-pdf';
import { reportHeaderRows, autoSizeColumns, applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { exportToWord, type WordExportOptions } from '@/app/lib/report-export-utils';
import { formatReportAmount, truncateReportAmount } from '@/app/lib/utils/format-amount';
import { usePermission } from '@/app/hooks/usePermission';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';
import { PageLoader } from '@/components/ui/page-loader';
import { toDisplayDate } from '@/app/lib/date-format';

type LoanIndexReportData = {
    metadata: {
        branchName: string;
        branchCode: string;
        centerCode?: string;
        centerName: string;
        centerFullDisplay?: string;
        centerAddress?: string;
        centerMeetingDay?: string;
        centerMeetingPlace?: string;
        centerContactPerson?: string;
        centerContactNumber?: string;
        centerLeader: string;
        totalClients: number;
        indexNo: string;
        officerName: string;
        officerCode: string;
        centerOs: number;
        centerArrear: number;
        indexDate: string;
    };
    loans: {
        slNo: number;
        clientId: string;
        clientName: string;
        nominee: string;
        highmarkScore?: number | null;
        highmarkStatus?: string;
        loanOs: number;
        arrear: number;
        loanSlNo: number;
        loanAmount: number;
        totalDues: number;
        purpose: string;
    }[];
};

type Center = {
    id: string;
    name: string;
    code: string;
};

type BranchOption = {
    id: string;
    name: string;
    code: string;
};

type IndexOption = {
    id: string;
    indexNo: string;
    indexDate: string;
};

export function LoanIndexClient() {
    const { toast } = useToast();
    const { hasRole, canExportReport, getReportExportMode } = usePermission();
    const canChooseBranch = hasRole('admin') || hasRole('area-manager');
    const [branches, setBranches] = useState<BranchOption[]>([]);
    const [selectedBranch, setSelectedBranch] = useState<string>('all');
    const [centers, setCenters] = useState<Center[]>([]);
    const [indexes, setIndexes] = useState<IndexOption[]>([]);
    const [selectedCenter, setSelectedCenter] = useState<string>('');
    const [selectedIndexId, setSelectedIndexId] = useState<string>('');
    const [isLoading, setIsLoading] = useState(false);
    const [isInitialLoading, setIsInitialLoading] = useState(true);
    const [reportData, setReportData] = useState<LoanIndexReportData | null>(null);

    // Fetch branches (admin/AM only) on mount
    useEffect(() => {
        if (!canChooseBranch) return;
        fetch('/api/branches')
            .then((r) => r.json())
            .then((d) => setBranches(Array.isArray(d) ? d : (d.data ?? [])))
            .catch(() => {});
    }, [canChooseBranch]);

    // Fetch centers on mount / when the branch filter changes
    useEffect(() => {
        const fetchCenters = async () => {
            try {
                const params = new URLSearchParams();
                if (canChooseBranch && selectedBranch !== 'all') params.set('branchId', selectedBranch);
                const response = await fetch(`/api/centers?${params.toString()}`);
                const result = await response.json();
                if (result.success) {
                    setCenters(result.data);
                }
            } catch (error) {
                console.error('Error fetching centers:', error);
                toast({
                    title: 'Error',
                    description: 'Failed to fetch centers.',
                    variant: 'destructive',
                });
            } finally {
                setIsInitialLoading(false);
            }
        };
        fetchCenters();
    }, [toast, canChooseBranch, selectedBranch]);

    // Fetch indexes when center changes
    useEffect(() => {
        const fetchIndexes = async () => {
            if (!selectedCenter) {
                setIndexes([]);
                setSelectedIndexId('');
                return;
            }

            try {
                const response = await fetch(`/api/loan-indexes?centerId=${selectedCenter}`);
                const result = await response.json();
                if (result.success) {
                    setIndexes(result.data);
                }
            } catch (error) {
                console.error('Error fetching indexes:', error);
            }
        };
        fetchIndexes();
    }, [selectedCenter]);

    // Calculate metrics
    const metrics = useMemo(() => {
        if (!reportData || reportData.loans.length === 0) {
            return {
                totalLoans: 0,
                totalLoanAmount: 0,
                averageLoanAmount: 0,
                centerOs: 0,
                totalClientOs: 0,
                totalClientArrear: 0,
            };
        }

        const totalLoanAmount = reportData.loans.reduce((sum, item) => sum + item.loanAmount, 0);
        const totalClientOs = reportData.loans.reduce((sum, item) => sum + item.loanOs, 0);
        const totalClientArrear = reportData.loans.reduce((sum, item) => sum + item.arrear, 0);
        const averageLoanAmount = totalLoanAmount / reportData.loans.length;

        return {
            totalLoans: reportData.loans.length,
            totalLoanAmount,
            averageLoanAmount,
            centerOs: reportData.metadata.centerOs,
            totalClientOs,
            totalClientArrear,
        };
    }, [reportData]);

    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(reportData?.loans ?? []);

    const handleShow = async () => {
        if (!selectedCenter || !selectedIndexId) {
            toast({
                title: 'Selection required',
                description: 'Please select both a center and an index number.',
                variant: 'destructive',
            });
            return;
        }

        setIsLoading(true);
        try {
            const response = await fetch(`/api/reports/others/loan-index?centerId=${selectedCenter}&indexId=${selectedIndexId}`);
            const result = await response.json();

            if (result.success) {
                setReportData(result.data);
                toast({
                    title: 'Report generated',
                    description: `Successfully loaded ${result.data.loans.length} loan records.`,
                });
            } else {
                throw new Error(result.error || 'Failed to fetch report data');
            }
        } catch (error) {
            console.error('Error fetching report:', error);
            toast({
                title: 'Error',
                description: error instanceof Error ? error.message : 'Failed to fetch report data',
                variant: 'destructive',
            });
        } finally {
            setIsLoading(false);
        }
    };

    const handleReset = () => {
        setSelectedBranch('all');
        setSelectedCenter('');
        setSelectedIndexId('');
        setReportData(null);
        setIndexes([]);
    };

    const handlePrint = () => {
        window.print();
    };

    const handlePdfExport = async () => {
        if (!reportData) return;

        const doc = new jsPDF({
            orientation: 'landscape',
            unit: 'mm',
            format: 'a4',
        });

        try {
            const reportFont = await ensureReportFont(doc);
            await drawLoanIndexReport(doc, reportData, reportFont);

            doc.save(`Loan_Index_Report_${reportData.metadata.indexNo}.pdf`);
            toast({
                title: 'PDF Exported',
                description: `Report ${reportData.metadata.indexNo} downloaded successfully.`,
            });
        } catch (error) {
            console.error('PDF Export error:', error);
            toast({ title: 'Export Failed', description: 'Failed to generate PDF.', variant: 'destructive' });
        }
    };

    const handleExport = () => {
        if (!reportData) return;

        // Construct CSV
        const headers = ['SL No', 'Client ID', 'Client Name', 'Nominee', 'High Mark Score', 'Loan O/S', 'Arrear', 'Cycle', 'Loan Amount', 'Tenure', 'Purpose'];
        const rows = reportData.loans.map(loan => [
            loan.slNo,
            loan.clientId,
            `"${loan.clientName}"`, // Quote names for safety
            `"${loan.nominee}"`,
            loan.highmarkScore ?? loan.highmarkStatus ?? 'N/A',
            loan.loanOs,
            loan.arrear,
            loan.loanSlNo,
            loan.loanAmount,
            loan.totalDues,
            `"${loan.purpose}"`
        ]);

        const totalsRow = ['TOTALS:', '', '', '', '', metrics.totalClientOs, metrics.totalClientArrear, '', metrics.totalLoanAmount, '', ''];

        const csvContent = [
            headers.join(','),
            ...rows.map(row => row.join(',')),
            totalsRow.join(','),
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `Loan_Index_Report_${reportData.metadata.indexNo}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const buildLoanIndexExportRows = (): { headers: (string | number)[]; rows: (string | number)[][] } => {
        const headers = ['SL No', 'Client ID', 'Client Name', 'Nominee', 'High Mark Score', 'Loan O/S', 'Arrear', 'Cycle', 'Loan Amount', 'Tenure', 'Purpose'];
        const rows = (reportData?.loans ?? []).map(loan => [
            loan.slNo,
            loan.clientId,
            loan.clientName,
            loan.nominee,
            loan.highmarkScore ?? loan.highmarkStatus ?? 'N/A',
            truncateReportAmount(loan.loanOs),
            truncateReportAmount(loan.arrear),
            loan.loanSlNo,
            truncateReportAmount(loan.loanAmount),
            loan.totalDues,
            loan.purpose,
        ]);
        if (reportData && reportData.loans.length > 0) {
            rows.push(['TOTALS:', '', '', '', '', truncateReportAmount(metrics.totalClientOs), truncateReportAmount(metrics.totalClientArrear), '', truncateReportAmount(metrics.totalLoanAmount), '', '']);
        }
        return { headers, rows };
    };

    const handleExportExcel = () => {
        if (!reportData) return;
        const { headers, rows } = buildLoanIndexExportRows();
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet([...reportHeaderRows(`Loan Index Report: ${reportData.metadata.indexNo}`), headers, ...rows]);
        autoSizeColumns(ws);
        applyExcelReportFont(ws);
        XLSX.utils.book_append_sheet(wb, ws, 'Loan Index');
        XLSX.writeFile(wb, `Loan_Index_Report_${reportData.metadata.indexNo}.xlsx`);
    };

    // Word-only presentation: same rows as Excel above, but the trailing "TOTALS:" row
    // (when present) is split off for distinct styling. 11 flat columns — no genuine
    // repeated-prefix pairs to group.
    const buildLoanIndexWordOptions = (
        rows: (string | number)[][]
    ): { bodyRows: (string | number)[][]; options: WordExportOptions } => {
        const hasTotals = rows.length > 0 && rows[rows.length - 1][0] === 'TOTALS:';
        return {
            bodyRows: hasTotals ? rows.slice(0, -1) : rows,
            options: {
                columnAlignments: ['center', 'center', 'left', 'left', 'center', 'right', 'right', 'center', 'right', 'right', 'left'],
                columnWidthWeights: [6, 8, 14, 10, 9, 8, 8, 6, 9, 7, 12],
                totalsRow: hasTotals ? rows[rows.length - 1] : undefined,
            },
        };
    };

    const handleExportWord = async () => {
        if (!reportData) return;
        const { headers, rows } = buildLoanIndexExportRows();
        const { bodyRows, options } = buildLoanIndexWordOptions(rows);
        await exportToWord(`Loan_Index_Report_${reportData.metadata.indexNo}`, `LOAN INDEX REPORT: ${reportData.metadata.indexNo}`, headers, bodyRows, options);
    };

    if (isInitialLoading) {
        return <PageLoader fullScreen={false} />;
    }

    return (
        <div className="space-y-6">
            <style dangerouslySetInnerHTML={{
                __html: `
                @media print {
                    [role="status"], [class*="toast"], .toast-container, #toast-root { display: none !important; }
                    .no-print { display: none !important; }
                }
            ` }} />
            {/* Metric Cards - Hidden in Print */}
            {reportData && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 print:hidden">
                    <MetricCard
                        title="Total Loans"
                        value={metrics.totalLoans.toString()}
                        subtitle="Applications in Index"
                        icon={CreditCard}
                        gradient="blue"
                    />
                    <MetricCard
                        title="Total Loan Amount"
                        value={`₹${formatReportAmount(metrics.totalLoanAmount)}`}
                        subtitle="Total sum for index"
                        icon={DollarSign}
                        gradient="green"
                    />
                    <MetricCard
                        title="Avg Loan Amount"
                        value={`₹${formatReportAmount(metrics.averageLoanAmount)}`}
                        subtitle="Average per client"
                        icon={TrendingUp}
                        gradient="purple"
                    />
                    <MetricCard
                        title="Center O/S"
                        value={`₹${formatReportAmount(metrics.centerOs)}`}
                        subtitle="Current center outstanding"
                        icon={Users}
                        gradient="indigo"
                    />
                </div>
            )}

            {/* Filter Section - Hidden in Print */}
            <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40 print:hidden">
                <CardHeader className="bg-gradient-to-r from-primary via-primary to-purple-600 px-6 py-4">
                    <CardTitle className="text-lg font-semibold text-white">
                        Loan Index Report Filters
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-6">
                    <div className={cn('grid grid-cols-1 gap-6 mb-6', canChooseBranch ? 'md:grid-cols-3' : 'md:grid-cols-2')}>
                        {canChooseBranch && (
                            <div className="space-y-2">
                                <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                                    Branch
                                </Label>
                                <Select
                                    value={selectedBranch}
                                    onValueChange={(v) => { setSelectedBranch(v); setSelectedCenter(''); }}
                                >
                                    <SelectTrigger className="w-full bg-white dark:bg-sidebar-accent">
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
                        )}

                        <div className="space-y-2">
                            <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                                Center Name
                            </Label>
                            <Select value={selectedCenter} onValueChange={setSelectedCenter}>
                                <SelectTrigger className="w-full bg-white dark:bg-sidebar-accent">
                                    <SelectValue placeholder="-- SELECT CENTER --" />
                                </SelectTrigger>
                                <SelectContent>
                                    {centers.map((center) => (
                                        <SelectItem key={center.id} value={center.id}>
                                            {center.code} - {center.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                                Index No. (Based on selection)
                            </Label>
                            <Select value={selectedIndexId} onValueChange={setSelectedIndexId} disabled={!selectedCenter}>
                                <SelectTrigger className="w-full bg-white dark:bg-sidebar-accent">
                                    <SelectValue placeholder={selectedCenter ? "-- SELECT INDEX --" : "Select Center First"} />
                                </SelectTrigger>
                                <SelectContent>
                                    {indexes.map((index) => (
                                        <SelectItem key={index.id} value={index.id}>
                                            {index.indexNo} ({toDisplayDate(new Date(index.indexDate))})
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-3">
                        <Button
                            onClick={handleShow}
                            disabled={isLoading}
                            className="bg-gradient-to-r from-primary to-primary hover:from-sidebar-accent hover:to-primary text-white shadow-lg min-w-[120px]"
                        >
                            {isLoading ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            ) : (
                                <FileText className="h-4 w-4 mr-2" />
                            )}
                            Show Report
                        </Button>
                        <Button onClick={handleReset} variant="outline" className="border-primary/30 hover:bg-green-50">
                            <RefreshCw className="h-4 w-4 mr-2" />
                            Reset
                        </Button>
                        <Button
                            onClick={handlePrint}
                            disabled={!reportData}
                            className="bg-sidebar-accent hover:bg-brand-green-darker text-white shadow-lg"
                        >
                            <Printer className="h-4 w-4 mr-2" />
                            Print Report
                        </Button>
                        <ExportDropdown
                            onExportPDF={reportData ? handlePdfExport : undefined}
                            onExportExcel={reportData ? handleExportExcel : undefined}
                            onExportCSV={reportData ? handleExport : undefined}
                            canExport={canExportReport('loan-index')}
                            onExportWord={reportData ? handleExportWord : undefined}
                            reportSlug={reportData && getReportExportMode('loan-index') === 'REQUEST_QUEUE' ? 'loan-index' : undefined}
                            exportParams={{
                                fromDate: null,
                                toDate: null,
                                branchIds: canChooseBranch && selectedBranch !== 'all' ? [selectedBranch] : 'ALL',
                                filters: { centerId: selectedCenter, indexId: selectedIndexId },
                            }}
                            className="border-primary/50 text-sidebar-accent hover:bg-green-50"
                        />
                    </div>
                </CardContent>
            </Card>

            {/* Main Report View */}
            {reportData && (
                <>
                    {/* Dashboard Preview Table - Hidden in Print */}
                    <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40 print:hidden overflow-hidden">
                        <CardHeader className="bg-gradient-to-r from-primary via-primary to-purple-600 px-6 py-4">
                            <CardTitle className="text-lg font-semibold text-white flex justify-between items-center">
                                <span>Index Report Preview: {reportData.metadata.indexNo}</span>
                                <span className="text-sm font-normal opacity-90">{reportData.metadata.centerName}</span>
                            </CardTitle>
                        </CardHeader>
                        <div className="flex flex-wrap items-center gap-4 px-6 pt-4">
                            <TableSearchInput
                                value={tableSearchQuery}
                                onChange={setTableSearchQuery}
                                placeholder="Search loan index..."
                                className="ml-auto"
                            />
                        </div>
                        <CardContent className="p-0">
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow className="bg-green-50 dark:bg-sidebar-accent/50">
                                            <TableHead className="w-12 text-center">SL</TableHead>
                                            <TableHead>Client ID</TableHead>
                                            <TableHead>Client Name</TableHead>
                                            <TableHead>Nominee</TableHead>
                                            <TableHead className="text-center">High Mark</TableHead>
                                            <TableHead className="text-right">Loan O/S</TableHead>
                                            <TableHead className="text-center">Cycle</TableHead>
                                            <TableHead className="text-right">Amount</TableHead>
                                            <TableHead className="text-center">Dues</TableHead>
                                            <TableHead>Purpose</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {searchedRows.map((row) => (
                                            <TableRow key={row.slNo} className="hover:bg-green-50/50 dark:hover:bg-sidebar-accent/50">
                                                <TableCell className="text-center font-medium">{row.slNo}</TableCell>
                                                <TableCell className="font-mono text-xs">{row.clientId}</TableCell>
                                                <TableCell className="font-medium text-foreground dark:text-slate-100">{row.clientName}</TableCell>
                                                <TableCell className="text-sidebar-accent dark:text-slate-300">{row.nominee}</TableCell>
                                                <TableCell className="text-center">
                                                    {row.highmarkScore != null ? (
                                                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300">
                                                            {row.highmarkScore}
                                                        </span>
                                                    ) : (
                                                        <span className="text-muted-foreground text-xs">{row.highmarkStatus || 'N/A'}</span>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-right">₹{formatReportAmount(row.loanOs)}</TableCell>
                                                <TableCell className="text-center">{row.loanSlNo}</TableCell>
                                                <TableCell className="text-right font-semibold text-sidebar-accent dark:text-primary">
                                                    ₹{formatReportAmount(row.loanAmount)}
                                                </TableCell>
                                                <TableCell className="text-center">{row.totalDues}</TableCell>
                                                <TableCell className="text-sidebar-accent dark:text-slate-300 text-sm">{row.purpose}</TableCell>
                                            </TableRow>
                                        ))}
                                        <TableRow className="bg-brand-green-tint/50 dark:bg-sidebar-accent/80 font-bold">
                                            <TableCell colSpan={5} className="text-right py-4">TOTALS:</TableCell>
                                            <TableCell className="text-right py-4">₹{formatReportAmount(metrics.totalClientOs)}</TableCell>
                                            <TableCell className="text-center"></TableCell>
                                            <TableCell className="text-right text-sidebar-accent dark:text-primary py-4">
                                                ₹{formatReportAmount(metrics.totalLoanAmount)}
                                            </TableCell>
                                            <TableCell colSpan={2}></TableCell>
                                        </TableRow>
                                    </TableBody>
                                </Table>
                            </div>
                        </CardContent>
                    </Card>

                    {/* PRINT VIEW - Matches Sample Image */}
                    <div className="hidden print:block bg-white text-black p-8 font-serif leading-tight">
                        <style dangerouslySetInnerHTML={{
                            __html: `
                            @media print {
                                @page { size: portrait; margin: 1cm; }
                                body { -webkit-print-color-adjust: exact; }
                                .no-print { display: none !important; }
                            }
                        ` }} />

                        {/* Header Section */}
                        <ReportHeader
                            title="Loan Index Report"
                            subtitle={`${reportData.metadata.branchCode} - ${reportData.metadata.branchName}`}
                        />

                        {/* Metadata Rows */}
                        <div className="grid grid-cols-2 gap-y-2 mb-6 text-sm border-b pb-4">
                            <div className="flex">
                                <span className="font-bold w-32 uppercase">Center Name:</span>
                                <span>{reportData.metadata.centerFullDisplay || reportData.metadata.centerName}</span>
                            </div>
                            <div className="flex">
                                <span className="font-bold w-32 uppercase text-xs">Officer Name:</span>
                                <span className="text-xs">{reportData.metadata.officerCode} - {reportData.metadata.officerName}</span>
                            </div>
                            <div className="flex">
                                <span className="font-bold w-32 uppercase text-xs">Center Leader:</span>
                                <span className="text-xs">{reportData.metadata.centerLeader}</span>
                            </div>
                            <div className="flex">
                                <span className="font-bold w-32 uppercase text-xs">Total Clients:</span>
                                <span className="text-xs">{reportData.metadata.totalClients}</span>
                            </div>
                            <div className="flex">
                                <span className="font-bold w-32 uppercase text-xs">Meeting Info:</span>
                                <span className="text-xs">{reportData.metadata.centerMeetingDay} ({reportData.metadata.centerMeetingPlace})</span>
                            </div>
                            <div className="flex">
                                <span className="font-bold w-32 uppercase text-xs">Center Address:</span>
                                <span className="text-xs">{reportData.metadata.centerAddress}</span>
                            </div>
                            <div className="flex">
                                <span className="font-bold w-32 uppercase">Center O/S:</span>
                                <span>{formatReportAmount(reportData.metadata.centerOs)} / Center Arrear: {formatReportAmount(reportData.metadata.centerArrear)}</span>
                            </div>
                            <div className="flex">
                                <span className="font-bold w-32 uppercase">Index No:</span>
                                <span className="font-mono">{reportData.metadata.indexNo}</span>
                            </div>
                            <div className="flex">
                                <span className="font-bold w-32 uppercase">Index Date:</span>
                                <span>{toDisplayDate(new Date(reportData.metadata.indexDate))}</span>
                            </div>
                        </div>

                        {/* Report Table */}
                        <table className="w-full border-collapse border border-black text-xs mb-8">
                            <thead>
                                <tr className="bg-gray-100">
                                    <th className="border border-black px-1 py-2 w-8">SL No</th>
                                    <th className="border border-black px-1 py-2">Client ID</th>
                                    <th className="border border-black px-2 py-2 text-left">Client Name</th>
                                    <th className="border border-black px-2 py-2 text-left">Nominee</th>
                                    <th className="border border-black px-1 py-2">High Mark</th>
                                    <th className="border border-black px-1 py-2">Loan O/S</th>
                                    <th className="border border-black px-1 py-2">Arrear</th>
                                    <th className="border border-black px-1 py-2">Loan SL No</th>
                                    <th className="border border-black px-1 py-2 text-right">Loan Amount</th>
                                    <th className="border border-black px-1 py-2">Total Dues</th>
                                    <th className="border border-black px-1 py-2 text-left">Purpose</th>
                                </tr>
                            </thead>
                            <tbody>
                                {reportData.loans.map((row) => (
                                    <tr key={row.slNo}>
                                        <td className="border border-black px-1 py-2 text-center">{row.slNo}</td>
                                        <td className="border border-black px-1 py-2 text-center font-mono">{row.clientId}</td>
                                        <td className="border border-black px-2 py-2 font-bold">{row.clientName}</td>
                                        <td className="border border-black px-2 py-2">{row.nominee}</td>
                                        <td className="border border-black px-1 py-2 text-center font-semibold">{row.highmarkScore ?? row.highmarkStatus ?? 'N/A'}</td>
                                        <td className="border border-black px-1 py-2 text-center">{formatReportAmount(row.loanOs)}</td>
                                        <td className="border border-black px-1 py-2 text-center">{formatReportAmount(row.arrear)}</td>
                                        <td className="border border-black px-1 py-2 text-center">{row.loanSlNo}</td>
                                        <td className="border border-black px-1 py-2 text-right font-bold">{formatReportAmount(row.loanAmount)}</td>
                                        <td className="border border-black px-1 py-2 text-center">{row.totalDues}</td>
                                        <td className="border border-black px-1 py-2">{row.purpose}</td>
                                    </tr>
                                ))}
                                <tr className="font-bold">
                                    <td colSpan={5} className="border border-black px-2 py-2 text-right">TOTALS:</td>
                                    <td className="border border-black px-1 py-2 text-center">{formatReportAmount(metrics.totalClientOs)}</td>
                                    <td className="border border-black px-1 py-2 text-center">{formatReportAmount(metrics.totalClientArrear)}</td>
                                    <td className="border border-black px-1 py-2 text-center"></td>
                                    <td className="border border-black px-1 py-2 text-right">{formatReportAmount(metrics.totalLoanAmount)}</td>
                                    <td colSpan={2} className="border border-black px-1 py-2"></td>
                                </tr>
                            </tbody>
                        </table>

                        {/* Signatures Footer */}
                        <div className="mt-12">
                            <div className="grid grid-cols-2 gap-y-16">
                                <div className="border-t border-black pt-2 w-48 text-center text-sm font-bold">
                                    [FDO Signature]
                                </div>
                                <div className="border-t border-black pt-2 w-48 text-center text-sm font-bold ml-auto">
                                    Manager.<br />[BM Signature]
                                </div>
                                <div className="border-t border-black pt-2 w-48 text-center text-sm font-bold">
                                    [DM/AM Signature]
                                </div>
                                <div className="border-t border-black pt-2 w-48 text-center text-sm font-bold ml-auto">
                                    [LDO Signature]
                                </div>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
