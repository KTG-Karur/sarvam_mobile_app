'use client';

import { Fragment, useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { RefreshCw, Download, Loader2, ChevronDown, ChevronRight, Search, FileText, FileType, FileOutput } from 'lucide-react';
import * as XLSX from 'xlsx-js-style';
import { format } from 'date-fns';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { usePermission } from '@/app/hooks/usePermission';
import { useLoanAdvanceEnabled } from '@/app/hooks/useLoanAdvanceEnabled';
import { reportHeaderRows, autoSizeColumns, applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { formatReportAmount, truncateReportAmount } from '@/app/lib/utils/format-amount';
import { exportToCSV, exportToWord, type WordExportOptions } from '@/app/lib/report-export-utils';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';

import { matchesMemberSearch } from '@/app/lib/reports/member-contact-columns';
type LoanAdvanceTx = {
    id: string;
    transactionId: string;
    date: string;
    type: string;
    loanNumber: string;
    amount: number;
    paymentMode: string;
    status: string;
};

type ClientLedgerRow = {
    clientDbId: string;
    clientCode: string;
    clientName: string;
    centerCode: string;
    centerName: string;
    currentBalance: number;
    totalCollected: number;
    totalRefunded: number;
    transactions: LoanAdvanceTx[];
};

type Totals = {
    totalCollected: number;
    totalRefunded: number;
    netBalance: number;
    clientCount: number;
};

type ClientOption = {
    id: string;
    clientCode: string;
    name: string;
    phone: string;
    aadhaarNumber: string;
};

const fmt = (n: number) => formatReportAmount(n);

const fmtDate = (iso: string) => {
    try { return format(new Date(iso), 'dd/MM/yyyy'); } catch { return iso; }
};

const fmtDateTime = (iso: string) => {
    try {
        const date = new Date(iso);
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const ampm = date.getHours() >= 12 ? 'PM' : 'AM';
        return `${day}/${month}/${year} ${hours}:${minutes} ${ampm}`;
    } catch {
        return iso;
    }
};

const typeLabel = (type: string) => type === 'SAVINGS_COLLECTION' ? 'Collection' : 'Refund';
const typeBadgeClass = (type: string) =>
    type === 'SAVINGS_COLLECTION'
        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
        : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400';

export function LoanAdvanceLedgerReport() {
    const { toast } = useToast();
    const { canExportReport, getReportExportMode } = usePermission();
    const { enabled: loanAdvanceEnabled, loading: loanAdvanceEnabledLoading } = useLoanAdvanceEnabled();

    const [branches, setBranches] = useState<{ id: string; name: string; code: string }[]>([]);
    const [centers, setCenters] = useState<{ id: string; name: string; code: string; branchId?: string }[]>([]);
    const [clients, setClients] = useState<ClientOption[]>([]);
    const [selectedBranch, setSelectedBranch] = useState<string>('all');
    const [selectedCenter, setSelectedCenter] = useState<string>('all');
    const [selectedClientId, setSelectedClientId] = useState<string>('');
    const [clientSearch, setClientSearch] = useState<string>('');
    const [isLoadingClients, setIsLoadingClients] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [showReport, setShowReport] = useState(false);
    const [data, setData] = useState<ClientLedgerRow[]>([]);
    const [totals, setTotals] = useState<Totals | null>(null);
    const [expandedClients, setExpandedClients] = useState<Set<string>>(new Set());
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize, setPageSize] = useState<number | 'all'>(10);

    useEffect(() => {
        fetch('/api/branches')
            .then(r => r.json())
            .then(d => setBranches(Array.isArray(d) ? d : (d.data ?? [])))
            .catch(() => {});
        fetch('/api/centers')
            .then(r => r.json())
            .then(d => setCenters(Array.isArray(d) ? d : (d.data ?? [])))
            .catch(() => {});
    }, []);

    // Load clients when branch or center changes
    useEffect(() => {
        setSelectedClientId('');
        setClientSearch('');
        setClients([]);
        setShowReport(false);

        if (selectedBranch === 'all' && selectedCenter === 'all') return;

        setIsLoadingClients(true);
        const params = new URLSearchParams({ pageSize: '500', includeInactive: 'false' });
        if (selectedCenter !== 'all') params.set('centerId', selectedCenter);
        if (selectedBranch !== 'all') params.set('branchId', selectedBranch);

        fetch(`/api/clients?${params}`)
            .then(r => r.json())
            .then(d => {
                const list: any[] = d.data?.clients ?? [];
                setClients(list.map(c => ({
                    id: c.id ?? '',
                    clientCode: c.clientId ?? c.accountId ?? '',
                    name: `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() || (c.clientName ?? ''),
                    phone: c.mobileNumber || c.phone || '',
                    aadhaarNumber: c.otherIdNo ?? '',
                })));
            })
            .catch(() => {})
            .finally(() => setIsLoadingClients(false));
    }, [selectedBranch, selectedCenter]);

    const filteredCenters = selectedBranch === 'all'
        ? centers
        : centers.filter(c => c.branchId === selectedBranch);

    const filteredClients = clientSearch.trim()
        ? clients.filter(c => matchesMemberSearch(clientSearch, { aadhaarNumber: c.aadhaarNumber, mobileNumber: c.phone }, c.clientCode, c.name))
        : clients;

    const selectedClient = clients.find(c => c.id === selectedClientId);
    const needsClientSelect = selectedBranch !== 'all' || selectedCenter !== 'all';

    const fetchReport = async () => {
        if (!selectedClientId) {
            toast({ title: 'Select Client', description: 'Please select a client to generate the report.', variant: 'destructive' });
            return;
        }
        setIsLoading(true);
        setShowReport(false);
        try {
            const params = new URLSearchParams({ clientDbId: selectedClientId });
            if (selectedBranch !== 'all') params.set('branchId', selectedBranch);
            if (selectedCenter !== 'all') params.set('centerId', selectedCenter);

            const res = await fetch(`/api/savings/loan-advance-ledger?${params}`);
            if (!res.ok) throw new Error('Failed to fetch');
            const result = await res.json();
            setData(result.data?.data ?? []);
            setTotals(result.data?.totals ?? null);
            setPageSize(10);
            setCurrentPage(1);
            setExpandedClients(new Set());
            setShowReport(true);
        } catch {
            toast({ title: 'Error', description: 'Failed to load Loan Advance Ledger.', variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
    };

    const toggleExpand = (clientDbId: string) => {
        setExpandedClients(prev => {
            const next = new Set(prev);
            next.has(clientDbId) ? next.delete(clientDbId) : next.add(clientDbId);
            return next;
        });
    };

    const handlePageSizeChange = (val: string) => {
        setPageSize(val === 'all' ? 'all' : Number(val));
        setCurrentPage(1);
        setExpandedClients(new Set());
    };

    const handleExport = () => {
        if (!showReport || data.length === 0) {
            toast({ title: 'No data', description: 'Generate report first.', variant: 'destructive' });
            return;
        }
        const today = new Date().toISOString().split('T')[0];
        const rows: any[] = [];
        rows.push(...reportHeaderRows('Loan Advance Ledger'));
        rows.push(['Client ID', 'Client Name', 'Center', 'Current Balance', 'Total Collected', 'Total Refunded',
            'Tx Date', 'Tx ID', 'Type', 'Loan A/c', 'Amount', 'Mode', 'Status']);

        for (const row of data) {
            const firstTx = row.transactions[0];
            rows.push([row.clientCode, row.clientName, `${row.centerCode} - ${row.centerName}`,
                truncateReportAmount(row.currentBalance), truncateReportAmount(row.totalCollected), truncateReportAmount(row.totalRefunded),
                firstTx ? fmtDateTime(firstTx.date) : '', firstTx?.transactionId ?? '',
                firstTx ? typeLabel(firstTx.type) : '', firstTx?.loanNumber ?? '',
                firstTx ? truncateReportAmount(firstTx.amount) : '', firstTx?.paymentMode ?? '', firstTx?.status ?? '']);
            for (let i = 1; i < row.transactions.length; i++) {
                const tx = row.transactions[i];
                rows.push(['', '', '', '', '', '',
                    fmtDateTime(tx.date), tx.transactionId, typeLabel(tx.type),
                    tx.loanNumber, truncateReportAmount(tx.amount), tx.paymentMode, tx.status]);
            }
        }
        if (totals) {
            rows.push([]);
            rows.push(['GRAND TOTAL', '', '', truncateReportAmount(totals.netBalance), truncateReportAmount(totals.totalCollected), truncateReportAmount(totals.totalRefunded)]);
        }

        const ws = XLSX.utils.aoa_to_sheet(rows);
        autoSizeColumns(ws);
        applyExcelReportFont(ws);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Loan Advance Ledger');
        XLSX.writeFile(wb, `LoanAdvanceLedger_${today}.xlsx`);
        toast({ title: 'Exported', description: 'Report exported to Excel.' });
    };

    // Mirrors the same field mapping used by handleExport above (kept separate so
    // handleExport is left untouched).
    const buildLoanAdvanceExportRows = (): { headers: string[]; rows: (string | number)[][] } => {
        const headers = ['Client ID', 'Client Name', 'Center', 'Current Balance', 'Total Collected', 'Total Refunded',
            'Tx Date', 'Tx ID', 'Type', 'Loan A/c', 'Amount', 'Mode', 'Status'];
        const rows: (string | number)[][] = [];
        for (const row of data) {
            const firstTx = row.transactions[0];
            rows.push([row.clientCode, row.clientName, `${row.centerCode} - ${row.centerName}`,
                truncateReportAmount(row.currentBalance), truncateReportAmount(row.totalCollected), truncateReportAmount(row.totalRefunded),
                firstTx ? fmtDateTime(firstTx.date) : '', firstTx?.transactionId ?? '',
                firstTx ? typeLabel(firstTx.type) : '', firstTx?.loanNumber ?? '',
                firstTx ? truncateReportAmount(firstTx.amount) : '', firstTx?.paymentMode ?? '', firstTx?.status ?? '']);
            for (let i = 1; i < row.transactions.length; i++) {
                const tx = row.transactions[i];
                rows.push(['', '', '', '', '', '',
                    fmtDateTime(tx.date), tx.transactionId, typeLabel(tx.type),
                    tx.loanNumber, truncateReportAmount(tx.amount), tx.paymentMode, tx.status]);
            }
        }
        if (totals) {
            rows.push(['GRAND TOTAL', '', '', truncateReportAmount(totals.netBalance), truncateReportAmount(totals.totalCollected), truncateReportAmount(totals.totalRefunded), '', '', '', '', '', '', '']);
        }
        return { headers, rows };
    };

    const handleExportPDF = async () => {
        if (!showReport || data.length === 0) {
            toast({ title: 'No data', description: 'Generate report first.', variant: 'destructive' });
            return;
        }
        const { jsPDF } = await import('jspdf');
        const { drawLoanAdvanceLedgerReport } = await import('@/app/lib/reports/loan-advance-ledger-pdf');
        const { headers, rows } = buildLoanAdvanceExportRows();
        const doc = new jsPDF({ orientation: 'landscape' });
        const reportFont = await ensureReportFont(doc);
        await drawLoanAdvanceLedgerReport(doc, headers, rows, reportFont);
        const today = new Date().toISOString().split('T')[0];
        doc.save(`LoanAdvanceLedger_${today}.pdf`);
        toast({ title: 'Exported', description: 'Report exported to PDF.' });
    };

    const handleExportCSV = () => {
        if (!showReport || data.length === 0) {
            toast({ title: 'No data', description: 'Generate report first.', variant: 'destructive' });
            return;
        }
        const { headers, rows } = buildLoanAdvanceExportRows();
        const today = new Date().toISOString().split('T')[0];
        exportToCSV(`LoanAdvanceLedger_${today}`, 'LOAN ADVANCE LEDGER', headers, rows);
    };

    // Word-only presentation: same rows as PDF/CSV above, but the trailing "GRAND TOTAL"
    // row (when present) is split off for distinct styling. The client-summary columns
    // and the per-transaction columns are two genuinely separate blocks (matching the
    // row structure itself — summary cells are blank on transaction-continuation rows)
    // and get a 2-row grouped header.
    const buildLoanAdvanceWordOptions = (
        rows: (string | number)[][]
    ): { bodyRows: (string | number)[][]; options: WordExportOptions } => {
        const hasTotals = rows.length > 0 && rows[rows.length - 1][0] === 'GRAND TOTAL';
        return {
            bodyRows: hasTotals ? rows.slice(0, -1) : rows,
            options: {
                groupHeaders: [
                    { label: 'CLIENT SUMMARY', span: 6 },
                    { label: 'TRANSACTION', span: 7 },
                ],
                subHeaders: ['Client ID', 'Client Name', 'Center', 'Current Balance', 'Total Collected', 'Total Refunded', 'Tx Date', 'Tx ID', 'Type', 'Loan A/c', 'Amount', 'Mode', 'Status'],
                columnAlignments: ['center', 'left', 'left', 'right', 'right', 'right', 'center', 'center', 'center', 'center', 'right', 'center', 'center'],
                columnWidthWeights: [7, 12, 12, 9, 9, 9, 8, 8, 7, 8, 8, 7, 8],
                totalsRow: hasTotals ? rows[rows.length - 1] : undefined,
            },
        };
    };

    const handleExportWord = async () => {
        if (!showReport || data.length === 0) {
            toast({ title: 'No data', description: 'Generate report first.', variant: 'destructive' });
            return;
        }
        const { headers, rows } = buildLoanAdvanceExportRows();
        const today = new Date().toISOString().split('T')[0];
        const { bodyRows, options } = buildLoanAdvanceWordOptions(rows);
        await exportToWord(`LoanAdvanceLedger_${today}`, 'LOAN ADVANCE LEDGER', headers, bodyRows, options);
    };

    if (!loanAdvanceEnabledLoading && !loanAdvanceEnabled) {
        return (
            <div className="space-y-6">
                <ReportHeader title="Loan Advance Ledger" />
                <Card>
                    <CardContent className="py-12 text-center text-muted-foreground">
                        <p className="text-base font-medium">Loan Advance is currently disabled</p>
                        <p className="text-sm mt-1">Ask an Admin to enable it from Hub → Settings to use this report.</p>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Filters */}
            <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                <CardHeader>
                    <CardTitle className="text-lg">Report Parameters</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    {/* Row 1: Branch + Center */}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                            <Label>Branch</Label>
                            <Select value={selectedBranch} onValueChange={v => { setSelectedBranch(v); setSelectedCenter('all'); }}>
                                <SelectTrigger><SelectValue placeholder="All Branches" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Branches</SelectItem>
                                    {branches.map(b => (
                                        <SelectItem key={b.id} value={b.id}>{b.code} - {b.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Center</Label>
                            <Select value={selectedCenter} onValueChange={setSelectedCenter}>
                                <SelectTrigger><SelectValue placeholder="All Centers" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Centers</SelectItem>
                                    {filteredCenters.map(c => (
                                        <SelectItem key={c.id} value={c.id}>{c.code ? `${c.code} - ${c.name}` : c.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    {/* Row 2: Client search — only when branch/center is selected */}
                    {needsClientSelect ? (
                        <div className="space-y-1">
                            <Label>Client <span className="text-rose-500">*</span></Label>
                            <div className="relative max-w-md">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none z-10" />
                                <Input
                                    className="pl-8 pr-3 text-sm"
                                    placeholder="Search by ID, Name, Aadhaar or Phone…"
                                    value={clientSearch}
                                    onChange={e => {
                                        setClientSearch(e.target.value);
                                        setSelectedClientId('');
                                        setShowReport(false);
                                    }}
                                />
                                {!isLoadingClients && clientSearch && filteredClients.length > 0 && !selectedClientId && (
                                    <div className="absolute z-30 top-full mt-1 left-0 w-full max-h-56 overflow-auto rounded-md border border-primary/20 bg-white shadow-xl dark:border-sidebar-accent dark:bg-brand-green-darker">
                                        {filteredClients.map(c => (
                                            <button
                                                key={c.id}
                                                type="button"
                                                className="w-full px-3 py-2 text-left text-xs hover:bg-brand-green-tint dark:hover:bg-sidebar-accent border-b border-slate-100 dark:border-sidebar-accent last:border-0"
                                                onClick={() => {
                                                    setSelectedClientId(c.id);
                                                    setClientSearch(`${c.clientCode} - ${c.name}`);
                                                }}
                                            >
                                                <span className="font-mono font-medium">{c.clientCode}</span>
                                                <span className="ml-2">{c.name}</span>
                                                {c.phone && <span className="ml-2 text-slate-400">{c.phone}</span>}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                            {isLoadingClients && (
                                <p className="text-xs text-slate-400 flex items-center gap-1 mt-1">
                                    <Loader2 className="h-3 w-3 animate-spin" /> Loading clients…
                                </p>
                            )}
                            {!isLoadingClients && clientSearch && filteredClients.length === 0 && !selectedClientId && (
                                <p className="text-xs text-slate-400 mt-1">No clients match your search.</p>
                            )}
                            {selectedClient && (
                                <p className="text-xs text-emerald-600 font-medium mt-1">
                                    ✓ {selectedClient.clientCode} — {selectedClient.name}
                                </p>
                            )}
                        </div>
                    ) : (
                        <p className="text-xs text-amber-600 dark:text-amber-400">
                            Select a Branch or Center first, then choose a client.
                        </p>
                    )}

                    {/* Actions */}
                    <div className="flex gap-3">
                        <Button
                            onClick={fetchReport}
                            disabled={isLoading || !selectedClientId}
                            className="bg-emerald-600 hover:bg-emerald-700"
                        >
                            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                            Generate Report
                        </Button>
                        {showReport && (
                            <>
                                <ExportDropdown
                                    onExportPDF={data.length > 0 ? handleExportPDF : undefined}
                                    onExportExcel={data.length > 0 ? handleExport : undefined}
                                    onExportCSV={data.length > 0 ? handleExportCSV : undefined}
                                    reportSlug={data.length > 0 && getReportExportMode('loan-advance-ledger') === 'REQUEST_QUEUE' ? 'loan-advance-ledger' : undefined}
                                    canExport={canExportReport('loan-advance-ledger')}
                                    onExportWord={data.length > 0 ? handleExportWord : undefined}
                                    exportParams={{
                                        fromDate: null,
                                        toDate: null,
                                        branchIds: selectedBranch === 'all' ? 'ALL' : [selectedBranch],
                                        filters: {
                                            ...(selectedCenter !== 'all' ? { centerId: selectedCenter } : {}),
                                            ...(selectedClientId ? { clientDbId: selectedClientId } : {}),
                                        },
                                    }}
                                />
                            </>
                        )}
                    </div>
                </CardContent>
            </Card>

            {/* Summary Cards */}
            {showReport && totals && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
                    <Card className="border-none bg-gradient-to-br from-slate-500 to-sidebar-accent p-4 text-white shadow-lg">
                        <p className="text-xs font-medium uppercase tracking-wider text-slate-200">Clients</p>
                        <p className="mt-1 text-2xl font-bold">{totals.clientCount}</p>
                    </Card>
                    <Card className="border-none bg-gradient-to-br from-emerald-500 to-teal-600 p-4 text-white shadow-lg">
                        <p className="text-xs font-medium uppercase tracking-wider text-emerald-100">Total Collected</p>
                        <p className="mt-1 text-2xl font-bold">₹ {fmt(totals.totalCollected)}</p>
                    </Card>
                    <Card className="border-none bg-gradient-to-br from-red-500 to-rose-600 p-4 text-white shadow-lg">
                        <p className="text-xs font-medium uppercase tracking-wider text-red-100">Total Refunded</p>
                        <p className="mt-1 text-2xl font-bold">₹ {fmt(totals.totalRefunded)}</p>
                    </Card>
                    <Card className="border-none bg-gradient-to-br from-amber-500 to-orange-600 p-4 text-white shadow-lg">
                        <p className="text-xs font-medium uppercase tracking-wider text-amber-100">Net Balance</p>
                        <p className="mt-1 text-2xl font-bold">₹ {fmt(totals.netBalance)}</p>
                    </Card>
                </div>
            )}

            {/* Table */}
            {showReport && (() => {
                const totalPages = pageSize === 'all' ? 1 : Math.ceil(data.length / (pageSize as number));
                const paginatedData = pageSize === 'all' ? data : data.slice((currentPage - 1) * (pageSize as number), currentPage * (pageSize as number));
                return (
                    <Card className="overflow-hidden border-none bg-white shadow-xl dark:bg-green-950">
                        <CardHeader className="border-b border-slate-100 bg-green-50/50 px-6 py-4 dark:border-sidebar-accent dark:bg-brand-green-darker/50">
                            <ReportHeader title="Loan Advance Ledger" />
                            <CardTitle className="text-base font-bold">
                                Loan Advance Ledger — {data.length} client{data.length !== 1 ? 's' : ''}
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-0">
                            <Table className="min-w-max w-full text-xs">
                                <TableHeader className="sticky top-0 z-20 bg-brand-green-tint dark:bg-sidebar-accent">
                                    <TableRow>
                                        <TableHead className="w-8" />
                                        <TableHead className="font-bold">Client</TableHead>
                                        <TableHead className="font-bold">Center</TableHead>
                                        <TableHead className="font-bold text-right text-emerald-700 dark:text-emerald-400">Collected</TableHead>
                                        <TableHead className="font-bold text-right text-red-700 dark:text-red-400">Refunded</TableHead>
                                        <TableHead className="font-bold text-right text-amber-700 dark:text-amber-400">Current Balance</TableHead>
                                        <TableHead className="font-bold">Transactions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {data.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={7} className="py-12 text-center text-slate-500">
                                                No loan advance transactions found for the selected period.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        paginatedData.map(row => (
                                            <Fragment key={row.clientDbId}>
                                                <TableRow
                                                    className="cursor-pointer hover:bg-green-50 dark:hover:bg-sidebar-accent/50"
                                                    onClick={() => toggleExpand(row.clientDbId)}
                                                >
                                                    <TableCell className="text-center">
                                                        {expandedClients.has(row.clientDbId)
                                                            ? <ChevronDown className="h-4 w-4 text-slate-500" />
                                                            : <ChevronRight className="h-4 w-4 text-slate-500" />}
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="font-medium">{row.clientName}</div>
                                                        <div className="text-slate-400">{row.clientCode}</div>
                                                    </TableCell>
                                                    <TableCell>{row.centerCode} - {row.centerName}</TableCell>
                                                    <TableCell className="text-right font-bold text-emerald-700 dark:text-emerald-400">
                                                        ₹{fmt(row.totalCollected)}
                                                    </TableCell>
                                                    <TableCell className="text-right font-medium text-red-700 dark:text-red-400">
                                                        ₹{fmt(row.totalRefunded)}
                                                    </TableCell>
                                                    <TableCell className="text-right font-bold text-amber-700 dark:text-amber-400">
                                                        ₹{fmt(row.currentBalance)}
                                                    </TableCell>
                                                    <TableCell className="text-slate-500">{row.transactions.length} tx</TableCell>
                                                </TableRow>
                                                {expandedClients.has(row.clientDbId) && (
                                                    <TableRow key={`${row.clientDbId}-detail`} className="bg-green-50/70 dark:bg-brand-green-darker/50">
                                                        <TableCell colSpan={7} className="p-0">
                                                            <div className="px-4 sm:px-8 py-3">
                                                                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Transaction History</p>
                                                                <table className="w-full text-xs">
                                                                    <thead>
                                                                        <tr className="text-left text-sidebar-accent dark:text-slate-400">
                                                                            <th className="pb-1 pr-4">Date</th>
                                                                            <th className="pb-1 pr-4">Ref No</th>
                                                                            <th className="pb-1 pr-4">Type</th>
                                                                            <th className="pb-1 pr-4">Loan A/c</th>
                                                                            <th className="pb-1 pr-4 text-right">Amount</th>
                                                                            <th className="pb-1 pr-4">Mode</th>
                                                                            <th className="pb-1">Status</th>
                                                                        </tr>
                                                                    </thead>
                                                                    <tbody>
                                                                        {row.transactions.map(tx => (
                                                                            <tr key={tx.id} className="border-t border-slate-100 dark:border-sidebar-accent">
                                                                                <td className="py-1 pr-4">{fmtDateTime(tx.date)}</td>
                                                                                <td className="py-1 pr-4 font-mono">{tx.transactionId}</td>
                                                                                <td className="py-1 pr-4">
                                                                                    <Badge variant="outline" className={`text-[9px] ${typeBadgeClass(tx.type)}`}>
                                                                                        {typeLabel(tx.type)}
                                                                                    </Badge>
                                                                                </td>
                                                                                <td className="py-1 pr-4 font-mono">{tx.loanNumber}</td>
                                                                                <td className={`py-1 pr-4 text-right font-medium ${tx.type === 'SAVINGS_COLLECTION' ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}>
                                                                                    {tx.type === 'SAVINGS_REFUND' ? '-' : ''}₹{fmt(tx.amount)}
                                                                                </td>
                                                                                <td className="py-1 pr-4">{tx.paymentMode}</td>
                                                                                <td className="py-1">
                                                                                    <Badge variant="outline" className="text-[9px]">{tx.status}</Badge>
                                                                                </td>
                                                                            </tr>
                                                                        ))}
                                                                    </tbody>
                                                                </table>
                                                            </div>
                                                        </TableCell>
                                                    </TableRow>
                                                )}
                                            </Fragment>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                            {data.length > 0 && (
                                <div className="flex items-center justify-between border-t border-slate-100 px-6 py-3 text-xs text-slate-500 dark:border-sidebar-accent">
                                    <div className="flex items-center gap-3">
                                        <span>Rows per page:</span>
                                        <Select value={String(pageSize)} onValueChange={handlePageSizeChange}>
                                            <SelectTrigger className="h-7 w-20 text-xs">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="10">10</SelectItem>
                                                <SelectItem value="20">20</SelectItem>
                                                <SelectItem value="50">50</SelectItem>
                                                <SelectItem value="all">All</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <span>
                                            {pageSize === 'all'
                                                ? `All ${data.length} rows`
                                                : `Showing ${Math.min((currentPage - 1) * (pageSize as number) + 1, data.length)}–${Math.min(currentPage * (pageSize as number), data.length)} of ${data.length}`}
                                        </span>
                                    </div>
                                    {pageSize !== 'all' && totalPages > 1 && (
                                        <div className="flex items-center gap-2">
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => { setCurrentPage(p => p - 1); setExpandedClients(new Set()); }}
                                                disabled={currentPage === 1}
                                            >
                                                Previous
                                            </Button>
                                            <span>Page {currentPage} of {totalPages}</span>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => { setCurrentPage(p => p + 1); setExpandedClients(new Set()); }}
                                                disabled={currentPage === totalPages}
                                            >
                                                Next
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                );
            })()}
        </div>
    );
}
