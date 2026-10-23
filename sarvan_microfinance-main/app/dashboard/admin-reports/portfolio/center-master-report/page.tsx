'use client';

import { useState, useEffect } from 'react';
import * as XLSX from 'xlsx-js-style';
import jsPDF from 'jspdf';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
    MapPin,
    Download,
    RefreshCw,
    Search,
    Loader2,
    FileText,
    FileType,
    ChevronLeft,
    ChevronRight,
    Filter,
    FileSpreadsheet,
} from 'lucide-react';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { useToast } from '@/hooks/use-toast';
import { usePermission } from '@/app/hooks/usePermission';
import { cn } from '@/lib/utils';
import { tokenStorage } from '@/app/lib/token-storage';
import { branchStorage } from '@/app/lib/branch-storage';
import type { UserRole } from '@/app/types';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { drawCenterMasterSummaryReport } from '@/app/lib/reports/center-master-summary-pdf';
import { buildReportSheet, autoSizeColumns, normalizeWorkbookNumbers } from '@/app/lib/reports/excel-report-header';
import { exportToCSV, exportToWord, type WordExportOptions } from '@/app/lib/report-export-utils';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { PageLoader } from '@/components/ui/page-loader';
import { DateInput } from '@/components/ui/date-input';

interface CenterMasterRow {
    ourBranchID: string;
    centreID: string;
    centreName: string;
    visitDate: string;
    fdoName: string;
    meetingDay: string;
    meetingTime: string;
    fromBranch: string;
    fromDO: string;
    contactPerson: string;
    contactPersonNumber: string;
    kmFromBranch: number | null;
    noOfMember: number;
    activeClients: number;
    osPrincipal: number;
    arrearMembers: number;
    arrearAmount: number;
    arrearMemOS: number;
    waitingBorrower: number;
    par: number;
}

interface Branch {
    id: string;
    name: string;
    code: string;
}

