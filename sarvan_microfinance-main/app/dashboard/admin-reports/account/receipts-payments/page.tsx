'use client';

import { useState, useRef, useEffect } from 'react';
import * as XLSX from 'xlsx-js-style';
import jsPDF from 'jspdf';
import { useReactToPrint } from 'react-to-print';
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
import {
    Receipt,
    Download,
    FileText,
    FileType,
    FileOutput,
    Printer,
    RefreshCw,
    Filter,
    ArrowDownCircle,
    ArrowUpCircle,
    TrendingUp,
    Wallet,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { useToast } from '@/hooks/use-toast';
import { useBrandNames } from '@/app/lib/brand-context';
import { usePermission } from '@/app/hooks/usePermission';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { drawReceiptsPaymentsReport } from '@/app/lib/reports/receipts-payments-pdf';
import { exportToCSV, exportToWord, type WordExportOptions } from '@/app/lib/report-export-utils';
import { applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { formatReportAmount } from '@/app/lib/utils/format-amount';
import { DateInput } from '@/components/ui/date-input';
import { toDisplayDate, toDisplayDateTime } from '@/app/lib/date-format';

interface ReceiptPaymentEntry {
    id: string;
    ledgerName: string;
    amount: number;
}

interface ReportData {
    receipts: ReceiptPaymentEntry[];
    payments: ReceiptPaymentEntry[];
    openingBalance: number;
    closingBalance: number;
    totalReceipts: number;
    totalPayments: number;
    fromDate: string;
    toDate: string;
    dateMode?: 'RANGE' | 'AS_ON';
    asOnDate?: string | null;
}

type DateMode = 'RANGE' | 'AS_ON';

interface User {
    id: string;
    employeeId: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    branchId: string;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}

const formatCurrency = (amount: number) => formatReportAmount(amount);

const formatDate = (dateString: string) => {
    if (!dateString) return '';
    return toDisplayDate(new Date(dateString));
};

const todayYmd = () =>
    new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date());

export default function ReceiptsPaymentsPage() {
    const { toast } = useToast();
    const { companyNameFull } = useBrandNames();
    const { canExportReport, getReportExportMode } = usePermission();
    const [user, setUser] = useState<User | null>(null);
    const [dateMode, setDateMode] = useState<DateMode>('RANGE');
    const [fromDate, setFromDate] = useState<string>(todayYmd());
    const [toDate, setToDate] = useState<string>(todayYmd());
    const [asOnDate, setAsOnDate] = useState<string>(todayYmd());
    const [selectedBranch, setSelectedBranch] = useState<string>('');
    const [branches, setBranches] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [reportData, setReportData] = useState<ReportData | null>(null);
    const printRef = useRef<HTMLDivElement>(null);
    const [isBranchLoaded, setIsBranchLoaded] = useState(false);

    // Get user from localStorage
    useEffect(() => {
        const storedUser = localStorage.getItem('user');
        if (storedUser) {
            try {
                const parsedUser = JSON.parse(storedUser);
                setUser(parsedUser);
                
                // For non-admin users, set the branch from localStorage immediately
                if (parsedUser.role !== 'ADMIN' && parsedUser.branchId) {
                    setSelectedBranch(parsedUser.branchId);
                    setIsBranchLoaded(true);
                }
            } catch (error) {
                console.error('Failed to parse user from localStorage:', error);
            }
        }
    }, []);

    // Determine if user is admin
    const isAdmin = user?.role === 'ADMIN';
    const isBranchManager = user?.role === 'BRANCH_MANAGER';
    const isAreaManager = user?.role === 'AREA_MANAGER';

    useEffect(() => {
        const fetchBranches = async () => {
            if (!user) return;
            
            try {
                const res = await fetch('/api/branches');
                const result = await res.json();
                if (result.success) {
                    let filteredBranches = result.data;
                    
                    // Filter branches based on user role
                    if (isBranchManager && user?.branchId) {
                        // Branch Manager - only show their assigned branch
                        filteredBranches = result.data.filter((b: any) => b.id === user.branchId);
                        // Ensure branch is selected
                        if (!selectedBranch && user.branchId) {
                            setSelectedBranch(user.branchId);
                            setIsBranchLoaded(true);
                        }
                    } else if (isAreaManager && user?.branchId) {
                        // Area Manager - show branches in their area
                        filteredBranches = result.data.filter((b: any) => b.areas?.some((a: any) => a.id === user.branchId));
                        // Auto-select first branch in their area
                        if (filteredBranches.length > 0 && !selectedBranch) {
                            setSelectedBranch(filteredBranches[0].id);
                            setIsBranchLoaded(true);
                        }
                    } else if (isAdmin) {
                        // For admin, we can set branch loaded true even without selection
                        setIsBranchLoaded(true);
                    }
                    
                    setBranches(filteredBranches);
                }
            } catch (error) {
                console.error('Failed to fetch branches:', error);
                setIsBranchLoaded(true); // Even on error, enable the button
            }
        };
        
        if (user) {
            fetchBranches();
        }
    }, [user, isBranchManager, isAreaManager, isAdmin]);

    const generateReport = async () => {
        // Validation for branch selection
        if (!isAdmin && !selectedBranch) {
            toast({ variant: 'destructive', title: 'Validation Error', description: 'Branch information is missing.' });
            return;
        }
        
        if (isAdmin && !selectedBranch) {
            toast({ variant: 'destructive', title: 'Validation Error', description: 'Please select a branch.' });
            return;
        }
        
        if (dateMode === 'RANGE') {
            if (!fromDate || !toDate) {
                toast({ variant: 'destructive', title: 'Validation Error', description: 'Please select both From Date and To Date.' });
                return;
            }
            if (new Date(fromDate) > new Date(toDate)) {
                toast({ variant: 'destructive', title: 'Validation Error', description: 'From Date cannot be after To Date.' });
                return;
            }
        } else if (!asOnDate) {
            toast({ variant: 'destructive', title: 'Validation Error', description: 'Please select an As on Date.' });
            return;
        }

        setIsLoading(true);
        toast({ title: 'Generating Report', description: 'Fetching data, please wait...' });

        try {
            const params = new URLSearchParams({
                reportType: dateMode,
                branchId: selectedBranch,
                ...(dateMode === 'RANGE' ? { fromDate, toDate } : { asOnDate }),
            });
            const res = await fetch(`/api/reports/receipts-payments?${params}`);
            const result = await res.json();

            if (result.success) {
                setReportData(result.data);
                const totalEntries = (result.data.receipts?.length || 0) + (result.data.payments?.length || 0);
                toast({
                    title: 'Report Generated',
                    description: `Loaded ${totalEntries} entries successfully.`,
                });
            } else {
                toast({ variant: 'destructive', title: 'Error', description: result.message || 'Failed to generate report.' });
            }
        } catch {
            toast({ variant: 'destructive', title: 'Network Error', description: 'Unable to connect to server. Please try again.' });
        } finally {
            setIsLoading(false);
        }
    };

    // Mirrors Trial Balance's periodLabel construction — RANGE keeps the existing
    // "FOR DATE BETWEEN X AND Y" phrasing, AS_ON reads "AS ON DATE X".
    const periodLabel = dateMode === 'RANGE'
        ? `FOR DATE BETWEEN ${formatDate(fromDate)} AND ${formatDate(toDate)}`
        : `AS ON DATE ${formatDate(asOnDate)}`;
    const fileDateLabel = dateMode === 'RANGE' ? `${fromDate}_to_${toDate}` : asOnDate;

    const handleExportExcel = () => {
        if (!reportData) {
            toast({ variant: 'destructive', title: 'No Data', description: 'Generate the report first before exporting.' });
            return;
        }

        try {
            const wb = XLSX.utils.book_new();

            const rows: any[] = [];
            rows.push([companyNameFull.toUpperCase()]);
            rows.push(['CONSOLIDATED']);
            rows.push([`RECEIPTS AND PAYMENTS REPORT ${periodLabel}`]);
            rows.push([]);
            rows.push(['RECEIPTS', '', 'PAYMENTS', '']);
            rows.push(['Ledger Name', 'Amount (₹)', 'Ledger Name', 'Amount (₹)']);

            const receiptsContent = [...(reportData.receipts || [])];
            receiptsContent.unshift({ id: 'opening', ledgerName: 'OPENING BALANCE:', amount: reportData.openingBalance });

            const paymentsContent = [...(reportData.payments || [])];
            paymentsContent.push({ id: 'closing', ledgerName: 'CLOSING BALANCE:', amount: reportData.closingBalance });

            const maxRows = Math.max(receiptsContent.length, paymentsContent.length);

            for (let i = 0; i < maxRows; i++) {
                const r = receiptsContent[i];
                const p = paymentsContent[i];
                rows.push([
                    r ? r.ledgerName : '',
                    r ? formatCurrency(r.amount) : '',
                    p ? p.ledgerName : '',
                    p ? formatCurrency(p.amount) : '',
                ]);
            }

            rows.push([]);
            rows.push([
                'TOTAL RECEIPTS',
                formatCurrency((reportData.openingBalance || 0) + (reportData.totalReceipts || 0)),
                'TOTAL PAYMENTS',
                formatCurrency((reportData.totalPayments || 0) + (reportData.closingBalance || 0)),
            ]);

            const ws = XLSX.utils.aoa_to_sheet(rows);
            ws['!cols'] = [{ wch: 35 }, { wch: 18 }, { wch: 35 }, { wch: 18 }];
            applyExcelReportFont(ws);
            XLSX.utils.book_append_sheet(wb, ws, 'Receipts & Payments');

            const fileName = `Receipts_Payments_${fileDateLabel}.xlsx`;
            XLSX.writeFile(wb, fileName);

            toast({ title: 'Export Successful', description: `Saved as ${fileName}` });
        } catch {
            toast({ variant: 'destructive', title: 'Export Failed', description: 'Failed to export Excel file.' });
        }
    };

    const handleExportPDF = async () => {
        if (!reportData) {
            toast({ variant: 'destructive', title: 'No Data', description: 'Generate the report first before exporting.' });
            return;
        }

        try {
            const doc = new jsPDF({ orientation: 'landscape' });
            const reportFont = await ensureReportFont(doc);

            await drawReceiptsPaymentsReport(
                doc,
                reportData,
                { subtitle: `CONSOLIDATED  •  ${periodLabel.toUpperCase()}` },
                reportFont
            );

            const fileName = `Receipts_Payments_${fileDateLabel}.pdf`;
            doc.save(fileName);

            toast({ title: 'Export Successful', description: `Saved as ${fileName}` });
        } catch {
            toast({ variant: 'destructive', title: 'Export Failed', description: 'Failed to export PDF file.' });
        }
    };

    // Mirrors the same field mapping used by handleExportExcel above (kept separate so
    // handleExportExcel is left untouched).
    const buildReceiptsPaymentsExportRows = (): { headers: string[]; rows: (string | number)[][] } => {
        if (!reportData) return { headers: [], rows: [] };
        const headers = ['Receipts - Ledger Name', 'Receipts - Amount (₹)', 'Payments - Ledger Name', 'Payments - Amount (₹)'];

        const receiptsContent = [...(reportData.receipts || [])];
        receiptsContent.unshift({ id: 'opening', ledgerName: 'OPENING BALANCE:', amount: reportData.openingBalance });

        const paymentsContent = [...(reportData.payments || [])];
        paymentsContent.push({ id: 'closing', ledgerName: 'CLOSING BALANCE:', amount: reportData.closingBalance });

        const maxRows = Math.max(receiptsContent.length, paymentsContent.length);
        const rows: (string | number)[][] = [];
        for (let i = 0; i < maxRows; i++) {
            const r = receiptsContent[i];
            const p = paymentsContent[i];
            rows.push([
                r ? r.ledgerName : '',
                r ? formatCurrency(r.amount) : '',
                p ? p.ledgerName : '',
                p ? formatCurrency(p.amount) : '',
            ]);
        }

        rows.push([
            'TOTAL RECEIPTS',
            formatCurrency((reportData.openingBalance || 0) + (reportData.totalReceipts || 0)),
            'TOTAL PAYMENTS',
            formatCurrency((reportData.totalPayments || 0) + (reportData.closingBalance || 0)),
        ]);

        return { headers, rows };
    };

    const handleExportCSV = () => {
        if (!reportData) {
            toast({ variant: 'destructive', title: 'No Data', description: 'Generate the report first before exporting.' });
            return;
        }
        const { headers, rows } = buildReceiptsPaymentsExportRows();
        exportToCSV(`Receipts_Payments_${fileDateLabel}`, 'RECEIPTS AND PAYMENTS REPORT', headers, rows);
    };

    // Word-only presentation: same rows as CSV above, but the trailing TOTAL RECEIPTS /
    // TOTAL PAYMENTS row is split off for distinct styling. Receipts (Ledger/Amount) and
    // Payments (Ledger/Amount) are the report's own two-sided layout — a genuine grouped
    // header, matching the PDF's own side-by-side columns.
    const buildReceiptsPaymentsWordOptions = (
        rows: (string | number)[][]
    ): { bodyRows: (string | number)[][]; options: WordExportOptions } => ({
        bodyRows: rows.slice(0, -1),
        options: {
            groupHeaders: [
                { label: 'RECEIPTS', span: 2 },
                { label: 'PAYMENTS', span: 2 },
            ],
            subHeaders: ['Ledger Name', 'Amount (₹)', 'Ledger Name', 'Amount (₹)'],
            columnAlignments: ['left', 'right', 'left', 'right'],
            columnWidthWeights: [16, 10, 16, 10],
            totalsRow: rows[rows.length - 1],
        },
    });

    const handleExportWord = async () => {
        if (!reportData) {
            toast({ variant: 'destructive', title: 'No Data', description: 'Generate the report first before exporting.' });
            return;
        }
        const { headers, rows } = buildReceiptsPaymentsExportRows();
        const { bodyRows, options } = buildReceiptsPaymentsWordOptions(rows);
        await exportToWord(`Receipts_Payments_${fileDateLabel}`, 'RECEIPTS AND PAYMENTS REPORT', headers, bodyRows, options);
    };

    const handlePrint = useReactToPrint({
        contentRef: printRef,
        documentTitle: `Receipts_Payments_${fileDateLabel}`,
        onBeforePrint: async () => {
            if (!reportData) {
                toast({ variant: 'destructive', title: 'No Data', description: 'Generate the report first before printing.' });
                throw new Error('No data');
            }
        },
    });

    const receipts = reportData?.receipts || [];
    const payments = reportData?.payments || [];

    const receiptsContent = reportData ? [{ id: 'opening', ledgerName: 'OPENING BALANCE:', amount: reportData.openingBalance }, ...reportData.receipts] : [];
    const paymentsContent = reportData ? [...reportData.payments, { id: 'closing', ledgerName: 'CLOSING BALANCE:', amount: reportData.closingBalance }] : [];

    const grandTotalReceipts = (reportData?.openingBalance || 0) + (reportData?.totalReceipts || 0);
    const grandTotalPayments = (reportData?.totalPayments || 0) + (reportData?.closingBalance || 0);

    // Determine if show button should be disabled
    const isShowButtonDisabled = () => {
        if (isLoading) return true;
        if (!user) return true;
        if (isAdmin && !selectedBranch) return true;
        if (!isAdmin && !selectedBranch) return true;
        return false;
    };

    return (
        <ProtectedRoute>
            <div className="relative min-h-screen bg-gradient-to-br from-background via-cyan-50/30 to-green-50/30 dark:from-background dark:via-brand-green-darker dark:to-green-950">
                <div className="container mx-auto px-3 sm:px-6 py-4 sm:py-8">

                    {/* Header */}
                    <div className="mb-8">
                        <div className="flex items-center gap-4 mb-2">
                            <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-600 to-primary shadow-lg shadow-cyan-500/30">
                                <Receipt className="h-7 w-7 text-white" />
                                <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/20 to-transparent" />
                            </div>
                            <div>
                                <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-foreground dark:text-white">
                                    Receipts &amp; Payments Report
                                </h1>
                                <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                                    Cash flow statement showing all receipts and payments for the selected period
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Summary Cards */}
                    {reportData && (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                            <Card className="border-2 border-green-200/50 dark:border-green-800/50 bg-gradient-to-br from-green-50 to-emerald-50/50 dark:from-green-950/20 dark:to-emerald-950/20">
                                <CardContent className="pt-6">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <p className="text-sm font-medium text-green-700 dark:text-green-300">Total Receipts</p>
                                            <p className="text-2xl font-bold text-green-900 dark:text-green-100 mt-1">
                                                ₹ {formatCurrency(reportData.totalReceipts)}
                                            </p>
                                            <p className="text-xs text-green-600 dark:text-green-400 mt-1">{receipts.length} entries</p>
                                        </div>
                                        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-green-100 dark:bg-green-900/50">
                                            <ArrowDownCircle className="h-6 w-6 text-green-600 dark:text-green-400" />
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>

                            <Card className="border-2 border-red-200/50 dark:border-red-800/50 bg-gradient-to-br from-red-50 to-rose-50/50 dark:from-red-950/20 dark:to-rose-950/20">
                                <CardContent className="pt-6">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <p className="text-sm font-medium text-red-700 dark:text-red-300">Total Payments</p>
                                            <p className="text-2xl font-bold text-red-900 dark:text-red-100 mt-1">
                                                ₹ {formatCurrency(reportData.totalPayments)}
                                            </p>
                                            <p className="text-xs text-red-600 dark:text-red-400 mt-1">{payments.length} entries</p>
                                        </div>
                                        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-100 dark:bg-red-900/50">
                                            <ArrowUpCircle className="h-6 w-6 text-red-600 dark:text-red-400" />
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>

                            <Card className="border-2 border-primary/30/50 dark:border-sidebar-accent/50 bg-gradient-to-br from-green-50 to-cyan-50/50 dark:from-brand-green-darker/20 dark:to-cyan-950/20">
                                <CardContent className="pt-6">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <p className="text-sm font-medium text-sidebar-accent dark:text-green-300">Opening Balance</p>
                                            <p className="text-2xl font-bold text-foreground dark:text-green-100 mt-1">
                                                ₹ {formatCurrency(reportData.openingBalance)}
                                            </p>
                                            <p className="text-xs text-primary dark:text-primary mt-1">
                                                {dateMode === 'RANGE' ? `As of ${formatDate(fromDate)}` : 'Since inception'}
                                            </p>
                                        </div>
                                        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-green-tint dark:bg-brand-green-darker/50">
                                            <TrendingUp className="h-6 w-6 text-primary dark:text-primary" />
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>

                            <Card className={cn(
                                'border-2',
                                reportData.closingBalance >= 0
                                    ? 'border-cyan-200/50 dark:border-cyan-800/50 bg-gradient-to-br from-cyan-50 to-green-50/50 dark:from-cyan-950/20 dark:to-brand-green-darker/20'
                                    : 'border-orange-200/50 dark:border-orange-800/50 bg-gradient-to-br from-orange-50 to-red-50/50 dark:from-orange-950/20 dark:to-red-950/20'
                            )}>
                                <CardContent className="pt-6">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <p className={cn('text-sm font-medium', reportData.closingBalance >= 0 ? 'text-cyan-700 dark:text-cyan-300' : 'text-orange-700 dark:text-orange-300')}>
                                                Closing Balance
                                            </p>
                                            <p className={cn('text-2xl font-bold mt-1', reportData.closingBalance >= 0 ? 'text-cyan-900 dark:text-cyan-100' : 'text-orange-900 dark:text-orange-100')}>
                                                ₹ {formatCurrency(Math.abs(reportData.closingBalance))}
                                            </p>
                                            <p className={cn('text-xs mt-1', reportData.closingBalance >= 0 ? 'text-cyan-600 dark:text-cyan-400' : 'text-orange-600 dark:text-orange-400')}>
                                                {reportData.closingBalance >= 0 ? 'Surplus' : 'Deficit'}
                                            </p>
                                        </div>
                                        <div className={cn('flex h-12 w-12 items-center justify-center rounded-xl', reportData.closingBalance >= 0 ? 'bg-cyan-100 dark:bg-cyan-900/50' : 'bg-orange-100 dark:bg-orange-900/50')}>
                                            <Wallet className={cn('h-6 w-6', reportData.closingBalance >= 0 ? 'text-cyan-600 dark:text-cyan-400' : 'text-orange-600 dark:text-orange-400')} />
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    )}

                    {/* Filters Card */}
                    <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden mb-6">
                        <div className="h-1.5 bg-gradient-to-r from-cyan-600 via-primary to-primary" />
                        <CardHeader className="bg-gradient-to-r from-slate-50 via-cyan-50/60 to-green-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                                <div className="flex items-center gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-100 dark:bg-cyan-900/30">
                                        <Filter className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
                                    </div>
                                    <div>
                                        <CardTitle className="text-xl">Report Parameters</CardTitle>
                                        <CardDescription>Select report type and date range</CardDescription>
                                    </div>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="pt-6">
                            <div className="flex flex-col md:flex-row gap-6">
                                {/* Branch Selection - Only show for ADMIN */}
                                {isAdmin && (
                                    <div className="space-y-2 flex-1">
                                        <Label htmlFor="branchId" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                            Branch <span className="text-red-500">*</span>
                                        </Label>
                                        <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                                            <SelectTrigger className="h-11 border-primary/30 dark:border-sidebar-accent">
                                                <SelectValue placeholder="Select Branch" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="all">ALL BRANCHES</SelectItem>
                                                <SelectItem value="head_office">HEAD OFFICE</SelectItem>
                                                {branches
                                                    .filter((b) => b.code !== 'HO' && b.name.toLowerCase() !== 'head office')
                                                    .map((b) => (
                                                    <SelectItem key={b.id} value={b.id}>
                                                        {b.code} - {b.name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                )}

                                {/* For non-admin users, show read-only branch info */}
                                {!isAdmin && user && (
                                    <div className="space-y-2 flex-1">
                                        <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                            Branch
                                        </Label>
                                        <div className="h-11 px-3 py-2 rounded-md border border-primary/30 dark:border-sidebar-accent bg-green-50 dark:bg-sidebar-accent text-sidebar-accent dark:text-slate-300">
                                            {branches.find(b => b.id === selectedBranch)?.name || 
                                             (user.role === 'BRANCH_MANAGER' ? 'Assigned Branch' : 'Loading...')}
                                        </div>
                                    </div>
                                )}

                                <div className="space-y-2 sm:w-48">
                                    <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Report Type <span className="text-red-500">*</span>
                                    </Label>
                                    <Select value={dateMode} onValueChange={(v) => setDateMode(v as DateMode)}>
                                        <SelectTrigger className="h-11 border-primary/30 dark:border-sidebar-accent">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="RANGE">Date Range</SelectItem>
                                            <SelectItem value="AS_ON">As on Date</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>

                                {dateMode === 'RANGE' ? (
                                    <>
                                        <div className="space-y-2 flex-1">
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

                                        <div className="space-y-2 flex-1">
                                            <Label htmlFor="toDate" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                                To Date <span className="text-red-500">*</span>
                                            </Label>
                                            <DateInput
                                                id="toDate"
                                                value={toDate}
                                                onChange={(e) => setToDate(e.target.value)}
                                                className="h-11 border-primary/30 dark:border-sidebar-accent"
                                            />
                                        </div>
                                    </>
                                ) : (
                                    <div className="space-y-2 flex-1">
                                        <Label htmlFor="asOnDate" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                            As on Date <span className="text-red-500">*</span>
                                        </Label>
                                        <DateInput
                                            id="asOnDate"
                                            value={asOnDate}
                                            onChange={(e) => setAsOnDate(e.target.value)}
                                            className="h-11 border-primary/30 dark:border-sidebar-accent"
                                        />
                                    </div>
                                )}

                                <div className="space-y-2 sm:w-48">
                                    <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-200 opacity-0">Action</Label>
                                    <Button
                                        onClick={generateReport}
                                        disabled={isShowButtonDisabled()}
                                        className="h-11 w-full bg-gradient-to-r from-cyan-600 to-primary hover:from-cyan-700 hover:to-sidebar-accent text-white shadow-lg shadow-cyan-500/30"
                                    >
                                        {isLoading ? (
                                            <>
                                                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                                                Generating...
                                            </>
                                        ) : (
                                            <>
                                                <Receipt className="h-4 w-4 mr-2" />
                                                Show Report
                                            </>
                                        )}
                                    </Button>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Report Table */}
                    <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden mt-6">
                        {/* Report Toolbar */}
                        {reportData && (
                            <div className="bg-white dark:bg-brand-green-darker border-b border-primary/20 dark:border-sidebar-accent p-3 flex items-center justify-between print:hidden">
                                <div className="flex items-center gap-2 text-sm text-sidebar-accent dark:text-slate-400">
                                    {/* Pagination Placeholder */}
                                    <Button variant="ghost" size="icon" disabled className="h-8 w-8 text-slate-400">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m11 17-5-5 5-5" /><path d="m18 17-5-5 5-5" /></svg>
                                    </Button>
                                    <Button variant="ghost" size="icon" disabled className="h-8 w-8 text-slate-400">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
                                    </Button>
                                    <span className="flex items-center gap-2 bg-brand-green-tint dark:bg-sidebar-accent px-3 py-1.5 rounded-md font-medium">
                                        1 <span className="text-slate-400 font-normal">of 1</span>
                                    </span>
                                    <Button variant="ghost" size="icon" disabled className="h-8 w-8 text-slate-400">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
                                    </Button>
                                    <Button variant="ghost" size="icon" disabled className="h-8 w-8 text-slate-400">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m13 17 5-5-5-5" /><path d="m6 17 5-5-5-5" /></svg>
                                    </Button>
                                </div>

                                <div className="flex items-center gap-2 pr-4">
                                    <ExportDropdown
                                        onExportPDF={handleExportPDF}
                                        onExportExcel={handleExportExcel}
                                        onExportCSV={handleExportCSV}
                                        onExportWord={handleExportWord}
                                        // Queue mode only supports RANGE — AS_ON is a page-only convenience not
                                        // modeled by the queue adapter (see report-registry.ts's fetchReceiptsPayments).
                                        reportSlug={dateMode === 'RANGE' && getReportExportMode('receipts-payments') === 'REQUEST_QUEUE' ? 'receipts-payments' : undefined}
                                        canExport={canExportReport('receipts-payments')}
                                        // Reads the echoed-back reportData dates (from the last successful fetch),
                                        // not the live draft fromDate/toDate/dateMode — same safe pattern as the
                                        // ReportHeader subtitle above, so editing the filters alone never changes
                                        // what gets exported. This block only renders when reportData is set.
                                        exportParams={{
                                            fromDate: reportData.dateMode === 'AS_ON' ? (reportData.asOnDate || reportData.fromDate) : reportData.fromDate,
                                            toDate: reportData.dateMode === 'AS_ON' ? (reportData.asOnDate || reportData.fromDate) : reportData.toDate,
                                            branchIds: selectedBranch && selectedBranch !== 'all' ? [selectedBranch] : 'ALL',
                                        }}
                                        className="h-8 border-green-300 text-green-700 hover:bg-green-50 dark:border-green-700 dark:text-green-300"
                                    />
                                    <div className="w-px h-6 bg-green-200 dark:bg-sidebar-accent mx-1"></div>
                                    <Button
                                        onClick={() => handlePrint()}
                                        size="sm"
                                        className="h-8 bg-sidebar-accent hover:bg-brand-green-darker text-white dark:bg-brand-green-tint dark:hover:bg-white dark:text-foreground shadow-sm"
                                        title="Print Report"
                                    >
                                        <Printer className="h-4 w-4 mr-2" />
                                        Print
                                    </Button>
                                </div>
                            </div>
                        )}

                        <div className="h-1.5 bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600" />

                        <div ref={printRef} className="print:p-6">
                            {/* Report Header */}
                            <CardHeader className="bg-gradient-to-r from-slate-50 via-cyan-50/60 to-green-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker print:bg-white border-b">
                                <ReportHeader
                                    title="RECEIPTS AND PAYMENTS REPORT"
                                    subtitle={
                                        reportData
                                            ? reportData.dateMode === 'AS_ON'
                                                ? `CONSOLIDATED  •  AS ON DATE ${formatDate(reportData.asOnDate || reportData.fromDate)}`
                                                : `CONSOLIDATED  •  For the period from ${formatDate(reportData.fromDate)} to ${formatDate(reportData.toDate)}`
                                            : 'CONSOLIDATED'
                                    }
                                />
                            </CardHeader>

                            <CardContent className="p-0">
                                {!reportData && !isLoading && (
                                    <div className="flex flex-col items-center justify-center h-48 text-slate-500 dark:text-slate-400">
                                        <Receipt className="h-12 w-12 mb-3 opacity-30" />
                                        <p className="text-lg font-medium">No report generated yet</p>
                                        <p className="text-sm">Select parameters above and click "Show Report"</p>
                                    </div>
                                )}

                                {isLoading && (
                                    <div className="flex flex-col items-center justify-center h-48 text-slate-500 dark:text-slate-400">
                                        <RefreshCw className="h-10 w-10 mb-3 animate-spin text-cyan-500" />
                                        <p className="text-lg font-medium">Generating report...</p>
                                    </div>
                                )}

                                {reportData && !isLoading && (
                                    <div className="border border-dashed border-sidebar-accent/60 p-2 sm:p-4 bg-white mx-auto print:border-black w-full" style={{ maxWidth: '1000px' }}>
                                        <div className="flex flex-col md:flex-row gap-[4px] w-full">

                                            {/* Receipts Table */}
                                            <div className="flex-1 overflow-x-auto border-2 border-black h-fit">
                                                <Table className="border-collapse w-full">
                                                    <TableHeader>
                                                        <TableRow className="hover:bg-transparent border-b-2 border-black">
                                                            <TableHead colSpan={2} className="text-black font-bold text-[13px] text-center py-2 px-4 uppercase tracking-wider h-10">
                                                                RECEIPTS
                                                            </TableHead>
                                                        </TableRow>
                                                        <TableRow className="hover:bg-transparent border-b-2 border-black">
                                                            <TableHead className="text-black font-bold text-xs text-center py-1.5 px-3 border-r border-black w-2/3 h-8">
                                                                Ledger Name
                                                            </TableHead>
                                                            <TableHead className="text-black font-bold text-xs text-center py-1.5 px-3 w-1/3 h-8">
                                                                Closing
                                                            </TableHead>
                                                        </TableRow>
                                                    </TableHeader>
                                                    <TableBody>
                                                        {receiptsContent.map((r, i) => (
                                                            <TableRow key={i} className="hover:bg-green-50 border-b border-black last:border-0">
                                                                <TableCell className={cn("text-sidebar-accent dark:text-slate-200 px-3 py-1.5 border-r border-black uppercase text-[11px] leading-tight", i === 0 && 'font-bold')}>
                                                                    {r.ledgerName}
                                                                </TableCell>
                                                                <TableCell className={cn("text-right text-sidebar-accent dark:text-slate-200 px-3 py-1.5 text-[11px] leading-tight", i === 0 && 'font-bold')}>
                                                                    ₹ {formatCurrency(r.amount)}
                                                                </TableCell>
                                                            </TableRow>
                                                        ))}
                                                        {/* Grand Total Row */}
                                                        <TableRow className="border-t-2 border-black">
                                                            <TableCell className="font-bold text-foreground text-[11px] px-3 py-2 border-r border-black text-right uppercase">
                                                                TOTAL RECEIPTS
                                                            </TableCell>
                                                            <TableCell className="text-right font-bold text-foreground text-[11px] px-3 py-2">
                                                                ₹ {formatCurrency(grandTotalReceipts)}
                                                            </TableCell>
                                                        </TableRow>
                                                    </TableBody>
                                                </Table>
                                            </div>

                                            {/* Payments Table */}
                                            <div className="flex-1 overflow-x-auto border-2 border-black h-fit">
                                                <Table className="border-collapse w-full">
                                                    <TableHeader>
                                                        <TableRow className="hover:bg-transparent border-b-2 border-black">
                                                            <TableHead colSpan={2} className="text-black font-bold text-[13px] text-center py-2 px-4 uppercase tracking-wider h-10">
                                                                PAYMENTS
                                                            </TableHead>
                                                        </TableRow>
                                                        <TableRow className="hover:bg-transparent border-b-2 border-black">
                                                            <TableHead className="text-black font-bold text-xs text-center py-1.5 px-3 border-r border-black w-2/3 h-8">
                                                                Ledger Name
                                                            </TableHead>
                                                            <TableHead className="text-black font-bold text-xs text-center py-1.5 px-3 w-1/3 h-8">
                                                                Closing
                                                            </TableHead>
                                                        </TableRow>
                                                    </TableHeader>
                                                    <TableBody>
                                                        {paymentsContent.map((p, i) => (
                                                            <TableRow key={i} className="hover:bg-green-50 border-b border-black last:border-0">
                                                                <TableCell className={cn("text-sidebar-accent dark:text-slate-200 px-3 py-1.5 border-r border-black uppercase text-[11px] leading-tight", i === paymentsContent.length - 1 && 'font-bold')}>
                                                                    {p.ledgerName}
                                                                </TableCell>
                                                                <TableCell className={cn("text-right text-sidebar-accent dark:text-slate-200 px-3 py-1.5 text-[11px] leading-tight", i === paymentsContent.length - 1 && 'font-bold')}>
                                                                    ₹ {formatCurrency(p.amount)}
                                                                </TableCell>
                                                            </TableRow>
                                                        ))}
                                                        {/* Grand Total Row */}
                                                        <TableRow className="border-t-2 border-black">
                                                            <TableCell className="font-bold text-foreground text-[11px] px-3 py-2 border-r border-black text-right uppercase">
                                                                TOTAL PAYMENTS
                                                            </TableCell>
                                                            <TableCell className="text-right font-bold text-foreground text-[11px] px-3 py-2">
                                                                ₹ {formatCurrency(grandTotalPayments)}
                                                            </TableCell>
                                                        </TableRow>
                                                    </TableBody>
                                                </Table>
                                            </div>

                                        </div>
                                    </div>
                                )}
                            </CardContent>
                        </div>
                    </Card>

                    {/* Footer */}
                    {reportData && (
                        <div className="mt-4 flex items-center justify-between text-sm text-slate-500 dark:text-slate-400 print:hidden">
                            <p>Report generated on {toDisplayDateTime(new Date())}</p>
                            <p>
                                Net Cash Flow:{' '}
                                <span className={cn('font-semibold', reportData.closingBalance >= 0 ? 'text-green-600' : 'text-red-600')}>
                                    {reportData.closingBalance >= 0 ? '+' : '-'} ₹ {formatCurrency(Math.abs(reportData.closingBalance))}
                                </span>
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </ProtectedRoute>
    );
}
