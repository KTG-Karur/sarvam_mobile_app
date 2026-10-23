'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';
import { PageLoader } from '@/components/ui/page-loader';
import { Loader2, Network, Save, RefreshCw, Pencil, Plus, X, Trash2 } from 'lucide-react';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';

interface Region { id: string; name: string; code: string; }
interface Manager { id: string; firstName: string; lastName: string; employeeId?: string | null; }
interface Division {
    id: string; name: string; code: string; isActive: boolean; createdAt: string;
    regionId: string;
    region: { id: string; name: string; code: string };
    _count: { areas: number };
    managers: Manager[];
}

interface FormState { name: string; regionId: string; managerId: string; }
const emptyForm: FormState = { name: '', regionId: '', managerId: '' };

export default function DivisionPage() {
    const { toast } = useToast();
    const [divisions, setDivisions] = useState<Division[]>([]);
    const [regions, setRegions] = useState<Region[]>([]);
    const [dmUsers, setDmUsers] = useState<Manager[]>([]);
    const [filterRegionId, setFilterRegionId] = useState<string>('all');
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [form, setForm] = useState<FormState>(emptyForm);
    const [togglingId, setTogglingId] = useState<string | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<Division | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const nameRef = useRef<HTMLInputElement>(null);

    const fetchAll = useCallback(async () => {
        setIsLoading(true);
        try {
            const [divRes, regRes, usersRes] = await Promise.all([
                apiClient.get('/divisions?includeInactive=true'),
                apiClient.get('/regions'),
                apiClient.get('/employees'),
            ]);
            if (divRes.success) setDivisions((divRes.data as Division[]) || []);
            if (regRes.success) setRegions((regRes.data as Region[]) || []);
            if (usersRes.success) {
                const raw = (usersRes.data as { id: string; name: string; employeeId?: string | null; role: string }[]) || [];
                setDmUsers(raw.map(u => {
                    const parts = u.name.replace(/\s*\([^)]*\)\s*$/, '').split(' ');
                    const firstName = parts[0] || '';
                    const lastName = parts.slice(1).join(' ');
                    return { id: u.id, firstName, lastName, employeeId: u.employeeId };
                }));
            }
        } catch {
            toast({ title: 'Error', description: 'Failed to load data', variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
    }, [toast]);

    useEffect(() => { fetchAll(); }, [fetchAll]);

    const filteredDivisions = filterRegionId === 'all'
        ? divisions
        : divisions.filter(d => d.regionId === filterRegionId);
    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(filteredDivisions);

    const handleEdit = (d: Division) => {
        setEditingId(d.id);
        setForm({ name: d.name, regionId: d.regionId, managerId: d.managers[0]?.id || '' });
        setShowForm(true);
        setTimeout(() => nameRef.current?.focus(), 50);
    };

    const handleNew = () => {
        setEditingId(null);
        setForm({ ...emptyForm, regionId: filterRegionId !== 'all' ? filterRegionId : '' });
        setShowForm(true);
        setTimeout(() => nameRef.current?.focus(), 50);
    };

    const handleClose = () => { setShowForm(false); setEditingId(null); setForm(emptyForm); };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.name.trim()) { toast({ title: 'Error', description: 'Division name is required', variant: 'destructive' }); return; }
        if (!form.regionId) { toast({ title: 'Error', description: 'Region is required', variant: 'destructive' }); return; }

        setIsSaving(true);
        try {
            const payload = { name: form.name.trim(), regionId: form.regionId, managerId: form.managerId || null };
            const res = editingId
                ? await apiClient.put(`/divisions/${editingId}`, payload)
                : await apiClient.post('/divisions', payload);
            if (res.success) {
                toast({ title: 'Success', description: editingId ? 'Division updated' : 'Division created' });
                handleClose(); fetchAll();
            } else {
                toast({ title: 'Error', description: res.error || 'Failed to save', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'Failed to save division', variant: 'destructive' });
        } finally {
            setIsSaving(false);
        }
    };

    const handleToggleStatus = async (d: Division) => {
        setTogglingId(d.id);
        try {
            const res = await apiClient.put(`/divisions/${d.id}`, { isActive: !d.isActive });
            if (res.success) fetchAll();
            else toast({ title: 'Error', description: res.error || 'Failed', variant: 'destructive' });
        } catch {
            toast({ title: 'Error', description: 'Failed to update status', variant: 'destructive' });
        } finally { setTogglingId(null); }
    };

    const handleDelete = async () => {
        if (!deleteTarget) return;
        setIsDeleting(true);
        try {
            const res = await apiClient.delete(`/divisions/${deleteTarget.id}`);
            if (res.success) {
                toast({ title: 'Success', description: 'Division deleted' });
                if (editingId === deleteTarget.id) handleClose();
                setDeleteTarget(null);
                fetchAll();
            } else {
                toast({ title: 'Error', description: res.error || 'Failed to delete division', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'Failed to delete division', variant: 'destructive' });
        } finally {
            setIsDeleting(false);
        }
    };

    return (
        <div className="p-6 space-y-6">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-primary/10 dark:bg-brand-green-darker/30 rounded-lg">
                        <Network className="h-6 w-6 text-primary dark:text-primary" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-foreground dark:text-slate-100">Division Management</h1>
                        <p className="text-sm text-slate-500 dark:text-slate-400">Manage divisions within regions</p>
                    </div>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={fetchAll} disabled={isLoading}>
                        <RefreshCw className={`h-4 w-4 mr-1 ${isLoading ? 'animate-spin' : ''}`} />
                        Refresh
                    </Button>
                    <Button onClick={handleNew} className="bg-primary hover:bg-sidebar-accent text-white">
                        <Plus className="h-4 w-4 mr-1" />
                        Add Division
                    </Button>
                </div>
            </div>

            {/* Filter */}
            <div className="flex flex-wrap items-center gap-3">
                <Label className="text-xs text-sidebar-accent dark:text-slate-400 whitespace-nowrap">Filter by Region:</Label>
                <Select value={filterRegionId} onValueChange={setFilterRegionId}>
                    <SelectTrigger className="w-52">
                        <SelectValue placeholder="All Regions" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Regions</SelectItem>
                        {regions.map(r => <SelectItem key={r.id} value={r.id}>{r.name} ({r.code})</SelectItem>)}
                    </SelectContent>
                </Select>
                <TableSearchInput
                    value={tableSearchQuery}
                    onChange={setTableSearchQuery}
                    placeholder="Search divisions..."
                    className="ml-auto"
                />
            </div>

            {showForm && (
                <Card className="border-primary dark:border-primary shadow-md">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base font-semibold text-sidebar-accent dark:text-slate-200 flex items-center justify-between">
                            {editingId ? 'Edit Division' : 'Add New Division'}
                            <Button variant="ghost" size="sm" onClick={handleClose} className="h-7 w-7 p-0"><X className="h-4 w-4" /></Button>
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            <div className="space-y-1">
                                <Label htmlFor="dName" className="text-xs">Division Name</Label>
                                <Input id="dName" ref={nameRef} value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. North Division" required />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs">Region</Label>
                                <Select value={form.regionId} onValueChange={v => setForm(p => ({ ...p, regionId: v }))}>
                                    <SelectTrigger><SelectValue placeholder="Select Region" /></SelectTrigger>
                                    <SelectContent>
                                        {regions.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs">Division Manager (optional)</Label>
                                <Select value={form.managerId} onValueChange={v => setForm(p => ({ ...p, managerId: v === 'none' ? '' : v }))}>
                                    <SelectTrigger><SelectValue placeholder="Assign Manager" /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="none">None</SelectItem>
                                        {dmUsers.map(u => <SelectItem key={u.id} value={u.id}>{u.firstName} {u.lastName}{u.employeeId ? ` (${u.employeeId})` : ''}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="sm:col-span-3 flex gap-2 justify-end">
                                <Button type="button" variant="outline" onClick={handleClose}>Cancel</Button>
                                <Button type="submit" disabled={isSaving} className="bg-primary hover:bg-sidebar-accent text-white">
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
                        Divisions ({searchedRows.length})
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    {isLoading ? (
                        <PageLoader fullScreen={false} />
                    ) : searchedRows.length === 0 ? (
                        <div className="text-center py-10 text-slate-500 text-sm">No divisions found.</div>
                    ) : (
                        <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-green-50 dark:bg-sidebar-accent/50">
                                    <TableHead>Name</TableHead>
                                    <TableHead>Region</TableHead>
                                    <TableHead className="text-center">Areas</TableHead>
                                    <TableHead>Manager</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {searchedRows.map(d => (
                                    <TableRow key={d.id} className="hover:bg-green-50 dark:hover:bg-sidebar-accent/30">
                                        <TableCell className="font-medium">{d.name}</TableCell>
                                        <TableCell className="text-sm">{d.region.name}</TableCell>
                                        <TableCell className="text-center text-sm">{d._count.areas}</TableCell>
                                        <TableCell className="text-sm text-sidebar-accent">
                                            {d.managers[0] ? `${d.managers[0].firstName} ${d.managers[0].lastName}` : <span className="text-slate-400 italic">Unassigned</span>}
                                        </TableCell>
                                        <TableCell>
                                            <button onClick={() => handleToggleStatus(d)} disabled={togglingId === d.id} className="inline-flex items-center gap-1">
                                                {togglingId === d.id ? <Loader2 className="h-3 w-3 animate-spin text-slate-400" /> :
                                                    d.isActive
                                                        ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 hover:bg-green-200 transition-colors">Active</span>
                                                        : <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-brand-green-tint text-slate-500 hover:bg-brand-green-tint transition-colors">Inactive</span>
                                                }
                                            </button>
                                        </TableCell>
                                        <TableCell className="whitespace-nowrap">
                                            <Button variant="ghost" size="sm" onClick={() => handleEdit(d)} className="h-7 w-7 p-0 text-slate-500 hover:text-primary">
                                                <Pencil className="h-3.5 w-3.5" />
                                            </Button>
                                            <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(d)} className="h-7 w-7 p-0 text-slate-500 hover:text-red-600" title="Delete">
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
                title="Delete Division"
                description={`Are you sure you want to delete ${deleteTarget?.name ?? 'this division'} (${deleteTarget?.code ?? ''})? This cannot be undone.`}
                confirmText="Delete"
                type="delete"
                isLoading={isDeleting}
            />
        </div>
    );
}