const fmt = (n: number) =>
    new Intl.NumberFormat('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

export default function CenterMasterReportPage() {
    const { toast } = useToast();
    const { canExportReport, getReportExportMode } = usePermission();
    const [reportDate, setReportDate] = useState(new Date().toISOString().split('T')[0]);
    // Submitted (applied) date snapshot — frozen until the next "Show" click. Export
    // filenames/subtitle/exportParams read this, not the live draft reportDate, so
    // editing the date input alone never changes what's shown for the fetched report.
    const [submittedReportDate, setSubmittedReportDate] = useState(reportDate);
    const [data, setData] = useState<CenterMasterRow[]>([]);
    const [hasFetched, setHasFetched] = useState(false);
    const [isLoading, setIsLoading] = useState(false);

    // Branch selection state
    const [selectedBranchId, setSelectedBranchId] = useState('');
    const [branches, setBranches] = useState<Branch[]>([]);
    const [isBranchesLoading, setIsBranchesLoading] = useState(false);
    const [userRole, setUserRole] = useState<UserRole | null>(null);
    const [userId, setUserId] = useState('');
    const [isBranchFixed, setIsBranchFixed] = useState(false);

    // Pagination
    const [currentPage, setCurrentPage] = useState(1);
    const PAGE_SIZE = 20;
    const totalPages = Math.max(1, Math.ceil(data.length / PAGE_SIZE));
    const pagedData = data.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

    useEffect(() => {
        const stored = tokenStorage.getUser();
        if (!stored) return;
        const role = stored.role as UserRole;
        setUserRole(role);
        setUserId(stored.id || '');

        if (role === 'BRANCH_MANAGER') {
            // BM: fixed to own branch
            const activeBranch = branchStorage.getActiveBranch();
            const branchId = activeBranch?.id || stored.branchId || '';
            setSelectedBranchId(branchId);
            if (branchId) {
                setBranches([{
                    id: branchId,
                    name: activeBranch?.name || 'My Branch',
                    code: activeBranch?.code || '',
                }]);
            }
            setIsBranchFixed(true);
        } else if (role === 'AREA_MANAGER') {
            loadAmBranches(stored.id || '');
        } else {
            // Admin / ADMIN_NON_HO_BRANCH_SWITCH
            loadAllBranches();
        }
    }, []);

    const loadAllBranches = async () => {
        setIsBranchesLoading(true);
        try {
            const res = await fetch('/api/branches');
            const result = await res.json();
            const list: Branch[] = (result.data ?? result ?? []);
            setBranches(list);
            // Pre-select active branch
            const active = branchStorage.getActiveBranch();
            if (active) {
                const found = list.find(b => b.id === active.id);
                if (found) setSelectedBranchId(found.id);
            }
        } catch {
            toast({ title: 'Error', description: 'Failed to load branches', variant: 'destructive' });
        } finally {
            setIsBranchesLoading(false);
        }
    };

    const loadAmBranches = async (uid: string) => {
        setIsBranchesLoading(true);
        try {
            const res = await fetch(`/api/area-manager-branches?userId=${uid}`);
            const result = await res.json();
            const list: Branch[] = (result.data ?? []).map((a: any) => a.branch).filter(Boolean);
            setBranches(list);
            if (list.length > 0) setSelectedBranchId(list[0].id);
        } catch {
            toast({ title: 'Error', description: 'Failed to load branches', variant: 'destructive' });
        } finally {
            setIsBranchesLoading(false);
        }
    };

    const fetchReport = async () => {
        if (!selectedBranchId) {
            toast({ title: 'Branch Required', description: 'Please select a branch first.', variant: 'destructive' });
            return;
        }
        setIsLoading(true);
        try {
            const params = new URLSearchParams({ date: reportDate, branchId: selectedBranchId });
            const res = await fetch(`/api/reports/portfolio/center-master?${params}`);
            if (!res.ok) throw new Error('Failed to fetch');
            const result = await res.json();
            setData(result.data ?? []);
            setCurrentPage(1);
            setHasFetched(true);
            setSubmittedReportDate(reportDate);
        } catch {
            toast({ title: 'Error', description: 'Failed to fetch center master report', variant: 'destructive' });
            setData([]);
        } finally {
            setIsLoading(false);
        }
    };

    const handleReset = () => {
        setData([]);
        setHasFetched(false);
        setCurrentPage(1);
        setReportDate(new Date().toISOString().split('T')[0]);
        if (!isBranchFixed) setSelectedBranchId('');
    };

    const handleExcelExport = () => {
        if (!data.length) return;
        const rows = data.map(r => ({
            'Branch ID': r.ourBranchID,
            'Centre ID': r.centreID,
            'Centre Name': r.centreName,
            'Visit Date': r.visitDate,
            'FDO Name': r.fdoName,
            'Meeting Day': r.meetingDay,
            'Meeting Time': r.meetingTime,
            'From Branch': r.fromBranch,
            'From DO': r.fromDO,
            'Contact Person': r.contactPerson,
            'Contact Number': r.contactPersonNumber,
            'Distance from Branch (KM)': r.kmFromBranch ?? '',
            'No. of Members': r.noOfMember,
            'Active Clients': r.activeClients,
            'OS Principal': r.osPrincipal,
            'Arrear Members': r.arrearMembers,
            'Arrear Amount': r.arrearAmount,
            'Arrear Mem OS': r.arrearMemOS,
            'Waiting Borrowers': r.waitingBorrower,
            'PAR (%)': r.par,
        }));
        const ws = buildReportSheet('Center Master Report', rows);
        autoSizeColumns(ws);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Center Master');
        normalizeWorkbookNumbers(wb);
        XLSX.writeFile(wb, `CenterMaster_${submittedReportDate}.xlsx`);
        toast({ title: 'Exported', description: `CenterMaster_${submittedReportDate}.xlsx downloaded` });
    };

    const handlePdfExport = async () => {
        if (!data.length) return;
        const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
        const reportFont = await ensureReportFont(doc);
        await drawCenterMasterSummaryReport(doc, data, { subtitle: `Date: ${submittedReportDate}` }, reportFont);
        doc.save(`CenterMaster_${submittedReportDate}.pdf`);
        toast({ title: 'PDF Downloaded', description: `CenterMaster_${submittedReportDate}.pdf` });
    };

    // Mirrors the same field mapping used by handleExcelExport above (kept separate so
    // handleExcelExport is left untouched).
    const buildCenterMasterExportRows = (): { headers: string[]; rows: (string | number)[][] } => {
        const headers = [
            'Branch ID', 'Centre ID', 'Centre Name', 'Visit Date', 'FDO Name', 'Meeting Day', 'Meeting Time',
            'From Branch', 'From DO', 'Contact Person', 'Contact Number', 'Distance from Branch (KM)',
            'No. of Members', 'Active Clients', 'OS Principal', 'Arrear Members', 'Arrear Amount',
            'Arrear Mem OS', 'Waiting Borrowers', 'PAR (%)',
        ];
        const rows: (string | number)[][] = data.map(r => [
            r.ourBranchID, r.centreID, r.centreName, r.visitDate, r.fdoName, r.meetingDay, r.meetingTime,
            r.fromBranch, r.fromDO, r.contactPerson, r.contactPersonNumber, r.kmFromBranch ?? '',
            r.noOfMember, r.activeClients, r.osPrincipal, r.arrearMembers, r.arrearAmount,
            r.arrearMemOS, r.waitingBorrower, r.par,
        ]);
        return { headers, rows };
    };

    const handleExportCSV = () => {
        if (!data.length) return;
        const { headers, rows } = buildCenterMasterExportRows();
        exportToCSV(`CenterMaster_${submittedReportDate}`, 'Center Master Report', headers, rows);
    };

    // Word-only presentation: same rows as Excel/CSV/PDF above. No totals row exists in
    // this report today — nothing to preserve/style distinctly. The 3 Arrear columns
    // share a genuine prefix and get a light 2-row grouped header; the other 17 columns
    // stay standalone.
    const wordOptions: WordExportOptions = {
        groupHeaders: [
            { label: 'Branch ID', span: 1 }, { label: 'Centre ID', span: 1 }, { label: 'Centre Name', span: 1 },
            { label: 'Visit Date', span: 1 }, { label: 'FDO Name', span: 1 }, { label: 'Meeting Day', span: 1 },
            { label: 'Meeting Time', span: 1 }, { label: 'From Branch', span: 1 }, { label: 'From DO', span: 1 },
            { label: 'Contact Person', span: 1 }, { label: 'Contact Number', span: 1 },
            { label: 'Distance from Branch (KM)', span: 1 }, { label: 'No. of Members', span: 1 },
            { label: 'Active Clients', span: 1 }, { label: 'OS Principal', span: 1 }, { label: 'ARREAR', span: 3 },
            { label: 'Waiting Borrowers', span: 1 }, { label: 'PAR (%)', span: 1 },
        ],
        subHeaders: ['Members', 'Amount', 'Mem OS'],
        columnAlignments: ['center', 'center', 'left', 'center', 'left', 'center', 'center', 'left', 'left', 'left', 'center', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right'],
        columnWidthWeights: [6, 6, 12, 8, 10, 8, 8, 10, 8, 10, 8, 8, 7, 7, 8, 7, 7, 8, 8, 7],
    };

    const handleExportWord = async () => {
        if (!data.length) return;
        const { headers, rows } = buildCenterMasterExportRows();
        await exportToWord(`CenterMaster_${submittedReportDate}`, 'Center Master Report', headers, rows, wordOptions);
    };

    return (
        <ProtectedRoute>
            <div className="min-h-screen bg-gradient-to-br from-background via-emerald-50/40 to-teal-50/40 dark:from-background dark:via-brand-green-darker dark:to-green-950">
                <div className="container mx-auto px-4 py-8">
                    {/* Header */}
                    <div className="mb-8 flex items-center gap-4">
                        <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-600 shadow-lg shadow-emerald-500/30">
                            <MapPin className="h-7 w-7 text-white" />
                        </div>
                        <div>
                            <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-foreground dark:text-white">
                                Center Master Report
                            </h1>
                            <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                                Branch-wise center portfolio, arrear, and PAR analytics
                            </p>
                        </div>
                    </div>

                    {/* Filter Card */}
                    <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden mb-6">
                        <div className="h-1.5 bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-600" />
                        <CardHeader className="bg-gradient-to-r from-slate-50 via-emerald-50/60 to-teal-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker pb-4">
                            <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
                                    <Filter className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                                </div>
                                <h3 className="text-lg font-semibold text-sidebar-accent dark:text-slate-200">Report Filters</h3>
                            </div>
                        </CardHeader>
                        <CardContent className="pt-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                                {/* Branch Selection */}
                                <div className="space-y-2">
                                    <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Branch <span className="text-red-500">*</span>
                                    </Label>
                                    {isBranchFixed ? (
                                        <Input
                                            value={branches[0]?.name ?? 'My Branch'}
                                            readOnly
                                            className="h-11 bg-brand-green-tint dark:bg-sidebar-accent border-primary/30 dark:border-sidebar-accent text-sidebar-accent dark:text-slate-300"
                                        />
                                    ) : (
                                        <Select
                                            value={selectedBranchId}
                                            onValueChange={setSelectedBranchId}
                                            disabled={isBranchesLoading}
                                        >
                                            <SelectTrigger className="h-11 border-primary/30 dark:border-sidebar-accent bg-white dark:bg-brand-green-darker text-sidebar-accent dark:text-slate-300">
                                                <SelectValue placeholder={isBranchesLoading ? 'Loading...' : '-- SELECT BRANCH --'} />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {branches.map(b => (
                                                    <SelectItem key={b.id} value={b.id}>
                                                        {b.code} - {b.name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    )}
                                </div>

                                {/* Report Date */}
                                <div className="space-y-2">
                                    <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Report Date
                                    </Label>
                                    <DateInput
                                        value={reportDate}
                                        onChange={e => setReportDate(e.target.value)}
                                        className="h-11 border-primary/30 dark:border-sidebar-accent text-sidebar-accent dark:text-slate-200 bg-white dark:bg-brand-green-darker"
                                    />
                                </div>

                                {/* Actions */}
                                <div className="lg:col-span-2 space-y-2">
                                    <Label className="text-sm font-semibold opacity-0">Actions</Label>
                                    <div className="flex gap-2">
                                        <Button
                                            onClick={fetchReport}
                                            disabled={isLoading}
                                            className="h-11 flex-1 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white shadow-lg font-semibold"
                                        >
                                            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                                            Show
                                        </Button>
                                        <Button
                                            variant="outline"
                                            onClick={handleReset}
                                            disabled={isLoading}
                                            className="h-11 flex-1 border-primary/30 text-sidebar-accent hover:bg-brand-green-tint dark:border-sidebar-accent/60 dark:text-slate-300 dark:hover:bg-sidebar-accent font-medium"
                                        >
                                            <RefreshCw className="mr-2 h-4 w-4 text-slate-500" />
                                            Reset
                                        </Button>
                                        <ExportDropdown
                                            onExportPDF={data.length > 0 ? handlePdfExport : undefined}
                                            onExportExcel={data.length > 0 ? handleExcelExport : undefined}
                                            onExportCSV={data.length > 0 ? handleExportCSV : undefined}
                                            onExportWord={data.length > 0 ? handleExportWord : undefined}
                                            // Queue mode needs exactly one resolved branch (see fetchCenterMasterSummary
                                            // in report-registry.ts) — only offer it once a specific branch is selected.
                                            reportSlug={data.length > 0 && selectedBranchId && getReportExportMode('center-master-summary') === 'REQUEST_QUEUE' ? 'center-master-summary' : undefined}
                                            canExport={canExportReport('center-master-summary')}
                                            exportParams={{
                                                fromDate: submittedReportDate,
                                                branchIds: selectedBranchId ? [selectedBranchId] : 'ALL',
                                            }}
                                            className="h-11 flex-1 border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700/50 dark:text-emerald-400 dark:hover:bg-emerald-950/30 font-medium"
                                        />
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Data Display */}
                    {!hasFetched && !isLoading ? (
                        <Card className="border-2 border-primary/20 border-dashed bg-green-50/50 p-12 text-center dark:border-sidebar-accent dark:bg-brand-green-darker/20 shadow-sm rounded-xl">
                            <FileText className="mx-auto h-16 w-16 text-slate-400 opacity-50 mb-4" />
                            <h3 className="text-xl font-semibold text-sidebar-accent dark:text-slate-300">No Data Displayed</h3>
                            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                                Select a branch and click "Show" to generate the Center Master Report.
                            </p>
                        </Card>
                    ) : (
                        <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden rounded-xl">
                            <CardContent className="p-0">
                                <div className="overflow-x-auto scrollbar-thin scrollbar-track-slate-100 scrollbar-thumb-slate-300 dark:scrollbar-track-brand-green-darker dark:scrollbar-thumb-sidebar-accent">
                                    <Table className="min-w-[2200px]">
                                        <TableHeader className="bg-gradient-to-r from-emerald-700 via-teal-700 to-emerald-700">
                                            <TableRow className="hover:bg-transparent border-none">
                                                {[
                                                    'Branch ID', 'Centre ID', 'Centre Name', 'Visit Date', 'FDO Name',
                                                    'Mtg Day', 'Mtg Time', 'From Branch', 'From DO',
                                                    'Contact Person', 'Contact No.', 'Distance (KM)',
                                                    'Members', 'Active', 'OS Principal', 'Arr Mem', 'Arr Amount',
                                                    'Arr Mem OS', 'Waiting', 'PAR %',
                                                ].map(h => (
                                                    <TableHead key={h} className="h-12 px-3 text-white font-semibold text-xs whitespace-nowrap">
                                                        {h}
                                                    </TableHead>
                                                ))}
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody className="bg-white dark:bg-green-950/30">
                                            {isLoading ? (
                                                <TableRow>
                                                    <TableCell colSpan={20} className="h-64">
                                                        <PageLoader label="Loading center master data…" fullScreen={false} />
                                                    </TableCell>
                                                </TableRow>
                                            ) : pagedData.length === 0 ? (
                                                <TableRow>
                                                    <TableCell colSpan={20} className="h-64 text-center text-slate-500">
                                                        No centers found for the selected filters.
                                                    </TableCell>
                                                </TableRow>
                                            ) : (
                                                pagedData.map((row, i) => (
                                                    <TableRow
                                                        key={i}
                                                        className={cn(
                                                            'transition-all border-b border-slate-100 dark:border-sidebar-accent/50',
                                                            i % 2 === 0 ? 'bg-white dark:bg-brand-green-darker' : 'bg-green-50/50 dark:bg-sidebar-accent/30',
                                                            row.arrearAmount > 0 ? 'hover:bg-rose-50/50' : 'hover:bg-emerald-50/30'
                                                        )}
                                                    >
                                                        <TableCell className="px-3 py-2 text-xs font-semibold text-sidebar-accent">{row.ourBranchID}</TableCell>
                                                        <TableCell className="px-3 py-2 text-xs text-sidebar-accent">{row.centreID}</TableCell>
                                                        <TableCell className="px-3 py-2 text-xs font-medium text-sidebar-accent whitespace-nowrap">{row.centreName}</TableCell>
                                                        <TableCell className="px-3 py-2 text-xs text-slate-500">{row.visitDate}</TableCell>
                                                        <TableCell className="px-3 py-2 text-xs text-sidebar-accent whitespace-nowrap">{row.fdoName}</TableCell>
                                                        <TableCell className="px-3 py-2 text-xs text-sidebar-accent">{row.meetingDay}</TableCell>
                                                        <TableCell className="px-3 py-2 text-xs text-slate-500">{row.meetingTime}</TableCell>
                                                        <TableCell className="px-3 py-2 text-xs text-sidebar-accent whitespace-nowrap">{row.fromBranch}</TableCell>
                                                        <TableCell className="px-3 py-2 text-xs text-sidebar-accent whitespace-nowrap">{row.fromDO}</TableCell>
                                                        <TableCell className="px-3 py-2 text-xs text-sidebar-accent whitespace-nowrap">{row.contactPerson || '-'}</TableCell>
                                                        <TableCell className="px-3 py-2 text-xs text-sidebar-accent">{row.contactPersonNumber || '-'}</TableCell>
                                                        <TableCell className="px-3 py-2 text-xs text-center text-sidebar-accent">{row.kmFromBranch ?? '-'}</TableCell>
                                                        <TableCell className="px-3 py-2 text-xs text-center font-semibold text-sidebar-accent">{row.noOfMember}</TableCell>
                                                        <TableCell className="px-3 py-2 text-xs text-center font-semibold text-emerald-700">{row.activeClients}</TableCell>
                                                        <TableCell className="px-3 py-2 text-xs text-right font-bold text-foreground">{fmt(row.osPrincipal)}</TableCell>
                                                        <TableCell className={cn('px-3 py-2 text-xs text-center font-semibold', row.arrearMembers > 0 ? 'text-rose-600' : 'text-slate-400')}>{row.arrearMembers}</TableCell>
                                                        <TableCell className={cn('px-3 py-2 text-xs text-right font-bold', row.arrearAmount > 0 ? 'text-rose-600' : 'text-slate-400')}>{fmt(row.arrearAmount)}</TableCell>
                                                        <TableCell className={cn('px-3 py-2 text-xs text-right font-semibold', row.arrearMemOS > 0 ? 'text-rose-500' : 'text-slate-400')}>{fmt(row.arrearMemOS)}</TableCell>
                                                        <TableCell className="px-3 py-2 text-xs text-center text-amber-700 font-semibold">{row.waitingBorrower}</TableCell>
                                                        <TableCell className={cn('px-3 py-2 text-xs text-right font-bold', row.par > 5 ? 'text-rose-600' : row.par > 0 ? 'text-amber-600' : 'text-emerald-600')}>
                                                            {row.par.toFixed(2)}%
                                                        </TableCell>
                                                    </TableRow>
                                                ))
                                            )}
                                        </TableBody>
                                    </Table>
                                </div>

                                {/* Pagination */}
                                {data.length > 0 && (
                                    <div className="border-t border-primary/20 dark:border-sidebar-accent bg-green-50/80 dark:bg-brand-green-darker/40 px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-4">
                                        <div className="text-sm text-sidebar-accent dark:text-slate-400">
                                            Showing <span className="font-bold text-foreground">{pagedData.length}</span> of <span className="font-bold text-foreground">{data.length}</span> centers
                                        </div>
                                        <div className="flex items-center gap-1 bg-white dark:bg-sidebar-accent p-1 rounded-xl border border-primary/20 dark:border-sidebar-accent shadow-sm">
                                            <Button
                                                variant="ghost" size="sm"
                                                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                                disabled={currentPage === 1}
                                                className="h-8 px-2"
                                            >
                                                <ChevronLeft className="h-4 w-4" />
                                            </Button>
                                            <span className="px-3 text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                                                {currentPage} / {totalPages}
                                            </span>
                                            <Button
                                                variant="ghost" size="sm"
                                                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                                disabled={currentPage === totalPages}
                                                className="h-8 px-2"
                                            >
                                                <ChevronRight className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    )}
                </div>
            </div>
        </ProtectedRoute>
    );
}
