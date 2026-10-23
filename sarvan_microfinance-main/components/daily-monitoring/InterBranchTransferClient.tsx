'use client';

import { useState, useMemo, useEffect } from 'react';
import {
    CalendarDays,
    RefreshCw,
    Search,
    ArrowLeftRight,
    ArrowRight,
    TrendingUp,
    TrendingDown,
    AlertCircle,
    BadgeCheck,
    Zap,
    MousePointer2,
    Sparkles,
    ShieldCheck,
    AlertTriangle,
    Layers,
    RotateCcw
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { tokenStorage } from '@/app/lib/token-storage';
import { usePermission } from '@/app/hooks/usePermission';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import * as XLSX from 'xlsx';
import { autoSizeColumns, normalizeWorkbookNumbers } from '@/app/lib/reports/excel-report-header';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';
import { ExportMenuButton } from '@/components/daily-monitoring/ExportMenuButton';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { drawPdfReportHeader } from '@/app/lib/reports/pdf-report-header';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { DateInput } from '@/components/ui/date-input';

export interface InterBranchTransferRow {
    id: string;
    slNo: number;
    date: string;
    transferFrom: string;
    transferTo: string;
    amount: number;
    toAmount: number;
    narration: string;
    createdBy: string;
}

const containerVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: {
        opacity: 1,
        y: 0,
        transition: {
            duration: 0.6,
            staggerChildren: 0.1
        }
    }
};

const itemVariants = {
    hidden: { opacity: 0, y: 10 },
    visible: { opacity: 1, y: 0 }
};

function toPaise(value: number): number {
    return Math.round(value * 100);
}

