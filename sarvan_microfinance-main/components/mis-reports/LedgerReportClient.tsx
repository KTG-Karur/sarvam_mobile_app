'use client';

import { useState, useRef, useEffect } from 'react';
import { flushSync } from 'react-dom';
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
    RefreshCw,
    Filter,
    IndianRupee,
    TrendingUp,
    TrendingDown,
    Calendar,
    BookOpen,
    ArrowUpDown,
    Search,
    ChevronDown,
    Printer,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { useReactToPrint } from 'react-to-print';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { usePermission } from '@/app/hooks/usePermission';
import jsPDF from 'jspdf';
import * as XLSX from 'xlsx-js-style';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { drawMisLedgerReport } from '@/app/lib/reports/mis-ledger-report-pdf';
import { reportHeaderRows, autoSizeColumns, applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { formatReportAmount, truncateReportAmount } from '@/app/lib/utils/format-amount';
import { exportToCSV, exportToWord, type WordExportOptions } from '@/app/lib/report-export-utils';
import { DateInput } from '@/components/ui/date-input';

type ReportType = 'RANGE' | 'AS_ON';
type ViewType = 'CONDENSED' | 'DETAILED';

// Row shape matches the API response from /api/reports/ledger-report
type LedgerRow = {
    voucherDate: string;
    branchName: string;
    particulars: string;
    narration: string;
    voucherType: string;
    voucherTypeLabel: string;
    voucherNo: string;
    debit: number;
    credit: number;
    balance: number;
    balanceType: 'Dr' | 'Cr';
    referenceNo: string;
    referenceDate: string | null;
};

type LedgerReportResponse = {
    ledgerName: string;
    openingBalance: number;
    openingBalanceType: 'Dr' | 'Cr';
    rows: LedgerRow[];
    totalDebit: number;
    totalCredit: number;
    closingBalance: number;
    closingBalanceType: 'Dr' | 'Cr';
};

// Format currency (whole rupees, truncated — not rounded)
const formatCurrency = (amount: number) => formatReportAmount(Math.abs(amount || 0));

// Format date (accepts YYYY-MM-DD or a full ISO timestamp) to DD/MM/YYYY for display
const formatDateForDisplay = (dateString: string | null | undefined) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
};

