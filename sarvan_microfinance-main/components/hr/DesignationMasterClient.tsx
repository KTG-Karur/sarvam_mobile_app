'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { useToast } from '@/hooks/use-toast';
import { RefreshCw, Save, Loader2, Pencil, Trash2, XCircle, BadgeCheck, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { apiClient } from '@/app/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';
import { PageLoader } from '@/components/ui/page-loader';
import { ApiResponse } from '@/app/types';

type Role = { id: string; slug: string; name: string };

type Designation = {
    id: string;
    name: string;
    code: string;
    grade: number | null;
    defaultRoleSlug: string | null;
    basicPercent: number | string;
    hraPercent: number | string;
    isActive: boolean;
};

export function DesignationMasterClient() {
    const { toast } = useToast();
    const [designations, setDesignations] = useState<Designation[]>([]);
    const [roles, setRoles] = useState<Role[]>([]);
    const [editing, setEditing] = useState<Designation | null>(null);
    const [name, setName] = useState('');
    const [code, setCode] = useState('');
    const [grade, setGrade] = useState('');
    const [defaultRoleSlug, setDefaultRoleSlug] = useState('none');
    const [basicPercent, setBasicPercent] = useState('70');
    const [hraPercent, setHraPercent] = useState('30');
    const [isLoading, setIsLoading] = useState(false);
    const [isInitialLoading, setIsInitialLoading] = useState(true);
    const [deleteConfirmation, setDeleteConfirmation] = useState<{ open: boolean; designation: Designation | null; permanent: boolean }>({
        open: false,
        designation: null,
        permanent: false,
    });
    const [reactivateTarget, setReactivateTarget] = useState<Designation | null>(null);

    const fetchDesignations = useCallback(async () => {
        try {
            const [desigRes, rolesRes] = await Promise.all([
                apiClient.get<Designation[]>('/hr/designations?includeInactive=true'),
                apiClient.get<Role[]>('/admin/roles').catch(() => null) as Promise<(ApiResponse<Role[]> & { roles?: Role[] }) | null>,
            ]);
            if (desigRes.success && desigRes.data) {
                setDesignations(desigRes.data);
            }
            if (rolesRes && rolesRes.roles) {
                setRoles(rolesRes.roles.filter((r: any) => r.isActive !== false));
            } else {
                // Without the roles list, the Default Login Role dropdown can only
                // offer "None" — silently proceeding risks an admin mistaking that
                // for the designation's actual (unloaded) mapping and overwriting
                // it with null on save. Surface the failure instead.
                toast({ title: 'Error', description: 'Failed to load roles — Default Login Role selection is unavailable until this loads.', variant: 'destructive' });
            }
        } catch (error) {
            toast({ title: 'Error', description: 'Failed to fetch designations.', variant: 'destructive' });
        } finally {
            setIsInitialLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        fetchDesignations();
    }, [fetchDesignations]);

    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(designations);

    const handleEdit = (designation: Designation) => {
        setEditing(designation);
        setName(designation.name);
        setCode(designation.code);
        setGrade(designation.grade != null ? String(designation.grade) : '');
        setDefaultRoleSlug(designation.defaultRoleSlug || 'none');
        setBasicPercent(String(designation.basicPercent ?? 70));
        setHraPercent(String(designation.hraPercent ?? 30));
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleReset = () => {
        setEditing(null);
        setName('');
        setCode('');
        setGrade('');
        setDefaultRoleSlug('none');
        setBasicPercent('70');
        setHraPercent('30');
    };

    const handleSave = async () => {
        if (!name.trim() || !code.trim()) {
            toast({ title: 'Validation Error', description: 'Designation name and code are required.', variant: 'destructive' });
            return;
        }
        const trimmedGrade = grade.trim();
        if (trimmedGrade && !Number.isInteger(Number(trimmedGrade))) {
            toast({ title: 'Validation Error', description: 'Grade must be a whole number.', variant: 'destructive' });
            return;
        }
        const basicPct = Number(basicPercent);
        const hraPct = Number(hraPercent);
        if (Number.isNaN(basicPct) || Number.isNaN(hraPct) || basicPct < 0 || hraPct < 0) {
            toast({ title: 'Validation Error', description: 'Basic % and HRA % must be non-negative numbers.', variant: 'destructive' });
            return;
        }
        if (Math.abs(basicPct + hraPct - 100) > 0.01) {
            toast({ title: 'Validation Error', description: `Basic % (${basicPct}) and HRA % (${hraPct}) must sum to 100.`, variant: 'destructive' });
            return;
        }

        setIsLoading(true);
        try {
            const payload = {
                name: name.trim(),
                code: code.trim().toUpperCase(),
                grade: trimmedGrade ? Number(trimmedGrade) : null,
                defaultRoleSlug: defaultRoleSlug && defaultRoleSlug !== 'none' ? defaultRoleSlug : null,
                basicPercent: basicPct,
                hraPercent: hraPct,
            };
            const res = editing
                ? await apiClient.put<Designation>(`/hr/designations?id=${editing.id}`, payload)
                : await apiClient.post<Designation>('/hr/designations', payload);

            if (res.success) {
                toast({
                    title: editing ? 'Designation Updated' : 'Designation Created',
                    description: `Designation "${payload.name}" saved successfully.`,
                });
                handleReset();
                await fetchDesignations();
            } else {
                throw new Error(res.error || 'Operation failed');
            }
        } catch (error: any) {
            toast({ title: 'Error', description: error.message || 'Operation failed.', variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
    };

    const handleDeleteClick = (designation: Designation) => {
        setDeleteConfirmation({ open: true, designation, permanent: false });
    };

    const handlePermanentDeleteClick = (designation: Designation) => {
        setDeleteConfirmation({ open: true, designation, permanent: true });
    };

    const handleReactivateConfirm = async () => {
        if (!reactivateTarget) return;
        setIsLoading(true);
        try {
            const res = await apiClient.put<Designation>(`/hr/designations?id=${reactivateTarget.id}`, {
                name: reactivateTarget.name,
                code: reactivateTarget.code,
                grade: reactivateTarget.grade,
                defaultRoleSlug: reactivateTarget.defaultRoleSlug,
                isActive: true,
            });
            if (res.success) {
                toast({ title: 'Designation Reactivated', description: `"${reactivateTarget.name}" reactivated.` });
                setReactivateTarget(null);
                await fetchDesignations();
            } else {
                throw new Error(res.error || 'Reactivate failed');
            }
        } catch (error: any) {
            toast({ title: 'Error', description: error.message || 'Reactivate failed.', variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
    };

    const handleDeleteConfirm = async () => {
        if (!deleteConfirmation.designation) return;
        const { designation, permanent } = deleteConfirmation;

        setIsLoading(true);
        try {
            const url = permanent
                ? `/hr/designations?id=${designation.id}&permanent=true`
                : `/hr/designations?id=${designation.id}`;
            const res = await apiClient.delete(url);
            if (res.success) {
                toast({
                    title: permanent ? 'Designation Deleted' : 'Designation Deactivated',
                    description: permanent
                        ? `Designation "${designation.name}" permanently deleted.`
                        : `Designation "${designation.name}" deactivated.`,
                });
                await fetchDesignations();
                setDeleteConfirmation({ open: false, designation: null, permanent: false });
            } else {
                throw new Error(res.error || 'Delete failed');
            }
        } catch (error: any) {
            toast({ title: 'Error', description: error.message || 'Delete failed.', variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
    };

    if (isInitialLoading) {
        return <PageLoader label="Loading Designations..." fullScreen={false} />;
    }

    return (
        <div className="relative min-h-screen">
            <div className="mx-auto max-w-5xl space-y-6">
                <div className="mb-8 flex items-center justify-between mt-4">
                    <div className="flex items-center gap-4">
                        <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary shadow-lg shadow-primary/30">
                            <BadgeCheck className="h-7 w-7 text-white" />
                            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/20 to-transparent pointer-events-none" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-bold tracking-tight text-foreground dark:text-white">Designation Master</h1>
                            <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                                Manage designations used for employee organization placement. Grade is a cosmetic seniority hint only.
                            </p>
                        </div>
                    </div>
                </div>

                <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                    <CardHeader className="bg-gradient-to-r from-primary via-primary to-purple-600 px-6 py-4">
                        <CardTitle className="text-lg font-semibold text-white flex items-center gap-2">
                            {editing ? <Pencil className="h-5 w-5" /> : <Save className="h-5 w-5" />}
                            {editing ? 'Edit Designation' : 'Register New Designation'}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                            <div className="space-y-2">
                                <Label htmlFor="desig-name" className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                                    Designation Name <span className="text-red-500">*</span>
                                </Label>
                                <Input
                                    id="desig-name"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    placeholder="e.g. Senior FDO"
                                    className="bg-white dark:bg-sidebar-accent"
                                    disabled={isLoading}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="desig-code" className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                                    Designation Code <span className="text-red-500">*</span>
                                </Label>
                                <Input
                                    id="desig-code"
                                    value={code}
                                    onChange={(e) => setCode(e.target.value)}
                                    placeholder="e.g. SR-FDO"
                                    className="bg-white dark:bg-sidebar-accent uppercase"
                                    disabled={isLoading}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="desig-grade" className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                                    Grade (optional)
                                </Label>
                                <Input
                                    id="desig-grade"
                                    type="number"
                                    value={grade}
                                    onChange={(e) => setGrade(e.target.value)}
                                    placeholder="e.g. 2"
                                    className="bg-white dark:bg-sidebar-accent"
                                    disabled={isLoading}
                                    onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="desig-default-role" className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                                    Default Login Role
                                </Label>
                                <Select
                                    value={defaultRoleSlug}
                                    onValueChange={setDefaultRoleSlug}
                                    disabled={isLoading}
                                >
                                    <SelectTrigger id="desig-default-role" className="bg-white dark:bg-sidebar-accent">
                                        <SelectValue placeholder="Select default role" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="none">— None (FDO default) —</SelectItem>
                                        {roles.map((role) => (
                                            <SelectItem key={role.id} value={role.slug}>
                                                {role.name} ({role.slug})
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="desig-basic-pct" className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                                    Basic % <span className="text-red-500">*</span>
                                </Label>
                                <Input
                                    id="desig-basic-pct"
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    max="100"
                                    value={basicPercent}
                                    onChange={(e) => setBasicPercent(e.target.value)}
                                    placeholder="70"
                                    className="bg-white dark:bg-sidebar-accent"
                                    disabled={isLoading}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="desig-hra-pct" className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                                    HRA % <span className="text-red-500">*</span>
                                </Label>
                                <Input
                                    id="desig-hra-pct"
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    max="100"
                                    value={hraPercent}
                                    onChange={(e) => setHraPercent(e.target.value)}
                                    placeholder="30"
                                    className="bg-white dark:bg-sidebar-accent"
                                    disabled={isLoading}
                                    onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                                />
                                {Math.abs(Number(basicPercent || 0) + Number(hraPercent || 0) - 100) > 0.01 && (
                                    <p className="text-xs text-red-500">Basic % + HRA % must equal 100 (currently {Number(basicPercent || 0) + Number(hraPercent || 0)}).</p>
                                )}
                            </div>
                        </div>

                        <div className="flex flex-wrap gap-3 mt-6 pt-6 border-t border-slate-100 dark:border-sidebar-accent text-center items-center justify-center">
                            <Button
                                onClick={handleSave}
                                disabled={isLoading || !name.trim() || !code.trim()}
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
                                        {editing ? 'Update' : 'Save'}
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

                <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40 overflow-hidden">
                    <CardHeader className="bg-gradient-to-r from-primary via-primary to-purple-600 px-6 py-4 space-y-3">
                        <CardTitle className="text-lg font-semibold text-white flex items-center justify-between">
                            Registered Designations
                            <Badge variant="outline" className="text-white border-white/40">{searchedRows.length}</Badge>
                        </CardTitle>
                        <div className="flex flex-wrap items-center gap-4">
                            <TableSearchInput
                                value={tableSearchQuery}
                                onChange={setTableSearchQuery}
                                placeholder="Search designations..."
                                className="ml-auto bg-white dark:bg-sidebar-accent rounded-md"
                            />
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-green-50/50 dark:bg-brand-green-darker/50">
                                        <TableHead className="font-bold text-foreground dark:text-slate-100 uppercase text-xs">Name</TableHead>
                                        <TableHead className="w-32 font-bold text-foreground dark:text-slate-100 uppercase text-xs">Code</TableHead>
                                        <TableHead className="w-20 text-center font-bold text-foreground dark:text-slate-100 uppercase text-xs">Grade</TableHead>
                                        <TableHead className="w-40 text-center font-bold text-foreground dark:text-slate-100 uppercase text-xs">Default Role</TableHead>
                                        <TableHead className="w-28 text-center font-bold text-foreground dark:text-slate-100 uppercase text-xs">Basic % / HRA %</TableHead>
                                        <TableHead className="w-28 text-center font-bold text-foreground dark:text-slate-100 uppercase text-xs">Status</TableHead>
                                        <TableHead className="w-32 text-center font-bold text-foreground dark:text-slate-100 uppercase text-xs">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {searchedRows.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={7} className="px-4 py-12 text-center text-slate-500">
                                                <div className="flex flex-col items-center gap-2">
                                                    <BadgeCheck className="h-8 w-8 opacity-20" />
                                                    <p>{tableSearchQuery ? 'No designations match your search.' : 'No designations registered yet.'}</p>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        searchedRows.map((designation) => (
                                            <TableRow
                                                key={designation.id}
                                                className={cn(
                                                    'group transition-colors dark:hover:bg-sidebar-accent/50',
                                                    editing?.id === designation.id && 'bg-green-50/50 dark:bg-brand-green-darker/20'
                                                )}
                                            >
                                                <TableCell className="px-4 py-3 text-sm font-medium text-sidebar-accent dark:text-slate-200">
                                                    {designation.name}
                                                </TableCell>
                                                <TableCell className="px-4 py-3 text-sm font-mono text-primary dark:text-primary">
                                                    {designation.code}
                                                </TableCell>
                                                <TableCell className="px-4 py-3 text-center text-sm text-sidebar-accent dark:text-slate-300">
                                                    {designation.grade ?? '—'}
                                                </TableCell>
                                                <TableCell className="px-4 py-3 text-center text-sm">
                                                    {designation.defaultRoleSlug ? (
                                                        <Badge variant="outline" className="font-mono text-xs">
                                                            {roles.find((r) => r.slug === designation.defaultRoleSlug)?.name ?? designation.defaultRoleSlug}
                                                        </Badge>
                                                    ) : (
                                                        <span className="text-muted-foreground text-xs">—</span>
                                                    )}
                                                </TableCell>
                                                <TableCell className="px-4 py-3 text-center text-sm font-mono text-sidebar-accent dark:text-slate-300">
                                                    {Number(designation.basicPercent ?? 70)}% / {Number(designation.hraPercent ?? 30)}%
                                                </TableCell>
                                                <TableCell className="px-4 py-3 text-center">
                                                    <Badge variant={designation.isActive ? 'default' : 'outline'}>
                                                        {designation.isActive ? 'Active' : 'Inactive'}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="px-4 py-3">
                                                    <div className="flex items-center justify-center gap-2">
                                                        <Button
                                                            type="button"
                                                            size="sm"
                                                            variant="ghost"
                                                            onClick={() => handleEdit(designation)}
                                                            className="h-8 w-8 p-0 text-primary hover:bg-green-50 dark:text-primary dark:hover:bg-brand-green-darker/30"
                                                            title="Edit"
                                                        >
                                                            <Pencil className="h-4 w-4" />
                                                        </Button>
                                                        {designation.isActive ? (
                                                            <Button
                                                                type="button"
                                                                size="sm"
                                                                variant="ghost"
                                                                onClick={() => handleDeleteClick(designation)}
                                                                className="h-8 w-8 p-0 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30"
                                                                title="Deactivate"
                                                            >
                                                                <Trash2 className="h-4 w-4" />
                                                            </Button>
                                                        ) : (
                                                            <>
                                                                <Button
                                                                    type="button"
                                                                    size="sm"
                                                                    variant="ghost"
                                                                    onClick={() => setReactivateTarget(designation)}
                                                                    className="h-8 w-8 p-0 text-green-600 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-900/30"
                                                                    title="Reactivate"
                                                                >
                                                                    <RotateCcw className="h-4 w-4" />
                                                                </Button>
                                                                <Button
                                                                    type="button"
                                                                    size="sm"
                                                                    variant="ghost"
                                                                    onClick={() => handlePermanentDeleteClick(designation)}
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
                    onOpenChange={(open) => setDeleteConfirmation({ open, designation: null, permanent: false })}
                    onConfirm={handleDeleteConfirm}
                    title={
                        deleteConfirmation.permanent
                            ? (deleteConfirmation.designation ? `Permanently delete ${deleteConfirmation.designation.name}?` : 'Confirm Permanent Deletion')
                            : (deleteConfirmation.designation ? `Deactivate ${deleteConfirmation.designation.name}?` : 'Deactivate Designation?')
                    }
                    description={
                        deleteConfirmation.designation
                            ? deleteConfirmation.permanent
                                ? `Permanently delete the designation "${deleteConfirmation.designation.name}"? This cannot be undone.`
                                : 'This will make the record inactive. Existing data and references will be preserved.'
                            : ''
                    }
                    confirmText={deleteConfirmation.permanent ? 'Delete Permanently' : 'Deactivate'}
                    cancelText="Cancel"
                    type="delete"
                    isLoading={isLoading}
                />

                <ConfirmationDialog
                    open={!!reactivateTarget}
                    onOpenChange={(open) => !open && setReactivateTarget(null)}
                    onConfirm={handleReactivateConfirm}
                    title={reactivateTarget ? `Reactivate ${reactivateTarget.name}?` : 'Reactivate Designation?'}
                    description={reactivateTarget ? 'This will make the record active again. Existing data and references will be preserved.' : ''}
                    confirmText="Reactivate"
                    cancelText="Cancel"
                    type="success"
                    isLoading={isLoading}
                />
            </div>
        </div>
    );
}