function formatCurrency(value: number): string {
    return `₹${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatSignedCurrency(value: number): string {
    const sign = value > 0 ? '+' : '';
    return `${sign}${formatCurrency(value)}`;
}

function formatDateSafe(value: string, pattern = 'dd/MM/yyyy'): string {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '-';
    return format(parsed, pattern);
}

interface StatsCardProps {
    label: string;
    value: number;
    icon: React.ReactNode;
    color: 'blue' | 'indigo' | 'emerald' | 'rose';
    description: string;
    isStatus?: boolean;
}

export function InterBranchTransferClient() {
    const [reportDate, setReportDate] = useState('');
    const [rows, setRows] = useState<InterBranchTransferRow[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [hasSearched, setHasSearched] = useState(false);
    const { toast } = useToast();

    // Branch filter — ADMIN sees all branches, AREA_MANAGER scoped to their assigned
    // branches, and any Head-Office-based user (incl. custom RBAC roles like "Zonal Head")
    // gets the same picker as ADMIN.
    const { isHeadOffice } = usePermission();
    const storedUser = tokenStorage.getUser();
    const isAdminOrAM = storedUser?.role === 'ADMIN' || storedUser?.role === 'AREA_MANAGER' || isHeadOffice;
    const [branches, setBranches] = useState<{ id: string; name: string; code: string }[]>([]);
    const [selectedBranchId, setSelectedBranchId] = useState('all');
    const [isLoadingBranches, setIsLoadingBranches] = useState(false);

    useEffect(() => {
        if (!isAdminOrAM) return;
        setIsLoadingBranches(true);
        fetch('/api/branches')
            .then((res) => res.json())
            .then((json) => {
                let list: { id: string; name: string; code: string }[] = (json?.data ?? []).map(
                    (b: any) => ({ id: b.id, name: b.name, code: b.code })
                );
                if (storedUser?.role === 'AREA_MANAGER') {
                    const assignedBranchIds = (storedUser as any)?.assignedBranchIds ?? [];
                    if (assignedBranchIds.length > 0) {
                        list = list.filter((b) => assignedBranchIds.includes(b.id));
                    }
                }
                setBranches(list);
            })
            .catch(() => {
                toast({ title: 'Error', description: 'Failed to load branches.', variant: 'destructive' });
            })
            .finally(() => setIsLoadingBranches(false));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAdminOrAM]);

    const fetchReport = async () => {
        if (!reportDate) {
            toast({
                title: 'Input Required',
                description: 'Please select a report date to continue.',
                variant: 'destructive',
            });
            return;
        }

        try {
            setIsLoading(true);
            setHasSearched(true);
            const branchParam = isAdminOrAM && selectedBranchId !== 'all' ? `&branchId=${selectedBranchId}` : '';
            const response = await apiClient.get(`/reports/daily-monitoring/inter-branch?date=${reportDate}${branchParam}`);

            if (!response.success) {
                setRows([]);
                toast({
                    title: 'Sync Failed',
                    description: response.error || 'Could not load inter-branch transfer data.',
                    variant: 'destructive',
                });
                return;
            }

            const reportRows = Array.isArray(response.data) ? response.data : [];
            setRows(reportRows);

            toast({
                title: 'Data Synchronized',
                description: `Found ${reportRows.length} transfers for ${reportDate}.`,
            });
        } catch (error) {
            console.error('Error fetching report:', error);
            toast({
                title: 'Sync Failed',
                description: 'Could not connect to the transaction ledger.',
                variant: 'destructive',
            });
        } finally {
            setIsLoading(false);
        }
    };

    const handleReset = () => {
        setReportDate('');
        setRows([]);
        setHasSearched(false);
    };

    const handleExportPdf = async () => {
        if (rows.length === 0) return;
        try {
            const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
            const reportFont = await ensureReportFont(doc);
            const headerY = await drawPdfReportHeader(doc, 'Inter-Branch Transfer Report', { subtitle: reportDate, fontFamily: reportFont });
            const headers = ['SL No.', 'Date', 'Transfer From', 'Transfer To', 'Amount', 'To Amount', 'Narration', 'Created By'];
            const tableRows = searchedRows.map((r) => [
                r.slNo, formatDateSafe(r.date), r.transferFrom, r.transferTo, formatCurrency(r.amount), formatCurrency(r.toAmount), r.narration, r.createdBy,
            ]);
            autoTable(doc, {
                startY: headerY,
                head: [headers],
                body: tableRows,
                theme: 'grid',
                styles: { font: reportFont, fontSize: 8, cellPadding: 1.5, lineColor: [0, 0, 0], lineWidth: 0.1, textColor: [0, 0, 0] },
                headStyles: { font: reportFont, fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold', halign: 'center' },
            });
            doc.save(`IBT_Report_${reportDate}.pdf`);
            toast({ title: 'Report Exported', description: 'The ledger data has been saved to PDF.' });
        } catch {
            toast({ title: 'Export Error', description: 'Failed to generate the PDF file.', variant: 'destructive' });
        }
    };

    const handleExport = () => {
        if (rows.length === 0) return;

        const exportData = searchedRows.map(r => ({
            'SL No.': r.slNo,
            'DATE': r.date,
            'TRF FROM': r.transferFrom,
            'TRF TO': r.transferTo,
            'AMOUNT': r.amount,
            'TO AMOUNT': r.toAmount,
            'NARRATION': r.narration,
            'CREATED BY': r.createdBy
        }));

        const ws = XLSX.utils.json_to_sheet(exportData);
        autoSizeColumns(ws);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Inter-Branch Transfers');
        normalizeWorkbookNumbers(wb);
        XLSX.writeFile(wb, `IBT_Report_${reportDate}.xlsx`);

        toast({
            title: 'Report Exported',
            description: 'The ledger data has been saved to Excel.',
        });
    };

    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(rows);

    const totalAmountPaise = useMemo(() => rows.reduce((sum, row) => sum + toPaise(row.amount), 0), [rows]);
    const totalToAmountPaise = useMemo(() => rows.reduce((sum, row) => sum + toPaise(row.toAmount), 0), [rows]);
    const differencePaise = totalToAmountPaise - totalAmountPaise;
    const totalAmount = totalAmountPaise / 100;
    const totalToAmount = totalToAmountPaise / 100;
    const difference = differencePaise / 100;
    const isReconciled = differencePaise === 0;

    return (
        <div className="flex min-h-screen flex-col">
            <div className="flex-1 px-3 sm:px-6 py-4 sm:py-8">
                <div className="mx-auto max-w-[1600px] space-y-8">
                    <div className="absolute inset-0 -z-10 overflow-hidden">
                        <div className="absolute left-1/4 top-1/4 h-80 w-80 rounded-full bg-primary/10 blur-3xl" />
                        <div className="absolute right-1/4 bottom-1/4 h-80 w-80 rounded-full bg-primary/10 blur-3xl" />
                    </div>

                    <motion.div
                        initial="hidden"
                        animate="visible"
                        variants={containerVariants}
                        className="relative"
                    >
                        <div className="flex flex-col justify-start p-8 gap-6 rounded-2xl border border-primary/20 bg-white shadow-sm dark:border-sidebar-accent dark:bg-brand-green-darker">
                            <div className="flex items-center gap-4">
                                <motion.div
                                    whileHover={{ scale: 1.04 }}
                                    transition={{ type: 'spring', stiffness: 200, damping: 16 }}
                                    className="relative flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary shadow-lg shadow-primary/30 shrink-0"
                                >
                                    <ArrowLeftRight className="h-7 w-7 text-white" />
                                </motion.div>

                                <div className="space-y-1">
                                    <motion.div variants={itemVariants} className="flex items-center gap-2">
                                        <Badge variant="secondary" className="px-2.5 py-1 bg-green-50 text-sidebar-accent border border-primary/20 font-semibold text-[11px]">
                                            <Zap className="w-3 h-3 mr-1" />
                                            Daily Monitoring
                                        </Badge>
                                    </motion.div>
                                    <motion.h1 variants={itemVariants} className="text-2xl md:text-3xl font-bold tracking-tight text-foreground dark:text-white">
                                        Inter-Branch Transfers
                                    </motion.h1>
                                    <motion.p variants={itemVariants} className="text-sm text-sidebar-accent dark:text-slate-400">
                                        Verify branch-to-branch liquidity movement and daily reconciliation status.
                                    </motion.p>
                                </div>
                            </div>

                            <motion.div variants={itemVariants} className="flex flex-col xl:flex-row items-end gap-4 bg-green-50 dark:bg-sidebar-accent/50 p-5 rounded-xl border border-primary/20 dark:border-sidebar-accent w-full">
                                {isAdminOrAM && (
                                    <div className="space-y-2">
                                        <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-200 ml-1">Branch</Label>
                                        <Select value={selectedBranchId} onValueChange={setSelectedBranchId} disabled={isLoadingBranches}>
                                            <SelectTrigger className="h-11 w-[220px] border border-primary/30 dark:border-sidebar-accent bg-white dark:bg-brand-green-darker text-sm font-medium">
                                                <SelectValue placeholder="All Branches" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="all">
                                                    {storedUser?.role === 'AREA_MANAGER' ? 'All Assigned Branches' : 'All Branches'}
                                                </SelectItem>
                                                {branches.map((b) => (
                                                    <SelectItem key={b.id} value={b.id}>
                                                        {b.code} - {b.name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                )}
                                <div className="space-y-2">
                                    <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-200 ml-1">Report Date</Label>
                                    <div className="relative rounded-lg">
                                        <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500 z-10" />
                                        <DateInput
                                            value={reportDate}
                                            onChange={(e) => setReportDate(e.target.value)}
                                            className="h-11 w-[240px] border border-primary/30 dark:border-sidebar-accent bg-white dark:bg-brand-green-darker pl-10 text-sm font-medium focus:ring-2 focus:ring-primary/20 hover:border-primary"
                                        />
                                    </div>
                                </div>

                                <div className="flex gap-3 w-full xl:w-auto">
                                    <Button
                                        onClick={fetchReport}
                                        disabled={isLoading}
                                        className="h-11 flex-1 xl:flex-none px-6 bg-primary hover:bg-primary text-white font-semibold"
                                    >
                                        {isLoading ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                                        Verify
                                    </Button>
                                    <Button
                                        variant="outline"
                                        onClick={handleReset}
                                        className="h-11 px-5 border-primary/30 text-sidebar-accent hover:border-red-300 hover:text-red-600 hover:bg-red-50 dark:border-sidebar-accent dark:text-slate-200"
                                    >
                                        <RotateCcw className="mr-2 h-4 w-4" />
                                        Reset
                                    </Button>
                                </div>
                            </motion.div>
                        </div>
                    </motion.div>

                    <AnimatePresence mode="wait">
                        {isLoading ? (
                            <motion.div
                                key="skeleton"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="grid grid-cols-1 md:grid-cols-3 gap-8"
                            >
                                {[1, 2, 3].map(i => (
                                    <Skeleton key={i} className="h-40 w-full rounded-xl" />
                                ))}
                                <Skeleton className="md:col-span-3 h-[560px] w-full rounded-xl" />
                            </motion.div>
                        ) : rows.length > 0 ? (
                            <motion.div
                                key="content"
                                initial="hidden"
                                animate="visible"
                                variants={containerVariants}
                                className="space-y-10"
                            >
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                                    <StatsCard
                                        label="Ledger Debits"
                                        value={totalAmount}
                                        icon={<TrendingUp className="w-6 h-6" />}
                                        color="blue"
                                        description="Total funds dispatched from source branches"
                                    />
                                    <StatsCard
                                        label="Ledger Credits"
                                        value={totalToAmount}
                                        icon={<TrendingDown className="w-6 h-6" />}
                                        color="indigo"
                                        description="Total funds received at destination branches"
                                    />
                                    <StatsCard
                                        label="Reconciliation"
                                        value={difference}
                                        icon={isReconciled ? <ShieldCheck className="w-6 h-6" /> : <AlertTriangle className="w-6 h-6" />}
                                        color={isReconciled ? 'emerald' : 'rose'}
                                        isStatus
                                        description={isReconciled ? 'Debits and credits are fully reconciled' : 'Difference detected in inter-branch movement'}
                                    />
                                </div>

                                <div className="flex items-center justify-between px-1">
                                    <div className="flex items-center gap-3">
                                        <h2 className="text-lg font-bold text-foreground dark:text-white">Inter-Branch Transfer Ledger</h2>
                                        <div className="px-2.5 py-1 rounded-full bg-brand-green-tint dark:bg-sidebar-accent border border-primary/20 dark:border-sidebar-accent text-[11px] font-medium text-slate-500">
                                            {searchedRows.length} entries
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <TableSearchInput
                                            value={tableSearchQuery}
                                            onChange={setTableSearchQuery}
                                            placeholder="Search transfers..."
                                        />
                                        <ExportMenuButton
                                            onExportExcel={handleExport}
                                            onExportPdf={handleExportPdf}
                                            className="bg-primary hover:bg-primary text-white h-9 px-4 text-sm font-semibold"
                                            label="Export"
                                        />
                                    </div>
                                </div>

                                <motion.div
                                    variants={itemVariants}
                                    className="relative overflow-hidden rounded-xl border border-primary/20 bg-white shadow-sm dark:border-sidebar-accent dark:bg-brand-green-darker"
                                >
                                    <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary via-primary to-primary" />

                                    <div className="max-h-[700px] overflow-auto scrollbar-thin scrollbar-thumb-primary/20 scrollbar-track-transparent">
                                        <Table className="whitespace-nowrap">
                                            <TableHeader className="sticky top-0 z-20 bg-green-50 dark:bg-brand-green-darker">
                                                <TableRow className="hover:bg-transparent border-primary/20/60 dark:border-sidebar-accent/60">
                                                    <TableHead className="w-20 px-6 py-4 text-[11px] font-semibold text-sidebar-accent dark:text-slate-300 text-center">SL</TableHead>
                                                    <TableHead className="px-6 py-4 text-[11px] font-semibold text-sidebar-accent dark:text-slate-300">Transfer ID</TableHead>
                                                    <TableHead className="px-6 py-4 text-[11px] font-semibold text-sidebar-accent dark:text-slate-300">From / To</TableHead>
                                                    <TableHead className="px-6 py-4 text-[11px] font-semibold text-sidebar-accent dark:text-slate-300 text-right">Debit</TableHead>
                                                    <TableHead className="px-6 py-4 text-[11px] font-semibold text-sidebar-accent dark:text-slate-300 text-right">Credit</TableHead>
                                                    <TableHead className="px-6 py-4 text-[11px] font-semibold text-sidebar-accent dark:text-slate-300">Narration</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {searchedRows.map((row) => (
                                                    <TableRow
                                                        key={row.id}
                                                        className="group hover:bg-green-50 dark:hover:bg-sidebar-accent/50 transition-colors border-primary/20/40 dark:border-sidebar-accent/40"
                                                    >
                                                        <TableCell className="px-6 py-4 text-sm font-semibold text-slate-500 text-center">
                                                            {String(row.slNo).padStart(2, '0')}
                                                        </TableCell>
                                                        <TableCell className="px-6 py-4">
                                                            <div className="space-y-0.5">
                                                                <div className="text-sm font-semibold text-foreground dark:text-white">
                                                                    TX-{row.id.slice(-8).toUpperCase()}
                                                                </div>
                                                                <div className="text-[11px] text-slate-500">
                                                                    Executed {formatDateSafe(row.date)}
                                                                </div>
                                                            </div>
                                                        </TableCell>
                                                        <TableCell className="px-6 py-4">
                                                            <div className="flex flex-col gap-1.5 items-start">
                                                                <Badge className="bg-brand-green-darker dark:bg-brand-green-tint text-white dark:text-foreground px-2.5 py-0.5 rounded-md text-[10px] font-semibold">
                                                                    {row.transferFrom}
                                                                </Badge>
                                                                <ArrowRight className="h-3 w-3 text-slate-300 ml-3" />
                                                                <Badge variant="outline" className="border-primary/30 text-sidebar-accent dark:text-green-300 px-2.5 py-0.5 rounded-md text-[10px] font-semibold">
                                                                    {row.transferTo}
                                                                </Badge>
                                                            </div>
                                                        </TableCell>
                                                        <TableCell className="px-6 py-4 text-right">
                                                            <span className="text-base font-semibold text-foreground dark:text-white tabular-nums">
                                                                {formatCurrency(row.amount)}
                                                            </span>
                                                        </TableCell>
                                                        <TableCell className="px-6 py-4 text-right">
                                                            <span className="text-base font-semibold text-foreground dark:text-white tabular-nums">
                                                                {formatCurrency(row.toAmount)}
                                                            </span>
                                                        </TableCell>
                                                        <TableCell className="px-6 py-4 max-w-sm">
                                                            <p className="text-xs text-sidebar-accent dark:text-slate-300 leading-relaxed">
                                                                {row.narration || 'No narration provided.'}
                                                            </p>
                                                            <div className="flex items-center gap-1 mt-1.5 text-[10px] text-slate-400">
                                                                <Layers className="w-3 h-3" />
                                                                Authorized by {row.createdBy}
                                                            </div>
                                                        </TableCell>
                                                    </TableRow>
                                                ))}

                                                <TableRow className="bg-green-50/80 dark:bg-sidebar-accent/40 border-t border-primary/20 dark:border-sidebar-accent">
                                                    <TableCell className="px-6 py-4 text-center font-semibold text-slate-500">-</TableCell>
                                                    <TableCell className="px-6 py-4" />
                                                    <TableCell className="px-6 py-4 text-sm font-bold text-foreground dark:text-white">
                                                        Grand Total
                                                    </TableCell>
                                                    <TableCell className="px-6 py-4 text-right">
                                                        <span className="text-lg font-bold text-foreground dark:text-white tabular-nums">
                                                            {formatCurrency(totalAmount)}
                                                        </span>
                                                    </TableCell>
                                                    <TableCell className="px-6 py-4 text-right">
                                                        <span className="text-lg font-bold text-foreground dark:text-white tabular-nums">
                                                            {formatCurrency(totalToAmount)}
                                                        </span>
                                                    </TableCell>
                                                    <TableCell className="px-6 py-4">
                                                        <div className={cn(
                                                            'inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-semibold',
                                                            isReconciled
                                                                ? 'text-emerald-700 bg-emerald-50 border border-emerald-200 dark:text-emerald-300 dark:bg-emerald-950/30 dark:border-emerald-900'
                                                                : 'text-rose-700 bg-rose-50 border border-rose-200 dark:text-rose-300 dark:bg-rose-950/30 dark:border-rose-900'
                                                        )}>
                                                            {isReconciled ? <BadgeCheck className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                                                            Diff {formatSignedCurrency(difference)}
                                                        </div>
                                                    </TableCell>
                                                </TableRow>
                                            </TableBody>
                                        </Table>
                                    </div>
                                </motion.div>
                            </motion.div>
                        ) : hasSearched ? (
                            <motion.div
                                key="empty"
                                initial={{ opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="flex flex-col items-center justify-center p-20 bg-white rounded-2xl border border-primary/20 shadow-sm dark:bg-brand-green-darker dark:border-sidebar-accent text-center space-y-6"
                            >
                                <div className="relative p-6 rounded-2xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900">
                                    <AlertCircle className="w-14 h-14 text-amber-500" />
                                </div>
                                <div className="space-y-3">
                                    <h3 className="text-2xl font-bold text-foreground dark:text-white">No Transfers Found</h3>
                                    <p className="text-sm text-slate-500 max-w-sm mx-auto leading-relaxed">
                                        No inter-branch transfer entries were found for the selected report date.
                                    </p>
                                </div>
                                <Button
                                    variant="outline"
                                    onClick={handleReset}
                                    className="h-10 px-5 text-sm font-semibold border-primary/30 text-sidebar-accent hover:border-primary hover:text-sidebar-accent hover:bg-green-50 dark:border-sidebar-accent dark:text-slate-200"
                                >
                                    Redefine Search
                                </Button>
                            </motion.div>
                        ) : (
                            <motion.div
                                key="initial"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                className="flex flex-col items-center justify-center p-20 bg-white rounded-2xl border border-primary/20 shadow-sm dark:bg-brand-green-darker dark:border-sidebar-accent text-center space-y-8"
                            >
                                <div className="relative p-6 rounded-2xl bg-green-50 border border-primary/20 dark:bg-green-950/20 dark:border-brand-green-darker">
                                    <Sparkles className="w-12 h-12 text-primary" />
                                </div>
                                <div className="space-y-4">
                                    <h3 className="text-2xl font-bold text-foreground dark:text-white">Select Report Date</h3>
                                    <p className="text-sm text-slate-500 max-w-sm mx-auto leading-relaxed">
                                        Choose a date above to load and reconcile inter-branch transfer movements.
                                    </p>
                                </div>
                                <div className="flex items-center gap-2 text-slate-400 mt-2">
                                    <MousePointer2 className="w-4 h-4 fill-current" />
                                    <span className="text-xs font-semibold">Use the filter to begin</span>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </div>
        </div>
    );
}

function StatsCard({ label, value, icon, color, description, isStatus = false }: StatsCardProps) {
    const colorClasses: Record<StatsCardProps['color'], string> = {
        blue: "bg-primary/10 text-primary border-primary/20 shadow-primary/10",
        indigo: "bg-primary/10 text-primary border-primary/20 shadow-primary/10",
        emerald: "bg-emerald-500 text-emerald-500 border-emerald-500/20 shadow-emerald-500/10",
        rose: "bg-rose-500 text-rose-500 border-rose-500/20 shadow-rose-500/10"
    };

    return (
        <motion.div
            variants={itemVariants}
            whileHover={{ y: -3 }}
            className="group relative overflow-hidden rounded-xl border border-primary/20 bg-white p-6 shadow-sm transition-all duration-300 dark:border-sidebar-accent dark:bg-brand-green-darker"
        >
            <div className={cn("absolute top-0 right-0 w-32 h-32 blur-[80px] opacity-20 transition-opacity group-hover:opacity-40", colorClasses[color].split(' ')[0])} />

            <div className="flex justify-between items-start relative z-10">
                <div className="space-y-4">
                    <div className="space-y-1">
                        <p className={cn("text-[11px] font-semibold", colorClasses[color].split(' ')[1])}>
                            {label}
                        </p>
                        <h3 className="text-2xl font-bold text-foreground dark:text-white tracking-tight tabular-nums">
                            {isStatus
                                ? (value === 0 ? "RECONCILED" : formatSignedCurrency(value))
                                : formatCurrency(Math.abs(value))}
                        </h3>
                    </div>
                    <p className="text-xs text-slate-500 max-w-[220px] leading-relaxed">
                        {description}
                    </p>
                </div>
                <div className={cn(
                    "p-3 rounded-lg text-white shadow-sm transform transition-transform duration-300 group-hover:scale-105",
                    colorClasses[color].split(' ')[0]
                )}>
                    {icon}
                </div>
            </div>

            <div className="mt-5 flex items-center gap-2 opacity-60 group-hover:opacity-100 transition-opacity">
                <div className={cn("h-1.5 w-12 rounded-full", colorClasses[color].split(' ')[0])} />
                <span className="text-[10px] font-medium text-slate-500">Live Snapshot</span>
            </div>
        </motion.div>
    );
}

