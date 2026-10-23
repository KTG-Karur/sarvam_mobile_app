'use client';

import { useState, useEffect } from 'react';
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
    Landmark,
    Loader2,
    Filter,
    Calendar,
    IndianRupee,
    TrendingUp,
    CreditCard,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { apiClient } from '@/app/lib/api-client';
import { tokenStorage, type StoredUser } from '@/app/lib/token-storage';
import jsPDF from 'jspdf';
import * as XLSX from 'xlsx-js-style';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { drawFunderOsReportPdf } from '@/app/lib/reports/funder-os-report-pdf';
import { reportHeaderRows, autoSizeColumns, applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { formatReportAmount } from '@/app/lib/utils/format-amount';
import { exportToCSV, exportToWord, type WordExportOptions } from '@/app/lib/report-export-utils';
import { usePermission } from '@/app/hooks/usePermission';
import { PageLoader } from '@/components/ui/page-loader';
import { DateInput } from '@/components/ui/date-input';
import { toDisplayDateTime } from '@/app/lib/date-format';

type Branch = { id: string; name: string; code: string };
type FunderOption = { id: string; funderId: string; funderName: string };

type FunderOSRow = {
    funderId: string;
    funderCode: string;
    funderName: string;
    loanCount: number;
    totalDisbursed: number;
    totalInterest: number;
    collectedPrincipal: number;
    collectedInterest: number;
    osPrincipal: number;
    osInterest: number;
};

// IST calendar parts — matches getKolkataCalendarYmd's convention (app/lib/branch-lock.ts,
// which imports 'next/server' so isn't safe to import into a 'use client' component) so
// filter defaults reflect the branch's business date, not the viewer's browser timezone.
const getIstYmdParts = (date: Date = new Date()) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(date);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    return { year: get('year'), month: get('month'), day: get('day') };
};
const todayStr = () => {
    const { year, month, day } = getIstYmdParts();
    return `${year}-${month}-${day}`;
};
const firstOfMonthStr = () => {
    const { year, month } = getIstYmdParts();
    return `${year}-${month}-01`;
};

const calculateSummary = (data: FunderOSRow[]) => ({
    totalFunders: data.length,
    totalLoanCount: data.reduce((sum, r) => sum + r.loanCount, 0),
    totalDisbursed: data.reduce((sum, r) => sum + r.totalDisbursed, 0),
    totalInterest: data.reduce((sum, r) => sum + r.totalInterest, 0),
    totalCollectedPrincipal: data.reduce((sum, r) => sum + r.collectedPrincipal, 0),
    totalCollectedInterest: data.reduce((sum, r) => sum + r.collectedInterest, 0),
    totalOsPrincipal: data.reduce((sum, r) => sum + r.osPrincipal, 0),
    totalOsInterest: data.reduce((sum, r) => sum + r.osInterest, 0),
});

const formatCurrency = (amount: number) => formatReportAmount(amount);

// Every caller passes a YYYY-MM-DD string (from the <input type="date"> value or
// todayStr()/firstOfMonthStr() above) — parsed as plain text rather than via `new Date()`,
// which would reinterpret it as UTC midnight and then shift a day in any timezone behind
// UTC (e.g. IST) when re-extracted with local getDate()/getMonth()/getFullYear().
const formatDateForDisplay = (dateString: string) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateString);
    if (!match) return dateString;
    const [, year, month, day] = match;
    return `${day}/${month}/${year}`;
};

