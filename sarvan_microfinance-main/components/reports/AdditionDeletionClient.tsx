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
import { useToast } from '@/hooks/use-toast';
import {
    Calendar,
    RefreshCw,
    Download,
    Loader2,
    FileText,
    FileType,
    FileOutput,
    Users,
    UserPlus,
    UserMinus,
    IndianRupee,
    Search,
    TrendingUp,
    TrendingDown,
    MapPin,
    ArrowRightLeft,
    Clock
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { MetricCard } from '@/components/dashboard/MetricCard';
import { apiClient } from '@/app/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import * as XLSX from 'xlsx-js-style';
import jsPDF from 'jspdf';
import { formatReportAmount, truncateReportAmount } from '@/app/lib/utils/format-amount';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { buildReportSheet, autoSizeColumns, applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { drawAdditionDeletionReport } from '@/app/lib/reports/addition-deletion-pdf';
import { exportToCSV, exportToWord, type WordExportOptions } from '@/app/lib/report-export-utils';
import { getCentersForDropdown, CenterOption } from '@/app/lib/actions/centers';
import { usePermission } from '@/app/hooks/usePermission';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';
import { DateInput } from '@/components/ui/date-input';

type BranchOption = { id: string; name: string; code: string };

type AdditionDeletionData = {
    centerId: string;
    fdo: string;
    centerName: string;
    opening: number;
    induction: number;
    dropped: number;
    closing: number;
    admissionFees: number;
};

export function AdditionDeletionClient() {
    const { toast } = useToast();
    const { canExportReport, getReportExportMode } = usePermission();
    const [fromDate, setFromDate] = useState<string>(() => format(new Date(), 'yyyy-MM-01'));
    const [tillDate, setTillDate] = useState<string>(() => format(new Date(), 'yyyy-MM-dd'));
    const [submittedFromDate, setSubmittedFromDate] = useState<string>(() => format(new Date(), 'yyyy-MM-01'));
    const [submittedTillDate, setSubmittedTillDate] = useState<string>(() => format(new Date(), 'yyyy-MM-dd'));
    const [isLoading, setIsLoading] = useState(false);
    const [showReport, setShowReport] = useState(false);
    const [data, setData] = useState<AdditionDeletionData[]>([]);
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 10;
    const [selectedBranch, setSelectedBranch] = useState<string>('all');
    const [selectedCenter, setSelectedCenter] = useState<string>('all');
    const [branches, setBranches] = useState<BranchOption[]>([]);
    const [centers, setCenters] = useState<CenterOption[]>([]);

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

    // Calculate report-wide metrics
    const metrics = useMemo(() => {
        if (data.length === 0) return { opening: 0, induction: 0, dropped: 0, closing: 0, fees: 0, net: 0 };
        const opening = data.reduce((acc, curr) => acc + curr.opening, 0);
        const induction = data.reduce((acc, curr) => acc + curr.induction, 0);
        const dropped = data.reduce((acc, curr) => acc + curr.dropped, 0);
        const fees = data.reduce((acc, curr) => acc + curr.admissionFees, 0);
        const closing = data.reduce((acc, curr) => acc + curr.closing, 0);
        return {
            opening,
            induction,
            dropped,
            closing,
            fees,
            net: induction - dropped
        };
    }, [data]);

    const handleShow = async () => {
        if (!fromDate || !tillDate) {
            toast({
                title: 'Date range required',
                description: 'Please select both dates.',
                variant: 'destructive',
            });
            return;
        }

        if (new Date(fromDate) > new Date(tillDate)) {
            toast({
                title: 'Invalid range',
                description: 'From date cannot be after Till date.',
                variant: 'destructive',
            });
            return;
        }

        setIsLoading(true);
        try {
            const params = new URLSearchParams({ fromDate, tillDate });
            if (selectedBranch !== 'all') params.set('branchId', selectedBranch);
            if (selectedCenter !== 'all') params.set('centerId', selectedCenter);
            const response = await apiClient.get<AdditionDeletionData[]>(
                `/reports/client/addition-deletion?${params.toString()}`
            );

            if (response.success && response.data) {
                setData(response.data);
                setShowReport(true);
                setCurrentPage(1);
                setSubmittedFromDate(fromDate);
                setSubmittedTillDate(tillDate);
                toast({
                    title: 'Report Generated',
                    description: `Successfully loaded data for ${response.data.length} centers.`,
                });
            } else {
                toast({
                    title: 'Error',
                    description: response.error || 'Failed to fetch report data',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            toast({
                title: 'System Error',
                description: 'An unexpected error occurred.',
                variant: 'destructive',
            });
        } finally {
            setIsLoading(false);
        }
    };

    const handleReset = () => {
        setFromDate(format(new Date(), 'yyyy-MM-01'));
        setTillDate(format(new Date(), 'yyyy-MM-dd'));
        setSubmittedFromDate(format(new Date(), 'yyyy-MM-01'));
        setSubmittedTillDate(format(new Date(), 'yyyy-MM-dd'));
        setSelectedBranch('all');
        setSelectedCenter('all');
        setShowReport(false);
        setData([]);
        setCurrentPage(1);
    };

    const handleExport = () => {
        if (data.length === 0) return;

        try {
            const { headers, rows } = buildAdditionDeletionExportRows();
            const excelRows = rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
            const ws = buildReportSheet('Member Addition & Deletion Report', excelRows);
            autoSizeColumns(ws);
            applyExcelReportFont(ws);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Addition Deletion');
            const fileName = `Member_Addition_Deletion_${submittedFromDate}_to_${submittedTillDate}.xlsx`;
            XLSX.writeFile(wb, fileName);

            toast({
                title: 'Export Successful',
                description: `Report saved as ${fileName}`,
            });
        } catch (error) {
            toast({
                title: 'Export Failed',
                description: 'Failed to generate Excel file.',
                variant: 'destructive',
            });
        }
    };

    // Mirrors the same field mapping used by handleExport above (kept separate so
    // handleExport is left untouched).
    const buildAdditionDeletionExportRows = (): { headers: string[]; rows: (string | number)[][] } => {
        const headers = ['Sl No', 'FDO', 'Center', 'Opening', 'Induction', 'Dropped', 'Closing', 'Admission Fees'];
        const rows: (string | number)[][] = searchedRows.map((row, index) => [
            index + 1, row.fdo, row.centerName, row.opening, row.induction, row.dropped, row.closing, truncateReportAmount(row.admissionFees),
        ]);
        if (searchedRows.length > 0) {
            const totOpening = searchedRows.reduce((a, c) => a + (c.opening || 0), 0);
            const totInduction = searchedRows.reduce((a, c) => a + (c.induction || 0), 0);
            const totDropped = searchedRows.reduce((a, c) => a + (c.dropped || 0), 0);
            const totClosing = searchedRows.reduce((a, c) => a + (c.closing || 0), 0);
            const totFees = searchedRows.reduce((a, c) => a + (c.admissionFees || 0), 0);
            rows.push([
                '', 'Grand Total:', '', totOpening, totInduction, totDropped, totClosing, truncateReportAmount(totFees),
            ]);
        }
        return { headers, rows };
    };

    const handleExportPDF = async () => {
        if (data.length === 0) return;
        try {
            const doc = new jsPDF({ orientation: 'landscape' });
            const reportFont = await ensureReportFont(doc);
            const { headers, rows } = buildAdditionDeletionExportRows();
            await drawAdditionDeletionReport(doc, { headers, rows }, { subtitle: `${submittedFromDate} to ${submittedTillDate}` }, reportFont);
            doc.save(`Member_Addition_Deletion_${submittedFromDate}_to_${submittedTillDate}.pdf`);
            toast({ title: 'PDF Exported', description: 'File downloaded successfully.' });
        } catch {
            toast({ title: 'Export Failed', description: 'Failed to generate PDF file.', variant: 'destructive' });
        }
    };

    const handleExportCSV = () => {
        if (data.length === 0) return;
        const { headers, rows } = buildAdditionDeletionExportRows();
        exportToCSV(`Member_Addition_Deletion_${submittedFromDate}_to_${submittedTillDate}`, 'MEMBER ADDITION & DELETION REPORT', headers, rows);
    };

    // Word-only presentation: same rows as PDF/CSV above, but the trailing "Grand Total:"
    // row (when present) is split off for distinct styling. 8 flat columns — no genuine
    // repeated-prefix pairs to group.
    const buildAdditionDeletionWordOptions = (
        rows: (string | number)[][]
    ): { bodyRows: (string | number)[][]; options: WordExportOptions } => {
        const hasTotals = rows.length > 0 && rows[rows.length - 1][1] === 'Grand Total:';
        return {
            bodyRows: hasTotals ? rows.slice(0, -1) : rows,
            options: {
                columnAlignments: ['center', 'left', 'left', 'right', 'right', 'right', 'right', 'right'],
                columnWidthWeights: [6, 14, 14, 9, 9, 9, 9, 10],
                totalsRow: hasTotals ? rows[rows.length - 1] : undefined,
            },
        };
    };

    const handleExportWord = async () => {
        if (data.length === 0) return;
        const { headers, rows } = buildAdditionDeletionExportRows();
        const { bodyRows, options } = buildAdditionDeletionWordOptions(rows);
        await exportToWord(`Member_Addition_Deletion_${submittedFromDate}_to_${submittedTillDate}`, 'MEMBER ADDITION & DELETION REPORT', headers, bodyRows, options);
    };

    const formatCurrency = (amt: number) => `₹${formatReportAmount(amt)}`;

    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(data);

    const paginatedData = useMemo(() => {
        const startIndex = (currentPage - 1) * itemsPerPage;
        return searchedRows.slice(startIndex, startIndex + itemsPerPage);
    }, [searchedRows, currentPage]);

    return (
        <div className="space-y-8 animate-in fade-in duration-700">
            {/* Metric Summary */}
            {showReport && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 animate-in slide-in-from-top-4 duration-500">
                    <MetricCard
                        title="Total Opening"
                        value={metrics.opening.toString()}
                        subtitle="Members before period"
                        icon={Users}
                        gradient="blue"
                    />
                    <MetricCard
                        title="Total Induction"
                        value={metrics.induction.toString()}
                        subtitle="New enrollments"
                        icon={UserPlus}
                        gradient="indigo"
                    />
                    <MetricCard
                        title="Total Dropped"
                        value={metrics.dropped.toString()}
                        subtitle="Members who left"
                        icon={UserMinus}
                        gradient="rose"
                    />
                    <MetricCard
                        title="Admission Fees"
                        value={formatCurrency(metrics.fees)}
                        subtitle={`Net change: ${metrics.net > 0 ? '+' : ''}${metrics.net}`}
                        icon={IndianRupee}
                        gradient="green"
                    />
                </div>
            )}

            {/* Filter Panel */}
            <Card className="overflow-hidden border-none shadow-2xl bg-white/70 dark:bg-brand-green-darker/50 backdrop-blur-xl">
                <CardHeader className="bg-brand-green-darker dark:bg-sidebar-accent py-6">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-primary/20 rounded-lg">
                            <ArrowRightLeft className="w-5 h-5 text-primary" />
                        </div>
                        <div>
                            <CardTitle className="text-xl font-bold text-white">Report Period</CardTitle>
                            <p className="text-xs text-slate-400 mt-1">Track client movements between dates</p>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-8">
                    <div className="grid grid-cols-1 md:grid-cols-7 gap-6 items-end">
                        <div className="md:col-span-1 space-y-3">
                            <Label className="text-sm font-bold text-sidebar-accent dark:text-slate-300">Branch</Label>
                            <Select
                                value={selectedBranch}
                                onValueChange={(v) => { setSelectedBranch(v); setSelectedCenter('all'); }}
                            >
                                <SelectTrigger className="h-12 rounded-xl border-primary/20 dark:border-sidebar-accent">
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
                        <div className="md:col-span-1 space-y-3">
                            <Label className="text-sm font-bold text-sidebar-accent dark:text-slate-300">Center</Label>
                            <Select value={selectedCenter} onValueChange={setSelectedCenter}>
                                <SelectTrigger className="h-12 rounded-xl border-primary/20 dark:border-sidebar-accent">
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
                        <div className="md:col-span-1 space-y-3">
                            <Label className="text-sm font-bold text-sidebar-accent dark:text-slate-300 flex items-center gap-2">
                                <Calendar className="w-4 h-4 text-primary" />
                                From Date
                            </Label>
                            <DateInput
                                value={fromDate}
                                onChange={(e) => setFromDate(e.target.value)}
                                className="h-12 rounded-xl border-primary/20 dark:border-sidebar-accent focus:ring-2 focus:ring-primary"
                            />
                        </div>
                        <div className="md:col-span-1 space-y-3">
                            <Label className="text-sm font-bold text-sidebar-accent dark:text-slate-300 flex items-center gap-2">
                                <Calendar className="w-4 h-4 text-primary" />
                                Till Date
                            </Label>
                            <DateInput
                                value={tillDate}
                                onChange={(e) => setTillDate(e.target.value)}
                                className="h-12 rounded-xl border-primary/20 dark:border-sidebar-accent focus:ring-2 focus:ring-primary"
                            />
                        </div>

                        <div className="md:col-span-3 flex flex-wrap gap-3">
                            <Button
                                onClick={handleShow}
                                disabled={isLoading}
                                className="h-12 px-8 rounded-xl bg-brand-green-darker hover:bg-sidebar-accent text-white shadow-lg transition-all active:scale-95 flex-1 font-bold"
                            >
                                {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5 mr-2" />}
                                Show
                            </Button>
                            <Button
                                onClick={handleReset}
                                variant="outline"
                                className="h-12 px-6 rounded-xl border-red-200 dark:border-red-900/30 text-red-600 hover:bg-red-50 transition-all flex-1 font-bold"
                            >
                                <RefreshCw className="w-5 h-5 mr-2" />
                                Reset
                            </Button>
                            <ExportDropdown
                                onExportPDF={showReport && data.length > 0 ? handleExportPDF : undefined}
                                onExportExcel={showReport && data.length > 0 ? handleExport : undefined}
                                onExportCSV={showReport && data.length > 0 ? handleExportCSV : undefined}
                                onExportWord={showReport && data.length > 0 ? handleExportWord : undefined}
                                reportSlug={showReport && data.length > 0 && getReportExportMode('addition-deletion') === 'REQUEST_QUEUE' ? 'addition-deletion' : undefined}
                                canExport={canExportReport('addition-deletion')}
                                exportParams={{
                                    fromDate: submittedFromDate,
                                    toDate: submittedTillDate,
                                    branchIds: selectedBranch === 'all' ? 'ALL' : [selectedBranch],
                                    filters: selectedCenter !== 'all' ? { centerId: selectedCenter } : null,
                                }}
                                className="h-12 px-6 rounded-xl bg-primary hover:bg-sidebar-accent text-white shadow-lg shadow-primary/20 transition-all active:scale-95 flex-1 font-bold"
                            />
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Data Table */}
            {showReport && (
                <Card className="border-none shadow-2xl bg-white/80 dark:bg-brand-green-darker/60 backdrop-blur-xl overflow-hidden animate-in slide-in-from-bottom-5 duration-500">
                    <div className="px-4 sm:px-8 pt-6">
                        <ReportHeader title="Member Addition & Deletion Report" />
                    </div>
                    <div className="bg-green-50/50 dark:bg-sidebar-accent/20 px-4 sm:px-8 py-4 border-b border-slate-100 dark:border-sidebar-accent flex justify-between items-center">
                        <div className="flex items-center gap-2">
                            <FileText className="w-4 h-4 text-slate-400" />
                            <span className="text-xs uppercase tracking-wider font-bold text-slate-500">Data Table</span>
                        </div>
                        <Badge variant="outline" className="text-[10px] py-0 px-2 border-primary/20 dark:border-sidebar-accent text-slate-500 font-mono">
                            Range: {format(new Date(submittedFromDate), 'dd MMM')} - {format(new Date(submittedTillDate), 'dd/MM/yyyy')}
                        </Badge>
                    </div>
                    <div className="flex flex-wrap items-center gap-4 px-4 sm:px-8 pt-4">
                        <TableSearchInput
                            value={tableSearchQuery}
                            onChange={setTableSearchQuery}
                            placeholder="Search addition & deletion..."
                            className="ml-auto"
                        />
                    </div>
                    <CardContent className="p-0">
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-brand-green-darker dark:bg-sidebar-accent hover:bg-brand-green-darker border-none">
                                        <TableHead className="text-white font-bold px-6 py-5 uppercase text-[10px] tracking-widest">FDO Name</TableHead>
                                        <TableHead className="text-white font-bold px-6 py-5 uppercase text-[10px] tracking-widest">Center Name</TableHead>
                                        <TableHead className="text-white font-bold px-4 py-5 uppercase text-[10px] tracking-widest text-right">Opening</TableHead>
                                        <TableHead className="text-white font-bold px-4 py-5 uppercase text-[10px] tracking-widest text-right">Induction</TableHead>
                                        <TableHead className="text-white font-bold px-4 py-5 uppercase text-[10px] tracking-widest text-right">Dropped</TableHead>
                                        <TableHead className="text-white font-bold px-4 py-5 uppercase text-[10px] tracking-widest text-right">Closing</TableHead>
                                        <TableHead className="text-white font-bold px-4 py-5 uppercase text-[10px] tracking-widest text-right">Adm. Fees</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {paginatedData.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={7} className="h-64 text-center">
                                                <div className="flex flex-col items-center justify-center text-slate-400 gap-2">
                                                    <FileText className="w-12 h-12 opacity-10" />
                                                    <p className="text-sm italic">No records found.</p>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        paginatedData.map((row, index) => (
                                            <TableRow
                                                key={index}
                                                className="hover:bg-green-50/40 dark:hover:bg-sidebar-accent/40 border-slate-100 dark:border-sidebar-accent transition-colors group"
                                            >
                                                <TableCell className="px-6 py-5 text-sm font-bold text-foreground dark:text-slate-100">{row.fdo}</TableCell>
                                                <TableCell className="px-6 py-5 text-sm font-medium text-sidebar-accent dark:text-slate-400">{row.centerName}</TableCell>
                                                <TableCell className="px-4 py-5 text-right font-mono font-bold text-slate-500">{row.opening}</TableCell>
                                                <TableCell className="px-4 py-5 text-right font-mono font-bold text-primary">{row.induction}</TableCell>
                                                <TableCell className="px-4 py-5 text-right font-mono font-bold text-rose-500">{row.dropped}</TableCell>
                                                <TableCell className="px-4 py-5 text-right font-mono font-bold text-foreground dark:text-slate-100">{row.closing}</TableCell>
                                                <TableCell className="px-4 py-5 text-right font-bold text-emerald-600">
                                                    {formatCurrency(row.admissionFees)}
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>

                    {/* Pagination */}
                    {searchedRows.length > itemsPerPage && (
                        <div className="bg-green-50/30 dark:bg-sidebar-accent/10 px-4 sm:px-8 py-6 border-t border-slate-100 dark:border-sidebar-accent flex items-center justify-between">
                            <p className="text-xs font-bold text-slate-500 uppercase tracking-tighter">
                                Showing {Math.min(searchedRows.length, (currentPage - 1) * itemsPerPage + 1)}-{Math.min(searchedRows.length, currentPage * itemsPerPage)} of {searchedRows.length}
                            </p>
                            <div className="flex gap-2">
                                {Array.from({ length: Math.ceil(searchedRows.length / itemsPerPage) }, (_, i) => i + 1).map((page) => (
                                    <Button
                                        key={page}
                                        onClick={() => setCurrentPage(page)}
                                        variant={currentPage === page ? 'default' : 'outline'}
                                        size="sm"
                                        className={cn(
                                            "min-w-[40px] h-10 rounded-lg font-bold transition-all",
                                            currentPage === page ? "bg-primary shadow-lg shadow-primary/30" : "hover:border-primary"
                                        )}
                                    >
                                        {page}
                                    </Button>
                                ))}
                            </div>
                        </div>
                    )}
                </Card>
            )}

            {!showReport && (
                <div className="flex flex-col items-center justify-center p-24 bg-white/40 dark:bg-brand-green-darker/20 rounded-3xl border border-dashed border-primary/20 dark:border-sidebar-accent animate-pulse">
                    <div className="p-4 bg-brand-green-tint dark:bg-sidebar-accent rounded-full mb-6">
                        <Users className="w-12 h-12 text-slate-300 dark:text-sidebar-accent" />
                    </div>
                    <h3 className="text-xl font-bold text-foreground dark:text-white">Awaiting Analysis</h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 text-center max-w-xs">
                        Specify a date range above to visualize client addition and deletion trends across all centers.
                    </p>
                </div>
            )}
        </div>
    );
}
