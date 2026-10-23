'use client';

import { useState, useRef, useMemo, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
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
import {
    FileText,
    FileBarChart,
    FileType,
    FileOutput,
    Download,
    RefreshCw,
    Filter,
    IndianRupee,
    CreditCard,
    TrendingUp,
    AlertCircle,
    Calendar,
    XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { apiClient } from '@/app/lib/api-client';
import { tokenStorage } from '@/app/lib/token-storage';
import { getCentersForDropdown, type CenterOption } from '@/app/lib/actions/centers';
import jsPDF from 'jspdf';
import * as XLSX from 'xlsx-js-style';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { drawPreclosureReport } from '@/app/lib/reports/preclosure-pdf';
import { reportHeaderRows, autoSizeColumns, applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { formatReportAmount } from '@/app/lib/utils/format-amount';
import { exportToCSV, exportToWord, type WordExportOptions } from '@/app/lib/report-export-utils';
import { usePermission } from '@/app/hooks/usePermission';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';
import { DateInput } from '@/components/ui/date-input';
import { MEMBER_CONTACT_HEADERS, memberContactValues, type MemberContactFields } from '@/app/lib/reports/member-contact-columns';
import { MemberContactCell, MEMBER_CONTACT_COLUMN_LABEL } from '@/components/reports/MemberContactCell';
import { toDisplayDateTime } from '@/app/lib/date-format';

type Branch = { id: string; name: string; code: string };

// Preclosure data interface
type PreclosureData = MemberContactFields & {
    precloseDate: string;
    branchName: string;
    centerName: string;
    clientName: string;
    loanAccount: string;
    arrearPri: number;
    arrearInt: number;
    currDmdPri: number;
    currDmdInt: number;
    preclosurePri: number;
    preclosureInt: number;
    totalAmount: number;
};

// Calculate summary metrics
const calculateSummary = (data: PreclosureData[]) => {
    return {
        totalPreclosures: data.length,
        totalAmount: data.reduce((sum, item) => sum + item.totalAmount, 0),
        totalArrearPri: data.reduce((sum, item) => sum + item.arrearPri, 0),
        totalArrearInt: data.reduce((sum, item) => sum + item.arrearInt, 0),
        totalCurrDmdPri: data.reduce((sum, item) => sum + item.currDmdPri, 0),
        totalCurrDmdInt: data.reduce((sum, item) => sum + item.currDmdInt, 0),
        totalPreclosurePri: data.reduce((sum, item) => sum + item.preclosurePri, 0),
        totalPreclosureInt: data.reduce((sum, item) => sum + item.preclosureInt, 0),
        avgPreclosureAmount: data.length > 0 ? data.reduce((sum, item) => sum + item.totalAmount, 0) / data.length : 0,
    };
};

// Format currency (whole rupees, truncated — not rounded)
const formatCurrency = (amount: number) => formatReportAmount(amount);

// Format date from YYYY-MM-DD to DD/MM/YYYY for display
const formatDateForDisplay = (dateString: string) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day} / ${month} / ${year}`;
};

export function PreclosureClient() {
    const { canExportReport, getReportExportMode, isHeadOffice } = usePermission();
    const [fromDate, setFromDate] = useState<string>(
        new Date().toISOString().split('T')[0]
    );
    const [tillDate, setTillDate] = useState<string>(
        new Date().toISOString().split('T')[0]
    );
    // Snapshot of fromDate/tillDate as of the last "Show" click — used for export
    // filenames, PDF/Word subtitles, on-screen labels, and exportParams so a draft
    // date edit (without clicking Show) never changes what's displayed/exported.
    const [submittedFromDate, setSubmittedFromDate] = useState<string>(fromDate);
    const [submittedTillDate, setSubmittedTillDate] = useState<string>(tillDate);
    const [isLoading, setIsLoading] = useState(false);
    const [showReport, setShowReport] = useState(false);
    const [currentPage, setCurrentPage] = useState(1);
    const [data, setData] = useState<PreclosureData[]>([]);
    const printRef = useRef<HTMLDivElement>(null);
    const { toast } = useToast();

    // Branch/Center filter — ADMIN, SUBADMIN (ADMIN_NON_HO_BRANCH_SWITCH), AREA_MANAGER,
    // and any Head-Office-based user (incl. custom RBAC roles like "Zonal Head") get a
    // picker; AREA_MANAGER's branch list is scoped to their assigned branches.
    // The user lives in browser storage, so it can't be read during SSR — reading it in render
    // made the server omit the Branch filter while the client showed it (hydration mismatch).
    // Read it only after mount so the first client render matches the server HTML.
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);
    const storedUser = mounted ? tokenStorage.getUser() : null;
    const isAreaManager = storedUser?.role === 'AREA_MANAGER';
    const canFilterByBranch = mounted && (storedUser?.role === 'ADMIN' || storedUser?.role === 'ADMIN_NON_HO_BRANCH_SWITCH' || isAreaManager || isHeadOffice);
    const [branches, setBranches] = useState<Branch[]>([]);
    const [branchFilter, setBranchFilter] = useState('ALL');
    const [centers, setCenters] = useState<CenterOption[]>([]);
    const [centerFilter, setCenterFilter] = useState('ALL');
    const filteredCenters = branchFilter === 'ALL' ? centers : centers.filter((c) => c.branchId === branchFilter);

    useEffect(() => {
        if (!canFilterByBranch) return;
        apiClient.get<Branch[]>('/branches').then((result) => {
            if (!result.success || !result.data) return;
            let list = result.data;
            if (isAreaManager) {
                const assignedBranchIds = (storedUser as any)?.assignedBranchIds ?? [];
                if (assignedBranchIds.length > 0) {
                    list = list.filter((b) => assignedBranchIds.includes(b.id));
                }
            }
            setBranches(list);
        });
        getCentersForDropdown().then(setCenters).catch(() => {});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [canFilterByBranch, isAreaManager]);

    // Filter data logic implicitly removed since API will do the date filtering
    const filteredData = data;

    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(filteredData);

    useEffect(() => {
        setCurrentPage(1);
    }, [tableSearchQuery]);

    const itemsPerPage = 10;
    const totalPages = Math.max(1, Math.ceil(searchedRows.length / itemsPerPage));
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const currentData = searchedRows.slice(startIndex, endIndex);

    const summary = calculateSummary(filteredData);

    const handleShowReport = async () => {
        if (!fromDate || !tillDate) {
            toast({
                title: 'Date range required',
                description: 'Please select both From Date and Till Date before generating the report.',
                variant: 'destructive',
            });
            return;
        }

        if (new Date(fromDate) > new Date(tillDate)) {
            toast({
                title: 'Invalid date range',
                description: 'From Date cannot be greater than Till Date.',
                variant: 'destructive',
            });
            return;
        }

        setIsLoading(true);
        try {
            const params = new URLSearchParams({
                fromDate,
                toDate: tillDate,
            });
            if (canFilterByBranch && branchFilter !== 'ALL') params.set('branchId', branchFilter);
            if (canFilterByBranch && centerFilter !== 'ALL') params.set('centerId', centerFilter);
            const response = await fetch(`/api/reports/preclosure?${params.toString()}`);
            if (!response.ok) {
                throw new Error('Failed to fetch preclosure report');
            }
            const result = await response.json();
            setData(result.data || []);
            setSubmittedFromDate(fromDate);
            setSubmittedTillDate(tillDate);
            setShowReport(true);
            setCurrentPage(1);
            toast({
                title: 'Report generated',
                description: 'Preclosure Report Consolidated loaded successfully.',
            });
        } catch (error) {
            console.error('Error fetching preclosure data:', error);
            toast({
                title: 'Error',
                description: 'Failed to fetch preclosure report. Please try again.',
                variant: 'destructive',
            });
            setData([]);
            setShowReport(false);
        } finally {
            setIsLoading(false);
        }
    };

    const handleReset = () => {
        const today = new Date().toISOString().split('T')[0];
        setFromDate(today);
        setTillDate(today);
        setBranchFilter('ALL');
        setCenterFilter('ALL');
        setSubmittedFromDate(today);
        setSubmittedTillDate(today);
        setShowReport(false);
        setCurrentPage(1);
        setData([]);
    };

    const handleExport = () => {
        if (!data || data.length === 0) {
            toast({
                title: "No Data",
                description: "There is no data to export.",
                variant: 'destructive',
            });
            return;
        }

        const formatExportDate = (dateStr: string) => {
            const d = new Date(dateStr);
            const day = d.getDate().toString().padStart(2, '0');
            const month = (d.getMonth() + 1).toString().padStart(2, '0');
            const year = d.getFullYear();
            return `${day}/${month}/${year}`;
        };

        const exportFileName = `PreclosureReportConsolidated ${formatExportDate(submittedFromDate)} Between ${formatExportDate(submittedTillDate)}.xlsx`;

        const { headers, rows } = buildPreclosureExportRows();
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet([...reportHeaderRows('PRECLOSURE REPORT CONSOLIDATED'), headers, ...rows]);
        autoSizeColumns(ws);
        applyExcelReportFont(ws);
        XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
        XLSX.writeFile(wb, exportFileName);

        toast({
            title: "Export Successful",
            description: "The preclosure report has been downloaded.",
        });
    };

    // Mirrors the same field mapping used by handleExport above (kept separate so
    // handleExport is left untouched).
    const buildPreclosureExportRows = (): { headers: string[]; rows: (string | number)[][] } => {
        const headers = ['Preclose Date', 'Branch Name', 'Center Name', 'Client Name', 'Loan A/c', 'Arrear Pri', 'Arrear Int', 'Curr Dmd Pri', 'Curr Dmd Int', 'Preclosure Pri', 'Preclosure Int', 'Total Amount', ...MEMBER_CONTACT_HEADERS];
        const rows: (string | number)[][] = searchedRows.map((item) => [
            item.precloseDate, item.branchName, item.centerName, item.clientName, item.loanAccount,
            formatReportAmount(item.arrearPri), formatReportAmount(item.arrearInt), formatReportAmount(item.currDmdPri), formatReportAmount(item.currDmdInt), formatReportAmount(item.preclosurePri), formatReportAmount(item.preclosureInt), formatReportAmount(item.totalAmount),
            ...memberContactValues(item),
        ]);
        if (searchedRows.length > 0) {
            const totals = calculateSummary(searchedRows);
            rows.push([
                'Grand Total:', '', '', '', '',
                formatReportAmount(totals.totalArrearPri), formatReportAmount(totals.totalArrearInt), formatReportAmount(totals.totalCurrDmdPri), formatReportAmount(totals.totalCurrDmdInt),
                formatReportAmount(totals.totalPreclosurePri), formatReportAmount(totals.totalPreclosureInt), formatReportAmount(totals.totalAmount),
            ]);
        }
        return { headers, rows };
    };

    const handleExportPDF = async () => {
        if (!data || data.length === 0) {
            toast({ title: "No Data", description: "There is no data to export.", variant: 'destructive' });
            return;
        }
        const doc = new jsPDF({ orientation: 'landscape' });
        const reportFont = await ensureReportFont(doc);
        await drawPreclosureReport(doc, searchedRows, {
            subtitle: `Period: ${formatDateForDisplay(submittedFromDate)} to ${formatDateForDisplay(submittedTillDate)}`,
        }, reportFont);
        doc.save(`PreclosureReportConsolidated_${submittedFromDate}_to_${submittedTillDate}.pdf`);
        toast({ title: "Export Successful", description: "The preclosure report has been downloaded." });
    };

    const handleExportCSV = () => {
        if (!data || data.length === 0) {
            toast({ title: "No Data", description: "There is no data to export.", variant: 'destructive' });
            return;
        }
        const { headers, rows } = buildPreclosureExportRows();
        exportToCSV(`PreclosureReportConsolidated_${submittedFromDate}_to_${submittedTillDate}`, 'PRECLOSURE REPORT CONSOLIDATED', headers, rows);
    };

    // Word-only presentation: same rows as PDF/CSV above, but the trailing "Grand
    // Total:" row is split off for distinct styling, and Arrear/Current Demand/
    // Preclosure Principal-Interest pairs each get a light 2-row grouped header.
    const buildPreclosureWordOptions = (
        rows: (string | number)[][]
    ): { bodyRows: (string | number)[][]; options: WordExportOptions } => ({
        bodyRows: rows.slice(0, -1),
        options: {
            groupHeaders: [
                { label: 'Preclose Date', span: 1 }, { label: 'Branch Name', span: 1 }, { label: 'Center Name', span: 1 },
                { label: 'Client Name', span: 1 }, { label: 'Loan A/c', span: 1 }, { label: 'ARREAR', span: 2 },
                { label: 'CURRENT DEMAND', span: 2 }, { label: 'PRECLOSURE', span: 2 }, { label: 'Total Amount', span: 1 },
            ],
            subHeaders: ['Principal', 'Interest', 'Principal', 'Interest', 'Principal', 'Interest'],
            columnAlignments: ['center', 'left', 'left', 'left', 'center', 'right', 'right', 'right', 'right', 'right', 'right', 'right'],
            columnWidthWeights: [8, 12, 12, 12, 8, 7, 7, 7, 7, 7, 7, 9],
            totalsRow: rows[rows.length - 1],
        },
    });

    const handleExportWord = async () => {
        if (!data || data.length === 0) {
            toast({ title: "No Data", description: "There is no data to export.", variant: 'destructive' });
            return;
        }
        const { headers, rows } = buildPreclosureExportRows();
        const { bodyRows, options } = buildPreclosureWordOptions(rows);
        await exportToWord(`PreclosureReportConsolidated_${submittedFromDate}_to_${submittedTillDate}`, 'PRECLOSURE REPORT CONSOLIDATED', headers, bodyRows, options);
    };

    const handlePrint = () => {
        window.print();
    };

    return (
        <div className="relative w-full">
            {/* Header Section */}
            <div className="mb-8">
                <div className="flex items-center gap-4 mb-4">
                    <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary shadow-lg shadow-primary/30">
                        <XCircle className="h-7 w-7 text-white" />
                        <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/20 to-transparent" />
                    </div>
                    <div className="flex-1">
                        <h1 className="text-3xl font-bold tracking-tight text-foreground dark:text-white">
                            Preclosure Report Consolidated
                        </h1>
                        <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                            Comprehensive preclosure report with arrear, current demand, and preclosure details
                        </p>
                    </div>
                </div>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <Card className="border-2 border-primary/30/50 dark:border-sidebar-accent/50 bg-gradient-to-br from-green-50 to-green-50/50 dark:from-brand-green-darker/20 dark:to-brand-green-darker/20">
                    <CardContent className="pt-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm font-medium text-sidebar-accent dark:text-green-300">
                                    Total Preclosures
                                </p>
                                <p className="text-3xl font-bold text-foreground dark:text-green-100 mt-2">
                                    {summary.totalPreclosures}
                                </p>
                                <p className="text-xs text-primary dark:text-primary mt-1">
                                    Loan accounts
                                </p>
                            </div>
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-green-tint dark:bg-brand-green-darker/50">
                                <CreditCard className="h-6 w-6 text-primary dark:text-primary" />
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-2 border-primary/50 dark:border-primary/50 bg-gradient-to-br from-green-50 to-purple-50/50 dark:from-brand-green-darker/20 dark:to-purple-950/20">
                    <CardContent className="pt-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm font-medium text-primary dark:text-primary">
                                    Total Amount
                                </p>
                                <p className="text-2xl font-bold text-foreground dark:text-primary mt-2">
                                    ₹ {formatCurrency(summary.totalAmount)}
                                </p>
                                <p className="text-xs text-primary dark:text-primary mt-1">
                                    All preclosures
                                </p>
                            </div>
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 dark:bg-brand-green-darker/50">
                                <IndianRupee className="h-6 w-6 text-primary dark:text-primary" />
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-2 border-purple-200/50 dark:border-purple-800/50 bg-gradient-to-br from-purple-50 to-pink-50/50 dark:from-purple-950/20 dark:to-pink-950/20">
                    <CardContent className="pt-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm font-medium text-purple-700 dark:text-purple-300">
                                    Preclosure Amount
                                </p>
                                <p className="text-2xl font-bold text-purple-900 dark:text-purple-100 mt-2">
                                    ₹ {formatCurrency(summary.totalPreclosurePri + summary.totalPreclosureInt)}
                                </p>
                                <p className="text-xs text-purple-600 dark:text-purple-400 mt-1">
                                    Principal + Interest
                                </p>
                            </div>
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-100 dark:bg-purple-900/50">
                                <TrendingUp className="h-6 w-6 text-purple-600 dark:text-purple-400" />
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-2 border-teal-200/50 dark:border-teal-800/50 bg-gradient-to-br from-teal-50 to-cyan-50/50 dark:from-teal-950/20 dark:to-cyan-950/20">
                    <CardContent className="pt-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm font-medium text-teal-700 dark:text-teal-300">
                                    Avg Preclosure
                                </p>
                                <p className="text-2xl font-bold text-teal-900 dark:text-teal-100 mt-2">
                                    ₹ {formatCurrency(summary.avgPreclosureAmount)}
                                </p>
                                <p className="text-xs text-teal-600 dark:text-teal-400 mt-1">
                                    Per preclosure
                                </p>
                            </div>
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-teal-100 dark:bg-teal-900/50">
                                <AlertCircle className="h-6 w-6 text-teal-600 dark:text-teal-400" />
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Filters Card */}
            <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden mb-6">
                <div className="h-1.5 bg-gradient-to-r from-primary via-primary to-purple-600" />
                <CardHeader className="bg-gradient-to-r from-slate-50 via-green-50/60 to-green-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                    <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-green-tint dark:bg-brand-green-darker/30">
                                <Filter className="h-5 w-5 text-primary dark:text-primary" />
                            </div>
                            <div>
                                <CardTitle className="text-xl">Report Parameters</CardTitle>
                                <CardDescription>
                                    Select date range for Preclosure Report Consolidated
                                </CardDescription>
                            </div>
                        </div>

                    </div>
                </CardHeader>
                <CardContent className="pt-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                        {/* Branch Filter (ADMIN / SUBADMIN / AREA_MANAGER only) */}
                        {canFilterByBranch && (
                            <div className="space-y-2">
                                <Label htmlFor="branchFilter" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                    Branch
                                </Label>
                                <Select
                                    value={branchFilter}
                                    onValueChange={(v) => { setBranchFilter(v); setCenterFilter('ALL'); }}
                                    disabled={isLoading}
                                >
                                    <SelectTrigger id="branchFilter" className="h-11 border-primary/30 dark:border-sidebar-accent">
                                        <SelectValue placeholder="All Branches" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="ALL">All Branches</SelectItem>
                                        {branches.map((b) => (
                                            <SelectItem key={b.id} value={b.id}>{b.code} - {b.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}

                        {/* Center Filter (ADMIN / SUBADMIN / AREA_MANAGER only) */}
                        {canFilterByBranch && (
                            <div className="space-y-2">
                                <Label htmlFor="centerFilter" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                    Center
                                </Label>
                                <Select value={centerFilter} onValueChange={setCenterFilter} disabled={isLoading}>
                                    <SelectTrigger id="centerFilter" className="h-11 border-primary/30 dark:border-sidebar-accent">
                                        <SelectValue placeholder="All Centers" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="ALL">All Centers</SelectItem>
                                        {filteredCenters.map((c) => (
                                            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}

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
                                <Calendar className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
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
                                <Calendar className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            </div>
                        </div>

                        {/* Show Button */}
                        <div className="space-y-2">
                            <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-200 opacity-0">
                                Action
                            </Label>
                            <Button
                                onClick={handleShowReport}
                                disabled={isLoading}
                                className="h-11 w-full bg-gradient-to-r from-primary to-primary hover:from-sidebar-accent hover:to-primary text-white shadow-lg shadow-primary/30"
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

                        {/* Reset and Export Button */}
                        <div className="space-y-2">
                            <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-200 opacity-0">
                                Action
                            </Label>
                            <div className="flex gap-2">
                                <Button
                                    onClick={handleReset}
                                    variant="outline"
                                    className="h-11 flex-1 border-red-300 text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-300"
                                >
                                    Reset
                                </Button>
                                {showReport && (
                                    <>
                                        <ExportDropdown
                                            onExportPDF={handleExportPDF}
                                            onExportExcel={handleExport}
                                            onExportCSV={handleExportCSV}
                                            onExportWord={handleExportWord}
                                            reportSlug={getReportExportMode('preclosure') === 'REQUEST_QUEUE' ? 'preclosure' : undefined}
                                            canExport={canExportReport('preclosure')}
                                            exportParams={{
                                                fromDate: submittedFromDate,
                                                toDate: submittedTillDate,
                                                branchIds: canFilterByBranch && branchFilter !== 'ALL' ? [branchFilter] : 'ALL',
                                                filters: canFilterByBranch && centerFilter !== 'ALL' ? { centerId: centerFilter } : null,
                                            }}
                                            className="h-11 flex-1 bg-primary hover:bg-sidebar-accent text-white"
                                        />
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Preclosure Report Table */}
            {showReport && (
                <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
                    <div className="h-1.5 bg-gradient-to-r from-primary via-primary to-purple-600" />

                    {/* Print-friendly content */}
                    <div ref={printRef} className="print:p-8">
                        {/* Report Header */}
                        <CardHeader className="bg-gradient-to-r from-slate-50 via-green-50/60 to-green-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker print:bg-white">
                            <ReportHeader
                                title="Preclosure Report Consolidated"
                                subtitle={`Period: ${formatDateForDisplay(submittedFromDate)} to ${formatDateForDisplay(submittedTillDate)}`}
                            />
                            <div className="flex flex-wrap items-center justify-end gap-4 print:hidden">
                                <TableSearchInput
                                    value={tableSearchQuery}
                                    onChange={setTableSearchQuery}
                                    placeholder="Search name, ID, Aadhaar, mobile..."
                                />
                            </div>
                        </CardHeader>

                        <CardContent className="p-0">
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow className="bg-gradient-to-r from-sidebar-accent to-primary dark:from-sidebar-accent dark:to-primary hover:from-sidebar-accent hover:to-primary">
                                            <TableHead className="font-bold text-white text-xs">Preclose Date</TableHead>
                                            <TableHead className="font-bold text-white text-xs">Branch Name</TableHead>
                                            <TableHead className="font-bold text-white text-xs">Center Name</TableHead>
                                            <TableHead className="font-bold text-white text-xs">Client Name</TableHead>
                                            <TableHead className="font-bold text-white text-xs">{MEMBER_CONTACT_COLUMN_LABEL}</TableHead>
                                            <TableHead className="font-bold text-white text-xs">Loan A/c</TableHead>
                                            <TableHead className="font-bold text-white text-xs text-right">Arrear Pri</TableHead>
                                            <TableHead className="font-bold text-white text-xs text-right">Arrear Int</TableHead>
                                            <TableHead className="font-bold text-white text-xs text-right">Curr Dmd Pri</TableHead>
                                            <TableHead className="font-bold text-white text-xs text-right">Curr Dmd Int</TableHead>
                                            <TableHead className="font-bold text-white text-xs text-right">Preclosure Pri</TableHead>
                                            <TableHead className="font-bold text-white text-xs text-right">Preclosure Int</TableHead>
                                            <TableHead className="font-bold text-white text-xs text-right">Total Amount</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {currentData.length > 0 ? (
                                            <>
                                                {currentData.map((item, index) => {
                                                    const rowIndex = startIndex + index;
                                                    return (
                                                        <TableRow
                                                            key={rowIndex}
                                                            className={cn(
                                                                'transition-colors',
                                                                rowIndex % 2 === 0
                                                                    ? 'bg-white dark:bg-brand-green-darker hover:bg-green-50 dark:hover:bg-green-950/20'
                                                                    : 'bg-green-50/50 dark:bg-brand-green-darker/50 hover:bg-green-50 dark:hover:bg-green-950/20'
                                                            )}
                                                        >
                                                            <TableCell className="text-sm">{item.precloseDate}</TableCell>
                                                            <TableCell className="font-semibold text-sidebar-accent dark:text-primary">{item.branchName}</TableCell>
                                                            <TableCell className="font-medium text-sidebar-accent dark:text-slate-300">{item.centerName}</TableCell>
                                                            <TableCell className="font-semibold text-foreground dark:text-slate-100">{item.clientName}</TableCell>
                                                            <TableCell><MemberContactCell row={item} /></TableCell>
                                                            <TableCell className="font-mono text-xs text-cyan-700 dark:text-cyan-400">{item.loanAccount}</TableCell>
                                                            <TableCell className="text-right font-semibold text-orange-700 dark:text-orange-400">{formatCurrency(item.arrearPri)}</TableCell>
                                                            <TableCell className="text-right font-semibold text-amber-700 dark:text-amber-400">{formatCurrency(item.arrearInt)}</TableCell>
                                                            <TableCell className="text-right font-semibold text-sidebar-accent dark:text-primary">{formatCurrency(item.currDmdPri)}</TableCell>
                                                            <TableCell className="text-right font-semibold text-primary dark:text-primary">{formatCurrency(item.currDmdInt)}</TableCell>
                                                            <TableCell className="text-right font-semibold text-purple-700 dark:text-purple-400">{formatCurrency(item.preclosurePri)}</TableCell>
                                                            <TableCell className="text-right font-semibold text-pink-700 dark:text-pink-400">{formatCurrency(item.preclosureInt)}</TableCell>
                                                            <TableCell className="text-right font-bold text-primary dark:text-primary">{formatCurrency(item.totalAmount)}</TableCell>
                                                        </TableRow>
                                                    );
                                                })}
                                            </>
                                        ) : (
                                            <TableRow>
                                                <TableCell colSpan={13} className="text-center py-8 text-slate-500 dark:text-slate-400">
                                                    No preclosure records found for the selected date range.
                                                </TableCell>
                                            </TableRow>
                                        )}
                                        {/* Grand Total Row */}
                                        <TableRow className="bg-gradient-to-r from-brand-green-tint to-primary dark:from-brand-green-darker/30 dark:to-brand-green-darker/30 font-bold border-t-2 border-primary/50 dark:border-sidebar-accent">
                                            <TableCell colSpan={6} className="font-bold text-foreground dark:text-white">
                                                Grand Total:
                                            </TableCell>
                                            <TableCell className="text-right font-bold text-foreground dark:text-white">{formatCurrency(summary.totalArrearPri)}</TableCell>
                                            <TableCell className="text-right font-bold text-foreground dark:text-white">{formatCurrency(summary.totalArrearInt)}</TableCell>
                                            <TableCell className="text-right font-bold text-foreground dark:text-white">{formatCurrency(summary.totalCurrDmdPri)}</TableCell>
                                            <TableCell className="text-right font-bold text-foreground dark:text-white">{formatCurrency(summary.totalCurrDmdInt)}</TableCell>
                                            <TableCell className="text-right font-bold text-foreground dark:text-white">{formatCurrency(summary.totalPreclosurePri)}</TableCell>
                                            <TableCell className="text-right font-bold text-foreground dark:text-white">{formatCurrency(summary.totalPreclosureInt)}</TableCell>
                                            <TableCell className="text-right font-bold text-foreground dark:text-white">{formatCurrency(summary.totalAmount)}</TableCell>
                                        </TableRow>
                                    </TableBody>
                                </Table>
                            </div>
                        </CardContent>
                    </div>
                </Card>
            )}

            {/* Pagination Controls */}
            {showReport && totalPages > 1 && (
                <div className="mt-6 flex items-center justify-center gap-2 print:hidden">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                        disabled={currentPage === 1}
                        className="border-primary/50 text-sidebar-accent hover:bg-green-50 dark:border-sidebar-accent dark:text-green-300"
                    >
                        Previous
                    </Button>
                    <div className="flex items-center gap-1 overflow-x-auto max-w-[60vw]">
                        {Array.from({ length: totalPages }, (_, i) => {
                            const pageNum = i + 1;
                            // Show first, last, current, and +/- 2 pages around current
                            if (
                                pageNum === 1 ||
                                pageNum === totalPages ||
                                (pageNum >= currentPage - 2 && pageNum <= currentPage + 2)
                            ) {
                                return (
                                    <Button
                                        key={pageNum}
                                        variant={currentPage === pageNum ? 'default' : 'outline'}
                                        size="sm"
                                        onClick={() => setCurrentPage(pageNum)}
                                        className={cn(
                                            'min-w-[40px]',
                                            currentPage === pageNum
                                                ? 'bg-primary text-white hover:bg-primary'
                                                : 'border-primary/50 text-sidebar-accent hover:bg-green-50 dark:border-sidebar-accent dark:text-green-300'
                                        )}
                                    >
                                        {pageNum}
                                    </Button>
                                );
                            } else if (
                                pageNum === currentPage - 3 ||
                                pageNum === currentPage + 3
                            ) {
                                return <span key={pageNum} className="px-1 text-sidebar-accent dark:text-slate-400">...</span>;
                            }
                            return null;
                        })}
                    </div>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                        disabled={currentPage === totalPages}
                        className="border-primary/50 text-sidebar-accent hover:bg-green-50 dark:border-sidebar-accent dark:text-green-300"
                    >
                        Next
                    </Button>
                </div>
            )}

            {/* Footer Info */}
            {showReport && (
                <div className="mt-6 flex items-center justify-between text-sm text-sidebar-accent dark:text-slate-400 print:hidden">
                    <p>
                        Report generated on {toDisplayDateTime(new Date())}
                    </p>
                    <p>
                        Total Records: <span className="font-semibold text-sidebar-accent dark:text-primary">
                            {searchedRows.length}
                        </span>
                        {' | '}
                        Page <span className="font-semibold text-sidebar-accent dark:text-primary">
                            {currentPage}
                        </span> of <span className="font-semibold text-sidebar-accent dark:text-primary">
                            {totalPages}
                        </span>
                    </p>
                </div>
            )}

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
        </div>
    );
}
