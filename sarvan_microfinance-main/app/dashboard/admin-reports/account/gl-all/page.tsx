'use client';

import { useState, useRef, useEffect } from 'react';
import * as XLSX from 'xlsx-js-style';
import jsPDF from 'jspdf';
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
    BookOpenCheck,
    Download,
    FileText,
    FileType,
    FileOutput,
    Printer,
    IndianRupee,
    RefreshCw,
    Filter,
    TrendingUp,
    Wallet,
    ChevronDown,
    ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { useToast } from '@/hooks/use-toast';
import { usePermission } from '@/app/hooks/usePermission';
import { useReactToPrint } from 'react-to-print';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { drawGlAllReport } from '@/app/lib/reports/gl-all-pdf';
import { buildReportSheet, autoSizeColumns, applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { exportToCSV, exportToWord, type WordExportOptions } from '@/app/lib/report-export-utils';
import { formatReportAmount } from '@/app/lib/utils/format-amount';
import { DateInput } from '@/components/ui/date-input';
import { toDisplayDate } from '@/app/lib/date-format';

// Report Types
const REPORT_TYPES = [
    { id: 'head_office', name: 'HEAD OFFICE' },
    { id: 'consolidated', name: 'CONSOLIDATED' },
];

// Interfaces
interface Transaction {
    date: string;
    type: string;
    particulars: string;
    debit: number;
    credit: number;
    voucherNo: string;
}

interface GLAccount {
    id: string;
    name: string;
    type: 'LEDGER' | 'SELF';
    openingBalance: number;
    closingBalance: number;
    transactions: Transaction[];
}

// Format currency — whole rupees, no decimals (report/export amount-format requirement).
const formatCurrency = (amount: number) => `₹${formatReportAmount(amount)}`;

// Format date
const formatDate = (dateString: string) => {
    if (!dateString) return '';
    return toDisplayDate(new Date(dateString));
};

export default function GLAllPage() {
    const { toast } = useToast();
    const { canExportReport, getReportExportMode } = usePermission();
    const [reportType, setReportType] = useState('head_office');
    const [fromDate, setFromDate] = useState<string>(
        new Date().toISOString().split('T')[0]
    );
    const [toDate, setToDate] = useState<string>(
        new Date().toISOString().split('T')[0]
    );
    // Submitted (applied) date snapshot — frozen until the next "Show Report" click.
    // Export/print filenames, the on-screen subtitle, and exportParams read this, not the
    // live draft from/toDate, so editing the date inputs alone never changes what's shown.
    const [submittedFromDate, setSubmittedFromDate] = useState(fromDate);
    const [submittedToDate, setSubmittedToDate] = useState(toDate);
    const [data, setData] = useState<GLAccount[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set());
    const printRef = useRef<HTMLDivElement>(null);

    // Fetch Data
    const generateReport = async () => {
        setIsLoading(true);
        try {
            const queryParams = new URLSearchParams({
                type: reportType,
                startDate: fromDate,
                endDate: toDate,
            });

            const response = await fetch(`/api/reports/gl-all?${queryParams}`);
            const result = await response.json();

            if (result.success && Array.isArray(result.data)) {
                setData(result.data);
                setSubmittedFromDate(fromDate);
                setSubmittedToDate(toDate);
                toast({
                    title: "Report Generated",
                    description: `Successfully loaded ${result.data.length} accounts.`,
                });
            } else {
                setData([]);
                toast({
                    title: "Error",
                    description: result.message || "Failed to fetch report data.",
                    variant: "destructive",
                });
            }
        } catch (error) {
            console.error("Error generating report:", error);
            toast({
                title: "Error",
                description: "An unexpected error occurred.",
                variant: "destructive",
            });
        } finally {
            setIsLoading(false);
        }
    };

    // Initial Load - Removed to require user action
    // useEffect(() => {
    //    generateReport();
    // }, []);

    // Calculate Totals
    const totalOpeningParams = data.reduce((acc, curr) => ({
        debit: acc.debit + (curr.openingBalance > 0 ? curr.openingBalance : 0),
        credit: acc.credit + (curr.openingBalance < 0 ? Math.abs(curr.openingBalance) : 0)
    }), { debit: 0, credit: 0 });

    const totalClosingParams = data.reduce((acc, curr) => ({
        debit: acc.debit + (curr.closingBalance > 0 ? curr.closingBalance : 0),
        credit: acc.credit + (curr.closingBalance < 0 ? Math.abs(curr.closingBalance) : 0)
    }), { debit: 0, credit: 0 });

    // Handle Print
    const handlePrint = useReactToPrint({
        contentRef: printRef,
        documentTitle: `GL_Report_${submittedFromDate}_to_${submittedToDate}`,
    });

    const toggleAccount = (accountId: string) => {
        const newExpanded = new Set(expandedAccounts);
        if (newExpanded.has(accountId)) {
            newExpanded.delete(accountId);
        } else {
            newExpanded.add(accountId);
        }
        setExpandedAccounts(newExpanded);
    };

    // Excel Export
    const handleExportExcel = () => {
        if (!data.length) return;

        const excelData: any[] = [];

        data.forEach(acc => {
            // Account Header
            excelData.push({
                'Date': `Account: ${acc.name}`,
                'Voucher Type': '',
                'Voucher No': '',
                'Particulars': '',
                'Debit': '',
                'Credit': ''
            });

            // Opening Balance
            excelData.push({
                'Date': '',
                'Voucher Type': '',
                'Voucher No': '',
                'Particulars': 'Opening Balance',
                'Debit': acc.openingBalance > 0 ? acc.openingBalance : '',
                'Credit': acc.openingBalance < 0 ? Math.abs(acc.openingBalance) : ''
            });

            // Transactions
            acc.transactions.forEach(tx => {
                excelData.push({
                    'Date': tx.date,
                    'Voucher Type': tx.type,
                    'Voucher No': tx.voucherNo,
                    'Particulars': tx.particulars,
                    'Debit': tx.debit > 0 ? tx.debit : '',
                    'Credit': tx.credit > 0 ? tx.credit : ''
                });
            });

            // Closing Balance
            excelData.push({
                'Date': '',
                'Voucher Type': '',
                'Voucher No': '',
                'Particulars': 'Closing Balance',
                'Debit': acc.closingBalance > 0 ? acc.closingBalance : '',
                'Credit': acc.closingBalance < 0 ? Math.abs(acc.closingBalance) : ''
            });

            // Spacer
            excelData.push({});
        });

        const ws = buildReportSheet("General Ledger Report", excelData);
        autoSizeColumns(ws);
        applyExcelReportFont(ws);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "General Ledger");
        XLSX.writeFile(wb, `GL_Report_${submittedFromDate}_${submittedToDate}.xlsx`);
    };

    // PDF Export — drawing logic lives in gl-all-pdf.ts, shared with the Request
    // Report queue's PDF renderer (see gl-all-pdf-queue.ts) so both produce the
    // same structure.
    const handleExportPDF = async () => {
        if (!data.length) return;
        const doc = new jsPDF({ orientation: 'landscape' });
        const reportFont = await ensureReportFont(doc);

        await drawGlAllReport(
            doc,
            data,
            {
                reportTypeLabel: REPORT_TYPES.find(t => t.id === reportType)?.name as string,
                periodLabel: `Period: ${formatDate(submittedFromDate)} to ${formatDate(submittedToDate)}`,
            },
            reportFont
        );

        doc.save(`GL_Report_${submittedFromDate}_${submittedToDate}.pdf`);
    };

    // Mirrors the same field mapping used by handleExportExcel above (kept separate so
    // handleExportExcel is left untouched).
    const buildGLAllExportRows = (): { headers: string[]; rows: (string | number)[][] } => {
        const headers = ['Date', 'Voucher Type', 'Voucher No', 'Particulars', 'Debit', 'Credit'];
        const rows: (string | number)[][] = [];

        data.forEach(acc => {
            rows.push([`Account: ${acc.name}`, '', '', '', '', '']);
            rows.push(['', '', '', 'Opening Balance', acc.openingBalance > 0 ? acc.openingBalance : '', acc.openingBalance < 0 ? Math.abs(acc.openingBalance) : '']);

            acc.transactions.forEach(tx => {
                rows.push([tx.date, tx.type, tx.voucherNo, tx.particulars, tx.debit > 0 ? tx.debit : '', tx.credit > 0 ? tx.credit : '']);
            });

            rows.push(['', '', '', 'Closing Balance', acc.closingBalance > 0 ? acc.closingBalance : '', acc.closingBalance < 0 ? Math.abs(acc.closingBalance) : '']);
            rows.push(['', '', '', '', '', '']);
        });

        return { headers, rows };
    };

    const handleExportCSV = () => {
        if (!data.length) return;
        const { headers, rows } = buildGLAllExportRows();
        exportToCSV(`GL_Report_${submittedFromDate}_${submittedToDate}`, 'GENERAL LEDGER REPORT', headers, rows);
    };

    // Word-only presentation: same rows as CSV above. This report repeats an
    // Account/Opening Balance/transactions/Closing Balance block per account, so there
    // is no single trailing grand-total row to distinguish — just professional
    // header/zebra/alignment/width styling on the flat 6 columns.
    const wordOptions: WordExportOptions = {
        columnAlignments: ['left', 'left', 'center', 'left', 'right', 'right'],
        columnWidthWeights: [10, 10, 8, 16, 9, 9],
    };

    const handleExportWord = async () => {
        if (!data.length) return;
        const { headers, rows } = buildGLAllExportRows();
        await exportToWord(`GL_Report_${submittedFromDate}_${submittedToDate}`, 'GENERAL LEDGER REPORT', headers, rows, wordOptions);
    };

    return (
        <ProtectedRoute>
            <div className="relative min-h-screen bg-gradient-to-br from-background via-violet-50/30 to-purple-50/30 dark:from-background dark:via-brand-green-darker dark:to-green-950">
                <div className="container mx-auto px-3 sm:px-6 py-4 sm:py-8">
                    {/* Header Section */}
                    <div className="mb-8">
                        <div className="flex items-center gap-4 mb-4">
                            <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600 to-purple-600 shadow-lg shadow-violet-500/30">
                                <BookOpenCheck className="h-7 w-7 text-white" />
                                <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/20 to-transparent" />
                            </div>
                            <div className="flex-1">
                                <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-foreground dark:text-white">
                                    General Ledger - All Accounts
                                </h1>
                                <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                                    Complete general ledger showing all account balances and transactions
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Summary Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                        <Card className="border-2 border-primary/30/50 dark:border-sidebar-accent/50 bg-gradient-to-br from-green-50 to-cyan-50/50 dark:from-brand-green-darker/20 dark:to-cyan-950/20">
                            <CardContent className="pt-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-sidebar-accent dark:text-green-300">
                                            Total Accounts
                                        </p>
                                        <p className="text-3xl font-bold text-foreground dark:text-green-100 mt-2">
                                            {data.length}
                                        </p>
                                        <p className="text-xs text-primary dark:text-primary mt-1">
                                            Active ledger accounts
                                        </p>
                                    </div>
                                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-green-tint dark:bg-brand-green-darker/50">
                                        <Wallet className="h-6 w-6 text-primary dark:text-primary" />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="border-2 border-green-200/50 dark:border-green-800/50 bg-gradient-to-br from-green-50 to-emerald-50/50 dark:from-green-950/20 dark:to-emerald-950/20">
                            <CardContent className="pt-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-green-700 dark:text-green-300">
                                            Total Closing Debit
                                        </p>
                                        <p className="text-2xl font-bold text-green-900 dark:text-green-100 mt-2">
                                            {formatCurrency(totalClosingParams.debit)}
                                        </p>
                                    </div>
                                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-green-100 dark:bg-green-900/50">
                                        <IndianRupee className="h-6 w-6 text-green-600 dark:text-green-400" />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="border-2 border-purple-200/50 dark:border-purple-800/50 bg-gradient-to-br from-purple-50 to-pink-50/50 dark:from-purple-950/20 dark:to-pink-950/20">
                            <CardContent className="pt-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-purple-700 dark:text-purple-300">
                                            Total Closing Credit
                                        </p>
                                        <p className="text-2xl font-bold text-purple-900 dark:text-purple-100 mt-2">
                                            {formatCurrency(totalClosingParams.credit)}
                                        </p>
                                    </div>
                                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-100 dark:bg-purple-900/50">
                                        <TrendingUp className="h-6 w-6 text-purple-600 dark:text-purple-400" />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className={cn(
                            "border-2 bg-gradient-to-br dark:from-violet-950/20 dark:to-purple-950/20",
                            Math.abs(totalClosingParams.debit - totalClosingParams.credit) < 1 ? "border-green-200/50 from-green-50 to-emerald-50/50" : "border-red-200/50 from-red-50 to-orange-50/50"
                        )}>
                            <CardContent className="pt-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-violet-700 dark:text-violet-300">
                                            Status
                                        </p>
                                        <p className="text-xl font-bold mt-2 text-foreground dark:text-white">
                                            {Math.abs(totalClosingParams.debit - totalClosingParams.credit) < 1 ? "Balanced" : "Unbalanced"}
                                        </p>
                                        <p className="text-xs mt-1 text-sidebar-accent">
                                            Diff: {formatCurrency(Math.abs(totalClosingParams.debit - totalClosingParams.credit))}
                                        </p>
                                    </div>
                                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-violet-100 dark:bg-violet-900/50">
                                        <BookOpenCheck className="h-6 w-6 text-violet-600 dark:text-violet-400" />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Filters Card */}
                    <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden mb-6">
                        <div className="h-1.5 bg-gradient-to-r from-violet-600 via-purple-600 to-fuchsia-600" />
                        <CardHeader className="bg-gradient-to-r from-slate-50 via-violet-50/60 to-purple-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                                <div className="flex items-center gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-900/30">
                                        <Filter className="h-5 w-5 text-violet-600 dark:text-violet-400" />
                                    </div>
                                    <div>
                                        <CardTitle className="text-xl">Report Parameters</CardTitle>
                                        <CardDescription>
                                            Select report type and date range
                                        </CardDescription>
                                    </div>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <ExportDropdown
                                        onExportPDF={handleExportPDF}
                                        onExportExcel={handleExportExcel}
                                        onExportCSV={handleExportCSV}
                                        onExportWord={handleExportWord}
                                        // Queue mode only supports the consolidated (all-branch) view — the
                                        // resolved Head Office branch id isn't known client-side, so 'head_office'
                                        // stays on direct download rather than risk mis-routing it as consolidated.
                                        reportSlug={reportType === 'consolidated' && getReportExportMode('gl-all') === 'REQUEST_QUEUE' ? 'gl-all' : undefined}
                                        canExport={canExportReport('gl-all')}
                                        exportParams={{
                                            fromDate: submittedFromDate,
                                            toDate: submittedToDate,
                                            branchIds: 'ALL',
                                        }}
                                        className="border-green-300 text-green-700 hover:bg-green-50 dark:border-green-700 dark:text-green-300"
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
                            </div>
                        </CardHeader>
                        <CardContent className="pt-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                                {/* Report Type */}
                                <div className="space-y-2">
                                    <Label htmlFor="reportType" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Report Type <span className="text-red-500">*</span>
                                    </Label>
                                    <Select value={reportType} onValueChange={setReportType}>
                                        <SelectTrigger id="reportType" className="h-11 border-primary/30 dark:border-sidebar-accent">
                                            <SelectValue placeholder="Select type" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {REPORT_TYPES.map((type) => (
                                                <SelectItem key={type.id} value={type.id}>
                                                    {type.name}
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

                                {/* Generate Button */}
                                <div className="space-y-2">
                                    <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-200 opacity-0">
                                        Action
                                    </Label>
                                    <Button
                                        onClick={generateReport}
                                        disabled={isLoading}
                                        className="h-11 w-full bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white shadow-lg shadow-violet-500/30"
                                    >
                                        {isLoading ? (
                                            <>
                                                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                                                Generating...
                                            </>
                                        ) : (
                                            <>
                                                <BookOpenCheck className="h-4 w-4 mr-2" />
                                                Show Report
                                            </>
                                        )}
                                    </Button>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* GL All Report Card */}
                    <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
                        <div className="h-1.5 bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600" />

                        {/* Print-friendly content */}
                        <div ref={printRef} className="print:p-8">
                            {/* Report Header */}
                            <CardHeader className="bg-gradient-to-r from-slate-50 via-violet-50/60 to-purple-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker print:bg-white text-center">
                                <ReportHeader
                                    title={`GENERAL LEDGER REPORT (${REPORT_TYPES.find(t => t.id === reportType)?.name || 'HEAD OFFICE'})`}
                                    subtitle={`${formatDate(submittedFromDate)} TO ${formatDate(submittedToDate)}`}
                                />
                            </CardHeader>

                            <CardContent className="p-0">
                                <div className="overflow-x-auto">
                                    {data.map((account, accountIndex) => (
                                        <div key={account.id} className="border-b border-primary/20 dark:border-sidebar-accent">
                                            {/* Account Header - Clickable */}
                                            <div
                                                onClick={() => toggleAccount(account.id)}
                                                className="cursor-pointer hover:bg-violet-50 dark:hover:bg-violet-950/20 transition-colors"
                                            >
                                                <Table>
                                                    <TableHeader>
                                                        <TableRow className="bg-violet-100 dark:bg-violet-900/30 hover:bg-violet-100 dark:hover:bg-violet-900/30">
                                                            <TableHead className="font-bold text-violet-900 dark:text-violet-100 w-48">
                                                                <div className="flex items-center gap-2">
                                                                    {expandedAccounts.has(account.id) ? (
                                                                        <ChevronDown className="h-4 w-4" />
                                                                    ) : (
                                                                        <ChevronRight className="h-4 w-4" />
                                                                    )}
                                                                    Account Name
                                                                </div>
                                                            </TableHead>
                                                            <TableHead className="font-bold text-violet-900 dark:text-violet-100">
                                                                <span className="text-purple-700 dark:text-purple-300 text-lg">{account.name}</span>
                                                            </TableHead>
                                                            <TableHead className="text-right font-bold text-sidebar-accent dark:text-slate-300 w-40">Closing Balance</TableHead>
                                                            <TableHead className={cn(
                                                                "text-right font-bold w-40",
                                                                account.closingBalance >= 0 ? "text-green-700" : "text-red-700"
                                                            )}>
                                                                {formatCurrency(Math.abs(account.closingBalance))} {account.closingBalance >= 0 ? "Dr" : "Cr"}
                                                            </TableHead>
                                                        </TableRow>
                                                    </TableHeader>
                                                </Table>
                                            </div>

                                            {/* Account Transactions - Expandable */}
                                            {expandedAccounts.has(account.id) && (
                                                <div className="bg-green-50/50 p-2">
                                                    <Table>
                                                        <TableHeader>
                                                            <TableRow className="bg-brand-green-tint/50">
                                                                <TableHead className="w-32">Date</TableHead>
                                                                <TableHead className="w-24">Vch Type</TableHead>
                                                                <TableHead className="w-32">Vch No</TableHead>
                                                                <TableHead>Particulars</TableHead>
                                                                <TableHead className="text-right w-32">Debit</TableHead>
                                                                <TableHead className="text-right w-32">Credit</TableHead>
                                                            </TableRow>
                                                        </TableHeader>
                                                        <TableBody>
                                                            {/* Opening Balance Row */}
                                                            <TableRow className="bg-green-50/50 font-medium text-foreground">
                                                                <TableCell></TableCell>
                                                                <TableCell></TableCell>
                                                                <TableCell></TableCell>
                                                                <TableCell>Opening Balance</TableCell>
                                                                <TableCell className="text-right">
                                                                    {account.openingBalance > 0 ? formatCurrency(account.openingBalance) : '-'}
                                                                </TableCell>
                                                                <TableCell className="text-right">
                                                                    {account.openingBalance < 0 ? formatCurrency(Math.abs(account.openingBalance)) : '-'}
                                                                </TableCell>
                                                            </TableRow>

                                                            {/* Transactions */}
                                                            {account.transactions.length === 0 ? (
                                                                <TableRow>
                                                                    <TableCell colSpan={6} className="text-center text-slate-400 py-4">
                                                                        No transactions in this period
                                                                    </TableCell>
                                                                </TableRow>
                                                            ) : (
                                                                account.transactions.map((transaction, txIndex) => (
                                                                    <TableRow key={txIndex} className="hover:bg-white">
                                                                        <TableCell>{transaction.date}</TableCell>
                                                                        <TableCell>{transaction.type}</TableCell>
                                                                        <TableCell>{transaction.voucherNo}</TableCell>
                                                                        <TableCell>{transaction.particulars}</TableCell>
                                                                        <TableCell className="text-right text-green-700">
                                                                            {transaction.debit > 0 ? formatCurrency(transaction.debit) : '-'}
                                                                        </TableCell>
                                                                        <TableCell className="text-right text-red-700">
                                                                            {transaction.credit > 0 ? formatCurrency(transaction.credit) : '-'}
                                                                        </TableCell>
                                                                    </TableRow>
                                                                ))
                                                            )}

                                                            {/* Closing Balance Row */}
                                                            <TableRow className="bg-purple-50/50 font-bold border-t-2 border-purple-200">
                                                                <TableCell colSpan={4} className="text-right pr-4 text-purple-900">
                                                                    Closing Balance
                                                                </TableCell>
                                                                <TableCell className="text-right text-purple-900">
                                                                    {account.closingBalance > 0 ? formatCurrency(account.closingBalance) : '-'}
                                                                </TableCell>
                                                                <TableCell className="text-right text-purple-900">
                                                                    {account.closingBalance < 0 ? formatCurrency(Math.abs(account.closingBalance)) : '-'}
                                                                </TableCell>
                                                            </TableRow>
                                                        </TableBody>
                                                    </Table>
                                                </div>
                                            )}
                                        </div>
                                    ))}

                                    {data.length === 0 && !isLoading && (
                                        <div className="p-12 text-center text-slate-500">
                                            No data found for the selected period.
                                        </div>
                                    )}
                                </div>
                            </CardContent>
                        </div>
                    </Card>
                </div>
            </div>
            <style jsx global>{`
                /* No global print hide - handled by react-to-print contentRef */
            `}</style>
        </ProtectedRoute>
    );
}
