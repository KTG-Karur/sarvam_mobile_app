'use client';

import { useEffect, useRef, useState } from 'react';
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
import { cn } from '@/lib/utils';
import { apiClient } from '@/app/lib/api-client';
import { tokenStorage, type StoredUser } from '@/app/lib/token-storage';
import { useToast } from '@/hooks/use-toast';
import { useReactToPrint } from 'react-to-print';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { usePermission } from '@/app/hooks/usePermission';
import jsPDF from 'jspdf';
import * as XLSX from 'xlsx-js-style';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { drawTrialBalanceReport } from '@/app/lib/reports/trial-balance-pdf';
import { reportHeaderRows, autoSizeColumns, applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { exportToCSV, exportToWord, type WordExportOptions } from '@/app/lib/report-export-utils';
import { formatReportAmount, truncateReportAmount } from '@/app/lib/utils/format-amount';
import {
    Scale,
    RefreshCw,
    Filter,
    IndianRupee,
    TrendingUp,
    CheckCircle2,
    AlertCircle,
    Search,
    ChevronDown,
    Calendar,
    Printer,
} from 'lucide-react';
import { DateInput } from '@/components/ui/date-input';
import { toDisplayDateTime } from '@/app/lib/date-format';

type ReportType = 'RANGE' | 'AS_ON';
type ViewType = 'CONDENSED' | 'DETAILED';

interface Branch {
    id: string;
    name: string;
    code: string;
}

type TrialBalanceRow = {
    groupPath: { groupId: string; groupName: string }[];
    ledgerCode: string;
    ledgerName: string;
    openingDebit: number;
    openingCredit: number;
    txnDebit: number;
    txnCredit: number;
    closingDebit: number;
    closingCredit: number;
};

type Totals = {
    openingDebit: number;
    openingCredit: number;
    txnDebit: number;
    txnCredit: number;
    closingDebit: number;
    closingCredit: number;
};

type DisplayRow =
    | { kind: 'group'; depth: number; groupName: string; totals?: Totals }
    | { kind: 'ledger'; depth: number; row: TrialBalanceRow };

const emptyTotals = (): Totals => ({
    openingDebit: 0, openingCredit: 0, txnDebit: 0, txnCredit: 0, closingDebit: 0, closingCredit: 0,
});

const addTotals = (a: Totals, r: TrialBalanceRow) => {
    a.openingDebit += r.openingDebit;
    a.openingCredit += r.openingCredit;
    a.txnDebit += r.txnDebit;
    a.txnCredit += r.txnCredit;
    a.closingDebit += r.closingDebit;
    a.closingCredit += r.closingCredit;
};

const formatCurrency = (amount: number) => formatReportAmount(Math.abs(amount || 0));

// Plain YYYY-MM-DD -> DD-MM-YYYY, matching this report's own export title convention
// (distinct from Ledger Report's DD/MM/YYYY slashes).
const formatDateForDisplay = (dateString: string | null | undefined) => {
    if (!dateString) return '';
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString);
    if (match) {
        const [, year, month, day] = match;
        return `${day}/${month}/${year}`;
    }
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
};

const todayYmd = () =>
    new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date());

// Builds the interleaved group-header + ledger display list from the sorted flat row
// list, and per-primary-group aggregate totals (rows are pre-sorted by groupPath by
// the API, so a group boundary only ever needs to be detected once per pass).
function buildDisplayRows(rows: TrialBalanceRow[]): DisplayRow[] {
    const primaryTotals = new Map<string, Totals>();
    rows.forEach((r) => {
        const key = r.groupPath[0]?.groupName ?? 'UNCLASSIFIED';
        const t = primaryTotals.get(key) ?? emptyTotals();
        addTotals(t, r);
        primaryTotals.set(key, t);
    });

    const display: DisplayRow[] = [];
    let prevPath: string[] = [];

    rows.forEach((r) => {
        const path = r.groupPath.map((p) => p.groupName);
        for (let depth = 0; depth < path.length; depth++) {
            if (path[depth] !== prevPath[depth]) {
                for (let d = depth; d < path.length; d++) {
                    display.push({
                        kind: 'group',
                        depth: d,
                        groupName: path[d],
                        totals: d === 0 ? primaryTotals.get(path[0]) : undefined,
                    });
                }
                break;
            }
        }
        display.push({ kind: 'ledger', depth: path.length, row: r });
        prevPath = path;
    });

    return display;
}

