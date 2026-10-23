'use client';

import { useState, useMemo, useEffect } from 'react';
import {
    CalendarDays,
    RefreshCw,
    Search,
    TrendingUp,
    AlertCircle,
    MousePointer2,
    Sparkles,
    Landmark,
    Target,
    Users
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { tokenStorage } from '@/app/lib/token-storage';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import * as XLSX from 'xlsx';
import { autoSizeColumns, normalizeWorkbookNumbers } from '@/app/lib/reports/excel-report-header';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';
import { usePermission } from '@/app/hooks/usePermission';
import { getCentersForDropdown, CenterOption } from '@/app/lib/actions/centers';
import { ExportMenuButton } from '@/components/daily-monitoring/ExportMenuButton';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { drawPdfReportHeader } from '@/app/lib/reports/pdf-report-header';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { DateInput } from '@/components/ui/date-input';

export interface AdvanceCollectionRow {
    id: string;
    branchName: string;
    centerName: string;
    memberName: string;
    loanId: string;
    dueAmount: number;
    collAmount: number;
    toBeCollected: number;
    dueDate: string;
    paidDate: string;
    status: string;
    arrear: number;
    loanOs: number;
    meetingDay: string;
    nextMeetingDate: string;
    fieldOfficer: string;
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

function formatAmount(value: number): string {
    return value.toLocaleString('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}

function formatDateSafe(value?: string, pattern = 'dd/MM/yyyy'): string {
    if (!value || value === '-') return '-';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '-';
    return format(parsed, pattern);
}

export function AdvanceCollectionClient() {
    const [fromDate, setFromDate] = useState('');
    const [tillDate, setTillDate] = useState('');
    const [rows, setRows] = useState<AdvanceCollectionRow[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [hasSearched, setHasSearched] = useState(false);
    const { toast } = useToast();

    // Branch filter — ADMIN/AREA_MANAGER/Head-Office-based users (incl. custom RBAC roles
    // like "Zonal Head") must pick one branch (report is single-branch, no "all branches"
    // mode on the server); BRANCH_MANAGER is scoped server-side.
    const { isHeadOffice } = usePermission();
    const storedUser = tokenStorage.getUser();
    const isAdminOrAM = storedUser?.role === 'ADMIN' || storedUser?.role === 'AREA_MANAGER' || isHeadOffice;
    const [branches, setBranches] = useState<{ id: string; name: string; code: string }[]>([]);
    const [selectedBranchId, setSelectedBranchId] = useState('');
    const [isLoadingBranches, setIsLoadingBranches] = useState(false);

    // Center filter — server action already scopes the list per role
    const [centers, setCenters] = useState<CenterOption[]>([]);
    const [selectedCenterId, setSelectedCenterId] = useState('all');
    const filteredCenters = selectedBranchId
        ? centers.filter((c) => c.branchId === selectedBranchId)
        : centers;

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

    useEffect(() => {
        getCentersForDropdown()
            .then(setCenters)
            .catch(() => {
                toast({ title: 'Error', description: 'Failed to load centers.', variant: 'destructive' });
            });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const fetchReport = async () => {
        if (!fromDate || !tillDate) {
            toast({
                title: 'Date Range Required',
                description: 'Please select both from and till dates to proceed.',
                variant: 'destructive',
            });
            return;
        }
        if (fromDate > tillDate) {
            toast({
                title: 'Invalid Date Range',
                description: 'From date cannot be later than till date.',
                variant: 'destructive',
            });
            return;
        }
        if (isAdminOrAM && !selectedBranchId) {
            toast({
                title: 'Branch Required',
                description: 'Please select a branch to proceed.',
                variant: 'destructive',
            });
            return;
        }

        try {
            setIsLoading(true);
            setHasSearched(true);
            const branchParam = isAdminOrAM ? `&branchId=${selectedBranchId}` : '';
            const centerParam = selectedCenterId !== 'all' ? `&centerId=${selectedCenterId}` : '';
            const response = await apiClient.get(`/reports/daily-monitoring/advance-collection?fromDate=${fromDate}&tillDate=${tillDate}${branchParam}${centerParam}`);

            if (!response.success) {
                setRows([]);
                toast({
                    title: 'Sync Failed',
                    description: response.error || 'Could not load report data.',
                    variant: 'destructive',
                });
                return;
            }

            const reportRows = Array.isArray(response.data) ? response.data : [];
            setRows(reportRows);

            toast({
                title: 'Data Synchronized',
                description: `Successfully loaded ${reportRows.length} scheduled records.`,
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
        setFromDate('');
        setTillDate('');
        setSelectedCenterId('all');
        setRows([]);
        setHasSearched(false);
    };

    const handleExportPdf = async () => {
        if (rows.length === 0) return;
        try {
            const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
            const reportFont = await ensureReportFont(doc);
            const headerY = await drawPdfReportHeader(doc, 'Advance Collection Report', { subtitle: `From ${fromDate} to ${tillDate}`, fontFamily: reportFont });
            const headers = ['Branch', 'Center', 'Member', 'Loan ID', 'Due', 'Collected', 'To Be Collected', 'Due Date', 'Paid Date', 'Status', 'Arrear', 'Loan OS', 'Meeting Day', 'Next Meeting', 'Field Officer'];
            const tableRows = searchedRows.map((r) => [
                r.branchName, r.centerName, r.memberName, r.loanId, formatAmount(r.dueAmount), formatAmount(r.collAmount),
                formatAmount(r.toBeCollected), formatDateSafe(r.dueDate), formatDateSafe(r.paidDate), r.status,
                formatAmount(r.arrear), formatAmount(r.loanOs), r.meetingDay, formatDateSafe(r.nextMeetingDate), r.fieldOfficer,
            ]);
            autoTable(doc, {
                startY: headerY,
                head: [headers],
                body: tableRows,
                theme: 'grid',
                styles: { font: reportFont, fontSize: 7, cellPadding: 1.2, lineColor: [0, 0, 0], lineWidth: 0.1, textColor: [0, 0, 0] },
                headStyles: { font: reportFont, fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold', halign: 'center' },
            });
            doc.save(`AdvanceCollection_${fromDate}_to_${tillDate}.pdf`);
            toast({ title: 'Report Exported', description: 'The ledger data has been saved to PDF.' });
        } catch {
            toast({ title: 'Export Error', description: 'Failed to generate the PDF file.', variant: 'destructive' });
        }
    };

    const handleExport = () => {
        if (rows.length === 0) return;

        const exportData = searchedRows.map(r => ({
            'BRANCH': r.branchName,
            'CENTER': r.centerName,
            'MEMBERNAME': r.memberName,
            'LOAN_ID': r.loanId,
            'DUEAMOUNT': r.dueAmount,
            'COLLAMT_APPROVED': r.collAmount,
            'TOBECOLLECTED': r.toBeCollected,
            'DUE_DATE': formatDateSafe(r.dueDate),
            'PAID_DATE': formatDateSafe(r.paidDate),
            'CSTATUS': r.status,
            'ARREAR': r.arrear,
            'LOANOS': r.loanOs,
            'MEETINGDAY': r.meetingDay,
            'NEXTMEETINGDATE': r.nextMeetingDate,
            'FIELDOFFICER': r.fieldOfficer
        }));

        const ws = XLSX.utils.json_to_sheet(exportData);
        autoSizeColumns(ws);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Advance Collection');
        normalizeWorkbookNumbers(wb);
        XLSX.writeFile(wb, `AdvanceCollection_${fromDate}_to_${tillDate}.xlsx`);

        toast({
            title: 'Report Exported',
            description: 'The ledger data has been saved to Excel.',
        });
    };

    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(rows);

    const totalDue = useMemo(() => rows.reduce((sum, row) => sum + row.dueAmount, 0), [rows]);
    const totalColl = useMemo(() => rows.reduce((sum, row) => sum + row.collAmount, 0), [rows]);
    const totalToBeCollected = useMemo(() => rows.reduce((sum, row) => sum + row.toBeCollected, 0), [rows]);

    return (
        <div className="flex min-h-screen flex-col">
            <div className="flex-1 px-3 sm:px-6 py-4 sm:py-8">
                <div className="mx-auto max-w-[1600px] space-y-8">
                    <div className="absolute inset-0 -z-10 overflow-hidden">
                        <div className="absolute left-1/4 top-1/4 h-80 w-80 rounded-full bg-primary/10 blur-3xl" />
                        <div className="absolute right-1/4 bottom-1/4 h-80 w-80 rounded-full bg-primary/10 blur-3xl" />
                    </div>
                {/* Hero / Filter Section */}
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
                                transition={{ type: "spring", stiffness: 200, damping: 16 }}
                                className="relative flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary shadow-lg shadow-primary/30 shrink-0"
                            >
                                <Target className="h-7 w-7 text-white" />
                            </motion.div>

                            <div className="space-y-1">
                                <motion.div variants={itemVariants} className="flex items-center gap-2">
                                    <Badge variant="secondary" className="px-2.5 py-1 bg-green-50 text-sidebar-accent border border-primary/20 font-semibold text-[11px]">
                                        <Landmark className="w-3 h-3 mr-1" />
                                        Daily Monitoring
                                    </Badge>
                                </motion.div>
                                <motion.h1
                                    variants={itemVariants}
                                    className="text-2xl md:text-3xl font-bold tracking-tight text-foreground dark:text-white"
                                >
                                    Advance Collection
                                </motion.h1>
                                <motion.p variants={itemVariants} className="text-sm text-sidebar-accent dark:text-slate-400">
                                    Monitor scheduled demand, collected amount, arrears, and branch liquidity exposure.
                                </motion.p>
                            </div>
                        </div>

                        <motion.div variants={itemVariants} className="flex flex-wrap items-end gap-4 bg-green-50 dark:bg-sidebar-accent/50 p-5 rounded-xl border border-primary/20 dark:border-sidebar-accent w-full">
                            {isAdminOrAM && (
                                <div className="space-y-3">
                                    <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-200 ml-1">Branch</Label>
                                    <Select value={selectedBranchId} onValueChange={(v) => { setSelectedBranchId(v); setSelectedCenterId('all'); }} disabled={isLoadingBranches}>
                                        <SelectTrigger className="h-11 w-[220px] border border-primary/30 dark:border-sidebar-accent bg-white dark:bg-brand-green-darker text-sm font-medium">
                                            <SelectValue placeholder="-- SELECT BRANCH --" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {branches.map((b) => (
                                                <SelectItem key={b.id} value={b.id}>
                                                    {b.code} - {b.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}
                            <div className="space-y-3">
                                <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-200 ml-1">Center</Label>
                                <Select value={selectedCenterId} onValueChange={setSelectedCenterId}>
                                    <SelectTrigger className="h-11 w-[220px] border border-primary/30 dark:border-sidebar-accent bg-white dark:bg-brand-green-darker text-sm font-medium">
                                        <SelectValue placeholder="All Centers" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Centers</SelectItem>
                                        {filteredCenters.map((c) => (
                                            <SelectItem key={c.id} value={c.id}>
                                                {c.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-3">
                                <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-200 ml-1">From Date</Label>
                                <div className="relative rounded-lg">
                                    <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500 z-10" />
                                    <DateInput
                                        value={fromDate}
                                        onChange={(e) => setFromDate(e.target.value)}
                                        className="h-11 w-[220px] border border-primary/30 dark:border-sidebar-accent bg-white dark:bg-brand-green-darker pl-10 text-sm font-medium focus:ring-2 focus:ring-primary/20 hover:border-primary"
                                    />
                                </div>
                            </div>
                            <div className="space-y-3">
                                <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-200 ml-1">Till Date</Label>
                                <div className="relative rounded-lg">
                                    <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500 z-10" />
                                    <DateInput
                                        value={tillDate}
                                        onChange={(e) => setTillDate(e.target.value)}
                                        className="h-11 w-[220px] border border-primary/30 dark:border-sidebar-accent bg-white dark:bg-brand-green-darker pl-10 text-sm font-medium focus:ring-2 focus:ring-primary/20 hover:border-primary"
                                    />
                                </div>
                            </div>
                            <div className="space-y-3">
                                <Label className="invisible text-sm font-semibold ml-1 select-none" aria-hidden="true">Actions</Label>
                                <div className="flex gap-3">
                                    <Button
                                        onClick={fetchReport}
                                        disabled={isLoading}
                                        className="h-11 px-6 bg-primary hover:bg-primary text-white font-semibold"
                                    >
                                        {isLoading ? (
                                            <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                                        ) : (
                                            <Search className="mr-2 h-4 w-4" />
                                        )}
                                        Show
                                    </Button>
                                    <Button
                                        variant="outline"
                                        onClick={handleReset}
                                        className="h-11 px-5 border-primary/30 text-sidebar-accent hover:border-red-300 hover:text-red-600 hover:bg-red-50 dark:border-sidebar-accent dark:text-slate-200"
                                    >
                                        Reset
                                    </Button>
                                </div>
                            </div>
                        </motion.div>
                    </div>
                </motion.div>

                {/* Dashboard / Analytics Section */}
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
                            {/* Summary Analytics Cards */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                                <StatsCard
                                    label="Target Collection (DUE)"
                                    value={totalDue}
                                    icon={<Target className="w-6 h-6" />}
                                    color="blue"
                                    description="Aggregate scheduled principal and interest"
                                />
                                <StatsCard
                                    label="Realized Liquidity (COLL)"
                                    value={totalColl}
                                    icon={<TrendingUp className="w-6 h-6" />}
                                    color="emerald"
                                    description="Fund amount successfully deposited"
                                />
                                <StatsCard
                                    label="Remaining Collection"
                                    value={totalToBeCollected}
                                    icon={<AlertCircle className="w-6 h-6" />}
                                    color="amber"
                                    description="Outstanding amount after approved collections"
                                />
                            </div>

                            {/* Advanced Action Bar */}
                            <div className="flex items-center justify-between px-1">
                                <div className="flex items-center gap-3">
                                    <h2 className="text-lg font-bold text-foreground dark:text-white">Advance Collection Ledger</h2>
                                    <div className="px-2.5 py-1 rounded-full bg-brand-green-tint dark:bg-sidebar-accent border border-primary/20 dark:border-sidebar-accent text-[11px] font-medium text-slate-500">
                                        Showing 1 to {searchedRows.length} of {rows.length} entries
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <TableSearchInput
                                        value={tableSearchQuery}
                                        onChange={setTableSearchQuery}
                                        placeholder="Search ledger..."
                                    />
                                    <ExportMenuButton
                                        onExportExcel={handleExport}
                                        onExportPdf={handleExportPdf}
                                        className="bg-primary hover:bg-primary text-white h-9 px-4 text-sm font-semibold"
                                        label="Export"
                                    />
                                </div>
                            </div>

                            {/* High-Fidelity Table Container */}
                            <motion.div
                                variants={itemVariants}
                                className="relative overflow-hidden rounded-xl border border-primary/20 bg-white shadow-sm dark:border-sidebar-accent dark:bg-brand-green-darker"
                            >
                                <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary via-primary to-primary" />

                                <div className="max-h-[700px] overflow-auto scrollbar-thin scrollbar-thumb-primary/20 scrollbar-track-transparent">
                                    <Table className="whitespace-nowrap">
                                        <TableHeader className="sticky top-0 z-20 bg-green-50 dark:bg-brand-green-darker">
                                            <TableRow className="hover:bg-transparent border-primary/20/60 dark:border-sidebar-accent/60">
                                                <TableHead className="px-6 py-4 text-[11px] font-semibold text-sidebar-accent dark:text-slate-300">Branch</TableHead>
                                                <TableHead className="px-6 py-4 text-[11px] font-semibold text-sidebar-accent dark:text-slate-300">Center</TableHead>
                                                <TableHead className="px-6 py-4 text-[11px] font-semibold text-sidebar-accent dark:text-slate-300">Member</TableHead>
                                                <TableHead className="px-6 py-4 text-[11px] font-semibold text-sidebar-accent dark:text-slate-300">Loan ID</TableHead>
                                                <TableHead className="px-6 py-4 text-[11px] font-semibold text-sidebar-accent dark:text-slate-300 text-right">Due</TableHead>
                                                <TableHead className="px-6 py-4 text-[11px] font-semibold text-sidebar-accent dark:text-slate-300 text-right">Collected</TableHead>
                                                <TableHead className="px-6 py-4 text-[11px] font-semibold text-sidebar-accent dark:text-slate-300 text-right">To Be Collected</TableHead>
                                                <TableHead className="px-6 py-4 text-[11px] font-semibold text-sidebar-accent dark:text-slate-300">Due Date</TableHead>
                                                <TableHead className="px-6 py-4 text-[11px] font-semibold text-sidebar-accent dark:text-slate-300">Paid Date</TableHead>
                                                <TableHead className="px-6 py-4 text-[11px] font-semibold text-sidebar-accent dark:text-slate-300">Status</TableHead>
                                                <TableHead className="px-6 py-4 text-[11px] font-semibold text-sidebar-accent dark:text-slate-300 text-right">Arrear</TableHead>
                                                <TableHead className="px-6 py-4 text-[11px] font-semibold text-sidebar-accent dark:text-slate-300 text-right">Loan OS</TableHead>
                                                <TableHead className="px-6 py-4 text-[11px] font-semibold text-sidebar-accent dark:text-slate-300">Meeting Day</TableHead>
                                                <TableHead className="px-6 py-4 text-[11px] font-semibold text-sidebar-accent dark:text-slate-300">Next Meeting</TableHead>
                                                <TableHead className="px-6 py-4 text-[11px] font-semibold text-sidebar-accent dark:text-slate-300">Field Officer</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody className="text-xs">
                                            {searchedRows.map((row) => (
                                                <TableRow
                                                    key={row.id}
                                                    className="group hover:bg-green-50 dark:hover:bg-sidebar-accent/50 transition-colors border-primary/20/40 dark:border-sidebar-accent/40 cursor-default"
                                                >
                                                    <TableCell className="px-6 py-4 font-bold text-sidebar-accent dark:text-slate-300 uppercase tracking-tighter">
                                                        {row.branchName}
                                                    </TableCell>
                                                    <TableCell className="px-6 py-4 font-bold text-sidebar-accent dark:text-slate-300 uppercase tracking-tighter">
                                                        {row.centerName}
                                                    </TableCell>
                                                    <TableCell className="px-6 py-4">
                                                        <div className="flex items-center gap-2">
                                                            <div className="h-6 w-6 rounded-md bg-primary/10 dark:bg-brand-green-darker/40 flex items-center justify-center">
                                                                <Users className="h-3 w-3 text-primary dark:text-primary" />
                                                            </div>
                                                            <span className="font-semibold text-foreground dark:text-white tracking-wide">{row.memberName}</span>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="px-6 py-4 font-black text-slate-500 uppercase tracking-tight">
                                                        {row.loanId}
                                                    </TableCell>
                                                    <TableCell className="px-6 py-4 text-right">
                                                        <span className="font-black text-foreground dark:text-white tabular-nums drop-shadow-sm">
                                                            {formatAmount(row.dueAmount)}
                                                        </span>
                                                    </TableCell>
                                                    <TableCell className="px-6 py-4 text-right">
                                                        <span className="font-black text-foreground dark:text-white tabular-nums drop-shadow-sm">
                                                            {formatAmount(row.collAmount)}
                                                        </span>
                                                    </TableCell>
                                                    <TableCell className="px-6 py-4 text-right">
                                                        <span className="font-semibold text-sidebar-accent dark:text-green-300 tabular-nums px-2 py-1 rounded bg-green-50 dark:bg-green-950/30">
                                                            {formatAmount(row.toBeCollected)}
                                                        </span>
                                                    </TableCell>
                                                    <TableCell className="px-6 py-4 font-medium text-slate-500 dark:text-slate-400 tabular-nums tracking-widest">
                                                        {formatDateSafe(row.dueDate)}
                                                    </TableCell>
                                                    <TableCell className="px-6 py-4 font-medium text-slate-500 dark:text-slate-400 tabular-nums tracking-widest">
                                                        {formatDateSafe(row.paidDate)}
                                                    </TableCell>
                                                    <TableCell className="px-6 py-4">
                                                        <Badge variant="outline" className={cn(
                                                            "uppercase font-black text-[9px] tracking-widest px-2.5 py-1 border",
                                                            row.status === 'PENDING' ? "bg-amber-500/10 text-amber-600 border-amber-500/20" :
                                                                row.status === 'PAID' ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" :
                                                                    row.status === 'PARTIALLY_PAID' ? "bg-primary/10 text-primary border-primary/20" :
                                                                        row.status === 'OVERDUE' ? "bg-rose-500/10 text-rose-600 border-rose-500/20" :
                                                                    "bg-green-500/10 text-sidebar-accent border-slate-500/20"
                                                        )}>
                                                            {row.status}
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell className="px-6 py-4 text-right">
                                                        <span className="font-black text-rose-500 dark:text-rose-400 tabular-nums drop-shadow-sm">
                                                            {row.arrear.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                                        </span>
                                                    </TableCell>
                                                    <TableCell className="px-6 py-4 text-right">
                                                        <span className="font-black text-foreground dark:text-white tabular-nums drop-shadow-sm">
                                                            {row.loanOs.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                                        </span>
                                                    </TableCell>
                                                    <TableCell className="px-6 py-4 font-bold text-slate-500 uppercase tracking-widest">
                                                        {row.meetingDay}
                                                    </TableCell>
                                                    <TableCell className="px-6 py-4 font-medium text-slate-500 dark:text-slate-400 tabular-nums tracking-widest">
                                                        {formatDateSafe(row.nextMeetingDate)}
                                                    </TableCell>
                                                    <TableCell className="px-6 py-4 font-bold text-sidebar-accent dark:text-slate-300 uppercase tracking-tighter">
                                                        {row.fieldOfficer}
                                                    </TableCell>
                                                </TableRow>
                                            ))}
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
                            <div className="relative group">
                                <div className="relative p-6 rounded-2xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900">
                                    <BadgeCheck className="w-14 h-14 text-emerald-500" />
                                </div>
                            </div>
                            <div className="space-y-3">
                                <h3 className="text-2xl font-bold text-foreground dark:text-white">No Records Found</h3>
                                <p className="text-sm text-slate-500 max-w-sm mx-auto leading-relaxed">
                                    No active schedules require collection follow-up for the specified timeframe.
                                </p>
                            </div>
                        </motion.div>
                    ) : (
                        <motion.div
                            key="initial"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="flex flex-col items-center justify-center p-20 bg-white rounded-2xl border border-primary/20 shadow-sm dark:bg-brand-green-darker dark:border-sidebar-accent text-center space-y-8"
                        >
                            <div className="relative p-6 rounded-2xl bg-green-50 border border-primary/20 dark:bg-green-950/20 dark:border-brand-green-darker">
                                <div className="relative">
                                    <Sparkles className="w-12 h-12 text-primary font-extrabold" />
                                </div>
                            </div>
                            <div className="space-y-4">
                                <h3 className="text-2xl font-bold text-foreground dark:text-white">Select Date Range</h3>
                                <p className="text-sm text-slate-500 max-w-sm mx-auto leading-relaxed">
                                    Choose the date window above to load the advance collection report.
                                </p>
                            </div>
                            <div className="flex items-center gap-2 text-slate-400 mt-2">
                                <MousePointer2 className="w-4 h-4 fill-current" />
                                <span className="text-xs font-semibold">Use the filters to begin</span>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
            </div>
        </div>
    );
}

interface StatsCardProps {
    label: string;
    value: number;
    icon: React.ReactNode;
    color: 'blue' | 'indigo' | 'emerald' | 'amber';
    description: string;
}

function StatsCard({ label, value, icon, color, description }: StatsCardProps) {
    const colorClasses: Record<string, string> = {
        blue: "bg-primary/10 text-primary border-primary/20 shadow-primary/10",
        indigo: "bg-primary/10 text-primary border-primary/20 shadow-primary/10",
        emerald: "bg-emerald-500 text-emerald-500 border-emerald-500/20 shadow-emerald-500/10",
        amber: "bg-amber-500 text-amber-500 border-amber-500/20 shadow-amber-500/10"
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
                            ₹{Math.abs(value).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
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

function BadgeCheck(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg
            {...props}
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z" />
            <path d="m9 12 2 2 4-4" />
        </svg>
    );
}
