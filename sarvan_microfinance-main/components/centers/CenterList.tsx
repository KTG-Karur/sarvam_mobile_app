'use client';

import { useState, useEffect } from 'react';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Trash2, Edit, Loader2, RefreshCw, Eye, Search, CheckCircle2, XCircle, ThumbsUp, ThumbsDown, RotateCcw } from 'lucide-react';
import { PageLoader } from '@/components/ui/page-loader';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { branchStorage } from '@/app/lib/branch-storage';
import { tokenStorage } from '@/app/lib/token-storage';
import { usePermission } from '@/app/hooks/usePermission';
import { computeNextMeetingDateYmd, formatYmdToDmy, toIstYmd } from '@/app/lib/collections/next-meeting-date';
import * as XLSX from 'xlsx-js-style';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { buildReportSheet, autoSizeColumns, applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { drawPdfReportHeader } from '@/app/lib/reports/pdf-report-header';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { ExportMenuButton } from '@/components/daily-monitoring/ExportMenuButton';
import { toDisplayDate } from '@/app/lib/date-format';

interface Center {
    id: string;
    name: string;
    code: string;
    address?: string | null;
    localArea?: string | null;
    fdoId?: string;
    fdoName?: string;
    formationDate?: string;
    meetingDay?: string;
    meetingTime?: string;
    meetingPlace?: string;
    latitude?: string;
    longitude?: string;
    kmFromBranch?: number | null;
    contactPerson?: string | null;
    contactNumber?: string | null;
    status: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';
    rejectionReason?: string | null;
    approvedById?: string | null;
    approvedAt?: string | null;
    approvedBy?: {
        id: string;
        firstName: string;
        lastName: string;
        email: string;
    } | null;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}

// Extra fields the paginated /centers response already carries (see app/api/centers/route.ts
// `select` + mapWithFdo) that the table doesn't render but the export does.
type ExportCenter = Center & {
    branch?: { name: string; code: string } | null;
    centerLeader?: { firstName: string; lastName: string; clientId: string } | null;
    nextMeetingDate?: string | null;
    clientCount?: number;
};

const EXPORT_PAGE_SIZE = 50; // /centers caps pageSize at 50

const fmtExportDate = (value?: string | null): string =>
    value ? formatYmdToDmy(toIstYmd(new Date(value))) : '';

// One row per center, with every field on the Edit Center form (plus status/audit columns).
const EXPORT_COLUMNS: Array<{ header: string; value: (c: ExportCenter) => string | number }> = [
    { header: 'Branch', value: (c) => (c.branch ? `${c.branch.code} - ${c.branch.name}` : '') },
    { header: 'Center ID', value: (c) => c.code },
    { header: 'Center Name', value: (c) => c.name },
    { header: 'Address', value: (c) => c.address ?? '' },
    { header: 'Local Area', value: (c) => c.localArea ?? '' },
    { header: 'FDO', value: (c) => c.fdoName ?? '' },
    { header: 'Formation Date', value: (c) => fmtExportDate(c.formationDate) },
    { header: 'Meeting Day', value: (c) => c.meetingDay ?? '' },
    { header: 'Meeting Time', value: (c) => c.meetingTime ?? '' },
    { header: 'Meeting Place', value: (c) => c.meetingPlace ?? '' },
    { header: 'Next Meeting', value: (c) => fmtExportDate(c.nextMeetingDate) },
    { header: 'Latitude', value: (c) => c.latitude ?? '' },
    { header: 'Longitude', value: (c) => c.longitude ?? '' },
    { header: 'KM from Branch', value: (c) => (c.kmFromBranch != null ? Number(c.kmFromBranch) : '') },
    { header: 'Contact Person', value: (c) => c.contactPerson ?? '' },
    { header: 'Contact Number', value: (c) => c.contactNumber ?? '' },
    { header: 'Center Leader', value: (c) => (c.centerLeader ? `${c.centerLeader.firstName} ${c.centerLeader.lastName}`.trim() + ` (${c.centerLeader.clientId})` : '') },
    { header: 'Active Members', value: (c) => c.clientCount ?? '' },
    { header: 'Status', value: (c) => statusLabels[c.status] ?? c.status },
    { header: 'Active', value: (c) => (c.isActive ? 'Yes' : 'No') },
    { header: 'Approved By', value: (c) => (c.approvedBy ? `${c.approvedBy.firstName} ${c.approvedBy.lastName}`.trim() : '') },
    { header: 'Approved On', value: (c) => fmtExportDate(c.approvedAt) },
    { header: 'Rejection Reason', value: (c) => c.rejectionReason ?? '' },
    { header: 'Created On', value: (c) => fmtExportDate(c.createdAt) },
];

interface CenterListProps {
    refreshRef?: React.MutableRefObject<(() => void) | null>;
    onEdit?: (center: Center) => void;
    onCreateNew?: () => void;
}

const statusLabels: Record<Center['status'], string> = {
    PENDING_APPROVAL: 'Pending Approval',
    APPROVED: 'Approved',
    REJECTED: 'Rejected',
};

const statusColors: Record<Center['status'], string> = {
    PENDING_APPROVAL: 'bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-300 dark:border-yellow-700',
    APPROVED: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-700',
    REJECTED: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700',
};

export function CenterList({ refreshRef, onEdit, onCreateNew }: CenterListProps) {
    const { toast } = useToast();
    const [mounted, setMounted] = useState(false);
    const [centers, setCenters] = useState<Center[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [deleteId, setDeleteId] = useState<string | null>(null);
    const [previewCenter, setPreviewCenter] = useState<Center | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [reactivatingId, setReactivatingId] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [branchFilter, setBranchFilter] = useState<string>('all');
    const [centerFilter, setCenterFilter] = useState<string>('all');
    const [branches, setBranches] = useState<Array<{ id: string; name: string; code: string }>>([]);
    const [isLoadingBranches, setIsLoadingBranches] = useState(false);

    // Server-side pagination
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [totalCount, setTotalCount] = useState(0);

    // Independent, unpaginated list powering the "Filter by center" dropdown —
    // always reflects every center in the current branch scope, regardless of
    // search/status/pagination on the main table.
    const [pickerCenters, setPickerCenters] = useState<Array<{ id: string; name: string; code: string }>>([]);

    // Approval/Rejection state
    const [approvalCenter, setApprovalCenter] = useState<Center | null>(null);
    const [approvalAction, setApprovalAction] = useState<'APPROVE' | 'REJECT' | null>(null);
    const [comments, setComments] = useState('');
    const [rejectionReason, setRejectionReason] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);

    // ── RBAC permission checks ────────────────────────────────────────────────
    const { canPage } = usePermission();
    const canEditCenter    = canPage('/dashboard/centers/create-center', 'edit');
    const canDeleteCenter  = canPage('/dashboard/centers/create-center', 'delete');
    const canApproveCenter = canPage('/dashboard/centers/create-center', 'approve');
    const canRejectCenter  = canPage('/dashboard/centers/create-center', 'approve');

    // ── Role-level guard: management actions are BM and above only ────────────
    const currentUserRole = tokenStorage.getUser()?.role;
    const isBMOrAbove = currentUserRole === 'BRANCH_MANAGER'
        || currentUserRole === 'AREA_MANAGER'
        || currentUserRole === 'DIVISION_MANAGER'
        || currentUserRole === 'ADMIN'
        || currentUserRole === 'ADMIN_NON_HO_BRANCH_SWITCH';

    // Roles that can see centers across more than one branch — only these get a branch filter
    const isMultiBranchRole = currentUserRole === 'ADMIN'
        || currentUserRole === 'ADMIN_NON_HO_BRANCH_SWITCH'
        || currentUserRole === 'AREA_MANAGER'
        || currentUserRole === 'DIVISION_MANAGER';

    useEffect(() => {
        setMounted(true);
    }, []);

    useEffect(() => {
        const t = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 300);
        return () => clearTimeout(t);
    }, [searchQuery]);

    // Shared branch-scope resolution — used by both the main paginated fetch and
    // the unpaginated dropdown-picker fetch so they always agree on scope.
    const resolveBranchId = (): { branchId?: string; ok: boolean } => {
        if (isMultiBranchRole) {
            // Multi-branch roles: use the picked filter, or leave unset to let the
            // API return centers across every branch the caller is scoped to.
            return { branchId: branchFilter !== 'all' ? branchFilter : undefined, ok: true };
        }
        // Single-branch roles: always scoped to the active/assigned branch.
        const activeBranch = branchStorage.getActiveBranch();
        const storedUser = tokenStorage.getUser();
        const branchId = activeBranch?.id || storedUser?.branchId || undefined;
        if (!branchId) {
            toast({
                title: 'Error',
                description: 'No branch found. Please select a branch first.',
                variant: 'destructive',
            });
            return { ok: false };
        }
        return { branchId, ok: true };
    };

    const fetchCenters = async (pageArg: number = 1) => {
        setIsLoading(true);
        try {
            const { branchId, ok } = resolveBranchId();
            if (!ok) {
                setIsLoading(false);
                return;
            }

            const query = new URLSearchParams({
                includeInactive: 'true',
                page: String(pageArg),
                pageSize: '10',
            });
            if (branchId) query.set('branchId', branchId);
            if (statusFilter !== 'all') query.set('status', statusFilter);
            if (centerFilter !== 'all') query.set('centerId', centerFilter);
            if (debouncedSearch) query.set('search', debouncedSearch);

            const result = await apiClient.get<{
                centers: Center[];
                totalCount: number;
                totalPages: number;
                page: number;
                pageSize: number;
            }>(`/centers?${query.toString()}`);
            if (result.success && result.data) {
                setCenters(result.data.centers);
                setTotalCount(result.data.totalCount);
                setTotalPages(result.data.totalPages || 1);
                setPage(result.data.page ?? pageArg);
            } else {
                toast({
                    title: 'Warning',
                    description: result.error || 'Failed to load centers. Please try again.',
                    variant: 'destructive',
                });
                setCenters([]);
                setTotalCount(0);
                setTotalPages(1);
            }
        } catch (error) {
            console.error('Error fetching centers:', error);
            toast({
                title: 'Error',
                description: 'Failed to load centers. Please try again.',
                variant: 'destructive',
            });
            setCenters([]);
            setTotalCount(0);
            setTotalPages(1);
        } finally {
            setIsLoading(false);
        }
    };

    // ── Export (PDF / Excel) ─────────────────────────────────────────────────
    // Exports EVERY center matching the current branch/center/status/search filters,
    // not just the visible page — walks the same paginated endpoint 50 rows at a time.
    const [isExporting, setIsExporting] = useState(false);

    const fetchAllCentersForExport = async (): Promise<ExportCenter[] | null> => {
        const { branchId, ok } = resolveBranchId();
        if (!ok) return null;
        const all: ExportCenter[] = [];
        let pageNo = 1;
        let pages = 1;
        do {
            const query = new URLSearchParams({
                includeInactive: 'true',
                page: String(pageNo),
                pageSize: String(EXPORT_PAGE_SIZE),
            });
            if (branchId) query.set('branchId', branchId);
            if (statusFilter !== 'all') query.set('status', statusFilter);
            if (centerFilter !== 'all') query.set('centerId', centerFilter);
            if (debouncedSearch) query.set('search', debouncedSearch);
            const result = await apiClient.get<{ centers: ExportCenter[]; totalPages: number }>(`/centers?${query.toString()}`);
            if (!result.success || !result.data) {
                toast({ title: 'Export Error', description: result.error || 'Failed to load centers for export.', variant: 'destructive' });
                return null;
            }
            all.push(...result.data.centers);
            pages = result.data.totalPages || 1;
            pageNo += 1;
        } while (pageNo <= pages);
        // Same order as the Center ID column users recognise, not newest-first.
        return all.sort((a, b) => (a.branch?.code ?? '').localeCompare(b.branch?.code ?? '') || a.code.localeCompare(b.code, undefined, { numeric: true }));
    };

    const exportFileStem = () => `Center_Details_${toIstYmd(new Date())}`;

    const handleExportExcel = async () => {
        setIsExporting(true);
        try {
            const rows = await fetchAllCentersForExport();
            if (!rows) return;
            if (rows.length === 0) {
                toast({ title: 'Nothing to export', description: 'No centers match the current filters.' });
                return;
            }
            const excelRows = rows.map((c, i) => {
                const row: Record<string, string | number> = { 'S.No': i + 1 };
                for (const col of EXPORT_COLUMNS) row[col.header] = col.value(c);
                return row;
            });
            const ws = buildReportSheet('Center Details', excelRows);
            autoSizeColumns(ws);
            applyExcelReportFont(ws);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Centers');
            XLSX.writeFile(wb, `${exportFileStem()}.xlsx`);
            toast({ title: 'Export Successful', description: `${rows.length} center(s) exported to Excel.` });
        } catch (error) {
            console.error('Error exporting centers to Excel:', error);
            toast({ title: 'Export Error', description: 'Failed to generate the Excel file.', variant: 'destructive' });
        } finally {
            setIsExporting(false);
        }
    };

    const handleExportPdf = async () => {
        setIsExporting(true);
        try {
            const rows = await fetchAllCentersForExport();
            if (!rows) return;
            if (rows.length === 0) {
                toast({ title: 'Nothing to export', description: 'No centers match the current filters.' });
                return;
            }
            // A3 landscape — 24 detail columns don't fit legibly on A4.
            const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
            const reportFont = await ensureReportFont(doc);
            const headerY = await drawPdfReportHeader(doc, 'Center Details', {
                subtitle: `Total Centers: ${rows.length}`,
                fontFamily: reportFont,
            });
            autoTable(doc, {
                startY: headerY,
                head: [['S.No', ...EXPORT_COLUMNS.map((col) => col.header)]],
                body: rows.map((c, i) => [i + 1, ...EXPORT_COLUMNS.map((col) => String(col.value(c)))]),
                theme: 'grid',
                styles: { font: reportFont, fontSize: 6.5, cellPadding: 1, lineColor: [0, 0, 0], lineWidth: 0.1, textColor: [0, 0, 0], overflow: 'linebreak' },
                headStyles: { font: reportFont, fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold', halign: 'center' },
            });
            doc.save(`${exportFileStem()}.pdf`);
            toast({ title: 'Export Successful', description: `${rows.length} center(s) exported to PDF.` });
        } catch (error) {
            console.error('Error exporting centers to PDF:', error);
            toast({ title: 'Export Error', description: 'Failed to generate the PDF file.', variant: 'destructive' });
        } finally {
            setIsExporting(false);
        }
    };

    const fetchPickerCenters = async () => {
        const { branchId, ok } = resolveBranchId();
        if (!ok) return;
        try {
            const query = new URLSearchParams({ includeInactive: 'true', minimal: 'true' });
            if (branchId) query.set('branchId', branchId);
            const result = await apiClient.get<Array<{ id: string; name: string; code: string }>>(`/centers?${query.toString()}`);
            if (result.success && result.data) {
                setPickerCenters(result.data);
            }
        } catch (error) {
            console.error('Error fetching center picker options:', error);
        }
    };

    // Refetch page 1 whenever branch/status/center/search filters change.
    useEffect(() => {
        fetchCenters(1);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [branchFilter, statusFilter, centerFilter, debouncedSearch]);

    // The center-picker dropdown only needs to refresh when the branch scope changes.
    useEffect(() => {
        fetchPickerCenters();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [branchFilter]);

    // Reset the center filter whenever the branch filter changes, since the
    // previously selected center may no longer be in the fetched list.
    useEffect(() => {
        setCenterFilter('all');
    }, [branchFilter]);

    // Fetch branches for the filter dropdown (multi-branch roles only) —
    // AREA_MANAGER's list is scoped to their assigned branches.
    useEffect(() => {
        if (!isMultiBranchRole) return;
        const fetchBranches = async () => {
            setIsLoadingBranches(true);
            try {
                const result = await apiClient.get<Array<{ id: string; name: string; code: string }>>('/branches');
                if (result.success && result.data) {
                    let list = result.data;
                    if (currentUserRole === 'AREA_MANAGER') {
                        const storedUser = tokenStorage.getUser();
                        const assignedBranchIds = (storedUser as any)?.assignedBranchIds ?? [];
                        if (assignedBranchIds.length > 0) {
                            list = list.filter((b) => assignedBranchIds.includes(b.id));
                        }
                    }
                    setBranches(list);
                }
            } catch (error) {
                console.error('Error fetching branches:', error);
            } finally {
                setIsLoadingBranches(false);
            }
        };
        fetchBranches();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentUserRole]);

    const handlePageChange = (p: number) => {
        fetchCenters(p);
    };

    // Expose refresh function via ref (kept fresh so it always uses the current filters/page)
    useEffect(() => {
        if (refreshRef) {
            refreshRef.current = () => fetchCenters(page);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [refreshRef, branchFilter, statusFilter, centerFilter, debouncedSearch, page]);

    const handleReactivate = async (center: Center) => {
        setReactivatingId(center.id);
        try {
            const result = await apiClient.patch(`/centers/${center.id}`, { isActive: true });
            if (result.success) {
                toast({ title: 'Success', description: `Center ${center.code}-${center.name} reactivated` });
                fetchCenters(page);
            } else {
                toast({ title: 'Error', description: result.error || 'Failed to reactivate center', variant: 'destructive' });
            }
        } catch (error) {
            console.error('Error reactivating center:', error);
            toast({ title: 'Error', description: 'Network error. Please try again.', variant: 'destructive' });
        } finally {
            setReactivatingId(null);
        }
    };

    const handleDelete = async () => {
        if (!deleteId) return;

        setIsDeleting(true);
        try {
            const result = await apiClient.delete(`/centers/${deleteId}`);
            if (result.success) {
                toast({
                    title: 'Success',
                    description: 'Center deleted successfully',
                });
                fetchCenters(page);
                setDeleteId(null);
            } else {
                // Check if endpoint doesn't exist (404)
                if (result.error?.includes('not found') || result.error?.includes('Endpoint not found')) {
                    toast({
                        title: 'API Not Available',
                        description: 'Delete API endpoint is not yet implemented. This is a demo action.',
                        variant: 'default',
                    });
                    // Remove from local state for demo
                    setCenters((prev) => prev.filter((c) => c.id !== deleteId));
                    setDeleteId(null);
                    return;
                }

                toast({
                    title: 'Error',
                    description: result.error || 'Failed to delete center',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            console.error('Error deleting center:', error);
            toast({
                title: 'Error',
                description: 'Network error. Please try again.',
                variant: 'destructive',
            });
        } finally {
            setIsDeleting(false);
        }
    };

    const handleApproveReject = async () => {
        if (!approvalCenter || !approvalAction) return;

        // Validate rejection reason
        if (approvalAction === 'REJECT' && !rejectionReason.trim()) {
            toast({
                title: 'Validation Error',
                description: 'Rejection reason is required',
                variant: 'destructive',
            });
            return;
        }

        setIsProcessing(true);
        try {
            const response = await fetch(`/api/centers/${approvalCenter.id}/approve`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    action: approvalAction,
                    comments: comments.trim() || null,
                    rejectionReason: approvalAction === 'REJECT' ? rejectionReason.trim() : null,
                }),
            });

            const data = await response.json();

            if (data.success) {
                toast({
                    title: 'Success',
                    description: data.message,
                });

                // Refresh centers list
                await fetchCenters(page);

                // Close dialog and reset state
                setApprovalCenter(null);
                setApprovalAction(null);
                setComments('');
                setRejectionReason('');
            } else {
                toast({
                    title: 'Error',
                    description: data.error || 'Failed to process center',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            console.error('Error processing center:', error);
            toast({
                title: 'Error',
                description: 'Failed to process center',
                variant: 'destructive',
            });
        } finally {
            setIsProcessing(false);
        }
    };

    const openApprovalDialog = (center: Center, action: 'APPROVE' | 'REJECT') => {
        setApprovalCenter(center);
        setApprovalAction(action);
    };

    return (
        <>
            <Card className="border-none shadow-xl bg-white/80 backdrop-blur-md dark:bg-green-950/50 overflow-hidden mt-8">
                <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-purple-500/5 to-pink-500/5 pointer-events-none" />
                <CardContent className="p-0">
                    {/* Header with Filters */}
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 border-b border-primary/20 dark:border-sidebar-accent">
                        <h3 className="text-lg font-semibold text-foreground dark:text-white">
                            Centers List
                        </h3>
                        <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
                            {/* Search */}
                            <div className="relative flex-1 sm:flex-initial min-w-[200px]">
                                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                <Input
                                    placeholder="Search centers..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="pl-9 h-9 text-sm"
                                />
                            </div>

                            {/* Branch Filter — only for roles with access to more than one branch.
                                Gated on `mounted`: isMultiBranchRole reads tokenStorage
                                (localStorage), which is unavailable during SSR — rendering this
                                conditionally on it directly made the server always omit the
                                filter while the client's first paint (before any effect runs)
                                already saw the real role, shifting every Select after it and
                                causing a hydration mismatch. */}
                            {mounted && isMultiBranchRole && (
                                <Select
                                    value={branchFilter}
                                    onValueChange={setBranchFilter}
                                    disabled={isLoadingBranches}
                                >
                                    <SelectTrigger className="h-9 w-[170px] text-sm">
                                        <SelectValue placeholder={isLoadingBranches ? 'Loading branches...' : 'Filter by branch'} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Branches</SelectItem>
                                        {branches.map((branch) => (
                                            <SelectItem key={branch.id} value={branch.id}>
                                                {branch.name} ({branch.code})
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}

                            {/* Center Filter */}
                            <Select value={centerFilter} onValueChange={setCenterFilter}>
                                <SelectTrigger className="h-9 w-[170px] text-sm">
                                    <SelectValue placeholder="Filter by center" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Centers</SelectItem>
                                    {pickerCenters.map((center) => (
                                        <SelectItem key={center.id} value={center.id}>
                                            {center.code}-{center.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>

                            {/* Status Filter */}
                            <Select value={statusFilter} onValueChange={setStatusFilter}>
                                <SelectTrigger className="h-9 w-[150px] text-sm">
                                    <SelectValue placeholder="Filter by status" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Status</SelectItem>
                                    <SelectItem value="PENDING_APPROVAL">Pending</SelectItem>
                                    <SelectItem value="APPROVED">Approved</SelectItem>
                                    <SelectItem value="REJECTED">Rejected</SelectItem>
                                </SelectContent>
                            </Select>

                            {/* Action Buttons */}
                            <div className="flex items-center gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => fetchCenters(page)}
                                    disabled={isLoading}
                                    className="h-9"
                                >
                                    <RefreshCw
                                        className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`}
                                    />
                                    Refresh
                                </Button>
                                <ExportMenuButton
                                    onExportExcel={handleExportExcel}
                                    onExportPdf={handleExportPdf}
                                    disabled={isLoading || isExporting || totalCount === 0}
                                    label={isExporting ? 'Exporting…' : 'Export'}
                                    className="h-9 bg-emerald-600 text-white hover:bg-emerald-700"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Table */}
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-gradient-to-r from-primary to-primary hover:from-primary hover:to-primary border-none">
                                    <TableHead className="text-white font-semibold h-12 pl-6">
                                        Center
                                    </TableHead>
                                    <TableHead className="text-white font-semibold h-12">Address</TableHead>
                                    <TableHead className="text-white font-semibold h-12">FDO</TableHead>
                                    <TableHead className="text-white font-semibold h-12">Meeting</TableHead>
                                    <TableHead className="text-white font-semibold h-12">KM</TableHead>
                                    <TableHead className="text-white font-semibold h-12">Contact Person</TableHead>
                                    <TableHead className="text-white font-semibold h-12">Contact No.</TableHead>
                                    <TableHead className="text-white font-semibold h-12">Status</TableHead>
                                    <TableHead className="text-white font-semibold h-12 text-right pr-6">
                                        Actions
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {isLoading ? (
                                    <TableRow>
                                        <TableCell colSpan={9} className="text-center py-8">
                                            <PageLoader label="Loading centers..." fullScreen={false} />
                                        </TableCell>
                                    </TableRow>
                                ) : centers.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={9} className="text-center py-8">
                                            <p className="text-sm text-sidebar-accent dark:text-slate-400">
                                                {searchQuery || statusFilter !== 'all' || branchFilter !== 'all' || centerFilter !== 'all'
                                                    ? 'No centers found matching your filters.'
                                                    : 'No centers found. Create your first center above.'}
                                            </p>
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    centers.map((center, index) => (
                                        <TableRow
                                            key={center.id}
                                            className={`
                                                border-b border-gray-100 dark:border-gray-800 transition-colors hover:bg-green-50/50 dark:hover:bg-brand-green-darker/10
                                                ${index % 2 === 0 ? 'bg-white/50' : 'bg-gray-50/30'}
                                            `}
                                        >
                                            <TableCell className="font-medium text-gray-700 dark:text-gray-300 pl-6">
                                                <span className="font-mono text-sm">{center.code}-{center.name}</span>
                                            </TableCell>
                                            <TableCell className="text-gray-600 dark:text-gray-400 max-w-xs truncate">
                                                {center.address || (
                                                    <span className="text-sm text-slate-400">No address</span>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-gray-600 dark:text-gray-400">
                                                {center.fdoName || (
                                                    <span className="text-sm text-slate-400">N/A</span>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-gray-600 dark:text-gray-400 text-sm">
                                                {center.meetingDay || center.meetingTime || center.meetingPlace ? (
                                                     <div>
                                                         {(center.meetingDay || center.meetingTime) && (
                                                             <div className="font-medium">
                                                                 {[center.meetingDay, center.meetingTime].filter(Boolean).join(' • ')}
                                                             </div>
                                                         )}
                                                         {center.meetingPlace && (
                                                             <div className="text-xs text-slate-500">
                                                                 {center.meetingPlace}
                                                             </div>
                                                         )}
                                                     </div>
                                                 ) : (
                                                     <span className="text-sm text-slate-400">N/A</span>
                                                 )}
                                            </TableCell>
                                            <TableCell className="text-gray-600 dark:text-gray-400 text-sm">
                                                {center.kmFromBranch != null ? `${center.kmFromBranch} km` : '—'}
                                            </TableCell>
                                            <TableCell className="text-gray-600 dark:text-gray-400 text-sm">
                                                {center.contactPerson || '—'}
                                            </TableCell>
                                            <TableCell className="text-gray-600 dark:text-gray-400 text-sm">
                                                {center.contactNumber || '—'}
                                            </TableCell>
                                            <TableCell>
                                                <Badge
                                                    variant="outline"
                                                    className={statusColors[center.status]}
                                                >
                                                    {statusLabels[center.status]}
                                                </Badge>
                                                {!center.isActive && (
                                                    <Badge variant="outline" className="ml-1 border-red-300 bg-red-50 text-red-700">
                                                        Deleted
                                                    </Badge>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right pr-6">
                                                <div className="flex items-center justify-end gap-2">
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => setPreviewCenter(center)}
                                                        className="h-8 w-8 text-primary hover:text-sidebar-accent hover:bg-green-50 transition-colors"
                                                        aria-label="View center details"
                                                    >
                                                        <Eye className="h-4 w-4" />
                                                    </Button>

                                                    {/* Approve button — BM and above + RBAC */}
                                                    {isBMOrAbove && canApproveCenter && center.isActive && center.status !== 'APPROVED' && (
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            onClick={() => openApprovalDialog(center, 'APPROVE')}
                                                            className="h-8 w-8 text-green-600 hover:text-green-700 hover:bg-green-50 transition-colors"
                                                            aria-label="Approve center"
                                                            title="Approve center"
                                                        >
                                                            <ThumbsUp className="h-4 w-4" />
                                                        </Button>
                                                    )}

                                                    {/* Reject button — BM and above + RBAC */}
                                                    {isBMOrAbove && canRejectCenter && center.isActive && center.status === 'PENDING_APPROVAL' && (
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            onClick={() => openApprovalDialog(center, 'REJECT')}
                                                            className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50 transition-colors"
                                                            aria-label="Reject center"
                                                            title="Reject center"
                                                        >
                                                            <ThumbsDown className="h-4 w-4" />
                                                        </Button>
                                                    )}

                                                    {/* Edit button — BM and above + RBAC */}
                                                    {/* Reactivate button — deleted (inactive) centers only */}
                                                    {isBMOrAbove && canEditCenter && !center.isActive && (
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            onClick={() => handleReactivate(center)}
                                                            disabled={reactivatingId === center.id}
                                                            className="h-8 w-8 text-green-600 hover:text-green-700 hover:bg-green-50 transition-colors"
                                                            aria-label="Reactivate center"
                                                            title="Reactivate center"
                                                        >
                                                            {reactivatingId === center.id
                                                                ? <Loader2 className="h-4 w-4 animate-spin" />
                                                                : <RotateCcw className="h-4 w-4" />}
                                                        </Button>
                                                    )}

                                                    {isBMOrAbove && onEdit && canEditCenter && center.isActive && (
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            onClick={() => onEdit(center)}
                                                            className="h-8 w-8 text-primary hover:text-primary hover:bg-green-50 transition-colors"
                                                            aria-label="Edit center"
                                                        >
                                                            <Edit className="h-4 w-4" />
                                                        </Button>
                                                    )}

                                                    {/* Delete button — BM and above + RBAC */}
                                                    {isBMOrAbove && canDeleteCenter && center.isActive && (
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            onClick={() => setDeleteId(center.id)}
                                                            className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50 transition-colors"
                                                            aria-label="Delete center"
                                                        >
                                                            <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                    )}
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>
                    {totalPages > 1 && (
                        <div className="flex items-center justify-between border-t border-primary/20 dark:border-sidebar-accent px-4 py-3">
                            <p className="text-sm text-sidebar-accent dark:text-slate-400">
                                Page {page} of {totalPages} · {totalCount} record{totalCount !== 1 ? 's' : ''}
                            </p>
                            <div className="flex gap-1">
                                <Button variant="outline" size="sm" onClick={() => handlePageChange(Math.max(1, page - 1))} disabled={page === 1 || isLoading}>
                                    Previous
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => handlePageChange(Math.min(totalPages, page + 1))} disabled={page === totalPages || isLoading}>
                                    Next
                                </Button>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Delete Confirmation Dialog */}
            <Dialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete Center</DialogTitle>
                        <DialogDescription>
                            Are you sure you want to delete this center? This action cannot be undone.
                            The center will be deactivated if it has active clients or loans.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setDeleteId(null)}
                            disabled={isDeleting}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={handleDelete}
                            disabled={isDeleting}
                        >
                            {isDeleting ? (
                                <>
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    Deleting...
                                </>
                            ) : (
                                'Delete'
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Preview Dialog */}
            <Dialog open={!!previewCenter} onOpenChange={() => setPreviewCenter(null)}>
                <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="text-xl font-semibold text-foreground dark:text-white">
                            Center Details
                        </DialogTitle>
                        <DialogDescription className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                            View comprehensive center information and details.
                        </DialogDescription>
                    </DialogHeader>
                    {previewCenter && (() => {
                        const nextMeetingYmd = computeNextMeetingDateYmd(previewCenter.meetingDay, new Date());
                        return (
                        <div className="space-y-6 py-4">
                            {/* Basic Information */}
                            <div className="space-y-4">
                                <h4 className="text-sm font-semibold text-sidebar-accent dark:text-slate-300 border-b pb-2">
                                    Basic Information
                                </h4>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="col-span-2">
                                        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                                            Center
                                        </p>
                                        <p className="text-sm text-foreground dark:text-slate-100 font-mono">
                                            {previewCenter.code}-{previewCenter.name}
                                        </p>
                                    </div>
                                    <div className="col-span-2">
                                        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                                            Address
                                        </p>
                                        <p className="text-sm text-foreground dark:text-slate-100">
                                            {previewCenter.address || 'No address provided'}
                                        </p>
                                    </div>
                                    <div className="col-span-2">
                                        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                                            Local Area
                                        </p>
                                        <p className="text-sm text-foreground dark:text-slate-100">
                                            {previewCenter.localArea || 'N/A'}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* FDO & Formation */}
                            <div className="space-y-4">
                                <h4 className="text-sm font-semibold text-sidebar-accent dark:text-slate-300 border-b pb-2">
                                    FDO & Formation
                                </h4>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                                            FDO Name
                                        </p>
                                        <p className="text-sm text-foreground dark:text-slate-100">
                                            {previewCenter.fdoName || 'N/A'}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                                            Formation Date
                                        </p>
                                        <p className="text-sm text-foreground dark:text-slate-100">
                                            {previewCenter.formationDate
                                                ? toDisplayDate(new Date(previewCenter.formationDate))
                                                : 'N/A'}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* Meeting Details */}
                            <div className="space-y-4">
                                <h4 className="text-sm font-semibold text-sidebar-accent dark:text-slate-300 border-b pb-2">
                                    Meeting Details
                                </h4>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                                            Next Meeting Date
                                        </p>
                                        <p className="text-sm text-foreground dark:text-slate-100">
                                            {nextMeetingYmd ? formatYmdToDmy(nextMeetingYmd) : 'N/A'}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                                            Meeting Day
                                        </p>
                                        <p className="text-sm text-foreground dark:text-slate-100">
                                            {previewCenter.meetingDay || 'N/A'}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                                            Meeting Time
                                        </p>
                                        <p className="text-sm text-foreground dark:text-slate-100">
                                            {previewCenter.meetingTime || 'N/A'}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                                            Meeting Place
                                        </p>
                                        <p className="text-sm text-foreground dark:text-slate-100">
                                            {previewCenter.meetingPlace || 'N/A'}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* Contact & Location */}
                            <div className="space-y-4">
                                <h4 className="text-sm font-semibold text-sidebar-accent dark:text-slate-300 border-b pb-2">
                                    Location & Status
                                </h4>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                                            Status
                                        </p>
                                        <Badge
                                            variant="outline"
                                            className={statusColors[previewCenter.status]}
                                        >
                                            {statusLabels[previewCenter.status]}
                                        </Badge>
                                    </div>
                                    {previewCenter.latitude && previewCenter.longitude && (
                                        <>
                                            <div>
                                                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                                                    Latitude
                                                </p>
                                                <p className="text-sm text-foreground dark:text-slate-100">
                                                    {previewCenter.latitude}
                                                </p>
                                            </div>
                                            <div>
                                                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                                                    Longitude
                                                </p>
                                                <p className="text-sm text-foreground dark:text-slate-100">
                                                    {previewCenter.longitude}
                                                </p>
                                            </div>
                                        </>
                                    )}
                                    <div>
                                        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                                            KM From Branch
                                        </p>
                                        <p className="text-sm text-foreground dark:text-slate-100">
                                            {previewCenter.kmFromBranch != null ? `${previewCenter.kmFromBranch} km` : '—'}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                                            Contact Person
                                        </p>
                                        <p className="text-sm text-foreground dark:text-slate-100">
                                            {previewCenter.contactPerson || '—'}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                                            Contact Person Number
                                        </p>
                                        <p className="text-sm text-foreground dark:text-slate-100">
                                            {previewCenter.contactNumber || '—'}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* Rejection Reason - Show if center is rejected */}
                            {previewCenter.status === 'REJECTED' && previewCenter.rejectionReason && (
                                <div className="space-y-4">
                                    <h4 className="text-sm font-semibold text-sidebar-accent dark:text-slate-300 border-b pb-2">
                                        Rejection Details
                                    </h4>
                                    <div className="space-y-3">
                                        {previewCenter.approvedBy && (
                                            <div className="grid grid-cols-2 gap-4">
                                                <div>
                                                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                                                        Rejected By
                                                    </p>
                                                    <p className="text-sm text-foreground dark:text-slate-100">
                                                        {previewCenter.approvedBy.firstName} {previewCenter.approvedBy.lastName}
                                                    </p>
                                                    <p className="text-xs text-sidebar-accent dark:text-slate-400">
                                                        {previewCenter.approvedBy.email}
                                                    </p>
                                                </div>
                                                {previewCenter.approvedAt && (
                                                    <div>
                                                        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                                                            Rejected On
                                                        </p>
                                                        <p className="text-sm text-foreground dark:text-slate-100">
                                                            {toDisplayDate(new Date(previewCenter.approvedAt))}
                                                        </p>
                                                        <p className="text-xs text-sidebar-accent dark:text-slate-400">
                                                            {new Date(previewCenter.approvedAt).toLocaleTimeString()}
                                                        </p>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                        <div className="p-4 bg-red-50 dark:bg-red-950/20 border-2 border-red-200 dark:border-red-800 rounded-lg">
                                            <p className="text-xs font-semibold text-red-700 dark:text-red-400 mb-2">
                                                Rejection Reason
                                            </p>
                                            <p className="text-sm text-red-900 dark:text-red-300 whitespace-pre-wrap">
                                                {previewCenter.rejectionReason}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Approval Details - Show if center is approved */}
                            {previewCenter.status === 'APPROVED' && previewCenter.approvedBy && (
                                <div className="space-y-4">
                                    <h4 className="text-sm font-semibold text-sidebar-accent dark:text-slate-300 border-b pb-2">
                                        Approval Details
                                    </h4>
                                    <div className="p-4 bg-green-50 dark:bg-green-950/20 border-2 border-green-200 dark:border-green-800 rounded-lg">
                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <p className="text-xs font-semibold text-green-700 dark:text-green-400 mb-1">
                                                    Approved By
                                                </p>
                                                <p className="text-sm text-green-900 dark:text-green-300">
                                                    {previewCenter.approvedBy.firstName} {previewCenter.approvedBy.lastName}
                                                </p>
                                                <p className="text-xs text-green-700 dark:text-green-400">
                                                    {previewCenter.approvedBy.email}
                                                </p>
                                            </div>
                                            {previewCenter.approvedAt && (
                                                <div>
                                                    <p className="text-xs font-semibold text-green-700 dark:text-green-400 mb-1">
                                                        Approved On
                                                    </p>
                                                    <p className="text-sm text-green-900 dark:text-green-300">
                                                        {toDisplayDate(new Date(previewCenter.approvedAt))}
                                                    </p>
                                                    <p className="text-xs text-green-700 dark:text-green-400">
                                                        {new Date(previewCenter.approvedAt).toLocaleTimeString()}
                                                    </p>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                        );
                    })()}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setPreviewCenter(null)}>
                            Close
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Approval/Rejection Dialog */}
            <Dialog open={!!approvalCenter} onOpenChange={() => {
                setApprovalCenter(null);
                setApprovalAction(null);
                setComments('');
                setRejectionReason('');
            }}>
                <DialogContent className="max-w-lg p-0 overflow-hidden border-0 shadow-2xl rounded-2xl bg-white/95 backdrop-blur-xl dark:bg-brand-green-darker/95 dark:border dark:border-sidebar-accent">
                    {/* Header Region */}
                    <div className={`p-6 pb-4 border-b ${approvalAction === 'APPROVE' ? 'bg-green-50/50 dark:bg-green-950/20 border-green-100 dark:border-green-900/50' : 'bg-red-50/50 dark:bg-red-950/20 border-red-100 dark:border-red-900/50'}`}>
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-3 text-xl">
                                {approvalAction === 'APPROVE' ? (
                                    <div className="flex items-center justify-center w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/40 text-green-600 dark:text-green-400">
                                        <CheckCircle2 className="w-5 h-5" />
                                    </div>
                                ) : (
                                    <div className="flex items-center justify-center w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400">
                                        <XCircle className="w-5 h-5" />
                                    </div>
                                )}
                                <span className={approvalAction === 'APPROVE' ? 'text-green-800 dark:text-green-300' : 'text-red-800 dark:text-red-300'}>
                                    {approvalAction === 'APPROVE' ? 'Approve Center' : 'Reject Center'}
                                </span>
                            </DialogTitle>
                            <DialogDescription className="pt-2 text-[15px] font-medium text-sidebar-accent dark:text-slate-400">
                                {approvalAction === 'APPROVE'
                                    ? approvalCenter?.status === 'REJECTED'
                                        ? 'You are about to re-approve this currently rejected center. This will enable center operations.'
                                        : 'You are about to approve this center. This action allows operations to commence.'
                                    : approvalCenter?.status === 'APPROVED'
                                        ? 'You are about to reject this currently approved center. This will halt center operations.'
                                        : 'You are about to reject this center application. A reason is required.'}
                            </DialogDescription>
                        </DialogHeader>
                    </div>

                    <div className="p-6 space-y-6">
                        {approvalCenter && (
                            <>
                                {/* Center Summary Card */}
                                <div className="flex items-center justify-between p-4 border rounded-xl bg-green-50/50 dark:bg-green-950/50 dark:border-sidebar-accent">
                                    <div>
                                        <p className="text-sm font-semibold text-foreground dark:text-slate-100">{approvalCenter.name}</p>
                                        <p className="text-xs font-mono text-slate-500 dark:text-slate-400 mt-1">{approvalCenter.code}</p>
                                    </div>
                                    <Badge variant="outline" className={statusColors[approvalCenter.status]}>
                                        {statusLabels[approvalCenter.status]}
                                    </Badge>
                                </div>

                                {/* Form Inputs */}
                                <div className="space-y-4">
                                    {approvalAction === 'REJECT' && (
                                        <div className="space-y-2.5">
                                            <Label htmlFor="rejectionReason" className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                                                Reason for Rejection <span className="text-red-500">*</span>
                                            </Label>
                                            <Textarea
                                                id="rejectionReason"
                                                placeholder="Please provide a clear reason for rejecting this center..."
                                                value={rejectionReason}
                                                onChange={(e) => setRejectionReason(e.target.value)}
                                                rows={3}
                                                required
                                                className="resize-none shadow-sm focus-visible:ring-red-500"
                                            />
                                        </div>
                                    )}

                                    <div className="space-y-2.5">
                                        <Label htmlFor="comments" className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                                            Additional Comments <span className="text-slate-400 font-normal">(Optional)</span>
                                        </Label>
                                        <Textarea
                                            id="comments"
                                            placeholder="Add any internal notes or remarks..."
                                            value={comments}
                                            onChange={(e) => setComments(e.target.value)}
                                            rows={2}
                                            className={`resize-none shadow-sm ${approvalAction === 'APPROVE' ? 'focus-visible:ring-green-500' : 'focus-visible:ring-red-500'}`}
                                        />
                                    </div>
                                </div>
                            </>
                        )}
                    </div>

                    {/* Footer Actions */}
                    <div className="px-6 py-4 bg-green-50 border-t border-slate-100 dark:bg-brand-green-darker dark:border-sidebar-accent">
                        <DialogFooter className="gap-2 sm:gap-0">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => {
                                    setApprovalCenter(null);
                                    setApprovalAction(null);
                                    setComments('');
                                    setRejectionReason('');
                                }}
                                disabled={isProcessing}
                                className="w-full sm:w-auto h-11 border-primary/30 text-sidebar-accent hover:bg-brand-green-tint dark:border-sidebar-accent dark:text-slate-300 dark:hover:bg-sidebar-accent"
                            >
                                Cancel
                            </Button>
                            <Button
                                onClick={handleApproveReject}
                                disabled={isProcessing || (approvalAction === 'REJECT' && !rejectionReason.trim())}
                                className={`w-full sm:w-auto h-11 font-semibold text-white transition-all shadow-sm ${approvalAction === 'APPROVE'
                                        ? 'bg-green-600 hover:bg-green-700 hover:shadow-md focus:ring-green-500 outline-none focus:ring-2 focus:ring-offset-2'
                                        : 'bg-red-600 hover:bg-red-700 hover:shadow-md focus:ring-red-500 outline-none focus:ring-2 focus:ring-offset-2'
                                    }`}
                            >
                                {isProcessing ? (
                                    <>
                                        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                                        Processing...
                                    </>
                                ) : approvalAction === 'APPROVE' ? (
                                    <>
                                        <CheckCircle2 className="w-4 h-4 mr-2 stroke-[3]" />
                                        Confirm Approval
                                    </>
                                ) : (
                                    <>
                                        <XCircle className="w-4 h-4 mr-2 stroke-[3]" />
                                        Confirm Rejection
                                    </>
                                )}
                            </Button>
                        </DialogFooter>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
}
