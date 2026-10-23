'use client';

import { useState, useRef, useEffect } from 'react';
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
    Loader2,
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
import { drawLoanOsDetailsReport } from '@/app/lib/reports/loan-os-details-pdf';
import { reportHeaderRows, autoSizeColumns, applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { formatReportAmount } from '@/app/lib/utils/format-amount';
import { exportToCSV, exportToWord, type WordExportOptions } from '@/app/lib/report-export-utils';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';
import { usePermission } from '@/app/hooks/usePermission';
import { PageLoader } from '@/components/ui/page-loader';
import { DateInput } from '@/components/ui/date-input';
import { MEMBER_CONTACT_HEADERS, memberContactValues, type MemberContactFields } from '@/app/lib/reports/member-contact-columns';
import { MemberContactCell, MEMBER_CONTACT_COLUMN_LABEL } from '@/components/reports/MemberContactCell';
import { toDisplayDateTime } from '@/app/lib/date-format';

type Branch = { id: string; name: string; code: string };

type LoanOSDetailsData = MemberContactFields & {
    branchName: string;
    centerName: string;
    accountId: string;
    clientName: string;
    loanAccount: string;
    disbursalDate: string;
    dueStartDate: string;
    maturityDate: string;
    status: string;
    loanAmount: number;
    interestAmount: number;
    osPrinciple: number;
    osInterest: number;
    arrearPri: number;
    arrearInt: number;
    totalDues: number;
    completedDues: number;
    collectedDues: number;
    duePri: number;
    dueInt: number;
    dpd: number;
    ageing: string;
    mobile: string;
    fdoName: string;
    meetingDay: string;
    disbursalType: string;
};

const calculateSummary = (data: LoanOSDetailsData[]) => {
    return {
        totalLoanAccounts: data.length,
        totalOutstanding: data.reduce((sum, item) => sum + item.osPrinciple + item.osInterest, 0),
        totalArrears: data.reduce((sum, item) => sum + item.arrearPri + item.arrearInt, 0),
        avgLoanAmount: data.length > 0 ? data.reduce((sum, item) => sum + item.loanAmount, 0) / data.length : 0,
    };
};

const formatCurrency = (amount: number) => formatReportAmount(amount);

const formatDateForDisplay = (dateString: string) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
};