export function LedgerReportClient() {
    const { canExportReport, getReportExportMode } = usePermission();
    const [ledgers, setLedgers] = useState<{ id: string; ledgerName: string }[]>([]);
    const [selectedLedger, setSelectedLedger] = useState<string>('');
    const [searchQuery, setSearchQuery] = useState('');
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);

    const [reportType, setReportType] = useState<ReportType>('RANGE');
    const [fromDate, setFromDate] = useState<string>(
        new Date().toISOString().split('T')[0]
    );
    const [tillDate, setTillDate] = useState<string>(
        new Date().toISOString().split('T')[0]
    );
    const [asOnDate, setAsOnDate] = useState<string>(
        new Date().toISOString().split('T')[0]
    );

    // Snapshot of reportType/fromDate/tillDate/asOnDate as of the last "Show" click —
    // these four travel together as one unit. Used for export filenames, PDF/Word
    // subtitles, and on-screen date labels so a draft edit (without clicking Show)
    // never changes what's displayed/exported.
    const [submittedReportType, setSubmittedReportType] = useState<ReportType>(reportType);
    const [submittedFromDate, setSubmittedFromDate] = useState<string>(fromDate);
    const [submittedTillDate, setSubmittedTillDate] = useState<string>(tillDate);
    const [submittedAsOnDate, setSubmittedAsOnDate] = useState<string>(asOnDate);

    const [branches, setBranches] = useState<{ id: string; name: string; code: string }[]>([]);
    const [selectedBranchId, setSelectedBranchId] = useState<string>('all');

    const [viewType, setViewType] = useState<ViewType>('CONDENSED');

    const [isLoading, setIsLoading] = useState(false);
    const [isFetchingLedgers, setIsFetchingLedgers] = useState(true);
    const [showReport, setShowReport] = useState(false);
    const [data, setData] = useState<LedgerReportResponse | null>(null);

    // Client-side pagination for the results table. Exports and print always use the full
    // dataset (isPrinting flips the table to render every row while react-to-print runs).
    const ROWS_PER_PAGE_OPTIONS = [10, 25, 50, 100];
    const [currentPage, setCurrentPage] = useState(1);
    const [rowsPerPage, setRowsPerPage] = useState(25);
    const [isPrinting, setIsPrinting] = useState(false);

    const printRef = useRef<HTMLDivElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const { toast } = useToast();

    // Fetch Ledgers on Mount
    useEffect(() => {
        const fetchLedgers = async () => {
            try {
                // Ledgers + Self Accounts (Cash in Hand / Bank / named bank a/cs) — both are
                // reportable in the Ledger Report; the backend resolves either id kind.
                const [ledgersRes, selfRes] = await Promise.all([
                    fetch('/api/accounts/ledgers'),
                    fetch('/api/accounts/self'),
                ]);
                const ledgersJson = await ledgersRes.json();
                const selfJson = await selfRes.json();
                const options: { id: string; ledgerName: string }[] = [
                    ...(ledgersJson.success && Array.isArray(ledgersJson.data)
                        ? (ledgersJson.data as { id: string; ledgerName: string }[]).map((l) => ({ id: l.id, ledgerName: l.ledgerName }))
                        : []),
                    ...(selfJson.success && Array.isArray(selfJson.data)
                        ? (selfJson.data as { id: string; name: string }[]).map((s) => ({ id: s.id, ledgerName: s.name }))
                        : []),
                ].sort((a, b) => a.ledgerName.localeCompare(b.ledgerName));
                setLedgers(options);
            } catch (error) {
                console.error("Failed to fetch ledgers:", error);
                toast({
                    title: 'Error formatting ledgers',
                    description: 'Could not fetch ledger options. Refresh page.',
                    variant: 'destructive',
                });
            } finally {
                setIsFetchingLedgers(false);
            }
        };

        fetchLedgers();
    }, [toast]);

    // Fetch Branches on Mount
    useEffect(() => {
        const fetchBranches = async () => {
            try {
                const response = await fetch('/api/branches');
                const result = await response.json();
                const list = Array.isArray(result?.data) ? result.data : Array.isArray(result) ? result : [];
                setBranches(list);
            } catch (error) {
                console.error("Failed to fetch branches:", error);
            }
        };

        fetchBranches();
    }, []);

    // Handle clicks outside the dropdown to close it
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsDropdownOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [dropdownRef]);

    const filteredLedgers = ledgers.filter(ledger =>
        ledger.ledgerName.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const handlePrint = useReactToPrint({
        contentRef: printRef,
        documentTitle: `LedgerReport_${selectedLedger}`,
        // Render every row (not just the current page) for the printed copy.
        onBeforePrint: () => {
            flushSync(() => setIsPrinting(true));
            return Promise.resolve();
        },
        onAfterPrint: () => setIsPrinting(false),
    });

    // Derived pagination view over the current report rows.
    const allRows = data?.rows ?? [];
    const totalPages = Math.max(1, Math.ceil(allRows.length / rowsPerPage));
    const safePage = Math.min(currentPage, totalPages);
    const pageRows = isPrinting
        ? allRows
        : allRows.slice((safePage - 1) * rowsPerPage, safePage * rowsPerPage);
    const rowOffset = isPrinting ? 0 : (safePage - 1) * rowsPerPage;
    const showOpeningRow = isPrinting || safePage === 1;
    const showClosingRows = isPrinting || safePage >= totalPages || allRows.length === 0;

    const handleShowReport = async () => {
        if (!selectedLedger) {
            toast({
                title: 'Ledger selection required',
                description: 'Please select a ledger before generating the report.',
                variant: 'destructive',
            });
            return;
        }

        if (reportType === 'RANGE') {
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
        } else if (!asOnDate) {
            toast({
                title: 'Date required',
                description: 'Please select an As On Date before generating the report.',
                variant: 'destructive',
            });
            return;
        }

        setIsLoading(true);
        try {
            const url = new URL('/api/reports/ledger-report', window.location.origin);
            url.searchParams.append('ledgerId', selectedLedger);
            url.searchParams.append('reportType', reportType);
            if (reportType === 'RANGE') {
                url.searchParams.append('fromDate', fromDate);
                url.searchParams.append('toDate', tillDate);
            } else {
                url.searchParams.append('asOnDate', asOnDate);
            }
            url.searchParams.append('branchId', selectedBranchId);
            url.searchParams.append('viewType', viewType);

            const response = await fetch(url.toString());
            const result = await response.json();

            if (!response.ok || !result.success) {
                throw new Error(result.error || 'Failed to fetch data');
            }

            setData(result.data as LedgerReportResponse);
            setCurrentPage(1);
            setSubmittedReportType(reportType);
            setSubmittedFromDate(fromDate);
            setSubmittedTillDate(tillDate);
            setSubmittedAsOnDate(asOnDate);
            setShowReport(true);
            toast({
                title: 'Report generated',
                description: 'Ledger Report loaded successfully.',
            });
        } catch (error: any) {
            console.error('Fetch error:', error);
            toast({
                title: 'Error',
                description: error.message || 'Failed to load report data.',
                variant: 'destructive',
            });
            setData(null);
            setShowReport(false);
        } finally {
            setIsLoading(false);
        }
    };

    const handleReset = () => {
        setSelectedLedger('');
        setSearchQuery('');
        setReportType('RANGE');
        setFromDate(new Date().toISOString().split('T')[0]);
        setTillDate(new Date().toISOString().split('T')[0]);
        setAsOnDate(new Date().toISOString().split('T')[0]);
        setSelectedBranchId('all');
        setViewType('CONDENSED');
        setSubmittedReportType('RANGE');
        setSubmittedFromDate(new Date().toISOString().split('T')[0]);
        setSubmittedTillDate(new Date().toISOString().split('T')[0]);
        setSubmittedAsOnDate(new Date().toISOString().split('T')[0]);
        setShowReport(false);
        setData(null);
        setCurrentPage(1);
    };

    // Shared row-builder for every export target (Excel/PDF/CSV/Word/Print) so the
    // exported columns always match whatever View Type is on screen.
    const buildLedgerExportRows = (): { headers: string[]; rows: (string | number)[][] } => {
        const rowsData = data?.rows ?? [];
        const headers = viewType === 'CONDENSED'
            ? ['S.No', 'Voucher Date', 'Branch Name', 'Particulars', 'Narration', 'Voucher No.', 'Debit', 'Credit', 'Balance', 'Dr/Cr']
            : ['S.No', 'Voucher Date', 'Branch Name', 'Particulars', 'Voucher Type', 'Voucher No.', 'Debit', 'Credit', 'Balance', 'Dr/Cr'];

        const rows: (string | number)[][] = [];

        rows.push(['', '', '', 'OPENING BALANCE:', '', '', '', '', data ? truncateReportAmount(data.openingBalance) : 0, data?.openingBalanceType || 'Dr']);

        rowsData.forEach((r, i) => {
            rows.push(viewType === 'CONDENSED'
                ? [i + 1, formatDateForDisplay(r.voucherDate), r.branchName, r.particulars, r.narration || '', r.voucherNo, r.debit ? truncateReportAmount(r.debit) : 0, r.credit ? truncateReportAmount(r.credit) : 0, truncateReportAmount(r.balance), r.balanceType]
                : [i + 1, formatDateForDisplay(r.voucherDate), r.branchName, r.particulars, r.voucherTypeLabel, r.voucherNo, r.debit ? truncateReportAmount(r.debit) : 0, r.credit ? truncateReportAmount(r.credit) : 0, truncateReportAmount(r.balance), r.balanceType]);
        });

        rows.push(['', '', '', 'TOTAL:', '', '', truncateReportAmount(data?.totalDebit || 0), truncateReportAmount(data?.totalCredit || 0), '', '']);
        const endDateLabel = formatDateForDisplay(submittedReportType === 'RANGE' ? submittedTillDate : submittedAsOnDate);
        rows.push(['', '', '', `END DATE: ${endDateLabel} — CLOSING BALANCE:`, '', '', '', '', data ? truncateReportAmount(data.closingBalance) : 0, data?.closingBalanceType || 'Dr']);

        return { headers, rows };
    };

    const handleExport = () => {
        if (!data || data.rows.length === 0) {
            toast({
                title: "No Data",
                description: "There is no data to export.",
                variant: 'destructive',
            });
            return;
        }

        const endDate = submittedReportType === 'RANGE' ? submittedTillDate : submittedAsOnDate;
        const startLabel = submittedReportType === 'RANGE' ? formatDateForDisplay(submittedFromDate).replace(/\//g, '-') : 'Inception';
        const exportFileName = `LedgerReport ${startLabel} Between ${formatDateForDisplay(endDate).replace(/\//g, '-')}.xlsx`;

        const { headers, rows } = buildLedgerExportRows();
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet([...reportHeaderRows('LEDGER REPORT'), headers, ...rows]);
        autoSizeColumns(ws);
        applyExcelReportFont(ws);
        XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
        XLSX.writeFile(wb, exportFileName);

        toast({
            title: "Export Successful",
            description: "The ledger report has been downloaded.",
        });
    };

    const handleExportPDF = async () => {
        if (!data || data.rows.length === 0) {
            toast({ title: "No Data", description: "There is no data to export.", variant: 'destructive' });
            return;
        }
        const doc = new jsPDF({ orientation: 'landscape' });
        const reportFont = await ensureReportFont(doc);
        const { headers, rows } = buildLedgerExportRows();
        const endDate = submittedReportType === 'RANGE' ? submittedTillDate : submittedAsOnDate;
        const periodLabel = submittedReportType === 'RANGE'
            ? `Period: ${formatDateForDisplay(submittedFromDate)} to ${formatDateForDisplay(submittedTillDate)}`
            : `As On: ${formatDateForDisplay(submittedAsOnDate)}`;
        await drawMisLedgerReport(
            doc,
            { headers, rows },
            { subtitle: `Ledger: ${data.ledgerName || ledgers.find((l) => l.id === selectedLedger)?.ledgerName || selectedLedger}  •  ${periodLabel}` },
            reportFont
        );
        doc.save(`LedgerReport_${selectedLedger}_${endDate}.pdf`);
        toast({ title: "Export Successful", description: "The ledger report has been downloaded." });
    };

    const handleExportCSV = () => {
        if (!data || data.rows.length === 0) {
            toast({ title: "No Data", description: "There is no data to export.", variant: 'destructive' });
            return;
        }
        const { headers, rows } = buildLedgerExportRows();
        const endDate = submittedReportType === 'RANGE' ? submittedTillDate : submittedAsOnDate;
        exportToCSV(`LedgerReport_${selectedLedger}_${endDate}`, 'LEDGER REPORT', headers, rows);
    };

    // Word-only presentation: same rows as PDF/CSV above. This report always ends with
    // an unconditional "TOTAL:" row followed by a "CLOSING BALANCE" row — the closing
    // balance (the true bottom line) is split off for distinct styling; the TOTAL row
    // stays a regular body row. Debit/Credit/Balance form a genuine accounting trio and
    // get a light 2-row grouped header (same Dr/Cr pattern already used for Trial
    // Balance); columns are identical between CONDENSED and full view types (only the
    // 5th header's label differs), so no branching is needed here.
    const buildLedgerWordOptions = (
        rows: (string | number)[][]
    ): { bodyRows: (string | number)[][]; options: WordExportOptions } => ({
        bodyRows: rows.slice(0, -1),
        options: {
            groupHeaders: [
                { label: 'S.No', span: 1 }, { label: 'Voucher Date', span: 1 }, { label: 'Branch Name', span: 1 },
                { label: 'Particulars', span: 1 }, { label: 'Narration / Type', span: 1 }, { label: 'Voucher No.', span: 1 },
                { label: 'AMOUNT', span: 3 }, { label: 'Dr/Cr', span: 1 },
            ],
            subHeaders: ['Debit', 'Credit', 'Balance'],
            columnAlignments: ['center', 'center', 'left', 'left', 'left', 'center', 'right', 'right', 'right', 'center'],
            columnWidthWeights: [4, 8, 10, 14, 12, 8, 8, 8, 8, 6],
            totalsRow: rows[rows.length - 1],
        },
    });

    const handleExportWord = async () => {
        if (!data || data.rows.length === 0) {
            toast({ title: "No Data", description: "There is no data to export.", variant: 'destructive' });
            return;
        }
        const { headers, rows } = buildLedgerExportRows();
        const endDate = submittedReportType === 'RANGE' ? submittedTillDate : submittedAsOnDate;
        const { bodyRows, options } = buildLedgerWordOptions(rows);
        await exportToWord(`LedgerReport_${selectedLedger}_${endDate}`, 'LEDGER REPORT', headers, bodyRows, options);
    };

    return (
        <div className="relative w-full">
            {/* Header Section */}
            <div className="mb-8">
                <div className="flex items-center gap-4 mb-4">
                    <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary shadow-lg shadow-primary/30">
                        <BookOpen className="h-7 w-7 text-white" />
                        <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/20 to-transparent" />
                    </div>
                    <div className="flex-1">
                        <h1 className="text-3xl font-bold tracking-tight text-foreground dark:text-white">
                            Ledger Report
                        </h1>
                        <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                            Comprehensive ledger report with debit, credit, and running balance details
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
                                    Total Debit
                                </p>
                                <p className="text-2xl font-bold text-foreground dark:text-green-100 mt-2">
                                    ₹ {formatCurrency(data?.totalDebit ?? 0)}
                                </p>
                                <p className="text-xs text-primary dark:text-primary mt-1">
                                    All transactions
                                </p>
                            </div>
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-green-tint dark:bg-brand-green-darker/50">
                                <TrendingDown className="h-6 w-6 text-primary dark:text-primary" />
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-2 border-primary/50 dark:border-primary/50 bg-gradient-to-br from-green-50 to-purple-50/50 dark:from-brand-green-darker/20 dark:to-purple-950/20">
                    <CardContent className="pt-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm font-medium text-primary dark:text-primary">
                                    Total Credit
                                </p>
                                <p className="text-2xl font-bold text-foreground dark:text-primary mt-2">
                                    ₹ {formatCurrency(data?.totalCredit ?? 0)}
                                </p>
                                <p className="text-xs text-primary dark:text-primary mt-1">
                                    All transactions
                                </p>
                            </div>
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 dark:bg-brand-green-darker/50">
                                <TrendingUp className="h-6 w-6 text-primary dark:text-primary" />
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-2 border-purple-200/50 dark:border-purple-800/50 bg-gradient-to-br from-purple-50 to-pink-50/50 dark:from-purple-950/20 dark:to-pink-950/20">
                    <CardContent className="pt-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm font-medium text-purple-700 dark:text-purple-300">
                                    Opening Balance
                                </p>
                                <p className="text-2xl font-bold text-purple-900 dark:text-purple-100 mt-2">
                                    ₹ {formatCurrency(data?.openingBalance ?? 0)} {data ? data.openingBalanceType : ''}
                                </p>
                                <p className="text-xs text-purple-600 dark:text-purple-400 mt-1">
                                    Starting balance
                                </p>
                            </div>
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-100 dark:bg-purple-900/50">
                                <ArrowUpDown className="h-6 w-6 text-purple-600 dark:text-purple-400" />
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-2 border-teal-200/50 dark:border-teal-800/50 bg-gradient-to-br from-teal-50 to-cyan-50/50 dark:from-teal-950/20 dark:to-cyan-950/20">
                    <CardContent className="pt-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm font-medium text-teal-700 dark:text-teal-300">
                                    Closing Balance
                                </p>
                                <p className="text-2xl font-bold text-teal-900 dark:text-teal-100 mt-2">
                                    ₹ {formatCurrency(data?.closingBalance ?? 0)} {data ? data.closingBalanceType : ''}
                                </p>
                                <p className="text-xs text-teal-600 dark:text-teal-400 mt-1">
                                    Ending balance
                                </p>
                            </div>
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-teal-100 dark:bg-teal-900/50">
                                <IndianRupee className="h-6 w-6 text-teal-600 dark:text-teal-400" />
                            </div>
                        </div>
                    </CardContent>
                </Card>
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
                                    Select report type, date, branch and ledger for the Ledger Report
                                </CardDescription>
                            </div>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="pt-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-6">
                        {/* Report Type */}
                        <div className="space-y-2">
                            <Label htmlFor="reportType" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                Report Type <span className="text-red-500">*</span>
                            </Label>
                            <Select value={reportType} onValueChange={(v) => setReportType(v as ReportType)}>
                                <SelectTrigger id="reportType" className="h-11 border-primary/30 dark:border-sidebar-accent">
                                    <SelectValue placeholder="Select type" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="RANGE">From Date - To Date</SelectItem>
                                    <SelectItem value="AS_ON">As On Date</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Date Selection */}
                        {reportType === 'RANGE' ? (
                            <>
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
                            </>
                        ) : (
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
                        )}

                        {/* Branch */}
                        <div className="space-y-2">
                            <Label htmlFor="branch" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                Branch
                            </Label>
                            <Select value={selectedBranchId} onValueChange={setSelectedBranchId}>
                                <SelectTrigger id="branch" className="h-11 border-primary/30 dark:border-sidebar-accent">
                                    <SelectValue placeholder="All Branches" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Branches</SelectItem>
                                    {branches.map((b) => (
                                        <SelectItem key={b.id} value={b.id}>{b.code} - {b.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Custom Searchable Select for Ledgers */}
                        <div className="space-y-2 relative" ref={dropdownRef}>
                            <Label htmlFor="ledgerName" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                Ledger <span className="text-red-500">*</span>
                            </Label>
                            <div
                                className={cn(
                                    "h-11 border border-primary/30 dark:border-sidebar-accent rounded-md px-3 flex items-center justify-between cursor-pointer bg-white dark:bg-green-950",
                                    isFetchingLedgers && "opacity-60 cursor-not-allowed"
                                )}
                                onClick={() => !isFetchingLedgers && setIsDropdownOpen(!isDropdownOpen)}
                            >
                                <span className={selectedLedger ? "text-foreground dark:text-white truncate" : "text-slate-500 dark:text-slate-400"}>
                                    {isFetchingLedgers ? "Fetching..." : (ledgers.find(l => l.id === selectedLedger)?.ledgerName || '-- SELECT --')}
                                </span>
                                {isFetchingLedgers ? (
                                    <RefreshCw className="h-4 w-4 opacity-50 animate-spin" />
                                ) : (
                                    <ChevronDown className="h-4 w-4 opacity-50" />
                                )}
                            </div>

                            {/* Dropdown Popover */}
                            {isDropdownOpen && (
                                <div className="absolute z-50 w-full mt-1 bg-white dark:bg-green-950 border border-primary/20 dark:border-sidebar-accent rounded-md shadow-lg overflow-hidden">
                                    <div className="p-2 border-b border-slate-100 dark:border-sidebar-accent flex items-center gap-2">
                                        <Search className="h-4 w-4 text-slate-400" />
                                        <Input
                                            placeholder="Search ledger..."
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
                                                !selectedLedger && "bg-brand-green-tint dark:bg-sidebar-accent font-medium"
                                            )}
                                            onClick={() => {
                                                setSelectedLedger('');
                                                setIsDropdownOpen(false);
                                                setSearchQuery('');
                                            }}
                                        >
                                            -- SELECT --
                                        </div>
                                        {filteredLedgers.map(l => (
                                            <div
                                                key={l.id}
                                                className={cn(
                                                    "px-2 py-1.5 text-sm rounded-sm cursor-pointer hover:bg-brand-green-tint dark:hover:bg-sidebar-accent truncate",
                                                    selectedLedger === l.id && "bg-green-50 dark:bg-brand-green-darker/50 text-primary dark:text-primary font-medium"
                                                )}
                                                onClick={() => {
                                                    setSelectedLedger(l.id);
                                                    setIsDropdownOpen(false);
                                                    setSearchQuery('');
                                                }}
                                            >
                                                {l.ledgerName}
                                            </div>
                                        ))}
                                        {filteredLedgers.length === 0 && (
                                            <div className="px-2 py-3 text-sm text-center text-slate-500">
                                                No ledger found.
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* View Type */}
                        <div className="space-y-2">
                            <Label htmlFor="viewType" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                View Type
                            </Label>
                            <Select value={viewType} onValueChange={(v) => setViewType(v as ViewType)}>
                                <SelectTrigger id="viewType" className="h-11 border-primary/30 dark:border-sidebar-accent">
                                    <SelectValue placeholder="Select view" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="CONDENSED">Condensed</SelectItem>
                                    <SelectItem value="DETAILED">Detailed</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Action Buttons Row */}
                        <div className="space-y-2 lg:col-span-3 xl:col-span-6">
                            <div className="flex flex-wrap gap-2">
                                <Button
                                    onClick={handleShowReport}
                                    disabled={isLoading}
                                    className="h-11 flex-1 min-w-[140px] bg-gradient-to-r from-primary to-primary hover:from-sidebar-accent hover:to-primary text-white shadow-lg shadow-primary/30"
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
                                    className="h-11 flex-1 min-w-[100px] border-red-300 text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-300"
                                >
                                    Reset
                                </Button>
                                {showReport && (
                                    <>
                                        <ExportDropdown
                                            onExportPDF={handleExportPDF}
                                            onExportExcel={handleExport}
                                            onExportCSV={handleExportCSV}
                                            reportSlug={getReportExportMode('mis-ledger-report') === 'REQUEST_QUEUE' ? 'mis-ledger-report' : undefined}
                                            canExport={canExportReport('mis-ledger-report')}
                                            onExportWord={handleExportWord}
                                            exportParams={{
                                                fromDate: submittedReportType === 'RANGE' ? submittedFromDate : submittedAsOnDate,
                                                toDate: submittedReportType === 'RANGE' ? submittedTillDate : submittedAsOnDate,
                                                branchIds: selectedBranchId === 'all' ? 'ALL' : [selectedBranchId],
                                                filters: { ledgerId: selectedLedger, reportType: submittedReportType, viewType },
                                            }}
                                            className="h-11 flex-1 min-w-[120px] bg-primary hover:bg-sidebar-accent text-white"
                                        />
                                        <Button
                                            onClick={handlePrint}
                                            variant="outline"
                                            className="h-11 flex-1 min-w-[100px] border-primary/30 text-sidebar-accent hover:bg-green-50 dark:border-sidebar-accent dark:text-slate-300 dark:hover:bg-sidebar-accent"
                                        >
                                            <Printer className="h-4 w-4 mr-2" />
                                            Print
                                        </Button>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Ledger Report Table */}
            {showReport && data && (
                <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
                    <div className="h-1.5 bg-gradient-to-r from-primary via-primary to-purple-600" />

                    {/* Print-friendly content */}
                    <div ref={printRef} className="print:p-8">
                        {/* Report Header */}
                        <CardHeader className="bg-gradient-to-r from-slate-50 via-green-50/60 to-green-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker print:bg-white">
                            <ReportHeader title="Ledger Report" />
                            <div className="text-center space-y-2">
                                <p className="text-sm text-sidebar-accent dark:text-slate-400">
                                    Ledger: {data.ledgerName || ledgers.find((l) => l.id === selectedLedger)?.ledgerName || selectedLedger}
                                </p>
                                <p className="text-sm text-sidebar-accent dark:text-slate-400">
                                    {submittedReportType === 'RANGE'
                                        ? `Period: ${formatDateForDisplay(submittedFromDate)} to ${formatDateForDisplay(submittedTillDate)}`
                                        : `As On: ${formatDateForDisplay(submittedAsOnDate)}`}
                                </p>
                                <p className="text-sm text-sidebar-accent dark:text-slate-400">
                                    Branch: {selectedBranchId === 'all' ? 'All Branches' : (branches.find((b) => b.id === selectedBranchId) ? `${branches.find((b) => b.id === selectedBranchId)!.code} - ${branches.find((b) => b.id === selectedBranchId)!.name}` : selectedBranchId)}
                                    {' • '}View: {viewType === 'CONDENSED' ? 'Condensed' : 'Detailed'}
                                </p>
                            </div>
                        </CardHeader>

                        <CardContent className="p-0">
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow className="bg-gradient-to-r from-[#1346A2] to-sidebar-accent hover:from-[#1346A2] hover:to-sidebar-accent">
                                            <TableHead className="font-bold text-white text-xs border-r border-[#1a5edb] whitespace-nowrap px-2 text-center">S.NO</TableHead>
                                            <TableHead className="font-bold text-white text-xs border-r border-[#1a5edb] whitespace-nowrap px-2">VOUCHER DATE</TableHead>
                                            <TableHead className="font-bold text-white text-xs border-r border-[#1a5edb] whitespace-nowrap px-2">BRANCH NAME</TableHead>
                                            <TableHead className="font-bold text-white text-xs border-r border-[#1a5edb] whitespace-nowrap px-2">PARTICULARS</TableHead>
                                            {viewType === 'CONDENSED' ? (
                                                <TableHead className="font-bold text-white text-xs border-r border-[#1a5edb] whitespace-nowrap px-2">NARRATION</TableHead>
                                            ) : (
                                                <TableHead className="font-bold text-white text-xs border-r border-[#1a5edb] whitespace-nowrap px-2 text-center">VOUCHER TYPE</TableHead>
                                            )}
                                            <TableHead className="font-bold text-white text-xs border-r border-[#1a5edb] whitespace-nowrap px-2">VOUCHER NO.</TableHead>
                                            <TableHead className="font-bold text-white text-xs border-r border-[#1a5edb] whitespace-nowrap px-2 text-right">DEBIT</TableHead>
                                            <TableHead className="font-bold text-white text-xs border-r border-[#1a5edb] whitespace-nowrap px-2 text-right">CREDIT</TableHead>
                                            <TableHead className="font-bold text-white text-xs border-r border-[#1a5edb] whitespace-nowrap px-2 text-right">BALANCE</TableHead>
                                            <TableHead className="font-bold text-white text-xs whitespace-nowrap px-2 text-center">DR/CR</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {/* Opening Balance summary row (page 1 / print only) */}
                                        {showOpeningRow && (
                                        <TableRow className="font-bold bg-green-50 dark:bg-green-950/30">
                                            <TableCell colSpan={6} className="text-foreground dark:text-white border-r">
                                                OPENING BALANCE
                                            </TableCell>
                                            <TableCell className="border-r"></TableCell>
                                            <TableCell className="border-r"></TableCell>
                                            <TableCell className="text-right text-foreground dark:text-white border-r">{formatCurrency(data.openingBalance)}</TableCell>
                                            <TableCell className="text-center text-foreground dark:text-white">{data.openingBalanceType}</TableCell>
                                        </TableRow>
                                        )}

                                        {allRows.length > 0 ? (
                                            pageRows.map((item, index) => (
                                                <TableRow
                                                    key={rowOffset + index}
                                                    className={cn(
                                                        'transition-colors',
                                                        index % 2 === 0
                                                            ? 'bg-white dark:bg-brand-green-darker hover:bg-green-50 dark:hover:bg-green-950/20'
                                                            : 'bg-green-50/50 dark:bg-brand-green-darker/50 hover:bg-green-50 dark:hover:bg-green-950/20'
                                                    )}
                                                >
                                                    <TableCell className="text-center border-r">{rowOffset + index + 1}</TableCell>
                                                    <TableCell className="text-sm font-semibold border-r whitespace-nowrap">{formatDateForDisplay(item.voucherDate)}</TableCell>
                                                    <TableCell className="font-semibold text-sidebar-accent dark:text-primary border-r">{item.branchName}</TableCell>
                                                    <TableCell className="font-medium border-r max-w-[300px] text-sidebar-accent dark:text-slate-300">
                                                        <div className="uppercase truncate">{item.particulars}</div>
                                                        {viewType === 'DETAILED' && (
                                                            <div className="text-xs text-slate-500 dark:text-slate-400 space-y-0.5 mt-1 normal-case">
                                                                <div>Reference # : {item.referenceNo || '-'}</div>
                                                                <div>Reference Date : {item.referenceDate ? formatDateForDisplay(item.referenceDate) : '-'}</div>
                                                                <div className="truncate max-w-[300px]">Narration : {item.narration || '-'}</div>
                                                            </div>
                                                        )}
                                                    </TableCell>
                                                    {viewType === 'CONDENSED' ? (
                                                        <TableCell className="text-sm text-sidebar-accent dark:text-slate-400 uppercase truncate max-w-[300px] border-r">{item.narration || '-'}</TableCell>
                                                    ) : (
                                                        <TableCell className="text-center font-mono text-xs text-sidebar-accent dark:text-slate-300 border-r">{item.voucherTypeLabel}</TableCell>
                                                    )}
                                                    <TableCell className="text-xs text-sidebar-accent dark:text-slate-300 border-r whitespace-nowrap">{item.voucherNo}</TableCell>
                                                    <TableCell className="text-right font-semibold text-sidebar-accent dark:text-slate-300 border-r">
                                                        {item.debit > 0 ? formatCurrency(item.debit) : '-'}
                                                    </TableCell>
                                                    <TableCell className="text-right font-semibold text-sidebar-accent dark:text-slate-300 border-r">
                                                        {item.credit > 0 ? formatCurrency(item.credit) : '-'}
                                                    </TableCell>
                                                    <TableCell className="text-right font-semibold text-sidebar-accent dark:text-slate-300 border-r">
                                                        {formatCurrency(item.balance)}
                                                    </TableCell>
                                                    <TableCell className="text-center font-semibold text-sidebar-accent dark:text-slate-300">
                                                        {item.balanceType}
                                                    </TableCell>
                                                </TableRow>
                                            ))
                                        ) : (
                                            <TableRow>
                                                <TableCell colSpan={10} className="text-center py-8 text-slate-500 dark:text-slate-400">
                                                    No ledger records found for the selected criteria.
                                                </TableCell>
                                            </TableRow>
                                        )}

                                        {/* Total + Closing Balance rows (last page / print only) */}
                                        {showClosingRows && (
                                        <>
                                        <TableRow className="bg-gradient-to-r from-brand-green-tint to-primary dark:from-brand-green-darker/40 dark:to-brand-green-darker/40 border-t-2 border-primary/30">
                                            <TableCell colSpan={6} className="text-right font-bold text-foreground dark:text-white border-r">
                                                TOTAL:
                                            </TableCell>
                                            <TableCell className="text-right font-bold text-foreground dark:text-white border-r">{formatCurrency(data.totalDebit)}</TableCell>
                                            <TableCell className="text-right font-bold text-foreground dark:text-white border-r">{formatCurrency(data.totalCredit)}</TableCell>
                                            <TableCell colSpan={2} className="font-bold text-foreground dark:text-white text-center">-</TableCell>
                                        </TableRow>

                                        <TableRow className="bg-gradient-to-r from-teal-50 to-cyan-50 dark:from-teal-950/30 dark:to-cyan-950/30 border-t-2 border-teal-300/50 dark:border-teal-700/50">
                                            <TableCell colSpan={6} className="text-right font-bold text-teal-900 dark:text-teal-100 border-r">
                                                END DATE: {formatDateForDisplay(submittedReportType === 'RANGE' ? submittedTillDate : submittedAsOnDate)} — CLOSING BALANCE:
                                            </TableCell>
                                            <TableCell className="border-r"></TableCell>
                                            <TableCell className="border-r"></TableCell>
                                            <TableCell className="text-right font-bold text-teal-900 dark:text-teal-100 border-r">{formatCurrency(data.closingBalance)}</TableCell>
                                            <TableCell className="text-center font-bold text-teal-900 dark:text-teal-100">{data.closingBalanceType}</TableCell>
                                        </TableRow>
                                        </>
                                        )}
                                    </TableBody>
                                </Table>
                            </div>

                            {/* Pagination (screen only) */}
                            {allRows.length > rowsPerPage && (
                                <div className="print:hidden flex flex-col gap-3 border-t border-primary/20 bg-white px-4 py-3 dark:border-sidebar-accent dark:bg-brand-green-darker/40 sm:flex-row sm:items-center sm:justify-between">
                                    <span className="text-sm text-sidebar-accent dark:text-slate-400">
                                        Showing <span className="font-medium">{(safePage - 1) * rowsPerPage + 1}</span>
                                        {' '}to <span className="font-medium">{Math.min(safePage * rowsPerPage, allRows.length)}</span>
                                        {' '}of <span className="font-medium">{allRows.length}</span> entries
                                    </span>
                                    <div className="flex items-center gap-2">
                                        <Select
                                            value={rowsPerPage.toString()}
                                            onValueChange={(value) => {
                                                setRowsPerPage(Number(value));
                                                setCurrentPage(1);
                                            }}
                                        >
                                            <SelectTrigger className="h-8 w-[90px] text-xs">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {ROWS_PER_PAGE_OPTIONS.map((n) => (
                                                    <SelectItem key={n} value={n.toString()}>{n} / page</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <div className="flex items-center gap-1">
                                            <Button type="button" variant="outline" size="sm" className="h-8 w-8 p-0"
                                                onClick={() => setCurrentPage(1)} disabled={safePage === 1}>{'««'}</Button>
                                            <Button type="button" variant="outline" size="sm" className="h-8 w-8 p-0"
                                                onClick={() => setCurrentPage(Math.max(1, safePage - 1))} disabled={safePage === 1}>{'«'}</Button>
                                            <span className="px-2 text-sm text-sidebar-accent dark:text-slate-300 whitespace-nowrap">
                                                Page {safePage} of {totalPages}
                                            </span>
                                            <Button type="button" variant="outline" size="sm" className="h-8 w-8 p-0"
                                                onClick={() => setCurrentPage(Math.min(totalPages, safePage + 1))} disabled={safePage >= totalPages}>{'»'}</Button>
                                            <Button type="button" variant="outline" size="sm" className="h-8 w-8 p-0"
                                                onClick={() => setCurrentPage(totalPages)} disabled={safePage >= totalPages}>{'»»'}</Button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </div>
                </Card>
            )}
        </div>
    );
}
