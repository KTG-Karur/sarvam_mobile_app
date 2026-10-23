'use client';

import { useState, useRef, useEffect } from 'react';
import jsPDF from 'jspdf';
import * as XLSX from 'xlsx-js-style';
import { reportHeaderRows, autoSizeColumns, applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { formatReportAmount } from '@/app/lib/utils/format-amount';
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
    Wallet,
    Download,
    FileText,
    FileBarChart,
    FileType,
    FileOutput,
    Printer,
    RefreshCw,
    Filter,
    IndianRupee,
    Building2,
    TrendingUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { useToast } from '@/hooks/use-toast';
import { usePermission } from '@/app/hooks/usePermission';
import { apiClient } from '@/app/lib/api-client';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { drawMisDisbursementReport } from '@/app/lib/reports/mis-disbursement-pdf';
import { exportToCSV, exportToWord, type WordExportOptions } from '@/app/lib/report-export-utils';
import { DateInput } from '@/components/ui/date-input';
import { toDisplayDate, toDisplayDateTime } from '@/app/lib/date-format';

// Disbursement data interface
interface DisbursementData {
    branchId: number | string;
    branchName: string;
    disbursalDate: string;
    centerId: number | string;
    centerName: string;
    memberId: string;
    memberName: string;
    funder: string;
    loanAccountNo: string;
    loanAmount: number;
    totalDues: number;
    purpose: string;
    empId: number | string;
    fdo: string;
    dueStartDate: string;
    loanSlNo: number;
    phone: string;
    meetingDay: string;
}

interface Center {
    id: string;
    name: string;
    code: string;
}

// Calculate summary metrics
const calculateSummary = (data: DisbursementData[]) => {
    return {
        totalDisbursements: data.length,
        totalAmount: data.reduce((sum, item) => sum + Number(item.loanAmount || 0), 0),
        uniqueBranches: new Set(data.map(item => item.branchId)).size,
        uniqueCenters: new Set(data.map(item => item.centerId)).size,
        avgLoanAmount: data.length > 0 ? data.reduce((sum, item) => sum + Number(item.loanAmount || 0), 0) / data.length : 0,
    };
};

// Format currency (whole rupees, truncated — not rounded)
const formatCurrency = (amount: number) => formatReportAmount(amount);

// Format date for UI headers
const formatDate = (dateString: string) => {
    return toDisplayDate(new Date(dateString));
};

export default function DisbursementReportPage() {
    const { toast } = useToast();
    const { canExportReport, getReportExportMode } = usePermission();
    const [fromDate, setFromDate] = useState<string>(
        new Date().toISOString().split('T')[0]
    );
    const [toDate, setToDate] = useState<string>(
        new Date().toISOString().split('T')[0]
    );
    const [selectedCenterId, setSelectedCenterId] = useState<string>('all');
    const [centers, setCenters] = useState<Center[]>([]);
    const [isLoadingCenters, setIsLoadingCenters] = useState(true);
    const [isLoading, setIsLoading] = useState(false);
    // Snapshot of fromDate/toDate/selectedCenterId as of the last "Show" click —
    // used for export filenames, PDF/Word subtitles, on-screen labels, and
    // exportParams so a draft filter edit (without clicking Show) never changes
    // what's displayed/exported.
    const [submittedFromDate, setSubmittedFromDate] = useState<string>(fromDate);
    const [submittedToDate, setSubmittedToDate] = useState<string>(toDate);
    const [submittedCenterId, setSubmittedCenterId] = useState<string>(selectedCenterId);
    const [showReport, setShowReport] = useState(false);
    const [disbursementData, setDisbursementData] = useState<DisbursementData[]>([]);

    const printRef = useRef<HTMLDivElement>(null);

    // Fetch centers on mount - using apiClient like BalanceInformationReport
    useEffect(() => {
        const fetchCenters = async () => {
            try {
                const response = await apiClient.get<Center[]>('/centers');
                if (response.success && response.data) {
                    setCenters(response.data);
                } else {
                    console.error('Failed to fetch centers:', response.error);
                }
            } catch (error) {
                console.error('Error fetching centers:', error);
            } finally {
                setIsLoadingCenters(false);
            }
        };
        fetchCenters();
    }, []);

    const summary = calculateSummary(disbursementData);

    const handleShowReport = async () => {
        if (!fromDate || !toDate) {
            toast({
                title: "Date Required",
                description: "Please select both from and to dates.",
                variant: "destructive",
            });
            return;
        }

        setIsLoading(true);
        try {
            const params = new URLSearchParams({
                fromDate,
                toDate,
            });
            // Pass selected center to backend for server-side filtering
            if (selectedCenterId !== 'all') {
                params.append('centerId', selectedCenterId);
            }
            
            const response = await fetch(`/api/reports/disbursement?${params.toString()}`);
            if (!response.ok) {
                throw new Error('Failed to fetch disbursement data');
            }
            const result = await response.json();
            
            if (result.success) {
                setDisbursementData(result.data || []);
                setSubmittedFromDate(fromDate);
                setSubmittedToDate(toDate);
                setSubmittedCenterId(selectedCenterId);
                setShowReport(true);
                toast({
                    title: "Success",
                    description: `Disbursement report generated with ${result.data?.length || 0} records.`,
                });
            } else {
                throw new Error(result.error || 'Failed to fetch data');
            }
        } catch (error) {
            console.error('Error fetching disbursement data:', error);
            toast({
                title: "Error",
                description: "Failed to fetch disbursement report. Please try again.",
                variant: "destructive",
            });
            setDisbursementData([]);
            setShowReport(false);
        } finally {
            setIsLoading(false);
        }
    };

    const handleReset = () => {
        const today = new Date().toISOString().split('T')[0];
        setFromDate(today);
        setToDate(today);
        setSelectedCenterId('all');
        setSubmittedFromDate(today);
        setSubmittedToDate(today);
        setSubmittedCenterId('all');
        setShowReport(false);
        setDisbursementData([]);
    };

    const handleExport = () => {
        if (!disbursementData || disbursementData.length === 0) {
            toast({
                title: "No Data",
                description: "There is no data to export.",
                variant: 'destructive',
            });
            return;
        }

        const { headers, rows } = buildDisbursementExportRows();
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet([...reportHeaderRows('DISBURSEMENT REPORT'), headers, ...rows]);
        autoSizeColumns(ws);
        applyExcelReportFont(ws);
        XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
        XLSX.writeFile(wb, `${exportFileBase()}.xlsx`);

        toast({
            title: "Export Successful",
            description: "The disbursement report has been downloaded.",
        });
    };

    const handlePrint = () => {
        window.print();
    };

    // ── PDF / CSV / Word export (mirrors the same field mapping used by handleExport
    // above, kept separate so handleExport is left untouched) ──────────────────────
    const buildDisbursementExportRows = (): { headers: string[]; rows: (string | number)[][] } => {
        const headers = [
            'Branch ID', 'Branch Name', 'Disbursal Date', 'Center ID', 'Center Name', 'Member ID',
            'Member Name', 'Funder', 'Loan A/C No', 'Loan Amount', 'Total Dues', 'Purpose',
            'Emp ID', 'FDO', 'Due Start Date', 'Loan Sl No', 'Phone', 'Meeting Day',
        ];
        const rows: (string | number)[][] = disbursementData.map((item) => [
            item.branchId, item.branchName, item.disbursalDate, item.centerId, item.centerName,
            item.memberId, item.memberName, item.funder, item.loanAccountNo, formatReportAmount(item.loanAmount),
            formatReportAmount(item.totalDues), item.purpose, item.empId, item.fdo, item.dueStartDate,
            item.loanSlNo, item.phone, item.meetingDay,
        ]);
        if (disbursementData.length > 0) {
            const totalLoanAmount = disbursementData.reduce((sum, item) => sum + (item.loanAmount || 0), 0);
            rows.push([
                'Grand Total', '', '', '', '', '', '', '', '',
                formatReportAmount(totalLoanAmount), '', '', '', '', '', '', '', '',
            ]);
        }
        return { headers, rows };
    };

    const exportFileBase = () => {
        const formatExportDate = (dateStr: string) => {
            const d = new Date(dateStr);
            const day = d.getDate().toString().padStart(2, '0');
            const month = (d.getMonth() + 1).toString().padStart(2, '0');
            const year = d.getFullYear();
            return `${day}/${month}/${year}`;
        };
        const selectedCenter = centers.find(c => c.id === submittedCenterId);
        const centerSuffix = submittedCenterId !== 'all' && selectedCenter ? `_${selectedCenter.code}` : '';
        return `Disbursement_Report_${formatExportDate(submittedFromDate)}_To_${formatExportDate(submittedToDate)}${centerSuffix}`;
    };

    const handleExportPDF = async () => {
        if (!disbursementData || disbursementData.length === 0) {
            toast({ title: "No Data", description: "There is no data to export.", variant: 'destructive' });
            return;
        }
        const { headers, rows } = buildDisbursementExportRows();
        const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
        const reportFont = await ensureReportFont(doc);
        await drawMisDisbursementReport(
            doc,
            { headers, rows },
            { subtitle: `Period: ${formatDate(submittedFromDate)} to ${formatDate(submittedToDate)}${submittedCenterId !== 'all' ? `  •  Center: ${getCenterName(submittedCenterId)}` : ''}` },
            reportFont
        );
        doc.save(`${exportFileBase()}.pdf`);
        toast({ title: "PDF Exported", description: "The disbursement report has been downloaded." });
    };

    const handleExportCSV = () => {
        if (!disbursementData || disbursementData.length === 0) {
            toast({ title: "No Data", description: "There is no data to export.", variant: 'destructive' });
            return;
        }
        const { headers, rows } = buildDisbursementExportRows();
        exportToCSV(exportFileBase(), 'DISBURSEMENT REPORT', headers, rows);
    };

    // Word-only presentation: same rows as PDF/CSV above, but the trailing "Grand
    // Total" row is split off for distinct styling, and the Branch/Center/Member
    // ID+Name pairs get a light 2-row grouped header — genuine related fields; the
    // other 12 columns stay standalone (18 columns doesn't need A3).
    const buildDisbursementWordOptions = (
        rows: (string | number)[][]
    ): { bodyRows: (string | number)[][]; options: WordExportOptions } => ({
        bodyRows: rows.slice(0, -1),
        options: {
            groupHeaders: [
                { label: 'BRANCH', span: 2 }, { label: 'Disbursal Date', span: 1 }, { label: 'CENTER', span: 2 },
                { label: 'MEMBER', span: 2 }, { label: 'Funder', span: 1 }, { label: 'Loan A/C No', span: 1 },
                { label: 'Loan Amount', span: 1 }, { label: 'Total Dues', span: 1 }, { label: 'Purpose', span: 1 },
                { label: 'Emp ID', span: 1 }, { label: 'FDO', span: 1 }, { label: 'Due Start Date', span: 1 },
                { label: 'Loan Sl No', span: 1 }, { label: 'Phone', span: 1 }, { label: 'Meeting Day', span: 1 },
            ],
            subHeaders: ['ID', 'Name', 'ID', 'Name', 'ID', 'Name'],
            columnAlignments: ['center', 'left', 'center', 'center', 'left', 'center', 'left', 'left', 'center', 'right', 'right', 'left', 'center', 'left', 'center', 'center', 'center', 'center'],
            columnWidthWeights: [6, 10, 8, 6, 10, 6, 10, 9, 8, 8, 8, 10, 7, 7, 8, 7, 8, 8],
            totalsRow: rows[rows.length - 1],
        },
    });

    const handleExportWord = async () => {
        if (!disbursementData || disbursementData.length === 0) {
            toast({ title: "No Data", description: "There is no data to export.", variant: 'destructive' });
            return;
        }
        const { headers, rows } = buildDisbursementExportRows();
        const { bodyRows, options } = buildDisbursementWordOptions(rows);
        await exportToWord(exportFileBase(), 'DISBURSEMENT REPORT', headers, bodyRows, options);
    };

    // Get center name for display, given a specific centerId (submitted snapshot,
    // not necessarily the live draft selection)
    const getCenterName = (centerId: string) => {
        if (centerId === 'all') return null;
        const center = centers.find(c => c.id === centerId);
        return center ? `${center.code} - ${center.name}` : centerId;
    };

    return (
        <ProtectedRoute requiredPermission="MIS_REPORTS">
            <div className="relative min-h-screen bg-gradient-to-br from-background via-purple-50/30 to-pink-50/30 dark:from-background dark:via-brand-green-darker dark:to-green-950">
                <div className="container mx-auto px-3 sm:px-6 py-4 sm:py-8">
                    {/* Header Section */}
                    <div className="mb-8">
                        <div className="flex items-center gap-4 mb-4">
                            <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-600 to-pink-600 shadow-lg shadow-purple-500/30">
                                <Wallet className="h-7 w-7 text-white" />
                                <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/20 to-transparent" />
                            </div>
                            <div className="flex-1">
                                <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-foreground dark:text-white">
                                    Disbursement Report
                                </h1>
                                <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                                    Comprehensive loan disbursement report with member and funder details
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Summary Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                        <Card className="border-2 border-purple-200/50 dark:border-purple-800/50 bg-gradient-to-br from-purple-50 to-pink-50/50 dark:from-purple-950/20 dark:to-pink-950/20">
                            <CardContent className="pt-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-purple-700 dark:text-purple-300">
                                            Total Disbursements
                                        </p>
                                        <p className="text-3xl font-bold text-purple-900 dark:text-purple-100 mt-2">
                                            {summary.totalDisbursements}
                                        </p>
                                        <p className="text-xs text-purple-600 dark:text-purple-400 mt-1">
                                            Loan accounts
                                        </p>
                                    </div>
                                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-100 dark:bg-purple-900/50">
                                        <Wallet className="h-6 w-6 text-purple-600 dark:text-purple-400" />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="border-2 border-pink-200/50 dark:border-pink-800/50 bg-gradient-to-br from-pink-50 to-rose-50/50 dark:from-pink-950/20 dark:to-rose-950/20">
                            <CardContent className="pt-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-pink-700 dark:text-pink-300">
                                            Total Amount
                                        </p>
                                        <p className="text-2xl font-bold text-pink-900 dark:text-pink-100 mt-2">
                                            ₹ {formatCurrency(summary.totalAmount)}
                                        </p>
                                        <p className="text-xs text-pink-600 dark:text-pink-400 mt-1">
                                            Disbursed amount
                                        </p>
                                    </div>
                                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-pink-100 dark:bg-pink-900/50">
                                        <IndianRupee className="h-6 w-6 text-pink-600 dark:text-pink-400" />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="border-2 border-primary/50 dark:border-primary/50 bg-gradient-to-br from-green-50 to-purple-50/50 dark:from-brand-green-darker/20 dark:to-purple-950/20">
                            <CardContent className="pt-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-primary dark:text-primary">
                                            Avg Loan Amount
                                        </p>
                                        <p className="text-2xl font-bold text-foreground dark:text-primary mt-2">
                                            ₹ {formatCurrency(summary.avgLoanAmount)}
                                        </p>
                                        <p className="text-xs text-primary dark:text-primary mt-1">
                                            Per disbursement
                                        </p>
                                    </div>
                                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 dark:bg-brand-green-darker/50">
                                        <TrendingUp className="h-6 w-6 text-primary dark:text-primary" />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="border-2 border-violet-200/50 dark:border-violet-800/50 bg-gradient-to-br from-violet-50 to-purple-50/50 dark:from-violet-950/20 dark:to-purple-950/20">
                            <CardContent className="pt-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-violet-700 dark:text-violet-300">
                                            Centers Covered
                                        </p>
                                        <p className="text-3xl font-bold text-violet-900 dark:text-violet-100 mt-2">
                                            {summary.uniqueCenters}
                                        </p>
                                        <p className="text-xs text-violet-600 dark:text-violet-400 mt-1">
                                            Unique centers
                                        </p>
                                    </div>
                                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-violet-100 dark:bg-violet-900/50">
                                        <Building2 className="h-6 w-6 text-violet-600 dark:text-violet-400" />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Filters Card */}
                    <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden mb-6">
                        <div className="h-1.5 bg-gradient-to-r from-purple-600 via-pink-600 to-rose-600" />
                        <CardHeader className="bg-gradient-to-r from-slate-50 via-purple-50/60 to-pink-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                                <div className="flex items-center gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-900/30">
                                        <Filter className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                                    </div>
                                    <div>
                                        <CardTitle className="text-xl">Report Parameters</CardTitle>
                                        <CardDescription>
                                            Select date range and center for disbursement report
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
                                            reportSlug={getReportExportMode('mis-disbursement') === 'REQUEST_QUEUE' ? 'mis-disbursement' : undefined}
                                            canExport={canExportReport('mis-disbursement')}
                                            exportParams={{
                                                fromDate: submittedFromDate,
                                                toDate: submittedToDate,
                                                branchIds: 'ALL',
                                                filters: submittedCenterId !== 'all' ? { centerId: submittedCenterId } : null,
                                            }}
                                            className="border-purple-300 text-purple-700 hover:bg-purple-50 dark:border-purple-700 dark:text-purple-300"
                                        />
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={handlePrint}
                                            className="border-primary/30 text-sidebar-accent hover:bg-green-50 dark:border-sidebar-accent dark:text-slate-300"
                                        >
                                            <Printer className="h-4 w-4 mr-2" />
                                            Print
                                        </Button>
                                    </div>
                                )}
                            </div>
                        </CardHeader>
                        <CardContent className="pt-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
                                {/* From Date */}
                                <div className="space-y-2">
                                    <Label htmlFor="fromDate" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        From Date <span className="text-red-500">*</span>
                                    </Label>
                                    <DateInput
                                        id="fromDate"
                                        value={fromDate}
                                        onChange={(e) => setFromDate(e.target.value)}
                                        className="h-11 border-primary/30 dark:border-sidebar-accent"
                                    />
                                </div>

                                {/* To Date */}
                                <div className="space-y-2">
                                    <Label htmlFor="toDate" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Till Date <span className="text-red-500">*</span>
                                    </Label>
                                    <DateInput
                                        id="toDate"
                                        value={toDate}
                                        onChange={(e) => setToDate(e.target.value)}
                                        className="h-11 border-primary/30 dark:border-sidebar-accent"
                                    />
                                </div>

                                {/* Center Filter */}
                                <div className="space-y-2">
                                    <Label htmlFor="centerFilter" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Center (Optional)
                                    </Label>
                                    <Select
                                        value={selectedCenterId}
                                        onValueChange={setSelectedCenterId}
                                        disabled={isLoadingCenters}
                                    >
                                        <SelectTrigger id="centerFilter" className="h-11 border-primary/30 dark:border-sidebar-accent">
                                            <SelectValue placeholder={isLoadingCenters ? "Loading centers..." : "All Centers"} />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="all">All Centers</SelectItem>
                                            {centers.map((center) => (
                                                <SelectItem key={center.id} value={center.id}>
                                                    {center.code} - {center.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    {centers.length === 0 && !isLoadingCenters && (
                                        <p className="text-xs text-amber-600 mt-1">No centers available</p>
                                    )}
                                </div>

                                {/* Show Button */}
                                <div className="space-y-2">
                                    <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-200 opacity-0">
                                        Action
                                    </Label>
                                    <Button
                                        onClick={handleShowReport}
                                        disabled={isLoading}
                                        className="h-11 w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white shadow-lg shadow-purple-500/30"
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

                    {/* Disbursement Report Table */}
                    {showReport && (
                        <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
                            <div className="h-1.5 bg-gradient-to-r from-purple-600 via-pink-600 to-rose-600" />

                            {/* Print-friendly content */}
                            <div ref={printRef} className="print:p-8">
                                {/* Report Header */}
                                <CardHeader className="bg-gradient-to-r from-slate-50 via-purple-50/60 to-pink-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker print:bg-white">
                                    <ReportHeader
                                        title="Disbursement Report"
                                        subtitle={`Period: ${formatDate(submittedFromDate)} to ${formatDate(submittedToDate)}${submittedCenterId !== 'all' ? `  •  Center: ${getCenterName(submittedCenterId)}` : ''}`}
                                    />
                                    <p className="text-xs text-slate-500 text-center -mt-2">
                                        Total Records: {disbursementData.length}
                                    </p>
                                </CardHeader>

                                <CardContent className="p-0">
                                    {disbursementData.length === 0 ? (
                                        <div className="text-center py-12">
                                            <p className="text-slate-500">No disbursement records found for the selected criteria.</p>
                                        </div>
                                    ) : (
                                        <div className="overflow-x-auto">
                                            <Table>
                                                <TableHeader>
                                                    <TableRow className="bg-gradient-to-r from-purple-700 to-pink-700 dark:from-purple-800 dark:to-pink-800 hover:from-purple-700 hover:to-pink-700">
                                                        <TableHead className="font-bold text-white text-xs">Branch ID</TableHead>
                                                        <TableHead className="font-bold text-white text-xs">Branch Name</TableHead>
                                                        <TableHead className="font-bold text-white text-xs">Disbursal Date</TableHead>
                                                        <TableHead className="font-bold text-white text-xs text-center">Center ID</TableHead>
                                                        <TableHead className="font-bold text-white text-xs">Center Name</TableHead>
                                                        <TableHead className="font-bold text-white text-xs">Member ID</TableHead>
                                                        <TableHead className="font-bold text-white text-xs">Member Name</TableHead>
                                                        <TableHead className="font-bold text-white text-xs">Funder</TableHead>
                                                        <TableHead className="font-bold text-white text-xs">Loan A/C No</TableHead>
                                                        <TableHead className="font-bold text-white text-xs text-right">Loan Amount</TableHead>
                                                        <TableHead className="font-bold text-white text-xs text-center">Total Dues</TableHead>
                                                        <TableHead className="font-bold text-white text-xs">Purpose</TableHead>
                                                        <TableHead className="font-bold text-white text-xs text-center">Emp ID</TableHead>
                                                        <TableHead className="font-bold text-white text-xs">FDO</TableHead>
                                                        <TableHead className="font-bold text-white text-xs">Due Start Date</TableHead>
                                                        <TableHead className="font-bold text-white text-xs text-center">Loan Sl No</TableHead>
                                                        <TableHead className="font-bold text-white text-xs">Phone</TableHead>
                                                        <TableHead className="font-bold text-white text-xs">Meeting Day</TableHead>
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {disbursementData.map((item, index) => (
                                                        <TableRow
                                                            key={index}
                                                            className={cn(
                                                                'transition-colors',
                                                                index % 2 === 0
                                                                    ? 'bg-white dark:bg-brand-green-darker hover:bg-purple-50 dark:hover:bg-purple-950/20'
                                                                    : 'bg-green-50/50 dark:bg-brand-green-darker/50 hover:bg-purple-50 dark:hover:bg-purple-950/20'
                                                            )}
                                                        >
                                                            <TableCell className="font-semibold text-purple-700 dark:text-purple-400">{item.branchId}</TableCell>
                                                            <TableCell className="font-semibold text-foreground dark:text-slate-100">{item.branchName}</TableCell>
                                                            <TableCell className="text-sm">{item.disbursalDate}</TableCell>
                                                            <TableCell className="text-center font-semibold text-sidebar-accent dark:text-primary">{item.centerId}</TableCell>
                                                            <TableCell className="font-medium text-sidebar-accent dark:text-slate-300">{item.centerName}</TableCell>
                                                            <TableCell className="font-mono text-xs text-primary dark:text-primary">{item.memberId}</TableCell>
                                                            <TableCell className="font-semibold text-foreground dark:text-slate-100">{item.memberName}</TableCell>
                                                            <TableCell className="font-medium text-teal-700 dark:text-teal-400">{item.funder}</TableCell>
                                                            <TableCell className="font-mono text-xs text-cyan-700 dark:text-cyan-400">{item.loanAccountNo}</TableCell>
                                                            <TableCell className="text-right font-bold text-pink-700 dark:text-pink-400">{formatCurrency(item.loanAmount)}</TableCell>
                                                            <TableCell className="text-center font-semibold text-orange-700 dark:text-orange-400">{formatCurrency(item.totalDues)}</TableCell>
                                                            <TableCell className="text-sm text-sidebar-accent dark:text-slate-300">{item.purpose}</TableCell>
                                                            <TableCell className="text-center font-semibold text-violet-700 dark:text-violet-400">{item.empId}</TableCell>
                                                            <TableCell className="font-medium text-sidebar-accent dark:text-slate-300">{item.fdo}</TableCell>
                                                            <TableCell className="text-sm">{item.dueStartDate}</TableCell>
                                                            <TableCell className="text-center font-semibold text-purple-700 dark:text-purple-400">{item.loanSlNo}</TableCell>
                                                            <TableCell className="font-mono text-xs text-sidebar-accent dark:text-slate-300">{item.phone}</TableCell>
                                                            <TableCell className="font-medium text-sidebar-accent dark:text-slate-300">{item.meetingDay}</TableCell>
                                                        </TableRow>
                                                    ))}
                                                </TableBody>
                                            </Table>
                                        </div>
                                    )}
                                </CardContent>
                            </div>
                        </Card>
                    )}

                    {/* Footer Info */}
                    {showReport && disbursementData.length > 0 && (
                        <div className="mt-6 flex items-center justify-between text-sm text-sidebar-accent dark:text-slate-400 print:hidden">
                            <p>
                                Report generated on {toDisplayDateTime(new Date())}
                            </p>
                            <p>
                                Total Records: <span className="font-semibold text-purple-700 dark:text-purple-400">
                                    {disbursementData.length}
                                </span>
                            </p>
                        </div>
                    )}
                </div>
            </div>

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
        </ProtectedRoute>
    );
}
