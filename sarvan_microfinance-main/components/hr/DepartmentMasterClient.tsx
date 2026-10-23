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
import { useToast } from '@/hooks/use-toast';
import { RefreshCw, Save, Loader2, Pencil, Trash2, XCircle, Building2, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { apiClient } from '@/app/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';
import { PageLoader } from '@/components/ui/page-loader';

type Department = {
    id: string;
    name: string;
    code: string;
    isActive: boolean;
};

export function DepartmentMasterClient() {
    const { toast } = useToast();
    const [departments, setDepartments] = useState<Department[]>([]);
    const [editing, setEditing] = useState<Department | null>(null);
    const [name, setName] = useState('');
    const [code, setCode] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isInitialLoading, setIsInitialLoading] = useState(true);
    const [deleteConfirmation, setDeleteConfirmation] = useState<{ open: boolean; department: Department | null; permanent: boolean }>({
        open: false,
        department: null,
        permanent: false,
    });
    const [reactivateTarget, setReactivateTarget] = useState<Department | null>(null);

    const fetchDepartments = useCallback(async () => {
        try {
            const res = await apiClient.get<Department[]>('/hr/departments?includeInactive=true');
            if (res.success && res.data) {
                setDepartments(res.data);
            }
        } catch (error) {
            toast({ title: 'Error', description: 'Failed to fetch departments.', variant: 'destructive' });
        } finally {
            setIsInitialLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        fetchDepartments();
    }, [fetchDepartments]);

    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(departments);

    const handleEdit = (department: Department) => {
        setEditing(department);
        setName(department.name);
        setCode(department.code);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleReset = () => {
        setEditing(null);
        setName('');
        setCode('');
    };

    const handleSave = async () => {
        if (!name.trim() || !code.trim()) {
            toast({ title: 'Validation Error', description: 'Department name and code are required.', variant: 'destructive' });
            return;
        }

        setIsLoading(true);
        try {
            const payload = { name: name.trim(), code: code.trim().toUpperCase() };
            const res = editing
                ? await apiClient.put<Department>(`/hr/departments?id=${editing.id}`, payload)
                : await apiClient.post<Department>('/hr/departments', payload);

            if (res.success) {
                toast({
                    title: editing ? 'Department Updated' : 'Department Created',
                    description: `Department "${payload.name}" saved successfully.`,
                });
                handleReset();
                await fetchDepartments();
            } else {
                throw new Error(res.error || 'Operation failed');
            }
        } catch (error: any) {
            toast({ title: 'Error', description: error.message || 'Operation failed.', variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
    };

    const handleDeleteClick = (department: Department) => {
        setDeleteConfirmation({ open: true, department, permanent: false });
    };

    const handlePermanentDeleteClick = (department: Department) => {
        setDeleteConfirmation({ open: true, department, permanent: true });
    };

    const handleReactivateConfirm = async () => {
        if (!reactivateTarget) return;
        setIsLoading(true);
        try {
            const res = await apiClient.put<Department>(`/hr/departments?id=${reactivateTarget.id}`, {
                name: reactivateTarget.name,
                code: reactivateTarget.code,
                isActive: true,
            });
            if (res.success) {
                toast({ title: 'Department Reactivated', description: `"${reactivateTarget.name}" reactivated.` });
                setReactivateTarget(null);
                await fetchDepartments();
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
        if (!deleteConfirmation.department) return;
        const { department, permanent } = deleteConfirmation;

        setIsLoading(true);
        try {
            const url = permanent
                ? `/hr/departments?id=${department.id}&permanent=true`
                : `/hr/departments?id=${department.id}`;
            const res = await apiClient.delete(url);
            if (res.success) {
                toast({
                    title: permanent ? 'Department Deleted' : 'Department Deactivated',
                    description: permanent
                        ? `Department "${department.name}" permanently deleted.`
                        : `Department "${department.name}" deactivated.`,
                });
                await fetchDepartments();
                setDeleteConfirmation({ open: false, department: null, permanent: false });
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
        return <PageLoader label="Loading Departments..." fullScreen={false} />;
    }

    return (
        <div className="relative min-h-screen">
            <div className="mx-auto max-w-5xl space-y-6">
                <div className="mb-8 flex items-center justify-between mt-4">
                    <div className="flex items-center gap-4">
                        <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary shadow-lg shadow-primary/30">
                            <Building2 className="h-7 w-7 text-white" />
                            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/20 to-transparent pointer-events-none" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-bold tracking-tight text-foreground dark:text-white">Department Master</h1>
                            <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                                Manage departments used for employee organization placement.
                            </p>
                        </div>
                    </div>
                </div>

                <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                    <CardHeader className="bg-gradient-to-r from-primary via-primary to-purple-600 px-6 py-4">
                        <CardTitle className="text-lg font-semibold text-white flex items-center gap-2">
                            {editing ? <Pencil className="h-5 w-5" /> : <Save className="h-5 w-5" />}
                            {editing ? 'Edit Department' : 'Register New Department'}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <Label htmlFor="dept-name" className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                                    Department Name <span className="text-red-500">*</span>
                                </Label>
                                <Input
                                    id="dept-name"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    placeholder="e.g. Field Operations"
                                    className="bg-white dark:bg-sidebar-accent"
                                    disabled={isLoading}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="dept-code" className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                                    Department Code <span className="text-red-500">*</span>
                                </Label>
                                <Input
                                    id="dept-code"
                                    value={code}
                                    onChange={(e) => setCode(e.target.value)}
                                    placeholder="e.g. FLD-OPS"
                                    className="bg-white dark:bg-sidebar-accent uppercase"
                                    disabled={isLoading}
                                    onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                                />
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
                            Registered Departments
                            <Badge variant="outline" className="text-white border-white/40">{searchedRows.length}</Badge>
                        </CardTitle>
                        <div className="flex flex-wrap items-center gap-4">
                            <TableSearchInput
                                value={tableSearchQuery}
                                onChange={setTableSearchQuery}
                                placeholder="Search departments..."
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
                                        <TableHead className="w-28 text-center font-bold text-foreground dark:text-slate-100 uppercase text-xs">Status</TableHead>
                                        <TableHead className="w-32 text-center font-bold text-foreground dark:text-slate-100 uppercase text-xs">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {searchedRows.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={4} className="px-4 py-12 text-center text-slate-500">
                                                <div className="flex flex-col items-center gap-2">
                                                    <Building2 className="h-8 w-8 opacity-20" />
                                                    <p>{tableSearchQuery ? 'No departments match your search.' : 'No departments registered yet.'}</p>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        searchedRows.map((department) => (
                                            <TableRow
                                                key={department.id}
                                                className={cn(
                                                    'group transition-colors dark:hover:bg-sidebar-accent/50',
                                                    editing?.id === department.id && 'bg-green-50/50 dark:bg-brand-green-darker/20'
                                                )}
                                            >
                                                <TableCell className="px-4 py-3 text-sm font-medium text-sidebar-accent dark:text-slate-200">
                                                    {department.name}
                                                </TableCell>
                                                <TableCell className="px-4 py-3 text-sm font-mono text-primary dark:text-primary">
                                                    {department.code}
                                                </TableCell>
                                                <TableCell className="px-4 py-3 text-center">
                                                    <Badge variant={department.isActive ? 'default' : 'outline'}>
                                                        {department.isActive ? 'Active' : 'Inactive'}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="px-4 py-3">
                                                    <div className="flex items-center justify-center gap-2">
                                                        <Button
                                                            type="button"
                                                            size="sm"
                                                            variant="ghost"
                                                            onClick={() => handleEdit(department)}
                                                            className="h-8 w-8 p-0 text-primary hover:bg-green-50 dark:text-primary dark:hover:bg-brand-green-darker/30"
                                                            title="Edit"
                                                        >
                                                            <Pencil className="h-4 w-4" />
                                                        </Button>
                                                        {department.isActive ? (
                                                            <Button
                                                                type="button"
                                                                size="sm"
                                                                variant="ghost"
                                                                onClick={() => handleDeleteClick(department)}
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
                                                                    onClick={() => setReactivateTarget(department)}
                                                                    className="h-8 w-8 p-0 text-green-600 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-900/30"
                                                                    title="Reactivate"
                                                                >
                                                                    <RotateCcw className="h-4 w-4" />
                                                                </Button>
                                                                <Button
                                                                    type="button"
                                                                    size="sm"
                                                                    variant="ghost"
                                                                    onClick={() => handlePermanentDeleteClick(department)}
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
                    onOpenChange={(open) => setDeleteConfirmation({ open, department: null, permanent: false })}
                    onConfirm={handleDeleteConfirm}
                    title={
                        deleteConfirmation.permanent
                            ? (deleteConfirmation.department ? `Permanently delete ${deleteConfirmation.department.name}?` : 'Confirm Permanent Deletion')
                            : (deleteConfirmation.department ? `Deactivate ${deleteConfirmation.department.name}?` : 'Deactivate Department?')
                    }
                    description={
                        deleteConfirmation.department
                            ? deleteConfirmation.permanent
                                ? `Permanently delete the department "${deleteConfirmation.department.name}"? This cannot be undone.`
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
                    title={reactivateTarget ? `Reactivate ${reactivateTarget.name}?` : 'Reactivate Department?'}
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
