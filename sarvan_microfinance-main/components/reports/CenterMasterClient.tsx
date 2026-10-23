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
    Users,
    CreditCard,
    AlertCircle,
    TrendingUp,
    Search,
    MapPin,
    Building2,
    Briefcase,
    Clock,
    FileBarChart,
    FileType,
    FileOutput
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { MetricCard } from '@/components/dashboard/MetricCard';
import { apiClient } from '@/app/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import * as XLSX from 'xlsx-js-style';
import jsPDF from 'jspdf';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { drawCenterMasterReport } from '@/app/lib/reports/center-master-pdf';
import { buildReportSheet, autoSizeColumns, applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { normalizeMeetingTime } from '@/app/lib/utils/meeting-time';
import { exportToCSV, exportToWord, type WordExportOptions } from '@/app/lib/report-export-utils';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';
import { usePermission } from '@/app/hooks/usePermission';
import { truncateReportAmount } from '@/app/lib/utils/format-amount';
import { DateInput } from '@/components/ui/date-input';

type BranchOption = { id: string; name: string; code: string };

type CenterMasterData = {
    id: string;
    branchId: string;
    centerId: string;
    centerName: string;
    employeeName: string;
    meetingDay: string;
    meetingTime: string;
    kmFromBranch: number | null;
    contactPerson: string;
    contactPersonNumber: string;
    clients: number;
    waitingBorrowers: number;
    portfolio: number;
    arrear: number;
    advance: number;
    advAdjustment: number;
    preclosure: number;
};

export function CenterMasterClient() {
    const { toast } = useToast();
    const { canExportReport, getReportExportMode } = usePermission();
    const [reportDate, setReportDate] = useState<string>(() => format(new Date(), 'yyyy-MM-dd'));
    // Submitted (applied) date snapshot — frozen until the next Show click, so exports and
    // the on-screen snapshot label keep using the last-shown date even if reportDate is
    // edited afterward without clicking Show again.
    const [submittedReportDate, setSubmittedReportDate] = useState(reportDate);
    const [selectedBranch, setSelectedBranch] = useState<string>('all');
    const [branches, setBranches] = useState<BranchOption[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [showReport, setShowReport] = useState(false);
    const [data, setData] = useState<CenterMasterData[]>([]);

    useEffect(() => {
        fetch('/api/branches')
            .then((r) => r.json())
            .then((d) => setBranches(Array.isArray(d) ? d : (d.data ?? [])))
            .catch(() => {});
    }, []);

    // Calculate report-wide metrics
    const metrics = useMemo(() => {
        if (data.length === 0) return { centers: 0, portfolio: 0, arrears: 0, clients: 0 };
        return {
            centers: data.length,
            portfolio: data.reduce((acc, curr) => acc + curr.portfolio, 0),
            arrears: data.reduce((acc, curr) => acc + curr.arrear, 0),
            clients: data.reduce((acc, curr) => acc + curr.clients, 0),
        };
    }, [data]);

    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(data);

    const handleShow = async () => {
        if (!reportDate) {
            toast({
                title: 'Date required',
                description: 'Please select a report date.',
                variant: 'destructive',
            });
            return;
        }

        setIsLoading(true);
        try {
            const params = new URLSearchParams({ date: reportDate });
            if (selectedBranch !== 'all') params.set('branchId', selectedBranch);
            const response = await apiClient.get<CenterMasterData[]>(`/reports/others/center-master?${params.toString()}`);
            if (response.success && response.data) {
                setSubmittedReportDate(reportDate);
                setData(response.data);
                setShowReport(true);
                toast({
                    title: 'Report Generated',
                    description: `Successfully loaded data for ${response.data.length} centers.`,
                });
            } else {
                toast({
                    title: 'Error',
                    description: response.error || 'Failed to fetch center master data',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            toast({
                title: 'System Error',
                description: 'An unexpected error occurred while fetching the report.',
                variant: 'destructive',
            });
        } finally {
            setIsLoading(false);
        }
    };

    const handleReset = () => {
        const today = format(new Date(), 'yyyy-MM-dd');
        setReportDate(today);
        setSubmittedReportDate(today);
        setSelectedBranch('all');
        setShowReport(false);
        setData([]);
    };

    const handleExport = () => {
        if (data.length === 0) return;

        try {
            const { headers, rows } = buildCenterMasterClientExportRows();
            const excelRows = rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
            const ws = buildReportSheet('Center Master Report', excelRows);
            autoSizeColumns(ws);
            applyExcelReportFont(ws);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Center Master');
            const fileName = `Center_Master_${submittedReportDate}.xlsx`;
            XLSX.writeFile(wb, fileName);

            toast({
                title: 'Export Successful',
                description: `Center Master report saved as ${fileName}`,
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
    const buildCenterMasterClientExportRows = (): { headers: string[]; rows: (string | number)[][] } => {
        const headers = [
            'Sl No', 'Branch ID', 'Center ID', 'Center Name', 'Employee Name', 'Meeting Day',
            'Meeting Time', 'KM From Branch', 'Contact Person', 'Contact Person No.', 'Clients',
            'Waiting Borrowers', 'Portfolio', 'Arrear', 'Advance', 'Adv Adjustment', 'Preclosure',
        ];
        const rows: (string | number)[][] = searchedRows.map((row, index) => [
            index + 1, row.branchId, row.centerId, row.centerName, row.employeeName, row.meetingDay,
            row.meetingTime ? normalizeMeetingTime(row.meetingTime) : '', row.kmFromBranch ?? '', row.contactPerson, row.contactPersonNumber, row.clients,
            row.waitingBorrowers, truncateReportAmount(row.portfolio), truncateReportAmount(row.arrear), truncateReportAmount(row.advance), truncateReportAmount(row.advAdjustment), truncateReportAmount(row.preclosure),
        ]);
        if (searchedRows.length > 0) {
            const totClients = searchedRows.reduce((a, c) => a + (c.clients || 0), 0);
            const totWB = searchedRows.reduce((a, c) => a + (c.waitingBorrowers || 0), 0);
            const totPortfolio = searchedRows.reduce((a, c) => a + (c.portfolio || 0), 0);
            const totArrear = searchedRows.reduce((a, c) => a + (c.arrear || 0), 0);
            const totAdv = searchedRows.reduce((a, c) => a + (c.advance || 0), 0);
            const totAdvAdj = searchedRows.reduce((a, c) => a + (c.advAdjustment || 0), 0);
            const totPre = searchedRows.reduce((a, c) => a + (c.preclosure || 0), 0);
            rows.push([
                '', 'Grand Total:', '', '', '', '', '', '', '', '',
                totClients, totWB, truncateReportAmount(totPortfolio), truncateReportAmount(totArrear), truncateReportAmount(totAdv), truncateReportAmount(totAdvAdj), truncateReportAmount(totPre),
            ]);
        }
        return { headers, rows };
    };

    const handleExportPDF = async () => {
        if (data.length === 0) return;
        try {
            const doc = new jsPDF({ orientation: 'landscape' });
            const reportFont = await ensureReportFont(doc);
            await drawCenterMasterReport(doc, searchedRows, { subtitle: `Date: ${submittedReportDate}` }, reportFont);
            doc.save(`Center_Master_${submittedReportDate}.pdf`);
            toast({ title: 'Export Successful', description: 'PDF downloaded.' });
        } catch {
            toast({ title: 'Export Failed', description: 'Failed to generate PDF file.', variant: 'destructive' });
        }
    };

    const handleExportCSV = () => {
        if (data.length === 0) return;
        const { headers, rows } = buildCenterMasterClientExportRows();
        exportToCSV(`Center_Master_${submittedReportDate}`, 'CENTER MASTER REPORT', headers, rows);
    };

    // Word-only presentation: same rows as PDF/CSV above, but the trailing "Grand Total:"
    // row (when present) is split off for distinct styling. 17 flat columns — each metric
    // (Clients, Waiting Borrowers, Portfolio, Arrear, Advance, Adv Adjustment, Preclosure)
    // is distinct, no genuine repeated-prefix pairs to group.
    const buildCenterMasterClientWordOptions = (
        rows: (string | number)[][]
    ): { bodyRows: (string | number)[][]; options: WordExportOptions } => {
        const hasTotals = rows.length > 0 && rows[rows.length - 1][1] === 'Grand Total:';
        return {
            bodyRows: hasTotals ? rows.slice(0, -1) : rows,
            options: {
                columnAlignments: ['center', 'center', 'center', 'left', 'left', 'center', 'center', 'right', 'left', 'left', 'right', 'right', 'right', 'right', 'right', 'right', 'right'],
                columnWidthWeights: [5, 8, 8, 12, 10, 8, 8, 8, 10, 9, 7, 8, 8, 7, 7, 8, 7],
                totalsRow: hasTotals ? rows[rows.length - 1] : undefined,
            },
        };
    };

    const handleExportWord = async () => {
        if (data.length === 0) return;
        const { headers, rows } = buildCenterMasterClientExportRows();
        const { bodyRows, options } = buildCenterMasterClientWordOptions(rows);
        await exportToWord(`Center_Master_${submittedReportDate}`, 'CENTER MASTER REPORT', headers, bodyRows, options);
    };

    const formatCurrency = (amt: number) => {
        return new Intl.NumberFormat('en-IN', {
            style: 'currency',
            currency: 'INR',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
        }).format(Math.trunc(amt));
    };

    return (
        <div className="space-y-8 animate-in fade-in duration-700">
            {/* Metric Summary */}
            {showReport && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 animate-in slide-in-from-top-4 duration-500">
                    <MetricCard
                        title="Total Centers"
                        value={metrics.centers.toString()}
                        subtitle="Active centers tracked"
                        icon={Building2}
                        gradient="blue"
                    />
                    <MetricCard
                        title="Total Portfolio"
                        value={formatCurrency(metrics.portfolio)}
                        subtitle="Outstanding principal"
                        icon={CreditCard}
                        gradient="indigo"
                    />
                    <MetricCard
                        title="Total Arrears"
                        value={formatCurrency(metrics.arrears)}
                        subtitle="Total overdue amount"
                        icon={AlertCircle}
                        gradient="rose"
                    />
                    <MetricCard
                        title="Borrowing Clients"
                        value={metrics.clients.toString()}
                        subtitle="Clients with active loans"
                        icon={Users}
                        gradient="green"
                    />
                </div>
            )}

            {/* Parameter Panel */}
            <Card className="overflow-hidden border-none shadow-2xl bg-white/70 dark:bg-brand-green-darker/50 backdrop-blur-xl">
                <CardHeader className="bg-brand-green-darker dark:bg-sidebar-accent py-6">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-primary/20 rounded-lg">
                            <Search className="w-5 h-5 text-primary" />
                        </div>
                        <div>
                            <CardTitle className="text-xl font-bold text-white">Report Parameters</CardTitle>
                            <p className="text-xs text-slate-400 mt-1">Select date for comprehensive center analysis</p>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-8">
                    <div className="grid grid-cols-1 md:grid-cols-5 gap-6 items-end">
                        <div className="space-y-3">
                            <Label className="text-sm font-bold text-sidebar-accent dark:text-slate-300 flex items-center gap-2">
                                <Building2 className="w-4 h-4 text-primary" />
                                Branch
                            </Label>
                            <Select value={selectedBranch} onValueChange={setSelectedBranch}>
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

                        <div className="space-y-3">
                            <Label className="text-sm font-bold text-sidebar-accent dark:text-slate-300 flex items-center gap-2">
                                <Calendar className="w-4 h-4 text-primary" />
                                Report Date
                            </Label>
                            <DateInput
                                value={reportDate}
                                onChange={(e) => setReportDate(e.target.value)}
                                className="h-12 rounded-xl border-primary/20 dark:border-sidebar-accent focus:ring-2 focus:ring-primary transition-all font-medium"
                            />
                        </div>

                        <div className="md:col-span-3 flex flex-wrap gap-3">
                            <Button
                                onClick={handleShow}
                                disabled={isLoading}
                                className="h-12 px-8 rounded-xl bg-primary hover:bg-primary text-white shadow-lg shadow-primary/20 transition-all active:scale-95 flex-1 font-bold"
                            >
                                {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5 mr-2" />}
                                Show
                            </Button>
                            <Button
                                onClick={handleReset}
                                variant="outline"
                                className="h-12 px-6 rounded-xl border-red-200 dark:border-red-900/30 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/10 hover:text-red-700 transition-all flex-1 font-bold"
                            >
                                <RefreshCw className="w-5 h-5 mr-2" />
                                Reset
                            </Button>
                            <ExportDropdown
                                onExportPDF={showReport && data.length > 0 ? handleExportPDF : undefined}
                                onExportExcel={showReport && data.length > 0 ? handleExport : undefined}
                                onExportCSV={showReport && data.length > 0 ? handleExportCSV : undefined}
                                onExportWord={showReport && data.length > 0 ? handleExportWord : undefined}
                                reportSlug={showReport && data.length > 0 && getReportExportMode('center-master') === 'REQUEST_QUEUE' ? 'center-master' : undefined}
                                canExport={canExportReport('center-master')}
                                exportParams={{
                                    fromDate: submittedReportDate,
                                    branchIds: selectedBranch === 'all' ? 'ALL' : [selectedBranch],
                                }}
                                className="h-12 px-6 rounded-xl bg-brand-green-darker dark:bg-sidebar-accent hover:bg-sidebar-accent dark:hover:bg-sidebar-accent/80 text-white shadow-lg transition-all active:scale-95 flex-1 font-bold"
                            />
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Data Table */}
            {showReport && (
                <Card className="border-none shadow-2xl bg-white/80 dark:bg-brand-green-darker/60 backdrop-blur-xl overflow-hidden animate-in slide-in-from-bottom-5 duration-500">
                    <div className="px-4 sm:px-8 pt-5">
                        <ReportHeader
                            title="Center Master Report"
                            subtitle={`Snapshot: ${format(new Date(submittedReportDate), 'dd/MM/yyyy')}`}
                        />
                    </div>
                    <div className="bg-green-50/50 dark:bg-sidebar-accent/20 px-4 sm:px-8 py-4 border-b border-slate-100 dark:border-sidebar-accent flex justify-between items-center">
                        <div className="flex items-center gap-2">
                            <Briefcase className="w-4 h-4 text-slate-400" />
                            <span className="text-xs uppercase tracking-wider font-bold text-slate-500">Centers: {metrics.centers}</span>
                        </div>
                        <div className="flex items-center gap-4">
                            <Badge variant="outline" className="text-[10px] py-0 px-2 border-primary/20 dark:border-sidebar-accent text-slate-500">
                                Snapshot: {format(new Date(submittedReportDate), 'dd/MM/yyyy')}
                            </Badge>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-4 px-4 sm:px-8 pt-4">
                        <TableSearchInput
                            value={tableSearchQuery}
                            onChange={setTableSearchQuery}
                            placeholder="Search centers..."
                            className="ml-auto"
                        />
                    </div>
                    <CardContent className="p-0">
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-brand-green-darker dark:bg-sidebar-accent hover:bg-brand-green-darker dark:hover:bg-sidebar-accent border-none">
                                        <TableHead className="text-white font-bold px-4 py-5 uppercase text-[10px] tracking-widest text-center">Br ID</TableHead>
                                        <TableHead className="text-white font-bold px-4 py-5 uppercase text-[10px] tracking-widest text-center">Ctr ID</TableHead>
                                        <TableHead className="text-white font-bold px-6 py-5 uppercase text-[10px] tracking-widest">Center Name</TableHead>
                                        <TableHead className="text-white font-bold px-6 py-5 uppercase text-[10px] tracking-widest">Employee Name</TableHead>
                                        <TableHead className="text-white font-bold px-4 py-5 uppercase text-[10px] tracking-widest">Meeting</TableHead>
                                        <TableHead className="text-white font-bold px-4 py-5 uppercase text-[10px] tracking-widest">KM</TableHead>
                                        <TableHead className="text-white font-bold px-4 py-5 uppercase text-[10px] tracking-widest">Contact Person</TableHead>
                                        <TableHead className="text-white font-bold px-4 py-5 uppercase text-[10px] tracking-widest">Contact No.</TableHead>
                                        <TableHead className="text-white font-bold px-4 py-5 uppercase text-[10px] tracking-widest text-center">Clients</TableHead>
                                        <TableHead className="text-white font-bold px-4 py-5 uppercase text-[10px] tracking-widest text-center">Waiters</TableHead>
                                        <TableHead className="text-white font-bold px-4 py-5 uppercase text-[10px] tracking-widest text-right">Portfolio</TableHead>
                                        <TableHead className="text-white font-bold px-4 py-5 uppercase text-[10px] tracking-widest text-right">Arrear</TableHead>
                                        <TableHead className="text-white font-bold px-4 py-5 uppercase text-[10px] tracking-widest text-right">Preclosure</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {searchedRows.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={13} className="h-64 text-center">
                                                <div className="flex flex-col items-center justify-center text-slate-400 gap-2">
                                                    <FileText className="w-12 h-12 opacity-10" />
                                                    <p className="text-sm italic">No records found for the selected date.</p>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        searchedRows.map((row) => (
                                            <TableRow
                                                key={row.id}
                                                className="hover:bg-green-50/40 dark:hover:bg-sidebar-accent/40 border-slate-100 dark:border-sidebar-accent transition-colors group"
                                            >
                                                <TableCell className="px-4 py-5 text-center font-mono text-xs text-slate-500">{row.branchId}</TableCell>
                                                <TableCell className="px-4 py-5 text-center font-mono font-bold text-foreground dark:text-slate-100">{row.centerId}</TableCell>
                                                <TableCell className="px-6 py-5 font-bold text-foreground dark:text-slate-100 group-hover:text-primary transition-colors">{row.centerName}</TableCell>
                                                <TableCell className="px-6 py-5 text-sm font-medium text-sidebar-accent dark:text-slate-400 underline decoration-dotted decoration-slate-300 underline-offset-4">{row.employeeName}</TableCell>
                                                <TableCell className="px-4 py-5">
                                                    <div className="flex flex-col gap-0.5">
                                                        <span className="text-[10px] uppercase font-bold text-primary">{row.meetingDay}</span>
                                                        <span className="text-[11px] font-mono text-slate-400 flex items-center gap-1">
                                                            <Clock className="w-3 h-3" />
                                                            {row.meetingTime ? normalizeMeetingTime(row.meetingTime) : '—'}
                                                        </span>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="px-4 py-5 text-sm text-slate-500">
                                                    {row.kmFromBranch != null ? `${row.kmFromBranch} km` : '—'}
                                                </TableCell>
                                                <TableCell className="px-4 py-5 text-sm text-slate-500">
                                                    {row.contactPerson || '—'}
                                                </TableCell>
                                                <TableCell className="px-4 py-5 text-sm text-slate-500">
                                                    {row.contactPersonNumber || '—'}
                                                </TableCell>
                                                <TableCell className="px-4 py-5 text-center">
                                                    <Badge variant="outline" className="bg-green-50/50 text-sidebar-accent dark:bg-brand-green-darker/20 dark:text-primary border-primary/20 dark:border-sidebar-accent font-mono">
                                                        {row.clients}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="px-4 py-5 text-center">
                                                    <Badge variant="outline" className="bg-amber-50/50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400 border-amber-100 dark:border-amber-800 font-mono">
                                                        {row.waitingBorrowers}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="px-4 py-5 text-right font-bold text-foreground dark:text-slate-100">
                                                    {formatCurrency(row.portfolio)}
                                                </TableCell>
                                                <TableCell className="px-4 py-5 text-right">
                                                    <span className={cn(
                                                        "font-bold",
                                                        row.arrear > 0 ? "text-rose-600 shadow-[0_4px_10px_rgba(225,29,72,0.15)] bg-rose-50 dark:bg-rose-900/20 px-2 py-1 rounded" : "text-slate-400"
                                                    )}>
                                                        {formatCurrency(row.arrear)}
                                                    </span>
                                                </TableCell>
                                                <TableCell className="px-4 py-5 text-right font-medium text-sidebar-accent dark:text-slate-400">
                                                    {row.preclosure}
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
