'use client';

import { useState, useEffect } from 'react';
import * as XLSX from 'xlsx-js-style';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
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
    LayoutList,
    Download,
    RefreshCw,
    Search,
    Loader2,
    Users,
    FileText,
    FileType,
    FileOutput,
    ChevronLeft,
    ChevronRight,
    Filter
} from 'lucide-react';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { useToast } from '@/hooks/use-toast';
import { usePermission } from '@/app/hooks/usePermission';
import { OSClientwiseRow } from '@/app/lib/actions/reports';
import jsPDF from 'jspdf';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { drawOsClientwiseReport } from '@/app/lib/reports/os-clientwise-pdf';
import { autoSizeColumns, applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { formatReportAmount, truncateReportAmount } from '@/app/lib/utils/format-amount';
import { exportToCSV, exportToWord, type WordExportOptions } from '@/app/lib/report-export-utils';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { PageLoader } from '@/components/ui/page-loader';

import { cn } from '@/lib/utils';
import { DateInput } from '@/components/ui/date-input';

// Format currency — whole rupees, truncated (not rounded), per the report amount-display requirement.
const formatCurrency = (amount: number) => formatReportAmount(amount);

export default function OSClientwisePage() {
    const { toast } = useToast();
    const { canExportReport, getReportExportMode } = usePermission();
    const [selectedFunder, setSelectedFunder] = useState('all');
    const [selectedCenter, setSelectedCenter] = useState('all');
    const [reportDate, setReportDate] = useState<string>(
        new Date().toISOString().split('T')[0]
    );
    // Submitted (applied) date snapshot — frozen until the next Search click, so pagination
    // and exports keep using the last-submitted date even if reportDate above is edited
    // afterward without clicking Search again.
    const [submittedReportDate, setSubmittedReportDate] = useState<string>(reportDate);
    const [searchTerm, setSearchTerm] = useState('');

    // Data states
    const [data, setData] = useState<OSClientwiseRow[]>([]);
    const [centers, setCenters] = useState<{ id: string; name: string; code: string }[]>([]);
    const [funders, setFunders] = useState<{ id: string; funderName: string }[]>([]);
    const [hasFetched, setHasFetched] = useState(false);

    // Loading states
    const [isLoading, setIsLoading] = useState(false);
    const [isExporting, setIsExporting] = useState(false);

    // Pagination
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [totalCount, setTotalCount] = useState(0);
    const PAGE_SIZE = 10;

    // Fetch initial filter data
    useEffect(() => {
        fetchCenters();
        fetchFunders();
    }, []);

    const fetchCenters = async () => {
        try {
            const response = await fetch('/api/centers?includeInactive=false');
            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    setCenters(result.data);
                }
            }
        } catch (error) {
            console.error('Failed to fetch centers', error);
        }
    };

    const fetchFunders = async () => {
        try {
            const response = await fetch('/api/masters/funder');
            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    setFunders(result.data);
                }
            }
        } catch (error) {
            console.error('Failed to fetch funders', error);
        }
    };

    // `dateOverride` lets handleSearch pass the just-read draft date straight through on the
    // same click — reading submittedReportDate here would otherwise use the pre-update (stale)
    // state, since setSubmittedReportDate hasn't re-rendered yet. Callers other than
    // handleSearch (pagination, export) omit it and get the last-submitted snapshot.
    const fetchReportData = async (page: number = 1, dateOverride?: string) => {
        setIsLoading(true);
        try {
            const params = new URLSearchParams({
                reportDate: dateOverride ?? submittedReportDate,
                page: page.toString(),
                pageSize: PAGE_SIZE.toString(),
            });

            if (selectedCenter && selectedCenter !== 'all') params.append('centerId', selectedCenter);
            if (selectedFunder && selectedFunder !== 'all') params.append('funderId', selectedFunder);
            if (searchTerm) params.append('search', searchTerm);

            const response = await fetch(`/api/reports/os-clientwise?${params}`);

            if (!response.ok) throw new Error('Failed to fetch data');

            const result = await response.json();
            setData(result.data || []);
            setTotalCount(result.totalCount || 0);
            setTotalPages(result.totalPages || 1);
            setHasFetched(true);
        } catch (error) {
            console.error('Error fetching OS clientwise data:', error);
            toast({
                title: 'Error',
                description: 'Failed to fetch report data',
                variant: 'destructive',
            });
            setData([]);
        } finally {
            setIsLoading(false);
        }
    };

    const fetchAllForExport = async (): Promise<OSClientwiseRow[] | null> => {
        setIsExporting(true);
        try {
            const params = new URLSearchParams({
                reportDate: submittedReportDate,
                exportAll: 'true',
            });

            if (selectedCenter && selectedCenter !== 'all') params.append('centerId', selectedCenter);
            if (selectedFunder && selectedFunder !== 'all') params.append('funderId', selectedFunder);
            if (searchTerm) params.append('search', searchTerm);

            const response = await fetch(`/api/reports/os-clientwise?${params}`);
            if (!response.ok) throw new Error('Failed to fetch data');

            const result = await response.json();
            return result.data || [];
        } catch (error) {
            console.error('Error fetching all OS clientwise data for export:', error);
            toast({
                title: 'Export Error',
                description: 'Failed to fetch all data for export.',
                variant: 'destructive',
            });
            return null;
        } finally {
            setIsExporting(false);
        }
    };

    const handleSearch = () => {
        setSubmittedReportDate(reportDate);
        setCurrentPage(1);
        fetchReportData(1, reportDate);
    };

    const handlePageChange = (newPage: number) => {
        setCurrentPage(newPage);
        fetchReportData(newPage);
    };

    const handleReset = () => {
        setSearchTerm('');
        setSelectedCenter('all');
        setSelectedFunder('all');
        setReportDate(new Date().toISOString().split('T')[0]);
        setSubmittedReportDate(new Date().toISOString().split('T')[0]);
        setCurrentPage(1);
        setData([]);
        setTotalCount(0);
        setTotalPages(1);
        setHasFetched(false);
    };

    const handleExport = async () => {
        if (data.length === 0) {
            toast({
                title: 'No Data',
                description: 'No data available to export.',
                variant: 'destructive',
            });
            return;
        }

        const allData = await fetchAllForExport();
        if (!allData || allData.length === 0) return;

        try {
            const excelData = allData.map(item => ({
                'Branch Name': item.branchName,
                'Center Name': item.centerName,
                'Client Name': item.clientName,
                'Disbursal Date': item.disbursalDate,
                'Loan Amount': truncateReportAmount(item.loanAmount),
                'Due Start Date': item.dueStartDate,
                'Tenure': item.tenure,
                'Loan A/c': item.loanAc,
                'OS Principle': truncateReportAmount(item.osPrincipal),
                'OS Interest': truncateReportAmount(item.osInterest),
                'Arrear Pri': truncateReportAmount(item.arrearPri),
                'Arrear Int': truncateReportAmount(item.arrearInt),
                'Funder': item.funder,
                'Mobile #': item.mobileNo,
            }));

            const ws = XLSX.utils.json_to_sheet(excelData);
            autoSizeColumns(ws);
            applyExcelReportFont(ws);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'OS Clientwise');

            const fileName = `OS_Clientwise_${submittedReportDate}.xlsx`;
            XLSX.writeFile(wb, fileName);

            toast({
                title: 'Export Successful',
                description: `Downloaded ${fileName}`,
            });
        } catch (error) {
            console.error('Export error:', error);
            toast({
                title: 'Export Failed',
                description: 'Could not generate Excel file.',
                variant: 'destructive',
            });
        }
    };

    // Mirrors the same field mapping used by handleExport above (kept separate so
    // handleExport is left untouched).
    const buildOSClientwiseExportRows = (rows: OSClientwiseRow[]): { headers: string[]; rows: (string | number)[][] } => {
        const headers = [
            'Branch Name', 'Center Name', 'Client Name', 'Disbursal Date', 'Loan Amount',
            'Due Start Date', 'Tenure', 'Loan A/c', 'OS Principle', 'OS Interest',
            'Arrear Pri', 'Arrear Int', 'Funder', 'Mobile #',
        ];
        const dataRows: (string | number)[][] = rows.map(item => [
            item.branchName, item.centerName, item.clientName, item.disbursalDate, truncateReportAmount(item.loanAmount),
            item.dueStartDate, item.tenure, item.loanAc, truncateReportAmount(item.osPrincipal), truncateReportAmount(item.osInterest),
            truncateReportAmount(item.arrearPri), truncateReportAmount(item.arrearInt), item.funder, item.mobileNo,
        ]);
        return { headers, rows: dataRows };
    };

    const handleExportPDF = async () => {
        if (data.length === 0) {
            toast({ title: 'No Data', description: 'No data available to export.', variant: 'destructive' });
            return;
        }
        const allData = await fetchAllForExport();
        if (!allData || allData.length === 0) return;
        const doc = new jsPDF({ orientation: 'landscape' });
        const reportFont = await ensureReportFont(doc);
        await drawOsClientwiseReport(doc, allData, { subtitle: `As on ${submittedReportDate}` }, reportFont);
        doc.save(`OS_Clientwise_${submittedReportDate}.pdf`);
        toast({ title: 'Export Successful', description: 'PDF downloaded.' });
    };

    const handleExportCSV = async () => {
        if (data.length === 0) {
            toast({ title: 'No Data', description: 'No data available to export.', variant: 'destructive' });
            return;
        }
        const allData = await fetchAllForExport();
        if (!allData || allData.length === 0) return;
        const { headers, rows } = buildOSClientwiseExportRows(allData);
        exportToCSV(`OS_Clientwise_${submittedReportDate}`, 'OS CLIENTWISE REPORT', headers, rows);
    };

    // Word-only presentation: same rows as PDF/CSV above. No totals row exists in this
    // report today — nothing to preserve/style distinctly. OS and Arrear Principal-Interest
    // pairs get a light 2-row grouped header; the other 10 columns stay standalone.
    const wordOptions: WordExportOptions = {
        groupHeaders: [
            { label: 'Branch Name', span: 1 }, { label: 'Center Name', span: 1 }, { label: 'Client Name', span: 1 },
            { label: 'Disbursal Date', span: 1 }, { label: 'Loan Amount', span: 1 }, { label: 'Due Start Date', span: 1 },
            { label: 'Tenure', span: 1 }, { label: 'Loan A/c', span: 1 }, { label: 'OS', span: 2 },
            { label: 'ARREAR', span: 2 }, { label: 'Funder', span: 1 }, { label: 'Mobile #', span: 1 },
        ],
        subHeaders: ['Principle', 'Interest', 'Pri', 'Int'],
        columnAlignments: ['left', 'left', 'left', 'center', 'right', 'center', 'center', 'center', 'right', 'right', 'right', 'right', 'left', 'center'],
        columnWidthWeights: [10, 10, 12, 8, 8, 8, 6, 8, 8, 8, 8, 8, 9, 8],
    };

    const handleExportWord = async () => {
        if (data.length === 0) {
            toast({ title: 'No Data', description: 'No data available to export.', variant: 'destructive' });
            return;
        }
        const allData = await fetchAllForExport();
        if (!allData || allData.length === 0) return;
        const { headers, rows } = buildOSClientwiseExportRows(allData);
        await exportToWord(`OS_Clientwise_${submittedReportDate}`, 'OS CLIENTWISE REPORT', headers, rows, wordOptions);
    };

    const goToPreviousPage = () => {
        if (currentPage > 1) handlePageChange(currentPage - 1);
    };

    const goToNextPage = () => {
        if (currentPage < totalPages) handlePageChange(currentPage + 1);
    };

    const pageTotals = data.reduce(
        (acc, item) => ({
            loanAmount: acc.loanAmount + item.loanAmount,
            osPrincipal: acc.osPrincipal + item.osPrincipal,
            osInterest: acc.osInterest + item.osInterest,
            arrearPri: acc.arrearPri + item.arrearPri,
            arrearInt: acc.arrearInt + item.arrearInt,
        }),
        { loanAmount: 0, osPrincipal: 0, osInterest: 0, arrearPri: 0, arrearInt: 0 }
    );

    return (
        <ProtectedRoute requiredPermission="OS_CLIENTWISE">
            <div className="relative min-h-screen bg-gradient-to-br from-background via-green-50/40 to-green-50/40 dark:from-background dark:via-brand-green-darker dark:to-green-950">
                <div className="container mx-auto px-4 py-8">
                    {/* Premium Header */}
                    <div className="mb-8 flex items-center gap-4">
                        <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary shadow-lg shadow-primary/30">
                            <Users className="h-7 w-7 text-white" />
                            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/20 to-transparent pointer-events-none" />
                        </div>
                        <div>
                            <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-foreground dark:text-white">
                                OS Clientwise
                            </h1>
                            <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                                Client-level outstanding portfolio reporting and arrears tracking.
                            </p>
                        </div>
                    </div>

                    {/* Filter Card */}
                    <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden mb-6">
                        <div className="h-1.5 bg-gradient-to-r from-primary via-primary to-violet-600" />
                        <CardHeader className="bg-gradient-to-r from-slate-50 via-green-50/60 to-green-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker pb-4">
                            <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-green-tint dark:bg-brand-green-darker/30">
                                    <Filter className="h-5 w-5 text-primary dark:text-primary" />
                                </div>
                                <h3 className="text-lg font-semibold text-sidebar-accent dark:text-slate-200">Report Filters</h3>
                            </div>
                        </CardHeader>
                        <CardContent className="pt-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
                                <div className="space-y-2 lg:col-span-1">
                                    <Label htmlFor="funder" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Funder Name
                                    </Label>
                                    <Select value={selectedFunder} onValueChange={setSelectedFunder}>
                                        <SelectTrigger id="funder" className="h-11 border-primary/30 dark:border-sidebar-accent bg-white dark:bg-brand-green-darker text-sidebar-accent dark:text-slate-300">
                                            <SelectValue placeholder="-- ALL FUNDERS --" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="all">-- ALL FUNDERS --</SelectItem>
                                            {funders.map((funder) => (
                                                <SelectItem key={funder.id} value={funder.id}>
                                                    {funder.funderName}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                <div className="space-y-2 lg:col-span-1">
                                    <Label htmlFor="center" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Center Name
                                    </Label>
                                    <Select value={selectedCenter} onValueChange={setSelectedCenter}>
                                        <SelectTrigger id="center" className="h-11 border-primary/30 dark:border-sidebar-accent bg-white dark:bg-brand-green-darker text-sidebar-accent dark:text-slate-300">
                                            <SelectValue placeholder="-- ALL CENTERS --" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="all">-- ALL CENTERS --</SelectItem>
                                            {centers.map((center) => (
                                                <SelectItem key={center.id} value={center.id}>
                                                    {center.code} - {center.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                <div className="space-y-2 lg:col-span-1">
                                    <Label htmlFor="reportDate" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Report Date
                                    </Label>
                                    <DateInput
                                        id="reportDate"
                                        value={reportDate}
                                        onChange={(e) => setReportDate(e.target.value)}
                                        className="h-11 border-primary/30 dark:border-sidebar-accent text-sidebar-accent dark:text-slate-200 bg-white dark:bg-brand-green-darker"
                                    />
                                </div>

                                <div className="space-y-2 lg:col-span-2">
                                    <Label className="text-sm font-semibold opacity-0">Actions</Label>
                                    <div className="flex gap-2">
                                        <Button
                                            onClick={handleSearch}
                                            disabled={isLoading}
                                            className="h-11 flex-1 bg-gradient-to-r from-primary to-primary hover:from-sidebar-accent hover:to-primary text-white shadow-lg shadow-primary/30 font-semibold"
                                        >
                                            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                                            Show
                                        </Button>
                                        <Button
                                            variant="outline"
                                            onClick={handleReset}
                                            disabled={isLoading}
                                            className="h-11 flex-1 border-primary/30 text-sidebar-accent hover:bg-brand-green-tint dark:border-sidebar-accent/60 dark:text-slate-300 dark:hover:bg-sidebar-accent font-medium transition-colors"
                                        >
                                            <RefreshCw className="mr-2 h-4 w-4 text-slate-500" />
                                            Reset
                                        </Button>
                                        <ExportDropdown
                                            onExportPDF={!isLoading && !isExporting && data.length > 0 ? handleExportPDF : undefined}
                                            onExportExcel={!isLoading && !isExporting && data.length > 0 ? handleExport : undefined}
                                            onExportCSV={!isLoading && !isExporting && data.length > 0 ? handleExportCSV : undefined}
                                            onExportWord={!isLoading && !isExporting && data.length > 0 ? handleExportWord : undefined}
                                            reportSlug={!isLoading && !isExporting && data.length > 0 && getReportExportMode('os-clientwise-admin') === 'REQUEST_QUEUE' ? 'os-clientwise-admin' : undefined}
                                            canExport={canExportReport('os-clientwise-admin')}
                                            exportParams={{
                                                fromDate: submittedReportDate,
                                                branchIds: 'ALL',
                                                filters: {
                                                    ...(selectedCenter !== 'all' ? { centerId: selectedCenter } : {}),
                                                    ...(selectedFunder !== 'all' ? { funderId: selectedFunder } : {}),
                                                },
                                            }}
                                            className="h-11 flex-1 border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700/50 dark:text-emerald-400 dark:hover:bg-emerald-950/30 font-medium transition-colors shadow-sm"
                                        />
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Data Display */}
                    {!hasFetched && !isLoading ? (
                        <Card className="border-2 border-primary/20 border-dashed bg-green-50/50 p-12 text-center dark:border-sidebar-accent dark:bg-brand-green-darker/20 shadow-sm rounded-xl">
                            <FileText className="mx-auto h-16 w-16 text-slate-400 dark:text-slate-500 opacity-50 mb-4" />
                            <h3 className="text-xl font-semibold text-sidebar-accent dark:text-slate-300">No Data Displayed</h3>
                            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                                Select your desired filters above and click "Show" to generate the precise OS Clientwise tracking report.
                            </p>
                        </Card>
                    ) : (
                        <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden rounded-xl">
                            <CardContent className="p-0">
                                <div className="overflow-x-auto scrollbar-thin scrollbar-track-slate-100 scrollbar-thumb-slate-300 dark:scrollbar-track-brand-green-darker dark:scrollbar-thumb-sidebar-accent">
                                    <Table className="min-w-[1300px]">
                                        <TableHeader className="bg-gradient-to-r from-sidebar-accent via-primary to-sidebar-accent">
                                            <TableRow className="hover:bg-transparent border-none">
                                                <TableHead className="h-12 px-4 text-white font-semibold text-xs whitespace-nowrap">Branch Name</TableHead>
                                                <TableHead className="h-12 px-4 text-white font-semibold text-xs whitespace-nowrap">Center Name</TableHead>
                                                <TableHead className="h-12 px-4 text-white font-semibold text-xs whitespace-nowrap">Client Name</TableHead>
                                                <TableHead className="h-12 px-4 text-white font-semibold text-xs whitespace-nowrap">Disbursal Date</TableHead>
                                                <TableHead className="h-12 px-4 text-primary font-semibold text-xs text-right whitespace-nowrap">Loan Amount</TableHead>
                                                <TableHead className="h-12 px-4 text-white font-semibold text-xs whitespace-nowrap">Due Start</TableHead>
                                                <TableHead className="h-12 px-4 text-white font-semibold text-xs text-center whitespace-nowrap border-l border-white/10">Tenure</TableHead>
                                                <TableHead className="h-12 px-4 text-white font-semibold text-xs whitespace-nowrap">Loan A/c</TableHead>
                                                <TableHead className="h-12 px-4 text-green-100 font-semibold text-xs text-right whitespace-nowrap border-l border-white/10">OS Principal</TableHead>
                                                <TableHead className="h-12 px-4 text-green-100 font-semibold text-xs text-right whitespace-nowrap">OS Interest</TableHead>
                                                <TableHead className="h-12 px-4 text-rose-200 font-bold text-xs text-right whitespace-nowrap border-l border-white/10">Arrear Pri</TableHead>
                                                <TableHead className="h-12 px-4 text-rose-200 font-bold text-xs text-right whitespace-nowrap">Arrear Int</TableHead>
                                                <TableHead className="h-12 px-4 text-white font-semibold text-xs text-center whitespace-nowrap border-l border-white/10">Funder</TableHead>
                                                <TableHead className="h-12 px-4 text-white font-semibold text-xs whitespace-nowrap">Mobile #</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody className="bg-white dark:bg-green-950/30">
                                            {isLoading ? (
                                                <TableRow>
                                                    <TableCell colSpan={14} className="h-64">
                                                        <PageLoader label="Aggregating portfolio ledgers..." fullScreen={false} />
                                                    </TableCell>
                                                </TableRow>
                                            ) : data.length === 0 ? (
                                                <TableRow>
                                                    <TableCell colSpan={14} className="h-64">
                                                        <div className="flex flex-col items-center justify-center h-full text-slate-500">
                                                            <LayoutList className="h-12 w-12 mb-4 opacity-20 text-slate-400" />
                                                            <span className="font-semibold text-sidebar-accent dark:text-slate-400">No portfolio records found for the chosen filters.</span>
                                                        </div>
                                                    </TableCell>
                                                </TableRow>
                                            ) : (
                                                data.map((row, index) => {
                                                    const hasArrears = row.arrearPri > 0 || row.arrearInt > 0;
                                                    return (
                                                        <TableRow
                                                            key={index}
                                                            className={cn(
                                                                "transition-all duration-200 ease-in-out hover:shadow-sm border-b border-slate-100 dark:border-sidebar-accent/50",
                                                                index % 2 === 0 ? "bg-white dark:bg-brand-green-darker" : "bg-green-50/50 dark:bg-sidebar-accent/30",
                                                                hasArrears ? "bg-rose-50/40 hover:bg-rose-100/50 dark:bg-rose-950/20 dark:hover:bg-rose-900/30" : "hover:bg-green-50/50 dark:hover:bg-sidebar-accent/80"
                                                            )}
                                                        >
                                                            <TableCell className="px-4 py-3 text-xs text-sidebar-accent dark:text-slate-400 font-medium">{row.branchName}</TableCell>
                                                            <TableCell className="px-4 py-3 text-xs text-sidebar-accent dark:text-slate-300 font-medium">{row.centerName}</TableCell>
                                                            <TableCell className="px-4 py-3 text-xs text-sidebar-accent dark:text-primary font-bold whitespace-nowrap">{row.clientName}</TableCell>
                                                            <TableCell className="px-4 py-3 text-xs text-slate-500 dark:text-slate-500 whitespace-nowrap">{row.disbursalDate}</TableCell>
                                                            <TableCell className="px-4 py-3 text-xs text-right font-bold text-foreground dark:text-slate-100">
                                                                {formatCurrency(row.loanAmount)}
                                                            </TableCell>
                                                            <TableCell className="px-4 py-3 text-xs text-slate-500 dark:text-slate-500 whitespace-nowrap">{row.dueStartDate}</TableCell>
                                                            <TableCell className="px-4 py-3 text-xs text-center text-sidebar-accent dark:text-slate-400 border-l border-slate-100 dark:border-sidebar-accent/50">{row.tenure}</TableCell>
                                                            <TableCell className="px-4 py-3 text-xs text-sidebar-accent dark:text-slate-400 font-mono tracking-tight font-medium">{row.loanAc}</TableCell>
                                                            <TableCell className="px-4 py-3 text-xs text-right font-semibold text-sidebar-accent dark:text-slate-200 border-l border-slate-100 dark:border-sidebar-accent/50">
                                                                {formatCurrency(row.osPrincipal)}
                                                            </TableCell>
                                                            <TableCell className="px-4 py-3 text-xs text-right font-semibold text-sidebar-accent dark:text-slate-200">
                                                                {formatCurrency(row.osInterest)}
                                                            </TableCell>
                                                            <TableCell className={cn("px-4 py-3 text-xs text-right font-bold border-l border-slate-100 dark:border-sidebar-accent/50", row.arrearPri > 0 ? "text-rose-600 dark:text-rose-400" : "text-slate-400 dark:text-sidebar-accent")}>
                                                                {row.arrearPri > 0 ? formatCurrency(row.arrearPri) : '-'}
                                                            </TableCell>
                                                            <TableCell className={cn("px-4 py-3 text-xs text-right font-bold", row.arrearInt > 0 ? "text-rose-600 dark:text-rose-400" : "text-slate-400 dark:text-sidebar-accent")}>
                                                                {row.arrearInt > 0 ? formatCurrency(row.arrearInt) : '-'}
                                                            </TableCell>
                                                            <TableCell className="px-4 py-3 text-xs text-center border-l border-slate-100 dark:border-sidebar-accent/50">
                                                                <span className="bg-brand-green-tint dark:bg-sidebar-accent border border-primary/20 dark:border-sidebar-accent text-sidebar-accent dark:text-slate-400 px-2.5 py-1 rounded text-[10px] font-bold tracking-wide">
                                                                    {row.funder || 'N/A'}
                                                                </span>
                                                            </TableCell>
                                                            <TableCell className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400 font-mono">{row.mobileNo}</TableCell>
                                                        </TableRow>
                                                    );
                                                })
                                            )}
                                        </TableBody>
                                    </Table>
                                </div>

                                {/* Pagination Dashboard */}
                                {data.length > 0 && (
                                    <div className="border-t border-primary/20 dark:border-sidebar-accent bg-green-50/80 dark:bg-brand-green-darker/40 px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-4">
                                        <div className="text-sm text-sidebar-accent dark:text-slate-400 font-medium">
                                            Showing <span className="text-foreground dark:text-white font-bold">{data.length}</span> records on this page. Total Entries: <span className="text-foreground dark:text-white font-bold">{totalCount}</span>
                                        </div>
                                        <div className="flex items-center gap-1 bg-white dark:bg-sidebar-accent p-1 rounded-xl border border-primary/20 dark:border-sidebar-accent shadow-sm">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={goToPreviousPage}
                                                disabled={currentPage === 1 || isLoading}
                                                className="h-8 px-2 text-slate-500 hover:text-foreground dark:hover:text-white"
                                            >
                                                <ChevronLeft className="h-4 w-4" />
                                            </Button>

                                            <div className="flex gap-1 px-2">
                                                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                                                    let p = i + 1;
                                                    if (totalPages > 5 && currentPage > 3) p = currentPage - 2 + i;
                                                    if (p > totalPages) return null;
                                                    return (
                                                        <Button
                                                            key={p}
                                                            variant={currentPage === p ? "default" : "ghost"}
                                                            size="sm"
                                                            onClick={() => handlePageChange(p)}
                                                            className={cn(
                                                                "h-8 w-8 p-0 text-sm font-semibold transition-all rounded-lg",
                                                                currentPage === p
                                                                    ? "bg-primary text-white hover:bg-primary shadow-md shadow-primary/20"
                                                                    : "text-sidebar-accent hover:bg-brand-green-tint dark:text-slate-300 dark:hover:bg-sidebar-accent"
                                                            )}
                                                            disabled={isLoading}
                                                        >
                                                            {p}
                                                        </Button>
                                                    );
                                                })}
                                                {totalPages > 5 && currentPage < totalPages - 2 && (
                                                    <span className="text-slate-400 self-center px-1 font-bold">...</span>
                                                )}
                                            </div>

                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={goToNextPage}
                                                disabled={currentPage === totalPages || isLoading || totalPages === 0}
                                                className="h-8 px-2 text-slate-500 hover:text-foreground dark:hover:text-white"
                                            >
                                                <ChevronRight className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    )}
                </div>
            </div>
        </ProtectedRoute>
    );
}
