'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { ClipboardList, Save, Trash2, RefreshCw, Pencil, XCircle, RotateCcw, Loader2, AlertTriangle, Eye } from 'lucide-react';
import { apiClient } from '@/app/lib/api-client';
import { PageLoader } from '@/components/ui/page-loader';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/components/ui/dialog';
import { TableSearchInput } from '@/components/ui/table-search';
import { useTableSearch } from '@/hooks/useTableSearch';
import { cn } from '@/lib/utils';

type ClearanceReference = {
    id: string;
    exitRequestId: string;
    employeeId: string;
    employeeCode: string;
    employeeName: string;
    branchName: string;
    clearanceStatus: string;
    exitType?: string;
    exitStatus?: string;
};

const DEPARTMENTS = [
    { value: 'BM_FIELD', label: 'BM / Field Role' },
    { value: 'AM_DIVISION', label: 'AM / Division Manager' },
    { value: 'AUDIT', label: 'Audit' },
    { value: 'ACCOUNTS', label: 'Accounts' },
    { value: 'IT', label: 'IT' },
    { value: 'ADMIN', label: 'Admin' },
    { value: 'FINAL_HR', label: 'Final HR' },
];

const EXIT_TYPES = [
    { value: 'VOLUNTARY_RESIGNATION', label: 'Voluntary Resignation' },
    { value: 'ABSCONDING', label: 'Absconding' },
    { value: 'ASK_TO_GO', label: 'Ask to Go' },
    { value: 'APPOINTMENT_CANCELLATION', label: 'Appointment Cancellation' },
    { value: 'TERMINATION', label: 'Termination' },
    { value: 'DECEASED', label: 'Deceased' },
    { value: 'RETIREMENT', label: 'Retirement' },
];

type ConfigItem = {
    id: string;
    department: string;
    itemName: string;
    exitTypes: string[];
    isActive: boolean;
    sortOrder: number;
};