export function LoanOSDetailsClient() {
    const { canExportReport, getReportExportMode, isHeadOffice } = usePermission();
    const [reportDate, setReportDate] = useState<string>(
        new Date().toISOString().split('T')[0]
    );
    // Snapshot of reportDate as of the last "Show" click — used for export filenames,
    // PDF/Word subtitles, on-screen labels, and exportParams so a draft date edit
    // (without clicking Show) never changes what's displayed/exported.
    const [submittedReportDate, setSubmittedReportDate] = useState<string>(reportDate);
    const [isLoading, setIsLoading] = useState(false);
    const [showReport, setShowReport] = useState(false);
    const [currentPage, setCurrentPage] = useState(1);
    const [data, setData] = useState<LoanOSDetailsData[]>([]);
    const printRef = useRef<HTMLDivElement>(null);
    const { toast } = useToast();

    // Branch/Center filter — ADMIN, SUBADMIN (ADMIN_NON_HO_BRANCH_SWITCH), AREA_MANAGER,
    // any Head-Office-based user (incl. custom RBAC roles like "Zonal Head"), and any
    // other role explicitly assigned more than one branch (UserBranchAssignment) get a
    // picker; AREA_MANAGER/other-role branch lists are scoped to their assigned branches.
    const storedUser = tokenStorage.getUser();
    const isAreaManager = storedUser?.role === 'AREA_MANAGER';
    const isMultiBranchOtherRole =
        storedUser?.role !== 'ADMIN' &&
        storedUser?.role !== 'ADMIN_NON_HO_BRANCH_SWITCH' &&
        !isAreaManager &&
        (storedUser?.assignedBranchIds?.length ?? 0) > 1;
    const canFilterByBranch =
        storedUser?.role === 'ADMIN' ||
        storedUser?.role === 'ADMIN_NON_HO_BRANCH_SWITCH' ||
        isAreaManager ||
        isHeadOffice ||
        isMultiBranchOtherRole;
    const [branches, setBranches] = useState<Branch[]>([]);
    const [branchFilter, setBranchFilter] = useState('ALL');
    const [centers, setCenters] = useState<CenterOption[]>([]);
    const [centerFilter, setCenterFilter] = useState('ALL');
    // Snapshotted alongside submittedReportDate — handleShowReport's own fetch reads
    // branchFilter/centerFilter together with reportDate as one atomic query, so exportParams
    // must use the same submitted trio, not mix a submitted date with a live branch/center.
    const [submittedBranchFilter, setSubmittedBranchFilter] = useState('ALL');
    const [submittedCenterFilter, setSubmittedCenterFilter] = useState('ALL');
    const filteredCenters = branchFilter === 'ALL' ? centers : centers.filter((c) => c.branchId === branchFilter);

    useEffect(() => {
        if (!canFilterByBranch) return;
        apiClient.get<Branch[]>('/branches').then((result) => {
            if (!result.success || !result.data) return;
            let list = result.data;
            if (isAreaManager || isMultiBranchOtherRole) {
                const assignedBranchIds = storedUser?.assignedBranchIds ?? [];
                if (assignedBranchIds.length > 0) {
                    list = list.filter((b) => assignedBranchIds.includes(b.id));
                }
            }
            setBranches(list);
        });
        getCentersForDropdown().then(setCenters).catch(() => {});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [canFilterByBranch, isAreaManager, isMultiBranchOtherRole]);

    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(data);

    useEffect(() => {
        setCurrentPage(1);
    }, [tableSearchQuery]);

    const itemsPerPage = 10;
    const totalPages = Math.ceil(searchedRows.length / itemsPerPage);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const currentData = searchedRows.slice(startIndex, endIndex);

    const summary = calculateSummary(data);

    const handleShowReport = async () => {
        if (!reportDate) {
            toast({
                title: 'Report date required',
                description: 'Please select a report date before generating the report.',
                variant: 'destructive',
            });
            return;
        }

        setIsLoading(true);
        try {
            const params = new URLSearchParams({ reportDate });
            if (canFilterByBranch && branchFilter !== 'ALL') params.set('branchId', branchFilter);
            if (canFilterByBranch && centerFilter !== 'ALL') params.set('centerId', centerFilter);
            const response = await fetch(`/api/reports/loan-os-details?${params}`);
            if (!response.ok) {
                throw new Error('Failed to fetch report data');
            }
            const result = await response.json();
            setData(result.data || []);
            setSubmittedReportDate(reportDate);
            setSubmittedBranchFilter(branchFilter);
            setSubmittedCenterFilter(centerFilter);
            setShowReport(true);
            setCurrentPage(1);
            toast({
                title: 'Report generated',
                description: `Loaded ${result.count || 0} loan records successfully.`,
            });
        } catch (error) {
            console.error('Error fetching Loan OS details:', error);
            toast({
                title: 'Error',
                description: 'Failed to fetch Loan OS details. Please try again.',
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
        setReportDate(today);
        setBranchFilter('ALL');
        setCenterFilter('ALL');
        setSubmittedReportDate(today);
        setSubmittedBranchFilter('ALL');
        setSubmittedCenterFilter('ALL');
        setShowReport(false);
        setCurrentPage(1);
        setData([]);
    };

    const handleExport = () => {
        if (!data || data.length === 0) {
            toast({
                title: 'No Data',
                description: 'There is no data to export.',
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

        const exportFileName = `LoanOSDetails_${formatExportDate(submittedReportDate)}.xlsx`;

        const { headers, rows } = buildLoanOSExportRows();
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet([...reportHeaderRows('LOAN OS DETAILS'), headers, ...rows]);
        autoSizeColumns(ws);
        applyExcelReportFont(ws);
        XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
        XLSX.writeFile(wb, exportFileName);

        toast({
            title: 'Export Successful',
            description: 'The Loan OS Details report has been downloaded.',
        });
    };

    // Mirrors the same field mapping used by handleExport above (kept separate so
    // handleExport is left untouched).
    const buildLoanOSExportRows = (): { headers: string[]; rows: (string | number)[][] } => {
        const headers = [
            'Branch Name', 'Center Name', 'Account ID', 'Client Name', 'Loan A/c', 'Disbursal Date',
            'Due Start Date', 'Maturity Date', 'Status', 'Loan Amount', 'Interest Amount', 'OS Principle',
            'OS Interest', 'Arrear Pri', 'Arrear Int', 'Total Dues', 'Completed Dues', 'Collected Dues',
            'Due Pri', 'Due Int', 'DPD', 'Ageing', 'Mobile', 'FDO Name', 'Meeting Day', 'Disbural Type',
            ...MEMBER_CONTACT_HEADERS,
        ];
        const rows: (string | number)[][] = searchedRows.map((item) => [
            item.branchName, item.centerName, item.accountId, item.clientName, item.loanAccount, item.disbursalDate,
            item.dueStartDate, item.maturityDate, item.status, formatReportAmount(item.loanAmount), formatReportAmount(item.interestAmount), formatReportAmount(item.osPrinciple),
            formatReportAmount(item.osInterest), formatReportAmount(item.arrearPri), formatReportAmount(item.arrearInt), item.totalDues, item.completedDues, item.collectedDues,
            formatReportAmount(item.duePri), formatReportAmount(item.dueInt), item.dpd, item.ageing, item.mobile, item.fdoName, item.meetingDay, item.disbursalType,
            ...memberContactValues(item),
        ]);
        if (searchedRows.length > 0) {
            const totLoanAmt = searchedRows.reduce((s, i) => s + (i.loanAmount || 0), 0);
            const totIntAmt = searchedRows.reduce((s, i) => s + (i.interestAmount || 0), 0);
            const totOsPri = searchedRows.reduce((s, i) => s + (i.osPrinciple || 0), 0);
            const totOsInt = searchedRows.reduce((s, i) => s + (i.osInterest || 0), 0);
            const totArrPri = searchedRows.reduce((s, i) => s + (i.arrearPri || 0), 0);
            const totArrInt = searchedRows.reduce((s, i) => s + (i.arrearInt || 0), 0);
            const totDuePri = searchedRows.reduce((s, i) => s + (i.duePri || 0), 0);
            const totDueInt = searchedRows.reduce((s, i) => s + (i.dueInt || 0), 0);
            rows.push([
                'Grand Total:', '', '', '', '', '', '', '', '',
                formatReportAmount(totLoanAmt), formatReportAmount(totIntAmt), formatReportAmount(totOsPri), formatReportAmount(totOsInt), formatReportAmount(totArrPri), formatReportAmount(totArrInt),
                '', '', '', formatReportAmount(totDuePri), formatReportAmount(totDueInt), '', '', '', '', '', '',
            ]);
        }
        return { headers, rows };
    };

    const handleExportPDF = async () => {
        if (!data || data.length === 0) {
            toast({ title: 'No Data', description: 'There is no data to export.', variant: 'destructive' });
            return;
        }
        const doc = new jsPDF({ orientation: 'landscape' });
        const reportFont = await ensureReportFont(doc);
        const { headers, rows } = buildLoanOSExportRows();
        await drawLoanOsDetailsReport(doc, headers, rows, { subtitle: `Report Date: ${formatDateForDisplay(submittedReportDate)}` }, reportFont);
        doc.save(`LoanOSDetails_${submittedReportDate}.pdf`);
        toast({ title: 'Export Successful', description: 'The Loan OS Details report has been downloaded.' });
    };

    const handleExportCSV = () => {
        if (!data || data.length === 0) {
            toast({ title: 'No Data', description: 'There is no data to export.', variant: 'destructive' });
            return;
        }
        const { headers, rows } = buildLoanOSExportRows();
        exportToCSV(`LoanOSDetails_${submittedReportDate}`, 'LOAN OS DETAILS', headers, rows);
    };

    // Word-only presentation: same rows as PDF/CSV above, but the trailing "Grand Total:"
    // row is split off for distinct styling, and genuinely related Loan/OS/Arrear/Due
    // Principal-Interest pairs (plus the Total/Completed/Collected Dues cluster) get a
    // 2-row grouped header.
    const buildLoanOSWordOptions = (
        rows: (string | number)[][]
    ): { bodyRows: (string | number)[][]; options: WordExportOptions } => ({
        bodyRows: rows.slice(0, -1),
        options: {
            groupHeaders: [
                { label: 'Branch Name', span: 1 }, { label: 'Center Name', span: 1 }, { label: 'Account ID', span: 1 },
                { label: 'Client Name', span: 1 }, { label: 'Loan A/c', span: 1 }, { label: 'Disbursal Date', span: 1 },
                { label: 'Due Start Date', span: 1 }, { label: 'Maturity Date', span: 1 }, { label: 'Status', span: 1 },
                { label: 'LOAN', span: 2 }, { label: 'OS', span: 2 }, { label: 'ARREAR', span: 2 },
                { label: 'DUES', span: 3 }, { label: 'DUE', span: 2 }, { label: 'DPD', span: 1 }, { label: 'Ageing', span: 1 },
                { label: 'Mobile', span: 1 }, { label: 'FDO Name', span: 1 }, { label: 'Meeting Day', span: 1 },
                { label: 'Disbural Type', span: 1 },
            ],
            subHeaders: ['Amount', 'Interest', 'Principal', 'Interest', 'Principal', 'Interest', 'Total', 'Completed', 'Collected', 'Principal', 'Interest'],
            columnAlignments: ['left', 'left', 'center', 'left', 'center', 'center', 'center', 'center', 'center', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'center', 'left', 'center', 'center'],
            columnWidthWeights: [10, 10, 8, 12, 8, 8, 8, 8, 8, 7, 7, 7, 7, 7, 7, 7, 7, 7, 6, 6, 6, 6, 8, 9, 8, 8],
            totalsRow: rows[rows.length - 1],
        },
    });

    const handleExportWord = async () => {
        if (!data || data.length === 0) {
            toast({ title: 'No Data', description: 'There is no data to export.', variant: 'destructive' });
            return;
        }
        const { headers, rows } = buildLoanOSExportRows();
        const { bodyRows, options } = buildLoanOSWordOptions(rows);
        await exportToWord(`LoanOSDetails_${submittedReportDate}`, 'LOAN OS DETAILS', headers, bodyRows, options);
    };

    return (
        <div className="relative w-full">
            {/* Header Section */}
            <div className="mb-8">
                <div className="flex items-center gap-4 mb-4">
                    <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary shadow-lg shadow-primary/30">
                        <FileText className="h-7 w-7 text-white" />
                        <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/20 to-transparent" />
                    </div>
                    <div className="flex-1">
                        <h1 className="text-3xl font-bold tracking-tight text-foreground dark:text-white">
                            Loan OS Details
                        </h1>
                        <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                            Comprehensive loan outstanding details report with all loan information
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
                                    Total Loan Accounts
                                </p>
                                <p className="text-3xl font-bold text-foreground dark:text-green-100 mt-2">
                                    {summary.totalLoanAccounts}
                                </p>
                                <p className="text-xs text-primary dark:text-primary mt-1">
                                    Active accounts
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
                                    Total Outstanding
                                </p>
                                <p className="text-2xl font-bold text-foreground dark:text-primary mt-2">
                                    ₹ {formatCurrency(summary.totalOutstanding)}
                                </p>
                                <p className="text-xs text-primary dark:text-primary mt-1">
                                    Principle + Interest
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
                                    Total Arrears
                                </p>
                                <p className="text-2xl font-bold text-purple-900 dark:text-purple-100 mt-2">
                                    ₹ {formatCurrency(summary.totalArrears)}
                                </p>
                                <p className="text-xs text-purple-600 dark:text-purple-400 mt-1">
                                    Arrear Principle + Interest
                                </p>
                            </div>
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-100 dark:bg-purple-900/50">
                                <AlertCircle className="h-6 w-6 text-purple-600 dark:text-purple-400" />
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-2 border-teal-200/50 dark:border-teal-800/50 bg-gradient-to-br from-teal-50 to-cyan-50/50 dark:from-teal-950/20 dark:to-cyan-950/20">
                    <CardContent className="pt-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm font-medium text-teal-700 dark:text-teal-300">
                                    Avg Loan Amount
                                </p>
                                <p className="text-2xl font-bold text-teal-900 dark:text-teal-100 mt-2">
                                    ₹ {formatCurrency(summary.avgLoanAmount)}
                                </p>
                                <p className="text-xs text-teal-600 dark:text-teal-400 mt-1">
                                    Per loan account
                                </p>
                            </div>
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-teal-100 dark:bg-teal-900/50">
                                <TrendingUp className="h-6 w-6 text-teal-600 dark:text-teal-400" />
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
                                    Select report date for Loan OS Details
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
                                    reportSlug={getReportExportMode('loan-os-details') === 'REQUEST_QUEUE' ? 'loan-os-details' : undefined}
                                    canExport={canExportReport('loan-os-details')}
                                    exportParams={{
                                        fromDate: submittedReportDate,
                                        branchIds: canFilterByBranch && submittedBranchFilter !== 'ALL' ? [submittedBranchFilter] : 'ALL',
                                        filters: canFilterByBranch && submittedCenterFilter !== 'ALL' ? { centerId: submittedCenterFilter } : null,
                                    }}
                                    className="border-green-400/50 text-sidebar-accent hover:bg-green-50 dark:border-sidebar-accent dark:text-green-300"
                                />
                            </div>
                        )}
                    </div>
                </CardHeader>
                <CardContent className="pt-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                        {/* Report Date */}
                        <div className="space-y-2">
                            <Label htmlFor="reportDate" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                Report Date <span className="text-red-500">*</span>
                            </Label>
                            <div className="relative">
                                <DateInput
                                    id="reportDate"
                                    value={reportDate}
                                    onChange={(e) => setReportDate(e.target.value)}
                                    className="h-11 border-primary/30 dark:border-sidebar-accent pl-10"
                                />
                                <Calendar className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            </div>
                        </div>

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
                            >
                                Reset
                            </Button>
                        </div>

                    </div>
                </CardContent>
            </Card>

            {/* Loan OS Details Report Table */}
            {showReport && (
                <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
                    <div className="h-1.5 bg-gradient-to-r from-primary via-primary to-purple-600" />

                    <div ref={printRef} className="print:p-8">
                        <CardHeader className="bg-gradient-to-r from-slate-50 via-green-50/60 to-green-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker print:bg-white">
                            <ReportHeader
                                title="Loan OS Details"
                                subtitle={`Report Date: ${formatDateForDisplay(submittedReportDate)}`}
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
                                            <TableHead className="font-bold text-white text-xs">Branch Name</TableHead>
                                            <TableHead className="font-bold text-white text-xs">Center Name</TableHead>
                                            <TableHead className="font-bold text-white text-xs">Account ID</TableHead>
                                            <TableHead className="font-bold text-white text-xs">Client Name</TableHead>
                                            <TableHead className="font-bold text-white text-xs">{MEMBER_CONTACT_COLUMN_LABEL}</TableHead>
                                            <TableHead className="font-bold text-white text-xs">Loan A/c</TableHead>
                                            <TableHead className="font-bold text-white text-xs">Disbursal Date</TableHead>
                                            <TableHead className="font-bold text-white text-xs">Due Start Date</TableHead>
                                            <TableHead className="font-bold text-white text-xs">Maturity Date</TableHead>
                                            <TableHead className="font-bold text-white text-xs text-center">Status</TableHead>
                                            <TableHead className="font-bold text-white text-xs text-right">Loan Amount</TableHead>
                                            <TableHead className="font-bold text-white text-xs text-right">Interest Amount</TableHead>
                                            <TableHead className="font-bold text-white text-xs text-right">OS Principle</TableHead>
                                            <TableHead className="font-bold text-white text-xs text-right">OS Interest</TableHead>
                                            <TableHead className="font-bold text-white text-xs text-right">Arrear Pri</TableHead>
                                            <TableHead className="font-bold text-white text-xs text-right">Arrear Int</TableHead>
                                            <TableHead className="font-bold text-white text-xs text-center">Total Dues</TableHead>
                                            <TableHead className="font-bold text-white text-xs text-center">Completed Dues</TableHead>
                                            <TableHead className="font-bold text-white text-xs text-center">Collected Dues</TableHead>
                                            <TableHead className="font-bold text-white text-xs text-right">Due Pri</TableHead>
                                            <TableHead className="font-bold text-white text-xs text-right">Due Int</TableHead>
                                            <TableHead className="font-bold text-white text-xs text-center">DPD</TableHead>
                                            <TableHead className="font-bold text-white text-xs">Ageing</TableHead>
                                            <TableHead className="font-bold text-white text-xs">Mobile</TableHead>
                                            <TableHead className="font-bold text-white text-xs">FDO Name</TableHead>
                                            <TableHead className="font-bold text-white text-xs">Meeting Day</TableHead>
                                            <TableHead className="font-bold text-white text-xs">Disbural Type</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {isLoading ? (
                                            <TableRow>
                                                <TableCell colSpan={27} className="py-4">
                                                    <PageLoader label="Loading report data..." fullScreen={false} />
                                                </TableCell>
                                            </TableRow>
                                        ) : currentData.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan={27} className="text-center py-12">
                                                    <div className="flex flex-col items-center gap-3">
                                                        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-green-tint dark:bg-sidebar-accent">
                                                            <FileText className="h-8 w-8 text-slate-400" />
                                                        </div>
                                                        <div>
                                                            <p className="text-lg font-semibold text-foreground dark:text-slate-100">No records found</p>
                                                            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                                                                No active loans found for the selected date
                                                            </p>
                                                        </div>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ) : (
                                            currentData.map((item, index) => (
                                                <TableRow
                                                    key={`${item.loanAccount}-${index}`}
                                                    className={cn(
                                                        'transition-colors',
                                                        index % 2 === 0
                                                            ? 'bg-white dark:bg-brand-green-darker hover:bg-green-50 dark:hover:bg-green-950/20'
                                                            : 'bg-green-50/50 dark:bg-brand-green-darker/50 hover:bg-green-50 dark:hover:bg-green-950/20',
                                                        (item.arrearPri > 0 || item.arrearInt > 0) && 'border-l-4 border-l-red-500'
                                                    )}
                                                >
                                                    <TableCell className="font-semibold text-sidebar-accent dark:text-primary text-xs whitespace-nowrap">{item.branchName}</TableCell>
                                                    <TableCell className="font-medium text-sidebar-accent dark:text-slate-300 text-xs whitespace-nowrap">{item.centerName}</TableCell>
                                                    <TableCell className="font-mono text-xs text-primary dark:text-primary">{item.accountId}</TableCell>
                                                    <TableCell className="font-semibold text-foreground dark:text-slate-100 text-xs whitespace-nowrap">{item.clientName}</TableCell>
                                                    <TableCell><MemberContactCell row={item} /></TableCell>
                                                    <TableCell className="font-mono text-xs text-cyan-700 dark:text-cyan-400">{item.loanAccount}</TableCell>
                                                    <TableCell className="text-xs whitespace-nowrap">{item.disbursalDate}</TableCell>
                                                    <TableCell className="text-xs whitespace-nowrap">{item.dueStartDate}</TableCell>
                                                    <TableCell className="text-xs whitespace-nowrap">{item.maturityDate}</TableCell>
                                                    <TableCell className="text-center font-semibold text-green-700 dark:text-green-400 text-xs">{item.status}</TableCell>
                                                    <TableCell className="text-right font-bold text-sidebar-accent dark:text-primary text-xs">{formatCurrency(item.loanAmount)}</TableCell>
                                                    <TableCell className="text-right font-semibold text-primary dark:text-primary text-xs">{formatCurrency(item.interestAmount)}</TableCell>
                                                    <TableCell className="text-right font-semibold text-purple-700 dark:text-purple-400 text-xs">{formatCurrency(item.osPrinciple)}</TableCell>
                                                    <TableCell className="text-right font-semibold text-pink-700 dark:text-pink-400 text-xs">{formatCurrency(item.osInterest)}</TableCell>
                                                    <TableCell className="text-right font-semibold text-orange-700 dark:text-orange-400 text-xs">
                                                        {item.arrearPri > 0 ? formatCurrency(item.arrearPri) : '0'}
                                                    </TableCell>
                                                    <TableCell className="text-right font-semibold text-red-700 dark:text-red-400 text-xs">
                                                        {item.arrearInt > 0 ? formatCurrency(item.arrearInt) : '0'}
                                                    </TableCell>
                                                    <TableCell className="text-center font-semibold text-violet-700 dark:text-violet-400 text-xs">{item.totalDues}</TableCell>
                                                    <TableCell className="text-center font-semibold text-teal-700 dark:text-teal-400 text-xs">{item.completedDues}</TableCell>
                                                    <TableCell className="text-center font-semibold text-cyan-700 dark:text-cyan-400 text-xs">{item.collectedDues}</TableCell>
                                                    <TableCell className="text-right font-semibold text-amber-700 dark:text-amber-400 text-xs">{formatCurrency(item.duePri)}</TableCell>
                                                    <TableCell className="text-right font-semibold text-yellow-700 dark:text-yellow-400 text-xs">{formatCurrency(item.dueInt)}</TableCell>
                                                    <TableCell className="text-center font-semibold text-sidebar-accent dark:text-slate-300 text-xs">{item.dpd}</TableCell>
                                                    <TableCell className="font-medium text-sidebar-accent dark:text-slate-300 text-xs whitespace-nowrap">{item.ageing}</TableCell>
                                                    <TableCell className="font-mono text-xs text-sidebar-accent dark:text-slate-300">{item.mobile}</TableCell>
                                                    <TableCell className="font-medium text-sidebar-accent dark:text-slate-300 text-xs whitespace-nowrap">{item.fdoName}</TableCell>
                                                    <TableCell className="font-medium text-sidebar-accent dark:text-slate-300 text-xs">{item.meetingDay}</TableCell>
                                                    <TableCell className="font-medium text-sidebar-accent dark:text-slate-300 text-xs">{item.disbursalType}</TableCell>
                                                </TableRow>
                                            ))
                                        )}
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
                    <div className="flex items-center gap-1">
                        {Array.from({ length: Math.min(10, totalPages) }, (_, i) => {
                            const pageNum = i + 1;
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
                        })}
                        {totalPages > 10 && (
                            <span className="px-2 text-sidebar-accent dark:text-slate-400">...</span>
                        )}
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
