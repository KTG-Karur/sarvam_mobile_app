'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';
import { Loader2, Map, Save, RefreshCw, Pencil, Plus, X, Trash2 } from 'lucide-react';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { PageLoader } from '@/components/ui/page-loader';

interface Region {
    id: string;
    name: string;
    code: string;
    isActive: boolean;
    createdAt: string;
    _count: { divisions: number };
}

interface FormState {
    name: string;
    code: string;
}

const emptyForm: FormState = { name: '', code: '' };

export default function RegionPage() {
    const { toast } = useToast();
    const [regions, setRegions] = useState<Region[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [form, setForm] = useState<FormState>(emptyForm);
    const [togglingId, setTogglingId] = useState<string | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<Region | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const nameRef = useRef<HTMLInputElement>(null);

    const fetchRegions = useCallback(async () => {
        setIsLoading(true);
        try {
            const res = await apiClient.get('/regions?includeInactive=true');
            if (res.success) setRegions((res.data as Region[]) || []);
        } catch {
            toast({ title: 'Error', description: 'Failed to fetch regions', variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
    }, [toast]);

    useEffect(() => { fetchRegions(); }, [fetchRegions]);

    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(regions);

    const handleEdit = (region: Region) => {
        setEditingId(region.id);
        setForm({ name: region.name, code: region.code });
        setShowForm(true);
        setTimeout(() => nameRef.current?.focus(), 50);
    };

    const handleNew = () => {
        setEditingId(null);
        setForm(emptyForm);
        setShowForm(true);
        setTimeout(() => nameRef.current?.focus(), 50);
    };

    const handleClose = () => {
        setShowForm(false);
        setEditingId(null);
        setForm(emptyForm);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.name.trim()) {
            toast({ title: 'Validation Error', description: 'Region name is required', variant: 'destructive' });
            return;
        }
        if (!form.code.trim()) {
            toast({ title: 'Validation Error', description: 'Region code is required', variant: 'destructive' });
            return;
        }
        setIsSaving(true);
        try {
            const res = editingId
                ? await apiClient.put(`/regions/${editingId}`, form)
                : await apiClient.post('/regions', form);
            if (res.success) {
                toast({ title: 'Success', description: editingId ? 'Region updated' : 'Region created' });
                handleClose();
                fetchRegions();
            } else {
                toast({ title: 'Error', description: res.error || 'Failed to save', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'Failed to save region', variant: 'destructive' });
        } finally {
            setIsSaving(false);
        }
    };

    const handleToggleStatus = async (region: Region) => {
        setTogglingId(region.id);
        try {
            const res = await apiClient.put(`/regions/${region.id}`, { isActive: !region.isActive });
            if (res.success) fetchRegions();
            else toast({ title: 'Error', description: res.error || 'Failed to update status', variant: 'destructive' });
        } catch {
            toast({ title: 'Error', description: 'Failed to update status', variant: 'destructive' });
        } finally {
            setTogglingId(null);
        }
    };

    const handleDelete = async () => {
        if (!deleteTarget) return;
        setIsDeleting(true);
        try {
            const res = await apiClient.delete(`/regions/${deleteTarget.id}`);
            if (res.success) {
                toast({ title: 'Success', description: 'Region deleted' });
                if (editingId === deleteTarget.id) handleClose();
                setDeleteTarget(null);
                fetchRegions();
            } else {
                toast({ title: 'Error', description: res.error || 'Failed to delete region', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'Failed to delete region', variant: 'destructive' });
        } finally {
            setIsDeleting(false);
        }
    };

    return (
        <div className="p-6 space-y-6">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-brand-green-tint dark:bg-brand-green-darker/30 rounded-lg">
                        <Map className="h-6 w-6 text-primary dark:text-primary" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-foreground dark:text-slate-100">Region Management</h1>
                        <p className="text-sm text-slate-500 dark:text-slate-400">Top-level geographic regions</p>
                    </div>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={fetchRegions} disabled={isLoading}>
                        <RefreshCw className={`h-4 w-4 mr-1 ${isLoading ? 'animate-spin' : ''}`} />
                        Refresh
                    </Button>
                    <Button onClick={handleNew} className="bg-primary hover:bg-primary text-white">
                        <Plus className="h-4 w-4 mr-1" />
                        Add Region
                    </Button>
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-4">
                <TableSearchInput
                    value={tableSearchQuery}
                    onChange={setTableSearchQuery}
                    placeholder="Search regions..."
                    className="ml-auto"
                />
            </div>

            {showForm && (
                <Card className="border-primary/30 dark:border-sidebar-accent shadow-md">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base font-semibold text-sidebar-accent dark:text-slate-200 flex items-center justify-between">
                            {editingId ? 'Edit Region' : 'Add New Region'}
                            <Button variant="ghost" size="sm" onClick={handleClose} className="h-7 w-7 p-0">
                                <X className="h-4 w-4" />
                            </Button>
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-4 items-end">
                            <div className="space-y-1 flex-1">
                                <Label htmlFor="rName" className="text-xs">Region Name</Label>
                                <Input id="rName" ref={nameRef} value={form.name} onChange={(e) => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. South Zone" required />
                            </div>
                            <div className="space-y-1 w-36">
                                <Label htmlFor="rCode" className="text-xs">Code</Label>
                                <Input id="rCode" value={form.code} onChange={(e) => setForm(p => ({ ...p, code: e.target.value.toUpperCase() }))} placeholder="e.g. SZ" required />
                            </div>
                            <div className="flex gap-2">
                                <Button type="button" variant="outline" onClick={handleClose}>Cancel</Button>
                                <Button type="submit" disabled={isSaving} className="bg-primary hover:bg-primary text-white">
                                    {isSaving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
                                    {editingId ? 'Update' : 'Create'}
                                </Button>
                            </div>
                        </form>
                    </CardContent>
                </Card>
            )}

            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="text-base font-semibold text-sidebar-accent dark:text-slate-200">
                        All Regions ({searchedRows.length})
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    {isLoading ? (
                        <PageLoader fullScreen={false} />
                    ) : searchedRows.length === 0 ? (
                        <div className="text-center py-10 text-slate-500 text-sm">No regions found. Add your first region.</div>
                    ) : (
                        <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-green-50 dark:bg-sidebar-accent/50">
                                    <TableHead>Name</TableHead>
                                    <TableHead>Code</TableHead>
                                    <TableHead className="text-center">Divisions</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {searchedRows.map((r) => (
                                    <TableRow key={r.id} className="hover:bg-green-50 dark:hover:bg-sidebar-accent/30">
                                        <TableCell className="font-medium">{r.name}</TableCell>
                                        <TableCell className="font-mono text-sm text-sidebar-accent">{r.code}</TableCell>
                                        <TableCell className="text-center text-sm">{r._count.divisions}</TableCell>
                                        <TableCell>
                                            <button
                                                onClick={() => handleToggleStatus(r)}
                                                disabled={togglingId === r.id}
                                                className="inline-flex items-center gap-1"
                                                title={r.isActive ? 'Click to deactivate' : 'Click to activate'}
                                            >
                                                {togglingId === r.id ? <Loader2 className="h-3 w-3 animate-spin text-slate-400" /> :
                                                    r.isActive
                                                        ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 hover:bg-green-200 transition-colors">Active</span>
                                                        : <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-brand-green-tint text-slate-500 hover:bg-brand-green-tint transition-colors">Inactive</span>
                                                }
                                            </button>
                                        </TableCell>
                                        <TableCell className="whitespace-nowrap">
                                            <Button variant="ghost" size="sm" onClick={() => handleEdit(r)} className="h-7 w-7 p-0 text-slate-500 hover:text-primary" title="Edit">
                                                <Pencil className="h-3.5 w-3.5" />
                                            </Button>
                                            <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(r)} className="h-7 w-7 p-0 text-slate-500 hover:text-red-600" title="Delete">
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                        </div>
                    )}
                </CardContent>
            </Card>

            <ConfirmationDialog
                open={deleteTarget !== null}
                onOpenChange={(open) => { if (!open && !isDeleting) setDeleteTarget(null); }}
                onConfirm={handleDelete}
                title="Delete Region"
                description={`Are you sure you want to delete ${deleteTarget?.name ?? 'this region'} (${deleteTarget?.code ?? ''})? This cannot be undone.`}
                confirmText="Delete"
                type="delete"
                isLoading={isDeleting}
            />
        </div>
    );
}