export function TrialBalanceClient() {
    const { toast } = useToast();
    const { canExportReport, getReportExportMode } = usePermission();
    const printRef = useRef<HTMLDivElement>(null);
    const branchDropdownRef = useRef<HTMLDivElement>(null);

    const [currentUser, setCurrentUser] = useState<StoredUser | null>(null);

    const [branches, setBranches] = useState<Branch[]>([]);
    const [isFetchingBranches, setIsFetchingBranches] = useState(true);
    const [selectedBranchId, setSelectedBranchId] = useState<string>('all');
    const [allowAllBranches, setAllowAllBranches] = useState(true);
    const [branchSearchQuery, setBranchSearchQuery] = useState('');
    const [isBranchDropdownOpen, setIsBranchDropdownOpen] = useState(false);

    const [reportType, setReportType] = useState<ReportType>('AS_ON');
    const [fromDate, setFromDate] = useState<string>(todayYmd());
    const [tillDate, setTillDate] = useState<string>(todayYmd());
    const [asOnDate, setAsOnDate] = useState<string>(todayYmd());

    // Submitted (applied) date-mode snapshot — frozen until the next Search click. Export
    // filenames/subtitles/on-screen labels/exportParams read this, not the live draft
    // reportType/fromDate/tillDate/asOnDate, so editing the date mode or dates alone never
    // changes what's shown for the already-fetched report.
    const [submittedReportType, setSubmittedReportType] = useState<ReportType>(reportType);
    const [submittedFromDate, setSubmittedFromDate] = useState(fromDate);
    const [submittedTillDate, setSubmittedTillDate] = useState(tillDate);
    const [submittedAsOnDate, setSubmittedAsOnDate] = useState(asOnDate);

    const [viewType, setViewType] = useState<ViewType>('DETAILED');

    const [isLoading, setIsLoading] = useState(false);
    const [showReport, setShowReport] = useState(false);
    const [rows, setRows] = useState<TrialBalanceRow[]>([]);

    // Resolve the logged-in user client-side, then fetch a role-scoped branch list —
    // same convention as OpeningBalanceClient: ADMIN sees all, AREA_MANAGER sees only
    // assigned branches, everyone else only sees (and is auto-set to) their own branch.
    useEffect(() => {
        const user = tokenStorage.getUser();
        setCurrentUser(user);

        const fetchBranches = async () => {
            setIsFetchingBranches(true);
            try {
                if (user?.role === 'ADMIN') {
                    const res = await apiClient.get<Branch[]>('/branches?includeInactive=false');
                    if (res.success && res.data) setBranches(res.data);
                    setAllowAllBranches(true);
                } else if (user?.role === 'AREA_MANAGER') {
                    const res = await apiClient.get<{ branch: Branch }[]>(
                        `/area-manager-branches?userId=${user.id}`
                    );
                    if (res.success && res.data) setBranches(res.data.map((a) => a.branch));
                    setAllowAllBranches(true);
                } else if (user?.branchId) {
                    const res = await apiClient.get<Branch[]>('/branches?includeInactive=false');
                    if (res.success && res.data) {
                        const own = res.data.filter((b) => b.id === user.branchId);
                        setBranches(own);
                        if (own.length > 0) setSelectedBranchId(own[0].id);
                    }
                    setAllowAllBranches(false);
                }
            } catch (error) {
                console.error('Failed to fetch branches:', error);
                toast({ title: 'Error', description: 'Could not fetch branch list.', variant: 'destructive' });
            } finally {
                setIsFetchingBranches(false);
            }
        };
        fetchBranches();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (branchDropdownRef.current && !branchDropdownRef.current.contains(event.target as Node)) {
                setIsBranchDropdownOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const filteredBranches = branches.filter(
        (b) =>
            b.name.toLowerCase().includes(branchSearchQuery.toLowerCase()) ||
            b.code.toLowerCase().includes(branchSearchQuery.toLowerCase())
    );

    const selectedBranch = branches.find((b) => b.id === selectedBranchId) || null;
    const branchLabel = selectedBranchId === 'all' ? 'All Branches' : selectedBranch ? `${selectedBranch.code} - ${selectedBranch.name}` : selectedBranchId;

    const handleSelectBranch = (branchId: string) => {
        setSelectedBranchId(branchId);
        setIsBranchDropdownOpen(false);
        setBranchSearchQuery('');
    };

    const periodLabel = submittedReportType === 'RANGE'
        ? `PERIOD: ${formatDateForDisplay(submittedFromDate)} to ${formatDateForDisplay(submittedTillDate)}`
        : `AS ON DATE ${formatDateForDisplay(submittedAsOnDate)}`;

    const handleSearch = async () => {
        if (reportType === 'RANGE') {
            if (!fromDate || !tillDate) {
                toast({ title: 'Date range required', description: 'Please select both From Date and To Date.', variant: 'destructive' });
                return;
            }
            if (new Date(fromDate) > new Date(tillDate)) {
                toast({ title: 'Invalid date range', description: 'From Date cannot be after To Date.', variant: 'destructive' });
                return;
            }
        } else if (!asOnDate) {
            toast({ title: 'Date required', description: 'Please select an As On Date.', variant: 'destructive' });
            return;
        }

        setIsLoading(true);
        try {
            const params = new URLSearchParams();
            params.append('reportType', reportType);
            if (reportType === 'RANGE') {
                params.append('fromDate', fromDate);
                params.append('toDate', tillDate);
            } else {
                params.append('asOnDate', asOnDate);
            }
            params.append('branchId', selectedBranchId);

            const res = await apiClient.get<{ rows: TrialBalanceRow[] }>(`/reports/trial-balance?${params.toString()}`);
            if (!res.success || !res.data) {
                throw new Error(res.message || res.error || 'Failed to fetch trial balance data');
            }

            setRows(res.data.rows || []);
            setShowReport(true);
            setSubmittedReportType(reportType);
            setSubmittedFromDate(fromDate);
            setSubmittedTillDate(tillDate);
            setSubmittedAsOnDate(asOnDate);
            toast({ title: 'Report Generated', description: 'Successfully loaded trial balance data.' });
        } catch (error: any) {
            console.error('Trial balance fetch error:', error);
            setRows([]);
            setShowReport(false);
            toast({ variant: 'destructive', title: 'Error', description: error.message || 'Failed to load report data.' });
        } finally {
            setIsLoading(false);
        }
    };

    const handleReset = () => {
        setShowReport(false);
        setRows([]);
        setReportType('AS_ON');
        setFromDate(todayYmd());
        setTillDate(todayYmd());
        setAsOnDate(todayYmd());
        setViewType('DETAILED');
        if (allowAllBranches) setSelectedBranchId('all');
    };

    const displayRows = buildDisplayRows(rows);

    const grandTotal = rows.reduce((acc, r) => {
        addTotals(acc, r);
        return acc;
    }, emptyTotals());

    const roundedClosingDebit = Math.round(grandTotal.closingDebit * 100) / 100;
    const roundedClosingCredit = Math.round(grandTotal.closingCredit * 100) / 100;
    const difference = Math.abs(roundedClosingDebit - roundedClosingCredit);
    const isBalanced = difference < 0.01;

    const handlePrint = useReactToPrint({
        contentRef: printRef,
        documentTitle: `TrialBalance_${submittedAsOnDate}`,
    });

    // Shared row-builder for every export target — S.No only increments on primary
    // group boundaries (matching the Tally-style print layout), indentation is
    // represented as leading spaces since plain-text/table export formats don't
    // support CSS padding.
    const buildTrialBalanceExportRows = (): { headers: string[]; rows: (string | number)[][] } => {
        const headers = viewType === 'DETAILED'
            ? ['S.No', 'Particulars', 'Account Code', 'Opening Debit', 'Opening Credit', 'Transaction Debit', 'Transaction Credit', 'Closing Debit', 'Closing Credit']
            : ['S.No', 'Particulars', 'Account Code', 'Closing Debit', 'Closing Credit'];

        const exportRows: (string | number)[][] = [];
        let sNo = 0;

        displayRows.forEach((dr) => {
            const indent = '    '.repeat(dr.depth);
            if (dr.kind === 'group') {
                const label = `${indent}${dr.groupName}`;
                if (dr.depth === 0) {
                    sNo += 1;
                    const t = dr.totals ?? emptyTotals();
                    exportRows.push(
                        viewType === 'DETAILED'
                            ? [sNo, label, '', truncateReportAmount(t.openingDebit), truncateReportAmount(t.openingCredit), truncateReportAmount(t.txnDebit), truncateReportAmount(t.txnCredit), truncateReportAmount(t.closingDebit), truncateReportAmount(t.closingCredit)]
                            : [sNo, label, '', truncateReportAmount(t.closingDebit), truncateReportAmount(t.closingCredit)]
                    );
                } else {
                    exportRows.push(
                        viewType === 'DETAILED'
                            ? ['', label, '', '', '', '', '', '', '']
                            : ['', label, '', '', '']
                    );
                }
            } else {
                const r = dr.row;
                const label = `${indent}${r.ledgerName}`;
                exportRows.push(
                    viewType === 'DETAILED'
                        ? ['', label, r.ledgerCode, truncateReportAmount(r.openingDebit), truncateReportAmount(r.openingCredit), truncateReportAmount(r.txnDebit), truncateReportAmount(r.txnCredit), truncateReportAmount(r.closingDebit), truncateReportAmount(r.closingCredit)]
                        : ['', label, r.ledgerCode, truncateReportAmount(r.closingDebit), truncateReportAmount(r.closingCredit)]
                );
            }
        });

        exportRows.push(
            viewType === 'DETAILED'
                ? ['', 'GRAND TOTAL', '', truncateReportAmount(grandTotal.openingDebit), truncateReportAmount(grandTotal.openingCredit), truncateReportAmount(grandTotal.txnDebit), truncateReportAmount(grandTotal.txnCredit), truncateReportAmount(roundedClosingDebit), truncateReportAmount(roundedClosingCredit)]
                : ['', 'GRAND TOTAL', '', truncateReportAmount(roundedClosingDebit), truncateReportAmount(roundedClosingCredit)]
        );

        return { headers, rows: exportRows };
    };

    const exportTitle = `TRIAL BALANCE REPORT — ${branchLabel} — ${periodLabel}`;
    const exportFileNameBase = `TrialBalance_${selectedBranch?.code || 'ALL'}_${submittedReportType === 'RANGE' ? submittedTillDate : submittedAsOnDate}`;

    const handleExportExcel = () => {
        if (rows.length === 0) {
            toast({ variant: 'destructive', title: 'No Data', description: 'No data available to export.' });
            return;
        }
        try {
            const { headers, rows: exportRows } = buildTrialBalanceExportRows();
            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.aoa_to_sheet([...reportHeaderRows(exportTitle), headers, ...exportRows]);
            autoSizeColumns(ws);
            applyExcelReportFont(ws);
            XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
            XLSX.writeFile(wb, `${exportFileNameBase}.xlsx`);
            toast({ title: 'Export Successful', description: 'The trial balance has been downloaded.' });
        } catch (error) {
            console.error('Excel Export Error:', error);
            toast({ variant: 'destructive', title: 'Export Failed', description: 'Failed to export data to Excel.' });
        }
    };

    const handleExportPDF = async () => {
        if (rows.length === 0) {
            toast({ variant: 'destructive', title: 'No Data', description: 'No data available to export.' });
            return;
        }
        try {
            const doc = new jsPDF({ orientation: 'landscape' });
            const reportFont = await ensureReportFont(doc);
            const { headers, rows: exportRows } = buildTrialBalanceExportRows();
            await drawTrialBalanceReport(doc, headers, exportRows, { subtitle: `${branchLabel}  •  ${periodLabel}` }, reportFont);
            doc.save(`${exportFileNameBase}.pdf`);
            toast({ title: 'Export Successful', description: 'Report exported to PDF successfully.' });
        } catch (error) {
            console.error('PDF Export Error:', error);
            toast({ variant: 'destructive', title: 'Export Failed', description: 'Failed to export data to PDF.' });
        }
    };

    const handleExportCSV = () => {
        if (rows.length === 0) {
            toast({ variant: 'destructive', title: 'No Data', description: 'No data available to export.' });
            return;
        }
        const { headers, rows: exportRows } = buildTrialBalanceExportRows();
        exportToCSV(exportFileNameBase, exportTitle, headers, exportRows);
    };

    // Word-only presentation layer: same rows/headers as Excel/CSV/PDF above, but the
    // trailing GRAND TOTAL row is split off for distinct styling and (DETAILED view only)
    // the Opening/Transaction/Closing Debit-Credit pairs get a 2-row grouped header —
    // genuine Dr/Cr pairing, not forced grouping. Condensed view stays flat (only 5 cols).
    const buildTrialBalanceWordOptions = (
        exportRows: (string | number)[][]
    ): { bodyRows: (string | number)[][]; options: WordExportOptions } => {
        const totalsRow = exportRows[exportRows.length - 1];
        const bodyRows = exportRows.slice(0, -1);

        if (viewType === 'DETAILED') {
            return {
                bodyRows,
                options: {
                    groupHeaders: [
                        { label: 'S.No', span: 1 },
                        { label: 'Particulars', span: 1 },
                        { label: 'Account Code', span: 1 },
                        { label: 'OPENING', span: 2 },
                        { label: 'TRANSACTION', span: 2 },
                        { label: 'CLOSING', span: 2 },
                    ],
                    subHeaders: ['Debit', 'Credit', 'Debit', 'Credit', 'Debit', 'Credit'],
                    columnAlignments: ['center', 'left', 'center', 'right', 'right', 'right', 'right', 'right', 'right'],
                    columnWidthWeights: [4, 20, 8, 10, 10, 10, 10, 10, 10],
                    totalsRow,
                },
            };
        }

        return {
            bodyRows,
            options: {
                columnAlignments: ['center', 'left', 'center', 'right', 'right'],
                columnWidthWeights: [4, 30, 10, 14, 14],
                totalsRow,
            },
        };
    };

    const handleExportWord = async () => {
        if (rows.length === 0) {
            toast({ variant: 'destructive', title: 'No Data', description: 'No data available to export.' });
            return;
        }
        const { headers, rows: exportRows } = buildTrialBalanceExportRows();
        const { bodyRows, options } = buildTrialBalanceWordOptions(exportRows);
        await exportToWord(exportFileNameBase, exportTitle, headers, bodyRows, options);
    };

    const amountColSpanDetailed = 6;
    const amountColSpanCondensed = 2;

    return (
        <div className="relative w-full">
            {/* Header Section */}
            <div className="mb-8">
                <div className="flex items-center gap-4 mb-4">
                    <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary shadow-lg shadow-primary/30">
                        <Scale className="h-7 w-7 text-white" />
                        <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/20 to-transparent" />
                    </div>
                    <div className="flex-1">
                        <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-foreground dark:text-white">
                            Trial Balance
                        </h1>
                        <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                            Statement of all ledger balances to verify accounting accuracy
                        </p>
                    </div>
                </div>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <Card className="border-2 border-emerald-200/50 dark:border-emerald-800/50 bg-gradient-to-br from-emerald-50 to-green-50/50 dark:from-emerald-950/20 dark:to-green-950/20">
                    <CardContent className="pt-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">Total Debits (Closing)</p>
                                <p className="text-2xl font-bold text-emerald-900 dark:text-emerald-100 mt-2">₹ {formatCurrency(roundedClosingDebit)}</p>
                            </div>
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100 dark:bg-emerald-900/50">
                                <IndianRupee className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-2 border-rose-200/50 dark:border-rose-800/50 bg-gradient-to-br from-rose-50 to-red-50/50 dark:from-rose-950/20 dark:to-red-950/20">
                    <CardContent className="pt-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm font-medium text-rose-700 dark:text-rose-300">Total Credits (Closing)</p>
                                <p className="text-2xl font-bold text-rose-900 dark:text-rose-100 mt-2">₹ {formatCurrency(roundedClosingCredit)}</p>
                            </div>
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-rose-100 dark:bg-rose-900/50">
                                <IndianRupee className="h-6 w-6 text-rose-600 dark:text-rose-400" />
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className={cn('border-2', isBalanced ? 'border-primary/30 bg-green-50 dark:bg-green-950/20' : 'border-amber-200/50 bg-amber-50 dark:bg-amber-950/20')}>
                    <CardContent className="pt-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className={cn('text-sm font-medium', isBalanced ? 'text-sidebar-accent dark:text-primary' : 'text-amber-700 dark:text-amber-400')}>Difference</p>
                                <p className={cn('text-2xl font-bold mt-2', isBalanced ? 'text-foreground dark:text-green-100' : 'text-amber-900 dark:text-amber-100')}>₹ {formatCurrency(difference)}</p>
                            </div>
                            <div className={cn('flex h-12 w-12 items-center justify-center rounded-xl', isBalanced ? 'bg-brand-green-tint dark:bg-brand-green-darker/50' : 'bg-amber-100 dark:bg-amber-900/50')}>
                                <TrendingUp className={cn('h-6 w-6', isBalanced ? 'text-primary' : 'text-amber-600')} />
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className={cn('border-2', isBalanced ? 'border-emerald-200/50 bg-emerald-50 dark:bg-emerald-950/20' : 'border-rose-200/50 bg-rose-50 dark:bg-rose-950/20')}>
                    <CardContent className="pt-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className={cn('text-sm font-medium', isBalanced ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400')}>Status</p>
                                <p className={cn('text-2xl font-bold mt-2', isBalanced ? 'text-emerald-900 dark:text-emerald-100' : 'text-rose-900 dark:text-rose-100')}>
                                    {isBalanced ? 'Balanced' : 'Unbalanced'}
                                </p>
                            </div>
                            <div className={cn('flex h-12 w-12 items-center justify-center rounded-xl', isBalanced ? 'bg-emerald-100 dark:bg-emerald-900/50' : 'bg-rose-100 dark:bg-rose-900/50')}>
                                {isBalanced ? <CheckCircle2 className="h-6 w-6 text-emerald-600" /> : <AlertCircle className="h-6 w-6 text-rose-600" />}
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Filters Card */}
            <Card className="border-2 border-primary/20 dark:border-sidebar-accent/60 shadow-xl overflow-visible mb-6 relative">
                <div className="h-1.5 bg-gradient-to-r from-primary via-primary to-purple-600" />
                <CardHeader className="bg-gradient-to-r from-slate-50 via-green-50/60 to-green-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-green-tint dark:bg-brand-green-darker/30">
                            <Filter className="h-5 w-5 text-primary dark:text-primary" />
                        </div>
                        <div>
                            <CardTitle className="text-xl">Report Parameters</CardTitle>
                            <CardDescription>Select date mode, branch and view type</CardDescription>
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
                                    <SelectItem value="AS_ON">As On Date</SelectItem>
                                    <SelectItem value="RANGE">From Date - To Date</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Branch — searchable select */}
                        <div className="space-y-2 relative" ref={branchDropdownRef}>
                            <Label htmlFor="branch" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                Branch <span className="text-red-500">*</span>
                            </Label>
                            <div
                                className={cn(
                                    'h-11 border border-primary/30 dark:border-sidebar-accent rounded-md px-3 flex items-center justify-between cursor-pointer bg-white dark:bg-green-950',
                                    isFetchingBranches && 'opacity-60 cursor-not-allowed'
                                )}
                                onClick={() => !isFetchingBranches && setIsBranchDropdownOpen(!isBranchDropdownOpen)}
                            >
                                <span className={selectedBranchId ? 'text-foreground dark:text-white truncate' : 'text-slate-500 dark:text-slate-400'}>
                                    {isFetchingBranches ? 'Fetching...' : branchLabel}
                                </span>
                                {isFetchingBranches ? (
                                    <RefreshCw className="h-4 w-4 opacity-50 animate-spin" />
                                ) : (
                                    <ChevronDown className="h-4 w-4 opacity-50" />
                                )}
                            </div>

                            {isBranchDropdownOpen && (
                                <div className="absolute z-50 w-full mt-1 bg-white dark:bg-green-950 border border-primary/20 dark:border-sidebar-accent rounded-md shadow-lg overflow-hidden">
                                    <div className="p-2 border-b border-slate-100 dark:border-sidebar-accent flex items-center gap-2">
                                        <Search className="h-4 w-4 text-slate-400" />
                                        <Input
                                            placeholder="Search branch..."
                                            value={branchSearchQuery}
                                            onChange={(e) => setBranchSearchQuery(e.target.value)}
                                            className="h-8 border-none focus-visible:ring-0 px-0 shadow-none text-sm"
                                            autoFocus
                                        />
                                    </div>
                                    <div className="max-h-60 overflow-auto p-1">
                                        {allowAllBranches && (
                                            <div
                                                className={cn(
                                                    'px-2 py-1.5 text-sm rounded-sm cursor-pointer hover:bg-brand-green-tint dark:hover:bg-sidebar-accent',
                                                    selectedBranchId === 'all' && 'bg-green-50 dark:bg-brand-green-darker/50 text-primary dark:text-primary font-medium'
                                                )}
                                                onClick={() => handleSelectBranch('all')}
                                            >
                                                All Branches
                                            </div>
                                        )}
                                        {filteredBranches.map((b) => (
                                            <div
                                                key={b.id}
                                                className={cn(
                                                    'px-2 py-1.5 text-sm rounded-sm cursor-pointer hover:bg-brand-green-tint dark:hover:bg-sidebar-accent truncate',
                                                    selectedBranchId === b.id && 'bg-green-50 dark:bg-brand-green-darker/50 text-primary dark:text-primary font-medium'
                                                )}
                                                onClick={() => handleSelectBranch(b.id)}
                                            >
                                                {b.code} - {b.name}
                                            </div>
                                        ))}
                                        {filteredBranches.length === 0 && (
                                            <div className="px-2 py-3 text-sm text-center text-slate-500">No branch found.</div>
                                        )}
                                    </div>
                                </div>
                            )}
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
                                        To Date <span className="text-red-500">*</span>
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
                                    onClick={handleSearch}
                                    disabled={isLoading}
                                    className="h-11 flex-1 min-w-[140px] bg-gradient-to-r from-primary to-primary hover:from-sidebar-accent hover:to-primary text-white shadow-lg shadow-primary/30"
                                >
                                    {isLoading ? (
                                        <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Searching...</>
                                    ) : (
                                        <><Search className="h-4 w-4 mr-2" /> Search</>
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
                                            onExportExcel={handleExportExcel}
                                            onExportCSV={handleExportCSV}
                                            onExportWord={handleExportWord}
                                            reportSlug={getReportExportMode('trial-balance') === 'REQUEST_QUEUE' ? 'trial-balance' : undefined}
                                            canExport={canExportReport('trial-balance')}
                                            exportParams={{
                                                fromDate: submittedReportType === 'RANGE' ? submittedFromDate : submittedAsOnDate,
                                                toDate: submittedReportType === 'RANGE' ? submittedTillDate : submittedAsOnDate,
                                                branchIds: selectedBranchId === 'all' ? 'ALL' : [selectedBranchId],
                                                filters: { reportType: submittedReportType, viewType },
                                            }}
                                            className="h-11 flex-1 min-w-[120px] border-green-300 text-green-700 hover:bg-green-50 dark:border-green-800 dark:text-green-400 dark:hover:bg-green-950/50"
                                        />
                                        <Button
                                            onClick={() => handlePrint()}
                                            variant="outline"
                                            className="h-11 flex-1 min-w-[100px] border-primary/30 text-sidebar-accent hover:bg-green-50 dark:border-sidebar-accent dark:text-slate-300 dark:hover:bg-sidebar-accent"
                                        >
                                            <Printer className="h-4 w-4 mr-2" /> Print
                                        </Button>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Table Card */}
            {showReport && (
                <Card className="border-0 shadow-none overflow-visible bg-white mt-6 rounded-none print:mt-0">
                    <div className="overflow-auto bg-white" ref={printRef}>
                        <div className="p-4 pb-4 text-center bg-white text-black">
                            <ReportHeader
                                title="TRIAL BALANCE REPORT"
                                subtitle={`${branchLabel}  •  ${periodLabel}`}
                            />
                        </div>
                        <CardContent className="p-0">
                            <Table className="border border-black text-black">
                                <TableHeader>
                                    <TableRow className="bg-white hover:bg-white border-b border-black">
                                        <TableHead rowSpan={2} className="font-bold text-black text-[13px] px-2 py-2 border-r border-black align-bottom h-auto">Primary Account</TableHead>
                                        <TableHead rowSpan={2} className="font-bold text-black text-[13px] px-2 py-2 border-r border-black align-bottom text-center h-auto">Account Code</TableHead>
                                        {viewType === 'DETAILED' ? (
                                            <>
                                                <TableHead colSpan={2} className="font-bold text-black text-[13px] px-2 py-2 border-r border-b border-black text-center h-auto">Opening Balance ₹</TableHead>
                                                <TableHead colSpan={2} className="font-bold text-black text-[13px] px-2 py-2 border-r border-b border-black text-center h-auto">Transactions</TableHead>
                                                <TableHead colSpan={2} className="font-bold text-black text-[13px] px-2 py-2 border-b border-black text-center h-auto">Closing Balance ₹</TableHead>
                                            </>
                                        ) : (
                                            <TableHead colSpan={2} className="font-bold text-black text-[13px] px-2 py-2 border-b border-black text-center h-auto">Closing Balance ₹</TableHead>
                                        )}
                                    </TableRow>
                                    <TableRow className="bg-white hover:bg-white border-b border-black">
                                        {viewType === 'DETAILED' ? (
                                            <>
                                                <TableHead className="font-bold text-black text-[12px] px-2 py-1 border-r border-black text-center h-auto">Debit ₹</TableHead>
                                                <TableHead className="font-bold text-black text-[12px] px-2 py-1 border-r border-black text-center h-auto">Credit ₹</TableHead>
                                                <TableHead className="font-bold text-black text-[12px] px-2 py-1 border-r border-black text-center h-auto">Debit ₹</TableHead>
                                                <TableHead className="font-bold text-black text-[12px] px-2 py-1 border-r border-black text-center h-auto">Credit ₹</TableHead>
                                                <TableHead className="font-bold text-black text-[12px] px-2 py-1 border-r border-black text-center h-auto">Debit ₹</TableHead>
                                                <TableHead className="font-bold text-black text-[12px] px-2 py-1 text-center h-auto">Credit ₹</TableHead>
                                            </>
                                        ) : (
                                            <>
                                                <TableHead className="font-bold text-black text-[12px] px-2 py-1 border-r border-black text-center h-auto">Debit ₹</TableHead>
                                                <TableHead className="font-bold text-black text-[12px] px-2 py-1 text-center h-auto">Credit ₹</TableHead>
                                            </>
                                        )}
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {displayRows.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={2 + (viewType === 'DETAILED' ? amountColSpanDetailed : amountColSpanCondensed)} className="h-32 text-center text-slate-500">
                                                No records found.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        displayRows.map((dr, idx) => {
                                            if (dr.kind === 'group') {
                                                const t = dr.totals;
                                                return (
                                                    <TableRow key={`g-${idx}`} className="bg-white hover:bg-white border-none">
                                                        <TableCell
                                                            colSpan={2}
                                                            className={cn('border-r border-b border-black px-2 py-1 text-[12px]', dr.depth === 0 ? 'font-bold text-black' : 'font-semibold text-black')}
                                                            style={{ paddingLeft: `${dr.depth * 16 + 8}px` }}
                                                        >
                                                            {dr.groupName}
                                                        </TableCell>
                                                        {viewType === 'DETAILED' ? (
                                                            <>
                                                                <TableCell className="text-right border-r border-b border-black px-2 py-1 text-[12px] font-bold">{t ? `₹ ${formatCurrency(t.openingDebit)}` : ''}</TableCell>
                                                                <TableCell className="text-right border-r border-b border-black px-2 py-1 text-[12px] font-bold">{t ? `₹ ${formatCurrency(t.openingCredit)}` : ''}</TableCell>
                                                                <TableCell className="text-right border-r border-b border-black px-2 py-1 text-[12px] font-bold">{t ? `₹ ${formatCurrency(t.txnDebit)}` : ''}</TableCell>
                                                                <TableCell className="text-right border-r border-b border-black px-2 py-1 text-[12px] font-bold">{t ? `₹ ${formatCurrency(t.txnCredit)}` : ''}</TableCell>
                                                                <TableCell className="text-right border-r border-b border-black px-2 py-1 text-[12px] font-bold">{t ? `₹ ${formatCurrency(t.closingDebit)}` : ''}</TableCell>
                                                                <TableCell className="text-right border-b border-black px-2 py-1 text-[12px] font-bold">{t ? `₹ ${formatCurrency(t.closingCredit)}` : ''}</TableCell>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <TableCell className="text-right border-r border-b border-black px-2 py-1 text-[12px] font-bold">{t ? `₹ ${formatCurrency(t.closingDebit)}` : ''}</TableCell>
                                                                <TableCell className="text-right border-b border-black px-2 py-1 text-[12px] font-bold">{t ? `₹ ${formatCurrency(t.closingCredit)}` : ''}</TableCell>
                                                            </>
                                                        )}
                                                    </TableRow>
                                                );
                                            }

                                            const r = dr.row;
                                            return (
                                                <TableRow key={`l-${idx}`} className="hover:bg-green-50 transition-colors bg-white border-none">
                                                    <TableCell
                                                        className="text-black border-r border-b border-black px-2 py-1 text-[12px]"
                                                        style={{ paddingLeft: `${dr.depth * 16 + 8}px` }}
                                                    >
                                                        {r.ledgerName}
                                                    </TableCell>
                                                    <TableCell className="text-center text-black border-r border-b border-black px-2 py-1 text-[12px]">{r.ledgerCode || '-'}</TableCell>
                                                    {viewType === 'DETAILED' ? (
                                                        <>
                                                            <TableCell className="text-right border-r border-b border-black px-2 py-1 text-[12px]">{r.openingDebit > 0 ? `₹ ${formatCurrency(r.openingDebit)}` : '₹ 0'}</TableCell>
                                                            <TableCell className="text-right border-r border-b border-black px-2 py-1 text-[12px]">{r.openingCredit > 0 ? `₹ ${formatCurrency(r.openingCredit)}` : '₹ 0'}</TableCell>
                                                            <TableCell className="text-right border-r border-b border-black px-2 py-1 text-[12px]">{r.txnDebit > 0 ? `₹ ${formatCurrency(r.txnDebit)}` : '₹ 0'}</TableCell>
                                                            <TableCell className="text-right border-r border-b border-black px-2 py-1 text-[12px]">{r.txnCredit > 0 ? `₹ ${formatCurrency(r.txnCredit)}` : '₹ 0'}</TableCell>
                                                            <TableCell className="text-right border-r border-b border-black px-2 py-1 text-[12px]">{r.closingDebit > 0 ? `₹ ${formatCurrency(r.closingDebit)}` : '₹ 0'}</TableCell>
                                                            <TableCell className="text-right border-b border-black px-2 py-1 text-[12px]">{r.closingCredit > 0 ? `₹ ${formatCurrency(r.closingCredit)}` : '₹ 0'}</TableCell>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <TableCell className="text-right border-r border-b border-black px-2 py-1 text-[12px]">{r.closingDebit > 0 ? `₹ ${formatCurrency(r.closingDebit)}` : '₹ 0'}</TableCell>
                                                            <TableCell className="text-right border-b border-black px-2 py-1 text-[12px]">{r.closingCredit > 0 ? `₹ ${formatCurrency(r.closingCredit)}` : '₹ 0'}</TableCell>
                                                        </>
                                                    )}
                                                </TableRow>
                                            );
                                        })
                                    )}

                                    {rows.length > 0 && (
                                        <TableRow className="bg-white font-bold border-t border-black">
                                            <TableCell colSpan={2} className="text-sm text-black text-right pr-4 border-r border-black font-bold h-10">
                                                GRAND TOTAL
                                            </TableCell>
                                            {viewType === 'DETAILED' ? (
                                                <>
                                                    <TableCell className="text-right text-[13px] font-bold text-black border-r border-black px-2 py-2">₹ {formatCurrency(grandTotal.openingDebit)}</TableCell>
                                                    <TableCell className="text-right text-[13px] font-bold text-black border-r border-black px-2 py-2">₹ {formatCurrency(grandTotal.openingCredit)}</TableCell>
                                                    <TableCell className="text-right text-[13px] font-bold text-black border-r border-black px-2 py-2">₹ {formatCurrency(grandTotal.txnDebit)}</TableCell>
                                                    <TableCell className="text-right text-[13px] font-bold text-black border-r border-black px-2 py-2">₹ {formatCurrency(grandTotal.txnCredit)}</TableCell>
                                                    <TableCell className="text-right text-[13px] font-bold text-black border-r border-black px-2 py-2">₹ {formatCurrency(roundedClosingDebit)}</TableCell>
                                                    <TableCell className="text-right text-[13px] font-bold text-black px-2 py-2">₹ {formatCurrency(roundedClosingCredit)}</TableCell>
                                                </>
                                            ) : (
                                                <>
                                                    <TableCell className="text-right text-[13px] font-bold text-black border-r border-black px-2 py-2">₹ {formatCurrency(roundedClosingDebit)}</TableCell>
                                                    <TableCell className="text-right text-[13px] font-bold text-black px-2 py-2">₹ {formatCurrency(roundedClosingCredit)}</TableCell>
                                                </>
                                            )}
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </div>
                </Card>
            )}

            {/* Footer Info */}
            {showReport && (
                <div className="mt-6 flex items-center justify-between text-sm text-sidebar-accent print:hidden">
                    <p>Report generated on {toDisplayDateTime(new Date())}</p>
                    <p>
                        Status: <span className={cn('font-semibold', isBalanced ? 'text-green-700' : 'text-red-700')}>
                            {isBalanced ? 'Balanced' : `Unbalanced (${formatCurrency(difference)})`}
                        </span>
                    </p>
                </div>
            )}
        </div>
    );
}