export function ExitClearanceConfigAdmin() {
    const { toast } = useToast();
    const [items, setItems] = useState<ConfigItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [editing, setEditing] = useState<ConfigItem | null>(null);

    const [department, setDepartment] = useState('');
    const [itemName, setItemName] = useState('');
    const [selectedExitTypes, setSelectedExitTypes] = useState<string[]>([]);

    const [deleteConfirmation, setDeleteConfirmation] = useState<{
        open: boolean;
        item: ConfigItem | null;
        permanent: boolean;
    }>({
        open: false,
        item: null,
        permanent: false,
    });
    const [reactivateTarget, setReactivateTarget] = useState<ConfigItem | null>(null);
    const [referenceModal, setReferenceModal] = useState<{
        open: boolean;
        itemName: string;
        department: string;
        references: ClearanceReference[];
        loading: boolean;
    }>({
        open: false,
        itemName: '',
        department: '',
        references: [],
        loading: false,
    });

    const fetchAll = useCallback(async () => {
        try {
            const res = await apiClient.get<ConfigItem[]>('/hr/exit-clearance-config?includeInactive=true');
            if (res.success && res.data) setItems(res.data);
        } catch {
            toast({ title: 'Error', description: 'Failed to fetch exit clearance config.', variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        fetchAll();
    }, [fetchAll]);

    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(items, {
        extraText: (item) => DEPARTMENTS.find((d) => d.value === item.department)?.label ?? '',
    });

    const toggleExitType = (value: string) => {
        setSelectedExitTypes((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
    };

    const handleEdit = (item: ConfigItem) => {
        setEditing(item);
        setDepartment(item.department);
        setItemName(item.itemName);
        setSelectedExitTypes(item.exitTypes);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleReset = () => {
        setEditing(null);
        setDepartment('');
        setItemName('');
        setSelectedExitTypes([]);
    };

    const handleSave = async () => {
        if (!department || !itemName.trim()) {
            toast({ title: 'Validation Error', description: 'Department and item name are required.', variant: 'destructive' });
            return;
        }
        setIsSaving(true);
        try {
            const payload = {
                department,
                itemName: itemName.trim(),
                exitTypes: selectedExitTypes,
            };
            const res = editing
                ? await apiClient.put<ConfigItem>(`/hr/exit-clearance-config?id=${editing.id}`, payload)
                : await apiClient.post<ConfigItem>('/hr/exit-clearance-config', payload);

            if (res.success) {
                toast({
                    title: editing ? 'Clearance Item Updated' : 'Clearance Item Created',
                    description: `Clearance item "${payload.itemName}" saved successfully.`,
                });
                handleReset();
                await fetchAll();
            } else {
                throw new Error(res.error || 'Operation failed');
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Operation failed.';
            toast({ title: 'Error', description: message, variant: 'destructive' });
        } finally {
            setIsSaving(false);
        }
    };

    const handleDeleteClick = (item: ConfigItem) => {
        setDeleteConfirmation({ open: true, item, permanent: false });
    };

    const handlePermanentDeleteClick = (item: ConfigItem) => {
        setDeleteConfirmation({ open: true, item, permanent: true });
    };

    const handleViewReferences = async (item: ConfigItem) => {
        setReferenceModal({
            open: true,
            itemName: item.itemName,
            department: item.department,
            references: [],
            loading: true,
        });
        try {
            const res = await apiClient.get<{ references: ClearanceReference[] }>(
                `/hr/exit-clearance-config?referencesForId=${item.id}`
            );
            if (res.success && res.data?.references) {
                setReferenceModal((prev) => ({
                    ...prev,
                    references: res.data?.references ?? [],
                    loading: false,
                }));
            } else {
                setReferenceModal((prev) => ({ ...prev, loading: false }));
            }
        } catch {
            setReferenceModal((prev) => ({ ...prev, loading: false }));
        }
    };

    const handleDeleteConfirm = async () => {
        if (!deleteConfirmation.item) return;
        const { item, permanent } = deleteConfirmation;

        setIsSaving(true);
        try {
            const url = permanent
                ? `/hr/exit-clearance-config?id=${item.id}&permanent=true`
                : `/hr/exit-clearance-config?id=${item.id}`;
            const res = await apiClient.delete<{ references?: ClearanceReference[] }>(url);
            if (res.success) {
                toast({
                    title: permanent ? 'Deleted' : 'Deactivated',
                    description: permanent
                        ? `Clearance item "${item.itemName}" permanently deleted.`
                        : `Clearance item "${item.itemName}" deactivated.`,
                });
                await fetchAll();
                setDeleteConfirmation({ open: false, item: null, permanent: false });
            } else {
                if (permanent && res.data?.references && res.data.references.length > 0) {
                    setDeleteConfirmation({ open: false, item: null, permanent: false });
                    setReferenceModal({
                        open: true,
                        itemName: item.itemName,
                        department: item.department,
                        references: res.data.references,
                        loading: false,
                    });
                    toast({
                        title: 'Cannot Permanently Delete',
                        description: `${res.data.references.length} clearance records still reference "${item.itemName}". Details displayed below.`,
                        variant: 'destructive',
                    });
                    return;
                }
                throw new Error(res.error || 'Operation failed');
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Operation failed.';
            toast({ title: 'Error', description: message, variant: 'destructive' });
        } finally {
            setIsSaving(false);
        }
    };

    const handleReactivateConfirm = async () => {
        if (!reactivateTarget) return;
        setIsSaving(true);
        try {
            const res = await apiClient.put<ConfigItem>(`/hr/exit-clearance-config?id=${reactivateTarget.id}`, {
                department: reactivateTarget.department,
                itemName: reactivateTarget.itemName,
                exitTypes: reactivateTarget.exitTypes,
                isActive: true,
            });
            if (res.success) {
                toast({
                    title: 'Reactivated',
                    description: `"${reactivateTarget.itemName}" reactivated.`,
                });
                setReactivateTarget(null);
                await fetchAll();
            } else {
                throw new Error(res.error || 'Reactivate failed');
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Reactivate failed.';
            toast({ title: 'Error', description: message, variant: 'destructive' });
        } finally {
            setIsSaving(false);
        }
    };

    if (isLoading) {
        return <PageLoader label="Loading Exit Clearance Config..." fullScreen={false} />;
    }

    return (
        <div className="relative min-h-screen">
            <div className="mx-auto max-w-5xl space-y-6">
                <div className="mb-8 flex items-center gap-4 mt-4">
                    <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary shadow-lg shadow-primary/30">
                        <ClipboardList className="h-7 w-7 text-white" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-foreground dark:text-white">Exit Clearance Configuration</h1>
                        <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                            Define clearance checklist items per department. Leave exit types unchecked to apply to all.
                        </p>
                    </div>
                </div>

                <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                    <CardHeader className="bg-gradient-to-r from-primary via-primary to-purple-600 px-6 py-4">
                        <CardTitle className="text-lg font-semibold text-white flex items-center gap-2">
                            {editing ? <Pencil className="h-5 w-5" /> : <Save className="h-5 w-5" />}
                            {editing ? 'Edit Clearance Item' : 'Register New Clearance Item'}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-6 space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <Label>Department</Label>
                                <Select value={department} onValueChange={setDepartment} disabled={isSaving}>
                                    <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                                    <SelectContent>
                                        {DEPARTMENTS.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Item Name</Label>
                                <Input
                                    value={itemName}
                                    onChange={(e) => setItemName(e.target.value)}
                                    placeholder="e.g. Hand over & take over"
                                    disabled={isSaving}
                                    onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                                />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label>Applicable Exit Types (leave all unchecked = applies to all)</Label>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                {EXIT_TYPES.map((t) => (
                                    <label key={t.value} className="flex items-center gap-2 text-sm cursor-pointer">
                                        <Checkbox
                                            checked={selectedExitTypes.includes(t.value)}
                                            onCheckedChange={() => toggleExitType(t.value)}
                                            disabled={isSaving}
                                        />
                                        {t.label}
                                    </label>
                                ))}
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-3 justify-center pt-4 border-t border-slate-100 dark:border-sidebar-accent text-center items-center">
                            <Button
                                onClick={handleSave}
                                disabled={isSaving || !department || !itemName.trim()}
                                className="w-32 bg-gradient-to-r from-primary to-primary hover:from-sidebar-accent hover:to-primary text-white shadow-lg transition-all active:scale-95"
                            >
                                {isSaving ? (
                                    <>
                                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                        ...
                                    </>
                                ) : (
                                    <>
                                        <Save className="h-4 w-4 mr-2" />
                                        {editing ? 'Update' : 'Save'}
                                    </>
                                )}
                            </Button>
                            <Button
                                onClick={handleReset}
                                variant="outline"
                                className="w-32 border-primary/20 text-sidebar-accent hover:bg-green-50 dark:border-sidebar-accent dark:text-slate-300 dark:hover:bg-sidebar-accent shadow-sm"
                                disabled={isSaving}
                            >
                                <RefreshCw className="h-4 w-4 mr-2" />
                                {editing ? 'Cancel' : 'Reset'}
                            </Button>
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40 overflow-hidden">
                    <CardHeader className="bg-gradient-to-r from-primary via-primary to-purple-600 px-6 py-4 space-y-3">
                        <CardTitle className="text-lg font-semibold text-white flex items-center justify-between">
                            Registered Clearance Items
                            <Badge variant="outline" className="text-white border-white/40">{searchedRows.length}</Badge>
                        </CardTitle>
                        <div className="flex flex-wrap items-center gap-4">
                            <TableSearchInput
                                value={tableSearchQuery}
                                onChange={setTableSearchQuery}
                                placeholder="Search clearance items..."
                                className="ml-auto bg-white dark:bg-sidebar-accent rounded-md"
                            />
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-green-50/50 dark:bg-brand-green-darker/50">
                                        <TableHead className="font-bold text-foreground dark:text-slate-100 uppercase text-xs">Department</TableHead>
                                        <TableHead className="font-bold text-foreground dark:text-slate-100 uppercase text-xs">Item Name</TableHead>
                                        <TableHead className="font-bold text-foreground dark:text-slate-100 uppercase text-xs">Exit Types</TableHead>
                                        <TableHead className="w-28 text-center font-bold text-foreground dark:text-slate-100 uppercase text-xs">Status</TableHead>
                                        <TableHead className="w-32 text-center font-bold text-foreground dark:text-slate-100 uppercase text-xs">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {searchedRows.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={5} className="px-4 py-12 text-center text-slate-500">
                                                <div className="flex flex-col items-center gap-2">
                                                    <ClipboardList className="h-8 w-8 opacity-20" />
                                                    <p>{tableSearchQuery ? 'No clearance items match your search.' : 'No clearance items registered yet.'}</p>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        searchedRows.map((item) => (
                                            <TableRow
                                                key={item.id}
                                                className={cn(
                                                    'group transition-colors dark:hover:bg-sidebar-accent/50',
                                                    editing?.id === item.id && 'bg-green-50/50 dark:bg-brand-green-darker/20'
                                                )}
                                            >
                                                <TableCell className="px-4 py-3 text-sm font-medium text-sidebar-accent dark:text-slate-200">
                                                    {DEPARTMENTS.find((d) => d.value === item.department)?.label ?? item.department}
                                                </TableCell>
                                                <TableCell className="px-4 py-3 text-sm font-medium text-sidebar-accent dark:text-slate-200">
                                                    {item.itemName}
                                                </TableCell>
                                                <TableCell className="px-4 py-3 text-xs text-slate-500">
                                                    {item.exitTypes.length === 0 ? 'All' : item.exitTypes.map((t) => EXIT_TYPES.find((e) => e.value === t)?.label ?? t).join(', ')}
                                                </TableCell>
                                                <TableCell className="px-4 py-3 text-center">
                                                    <Badge variant={item.isActive ? 'default' : 'outline'}>{item.isActive ? 'Active' : 'Inactive'}</Badge>
                                                </TableCell>
                                                <TableCell className="px-4 py-3 text-center">
                                                    <div className="flex items-center justify-center gap-2">
                                                        {item.isActive ? (
                                                            <>
                                                                <Button
                                                                    type="button"
                                                                    size="sm"
                                                                    variant="ghost"
                                                                    onClick={() => handleEdit(item)}
                                                                    className="h-8 w-8 p-0 text-primary hover:bg-green-50 dark:text-primary dark:hover:bg-brand-green-darker/30"
                                                                    title="Edit"
                                                                >
                                                                    <Pencil className="h-4 w-4" />
                                                                </Button>
                                                                <Button
                                                                    type="button"
                                                                    size="sm"
                                                                    variant="ghost"
                                                                    onClick={() => handleDeleteClick(item)}
                                                                    className="h-8 w-8 p-0 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30"
                                                                    title="Deactivate"
                                                                >
                                                                    <Trash2 className="h-4 w-4" />
                                                                </Button>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <Button
                                                                    type="button"
                                                                    size="sm"
                                                                    variant="ghost"
                                                                    onClick={() => handleViewReferences(item)}
                                                                    className="h-8 w-8 p-0 text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-sidebar-accent/50"
                                                                    title="View Referencing Clearances"
                                                                >
                                                                    <Eye className="h-4 w-4" />
                                                                </Button>
                                                                <Button
                                                                    type="button"
                                                                    size="sm"
                                                                    variant="ghost"
                                                                    onClick={() => setReactivateTarget(item)}
                                                                    className="h-8 w-8 p-0 text-green-600 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-900/30"
                                                                    title="Reactivate"
                                                                >
                                                                    <RotateCcw className="h-4 w-4" />
                                                                </Button>
                                                                <Button
                                                                    type="button"
                                                                    size="sm"
                                                                    variant="ghost"
                                                                    onClick={() => handlePermanentDeleteClick(item)}
                                                                    className="h-8 w-8 p-0 text-red-700 hover:bg-red-100 dark:text-red-500 dark:hover:bg-red-900/40"
                                                                    title="Delete Permanently"
                                                                >
                                                                    <XCircle className="h-4 w-4" />
                                                                </Button>
                                                            </>
                                                        )}
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>

                <ConfirmationDialog
                    open={deleteConfirmation.open}
                    onOpenChange={(open) => setDeleteConfirmation({ open, item: null, permanent: false })}
                    onConfirm={handleDeleteConfirm}
                    title={
                        deleteConfirmation.permanent
                            ? (deleteConfirmation.item ? `Permanently delete ${deleteConfirmation.item.itemName}?` : 'Confirm Permanent Deletion')
                            : (deleteConfirmation.item ? `Deactivate ${deleteConfirmation.item.itemName}?` : 'Deactivate Item?')
                    }
                    description={
                        deleteConfirmation.item
                            ? deleteConfirmation.permanent
                                ? `Permanently delete "${deleteConfirmation.item.itemName}"? This cannot be undone.`
                                : 'This will make the record inactive. Existing data and references will be preserved.'
                            : ''
                    }
                    confirmText={deleteConfirmation.permanent ? 'Delete Permanently' : 'Deactivate'}
                    cancelText="Cancel"
                    type="delete"
                    isLoading={isSaving}
                />

                <ConfirmationDialog
                    open={!!reactivateTarget}
                    onOpenChange={(open) => !open && setReactivateTarget(null)}
                    onConfirm={handleReactivateConfirm}
                    title={reactivateTarget ? `Reactivate ${reactivateTarget.itemName}?` : 'Reactivate Item?'}
                    description={reactivateTarget ? 'This will make the record active again. Existing data and references will be preserved.' : ''}
                    confirmText="Reactivate"
                    cancelText="Cancel"
                    type="success"
                    isLoading={isSaving}
                />

                <Dialog
                    open={referenceModal.open}
                    onOpenChange={(open) => setReferenceModal((prev) => ({ ...prev, open }))}
                >
                    <DialogContent className="w-[92vw] sm:max-w-3xl md:max-w-4xl max-h-[85vh] overflow-y-auto">
                        <DialogHeader>
                            <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400">
                                    <AlertTriangle className="h-5 w-5" />
                                </div>
                                <div>
                                    <DialogTitle className="text-lg font-bold text-foreground">
                                        Clearance Item In Use
                                    </DialogTitle>
                                    <DialogDescription className="text-sm text-muted-foreground mt-0.5">
                                        Cannot permanently delete <span className="font-semibold text-foreground">&quot;{referenceModal.itemName}&quot;</span> because active or historical clearance records reference it.
                                    </DialogDescription>
                                </div>
                            </div>
                        </DialogHeader>

                        <div className="space-y-4 py-3">
                            <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
                                To maintain compliance audit trails and record integrity, items linked to past or pending employee exit clearance checklists cannot be permanently removed. You can safely keep this item <strong>Inactive</strong> so it will not appear on future exit checklists.
                            </div>

                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <h4 className="text-sm font-semibold text-foreground">
                                        Referenced Employee Clearance Records ({referenceModal.references.length})
                                    </h4>
                                </div>

                                {referenceModal.loading ? (
                                    <div className="flex items-center justify-center py-8">
                                        <Loader2 className="h-6 w-6 animate-spin text-primary" />
                                        <span className="ml-2 text-sm text-muted-foreground">Loading references...</span>
                                    </div>
                                ) : referenceModal.references.length === 0 ? (
                                    <p className="text-sm text-muted-foreground py-4 text-center">
                                        No active clearance references found for this item.
                                    </p>
                                ) : (
                                    <div className="rounded-md border border-slate-200 dark:border-sidebar-accent overflow-hidden">
                                        <Table>
                                            <TableHeader>
                                                <TableRow className="bg-slate-50 dark:bg-brand-green-darker/50">
                                                    <TableHead className="font-semibold text-xs">Employee</TableHead>
                                                    <TableHead className="font-semibold text-xs">Branch</TableHead>
                                                    <TableHead className="font-semibold text-xs">Exit Type</TableHead>
                                                    <TableHead className="font-semibold text-xs text-center">Clearance Status</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {referenceModal.references.map((ref) => (
                                                    <TableRow key={ref.id} className="hover:bg-slate-50/50 dark:hover:bg-sidebar-accent/30">
                                                        <TableCell className="py-2.5">
                                                            <div className="font-medium text-sm text-foreground">{ref.employeeName}</div>
                                                            <div className="text-xs text-muted-foreground font-mono">{ref.employeeCode}</div>
                                                        </TableCell>
                                                        <TableCell className="py-2.5 text-xs text-muted-foreground">
                                                            {ref.branchName || '—'}
                                                        </TableCell>
                                                        <TableCell className="py-2.5 text-xs">
                                                            {EXIT_TYPES.find((e) => e.value === ref.exitType)?.label ?? ref.exitType ?? '—'}
                                                        </TableCell>
                                                        <TableCell className="py-2.5 text-center">
                                                            <Badge
                                                                variant="outline"
                                                                className={cn(
                                                                    'text-xs uppercase font-medium',
                                                                    ref.clearanceStatus === 'CLEARED' && 'bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-400',
                                                                    ref.clearanceStatus === 'REJECTED' && 'bg-rose-50 text-rose-700 border-rose-300 dark:bg-rose-950/40 dark:text-rose-400',
                                                                    ref.clearanceStatus === 'PENDING' && 'bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950/40 dark:text-amber-400'
                                                                )}
                                                            >
                                                                {ref.clearanceStatus}
                                                            </Badge>
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </div>
                                )}
                            </div>
                        </div>

                        <DialogFooter className="pt-2">
                            <Button
                                variant="outline"
                                onClick={() => setReferenceModal((prev) => ({ ...prev, open: false }))}
                            >
                                Close
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>
        </div>
    );
}
