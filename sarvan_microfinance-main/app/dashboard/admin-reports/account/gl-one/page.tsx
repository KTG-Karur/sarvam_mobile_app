'use client';

import { useState, useRef, useEffect } from 'react';
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
    BookText,
    Download,
    FileText,
    FileSpreadsheet,
    FileType,
    Printer,
    RefreshCw,
    Filter,
    ArrowUpCircle,
    ArrowDownCircle,
    Wallet,
    TrendingUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { useReactToPrint } from 'react-to-print';
import { useToast } from '@/hooks/use-toast';
import { usePermission } from '@/app/hooks/usePermission';
import * as XLSX from 'xlsx-js-style';
import jsPDF from 'jspdf';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { drawGlAccountLedgerReport } from '@/app/lib/reports/gl-account-ledger-pdf';
import { buildReportSheet, autoSizeColumns, applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { exportToCSV, exportToWord, type WordExportOptions } from '@/app/lib/report-export-utils';
import { formatReportAmount } from '@/app/lib/utils/format-amount';
import { DateInput } from '@/components/ui/date-input';
import { toDisplayDate } from '@/app/lib/date-format';

// Types
interface AccountOption {
    id: string;
    name: string;
}

interface Transaction {
    date: string;
    type: 'OB' | 'CR' | 'DR';
    particulars: string;
    description?: string;
    debit: number;
    credit: number;
    balance: number;
}

const REPORT_TYPES = [
    { id: 'head_office', name: 'HEAD OFFICE' },
    { id: 'consolidated', name: 'CONSOLIDATED' },
];

const formatCurrency = (amount: number) => `₹${formatReportAmount(Math.abs(amount))}`;

const formatDate = (dateString: string) => {
    if (!dateString) return '';
    return toDisplayDate(new Date(dateString));
};

export default function LedgerPage() {
    const { toast } = useToast();
    const { canExportReport, getReportExportMode } = usePermission();
    const [accounts, setAccounts] = useState<AccountOption[]>([]);
    const [selectedAccount, setSelectedAccount] = useState('');
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
    const [reportData, setReportData] = useState<{
        accountName: string;
        openingBalance: number;
        closingBalance: number;
        transactions: Transaction[];
    } | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const printRef = useRef<HTMLDivElement>(null);

    // Fetch Accounts List
    useEffect(() => {
        const fetchAccounts = async () => {
            try {
                // We'll combine Ledgers and SelfAccounts into one list for simplicity?
                // Or separate APIs? Let's assume we can fetch ledgers for now or create a dropdown API.
                // For now, let's fetch GL All briefly to populate, or better, dedicated endpoint.
                // Re-using GL All logic slightly modified here or separate call.
                // Creating a small helper fetch:
                const response = await fetch('/api/reports/gl-all?type=consolidated&startDate=2020-01-01&endDate=2020-01-01'); // Dummy call to get list? No, inefficient.
                // Better: Fetch just list.
                // Let's rely on user flow: fetch accounts on mount.
                // Since we don't have a dedicated "list accounts" API, we will use a quick one.
                // Actually, let's build a quick fetch inside component for now or add to API.
                // I will modify this component to fetch list on load from a new simple endpoint or existing one.
                // For now, mock or fetch from GL-All response if empty? No.
                // Let's restart: "generate ledger dropdown dynamically from table db".
                // I'll add a fetch to get all ledgers/self accounts.
                const res = await fetch('/api/masters/gl'); // This is GL Accounts, not AccountLedgers?
                // Wait, User wants "Ledger Report". This implies AccountLedgers for customers/expenses etc.
                // Let's fetch AccountLedgers.
                const accRes = await fetch('/api/accounts/list'); // Hypothetical, need to create or use existing.
                // I'll create a quick fetch inside useEffect here to get ledgers directly via server action or API route.
                // Since I cannot create new file easily without tool, I will use a direct fetch to a new route if I make one, 
                // OR I can use the EXISTING gl-all ROUTE but just for list? No.
                // I will add a small inline fetch to a new route `/api/accounts/dropdown`.

                // Temporary: Fetch from existing masters if available, or just use what we have.
                // Let's assume there is an API or I will create one.
                // I added a route for `gl-one` but it requires ID. 
                // I will create a route `api/accounts/dropdown` now.
            } catch (error) {
                console.error("Failed to fetch accounts", error);
            }
        };
        // fetchAccounts(); 
    }, []);

    // Fetch Accounts Dropdown
    useEffect(() => {
        const loadAccounts = async () => {
            try {
                const response = await fetch('/api/utils/account-dropdown');
                if (response.ok) {
                    const data = await response.json();
                    setAccounts(data);
                }
            } catch (e) {
                console.error(e);
                toast({ title: "Error", description: "Failed to load account list", variant: "destructive" });
            }
        };
        loadAccounts();
    }, [toast]);


    const handleGenerateReport = async () => {
        if (!selectedAccount) {
            toast({ title: "Validation Error", description: "Please select an account first.", variant: "destructive" });
            return;
        }
        setIsLoading(true);
        try {
            const query = new URLSearchParams({
                accountId: selectedAccount,
                type: reportType,
                startDate: fromDate,
                endDate: toDate
            });
            const response = await fetch(`/api/reports/gl-one?${query}`);
            const result = await response.json();

            if (result.success) {
                setReportData(result.data);
                setSubmittedFromDate(fromDate);
                setSubmittedToDate(toDate);
                toast({ title: "Success", description: "Report generated successfully." });
            } else {
                setReportData(null);
                toast({ title: "Error", description: result.message, variant: "destructive" });
            }
        } catch (error) {
            console.error(error);
            toast({ title: "Error", description: "Failed to generate report", variant: "destructive" });
        } finally {
            setIsLoading(false);
        }
    };

    const handlePrint = useReactToPrint({
        contentRef: printRef,
        documentTitle: `Ledger_Report_${submittedFromDate}_${submittedToDate}`,
    });

    const handleExportExcel = () => {
        if (!reportData) return;

        const data = [
            // Header
            { Date: `Account: ${reportData.accountName}`, Particulars: '', Debit: '', Credit: '', Balance: '' },
            { Date: 'Opening Balance', Particulars: '', Debit: reportData.openingBalance > 0 ? reportData.openingBalance : '', Credit: reportData.openingBalance < 0 ? Math.abs(reportData.openingBalance) : '', Balance: reportData.openingBalance },
            // Transactions
            ...reportData.transactions.map(tx => ({
                Date: tx.date,
                Particulars: tx.particulars,
                Debit: tx.debit || '',
                Credit: tx.credit || '',
                Balance: tx.balance
            })),
            // Closing
            { Date: 'Closing Balance', Particulars: '', Debit: '', Credit: '', Balance: reportData.closingBalance }
        ];

        const ws = buildReportSheet("Ledger Report", data);
        autoSizeColumns(ws);
        applyExcelReportFont(ws);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Ledger");
        XLSX.writeFile(wb, `Ledger_${reportData.accountName}.xlsx`);
    };

    // PDF Export — drawing logic lives in gl-account-ledger-pdf.ts, shared with
    // the Request Report queue's PDF renderer (see gl-account-ledger-pdf-queue.ts)
    // so both produce the same structure.
    const handleExportPDF = async () => {
        if (!reportData) return;
        const doc = new jsPDF({ orientation: 'landscape' });
        const reportFont = await ensureReportFont(doc);

        await drawGlAccountLedgerReport(
            doc,
            reportData,
            { periodLabel: `${formatDate(submittedFromDate)} to ${formatDate(submittedToDate)}` },
            reportFont
        );

        doc.save(`Ledger_${reportData.accountName}.pdf`);
    };

    const buildLedgerExportRows = (): { headers: string[]; rows: (string | number)[][] } => {
        if (!reportData) return { headers: [], rows: [] };
        const headers = ['Date', 'Particulars', 'Debit', 'Credit', 'Balance'];
        const rows: (string | number)[][] = [
            [`Account: ${reportData.accountName}`, '', '', '', ''],
            [
                'Opening Balance',
                '',
                reportData.openingBalance > 0 ? reportData.openingBalance : '',
                reportData.openingBalance < 0 ? Math.abs(reportData.openingBalance) : '',
                reportData.openingBalance,
            ],
            ...reportData.transactions.map(tx => [tx.date, tx.particulars, tx.debit || '', tx.credit || '', tx.balance]),
            ['Closing Balance', '', '', '', reportData.closingBalance],
        ];
        return { headers, rows };
    };

    const handleExportCSV = () => {
        if (!reportData) return;
        const { headers, rows } = buildLedgerExportRows();
        exportToCSV(`Ledger_${reportData.accountName}`, `LEDGER REPORT: ${reportData.accountName}`, headers, rows);
    };

    // Word-only presentation: same rows as CSV above, but the trailing "Closing Balance"
    // row (the true bottom line) is split off for distinct styling. 5 flat columns —
    // no grouping needed.
    const buildGLOneWordOptions = (
        rows: (string | number)[][]
    ): { bodyRows: (string | number)[][]; options: WordExportOptions } => ({
        bodyRows: rows.slice(0, -1),
        options: {
            columnAlignments: ['left', 'left', 'right', 'right', 'right'],
            columnWidthWeights: [10, 16, 9, 9, 9],
            totalsRow: rows[rows.length - 1],
        },
    });

    const handleExportWord = async () => {
        if (!reportData) return;
        const { headers, rows } = buildLedgerExportRows();
        const { bodyRows, options } = buildGLOneWordOptions(rows);
        await exportToWord(`Ledger_${reportData.accountName}`, `LEDGER REPORT: ${reportData.accountName}`, headers, bodyRows, options);
    };

    // Calculate Totals for Cards
    const totalDebit = reportData?.transactions.reduce((sum, tx) => sum + (tx.debit || 0), 0) || 0;
    const totalCredit = reportData?.transactions.reduce((sum, tx) => sum + (tx.credit || 0), 0) || 0;
    const netChange = reportData ? reportData.closingBalance - reportData.openingBalance : 0;

    return (
        <ProtectedRoute>
            <div className="relative min-h-screen bg-gradient-to-br from-background via-green-50/30 to-purple-50/30 dark:from-background dark:via-brand-green-darker dark:to-green-950">
                <div className="container mx-auto px-3 sm:px-6 py-4 sm:py-8">
                    {/* Header Section */}
                    <div className="mb-8">
                        <div className="flex items-center gap-4 mb-4">
                            <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-purple-600 shadow-lg shadow-primary/30">
                                <BookText className="h-7 w-7 text-white" />
                                <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/20 to-transparent" />
                            </div>
                            <div className="flex-1">
                                <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-foreground dark:text-white">
                                    Ledger Report
                                </h1>
                                <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                                    Account-wise transaction ledger with running balance
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Summary Cards */}
                    {reportData && (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                            <Card className="border-2 border-primary/30/50 bg-green-50/30">
                                <CardContent className="pt-6">
                                    <div className="flex justify-between">
                                        <div>
                                            <p className="text-sm font-medium text-sidebar-accent">Opening Balance</p>
                                            <p className="text-2xl font-bold text-foreground mt-2">{formatCurrency(reportData.openingBalance)}</p>
                                        </div>
                                        <Wallet className="h-6 w-6 text-primary" />
                                    </div>
                                </CardContent>
                            </Card>
                            <Card className="border-2 border-green-200/50 bg-green-50/30">
                                <CardContent className="pt-6">
                                    <div className="flex justify-between">
                                        <div>
                                            <p className="text-sm font-medium text-green-700">Total Debits</p>
                                            <p className="text-2xl font-bold text-green-900 mt-2">{formatCurrency(totalDebit)}</p>
                                        </div>
                                        <ArrowDownCircle className="h-6 w-6 text-green-500" />
                                    </div>
                                </CardContent>
                            </Card>
                            <Card className="border-2 border-red-200/50 bg-red-50/30">
                                <CardContent className="pt-6">
                                    <div className="flex justify-between">
                                        <div>
                                            <p className="text-sm font-medium text-red-700">Total Credits</p>
                                            <p className="text-2xl font-bold text-red-900 mt-2">{formatCurrency(totalCredit)}</p>
                                        </div>
                                        <ArrowUpCircle className="h-6 w-6 text-red-500" />
                                    </div>
                                </CardContent>
                            </Card>
                            <Card className="border-2 border-purple-200/50 bg-purple-50/30">
                                <CardContent className="pt-6">
                                    <div className="flex justify-between">
                                        <div>
                                            <p className="text-sm font-medium text-purple-700">Closing Balance</p>
                                            <p className="text-2xl font-bold text-purple-900 mt-2">{formatCurrency(reportData.closingBalance)}</p>
                                        </div>
                                        <TrendingUp className="h-6 w-6 text-purple-500" />
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    )}

                    {/* Filters Card */}
                    <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden mb-6">
                        <div className="h-1.5 bg-gradient-to-r from-primary via-purple-600 to-pink-600" />
                        <CardHeader className="bg-gradient-to-r from-slate-50 via-green-50/60 to-purple-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                                <div className="flex items-center gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 dark:bg-brand-green-darker/30">
                                        <Filter className="h-5 w-5 text-primary dark:text-primary" />
                                    </div>
                                    <div>
                                        <CardTitle className="text-xl">Report Parameters</CardTitle>
                                        <CardDescription>Select ledger account and date range</CardDescription>
                                    </div>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <ExportDropdown
                                        onExportPDF={handleExportPDF}
                                        onExportExcel={handleExportExcel}
                                        onExportCSV={handleExportCSV}
                                        onExportWord={handleExportWord}
                                        // Queue mode only supports the consolidated (all-branch) view — see gl-all's
                                        // identical note (the resolved Head Office branch id isn't known client-side).
                                        reportSlug={reportType === 'consolidated' && getReportExportMode('gl-account-ledger') === 'REQUEST_QUEUE' ? 'gl-account-ledger' : undefined}
                                        canExport={canExportReport('gl-account-ledger')}
                                        exportParams={{
                                            fromDate: submittedFromDate,
                                            toDate: submittedToDate,
                                            branchIds: 'ALL',
                                            filters: { accountId: selectedAccount },
                                        }}
                                        className="border-green-300 text-green-700 hover:bg-green-50"
                                    />
                                    <Button variant="outline" size="sm" onClick={handlePrint} className="border-primary/30 text-sidebar-accent hover:bg-green-50">
                                        <Printer className="h-4 w-4 mr-2" /> Print
                                    </Button>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="pt-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
                                {/* Ledger Account */}
                                <div className="space-y-2">
                                    <Label htmlFor="ledgerAccount">Ledger Account <span className="text-red-500">*</span></Label>
                                    <Select value={selectedAccount} onValueChange={setSelectedAccount}>
                                        <SelectTrigger id="ledgerAccount" className="h-11">
                                            <SelectValue placeholder="Select account" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {accounts.map((account) => (
                                                <SelectItem key={account.id} value={account.id}>
                                                    {account.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                {/* Report Type */}
                                <div className="space-y-2">
                                    <Label htmlFor="reportType">Report Type <span className="text-red-500">*</span></Label>
                                    <Select value={reportType} onValueChange={setReportType}>
                                        <SelectTrigger id="reportType" className="h-11">
                                            <SelectValue placeholder="Select type" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {REPORT_TYPES.map((type) => (
                                                <SelectItem key={type.id} value={type.id}>{type.name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                {/* Dates */}
                                <div className="space-y-2">
                                    <Label htmlFor="fromDate">From Date <span className="text-red-500">*</span></Label>
                                    <DateInput id="fromDate" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="h-11" />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="toDate">Till Date <span className="text-red-500">*</span></Label>
                                    <DateInput id="toDate" value={toDate} onChange={(e) => setToDate(e.target.value)} className="h-11" />
                                </div>

                                {/* Button */}
                                <div className="space-y-2">
                                    <Label className="opacity-0">Action</Label>
                                    <Button onClick={handleGenerateReport} disabled={isLoading} className="h-11 w-full bg-gradient-to-r from-primary to-purple-600 text-white">
                                        {isLoading ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Generating...</> : <><BookText className="h-4 w-4 mr-2" /> Show Report</>}
                                    </Button>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Report Table */}
                    <Card className="border-2 border-primary/20/80 shadow-xl overflow-hidden">
                        <div className="h-1.5 bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600" />
                        <div ref={printRef} className="print:p-8">
                            <CardHeader className="bg-gradient-to-r from-slate-50 via-green-50/60 to-purple-50/60 border-b print:bg-white text-center">
                                <ReportHeader
                                    title={`LEDGER REPORT: ${reportData?.accountName || 'Select Account'}`}
                                    subtitle={`${REPORT_TYPES.find(t => t.id === reportType)?.name || reportType}  •  ${formatDate(submittedFromDate)} - ${formatDate(submittedToDate)}`}
                                />
                            </CardHeader>

                            <CardContent className="p-0">
                                <Table>
                                    <TableHeader>
                                        <TableRow className="bg-brand-green-tint">
                                            <TableHead className="w-32 font-bold text-foreground">Date</TableHead>
                                            <TableHead className="w-24 font-bold text-foreground">Type</TableHead>
                                            <TableHead className="font-bold text-foreground">Particulars</TableHead>
                                            <TableHead className="text-right font-bold text-green-900 w-32">Debit</TableHead>
                                            <TableHead className="text-right font-bold text-red-900 w-32">Credit</TableHead>
                                            <TableHead className="text-right font-bold text-foreground w-32">Balance</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {!reportData ? (
                                            <TableRow>
                                                <TableCell colSpan={6} className="h-32 text-center text-slate-500">
                                                    Select an account and click Show Report to view data.
                                                </TableCell>
                                            </TableRow>
                                        ) : (
                                            <>
                                                {/* Opening Balance */}
                                                <TableRow className="bg-green-50/50 font-medium">
                                                    <TableCell></TableCell>
                                                    <TableCell><Badge variant="secondary">OB</Badge></TableCell>
                                                    <TableCell>Opening Balance</TableCell>
                                                    <TableCell className="text-right">
                                                        {reportData.openingBalance > 0 ? formatCurrency(reportData.openingBalance) : '-'}
                                                    </TableCell>
                                                    <TableCell className="text-right">
                                                        {reportData.openingBalance < 0 ? formatCurrency(Math.abs(reportData.openingBalance)) : '-'}
                                                    </TableCell>
                                                    <TableCell className="text-right font-bold text-sidebar-accent">
                                                        {formatCurrency(reportData.openingBalance)}
                                                    </TableCell>
                                                </TableRow>

                                                {/* Transactions */}
                                                {reportData.transactions.map((tx, idx) => (
                                                    <TableRow key={idx} className="hover:bg-green-50">
                                                        <TableCell>{tx.date}</TableCell>
                                                        <TableCell>
                                                            <Badge variant={tx.type === 'DR' ? 'destructive' : 'default'} className={tx.type === 'DR' ? 'bg-green-600' : 'bg-red-600'}>
                                                                {tx.type}
                                                            </Badge>
                                                        </TableCell>
                                                        <TableCell>
                                                            <div className="font-medium">{tx.particulars}</div>
                                                            {tx.description && <div className="text-xs text-slate-500 italic">{tx.description}</div>}
                                                        </TableCell>
                                                        <TableCell className="text-right text-green-700 font-medium">
                                                            {tx.debit > 0 ? formatCurrency(tx.debit) : '-'}
                                                        </TableCell>
                                                        <TableCell className="text-right text-red-700 font-medium">
                                                            {tx.credit > 0 ? formatCurrency(tx.credit) : '-'}
                                                        </TableCell>
                                                        <TableCell className="text-right font-bold text-foreground">
                                                            {formatCurrency(tx.balance)}
                                                        </TableCell>
                                                    </TableRow>
                                                ))}

                                                {/* Closing Balance */}
                                                <TableRow className="bg-purple-50/50 font-bold border-t-2 border-purple-200">
                                                    <TableCell colSpan={3} className="text-right text-purple-900 pr-4">Closing Balance</TableCell>
                                                    <TableCell className="text-right text-purple-900">
                                                        {reportData.closingBalance > 0 ? formatCurrency(reportData.closingBalance) : '-'}
                                                    </TableCell>
                                                    <TableCell className="text-right text-purple-900">
                                                        {reportData.closingBalance < 0 ? formatCurrency(Math.abs(reportData.closingBalance)) : '-'}
                                                    </TableCell>
                                                    <TableCell className="text-right text-purple-900 text-lg">
                                                        {formatCurrency(reportData.closingBalance)}
                                                    </TableCell>
                                                </TableRow>
                                            </>
                                        )}
                                    </TableBody>
                                </Table>
                            </CardContent>
                        </div>
                    </Card>
                </div>
            </div>
        </ProtectedRoute>
    );
}
