'use client';

import { useState } from 'react';
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
import { Badge } from '@/components/ui/badge';
import {
    Calendar,
    Download,
    RefreshCw,
    Filter,
    BookOpen,
    MapPin,
    DollarSign,
    FileSpreadsheet,
    FileText,
    FileOutput,
    RotateCcw,
    TrendingUp,
    ChevronLeft,
    ChevronRight,
    Building2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';

import { useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { usePermission } from '@/app/hooks/usePermission';
import { apiClient } from '@/app/lib/api-client';
import { Loader2 } from 'lucide-react';
import * as XLSX from 'xlsx-js-style';
import jsPDF from 'jspdf';
import { exportToWord, exportToCSV, type WordExportOptions } from '@/app/lib/report-export-utils';
import { buildReportSheet, autoSizeColumns, applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { drawIndividualLedgerReport } from '@/app/lib/reports/individual-ledger-pdf';
import { formatReportAmount, truncateReportAmount } from '@/app/lib/utils/format-amount';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { DateInput } from '@/components/ui/date-input';
import { toDisplayDate, toDisplayDateTime } from '@/app/lib/date-format';

// Individual Ledger entry interface
interface IndividualLedgerEntry {
    branchId: string;
    centerId: string;
    centerName: string;
    osOwnFund: number;
    clOwnFund: number;
}

type BranchOption = { id: string; name: string; code: string };

// Format currency — whole rupees, truncated (not rounded), per the report amount-display requirement.
const formatCurrency = (amount: number) => {
    return formatReportAmount(amount);
};

export default function IndividualLedgerPage() {
    const { toast } = useToast();
    const { canExportReport, getReportExportMode } = usePermission();
    const [fromDate, setFromDate] = useState<string>(() => {
        const d = new Date();
        d.setDate(1); // First of current month
        return d.toISOString().split('T')[0];
    });
    const [tillDate, setTillDate] = useState<string>(() => {
        return new Date().toISOString().split('T')[0];
    });
    const [selectedBranch, setSelectedBranch] = useState('all');
    const [branches, setBranches] = useState<BranchOption[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [data, setData] = useState<IndividualLedgerEntry[]>([]);
    // Submitted (applied) date snapshot — frozen until the next Show click, so exports and
    // the footer date-range label keep using the last-shown range even if fromDate/tillDate
    // are edited afterward without clicking Show again.
    const [submittedFromDate, setSubmittedFromDate] = useState(fromDate);
    const [submittedTillDate, setSubmittedTillDate] = useState(tillDate);
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 10;

    useEffect(() => {
        fetch('/api/branches')
            .then((r) => r.json())
            .then((d) => setBranches(Array.isArray(d) ? d : (d.data ?? [])))
            .catch(() => {});
    }, []);

    const fetchIndividualLedger = async () => {
        setIsLoading(true);
        try {
            const params = new URLSearchParams({ fromDate, tillDate });
            if (selectedBranch !== 'all') params.set('branchId', selectedBranch);
            const response = await apiClient.get(`/reports/portfolio/individual-ledger?${params.toString()}`);
            if (response.success && Array.isArray(response.data)) {
                setData(response.data);
                setCurrentPage(1);
                toast({
                    title: 'Success',
                    description: `Loaded ${response.data.length} center records`,
                });
            } else {
                throw new Error(response.error || 'Failed to fetch data');
            }
        } catch (error: any) {
            console.error('Error fetching individual ledger:', error);
            toast({
                title: 'Error',
                description: error.message || 'Failed to fetch individual ledger data',
                variant: 'destructive',
            });
        } finally {
            setIsLoading(false);
        }
    };

    // Initial load
    useEffect(() => {
        fetchIndividualLedger();
    }, []);

    // Calculate pagination
    const totalPages = Math.ceil(data.length / itemsPerPage);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const currentData = data.slice(startIndex, endIndex);

    // Calculate totals
    const totalOSOwnFund = data.reduce((sum, e) => sum + e.osOwnFund, 0);
    const totalCLOwnFund = data.reduce((sum, e) => sum + e.clOwnFund, 0);

    const handleShow = () => {
        setSubmittedFromDate(fromDate);
        setSubmittedTillDate(tillDate);
        fetchIndividualLedger();
    };

    const handleReset = () => {
        const d = new Date();
        d.setDate(1);
        const resetFrom = d.toISOString().split('T')[0];
        const resetTill = new Date().toISOString().split('T')[0];
        setFromDate(resetFrom);
        setTillDate(resetTill);
        setSubmittedFromDate(resetFrom);
        setSubmittedTillDate(resetTill);
        setSelectedBranch('all');
        fetchIndividualLedger();
    };

    const handleExport = () => {
        if (data.length === 0) {
            toast({
                title: 'No data',
                description: 'There is no data to export',
                variant: 'destructive',
            });
            return;
        }

        // Simple CSV Export
        const headers = ['BRANCH ID', 'CENTER ID', 'CENTER NAME', 'OS_OWNFUND', 'CL_OWNFUND'];
        const csvRows = [
            headers.join(','),
            ...data.map(row => [
                row.branchId,
                row.centerId,
                `"${row.centerName}"`,
                truncateReportAmount(row.osOwnFund),
                truncateReportAmount(row.clOwnFund)
            ].join(','))
        ];

        const csvContent = "data:text/csv;charset=utf-8," + csvRows.join("\n");
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `individual_ledger_${submittedFromDate}_to_${submittedTillDate}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        toast({
            title: 'Exported',
            description: 'Individual ledger exported successfully',
        });
    };

    // Mirrors the same field mapping used by handleExport (CSV) above (kept separate so
    // handleExport is left untouched).
    const buildIndividualLedgerExportRows = (): { headers: string[]; rows: (string | number)[][] } => {
        const headers = ['BRANCH ID', 'CENTER ID', 'CENTER NAME', 'OS_OWNFUND', 'CL_OWNFUND'];
        const rows: (string | number)[][] = data.map((row) => [
            row.branchId, row.centerId, row.centerName, truncateReportAmount(row.osOwnFund), truncateReportAmount(row.clOwnFund),
        ]);
        rows.push(['TOTAL', '', '', truncateReportAmount(totalOSOwnFund), truncateReportAmount(totalCLOwnFund)]);
        return { headers, rows };
    };

    const handleExportExcel = () => {
        if (data.length === 0) {
            toast({ title: 'No data', description: 'There is no data to export', variant: 'destructive' });
            return;
        }
        const { headers, rows } = buildIndividualLedgerExportRows();
        const rowObjects = rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
        const ws = buildReportSheet('Individual Ledger Report', rowObjects);
        autoSizeColumns(ws);
        applyExcelReportFont(ws);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Individual Ledger');
        XLSX.writeFile(wb, `individual_ledger_${submittedFromDate}_to_${submittedTillDate}.xlsx`);
        toast({ title: 'Exported', description: 'Individual ledger exported successfully' });
    };

    const handleExportCSV = () => {
        if (data.length === 0) {
            toast({ title: 'No data', description: 'There is no data to export', variant: 'destructive' });
            return;
        }
        const { headers, rows } = buildIndividualLedgerExportRows();
        exportToCSV(`individual_ledger_${submittedFromDate}_to_${submittedTillDate}`, 'INDIVIDUAL LEDGER REPORT', headers, rows);
        toast({ title: 'Exported', description: 'Individual ledger exported successfully' });
    };

    const handleExportPDF = async () => {
        if (data.length === 0) {
            toast({ title: 'No data', description: 'There is no data to export', variant: 'destructive' });
            return;
        }
        const { headers, rows } = buildIndividualLedgerExportRows();
        const doc = new jsPDF({ orientation: 'landscape' });
        const reportFont = await ensureReportFont(doc);
        await drawIndividualLedgerReport(doc, headers, rows, {
            subtitle: `${toDisplayDate(new Date(submittedFromDate))} - ${toDisplayDate(new Date(submittedTillDate))}`,
        }, reportFont);
        doc.save(`individual_ledger_${submittedFromDate}_to_${submittedTillDate}.pdf`);
        toast({ title: 'Exported', description: 'Individual ledger exported successfully' });
    };

    // Word-only presentation: same rows as Excel/CSV/PDF above, but the trailing TOTAL
    // row is split off for distinct styling. 5 flat columns — no grouping needed.
    const wordOptions: WordExportOptions = {
        columnAlignments: ['center', 'center', 'left', 'right', 'right'],
        columnWidthWeights: [8, 8, 16, 10, 10],
    };

    const handleExportWord = async () => {
        if (data.length === 0) {
            toast({ title: 'No data', description: 'There is no data to export', variant: 'destructive' });
            return;
        }
        const { headers, rows } = buildIndividualLedgerExportRows();
        const bodyRows = rows.slice(0, -1);
        const totalsRow = rows[rows.length - 1];
        await exportToWord(`individual_ledger_${submittedFromDate}_to_${submittedTillDate}`, 'INDIVIDUAL LEDGER REPORT', headers, bodyRows, { ...wordOptions, totalsRow });
        toast({ title: 'Exported', description: 'Individual ledger exported successfully' });
    };

    return (
        <ProtectedRoute requiredPermission="INDIVIDUAL_LEDGER">
            <div className="relative min-h-screen bg-gradient-to-br from-background via-green-50/30 to-green-50/30 dark:from-background dark:via-brand-green-darker dark:to-green-950">
                <div className="container mx-auto px-3 sm:px-6 py-4 sm:py-8">
                    {/* Background Glow Effects */}
                    <div className="absolute inset-0 -z-10 overflow-hidden">
                        <div className="absolute left-1/4 top-1/4 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
                        <div className="absolute right-1/4 bottom-1/4 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
                    </div>

                    {/* Header Section */}
                    <div className="mb-8">
                        <div className="flex items-center gap-4 mb-4">
                            <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary shadow-lg shadow-primary/30">
                                <BookOpen className="h-7 w-7 text-white" />
                                <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/20 to-transparent" />
                            </div>
                            <div className="flex-1">
                                <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-foreground dark:text-white">
                                    Individual Ledger
                                </h1>
                                <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                                    Center-wise outstanding and collection ledger report
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Summary Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
                        <Card className="border-2 border-primary/30/50 dark:border-sidebar-accent/50 bg-gradient-to-br from-green-50 to-green-50/50 dark:from-brand-green-darker/20 dark:to-brand-green-darker/20">
                            <CardContent className="pt-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-sidebar-accent dark:text-green-300">
                                            Total Centers
                                        </p>
                                        <p className="text-3xl font-bold text-foreground dark:text-green-100 mt-2">
                                            {data.length}
                                        </p>
                                        <p className="text-xs text-primary dark:text-primary mt-1">
                                            Active centers
                                        </p>
                                    </div>
                                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-green-tint dark:bg-brand-green-darker/50">
                                        <MapPin className="h-6 w-6 text-primary dark:text-primary" />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="border-2 border-green-200/50 dark:border-green-800/50 bg-gradient-to-br from-green-50 to-emerald-50/50 dark:from-green-950/20 dark:to-emerald-950/20">
                            <CardContent className="pt-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-green-700 dark:text-green-300">
                                            OS Own Fund
                                        </p>
                                        <p className="text-2xl font-bold text-green-900 dark:text-green-100 mt-2">
                                            ₹ {formatCurrency(totalOSOwnFund)}
                                        </p>
                                        <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                                            Outstanding
                                        </p>
                                    </div>
                                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-green-100 dark:bg-green-900/50">
                                        <DollarSign className="h-6 w-6 text-green-600 dark:text-green-400" />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="border-2 border-purple-200/50 dark:border-purple-800/50 bg-gradient-to-br from-purple-50 to-pink-50/50 dark:from-purple-950/20 dark:to-pink-950/20">
                            <CardContent className="pt-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-purple-700 dark:text-purple-300">
                                            CL Own Fund
                                        </p>
                                        <p className="text-2xl font-bold text-purple-900 dark:text-purple-100 mt-2">
                                            ₹ {formatCurrency(totalCLOwnFund)}
                                        </p>
                                        <p className="text-xs text-purple-600 dark:text-purple-400 mt-1">
                                            Collected
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
                        <div className="h-1.5 bg-gradient-to-r from-primary via-primary to-purple-600" />
                        <CardHeader className="bg-gradient-to-r from-slate-50 via-green-50/60 to-green-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                            <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-green-tint dark:bg-brand-green-darker/30">
                                    <Filter className="h-5 w-5 text-primary dark:text-primary" />
                                </div>
                                <div>
                                    <CardTitle className="text-xl">Report Filters</CardTitle>
                                    <CardDescription>
                                        Select date range to view individual ledger report
                                    </CardDescription>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="pt-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                                {/* Branch */}
                                <div className="space-y-2">
                                    <Label htmlFor="branchName" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Branch
                                    </Label>
                                    <Select value={selectedBranch} onValueChange={setSelectedBranch} disabled={isLoading}>
                                        <SelectTrigger id="branchName" className="h-11 border-primary/30 dark:border-sidebar-accent">
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
                                        />
                                        <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                                    </div>
                                </div>

                                {/* Till Date */}
                                <div className="space-y-2">
                                    <Label htmlFor="tillDate" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Till Date <span className="text-red-500">*</span>
                                    </Label>
                                    <div className="relative">
                                        <DateInput
                                            id="tillDate"
                                            value={tillDate}
                                            onChange={(e) => setTillDate(e.target.value)}
                                            className="h-11 border-primary/30 dark:border-sidebar-accent pl-10"
                                        />
                                        <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                                    </div>
                                </div>

                                {/* Action Buttons */}
                                <div className="space-y-2 lg:col-span-2">
                                    <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-200 opacity-0">
                                        Actions
                                    </Label>
                                    <div className="flex gap-2">
                                        <Button
                                            onClick={handleShow}
                                            disabled={isLoading}
                                            className="h-11 bg-gradient-to-r from-primary to-primary hover:from-sidebar-accent hover:to-primary text-white shadow-lg shadow-primary/30"
                                        >
                                            {isLoading ? (
                                                <>
                                                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                                                    Loading...
                                                </>
                                            ) : (
                                                <>
                                                    <FileSpreadsheet className="h-4 w-4 mr-2" />
                                                    Show
                                                </>
                                            )}
                                        </Button>
                                        <Button
                                            onClick={handleReset}
                                            variant="outline"
                                            className="h-11 border-primary/30 dark:border-sidebar-accent"
                                        >
                                            <RotateCcw className="h-4 w-4 mr-2" />
                                            Reset
                                        </Button>
                                        <ExportDropdown
                                            onExportPDF={handleExportPDF}
                                            onExportExcel={handleExportExcel}
                                            onExportCSV={handleExportCSV}
                                            onExportWord={handleExportWord}
                                            reportSlug={getReportExportMode('individual-ledger') === 'REQUEST_QUEUE' ? 'individual-ledger' : undefined}
                                            canExport={canExportReport('individual-ledger')}
                                            exportParams={{
                                                fromDate: submittedFromDate,
                                                toDate: submittedTillDate,
                                                branchIds: selectedBranch !== 'all' ? [selectedBranch] : 'ALL',
                                            }}
                                            className="h-11 border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-300"
                                        />
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Individual Ledger Table Card */}
                    <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
                        <div className="h-1.5 bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600" />
                        <CardHeader className="bg-gradient-to-r from-slate-50 via-green-50/60 to-green-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-green-tint dark:bg-brand-green-darker/30">
                                        <BookOpen className="h-5 w-5 text-primary dark:text-primary" />
                                    </div>
                                    <div>
                                        <CardTitle className="text-xl">Individual Ledger Report</CardTitle>
                                        <CardDescription>
                                            Center-wise outstanding and collection details
                                        </CardDescription>
                                    </div>
                                </div>
                                <Badge variant="outline" className="text-sm px-3 py-1">
                                    {data.length} Centers
                                </Badge>
                            </div>
                        </CardHeader>
                        <CardContent className="p-0">
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow className="bg-gradient-to-r from-primary to-primary dark:from-sidebar-accent dark:to-primary hover:from-primary hover:to-primary">
                                            <TableHead className="text-center font-bold text-white uppercase italic">Branch ID</TableHead>
                                            <TableHead className="text-center font-bold text-white uppercase italic">Center ID</TableHead>
                                            <TableHead className="font-bold text-white">CENTER NAME</TableHead>
                                            <TableHead className="text-right font-bold text-white">OB_OWNFUND</TableHead>
                                            <TableHead className="text-right font-bold text-white">CB_OWNFUND</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {currentData.map((entry, index) => (
                                            <TableRow
                                                key={index}
                                                className={cn(
                                                    'hover:bg-green-50/50 dark:hover:bg-green-950/20 transition-colors',
                                                    index % 2 === 0 ? 'bg-white dark:bg-brand-green-darker' : 'bg-green-50/50 dark:bg-brand-green-darker/50'
                                                )}
                                            >
                                                <TableCell className="text-center">
                                                    <Badge variant="outline" className="font-semibold text-sidebar-accent dark:text-primary">
                                                        {entry.branchId}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    <Badge variant="outline" className="font-semibold text-primary dark:text-primary">
                                                        {entry.centerId}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="font-semibold text-foreground dark:text-slate-100">
                                                    <div className="flex items-center gap-2">
                                                        <Building2 className="h-4 w-4 text-slate-500" />
                                                        {entry.centerName}
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-right font-bold text-green-700 dark:text-green-400">
                                                    ₹ {formatCurrency(entry.osOwnFund)}
                                                </TableCell>
                                                <TableCell className="text-right font-bold text-purple-700 dark:text-purple-400">
                                                    ₹ {formatCurrency(entry.clOwnFund)}
                                                </TableCell>
                                            </TableRow>
                                        ))}

                                        {/* Total Row - Only show on last page */}
                                        {currentPage === totalPages && (
                                            <TableRow className="bg-gradient-to-r from-brand-green-tint to-primary dark:from-brand-green-darker/50 dark:to-brand-green-darker/50 font-bold border-t-2 border-primary/50 dark:border-sidebar-accent">
                                                <TableCell className="text-lg text-foreground dark:text-green-100 text-center" colSpan={3}>
                                                    TOTAL
                                                </TableCell>
                                                <TableCell className="text-right text-sidebar-accent dark:text-green-300">
                                                    ₹ {formatCurrency(totalOSOwnFund)}
                                                </TableCell>
                                                <TableCell className="text-right text-sidebar-accent dark:text-green-300">
                                                    ₹ {formatCurrency(totalCLOwnFund)}
                                                </TableCell>
                                            </TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </div>

                            {/* Pagination */}
                            {totalPages > 1 && (
                                <div className="flex items-center justify-between border-t border-primary/20 dark:border-sidebar-accent px-6 py-4">
                                    <div className="text-sm text-sidebar-accent dark:text-slate-400">
                                        Showing {startIndex + 1} to {Math.min(endIndex, data.length)} of {data.length} centers
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                                            disabled={currentPage === 1}
                                        >
                                            <ChevronLeft className="h-4 w-4" />
                                            Previous
                                        </Button>
                                        <div className="flex items-center gap-1">
                                            {Array.from({ length: Math.min(totalPages, 10) }, (_, i) => i + 1).map(page => (
                                                <Button
                                                    key={page}
                                                    variant={currentPage === page ? "default" : "outline"}
                                                    size="sm"
                                                    onClick={() => setCurrentPage(page)}
                                                    className={cn(
                                                        "w-8 h-8 p-0",
                                                        currentPage === page && "bg-primary hover:bg-primary"
                                                    )}
                                                >
                                                    {page}
                                                </Button>
                                            ))}
                                        </div>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                                            disabled={currentPage === totalPages}
                                        >
                                            Next
                                            <ChevronRight className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Footer Info */}
                    <div className="mt-6 flex items-center justify-between text-sm text-sidebar-accent dark:text-slate-400">
                        <p>
                            Report generated on {toDisplayDateTime(new Date())}
                        </p>
                        <p>
                            Date Range: <span className="font-semibold text-sidebar-accent dark:text-primary">
                                {toDisplayDate(new Date(submittedFromDate))} - {toDisplayDate(new Date(submittedTillDate))}
                            </span>
                        </p>
                    </div>
                </div>
            </div>
        </ProtectedRoute>
    );
}
