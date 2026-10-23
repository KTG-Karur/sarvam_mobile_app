'use client';

import { useState, useMemo, useEffect } from 'react';
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
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { Calendar, RefreshCw, Download, Loader2, FileText, Users, Building2, UserCheck, UserX, UserPlus, Banknote, AlertTriangle, FileBarChart, FileType, FileOutput } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MetricCard } from '@/components/dashboard/MetricCard';
import { apiClient } from '@/app/lib/api-client';
import * as XLSX from 'xlsx-js-style';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { buildReportSheet, autoSizeColumns, applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { exportToCSV, exportToWord, type WordExportOptions } from '@/app/lib/report-export-utils';
import { drawPdfReportHeader } from '@/app/lib/reports/pdf-report-header';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { formatReportAmount, truncateReportAmount } from '@/app/lib/utils/format-amount';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';
import { usePermission } from '@/app/hooks/usePermission';
import { DateInput } from '@/components/ui/date-input';

interface FDOPerformanceData {
    sino: number;
    branch: string;
    fdo: string;
    totalCenters: number;
    totalMembers: number;
    active: number;
    wb: number;
    newMembers: number;
    dropped: number;
    disbursedCount: number;
    totalDisbursedAmt: number;
    totalColl: number;
    totalDemand: number;
    totalCollected: number;
    totalArrears: number;
    loanOs: number;
    overdueCount: number;
    paidCount: number;
    closedLoans: number;
    activeLoans: number;
}

type BranchOption = { id: string; name: string; code: string };

export function FDOPerformanceClient() {
    const { toast } = useToast();
    const { canExportReport, getReportExportMode } = usePermission();
    const [fromDate, setFromDate] = useState('');
    const [tillDate, setTillDate] = useState('');
    const [selectedBranch, setSelectedBranch] = useState<string>('all');
    const [branches, setBranches] = useState<BranchOption[]>([]);

    // Submitted snapshot — updated only when "Show" is clicked. Export
    // filenames/subtitles/exportParams read these, not the live draft state above.
    const [submittedFromDate, setSubmittedFromDate] = useState<string>(fromDate);
    const [submittedTillDate, setSubmittedTillDate] = useState<string>(tillDate);
    const [submittedBranch, setSubmittedBranch] = useState<string>(selectedBranch);

    const [isLoading, setIsLoading] = useState(false);
    const [showReport, setShowReport] = useState(false);
    const [data, setData] = useState<FDOPerformanceData[]>([]);

    useEffect(() => {
        fetch('/api/branches')
            .then((r) => r.json())
            .then((d) => setBranches(Array.isArray(d) ? d : (d.data ?? [])))
            .catch(() => {});
    }, []);

    const totals = useMemo(() => ({
        totalFDOs: data.length,
        totalCenters: data.reduce((s, i) => s + i.totalCenters, 0),
        totalMembers: data.reduce((s, i) => s + i.totalMembers, 0),
        totalActive: data.reduce((s, i) => s + i.active, 0),
        totalWB: data.reduce((s, i) => s + i.wb, 0),
        totalNew: data.reduce((s, i) => s + i.newMembers, 0),
        totalDropped: data.reduce((s, i) => s + i.dropped, 0),
        totalDisbursedCount: data.reduce((s, i) => s + i.disbursedCount, 0),
        totalDisbursedAmt: data.reduce((s, i) => s + i.totalDisbursedAmt, 0),
        totalColl: data.reduce((s, i) => s + i.totalColl, 0),
        totalDemand: data.reduce((s, i) => s + i.totalDemand, 0),
        totalCollected: data.reduce((s, i) => s + i.totalCollected, 0),
        totalArrears: data.reduce((s, i) => s + i.totalArrears, 0),
        totalLoanOs: data.reduce((s, i) => s + i.loanOs, 0),
        totalOverdue: data.reduce((s, i) => s + i.overdueCount, 0),
        totalPaid: data.reduce((s, i) => s + i.paidCount, 0),
        totalClosed: data.reduce((s, i) => s + i.closedLoans, 0),
        totalActiveLoans: data.reduce((s, i) => s + i.activeLoans, 0),
    }), [data]);

    const activeRate = totals.totalMembers > 0 ? Math.round((totals.totalActive / totals.totalMembers) * 100) : 0;

    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(data);

    const handleShow = async () => {
        if (!fromDate || !tillDate) {
            toast({ title: 'Date range required', description: 'Please select both From Date and Till Date.', variant: 'destructive' });
            return;
        }
        setIsLoading(true);
        try {
            const branchParam = selectedBranch !== 'all' ? `&branchId=${selectedBranch}` : '';
            const response = await apiClient.get(`/reports/employee/fdo-performance?fromDate=${fromDate}&tillDate=${tillDate}${branchParam}`);
            const rows = Array.isArray(response.data) ? response.data : [];
            setData(rows);
            setShowReport(true);
            setSubmittedFromDate(fromDate);
            setSubmittedTillDate(tillDate);
            setSubmittedBranch(selectedBranch);
            toast({ title: 'Report Generated', description: `Loaded performance data for ${rows.length} FDOs.` });
        } catch (error) {
            console.error('FDO Performance fetch error:', error);
            toast({ title: 'Fetch Failed', description: 'Could not load FDO performance data.', variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
    };

    const handleReset = () => {
        setFromDate('');
        setTillDate('');
        setSelectedBranch('all');
        setSubmittedFromDate('');
        setSubmittedTillDate('');
        setSubmittedBranch('all');
        setShowReport(false);
        setData([]);
    };

    const handleExport = () => {
        if (data.length === 0) {
            toast({ title: 'No data', description: 'Generate the report first.', variant: 'destructive' });
            return;
        }
        const exportData: Record<string, string | number>[] = data.map(r => ({
            'SINO': r.sino, 'BRANCH': r.branch, 'FDO': r.fdo,
            'TOTAL_CENTERS': r.totalCenters, 'TOTAL_MEMBERS': r.totalMembers,
            'ACTIVE': r.active, 'WB': r.wb, 'NEW_MEMBERS': r.newMembers, 'DROPPED': r.dropped,
            'DISBURSED_COUNT': r.disbursedCount, 'TOTAL_DISBURSED_AMT': truncateReportAmount(r.totalDisbursedAmt),
            'TOTAL_COLL': truncateReportAmount(r.totalColl), 'TOTAL_DEMAND': truncateReportAmount(r.totalDemand),
            'TOTAL_COLLECTED': truncateReportAmount(r.totalCollected), 'TOTAL_ARREARS': truncateReportAmount(r.totalArrears),
            'LOAN_OS': truncateReportAmount(r.loanOs), 'OVERDUE_COUNT': r.overdueCount, 'PAID_COUNT': r.paidCount,
            'CLOSED_LOANS': r.closedLoans, 'ACTIVE_LOANS': r.activeLoans,
        }));
        if (data.length > 0) {
            exportData.push({
                'SINO': '', 'BRANCH': '', 'FDO': 'TOTAL:',
                'TOTAL_CENTERS': totals.totalCenters, 'TOTAL_MEMBERS': totals.totalMembers,
                'ACTIVE': totals.totalActive, 'WB': totals.totalWB, 'NEW_MEMBERS': totals.totalNew, 'DROPPED': totals.totalDropped,
                'DISBURSED_COUNT': totals.totalDisbursedCount, 'TOTAL_DISBURSED_AMT': truncateReportAmount(totals.totalDisbursedAmt),
                'TOTAL_COLL': truncateReportAmount(totals.totalColl), 'TOTAL_DEMAND': truncateReportAmount(totals.totalDemand),
                'TOTAL_COLLECTED': truncateReportAmount(totals.totalCollected), 'TOTAL_ARREARS': truncateReportAmount(totals.totalArrears),
                'LOAN_OS': truncateReportAmount(totals.totalLoanOs), 'OVERDUE_COUNT': totals.totalOverdue, 'PAID_COUNT': totals.totalPaid,
                'CLOSED_LOANS': totals.totalClosed, 'ACTIVE_LOANS': totals.totalActiveLoans,
            });
        }
        const ws = buildReportSheet('FDO Performance Report', exportData);
        autoSizeColumns(ws);
        applyExcelReportFont(ws);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'FDO Performance');
        XLSX.writeFile(wb, `FDO_Performance_${submittedFromDate}_to_${submittedTillDate}.xlsx`);
        toast({ title: 'Export Complete', description: 'FDO Performance report exported.' });
    };

    // Mirrors the same field mapping used by handleExport above (kept separate so
    // handleExport is left untouched).
    const buildFdoPerformanceExportRows = (): { headers: string[]; rows: (string | number)[][] } => {
        const headers = ['SINO', 'BRANCH', 'FDO', 'TOTAL_CENTERS', 'TOTAL_MEMBERS', 'ACTIVE', 'WB', 'NEW_MEMBERS', 'DROPPED',
            'DISBURSED_COUNT', 'TOTAL_DISBURSED_AMT', 'TOTAL_COLL', 'TOTAL_DEMAND', 'TOTAL_COLLECTED', 'TOTAL_ARREARS',
            'LOAN_OS', 'OVERDUE_COUNT', 'PAID_COUNT', 'CLOSED_LOANS', 'ACTIVE_LOANS'];
        const rows: (string | number)[][] = data.map(r => [
            r.sino, r.branch, r.fdo, r.totalCenters, r.totalMembers, r.active, r.wb, r.newMembers, r.dropped,
            r.disbursedCount, formatReportAmount(r.totalDisbursedAmt), formatReportAmount(r.totalColl), formatReportAmount(r.totalDemand), formatReportAmount(r.totalCollected), formatReportAmount(r.totalArrears),
            formatReportAmount(r.loanOs), r.overdueCount, r.paidCount, r.closedLoans, r.activeLoans,
        ]);
        if (data.length > 0) {
            rows.push([
                '', '', 'TOTAL:', totals.totalCenters, totals.totalMembers, totals.totalActive, totals.totalWB,
                totals.totalNew, totals.totalDropped, totals.totalDisbursedCount, formatReportAmount(totals.totalDisbursedAmt),
                formatReportAmount(totals.totalColl), formatReportAmount(totals.totalDemand), formatReportAmount(totals.totalCollected), formatReportAmount(totals.totalArrears),
                formatReportAmount(totals.totalLoanOs), totals.totalOverdue, totals.totalPaid, totals.totalClosed, totals.totalActiveLoans,
            ]);
        }
        return { headers, rows };
    };

    const handleExportPDF = async () => {
        if (data.length === 0) {
            toast({ title: 'No data', description: 'Generate the report first.', variant: 'destructive' });
            return;
        }
        const { jsPDF } = await import('jspdf');
        const { drawFdoPerformanceReport } = await import('@/app/lib/reports/fdo-performance-pdf');
        const { headers, rows } = buildFdoPerformanceExportRows();
        const doc = new jsPDF({ orientation: 'landscape' });
        const reportFont = await ensureReportFont(doc);
        await drawFdoPerformanceReport(doc, headers, rows, { subtitle: `${submittedFromDate} to ${submittedTillDate}` }, reportFont);
        doc.save(`FDO_Performance_${submittedFromDate}_to_${submittedTillDate}.pdf`);
        toast({ title: 'Export Complete', description: 'FDO Performance report exported.' });
    };

    const handleExportCSV = () => {
        if (data.length === 0) {
            toast({ title: 'No data', description: 'Generate the report first.', variant: 'destructive' });
            return;
        }
        const { headers, rows } = buildFdoPerformanceExportRows();
        exportToCSV(`FDO_Performance_${submittedFromDate}_to_${submittedTillDate}`, 'FDO PERFORMANCE REPORT', headers, rows);
    };

    // Word-only presentation: same rows as PDF/CSV above, but the trailing "TOTAL:" row
    // is split off for distinct styling. 20 flat columns, each a distinct metric — no
    // genuine repeated-prefix pairs to group.
    const buildFdoPerformanceWordOptions = (
        rows: (string | number)[][]
    ): { bodyRows: (string | number)[][]; options: WordExportOptions } => ({
        bodyRows: rows.slice(0, -1),
        options: {
            columnAlignments: ['center', 'left', 'left', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right'],
            columnWidthWeights: [4, 10, 10, 7, 7, 6, 5, 7, 7, 7, 9, 7, 8, 8, 8, 8, 7, 6, 7, 7],
            totalsRow: rows[rows.length - 1],
        },
    });

    const handleExportWord = async () => {
        if (data.length === 0) {
            toast({ title: 'No data', description: 'Generate the report first.', variant: 'destructive' });
            return;
        }
        const { headers, rows } = buildFdoPerformanceExportRows();
        const { bodyRows, options } = buildFdoPerformanceWordOptions(rows);
        await exportToWord(`FDO_Performance_${submittedFromDate}_to_${submittedTillDate}`, 'FDO PERFORMANCE REPORT', headers, bodyRows, options);
    };

    const fmt = formatReportAmount;

    return (
        <div className="space-y-6">
            {/* Filter Section */}
            <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                <CardHeader className="bg-gradient-to-r from-primary via-primary to-primary">
                    <CardTitle className="text-lg text-white">FDO Performance</CardTitle>
                </CardHeader>
                <CardContent className="pt-6">
                    <div className="grid grid-cols-1 md:grid-cols-6 gap-6">
                        <div className="space-y-2">
                            <Label htmlFor="branchName" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">Branch</Label>
                            <Select value={selectedBranch} onValueChange={setSelectedBranch} disabled={isLoading}>
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
                        <div className="space-y-2">
                            <Label htmlFor="fromDate" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">From Date</Label>
                            <div className="relative">
                                <DateInput id="fromDate" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="h-11 pl-10" disabled={isLoading} />
                                <Calendar className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 pointer-events-none" />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="tillDate" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">Till Date</Label>
                            <div className="relative">
                                <DateInput id="tillDate" value={tillDate} onChange={(e) => setTillDate(e.target.value)} className="h-11 pl-10" disabled={isLoading} />
                                <Calendar className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 pointer-events-none" />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label className="text-sm font-semibold opacity-0">Show</Label>
                            <Button onClick={handleShow} disabled={isLoading} className="h-11 w-full bg-sidebar-accent text-white shadow-lg transition-all hover:bg-brand-green-darker hover:shadow-xl dark:bg-sidebar-accent dark:hover:bg-sidebar-accent/80">
                                {isLoading ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading...</>) : ('Show')}
                            </Button>
                        </div>
                        <div className="space-y-2">
                            <Label className="text-sm font-semibold opacity-0">Reset</Label>
                            <Button onClick={handleReset} disabled={isLoading} className="h-11 w-full bg-gradient-to-r from-red-400 to-orange-400 text-white shadow-lg transition-all hover:from-red-500 hover:to-orange-500 hover:shadow-xl">
                                <RefreshCw className="mr-2 h-4 w-4" />Reset
                            </Button>
                        </div>
                        <div className="space-y-2">
                            <Label className="text-sm font-semibold opacity-0">Export</Label>
                            <ExportDropdown
                                onExportPDF={!isLoading && showReport ? handleExportPDF : undefined}
                                onExportExcel={!isLoading && showReport ? handleExport : undefined}
                                onExportCSV={!isLoading && showReport ? handleExportCSV : undefined}
                                onExportWord={!isLoading && showReport ? handleExportWord : undefined}
                                reportSlug={!isLoading && showReport && getReportExportMode('fdo-performance') === 'REQUEST_QUEUE' ? 'fdo-performance' : undefined}
                                canExport={canExportReport('fdo-performance')}
                                exportParams={{
                                    fromDate: submittedFromDate,
                                    toDate: submittedTillDate,
                                    branchIds: submittedBranch === 'all' ? 'ALL' : [submittedBranch],
                                }}
                                className="h-11 w-full bg-gradient-to-r from-cyan-400 to-green-400 text-white border-cyan-400 shadow-lg transition-all hover:from-cyan-500 hover:to-primary hover:shadow-xl dark:border-cyan-400"
                            />
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Skeleton Loading */}
            {isLoading && (
                <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-28 rounded-xl" />)}
                    </div>
                    <Skeleton className="h-[500px] rounded-xl" />
                </div>
            )}

            {/* Metric Cards */}
            {showReport && !isLoading && (
                <>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        <MetricCard title="Total FDOs" value={totals.totalFDOs.toString()} subtitle="Field Development Officers" icon={Users} gradient="blue" />
                        <MetricCard title="Total Centers" value={totals.totalCenters.toString()} subtitle="Centers managed" icon={Building2} gradient="green" />
                        <MetricCard title="Total Members" value={totals.totalMembers.toString()} subtitle="All members across FDOs" icon={Users} gradient="purple" />
                        <MetricCard title="Active Members" value={totals.totalActive.toString()} subtitle={`${activeRate}% active rate`} icon={UserCheck} gradient="indigo" />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        <MetricCard title="Waiting Borrowers" value={totals.totalWB.toString()} subtitle="Pending loan applications" icon={UserX} gradient="rose" />
                        <MetricCard title="New Members" value={totals.totalNew.toString()} subtitle="New enrollments in period" icon={UserPlus} gradient="orange" />
                        <MetricCard title="Disbursed Amount" value={`₹${fmt(totals.totalDisbursedAmt)}`} subtitle={`${totals.totalDisbursedCount} loans disbursed`} icon={Banknote} gradient="green" />
                        <MetricCard title="Total Arrears" value={`₹${fmt(totals.totalArrears)}`} subtitle={`${totals.totalOverdue} overdue schedules`} icon={AlertTriangle} gradient="rose" />
                    </div>
                </>
            )}

            {/* Report Table */}
            {showReport && !isLoading && (
                <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                    <CardHeader className="pb-0">
                        <ReportHeader title="FDO Performance Report" />
                    </CardHeader>
                    <div className="flex flex-wrap items-center gap-4 px-6 pb-2">
                        <TableSearchInput
                            value={tableSearchQuery}
                            onChange={setTableSearchQuery}
                            placeholder="Search FDO performance..."
                            className="ml-auto"
                        />
                    </div>
                    <CardContent className="p-0">
                        <div className="max-h-[600px] overflow-auto scrollbar-thin scrollbar-track-brand-green-darker scrollbar-thumb-sidebar-accent">
                            <Table className="min-w-full text-xs">
                                <TableHeader className="bg-gradient-to-r from-primary via-primary to-primary text-white sticky top-0 z-10">
                                    <TableRow className="hover:bg-primary/80">
                                        <TableHead className="px-3 py-3 font-semibold text-white text-right whitespace-nowrap">SINO</TableHead>
                                        <TableHead className="px-3 py-3 font-semibold text-white whitespace-nowrap">BRANCH</TableHead>
                                        <TableHead className="px-3 py-3 font-semibold text-white whitespace-nowrap">FDO</TableHead>
                                        <TableHead className="px-3 py-3 font-semibold text-white text-right whitespace-nowrap">TOTAL CENTRES</TableHead>
                                        <TableHead className="px-3 py-3 font-semibold text-white text-right whitespace-nowrap">TOTALMEMBERS</TableHead>
                                        <TableHead className="px-3 py-3 font-semibold text-white text-right whitespace-nowrap">ACTIVE</TableHead>
                                        <TableHead className="px-3 py-3 font-semibold text-white text-right whitespace-nowrap">WB</TableHead>
                                        <TableHead className="px-3 py-3 font-semibold text-white text-right whitespace-nowrap">NEWMEMBERS</TableHead>
                                        <TableHead className="px-3 py-3 font-semibold text-white text-right whitespace-nowrap">GEOCOVERS</TableHead>
                                        <TableHead className="px-3 py-3 font-semibold text-white text-right whitespace-nowrap">TOTDISBURSEDAMT</TableHead>
                                        <TableHead className="px-3 py-3 font-semibold text-white text-right whitespace-nowrap">TOTALCOLL</TableHead>
                                        <TableHead className="px-3 py-3 font-semibold text-white text-right whitespace-nowrap">COLL DEMAND</TableHead>
                                        <TableHead className="px-3 py-3 font-semibold text-white text-right whitespace-nowrap">COLL COLLECTED</TableHead>
                                        <TableHead className="px-3 py-3 font-semibold text-white text-right whitespace-nowrap">TOTALARREARS</TableHead>
                                        <TableHead className="px-3 py-3 font-semibold text-white text-right whitespace-nowrap">LOANOS</TableHead>
                                        <TableHead className="px-3 py-3 font-semibold text-white text-right whitespace-nowrap">OVERDUE</TableHead>
                                        <TableHead className="px-3 py-3 font-semibold text-white text-right whitespace-nowrap">CLOSURE</TableHead>
                                        <TableHead className="px-3 py-3 font-semibold text-white text-right whitespace-nowrap">ACTIVE LOANS</TableHead>
                                        <TableHead className="px-3 py-3 font-semibold text-white text-right whitespace-nowrap">DROPPED</TableHead>
                                        <TableHead className="px-3 py-3 font-semibold text-white text-right whitespace-nowrap">DISBURSED COUNT</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody className="bg-white dark:bg-green-950/30">
                                    {searchedRows.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={20} className="px-4 py-8 text-center text-slate-500">
                                                No data available for the selected date range
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        <>
                                            {searchedRows.map((row, index) => (
                                                <TableRow key={index} className={cn('bg-white odd:bg-green-50/70 hover:bg-green-50/60 transition-colors dark:bg-brand-green-darker dark:odd:bg-brand-green-darker/80 dark:hover:bg-sidebar-accent/80')}>
                                                    <TableCell className="px-3 py-3 text-right text-sidebar-accent dark:text-slate-200">{row.sino}</TableCell>
                                                    <TableCell className="px-3 py-3 text-sidebar-accent dark:text-slate-200 whitespace-nowrap">{row.branch}</TableCell>
                                                    <TableCell className="px-3 py-3 font-medium text-foreground dark:text-slate-100 whitespace-nowrap">{row.fdo}</TableCell>
                                                    <TableCell className="px-3 py-3 text-right text-sidebar-accent dark:text-slate-200">{row.totalCenters}</TableCell>
                                                    <TableCell className="px-3 py-3 text-right text-sidebar-accent dark:text-slate-200">{row.totalMembers}</TableCell>
                                                    <TableCell className="px-3 py-3 text-right text-sidebar-accent dark:text-slate-200">{row.active}</TableCell>
                                                    <TableCell className="px-3 py-3 text-right text-sidebar-accent dark:text-slate-200">{row.wb}</TableCell>
                                                    <TableCell className="px-3 py-3 text-right text-sidebar-accent dark:text-slate-200">{row.newMembers}</TableCell>
                                                    <TableCell className="px-3 py-3 text-right text-sidebar-accent dark:text-slate-200">{row.dropped}</TableCell>
                                                    <TableCell className="px-3 py-3 text-right font-medium text-foreground dark:text-slate-100 whitespace-nowrap">{fmt(row.totalDisbursedAmt)}</TableCell>
                                                    <TableCell className="px-3 py-3 text-right font-medium text-foreground dark:text-slate-100 whitespace-nowrap">{fmt(row.totalColl)}</TableCell>
                                                    <TableCell className="px-3 py-3 text-right text-sidebar-accent dark:text-slate-200 whitespace-nowrap">{fmt(row.totalDemand)}</TableCell>
                                                    <TableCell className="px-3 py-3 text-right text-sidebar-accent dark:text-slate-200 whitespace-nowrap">{fmt(row.totalCollected)}</TableCell>
                                                    <TableCell className="px-3 py-3 text-right whitespace-nowrap">
                                                        <span className={cn('font-medium', row.totalArrears > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400')}>
                                                            {fmt(row.totalArrears)}
                                                        </span>
                                                    </TableCell>
                                                    <TableCell className="px-3 py-3 text-right font-medium text-foreground dark:text-slate-100 whitespace-nowrap">{fmt(row.loanOs)}</TableCell>
                                                    <TableCell className="px-3 py-3 text-right text-sidebar-accent dark:text-slate-200">{row.overdueCount}</TableCell>
                                                    <TableCell className="px-3 py-3 text-right text-sidebar-accent dark:text-slate-200">{row.closedLoans}</TableCell>
                                                    <TableCell className="px-3 py-3 text-right text-sidebar-accent dark:text-slate-200">{row.activeLoans}</TableCell>
                                                    <TableCell className="px-3 py-3 text-right text-sidebar-accent dark:text-slate-200">{row.dropped}</TableCell>
                                                    <TableCell className="px-3 py-3 text-right text-sidebar-accent dark:text-slate-200">{row.disbursedCount}</TableCell>
                                                </TableRow>
                                            ))}
                                            {data.length > 0 && (
                                                <TableRow className="bg-gradient-to-r from-brand-green-tint to-primary dark:from-brand-green-darker/50 dark:to-brand-green-darker/50 font-bold border-t-2 border-primary/50 dark:border-sidebar-accent">
                                                    <TableCell className="px-3 py-3 text-right text-foreground dark:text-green-100" />
                                                    <TableCell className="px-3 py-3 text-foreground dark:text-green-100" />
                                                    <TableCell className="px-3 py-3 text-foreground dark:text-green-100 font-bold">TOTAL:</TableCell>
                                                    <TableCell className="px-3 py-3 text-right text-foreground dark:text-green-100">{totals.totalCenters}</TableCell>
                                                    <TableCell className="px-3 py-3 text-right text-foreground dark:text-green-100">{totals.totalMembers}</TableCell>
                                                    <TableCell className="px-3 py-3 text-right text-foreground dark:text-green-100">{totals.totalActive}</TableCell>
                                                    <TableCell className="px-3 py-3 text-right text-foreground dark:text-green-100">{totals.totalWB}</TableCell>
                                                    <TableCell className="px-3 py-3 text-right text-foreground dark:text-green-100">{totals.totalNew}</TableCell>
                                                    <TableCell className="px-3 py-3 text-right text-foreground dark:text-green-100">{totals.totalDropped}</TableCell>
                                                    <TableCell className="px-3 py-3 text-right text-foreground dark:text-green-100 whitespace-nowrap">{fmt(totals.totalDisbursedAmt)}</TableCell>
                                                    <TableCell className="px-3 py-3 text-right text-foreground dark:text-green-100 whitespace-nowrap">{fmt(totals.totalColl)}</TableCell>
                                                    <TableCell className="px-3 py-3 text-right text-foreground dark:text-green-100 whitespace-nowrap">{fmt(totals.totalDemand)}</TableCell>
                                                    <TableCell className="px-3 py-3 text-right text-foreground dark:text-green-100 whitespace-nowrap">{fmt(totals.totalCollected)}</TableCell>
                                                    <TableCell className="px-3 py-3 text-right text-foreground dark:text-green-100 whitespace-nowrap">{fmt(totals.totalArrears)}</TableCell>
                                                    <TableCell className="px-3 py-3 text-right text-foreground dark:text-green-100 whitespace-nowrap">{fmt(totals.totalLoanOs)}</TableCell>
                                                    <TableCell className="px-3 py-3 text-right text-foreground dark:text-green-100">{totals.totalOverdue}</TableCell>
                                                    <TableCell className="px-3 py-3 text-right text-foreground dark:text-green-100">{totals.totalClosed}</TableCell>
                                                    <TableCell className="px-3 py-3 text-right text-foreground dark:text-green-100">{totals.totalActiveLoans}</TableCell>
                                                    <TableCell className="px-3 py-3 text-right text-foreground dark:text-green-100">{totals.totalDropped}</TableCell>
                                                    <TableCell className="px-3 py-3 text-right text-foreground dark:text-green-100">{totals.totalDisbursedCount}</TableCell>
                                                </TableRow>
                                            )}
                                        </>
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>
            )}

            {!showReport && !isLoading && (
                <Card className="border-primary/20 bg-green-50/60 p-12 text-center dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                    <FileText className="mx-auto h-12 w-12 text-slate-400 dark:text-slate-500" />
                    <p className="mt-4 text-sm font-medium text-sidebar-accent dark:text-slate-400">
                        Select date range and click Show to generate the FDO Performance report
                    </p>
                </Card>
            )}
        </div>
    );
}
