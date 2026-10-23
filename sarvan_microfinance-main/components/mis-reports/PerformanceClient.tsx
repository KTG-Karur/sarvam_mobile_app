'use client';

import { useState, useRef, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
    BarChart3,
    Calendar,
    Search,
    ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { usePermission } from '@/app/hooks/usePermission';
import { apiClient } from '@/app/lib/api-client';
import { tokenStorage } from '@/app/lib/token-storage';
import jsPDF from 'jspdf';
import * as XLSX from 'xlsx-js-style';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { drawPerformanceReport } from '@/app/lib/reports/performance-report-pdf';
import { reportHeaderRows, autoSizeColumns, applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { formatReportAmount } from '@/app/lib/utils/format-amount';
import { exportToCSV, exportToWord, type WordExportOptions } from '@/app/lib/report-export-utils';
import { DateInput } from '@/components/ui/date-input';

type ReportType = 'FDO WISE' | 'BRANCH WISE' | 'AM WISE' | 'DM WISE';
const reportTypes: ReportType[] = ['FDO WISE', 'BRANCH WISE', 'AM WISE', 'DM WISE'];

type Branch = { id: string; name: string; code: string };

type PerformanceData = {
    sino: number;
    branch: string;
    address: string;
    totalCenters: number;
    totalMembers: number;
    attClients100: number;
    active: number;
    nr: number;
    newMembers: number;
    membersDropouts: number;
    fdoSupervisor: string;
    branchManager: string;
    newLoanDemand: number;
    oldLoanDemand: number;
    collection: number;
    preclosure: number;
    newMembersAmount: number;
    oldMembersAmount: number;
    totalAmount: number;
    collected: number;
    collectionAmount: number;
    arrearAmount: number;
    outstanding: number;
    advance: number;
    arrPreAmount: number;
    charges: number;
    bales: number;
    lives: number;
    rent: number;
    chabeeb: number;
    classic: number;
    applCharges: number;
    processingCharges: number;
};

// Calculate summary metrics
const calculateSummary = (data: PerformanceData[]) => {
    return {
        totalCenters: data.reduce((sum, item) => sum + item.totalCenters, 0),
        totalMembers: data.reduce((sum, item) => sum + item.totalMembers, 0),
        attClients100: data.reduce((sum, item) => sum + item.attClients100, 0),
        active: data.reduce((sum, item) => sum + item.active, 0),
        nr: data.reduce((sum, item) => sum + item.nr, 0),
        newMembers: data.reduce((sum, item) => sum + item.newMembers, 0),
        membersDropouts: data.reduce((sum, item) => sum + item.membersDropouts, 0),
        newLoanDemand: data.reduce((sum, item) => sum + item.newLoanDemand, 0),
        oldLoanDemand: data.reduce((sum, item) => sum + item.oldLoanDemand, 0),
        collection: data.reduce((sum, item) => sum + item.collection, 0),
        preclosure: data.reduce((sum, item) => sum + item.preclosure, 0),
        newMembersAmount: data.reduce((sum, item) => sum + item.newMembersAmount, 0),
        oldMembersAmount: data.reduce((sum, item) => sum + item.oldMembersAmount, 0),
        totalAmount: data.reduce((sum, item) => sum + item.totalAmount, 0),
        collected: data.reduce((sum, item) => sum + item.collected, 0),
        collectionAmount: data.reduce((sum, item) => sum + item.collectionAmount, 0),
        arrearAmount: data.reduce((sum, item) => sum + item.arrearAmount, 0),
        outstanding: data.reduce((sum, item) => sum + item.outstanding, 0),
        advance: data.reduce((sum, item) => sum + item.advance, 0),
        arrPreAmount: data.reduce((sum, item) => sum + item.arrPreAmount, 0),
        charges: data.reduce((sum, item) => sum + item.charges, 0),
        bales: data.reduce((sum, item) => sum + item.bales, 0),
        lives: data.reduce((sum, item) => sum + item.lives, 0),
        rent: data.reduce((sum, item) => sum + item.rent, 0),
        chabeeb: data.reduce((sum, item) => sum + item.chabeeb, 0),
        classic: data.reduce((sum, item) => sum + item.classic, 0),
        applCharges: data.reduce((sum, item) => sum + item.applCharges, 0),
        processingCharges: data.reduce((sum, item) => sum + item.processingCharges, 0),
    };
};

// Format currency (whole rupees, truncated — not rounded)
const formatCurrency = (amount: number) => formatReportAmount(amount);

// Format Date
const formatDateForDisplay = (dateString: string) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
};

export function PerformanceClient() {
    const { canExportReport, getReportExportMode, isHeadOffice } = usePermission();
    const [reportType, setReportType] = useState<ReportType | ''>('');
    const [searchQuery, setSearchQuery] = useState('');
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);

    // Branch filter — ADMIN, SUBADMIN (ADMIN_NON_HO_BRANCH_SWITCH), AREA_MANAGER, and any
    // Head-Office-based user (incl. custom RBAC roles like "Zonal Head") get a picker;
    // AREA_MANAGER's branch list is scoped to their assigned branches. No center filter —
    // this report's data is branch-level only (no center dimension).
    const storedUser = tokenStorage.getUser();
    const isAreaManager = storedUser?.role === 'AREA_MANAGER';
    const canFilterByBranch = storedUser?.role === 'ADMIN' || storedUser?.role === 'ADMIN_NON_HO_BRANCH_SWITCH' || isAreaManager || isHeadOffice;
    const [branches, setBranches] = useState<Branch[]>([]);
    const [branchFilter, setBranchFilter] = useState('ALL');

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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [canFilterByBranch, isAreaManager]);

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
    const [data, setData] = useState<PerformanceData[]>([]);
    const printRef = useRef<HTMLDivElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const { toast } = useToast();

    // Handle clicks outside the custom dropdown to close it
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsDropdownOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [dropdownRef]);

    const filteredReportTypes = reportTypes.filter(type =>
        type.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const summary = calculateSummary(data);

    const handleShowReport = async () => {
        if (!reportType) {
            toast({
                title: 'Report type required',
                description: 'Please select a report type before generating the report.',
                variant: 'destructive',
            });
            return;
        }

        if (!fromDate || !tillDate) {
            toast({
                title: 'Date range required',
                description: 'Please select both From Date and Till Date.',
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
            const url = new URL('/api/reports/performance', window.location.origin);
            url.searchParams.append('reportType', reportType);
            url.searchParams.append('fromDate', fromDate);
            url.searchParams.append('toDate', tillDate);
            if (canFilterByBranch && branchFilter !== 'ALL') url.searchParams.append('branchId', branchFilter);

            const response = await fetch(url.toString());
            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || 'Failed to fetch data');
            }

            setData(result.data || []);
            setSubmittedFromDate(fromDate);
            setSubmittedTillDate(tillDate);
            setShowReport(true);
            toast({
                title: 'Report generated',
                description: 'Performance Report loaded successfully.',
            });
        } catch (error: any) {
            console.error('Fetch error:', error);
            toast({
                title: 'Error',
                description: error.message || 'Failed to load report data.',
                variant: 'destructive',
            });
            setData([]);
            setShowReport(false);
        } finally {
            setIsLoading(false);
        }
    };

    const handleReset = () => {
        setReportType('');
        setSearchQuery('');
        const today = new Date().toISOString().split('T')[0];
        setFromDate(today);
        setTillDate(today);
        setBranchFilter('ALL');
        setSubmittedFromDate(today);
        setSubmittedTillDate(today);
        setShowReport(false);
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

        const exportFileName = `Performance Report ${formatDateForDisplay(submittedFromDate)} Between ${formatDateForDisplay(submittedTillDate)}.xlsx`;

        const { headers, rows } = buildPerformanceExportRows();
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet([...reportHeaderRows(`PERFORMANCE REPORT - ${reportType}`), headers, ...rows]);
        autoSizeColumns(ws);
        applyExcelReportFont(ws);
        XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
        XLSX.writeFile(wb, exportFileName);

        toast({
            title: "Export Successful",
            description: "The performance report has been downloaded.",
        });
    };

    // Mirrors the same field mapping used by handleExport above (kept separate so
    // handleExport is left untouched).
    const buildPerformanceExportRows = (): { headers: string[]; rows: (string | number)[][] } => {
        const headers = [
            'SNO', 'Branch', 'Address', 'Total Centers', 'Total Members', '100% Att. Clients', 'Active', 'NR',
            'New Members', 'Members Dropout', 'FDO', 'Supervisor', 'New Loan Demand', 'Old Loan Demand',
            'Collection', 'Preclosure', 'New Members Amount', 'Old Members Amount', 'Total Amount', 'Collected',
            'Collection Amount', 'Arrear Amount', 'Outstanding', 'Advance', 'Arr Pre Amount', 'Charges',
            'Bales', 'Lives', 'Rent', 'Chabeeb', 'Classic', 'Appl. Charges', 'Processing Charges',
        ];
        const rows: (string | number)[][] = data.map((item) => [
            item.sino, item.branch, item.address, item.totalCenters, item.totalMembers, item.attClients100,
            item.active, item.nr, item.newMembers, item.membersDropouts, item.fdoSupervisor, item.branchManager,
            formatReportAmount(item.newLoanDemand), formatReportAmount(item.oldLoanDemand), formatReportAmount(item.collection), formatReportAmount(item.preclosure), formatReportAmount(item.newMembersAmount),
            formatReportAmount(item.oldMembersAmount), formatReportAmount(item.totalAmount), item.collected, formatReportAmount(item.collectionAmount), formatReportAmount(item.arrearAmount),
            formatReportAmount(item.outstanding), formatReportAmount(item.advance), formatReportAmount(item.arrPreAmount), formatReportAmount(item.charges), item.bales, item.lives, item.rent,
            item.chabeeb, item.classic, formatReportAmount(item.applCharges), formatReportAmount(item.processingCharges),
        ]);
        rows.push([
            '', 'TOTAL', '', summary.totalCenters, summary.totalMembers, summary.attClients100, summary.active,
            summary.nr, summary.newMembers, summary.membersDropouts, '', '', formatReportAmount(summary.newLoanDemand),
            formatReportAmount(summary.oldLoanDemand), formatReportAmount(summary.collection), formatReportAmount(summary.preclosure), formatReportAmount(summary.newMembersAmount),
            formatReportAmount(summary.oldMembersAmount), formatReportAmount(summary.totalAmount), summary.collected, formatReportAmount(summary.collectionAmount),
            formatReportAmount(summary.arrearAmount), formatReportAmount(summary.outstanding), formatReportAmount(summary.advance), formatReportAmount(summary.arrPreAmount), formatReportAmount(summary.charges),
            summary.bales, summary.lives, summary.rent, summary.chabeeb, summary.classic, formatReportAmount(summary.applCharges),
            formatReportAmount(summary.processingCharges),
        ]);
        return { headers, rows };
    };

    const handleExportPDF = async () => {
        if (!data || data.length === 0) {
            toast({ title: "No Data", description: "There is no data to export.", variant: 'destructive' });
            return;
        }
        const doc = new jsPDF({ orientation: 'landscape' });
        const reportFont = await ensureReportFont(doc);
        const { headers, rows } = buildPerformanceExportRows();
        await drawPerformanceReport(doc, headers, rows, {
            reportType: reportType || undefined,
            subtitle: `Period: ${formatDateForDisplay(submittedFromDate)} to ${formatDateForDisplay(submittedTillDate)}`,
        }, reportFont);
        doc.save(`Performance_Report_${submittedFromDate}_to_${submittedTillDate}.pdf`);
        toast({ title: "Export Successful", description: "The performance report has been downloaded." });
    };

    const handleExportCSV = () => {
        if (!data || data.length === 0) {
            toast({ title: "No Data", description: "There is no data to export.", variant: 'destructive' });
            return;
        }
        const { headers, rows } = buildPerformanceExportRows();
        exportToCSV(`Performance_Report_${submittedFromDate}_to_${submittedTillDate}`, `PERFORMANCE REPORT - ${reportType}`, headers, rows);
    };

    // Word-only presentation: same rows as PDF/CSV above, but the trailing "TOTAL" row
    // is split off for distinct styling, and genuinely related clusters (New/Old Loan
    // Demand, New/Old/Total Members Amount, Collected+Collection Amount, and the 8
    // named fee/charge columns) get a 2-row grouped header. At 33 columns (same scale
    // as Demand Sheet) this needs A3 landscape.
    const buildPerformanceWordOptions = (
        rows: (string | number)[][]
    ): { bodyRows: (string | number)[][]; options: WordExportOptions } => ({
        bodyRows: rows.slice(0, -1),
        options: {
            groupHeaders: [
                { label: 'SNO', span: 1 }, { label: 'Branch', span: 1 }, { label: 'Address', span: 1 },
                { label: 'Total Centers', span: 1 }, { label: 'Total Members', span: 1 }, { label: '100% Att. Clients', span: 1 },
                { label: 'Active', span: 1 }, { label: 'NR', span: 1 }, { label: 'New Members', span: 1 },
                { label: 'Members Dropout', span: 1 }, { label: 'FDO', span: 1 }, { label: 'Supervisor', span: 1 },
                { label: 'DEMAND', span: 2 }, { label: 'Collection', span: 1 }, { label: 'Preclosure', span: 1 },
                { label: 'AMOUNT', span: 3 }, { label: 'COLLECTION', span: 2 },
                { label: 'Arrear Amount', span: 1 }, { label: 'Outstanding', span: 1 }, { label: 'Advance', span: 1 },
                { label: 'Arr Pre Amount', span: 1 }, { label: 'CHARGES', span: 8 },
            ],
            subHeaders: ['New', 'Old', 'New', 'Old', 'Total', 'Collected', 'Amount', 'Charges', 'Bales', 'Lives', 'Rent', 'Chabeeb', 'Classic', 'Appl.', 'Processing'],
            columnAlignments: ['center', 'left', 'left', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'left', 'left', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right'],
            columnWidthWeights: [4, 10, 12, 7, 7, 7, 6, 5, 7, 7, 9, 9, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 6, 6, 6, 7, 7],
            totalsRow: rows[rows.length - 1],
            pageSize: { widthMm: 297, heightMm: 420 },
        },
    });

    const handleExportWord = async () => {
        if (!data || data.length === 0) {
            toast({ title: "No Data", description: "There is no data to export.", variant: 'destructive' });
            return;
        }
        const { headers, rows } = buildPerformanceExportRows();
        const { bodyRows, options } = buildPerformanceWordOptions(rows);
        await exportToWord(`Performance_Report_${submittedFromDate}_to_${submittedTillDate}`, `PERFORMANCE REPORT - ${reportType}`, headers, bodyRows, options);
    };

    return (
        <div className="relative w-full">
            {/* Header Section */}
            <div className="mb-8">
                <div className="flex items-center gap-4 mb-4">
                    <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary shadow-lg shadow-primary/30">
                        <BarChart3 className="h-7 w-7 text-white" />
                        <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/20 to-transparent" />
                    </div>
                    <div className="flex-1">
                        <h1 className="text-3xl font-bold tracking-tight text-foreground dark:text-white">
                            Performance Report
                        </h1>
                        <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                            Comprehensive performance metrics with dynamic analysis
                        </p>
                    </div>
                </div>
            </div>

            {/* Filters Card */}
            <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-visible mb-6 relative">
                <div className="h-1.5 bg-gradient-to-r from-primary via-primary to-purple-600 rounded-t-[10px]" />
                <CardHeader className="bg-gradient-to-r from-slate-50 via-green-50/60 to-green-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                    <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-green-tint dark:bg-brand-green-darker/30">
                                <Filter className="h-5 w-5 text-primary dark:text-primary" />
                            </div>
                            <div>
                                <CardTitle className="text-xl">Report Parameters</CardTitle>
                                <CardDescription>
                                    Select report type and date range
                                </CardDescription>
                            </div>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="pt-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">

                        {/* Custom Searchable Select for Report Type */}
                        <div className="space-y-2 relative" ref={dropdownRef}>
                            <Label htmlFor="reportType" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                Report Type <span className="text-red-500">*</span>
                            </Label>
                            <div
                                className="h-11 border border-primary/30 dark:border-sidebar-accent rounded-md px-3 flex items-center justify-between cursor-pointer bg-white dark:bg-green-950"
                                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                            >
                                <span className={reportType ? "text-foreground dark:text-white" : "text-slate-500 dark:text-slate-400"}>
                                    {reportType || '-- SELECT --'}
                                </span>
                                <ChevronDown className="h-4 w-4 opacity-50" />
                            </div>

                            {/* Dropdown Popover */}
                            {isDropdownOpen && (
                                <div className="absolute z-50 w-full mt-1 bg-white dark:bg-green-950 border border-primary/20 dark:border-sidebar-accent rounded-md shadow-lg overflow-hidden">
                                    <div className="p-2 border-b border-slate-100 dark:border-sidebar-accent flex items-center gap-2">
                                        <Search className="h-4 w-4 text-slate-400" />
                                        <Input
                                            placeholder="Search type..."
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                            className="h-8 border-none focus-visible:ring-0 px-0 shadow-none text-sm"
                                            autoFocus
                                        />
                                    </div>
                                    <div className="max-h-60 overflow-auto p-1">
                                        <div
                                            className={cn(
                                                "px-2 py-1.5 text-sm rounded-sm cursor-pointer hover:bg-brand-green-tint dark:hover:bg-sidebar-accent",
                                                !reportType && "bg-brand-green-tint dark:bg-sidebar-accent font-medium"
                                            )}
                                            onClick={() => {
                                                setReportType('');
                                                setIsDropdownOpen(false);
                                                setSearchQuery('');
                                            }}
                                        >
                                            -- SELECT --
                                        </div>
                                        {filteredReportTypes.map(type => (
                                            <div
                                                key={type}
                                                className={cn(
                                                    "px-2 py-1.5 text-sm rounded-sm cursor-pointer hover:bg-brand-green-tint dark:hover:bg-sidebar-accent",
                                                    reportType === type && "bg-green-50 dark:bg-brand-green-darker/50 text-primary dark:text-primary font-medium"
                                                )}
                                                onClick={() => {
                                                    setReportType(type);
                                                    setIsDropdownOpen(false);
                                                    setSearchQuery('');
                                                }}
                                            >
                                                {type}
                                            </div>
                                        ))}
                                        {filteredReportTypes.length === 0 && (
                                            <div className="px-2 py-3 text-sm text-center text-slate-500">
                                                No type found.
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
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

                        {/* Branch Filter (ADMIN / SUBADMIN / AREA_MANAGER only) */}
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

                        {/* Action Buttons Row */}
                        <div className="space-y-2">
                            <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-200 opacity-0">
                                Actions
                            </Label>
                            <div className="flex gap-2">
                                <Button
                                    onClick={handleShowReport}
                                    disabled={isLoading}
                                    className="h-11 flex-1 bg-gradient-to-r from-primary to-primary hover:from-sidebar-accent hover:to-primary text-white shadow-lg shadow-primary/30"
                                >
                                    {isLoading ? (
                                        <>
                                            <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                                            <span>Loading...</span>
                                        </>
                                    ) : (
                                        <>
                                            <FileText className="h-4 w-4 mr-2" />
                                            <span>Show</span>
                                        </>
                                    )}
                                </Button>
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
                                            reportSlug={getReportExportMode('performance-report') === 'REQUEST_QUEUE' ? 'performance-report' : undefined}
                                            canExport={canExportReport('performance-report')}
                                            onExportWord={handleExportWord}
                                            exportParams={{
                                                fromDate: submittedFromDate,
                                                toDate: submittedTillDate,
                                                branchIds: branchFilter === 'ALL' ? 'ALL' : [branchFilter],
                                                // reportType only feeds the PDF title (fetchPerformanceReport ignores
                                                // filters entirely, so this is inert for Excel/CSV/Word) — without it
                                                // the Queue PDF's title drops the "- FDO WISE"/etc suffix Direct always shows.
                                                filters: reportType ? { reportType } : null,
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

            {/* Performance Report Table */}
            {showReport && (
                <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
                    <div className="h-1.5 bg-gradient-to-r from-primary via-primary to-purple-600" />

                    {/* Print-friendly content */}
                    <div ref={printRef} className="print:p-8">
                        <CardHeader className="bg-gradient-to-r from-slate-50 via-green-50/60 to-green-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker print:bg-white">
                            <ReportHeader
                                title={`Performance Report - ${reportType}`}
                                subtitle={`Period: ${formatDateForDisplay(submittedFromDate)} to ${formatDateForDisplay(submittedTillDate)}`}
                            />
                        </CardHeader>

                        <CardContent className="p-0">
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow className="bg-gradient-to-r from-[#1346A2] to-sidebar-accent hover:from-[#1346A2] hover:to-sidebar-accent">
                                            <TableHead className="font-bold text-white text-xs border-r border-[#1a5edb] whitespace-nowrap px-2">SNO</TableHead>
                                            <TableHead className="font-bold text-white text-xs border-r border-[#1a5edb] whitespace-nowrap px-2">BRANCH</TableHead>
                                            <TableHead className="font-bold text-white text-xs border-r border-[#1a5edb] whitespace-nowrap px-2">ADDRESS</TableHead>
                                            <TableHead className="font-bold text-white text-xs border-r border-[#1a5edb] whitespace-nowrap px-2">TOTAL CENTERS</TableHead>
                                            <TableHead className="font-bold text-white text-xs border-r border-[#1a5edb] whitespace-nowrap px-2">TOTAL MEMBERS</TableHead>
                                            <TableHead className="font-bold text-white text-xs border-r border-[#1a5edb] whitespace-nowrap px-2">100% Att. Clients</TableHead>
                                            <TableHead className="font-bold text-white text-xs border-r border-[#1a5edb] whitespace-nowrap px-2">ACTIVE</TableHead>
                                            <TableHead className="font-bold text-white text-xs border-r border-[#1a5edb] whitespace-nowrap px-2">NR</TableHead>
                                            <TableHead className="font-bold text-white text-xs border-r border-[#1a5edb] whitespace-nowrap px-2">NEW MEMBERS</TableHead>
                                            <TableHead className="font-bold text-white text-xs border-r border-[#1a5edb] whitespace-nowrap px-2">MEMBERS DROPOUT</TableHead>
                                            <TableHead className="font-bold text-white text-xs border-r border-[#1a5edb] whitespace-nowrap px-2">FDO</TableHead>
                                            <TableHead className="font-bold text-white text-xs border-r border-[#1a5edb] whitespace-nowrap px-2">SUPERVISOR</TableHead>
                                            <TableHead className="font-bold text-white text-xs border-r border-[#1a5edb] whitespace-nowrap px-2">NEW LOAN DEMAND</TableHead>
                                            <TableHead className="font-bold text-white text-xs border-r border-[#1a5edb] whitespace-nowrap px-2">OLD LOAN DEMAND</TableHead>
                                            <TableHead className="font-bold text-white text-xs border-r border-[#1a5edb] whitespace-nowrap px-2">COLLECTION</TableHead>
                                            <TableHead className="font-bold text-white text-xs border-r border-[#1a5edb] whitespace-nowrap px-2">PRECLOSURE</TableHead>
                                            <TableHead className="font-bold text-white text-xs border-r border-[#1a5edb] whitespace-nowrap px-2">NEW MEMBERS AMOUNT</TableHead>
                                            <TableHead className="font-bold text-white text-xs border-r border-[#1a5edb] whitespace-nowrap px-2">OLD MEMBERS AMOUNT</TableHead>
                                            <TableHead className="font-bold text-white text-xs border-r border-[#1a5edb] whitespace-nowrap px-2">TOTAL AMOUNT</TableHead>
                                            <TableHead className="font-bold text-white text-xs border-r border-[#1a5edb] whitespace-nowrap px-2">COLLECTED</TableHead>
                                            <TableHead className="font-bold text-white text-xs border-r border-[#1a5edb] whitespace-nowrap px-2">COLLECTION AMOUNT</TableHead>
                                            <TableHead className="font-bold text-white text-xs border-r border-[#1a5edb] whitespace-nowrap px-2">ARREAR AMOUNT</TableHead>
                                            <TableHead className="font-bold text-white text-xs border-r border-[#1a5edb] whitespace-nowrap px-2">OUTSTANDING</TableHead>
                                            <TableHead className="font-bold text-white text-xs border-r border-[#1a5edb] whitespace-nowrap px-2">ADVANCE</TableHead>
                                            <TableHead className="font-bold text-white text-xs border-r border-[#1a5edb] whitespace-nowrap px-2">ARR PRE AMOUNT</TableHead>
                                            <TableHead className="font-bold text-white text-xs border-r border-[#1a5edb] whitespace-nowrap px-2">CHARGES</TableHead>
                                            <TableHead className="font-bold text-white text-xs border-r border-[#1a5edb] whitespace-nowrap px-2">BALES</TableHead>
                                            <TableHead className="font-bold text-white text-xs border-r border-[#1a5edb] whitespace-nowrap px-2">LIVES</TableHead>
                                            <TableHead className="font-bold text-white text-xs border-r border-[#1a5edb] whitespace-nowrap px-2">RENT</TableHead>
                                            <TableHead className="font-bold text-white text-xs border-r border-[#1a5edb] whitespace-nowrap px-2">CHABEEB</TableHead>
                                            <TableHead className="font-bold text-white text-xs border-r border-[#1a5edb] whitespace-nowrap px-2">CLASSIC</TableHead>
                                            <TableHead className="font-bold text-white text-xs border-r border-[#1a5edb] whitespace-nowrap px-2">APPL.CHARGES</TableHead>
                                            <TableHead className="font-bold text-white text-xs whitespace-nowrap px-2">PROCESSING CHARGES</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {data.length > 0 ? (
                                            <>
                                                {data.map((item, index) => (
                                                    <TableRow
                                                        key={index}
                                                        className={cn(
                                                            'transition-colors',
                                                            index % 2 === 0
                                                                ? 'bg-white dark:bg-brand-green-darker hover:bg-green-50 dark:hover:bg-green-950/20'
                                                                : 'bg-green-50/50 dark:bg-brand-green-darker/50 hover:bg-green-50 dark:hover:bg-green-950/20'
                                                        )}
                                                    >
                                                        <TableCell className="text-center font-semibold text-sidebar-accent dark:text-slate-300 border-r">{item.sino}</TableCell>
                                                        <TableCell className="font-semibold text-sidebar-accent dark:text-primary border-r whitespace-nowrap">{item.branch}</TableCell>
                                                        <TableCell className="font-medium text-sidebar-accent dark:text-slate-300 border-r whitespace-nowrap truncate max-w-[200px]">{item.address}</TableCell>
                                                        <TableCell className="text-center font-semibold border-r">{item.totalCenters}</TableCell>
                                                        <TableCell className="text-center font-semibold border-r">{item.totalMembers}</TableCell>
                                                        <TableCell className="text-center font-semibold border-r">{item.attClients100}</TableCell>
                                                        <TableCell className="text-center font-semibold text-green-700 dark:text-green-400 border-r">{item.active}</TableCell>
                                                        <TableCell className="text-center font-semibold border-r text-orange-600">{item.nr}</TableCell>
                                                        <TableCell className="text-center font-semibold border-r text-primary">{item.newMembers}</TableCell>
                                                        <TableCell className="text-center font-semibold border-r text-red-600">{item.membersDropouts}</TableCell>
                                                        <TableCell className="font-medium text-sidebar-accent dark:text-slate-300 border-r whitespace-nowrap">{item.fdoSupervisor}</TableCell>
                                                        <TableCell className="font-medium text-sidebar-accent dark:text-slate-300 border-r whitespace-nowrap">{item.branchManager}</TableCell>
                                                        <TableCell className="text-right font-semibold border-r">{formatCurrency(item.newLoanDemand)}</TableCell>
                                                        <TableCell className="text-right font-semibold border-r">{formatCurrency(item.oldLoanDemand)}</TableCell>
                                                        <TableCell className="text-right font-semibold border-r">{formatCurrency(item.collection)}</TableCell>
                                                        <TableCell className="text-right font-semibold border-r">{formatCurrency(item.preclosure)}</TableCell>
                                                        <TableCell className="text-right font-semibold border-r">{formatCurrency(item.newMembersAmount)}</TableCell>
                                                        <TableCell className="text-right font-semibold border-r">{formatCurrency(item.oldMembersAmount)}</TableCell>
                                                        <TableCell className="text-right font-bold text-primary border-r">{formatCurrency(item.totalAmount)}</TableCell>
                                                        <TableCell className="text-right font-semibold border-r text-green-700">{item.collected}</TableCell>
                                                        <TableCell className="text-right font-semibold border-r">{formatCurrency(item.collectionAmount)}</TableCell>
                                                        <TableCell className="text-right font-semibold border-r text-red-600">{formatCurrency(item.arrearAmount)}</TableCell>
                                                        <TableCell className="text-right font-bold text-teal-700 border-r">{formatCurrency(item.outstanding)}</TableCell>
                                                        <TableCell className="text-right font-semibold border-r">{formatCurrency(item.advance)}</TableCell>
                                                        <TableCell className="text-right font-semibold border-r">{formatCurrency(item.arrPreAmount)}</TableCell>
                                                        <TableCell className="text-right font-semibold border-r">{formatCurrency(item.charges)}</TableCell>
                                                        <TableCell className="text-right font-semibold border-r">{item.bales}</TableCell>
                                                        <TableCell className="text-right font-semibold border-r">{item.lives}</TableCell>
                                                        <TableCell className="text-right font-semibold border-r">{item.rent}</TableCell>
                                                        <TableCell className="text-right font-semibold border-r">{item.chabeeb}</TableCell>
                                                        <TableCell className="text-right font-semibold border-r">{item.classic}</TableCell>
                                                        <TableCell className="text-right font-semibold border-r">{formatCurrency(item.applCharges)}</TableCell>
                                                        <TableCell className="text-right font-semibold">{formatCurrency(item.processingCharges)}</TableCell>
                                                    </TableRow>
                                                ))}
                                                {/* Total Row */}
                                                <TableRow className="bg-gradient-to-r from-brand-green-tint to-primary dark:from-brand-green-darker/40 dark:to-brand-green-darker/40 border-t-2 border-primary/30">
                                                    <TableCell colSpan={3} className="text-center font-bold text-foreground dark:text-white border-r">
                                                        TOTAL:
                                                    </TableCell>
                                                    <TableCell className="text-center font-bold text-foreground dark:text-white border-r">{summary.totalCenters}</TableCell>
                                                    <TableCell className="text-center font-bold text-foreground dark:text-white border-r">{summary.totalMembers}</TableCell>
                                                    <TableCell className="text-center font-bold text-foreground dark:text-white border-r">{summary.attClients100}</TableCell>
                                                    <TableCell className="text-center font-bold text-foreground dark:text-white border-r">{summary.active}</TableCell>
                                                    <TableCell className="text-center font-bold text-foreground dark:text-white border-r">{summary.nr}</TableCell>
                                                    <TableCell className="text-center font-bold text-foreground dark:text-white border-r">{summary.newMembers}</TableCell>
                                                    <TableCell className="text-center font-bold text-foreground dark:text-white border-r">{summary.membersDropouts}</TableCell>
                                                    <TableCell className="text-center font-bold text-foreground dark:text-white border-r"></TableCell>
                                                    <TableCell className="text-center font-bold text-foreground dark:text-white border-r"></TableCell>
                                                    <TableCell className="text-right font-bold text-foreground dark:text-white border-r">{formatCurrency(summary.newLoanDemand)}</TableCell>
                                                    <TableCell className="text-right font-bold text-foreground dark:text-white border-r">{formatCurrency(summary.oldLoanDemand)}</TableCell>
                                                    <TableCell className="text-right font-bold text-foreground dark:text-white border-r">{formatCurrency(summary.collection)}</TableCell>
                                                    <TableCell className="text-right font-bold text-foreground dark:text-white border-r">{formatCurrency(summary.preclosure)}</TableCell>
                                                    <TableCell className="text-right font-bold text-foreground dark:text-white border-r">{formatCurrency(summary.newMembersAmount)}</TableCell>
                                                    <TableCell className="text-right font-bold text-foreground dark:text-white border-r">{formatCurrency(summary.oldMembersAmount)}</TableCell>
                                                    <TableCell className="text-right font-bold text-foreground dark:text-white border-r">{formatCurrency(summary.totalAmount)}</TableCell>
                                                    <TableCell className="text-right font-bold text-foreground dark:text-white border-r">{summary.collected}</TableCell>
                                                    <TableCell className="text-right font-bold text-foreground dark:text-white border-r">{formatCurrency(summary.collectionAmount)}</TableCell>
                                                    <TableCell className="text-right font-bold text-foreground dark:text-white border-r">{formatCurrency(summary.arrearAmount)}</TableCell>
                                                    <TableCell className="text-right font-bold text-foreground dark:text-white border-r">{formatCurrency(summary.outstanding)}</TableCell>
                                                    <TableCell className="text-right font-bold text-foreground dark:text-white border-r">{formatCurrency(summary.advance)}</TableCell>
                                                    <TableCell className="text-right font-bold text-foreground dark:text-white border-r">{formatCurrency(summary.arrPreAmount)}</TableCell>
                                                    <TableCell className="text-right font-bold text-foreground dark:text-white border-r">{formatCurrency(summary.charges)}</TableCell>
                                                    <TableCell className="text-right font-bold text-foreground dark:text-white border-r">{summary.bales}</TableCell>
                                                    <TableCell className="text-right font-bold text-foreground dark:text-white border-r">{summary.lives}</TableCell>
                                                    <TableCell className="text-right font-bold text-foreground dark:text-white border-r">{summary.rent}</TableCell>
                                                    <TableCell className="text-right font-bold text-foreground dark:text-white border-r">{summary.chabeeb}</TableCell>
                                                    <TableCell className="text-right font-bold text-foreground dark:text-white border-r">{summary.classic}</TableCell>
                                                    <TableCell className="text-right font-bold text-foreground dark:text-white border-r">{formatCurrency(summary.applCharges)}</TableCell>
                                                    <TableCell className="text-right font-bold text-foreground dark:text-white">{formatCurrency(summary.processingCharges)}</TableCell>
                                                </TableRow>
                                            </>
                                        ) : (
                                            <TableRow>
                                                <TableCell colSpan={33} className="text-center py-8 text-slate-500 dark:text-slate-400">
                                                    No performance records found for the selected criteria.
                                                </TableCell>
                                            </TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                        </CardContent>
                    </div>
                </Card>
            )}
        </div>
    );
}
