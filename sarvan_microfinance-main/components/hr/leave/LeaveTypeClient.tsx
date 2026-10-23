'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import {
    RefreshCw,
    Save,
    Loader2,
    Pencil,
    Trash2,
    ChevronLeft,
    ChevronRight,
    ChevronsLeft,
    ChevronsRight,
    Calendar,
    CalendarRange,
    CheckCircle2,
    XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { apiClient } from '@/app/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';
import { PageLoader } from '@/components/ui/page-loader';

type LeaveType = {
    id: string;
    typeId: number;
    leaveType: string;
    isActive: boolean;
    isLop?: boolean;
    attachmentRequiredAboveDays?: number | string | null;
    allowCarryForward?: boolean;
    carryForwardMaxDays?: number | string | null;
};

const ITEMS_PER_PAGE = 10;

export function LeaveTypeClient() {
    const { toast } = useToast();
    const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
    const [editingLeaveType, setEditingLeaveType] = useState<LeaveType | null>(null);
    const [leaveTypeName, setLeaveTypeName] = useState<string>('');
    const [isLop, setIsLop] = useState<boolean>(false);
    const [isActive, setIsActive] = useState<boolean>(true);
    const [proofRequired, setProofRequired] = useState<boolean>(false);
    const [proofDays, setProofDays] = useState<string>('2');
    const [allowCarryForward, setAllowCarryForward] = useState<boolean>(false);
    const [carryForwardMaxDays, setCarryForwardMaxDays] = useState<string>('5');
    const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'DISABLED'>('ALL');
    const [togglingId, setTogglingId] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isInitialLoading, setIsInitialLoading] = useState(true);
    const [currentPage, setCurrentPage] = useState(1);
    const [deleteConfirmation, setDeleteConfirmation] = useState<{
        open: boolean;
        leaveType: LeaveType | null;
    }>({
        open: false,
        leaveType: null,
    });

    const fetchLeaveTypes = useCallback(async () => {
        try {
            const res = await apiClient.get<LeaveType[]>('/payroll/leave-types?all=true');
            if (res.success && res.data) {
                setLeaveTypes(res.data);
            }
        } catch (error) {
            toast({
                title: 'Error',
                description: 'Failed to fetch leave types.',
                variant: 'destructive',
            });
        } finally {
            setIsInitialLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        fetchLeaveTypes();
    }, [fetchLeaveTypes]);

    // Calculate next Type Id (from API actually, but for display before POST)
    const nextTypeId = useMemo(() => {
        if (leaveTypes.length === 0) return 1;
        const maxId = Math.max(...leaveTypes.map((lt) => lt.typeId));
        return maxId + 1;
    }, [leaveTypes]);

    const activeCount = useMemo(() => leaveTypes.filter((lt) => lt.isActive).length, [leaveTypes]);
    const disabledCount = useMemo(() => leaveTypes.filter((lt) => !lt.isActive).length, [leaveTypes]);

    const statusFilteredRows = useMemo(() => {
        if (statusFilter === 'ACTIVE') return leaveTypes.filter((lt) => lt.isActive);
        if (statusFilter === 'DISABLED') return leaveTypes.filter((lt) => !lt.isActive);
        return leaveTypes;
    }, [leaveTypes, statusFilter]);

    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(statusFilteredRows);

    // Reset to the first page whenever the search query or status filter changes
    useEffect(() => {
        setCurrentPage(1);
    }, [tableSearchQuery, statusFilter]);

    // Pagination
    const totalPages = Math.ceil(searchedRows.length / ITEMS_PER_PAGE);
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    const paginatedData = searchedRows.slice(startIndex, endIndex);

    const handleEdit = (leaveType: LeaveType) => {
        setEditingLeaveType(leaveType);
        setLeaveTypeName(leaveType.leaveType);
        setIsLop(!!leaveType.isLop);
        setIsActive(leaveType.isActive ?? true);
        const rule = leaveType.attachmentRequiredAboveDays;
        setProofRequired(rule !== null && rule !== undefined);
        setProofDays(rule !== null && rule !== undefined ? String(Number(rule)) : '2');
        setAllowCarryForward(!!leaveType.allowCarryForward);
        const cfDays = leaveType.carryForwardMaxDays;
        setCarryForwardMaxDays(cfDays !== null && cfDays !== undefined ? String(Number(cfDays)) : '5');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleToggleActive = async (lt: LeaveType) => {
        const newActive = !lt.isActive;
        setTogglingId(lt.id);
        try {
            const res = await apiClient.put<LeaveType>(`/payroll/leave-types?id=${lt.id}`, {
                isActive: newActive,
            });
            if (res.success) {
                toast({
                    title: newActive ? 'Leave Type Enabled' : 'Leave Type Disabled',
                    description: `Leave Type "${lt.leaveType}" is now ${newActive ? 'active and available for employees' : 'disabled and hidden from applications'}.`,
                });
                await fetchLeaveTypes();
            } else {
                throw new Error(res.error || 'Failed to update status');
            }
        } catch (error: any) {
            toast({
                title: 'Error',
                description: error.message || 'Failed to toggle status.',
                variant: 'destructive',
            });
        } finally {
            setTogglingId(null);
        }
    };

    const handleSave = async () => {
        if (!leaveTypeName.trim()) {
            toast({
                title: 'Validation Error',
                description: 'Leave Type name is required.',
                variant: 'destructive',
            });
            return;
        }

        setIsLoading(true);
        try {
            if (editingLeaveType) {
                const res = await apiClient.put<LeaveType>(`/payroll/leave-types?id=${editingLeaveType.id}`, {
                    leaveType: leaveTypeName.trim(),
                    isLop,
                    isActive,
                    attachmentRequiredAboveDays: proofRequired ? Math.max(0, Number(proofDays) || 0) : null,
                    allowCarryForward,
                    carryForwardMaxDays: allowCarryForward ? Math.max(0, Number(carryForwardMaxDays) || 0) : null,
                });
                if (res.success) {
                    toast({
                        title: 'Leave Type Updated',
                        description: `Leave Type "${leaveTypeName.trim()}" updated successfully.`,
                    });
                    setEditingLeaveType(null);
                    setLeaveTypeName('');
                    setIsLop(false);
                    setIsActive(true);
                    setProofRequired(false);
                    setProofDays('2');
                    setAllowCarryForward(false);
                    setCarryForwardMaxDays('5');
                    await fetchLeaveTypes();
                } else {
                    throw new Error(res.error || 'Update failed');
                }
            } else {
                const res = await apiClient.post<LeaveType>('/payroll/leave-types', {
                    leaveType: leaveTypeName.trim(),
                    isLop,
                    isActive,
                    attachmentRequiredAboveDays: proofRequired ? Math.max(0, Number(proofDays) || 0) : null,
                    allowCarryForward,
                    carryForwardMaxDays: allowCarryForward ? Math.max(0, Number(carryForwardMaxDays) || 0) : null,
                });
                if (res.success) {
                    toast({
                        title: 'Leave Type Created',
                        description: `Leave Type "${leaveTypeName.trim()}" created successfully.`,
                    });
                    setLeaveTypeName('');
                    setIsLop(false);
                    setIsActive(true);
                    setProofRequired(false);
                    setProofDays('2');
                    setAllowCarryForward(false);
                    setCarryForwardMaxDays('5');
                    await fetchLeaveTypes();
                } else {
                    throw new Error(res.error || 'Creation failed');
                }
            }
        } catch (error: any) {
            toast({
                title: 'Error',
                description: error.message || 'Operation failed.',
                variant: 'destructive',
            });
        } finally {
            setIsLoading(false);
        }
    };

    const handleReset = () => {
        setEditingLeaveType(null);
        setLeaveTypeName('');
        setIsLop(false);
        setIsActive(true);
        setProofRequired(false);
        setProofDays('2');
        setAllowCarryForward(false);
        setCarryForwardMaxDays('5');
    };

    const handleDeleteClick = (leaveType: LeaveType) => {
        setDeleteConfirmation({
            open: true,
            leaveType,
        });
    };

    const handleDeleteConfirm = async () => {
        if (!deleteConfirmation.leaveType) return;

        setIsLoading(true);
        try {
            const res = await apiClient.delete(`/payroll/leave-types?id=${deleteConfirmation.leaveType.id}`);
            if (res.success) {
                toast({
                    title: 'Leave Type Deleted',
                    description: `Leave Type "${deleteConfirmation.leaveType.leaveType}" deleted successfully.`,
                });
                await fetchLeaveTypes();
                setDeleteConfirmation({ open: false, leaveType: null });

                if (paginatedData.length === 1 && currentPage > 1) {
                    setCurrentPage(currentPage - 1);
                }
            } else {
                throw new Error(res.error || 'Delete failed');
            }
        } catch (error: any) {
            toast({
                title: 'Error',
                description: error.message || 'Delete failed.',
                variant: 'destructive',
            });
        } finally {
            setIsLoading(false);
        }
    };

    const handlePageChange = (page: number) => {
        setCurrentPage(page);
    };

    if (isInitialLoading) {
        return <PageLoader label="Loading Leave Types..." fullScreen={false} />;
    }

    return (
        <div className="relative min-h-screen">
            <div className="mx-auto max-w-7xl space-y-6">
                {/* Premium Header */}
                <div className="mb-8 flex items-center justify-between mt-4">
                    <div className="flex items-center gap-4">
                        <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary shadow-lg shadow-primary/30">
                            <CalendarRange className="h-7 w-7 text-white" />
                            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/20 to-transparent pointer-events-none" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-bold tracking-tight text-foreground dark:text-white">
                                Leave Type Master
                            </h1>
                            <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                                Manage leave categories available for employees across the organization.
                            </p>
                        </div>
                    </div>
                </div>

                {/* Form Section */}
                <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                    <CardHeader className="bg-gradient-to-r from-primary via-primary to-purple-600 px-6 py-4">
                        <CardTitle className="text-lg font-semibold text-white flex items-center gap-2">
                            {editingLeaveType ? <Pencil className="h-5 w-5" /> : <Save className="h-5 w-5" />}
                            {editingLeaveType ? 'Edit Leave Type' : 'Register New Leave Type'}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Type Id */}
                            <div className="space-y-2">
                                <Label htmlFor="type-id" className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                                    Type Id (Auto)
                                </Label>
                                <Input
                                    id="type-id"
                                    value={editingLeaveType ? editingLeaveType.typeId : nextTypeId}
                                    readOnly
                                    className="bg-brand-green-tint dark:bg-sidebar-accent cursor-not-allowed font-mono font-bold text-primary"
                                />
                            </div>

                            {/* Leave Type */}
                            <div className="space-y-2">
                                <Label htmlFor="leave-type" className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                                    Leave Type Name <span className="text-red-500">*</span>
                                </Label>
                                <Input
                                    id="leave-type"
                                    value={leaveTypeName}
                                    onChange={(e) => setLeaveTypeName(e.target.value)}
                                    placeholder="e.g. EARNED LEAVE"
                                    className="bg-white dark:bg-sidebar-accent uppercase"
                                    disabled={isLoading}
                                    onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                                />
                            </div>
                        </div>

                        {/* Status Toggle in Form */}
                        <div className="mt-4 flex items-center justify-between rounded-lg border border-slate-200/80 bg-slate-50/50 dark:border-sidebar-accent dark:bg-sidebar-accent/20 p-3.5">
                            <div className="space-y-0.5">
                                <Label htmlFor="leave-active-switch" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200 cursor-pointer">
                                    Status: {isActive ? <span className="text-emerald-600 dark:text-emerald-400 font-bold">Active (Enabled)</span> : <span className="text-rose-600 dark:text-rose-400 font-bold">Disabled</span>}
                                </Label>
                                <p className="text-xs text-muted-foreground">
                                    {isActive
                                        ? 'Enabled leave types can be selected by employees when applying for leave.'
                                        : 'Disabled leave types are hidden from employee application forms.'}
                                </p>
                            </div>
                            <Switch
                                id="leave-active-switch"
                                checked={isActive}
                                onCheckedChange={setIsActive}
                                disabled={isLoading}
                            />
                        </div>

                        <label className="mt-4 flex items-start gap-2 text-sm text-sidebar-accent dark:text-slate-300">
                            <input
                                type="checkbox"
                                className="mt-0.5 h-4 w-4"
                                checked={isLop}
                                onChange={(e) => setIsLop(e.target.checked)}
                                disabled={isLoading}
                            />
                            <span>
                                Mark as <strong>Loss of Pay</strong> type — used automatically by the system when an
                                approved leave exceeds the employee's remaining balance. Hidden from the employee's
                                Apply Leave dropdown. Only one leave type can be marked this way at a time.
                            </span>
                        </label>


                        <div className="mt-4 rounded-lg border border-slate-200 dark:border-sidebar-accent p-3">
                            <label className="flex items-start gap-2 text-sm text-sidebar-accent dark:text-slate-300">
                                <input
                                    type="checkbox"
                                    className="mt-0.5 h-4 w-4"
                                    checked={proofRequired}
                                    onChange={(e) => setProofRequired(e.target.checked)}
                                    disabled={isLoading}
                                />
                                <span>
                                    <strong>Require a proof attachment</strong> (for example a medical certificate) when the
                                    leave is longer than the number of days below. Use 0 to always require it.
                                </span>
                            </label>
                            {proofRequired && (
                                <div className="mt-3 flex items-center gap-2 pl-6 text-sm text-sidebar-accent dark:text-slate-300">
                                    <span>Proof needed when leave is more than</span>
                                    <Input
                                        type="number"
                                        min={0}
                                        max={365}
                                        step="0.5"
                                        className="w-24"
                                        value={proofDays}
                                        onChange={(e) => setProofDays(e.target.value)}
                                        disabled={isLoading}
                                    />
                                    <span>day(s)</span>
                                </div>
                            )}
                        </div>

                        <div className="mt-4 rounded-lg border border-slate-200 dark:border-sidebar-accent p-3">
                            <label className="flex items-start gap-2 text-sm text-sidebar-accent dark:text-slate-300">
                                <input
                                    type="checkbox"
                                    className="mt-0.5 h-4 w-4"
                                    checked={allowCarryForward}
                                    onChange={(e) => setAllowCarryForward(e.target.checked)}
                                    disabled={isLoading}
                                />
                                <span>
                                    <strong>Allow carry-forward</strong> — unused balance at month close rolls into
                                    next month's opening balance instead of being forfeited, up to the cap below.
                                </span>
                            </label>
                            {allowCarryForward && (
                                <div className="mt-3 flex items-center gap-2 pl-6 text-sm text-sidebar-accent dark:text-slate-300">
                                    <span>Carry forward at most</span>
                                    <Input
                                        type="number"
                                        min={0}
                                        max={365}
                                        step="0.5"
                                        className="w-24"
                                        value={carryForwardMaxDays}
                                        onChange={(e) => setCarryForwardMaxDays(e.target.value)}
                                        disabled={isLoading}
                                    />
                                    <span>day(s) — anything beyond this is forfeited</span>
                                </div>
                            )}
                        </div>

                        {/* Action Buttons */}
                        <div className="flex flex-wrap gap-3 mt-6 pt-6 border-t border-slate-100 dark:border-sidebar-accent text-center items-center justify-center">
                            <Button
                                onClick={handleSave}
                                disabled={isLoading || !leaveTypeName.trim()}
                                className="w-32 bg-gradient-to-r from-primary to-primary hover:from-sidebar-accent hover:to-primary text-white shadow-lg transition-all active:scale-95"
                            >
                                {isLoading ? (
                                    <>
                                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                        ...
                                    </>
                                ) : (
                                    <>
                                        <Save className="h-4 w-4 mr-2" />
                                        {editingLeaveType ? 'Update' : 'Save'}
                                    </>
                                )}
                            </Button>
                            <Button
                                onClick={handleReset}
                                variant="outline"
                                className="w-32 border-primary/20 text-sidebar-accent hover:bg-green-50 dark:border-sidebar-accent dark:text-slate-300 dark:hover:bg-sidebar-accent shadow-sm"
                                disabled={isLoading}
                            >
                                <RefreshCw className="h-4 w-4 mr-2" />
                                Reset
                            </Button>
                        </div>
                    </CardContent>
                </Card>

                {/* Table Section */}
                <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40 overflow-hidden">
                    <CardHeader className="bg-gradient-to-r from-primary via-primary to-purple-600 px-6 py-4 space-y-3">
                        <div className="flex items-center justify-between">
                            <CardTitle className="text-lg font-semibold text-white flex items-center gap-2">
                                Registered Leave Types
                                <Badge variant="outline" className="text-white border-white/40">{searchedRows.length}</Badge>
                            </CardTitle>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-4">
                            {/* Filter Status Pills */}
                            <div className="flex items-center gap-1.5 p-1 rounded-lg bg-white/20 dark:bg-sidebar-accent/50 text-xs">
                                <button
                                    type="button"
                                    onClick={() => setStatusFilter('ALL')}
                                    className={`px-3 py-1 rounded-md font-semibold transition-all ${
                                        statusFilter === 'ALL'
                                            ? 'bg-white text-primary shadow-sm dark:bg-brand-green-darker dark:text-white'
                                            : 'text-white/80 hover:text-white'
                                    }`}
                                >
                                    All ({leaveTypes.length})
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setStatusFilter('ACTIVE')}
                                    className={`px-3 py-1 rounded-md font-semibold transition-all ${
                                        statusFilter === 'ACTIVE'
                                            ? 'bg-white text-primary shadow-sm dark:bg-brand-green-darker dark:text-white'
                                            : 'text-white/80 hover:text-white'
                                    }`}
                                >
                                    Active ({activeCount})
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setStatusFilter('DISABLED')}
                                    className={`px-3 py-1 rounded-md font-semibold transition-all ${
                                        statusFilter === 'DISABLED'
                                            ? 'bg-white text-primary shadow-sm dark:bg-brand-green-darker dark:text-white'
                                            : 'text-white/80 hover:text-white'
                                    }`}
                                >
                                    Disabled ({disabledCount})
                                </button>
                            </div>

                            <TableSearchInput
                                value={tableSearchQuery}
                                onChange={setTableSearchQuery}
                                placeholder="Search leave types..."
                                className="w-full sm:w-64 bg-white dark:bg-sidebar-accent rounded-md"
                            />
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-green-50/50 dark:bg-brand-green-darker/50">
                                        <TableHead className="w-24 text-center font-bold text-foreground dark:text-slate-100 uppercase text-xs">Type Id</TableHead>
                                        <TableHead className="font-bold text-foreground dark:text-slate-100 uppercase text-xs">Leave Type</TableHead>
                                        <TableHead className="w-32 text-center font-bold text-foreground dark:text-slate-100 uppercase text-xs">Status</TableHead>
                                        <TableHead className="w-32 text-center font-bold text-foreground dark:text-slate-100 uppercase text-xs">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {paginatedData.length === 0 ? (
                                        <TableRow>
                                            <TableCell
                                                colSpan={4}
                                                className="px-4 py-12 text-center text-slate-500"
                                            >
                                                <div className="flex flex-col items-center gap-2">
                                                    <Calendar className="h-8 w-8 opacity-20" />
                                                    <p>{tableSearchQuery ? 'No leave types match your search.' : 'No leave types registered yet.'}</p>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        paginatedData.map((leaveType) => (
                                            <TableRow
                                                key={leaveType.id}
                                                className={cn(
                                                    'group transition-colors dark:hover:bg-sidebar-accent/50',
                                                    editingLeaveType?.id === leaveType.id && 'bg-green-50/50 dark:bg-brand-green-darker/20',
                                                    !leaveType.isActive && 'opacity-70 bg-slate-50/50 dark:bg-slate-900/20'
                                                )}
                                            >
                                                <TableCell className="px-4 py-3 text-sm font-mono font-bold text-primary dark:text-primary text-center">
                                                    {leaveType.typeId}
                                                </TableCell>
                                                <TableCell className="px-4 py-3">
                                                    <span className={cn(
                                                        "text-sm font-medium",
                                                        leaveType.isActive ? "text-sidebar-accent dark:text-slate-200" : "text-muted-foreground line-through"
                                                    )}>
                                                        {leaveType.leaveType}
                                                    </span>
                                                    {leaveType.isLop && (
                                                        <Badge variant="outline" className="ml-2 border-amber-400 text-amber-600 dark:text-amber-400">LOP</Badge>
                                                    )}
                                                    {leaveType.attachmentRequiredAboveDays !== null && leaveType.attachmentRequiredAboveDays !== undefined && (
                                                        <Badge variant="outline" className="ml-2 border-sky-400 text-sky-600 dark:text-sky-400">
                                                            {Number(leaveType.attachmentRequiredAboveDays) <= 0 ? 'Proof required' : `Proof > ${Number(leaveType.attachmentRequiredAboveDays)}d`}
                                                        </Badge>
                                                    )}
                                                    {leaveType.allowCarryForward && (
                                                        <Badge variant="outline" className="ml-2 border-emerald-400 text-emerald-600 dark:text-emerald-400">
                                                            Carry-forward ≤ {Number(leaveType.carryForwardMaxDays ?? 0)}d
                                                        </Badge>
                                                    )}
                                                </TableCell>
                                                <TableCell className="px-4 py-3 text-center">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleToggleActive(leaveType)}
                                                        disabled={togglingId === leaveType.id || isLoading}
                                                        title={leaveType.isActive ? 'Click to disable leave type' : 'Click to enable leave type'}
                                                        className="inline-flex items-center gap-1.5 transition-transform hover:scale-105 focus:outline-none cursor-pointer"
                                                    >
                                                        {togglingId === leaveType.id ? (
                                                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                                        ) : leaveType.isActive ? (
                                                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300/50">
                                                                <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                                                                Active
                                                            </span>
                                                        ) : (
                                                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border border-slate-300 dark:border-slate-700">
                                                                <XCircle className="h-3 w-3 text-slate-500" />
                                                                Disabled
                                                            </span>
                                                        )}
                                                    </button>
                                                </TableCell>
                                                <TableCell className="px-4 py-3">
                                                    <div className="flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                        <Button
                                                            type="button"
                                                            size="sm"
                                                            variant="ghost"
                                                            onClick={() => handleEdit(leaveType)}
                                                            className="h-8 w-8 p-0 text-primary hover:bg-green-50 dark:text-primary dark:hover:bg-brand-green-darker/30"
                                                            title="Edit"
                                                        >
                                                            <Pencil className="h-4 w-4" />
                                                        </Button>
                                                        <Button
                                                            type="button"
                                                            size="sm"
                                                            variant="ghost"
                                                            onClick={() => handleDeleteClick(leaveType)}
                                                            className="h-8 w-8 p-0 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30"
                                                            title="Delete"
                                                        >
                                                            <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>

                        {/* Pagination */}
                        {searchedRows.length > 0 && (
                            <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 dark:border-sidebar-accent bg-green-50/30 dark:bg-brand-green-darker/30">
                                <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                                    Showing <span className="text-foreground dark:text-slate-100">{startIndex + 1}</span> to <span className="text-foreground dark:text-slate-100">{Math.min(endIndex, searchedRows.length)}</span> of <span className="text-foreground dark:text-slate-100">{searchedRows.length}</span> records
                                </div>
                                <div className="flex items-center gap-1">
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        onClick={() => handlePageChange(1)}
                                        disabled={currentPage === 1}
                                        className="h-8 w-8"
                                    >
                                        <ChevronsLeft className="h-4 w-4" />
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        onClick={() => handlePageChange(currentPage - 1)}
                                        disabled={currentPage === 1}
                                        className="h-8 w-8"
                                    >
                                        <ChevronLeft className="h-4 w-4" />
                                    </Button>

                                    <div className="mx-2 text-xs font-bold text-sidebar-accent dark:text-slate-300">
                                        {currentPage} / {totalPages}
                                    </div>

                                    <Button
                                        variant="outline"
                                        size="icon"
                                        onClick={() => handlePageChange(currentPage + 1)}
                                        disabled={currentPage === totalPages}
                                        className="h-8 w-8"
                                    >
                                        <ChevronRight className="h-4 w-4" />
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        onClick={() => handlePageChange(totalPages)}
                                        disabled={currentPage === totalPages}
                                        className="h-8 w-8"
                                    >
                                        <ChevronsRight className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>

                <ConfirmationDialog
                    open={deleteConfirmation.open}
                    onOpenChange={(open) =>
                        setDeleteConfirmation({ open, leaveType: null })
                    }
                    onConfirm={handleDeleteConfirm}
                    title="Confirm Deletion"
                    description={
                        deleteConfirmation.leaveType
                            ? `Are you sure you want to permanently delete the leave type "${deleteConfirmation.leaveType.leaveType}"? This action may affect existing leave balances.`
                            : ''
                    }
                    confirmText="Delete Now"
                    cancelText="Cancel"
                    type="delete"
                    isLoading={isLoading}
                />
            </div>
        </div>
    );
}

