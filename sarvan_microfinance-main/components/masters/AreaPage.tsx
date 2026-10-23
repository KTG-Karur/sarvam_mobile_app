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
import { Loader2, FolderTree, Save, RefreshCw, Pencil, Plus, X, Trash2 } from 'lucide-react';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';

interface Region { id: string; name: string; code: string; }
interface Division { id: string; name: string; code: string; regionId: string; region: { name: string }; }
interface Area {
    id: string; name: string; code: string; isActive: boolean;
    divisionId: string;
    division: { id: string; name: string; code: string; region: { id: string; name: string; code: string } };
    _count: { branches: number };
}

interface FormState { name: string; divisionId: string; }
const emptyForm: FormState = { name: '', divisionId: '' };

export default function AreaPage() {
    const { toast } = useToast();
    const [areas, setAreas] = useState<Area[]>([]);
    const [regions, setRegions] = useState<Region[]>([]);
    const [divisions, setDivisions] = useState<Division[]>([]);
    const [filterRegionId, setFilterRegionId] = useState<string>('all');
    const [filterDivisionId, setFilterDivisionId] = useState<string>('all');
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [form, setForm] = useState<FormState>(emptyForm);
    const [togglingId, setTogglingId] = useState<string | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<Area | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const nameRef = useRef<HTMLInputElement>(null);

    const fetchAll = useCallback(async () => {
        setIsLoading(true);
        try {
            const [areaRes, regRes, divRes] = await Promise.all([
                apiClient.get('/areas?includeInactive=true'),
                apiClient.get('/regions'),
                apiClient.get('/divisions'),
            ]);
            if (areaRes.success) setAreas((areaRes.data as Area[]) || []);
            if (regRes.success) setRegions((regRes.data as Region[]) || []);
            if (divRes.success) setDivisions((divRes.data as Division[]) || []);
        } catch {
            toast({ title: 'Error', description: 'Failed to load data', variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
    }, [toast]);

    useEffect(() => { fetchAll(); }, [fetchAll]);

    const visibleDivisions = filterRegionId === 'all'
        ? divisions
        : divisions.filter(d => d.regionId === filterRegionId);

    const filteredAreas = areas.filter(a => {
        if (filterRegionId !== 'all' && a.division.region.id !== filterRegionId) return false;
        if (filterDivisionId !== 'all' && a.divisionId !== filterDivisionId) return false;
        return true;
    });
    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(filteredAreas);

    const handleEdit = (a: Area) => {
        setEditingId(a.id);
        setForm({ name: a.name, divisionId: a.divisionId });
        setShowForm(true);
        setTimeout(() => nameRef.current?.focus(), 50);
    };

    const handleNew = () => {
        setEditingId(null);
        setForm({ ...emptyForm, divisionId: filterDivisionId !== 'all' ? filterDivisionId : '' });
        setShowForm(true);
        setTimeout(() => nameRef.current?.focus(), 50);
    };

    const handleClose = () => { setShowForm(false); setEditingId(null); setForm(emptyForm); };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.name.trim()) { toast({ title: 'Error', description: 'Area name is required', variant: 'destructive' }); return; }
        if (!form.divisionId) { toast({ title: 'Error', description: 'Division is required', variant: 'destructive' }); return; }

        setIsSaving(true);
        try {
            const res = editingId
                ? await apiClient.put(`/areas/${editingId}`, form)
                : await apiClient.post('/areas', form);
            if (res.success) {
                toast({ title: 'Success', description: editingId ? 'Area updated' : 'Area created' });
                handleClose(); fetchAll();
            } else {
                toast({ title: 'Error', description: res.error || 'Failed to save', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'Failed to save area', variant: 'destructive' });
        } finally {
            setIsSaving(false);
        }
    };

    const handleToggleStatus = async (a: Area) => {
        setTogglingId(a.id);
        try {
            const res = await apiClient.put(`/areas/${a.id}`, { isActive: !a.isActive });
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
            const res = await apiClient.delete(`/areas/${deleteTarget.id}`);
            if (res.success) {
                toast({ title: 'Success', description: 'Area deleted' });
                if (editingId === deleteTarget.id) handleClose();
                setDeleteTarget(null);
                fetchAll();
            } else {
                toast({ title: 'Error', description: res.error || 'Failed to delete area', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'Failed to delete area', variant: 'destructive' });
        } finally {
            setIsDeleting(false);
        }
    };

    return (
        <div className="p-6 space-y-6">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg">
                        <FolderTree className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-foreground dark:text-slate-100">Area Management</h1>
                        <p className="text-sm text-slate-500 dark:text-slate-400">Manage areas within divisions</p>
                    </div>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={fetchAll} disabled={isLoading}>
                        <RefreshCw className={`h-4 w-4 mr-1 ${isLoading ? 'animate-spin' : ''}`} />
                        Refresh
                    </Button>
                    <Button onClick={handleNew} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                        <Plus className="h-4 w-4 mr-1" />
                        Add Area
                    </Button>
                </div>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2">
                    <Label className="text-xs text-sidebar-accent whitespace-nowrap">Region:</Label>
                    <Select value={filterRegionId} onValueChange={v => { setFilterRegionId(v); setFilterDivisionId('all'); }}>
                        <SelectTrigger className="w-44"><SelectValue placeholder="All Regions" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Regions</SelectItem>
                            {regions.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>
                <div className="flex items-center gap-2">
                    <Label className="text-xs text-sidebar-accent whitespace-nowrap">Division:</Label>
                    <Select value={filterDivisionId} onValueChange={setFilterDivisionId}>
                        <SelectTrigger className="w-44"><SelectValue placeholder="All Divisions" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Divisions</SelectItem>
                            {visibleDivisions.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>
                <TableSearchInput
                    value={tableSearchQuery}
                    onChange={setTableSearchQuery}
                    placeholder="Search areas..."
                    className="ml-auto"
                />
            </div>

            {showForm && (
                <Card className="border-emerald-200 dark:border-emerald-800 shadow-md">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base font-semibold text-sidebar-accent dark:text-slate-200 flex items-center justify-between">
                            {editingId ? 'Edit Area' : 'Add New Area'}
                            <Button variant="ghost" size="sm" onClick={handleClose} className="h-7 w-7 p-0"><X className="h-4 w-4" /></Button>
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
                            <div className="space-y-1">
                                <Label htmlFor="aName" className="text-xs">Area Name</Label>
                                <Input id="aName" ref={nameRef} value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Coimbatore Area" required />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs">Division</Label>
                                <Select value={form.divisionId} onValueChange={v => setForm(p => ({ ...p, divisionId: v }))}>
                                    <SelectTrigger><SelectValue placeholder="Select Division" /></SelectTrigger>
                                    <SelectContent>
                                        {divisions.map(d => <SelectItem key={d.id} value={d.id}>{d.name} ({d.region.name})</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="sm:col-span-2 flex gap-2 justify-end">
                                <Button type="button" variant="outline" onClick={handleClose}>Cancel</Button>
                                <Button type="submit" disabled={isSaving} className="bg-emerald-600 hover:bg-emerald-700 text-white">
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
                        Areas ({searchedRows.length})
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    {isLoading ? (
                        <PageLoader fullScreen={false} />
                    ) : searchedRows.length === 0 ? (
                        <div className="text-center py-10 text-slate-500 text-sm">No areas found.</div>
                    ) : (
                        <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-green-50 dark:bg-sidebar-accent/50">
                                    <TableHead>Name</TableHead>
                                    <TableHead>Division</TableHead>
                                    <TableHead>Region</TableHead>
                                    <TableHead className="text-center">Branches</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {searchedRows.map(a => (
                                    <TableRow key={a.id} className="hover:bg-green-50 dark:hover:bg-sidebar-accent/30">
                                        <TableCell className="font-medium">{a.name}</TableCell>
                                        <TableCell className="text-sm">{a.division.name}</TableCell>
                                        <TableCell className="text-sm text-slate-500">{a.division.region.name}</TableCell>
                                        <TableCell className="text-center text-sm">{a._count.branches}</TableCell>
                                        <TableCell>
                                            <button onClick={() => handleToggleStatus(a)} disabled={togglingId === a.id} className="inline-flex items-center gap-1">
                                                {togglingId === a.id ? <Loader2 className="h-3 w-3 animate-spin text-slate-400" /> :
                                                    a.isActive
                                                        ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 hover:bg-green-200 transition-colors">Active</span>
                                                        : <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-brand-green-tint text-slate-500 hover:bg-brand-green-tint transition-colors">Inactive</span>
                                                }
                                            </button>
                                        </TableCell>
                                        <TableCell className="whitespace-nowrap">
                                            <Button variant="ghost" size="sm" onClick={() => handleEdit(a)} className="h-7 w-7 p-0 text-slate-500 hover:text-emerald-600">
                                                <Pencil className="h-3.5 w-3.5" />
                                            </Button>
                                            <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(a)} className="h-7 w-7 p-0 text-slate-500 hover:text-red-600" title="Delete">
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
                title="Delete Area"
                description={`Are you sure you want to delete ${deleteTarget?.name ?? 'this area'} (${deleteTarget?.code ?? ''})? This cannot be undone.`}
                confirmText="Delete"
                type="delete"
                isLoading={isDeleting}
            />
        </div>
    );
}
