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
    Clock,
    Timer,
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

type PermissionType = {
    id: string;
    typeId: number;
    permissionType: string;
    isActive: boolean;
};

const ITEMS_PER_PAGE = 10;

export function PermissionTypeClient() {
    const { toast } = useToast();
    const [permissionTypes, setPermissionTypes] = useState<PermissionType[]>([]);
    const [editingPermissionType, setEditingPermissionType] = useState<PermissionType | null>(null);
    const [permissionTypeName, setPermissionTypeName] = useState<string>('');
    const [isActive, setIsActive] = useState<boolean>(true);
    const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'DISABLED'>('ALL');
    const [togglingId, setTogglingId] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isInitialLoading, setIsInitialLoading] = useState(true);
    const [currentPage, setCurrentPage] = useState(1);
    const [deleteConfirmation, setDeleteConfirmation] = useState<{
        open: boolean;
        permissionType: PermissionType | null;
    }>({
        open: false,
        permissionType: null,
    });

    const fetchPermissionTypes = useCallback(async () => {
        try {
            const res = await apiClient.get<PermissionType[]>('/payroll/permission-types?all=true');
            if (res.success && res.data) {
                setPermissionTypes(res.data);
            }
        } catch (error) {
            toast({
                title: 'Error',
                description: 'Failed to fetch permission types.',
                variant: 'destructive',
            });
        } finally {
            setIsInitialLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        fetchPermissionTypes();
    }, [fetchPermissionTypes]);

    // Calculate next Type Id (from API actually, but for display before POST)
    const nextTypeId = useMemo(() => {
        if (permissionTypes.length === 0) return 1;
        const maxId = Math.max(...permissionTypes.map((pt) => pt.typeId));
        return maxId + 1;
    }, [permissionTypes]);

    const activeCount = useMemo(() => permissionTypes.filter((pt) => pt.isActive).length, [permissionTypes]);
    const disabledCount = useMemo(() => permissionTypes.filter((pt) => !pt.isActive).length, [permissionTypes]);

    const statusFilteredRows = useMemo(() => {
        if (statusFilter === 'ACTIVE') return permissionTypes.filter((pt) => pt.isActive);
        if (statusFilter === 'DISABLED') return permissionTypes.filter((pt) => !pt.isActive);
        return permissionTypes;
    }, [permissionTypes, statusFilter]);

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

    const handleEdit = (permissionType: PermissionType) => {
        setEditingPermissionType(permissionType);
        setPermissionTypeName(permissionType.permissionType);
        setIsActive(permissionType.isActive ?? true);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleToggleActive = async (pt: PermissionType) => {
        const newActive = !pt.isActive;
        setTogglingId(pt.id);
        try {
            const res = await apiClient.put<PermissionType>(`/payroll/permission-types?id=${pt.id}`, {
                isActive: newActive,
            });
            if (res.success) {
                toast({
                    title: newActive ? 'Permission Type Enabled' : 'Permission Type Disabled',
                    description: `Permission Type "${pt.permissionType}" is now ${newActive ? 'active and available for employees' : 'disabled and hidden from applications'}.`,
                });
                await fetchPermissionTypes();
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
        if (!permissionTypeName.trim()) {
            toast({
                title: 'Validation Error',
                description: 'Permission Type name is required.',
                variant: 'destructive',
            });
            return;
        }

        setIsLoading(true);
        try {
            if (editingPermissionType) {
                const res = await apiClient.put<PermissionType>(`/payroll/permission-types?id=${editingPermissionType.id}`, {
                    permissionType: permissionTypeName.trim(),
                    isActive,
                });
                if (res.success) {
                    toast({
                        title: 'Permission Type Updated',
                        description: `Permission Type "${permissionTypeName.trim()}" updated successfully.`,
                    });
                    setEditingPermissionType(null);
                    setPermissionTypeName('');
                    setIsActive(true);
                    await fetchPermissionTypes();
                } else {
                    throw new Error(res.error || 'Update failed');
                }
            } else {
                const res = await apiClient.post<PermissionType>('/payroll/permission-types', {
                    permissionType: permissionTypeName.trim(),
                    isActive,
                });
                if (res.success) {
                    toast({
                        title: 'Permission Type Created',
                        description: `Permission Type "${permissionTypeName.trim()}" created successfully.`,
                    });
                    setPermissionTypeName('');
                    setIsActive(true);
                    await fetchPermissionTypes();
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
        setEditingPermissionType(null);
        setPermissionTypeName('');
        setIsActive(true);
    };

    const handleDeleteClick = (permissionType: PermissionType) => {
        setDeleteConfirmation({
            open: true,
            permissionType,
        });
    };

    const handleDeleteConfirm = async () => {
        if (!deleteConfirmation.permissionType) return;

        setIsLoading(true);
        try {
            const res = await apiClient.delete(`/payroll/permission-types?id=${deleteConfirmation.permissionType.id}`);
            if (res.success) {
                toast({
                    title: 'Permission Type Deleted',
                    description: `Permission Type "${deleteConfirmation.permissionType.permissionType}" deleted successfully.`,
                });
                await fetchPermissionTypes();
                setDeleteConfirmation({ open: false, permissionType: null });

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
        return <PageLoader label="Loading Permission Types..." fullScreen={false} />;
    }

    return (
        <div className="relative min-h-screen">
            <div className="mx-auto max-w-7xl space-y-6">
                {/* Premium Header */}
                <div className="mb-8 flex items-center justify-between mt-4">
                    <div className="flex items-center gap-4">
                        <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary shadow-lg shadow-primary/30">
                            <Clock className="h-7 w-7 text-white" />
                            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/20 to-transparent pointer-events-none" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-bold tracking-tight text-foreground dark:text-white">
                                Permission Type Master
                            </h1>
                            <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                                Manage short-duration permission (gate-pass) categories available for employees.
                            </p>
                        </div>
                    </div>
                </div>

                {/* Form Section */}
                <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                    <CardHeader className="bg-gradient-to-r from-primary via-primary to-purple-600 px-6 py-4">
                        <CardTitle className="text-lg font-semibold text-white flex items-center gap-2">
                            {editingPermissionType ? <Pencil className="h-5 w-5" /> : <Save className="h-5 w-5" />}
                            {editingPermissionType ? 'Edit Permission Type' : 'Register New Permission Type'}
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
                                    value={editingPermissionType ? editingPermissionType.typeId : nextTypeId}
                                    readOnly
                                    className="bg-brand-green-tint dark:bg-sidebar-accent cursor-not-allowed font-mono font-bold text-primary"
                                />
                            </div>

                            {/* Permission Type */}
                            <div className="space-y-2">
                                <Label htmlFor="permission-type" className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                                    Permission Type Name <span className="text-red-500">*</span>
                                </Label>
                                <Input
                                    id="permission-type"
                                    value={permissionTypeName}
                                    onChange={(e) => setPermissionTypeName(e.target.value)}
                                    placeholder="e.g. PERSONAL PERMISSION"
                                    className="bg-white dark:bg-sidebar-accent uppercase"
                                    disabled={isLoading}
                                    onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                                />
                            </div>
                        </div>

                        {/* Status Toggle in Form */}
                        <div className="mt-4 flex items-center justify-between rounded-lg border border-slate-200/80 bg-slate-50/50 dark:border-sidebar-accent dark:bg-sidebar-accent/20 p-3.5">
                            <div className="space-y-0.5">
                                <Label htmlFor="permission-active-switch" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200 cursor-pointer">
                                    Status: {isActive ? <span className="text-emerald-600 dark:text-emerald-400 font-bold">Active (Enabled)</span> : <span className="text-rose-600 dark:text-rose-400 font-bold">Disabled</span>}
                                </Label>
                                <p className="text-xs text-muted-foreground">
                                    {isActive
                                        ? 'Enabled permission types can be selected by employees when applying for permissions.'
                                        : 'Disabled permission types are hidden from employee application forms.'}
                                </p>
                            </div>
                            <Switch
                                id="permission-active-switch"
                                checked={isActive}
                                onCheckedChange={setIsActive}
                                disabled={isLoading}
                            />
                        </div>

                        {/* Action Buttons */}
                        <div className="flex flex-wrap gap-3 mt-6 pt-6 border-t border-slate-100 dark:border-sidebar-accent text-center items-center justify-center">
                            <Button
                                onClick={handleSave}
                                disabled={isLoading || !permissionTypeName.trim()}
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
                                        {editingPermissionType ? 'Update' : 'Save'}
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
                                Registered Permission Types
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
                                    All ({permissionTypes.length})
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
                                placeholder="Search permission types..."
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
                                        <TableHead className="font-bold text-foreground dark:text-slate-100 uppercase text-xs">Permission Type</TableHead>
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
                                                    <Timer className="h-8 w-8 opacity-20" />
                                                    <p>{tableSearchQuery ? 'No permission types match your search.' : 'No permission types registered yet.'}</p>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        paginatedData.map((permissionType) => (
                                            <TableRow
                                                key={permissionType.id}
                                                className={cn(
                                                    'group transition-colors dark:hover:bg-sidebar-accent/50',
                                                    editingPermissionType?.id === permissionType.id && 'bg-green-50/50 dark:bg-brand-green-darker/20',
                                                    !permissionType.isActive && 'opacity-70 bg-slate-50/50 dark:bg-slate-900/20'
                                                )}
                                            >
                                                <TableCell className="px-4 py-3 text-sm font-mono font-bold text-primary dark:text-primary text-center">
                                                    {permissionType.typeId}
                                                </TableCell>
                                                <TableCell className="px-4 py-3">
                                                    <span className={cn(
                                                        "text-sm font-medium",
                                                        permissionType.isActive ? "text-sidebar-accent dark:text-slate-200" : "text-muted-foreground line-through"
                                                    )}>
                                                        {permissionType.permissionType}
                                                    </span>
                                                </TableCell>
                                                <TableCell className="px-4 py-3 text-center">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleToggleActive(permissionType)}
                                                        disabled={togglingId === permissionType.id || isLoading}
                                                        title={permissionType.isActive ? 'Click to disable permission type' : 'Click to enable permission type'}
                                                        className="inline-flex items-center gap-1.5 transition-transform hover:scale-105 focus:outline-none cursor-pointer"
                                                    >
                                                        {togglingId === permissionType.id ? (
                                                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                                        ) : permissionType.isActive ? (
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
                                                            onClick={() => handleEdit(permissionType)}
                                                            className="h-8 w-8 p-0 text-primary hover:bg-green-50 dark:text-primary dark:hover:bg-brand-green-darker/30"
                                                            title="Edit"
                                                        >
                                                            <Pencil className="h-4 w-4" />
                                                        </Button>
                                                        <Button
                                                            type="button"
                                                            size="sm"
                                                            variant="ghost"
                                                            onClick={() => handleDeleteClick(permissionType)}
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
                        setDeleteConfirmation({ open, permissionType: null })
                    }
                    onConfirm={handleDeleteConfirm}
                    title="Confirm Deletion"
                    description={
                        deleteConfirmation.permissionType
                            ? `Are you sure you want to permanently delete the permission type "${deleteConfirmation.permissionType.permissionType}"?`
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