export function FunderOSReportClient() {
    const { canExportReport, getReportExportMode, isHeadOffice } = usePermission();
    const { toast } = useToast();

    // Default mode: a single "As On Date" — every figure (Disbursed/Collected/OS) is
    // cumulative up to that date. "From - To Date" is opt-in: switching to it narrows
    // Collected Principal/Interest to that period, while Disbursed/OS stay as of To Date.
    const [dateMode, setDateMode] = useState<'AS_ON' | 'RANGE'>('AS_ON');
    const [asOnDate, setAsOnDate] = useState<string>(todayStr());
    const [fromDate, setFromDate] = useState<string>(firstOfMonthStr());
    const [toDate, setToDate] = useState<string>(todayStr());
    // Snapshots as of the last "Show" click — used for export filenames/subtitles/params
    // so a draft filter edit (without clicking Show) never changes what's exported.
    const [submittedDateMode, setSubmittedDateMode] = useState<'AS_ON' | 'RANGE'>('AS_ON');
    const [submittedAsOnDate, setSubmittedAsOnDate] = useState<string>(asOnDate);
    const [submittedFromDate, setSubmittedFromDate] = useState<string | null>(null);

    const [isLoading, setIsLoading] = useState(false);
    const [showReport, setShowReport] = useState(false);
    const [data, setData] = useState<FunderOSRow[]>([]);

    // Branch filter — ADMIN, SUBADMIN (ADMIN_NON_HO_BRANCH_SWITCH), AREA_MANAGER, any
    // Head-Office-based user (incl. custom RBAC roles), and any other role explicitly
    // assigned more than one branch get a picker; lists are scoped to assigned branches.
    // storedUser starts null (matching the server, which has no localStorage) and is only
    // populated client-side after mount — reading it synchronously at render time would
    // make the very first client render diverge from the SSR'd HTML (canFilterByBranch
    // flipping true) and trigger a React hydration mismatch.
    const [storedUser, setStoredUser] = useState<StoredUser | null>(null);
    useEffect(() => {
        setStoredUser(tokenStorage.getUser());
    }, []);
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
    const [submittedBranchFilter, setSubmittedBranchFilter] = useState('ALL');

    const [funders, setFunders] = useState<FunderOption[]>([]);
    const [funderFilter, setFunderFilter] = useState('ALL');
    const [submittedFunderFilter, setSubmittedFunderFilter] = useState('ALL');

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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [canFilterByBranch, isAreaManager, isMultiBranchOtherRole]);

    useEffect(() => {
        apiClient.get<FunderOption[]>('/masters/funder').then((result) => {
            if (result.success && result.data) setFunders(result.data);
        });
    }, []);

    const summary = calculateSummary(data);

    const handleShowReport = async () => {
        if (dateMode === 'AS_ON') {
            if (!asOnDate) {
                toast({
                    title: 'Date required',
                    description: 'Please select an As On Date before generating the report.',
                    variant: 'destructive',
                });
                return;
            }
        } else {
            if (!fromDate || !toDate) {
                toast({
                    title: 'Dates required',
                    description: 'Please select both a From Date and a To Date before generating the report.',
                    variant: 'destructive',
                });
                return;
            }
            if (fromDate > toDate) {
                toast({
                    title: 'Invalid date range',
                    description: 'From Date cannot be after To Date.',
                    variant: 'destructive',
                });
                return;
            }
        }

        // In range mode, To Date doubles as the as-on-date for the Disbursed/OS snapshot —
        // From Date only narrows the Collected Principal/Interest window.
        const effectiveAsOnDate = dateMode === 'AS_ON' ? asOnDate : toDate;
        const effectiveFromDate = dateMode === 'RANGE' ? fromDate : null;

        setIsLoading(true);
        try {
            const params = new URLSearchParams({ asOnDate: effectiveAsOnDate });
            if (effectiveFromDate) params.set('fromDate', effectiveFromDate);
            if (canFilterByBranch && branchFilter !== 'ALL') params.set('branchId', branchFilter);
            if (funderFilter !== 'ALL') params.set('funderId', funderFilter);
            const result = await apiClient.get<FunderOSRow[]>(`/reports/funder-os-report?${params}`);
            if (!result.success || !result.data) {
                throw new Error(result.error || 'Failed to fetch report data');
            }
            setData(result.data);
            setSubmittedDateMode(dateMode);
            setSubmittedAsOnDate(effectiveAsOnDate);
            setSubmittedFromDate(effectiveFromDate);
            setSubmittedBranchFilter(branchFilter);
            setSubmittedFunderFilter(funderFilter);
            setShowReport(true);
            toast({
                title: 'Report generated',
                description: `Loaded ${result.data.length} funder record(s) successfully.`,
            });
        } catch (error) {
            console.error('Error fetching Funder OS report:', error);
            toast({
                title: 'Error',
                description: 'Failed to fetch Funder OS report. Please try again.',
                variant: 'destructive',
            });
            setData([]);
            setShowReport(false);
        } finally {
            setIsLoading(false);
        }
    };

    const handleReset = () => {
        const today = todayStr();
        const firstOfMonth = firstOfMonthStr();
        setDateMode('AS_ON');
        setAsOnDate(today);
        setFromDate(firstOfMonth);
        setToDate(today);
        setBranchFilter('ALL');
        setFunderFilter('ALL');
        setSubmittedDateMode('AS_ON');
        setSubmittedAsOnDate(today);
        setSubmittedFromDate(null);
        setSubmittedBranchFilter('ALL');
        setSubmittedFunderFilter('ALL');
        setShowReport(false);
        setData([]);
    };

    const buildFunderOSExportRows = (): { headers: string[]; rows: (string | number)[][] } => {
        const headers = [
            'Funder Code', 'Funder Name', 'No. of Loans', 'Total Disbursed', 'Total Interest',
            'Collected Principal', 'Collected Interest', 'OS Principal', 'OS Interest',
        ];
        const rows: (string | number)[][] = data.map((item) => [
            item.funderCode, item.funderName, item.loanCount, formatReportAmount(item.totalDisbursed), formatReportAmount(item.totalInterest),
            formatReportAmount(item.collectedPrincipal), formatReportAmount(item.collectedInterest),
            formatReportAmount(item.osPrincipal), formatReportAmount(item.osInterest),
        ]);
        if (data.length > 0) {
            rows.push([
                '', 'Grand Total:', summary.totalLoanCount,
                formatReportAmount(summary.totalDisbursed),
                formatReportAmount(summary.totalInterest),
                formatReportAmount(summary.totalCollectedPrincipal),
                formatReportAmount(summary.totalCollectedInterest),
                formatReportAmount(summary.totalOsPrincipal),
                formatReportAmount(summary.totalOsInterest),
            ]);
        }
        return { headers, rows };
    };

    const exportSubtitle = () =>
        submittedDateMode === 'AS_ON' || !submittedFromDate
            ? `As On Date: ${formatDateForDisplay(submittedAsOnDate)}`
            : `As On Date: ${formatDateForDisplay(submittedAsOnDate)}  |  Period: ${formatDateForDisplay(submittedFromDate)} to ${formatDateForDisplay(submittedAsOnDate)}`;

    const handleExport = () => {
        if (!data || data.length === 0) {
            toast({ title: 'No Data', description: 'There is no data to export.', variant: 'destructive' });
            return;
        }
        const { headers, rows } = buildFunderOSExportRows();
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet([...reportHeaderRows('FUNDER OS REPORT'), headers, ...rows]);
        autoSizeColumns(ws);
        applyExcelReportFont(ws);
        XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
        XLSX.writeFile(wb, `FunderOSReport_${submittedAsOnDate}.xlsx`);
        toast({ title: 'Export Successful', description: 'The Funder OS Report has been downloaded.' });
    };

    const handleExportPDF = async () => {
        if (!data || data.length === 0) {
            toast({ title: 'No Data', description: 'There is no data to export.', variant: 'destructive' });
            return;
        }
        const doc = new jsPDF({ orientation: 'landscape' });
        const reportFont = await ensureReportFont(doc);
        const { headers, rows } = buildFunderOSExportRows();
        await drawFunderOsReportPdf(doc, headers, rows, { subtitle: exportSubtitle() }, reportFont);
        doc.save(`FunderOSReport_${submittedAsOnDate}.pdf`);
        toast({ title: 'Export Successful', description: 'The Funder OS Report has been downloaded.' });
    };

    const handleExportCSV = () => {
        if (!data || data.length === 0) {
            toast({ title: 'No Data', description: 'There is no data to export.', variant: 'destructive' });
            return;
        }
        const { headers, rows } = buildFunderOSExportRows();
        exportToCSV(`FunderOSReport_${submittedAsOnDate}`, 'FUNDER OS REPORT', headers, rows);
    };

    const handleExportWord = async () => {
        if (!data || data.length === 0) {
            toast({ title: 'No Data', description: 'There is no data to export.', variant: 'destructive' });
            return;
        }
        const { headers, rows } = buildFunderOSExportRows();
        const options: WordExportOptions = {
            columnAlignments: ['left', 'left', 'center', 'right', 'right', 'right', 'right', 'right', 'right'],
            totalsRow: rows[rows.length - 1],
        };
        await exportToWord(`FunderOSReport_${submittedAsOnDate}`, 'FUNDER OS REPORT', headers, rows.slice(0, -1), options);
    };

    return (
        <div className="relative w-full">
            {/* Header Section */}
            <div className="mb-8">
                <div className="flex items-center gap-4 mb-4">
                    <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary shadow-lg shadow-primary/30">
                        <Landmark className="h-7 w-7 text-white" />
                        <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/20 to-transparent" />
                    </div>
                    <div className="flex-1">
                        <h1 className="text-3xl font-bold tracking-tight text-foreground dark:text-white">
                            Funder OS Report
                        </h1>
                        <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                            Funder-wise disbursement, collections and outstanding balances
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
                                <p className="text-sm font-medium text-sidebar-accent dark:text-green-300">Total Disbursed</p>
                                <p className="text-2xl font-bold text-foreground dark:text-green-100 mt-2">₹ {formatCurrency(summary.totalDisbursed)}</p>
                                <p className="text-xs text-primary dark:text-primary mt-1">As on {formatDateForDisplay(submittedAsOnDate)}</p>
                            </div>
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-green-tint dark:bg-brand-green-darker/50">
                                <CreditCard className="h-6 w-6 text-primary dark:text-primary" />
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-2 border-teal-200/50 dark:border-teal-800/50 bg-gradient-to-br from-teal-50 to-cyan-50/50 dark:from-teal-950/20 dark:to-cyan-950/20">
                    <CardContent className="pt-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm font-medium text-teal-700 dark:text-teal-300">Interest Collected</p>
                                <p className="text-2xl font-bold text-teal-900 dark:text-teal-100 mt-2">₹ {formatCurrency(summary.totalCollectedInterest)}</p>
                                <p className="text-xs text-teal-600 dark:text-teal-400 mt-1">
                                    {submittedDateMode === 'AS_ON' || !submittedFromDate
                                        ? `Up to ${formatDateForDisplay(submittedAsOnDate)}`
                                        : `${formatDateForDisplay(submittedFromDate)} to ${formatDateForDisplay(submittedAsOnDate)}`}
                                </p>
                            </div>
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-teal-100 dark:bg-teal-900/50">
                                <TrendingUp className="h-6 w-6 text-teal-600 dark:text-teal-400" />
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-2 border-purple-200/50 dark:border-purple-800/50 bg-gradient-to-br from-purple-50 to-pink-50/50 dark:from-purple-950/20 dark:to-pink-950/20">
                    <CardContent className="pt-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm font-medium text-purple-700 dark:text-purple-300">OS Principal</p>
                                <p className="text-2xl font-bold text-purple-900 dark:text-purple-100 mt-2">₹ {formatCurrency(summary.totalOsPrincipal)}</p>
                                <p className="text-xs text-purple-600 dark:text-purple-400 mt-1">As on {formatDateForDisplay(submittedAsOnDate)}</p>
                            </div>
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-100 dark:bg-purple-900/50">
                                <IndianRupee className="h-6 w-6 text-purple-600 dark:text-purple-400" />
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-2 border-primary/50 dark:border-primary/50 bg-gradient-to-br from-green-50 to-purple-50/50 dark:from-brand-green-darker/20 dark:to-purple-950/20">
                    <CardContent className="pt-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm font-medium text-primary dark:text-primary">OS Interest</p>
                                <p className="text-2xl font-bold text-foreground dark:text-primary mt-2">₹ {formatCurrency(summary.totalOsInterest)}</p>
                                <p className="text-xs text-primary dark:text-primary mt-1">As on {formatDateForDisplay(submittedAsOnDate)}</p>
                            </div>
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary dark:bg-brand-green-darker/50">
                                <IndianRupee className="h-6 w-6 text-white dark:text-primary" />
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
                                    Select the funder, branch, collection period and as-on-date for the report
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
                                    reportSlug={getReportExportMode('funder-os-report') === 'REQUEST_QUEUE' ? 'funder-os-report' : undefined}
                                    canExport={canExportReport('funder-os-report')}
                                    exportParams={{
                                        fromDate: submittedFromDate,
                                        toDate: submittedAsOnDate,
                                        branchIds: canFilterByBranch && submittedBranchFilter !== 'ALL' ? [submittedBranchFilter] : 'ALL',
                                        filters: {
                                            asOnDate: submittedAsOnDate,
                                            ...(submittedFunderFilter !== 'ALL' ? { funderId: submittedFunderFilter } : {}),
                                        },
                                    }}
                                    className="border-green-400/50 text-sidebar-accent hover:bg-green-50 dark:border-sidebar-accent dark:text-green-300"
                                />
                            </div>
                        )}
                    </div>
                </CardHeader>
                <CardContent className="pt-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {/* Funder Filter */}
                        <div className="space-y-2">
                            <Label htmlFor="funderFilter" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                Funder
                            </Label>
                            <Select value={funderFilter} onValueChange={setFunderFilter} disabled={isLoading}>
                                <SelectTrigger id="funderFilter" className="h-11 border-primary/30 dark:border-sidebar-accent">
                                    <SelectValue placeholder="All Funders" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="ALL">All Funders</SelectItem>
                                    {funders.map((f) => (
                                        <SelectItem key={f.id} value={f.id}>{f.funderId} - {f.funderName}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Branch Filter */}
                        {canFilterByBranch && (
                            <div className="space-y-2">
                                <Label htmlFor="branchFilter" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                    Branch
                                </Label>
                                <Select value={branchFilter} onValueChange={setBranchFilter} disabled={isLoading}>
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

                        {/* Date Mode Toggle */}
                        <div className="space-y-2">
                            <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                Date Mode
                            </Label>
                            <div className="flex h-11 rounded-lg border border-primary/30 dark:border-sidebar-accent overflow-hidden">
                                <button
                                    type="button"
                                    onClick={() => setDateMode('AS_ON')}
                                    disabled={isLoading}
                                    className={cn(
                                        'flex-1 text-sm font-medium transition-colors',
                                        dateMode === 'AS_ON'
                                            ? 'bg-primary text-white'
                                            : 'bg-white text-sidebar-accent hover:bg-green-50 dark:bg-brand-green-darker dark:text-slate-300'
                                    )}
                                >
                                    As On Date
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setDateMode('RANGE')}
                                    disabled={isLoading}
                                    className={cn(
                                        'flex-1 text-sm font-medium transition-colors border-l border-primary/30 dark:border-sidebar-accent',
                                        dateMode === 'RANGE'
                                            ? 'bg-primary text-white'
                                            : 'bg-white text-sidebar-accent hover:bg-green-50 dark:bg-brand-green-darker dark:text-slate-300'
                                    )}
                                >
                                    From - To Date
                                </button>
                            </div>
                        </div>

                        {dateMode === 'AS_ON' ? (
                            /* As On Date (default) — every figure is cumulative up to this date */
                            <div className="space-y-2">
                                <Label htmlFor="asOnDate" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                    As On Date <span className="text-red-500">*</span>
                                </Label>
                                <div className="relative">
                                    <DateInput
                                        id="asOnDate"
                                        value={asOnDate}
                                        onChange={(e) => setAsOnDate(e.target.value)}
                                        className="h-11 border-primary/30 dark:border-sidebar-accent pl-10"
                                    />
                                    <Calendar className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                </div>
                            </div>
                        ) : (
                            <>
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

                                {/* To Date */}
                                <div className="space-y-2">
                                    <Label htmlFor="toDate" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        To Date <span className="text-red-500">*</span>
                                    </Label>
                                    <div className="relative">
                                        <DateInput
                                            id="toDate"
                                            value={toDate}
                                            onChange={(e) => setToDate(e.target.value)}
                                            className="h-11 border-primary/30 dark:border-sidebar-accent pl-10"
                                        />
                                        <Calendar className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                    </div>
                                </div>
                            </>
                        )}

                        {/* Show Button */}
                        <div className="space-y-2">
                            <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-200 opacity-0">Action</Label>
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
                            <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-200 opacity-0">Action</Label>
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

            {/* Funder OS Report Table */}
            {showReport && (
                <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
                    <div className="h-1.5 bg-gradient-to-r from-primary via-primary to-purple-600" />
                    <CardHeader className="bg-gradient-to-r from-slate-50 via-green-50/60 to-green-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker print:bg-white">
                        <ReportHeader title="Funder OS Report" subtitle={exportSubtitle()} />
                    </CardHeader>
                    <CardContent className="p-0">
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-gradient-to-r from-sidebar-accent to-primary dark:from-sidebar-accent dark:to-primary hover:from-sidebar-accent hover:to-primary">
                                        <TableHead className="font-bold text-white text-xs">Funder Code</TableHead>
                                        <TableHead className="font-bold text-white text-xs">Funder Name</TableHead>
                                        <TableHead className="font-bold text-white text-xs text-center">No. of Loans</TableHead>
                                        <TableHead className="font-bold text-white text-xs text-right">Total Disbursed</TableHead>
                                        <TableHead className="font-bold text-white text-xs text-right">Total Interest</TableHead>
                                        <TableHead className="font-bold text-white text-xs text-right">Collected Principal</TableHead>
                                        <TableHead className="font-bold text-white text-xs text-right">Collected Interest</TableHead>
                                        <TableHead className="font-bold text-white text-xs text-right">OS Principal</TableHead>
                                        <TableHead className="font-bold text-white text-xs text-right">OS Interest</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {isLoading ? (
                                        <TableRow>
                                            <TableCell colSpan={9} className="py-4">
                                                <PageLoader label="Loading report data..." fullScreen={false} />
                                            </TableCell>
                                        </TableRow>
                                    ) : data.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={9} className="text-center py-12">
                                                <div className="flex flex-col items-center gap-3">
                                                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-green-tint dark:bg-sidebar-accent">
                                                        <Landmark className="h-8 w-8 text-slate-400" />
                                                    </div>
                                                    <div>
                                                        <p className="text-lg font-semibold text-foreground dark:text-slate-100">No records found</p>
                                                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                                                            No funder activity found for the selected filters
                                                        </p>
                                                    </div>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        <>
                                            {data.map((item, index) => (
                                                <TableRow
                                                    key={item.funderId}
                                                    className={cn(
                                                        'transition-colors',
                                                        index % 2 === 0
                                                            ? 'bg-white dark:bg-brand-green-darker hover:bg-green-50 dark:hover:bg-green-950/20'
                                                            : 'bg-green-50/50 dark:bg-brand-green-darker/50 hover:bg-green-50 dark:hover:bg-green-950/20'
                                                    )}
                                                >
                                                    <TableCell className="font-mono text-xs text-primary dark:text-primary">{item.funderCode}</TableCell>
                                                    <TableCell className="font-semibold text-foreground dark:text-slate-100 text-xs whitespace-nowrap">{item.funderName}</TableCell>
                                                    <TableCell className="text-center font-semibold text-sidebar-accent dark:text-slate-300 text-xs">{item.loanCount}</TableCell>
                                                    <TableCell className="text-right font-bold text-sidebar-accent dark:text-primary text-xs">{formatCurrency(item.totalDisbursed)}</TableCell>
                                                    <TableCell className="text-right font-semibold text-amber-700 dark:text-amber-400 text-xs">{formatCurrency(item.totalInterest)}</TableCell>
                                                    <TableCell className="text-right font-semibold text-cyan-700 dark:text-cyan-400 text-xs">{formatCurrency(item.collectedPrincipal)}</TableCell>
                                                    <TableCell className="text-right font-semibold text-teal-700 dark:text-teal-400 text-xs">{formatCurrency(item.collectedInterest)}</TableCell>
                                                    <TableCell className="text-right font-semibold text-purple-700 dark:text-purple-400 text-xs">{formatCurrency(item.osPrincipal)}</TableCell>
                                                    <TableCell className="text-right font-semibold text-pink-700 dark:text-pink-400 text-xs">{formatCurrency(item.osInterest)}</TableCell>
                                                </TableRow>
                                            ))}
                                            <TableRow className="bg-slate-100 dark:bg-slate-800 font-bold hover:bg-slate-100 dark:hover:bg-slate-800">
                                                <TableCell className="text-xs" colSpan={2}>Grand Total</TableCell>
                                                <TableCell className="text-center text-xs">{summary.totalLoanCount}</TableCell>
                                                <TableCell className="text-right text-xs">{formatCurrency(summary.totalDisbursed)}</TableCell>
                                                <TableCell className="text-right text-xs">{formatCurrency(summary.totalInterest)}</TableCell>
                                                <TableCell className="text-right text-xs">{formatCurrency(summary.totalCollectedPrincipal)}</TableCell>
                                                <TableCell className="text-right text-xs">{formatCurrency(summary.totalCollectedInterest)}</TableCell>
                                                <TableCell className="text-right text-xs">{formatCurrency(summary.totalOsPrincipal)}</TableCell>
                                                <TableCell className="text-right text-xs">{formatCurrency(summary.totalOsInterest)}</TableCell>
                                            </TableRow>
                                        </>
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Footer Info */}
            {showReport && (
                <div className="mt-6 flex items-center justify-between text-sm text-sidebar-accent dark:text-slate-400">
                    <p>
                        Report generated on {toDisplayDateTime(new Date())}
                    </p>
                    <p>
                        Total Funders: <span className="font-semibold text-sidebar-accent dark:text-primary">{data.length}</span>
                    </p>
                </div>
            )}
        </div>
    );
}
