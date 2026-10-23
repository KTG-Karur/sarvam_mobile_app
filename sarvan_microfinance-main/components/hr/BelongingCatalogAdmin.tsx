'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
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
import { Backpack, Save, RefreshCw, CheckSquare, Trash2 } from 'lucide-react';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { apiClient } from '@/app/lib/api-client';
import { PageLoader } from '@/components/ui/page-loader';
import { ApiResponse } from '@/app/types';
import { Checkbox } from '@/components/ui/checkbox';

type Role = { id: string; slug: string; name: string };
type BelongingItem = { id: string; roleSlug: string; itemName: string; description: string | null; isActive: boolean };

export function BelongingCatalogAdmin() {
    const { toast } = useToast();
    const [items, setItems] = useState<BelongingItem[]>([]);
    const [roles, setRoles] = useState<Role[]>([]);
    const [itemName, setItemName] = useState('');
    const [description, setDescription] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isInitialLoading, setIsInitialLoading] = useState(true);

    // Matrix state: map of `${roleSlug}:::${itemName.toLowerCase()}` -> boolean
    const [matrixDraft, setMatrixDraft] = useState<Record<string, boolean>>({});
    // Description state: keyed by item name (lowercased) — one description per
    // item name shared across every role's row for that name, since the matrix
    // presents a single row per name spanning all roles.
    const [descriptionDraft, setDescriptionDraft] = useState<Record<string, string>>({});
    const [isSavingMatrix, setIsSavingMatrix] = useState(false);
    const [bulkDeactivateConfirmOpen, setBulkDeactivateConfirmOpen] = useState(false);
    const [removeTarget, setRemoveTarget] = useState<string | null>(null);
    const [isRemoving, setIsRemoving] = useState(false);

    // Auto-derive distinct item names (case-insensitive dedup, sorted A-Z)
    const distinctItemNames = useMemo(() => {
        const seen = new Map<string, string>(); // lower -> canonical display
        for (const item of items) {
            const lower = item.itemName.trim().toLowerCase();
            if (!seen.has(lower)) {
                seen.set(lower, item.itemName.trim());
            }
        }
        return Array.from(seen.values()).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    }, [items]);

    // Active DB state key helper
    const makeKey = (roleSlug: string, itemName: string) => `${roleSlug.trim()}:::${itemName.trim().toLowerCase()}`;

    // Map of currently active items in DB
    const activeDbKeys = useMemo(() => {
        const s = new Set<string>();
        for (const item of items) {
            if (item.isActive) {
                s.add(makeKey(item.roleSlug, item.itemName));
            }
        }
        return s;
    }, [items]);

    // Canonical description per item name — the first non-empty description
    // found among that name's rows across all roles.
    const canonicalDescriptions = useMemo(() => {
        const map: Record<string, string> = {};
        for (const name of distinctItemNames) {
            const lower = name.toLowerCase();
            const match = items.find((i) => i.itemName.trim().toLowerCase() === lower && i.description);
            map[lower] = match?.description ?? '';
        }
        return map;
    }, [items, distinctItemNames]);

    // Initialize/sync matrixDraft + descriptionDraft whenever items change (preserving draft or resetting to DB)
    useEffect(() => {
        const initial: Record<string, boolean> = {};
        for (const role of roles) {
            for (const name of distinctItemNames) {
                const k = makeKey(role.slug, name);
                initial[k] = activeDbKeys.has(k);
            }
        }
        setMatrixDraft(initial);

        const descInitial: Record<string, string> = {};
        for (const name of distinctItemNames) {
            descInitial[name.toLowerCase()] = canonicalDescriptions[name.toLowerCase()] ?? '';
        }
        setDescriptionDraft(descInitial);
    }, [roles, distinctItemNames, activeDbKeys, canonicalDescriptions]);

    const handleToggleCell = (roleSlug: string, itemName: string) => {
        const k = makeKey(roleSlug, itemName);
        setMatrixDraft((prev) => ({
            ...prev,
            [k]: !prev[k],
        }));
    };

    // Calculate diff between matrixDraft and activeDbKeys
    const matrixDiff = useMemo(() => {
        let toActivate = 0;
        let toDeactivate = 0;
        let unchanged = 0;
        const assignments: { roleSlug: string; itemName: string; active: boolean }[] = [];

        for (const role of roles) {
            for (const name of distinctItemNames) {
                const k = makeKey(role.slug, name);
                const isDraftChecked = !!matrixDraft[k];
                const isDbActive = activeDbKeys.has(k);

                if (isDraftChecked && !isDbActive) {
                    toActivate++;
                    assignments.push({ roleSlug: role.slug, itemName: name, active: true });
                } else if (!isDraftChecked && isDbActive) {
                    toDeactivate++;
                    assignments.push({ roleSlug: role.slug, itemName: name, active: false });
                } else {
                    unchanged++;
                }
            }
        }

        return {
            toActivate,
            toDeactivate,
            unchanged,
            hasChanges: toActivate > 0 || toDeactivate > 0,
            assignments,
        };
    }, [roles, distinctItemNames, matrixDraft, activeDbKeys]);

    // Which item names have an edited description vs. their canonical value
    const descriptionDiff = useMemo(() => {
        const changed: { itemName: string; description: string | null }[] = [];
        for (const name of distinctItemNames) {
            const lower = name.toLowerCase();
            const draftVal = (descriptionDraft[lower] ?? '').trim();
            const canonicalVal = (canonicalDescriptions[lower] ?? '').trim();
            if (draftVal !== canonicalVal) {
                changed.push({ itemName: name, description: draftVal || null });
            }
        }
        return changed;
    }, [distinctItemNames, descriptionDraft, canonicalDescriptions]);

    const hasAnyChanges = matrixDiff.hasChanges || descriptionDiff.length > 0;

    // Item names with zero active rows across every role — the matrix has no
    // other way to get rid of these (they were only ever soft-deactivated),
    // so this is the sole path left to actually remove a dead row.
    const fullyInactiveNames = useMemo(() => {
        const s = new Set<string>();
        for (const name of distinctItemNames) {
            const lower = name.toLowerCase();
            const rows = items.filter((i) => i.itemName.trim().toLowerCase() === lower);
            if (rows.length > 0 && rows.every((i) => !i.isActive)) s.add(lower);
        }
        return s;
    }, [items, distinctItemNames]);

    const handleRemoveConfirm = async () => {
        if (!removeTarget) return;
        setIsRemoving(true);
        try {
            const lower = removeTarget.toLowerCase();
            const matchingIds = items.filter((i) => i.itemName.trim().toLowerCase() === lower).map((i) => i.id);
            const results = await Promise.all(
                matchingIds.map((id) => apiClient.delete(`/hr/belongings/catalog?id=${id}&permanent=true`))
            );
            const failedCount = results.filter((r) => !r.success).length;
            if (failedCount === results.length) {
                throw new Error(results[0]?.error || 'Failed to remove item.');
            } else if (failedCount > 0) {
                toast({
                    title: 'Partially Removed',
                    description: `${results.length - failedCount} of ${results.length} row(s) removed; ${failedCount} blocked (still referenced by issuance records).`,
                });
            } else {
                toast({ title: 'Removed', description: `"${removeTarget}" permanently removed from the catalog.` });
            }
            setRemoveTarget(null);
            await fetchAll();
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Failed to remove item.';
            toast({ title: 'Error', description: message, variant: 'destructive' });
        } finally {
            setIsRemoving(false);
        }
    };

    const handleBulkSaveClick = () => {
        if (!hasAnyChanges) return;
        if (matrixDiff.toDeactivate > 0) {
            setBulkDeactivateConfirmOpen(true);
        } else {
            executeBulkSave();
        }
    };

    const executeBulkSave = async () => {
        setIsSavingMatrix(true);
        try {
            const res = await apiClient.put<{ activated: number; deactivated: number; unchanged: number; descriptionsUpdated: number }>(
                '/hr/belongings/catalog/bulk',
                { assignments: matrixDiff.assignments, descriptions: descriptionDiff }
            );
            if (res.success && res.data) {
                const descSuffix = res.data.descriptionsUpdated > 0 ? `, ${res.data.descriptionsUpdated} description(s) updated` : '';
                toast({
                    title: 'Matrix Updated',
                    description: `Activated ${res.data.activated}, Deactivated ${res.data.deactivated}, ${res.data.unchanged} unchanged${descSuffix}.`,
                });
                setBulkDeactivateConfirmOpen(false);
                await fetchAll();
            } else {
                throw new Error(res.error || 'Failed to update catalog assignments');
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Failed to save matrix.';
            toast({
                title: 'Error',
                description: message,
                variant: 'destructive',
            });
        } finally {
            setIsSavingMatrix(false);
        }
    };

    const fetchAll = useCallback(async () => {
        try {
            const [itemsRes, rolesRes] = await Promise.all([
                apiClient.get<BelongingItem[]>('/hr/belongings/catalog?includeInactive=true'),
                // /api/admin/roles predates the { success, data } convention and returns
                // { success, roles } instead — cast to reflect the actual response shape
                // rather than the generic's assumed `data` field.
                apiClient.get<Role[]>('/admin/roles') as Promise<ApiResponse<Role[]> & { roles?: Role[] }>,
            ]);
            if (itemsRes.success && itemsRes.data) setItems(itemsRes.data);
            if (rolesRes.success && rolesRes.roles) setRoles(rolesRes.roles);
        } catch {
            toast({ title: 'Error', description: 'Failed to fetch belonging catalog.', variant: 'destructive' });
        } finally {
            setIsInitialLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        fetchAll();
    }, [fetchAll]);

    const handleReset = () => {
        setItemName('');
        setDescription('');
    };

    // No role picker here anymore — registering an item just introduces its
    // name into the matrix (seeded via one arbitrary role, inactive
    // everywhere) so it's visible to tick on for whichever roles actually
    // need it. Per-role activation happens exclusively in the Matrix below.
    const handleSave = async () => {
        if (!itemName.trim()) {
            toast({ title: 'Validation Error', description: 'Item name is required.', variant: 'destructive' });
            return;
        }
        if (roles.length === 0) {
            toast({ title: 'Error', description: 'No roles available to register this item under.', variant: 'destructive' });
            return;
        }
        setIsLoading(true);
        try {
            const payload = {
                roleSlug: roles[0].slug,
                itemName: itemName.trim(),
                description: description.trim() || null,
                isActive: false,
            };
            const res = await apiClient.post('/hr/belongings/catalog', payload);
            if (res.success) {
                toast({
                    title: 'Created',
                    description: `Belonging item "${payload.itemName}" added — tick it on for the roles that need it in the matrix below.`,
                });
                handleReset();
                await fetchAll();
            } else {
                throw new Error(res.error || 'Save failed');
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Save failed.';
            toast({ title: 'Error', description: message, variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
    };

    if (isInitialLoading) {
        return <PageLoader label="Loading Belonging Catalog..." fullScreen={false} />;
    }

    return (
        <div className="relative min-h-screen">
            <div className="mx-auto max-w-6xl space-y-6">
                <div className="mb-8 flex items-center gap-4 mt-4">
                    <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary shadow-lg shadow-primary/30">
                        <Backpack className="h-7 w-7 text-white" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-foreground dark:text-white">Belonging Item Catalog</h1>
                        <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                            Define per-role belonging items (e.g. FDO → collection bag, ID card).
                        </p>
                    </div>
                </div>

                {/* ── Section 1: Register New Item ── */}
                <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                    <CardHeader className="bg-gradient-to-r from-primary via-primary to-purple-600 px-5 py-2.5">
                        <CardTitle className="text-base font-semibold text-white flex items-center gap-2">
                            <Save className="h-4 w-4" />
                            Register New Item
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4">
                        <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                            <div className="flex-1 space-y-1.5">
                                <Label className="text-xs">Item Name</Label>
                                <Input value={itemName} onChange={(e) => setItemName(e.target.value)} placeholder="e.g. Collection Bag" className="h-9 text-sm" />
                            </div>
                            <div className="flex-1 space-y-1.5">
                                <Label className="text-xs">Description (optional)</Label>
                                <Input value={description} onChange={(e) => setDescription(e.target.value)} className="h-9 text-sm" />
                            </div>
                            <div className="flex gap-2 shrink-0">
                                <Button onClick={handleSave} disabled={isLoading} size="sm" className="h-9 w-24 bg-primary text-white">
                                    <Save className="h-3.5 w-3.5 mr-1.5" />
                                    Save
                                </Button>
                                <Button onClick={handleReset} variant="outline" size="sm" className="h-9 w-24">
                                    <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                                    Reset
                                </Button>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* ── Section 2: Role-Item Assignment Matrix ── */}
                <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40 overflow-hidden">
                    <CardHeader className="bg-gradient-to-r from-primary via-primary to-purple-600 px-8 py-6 flex flex-row items-center justify-between gap-4 flex-wrap">
                        <div className="space-y-1">
                            <CardTitle className="text-xl font-semibold text-white flex items-center gap-2">
                                <CheckSquare className="h-6 w-6" />
                                Role-Item Assignment Matrix
                            </CardTitle>
                            <p className="text-xs text-green-100 dark:text-slate-300">
                                Tick the items that should be active for each role, and edit descriptions here. Changes take effect on Save.
                            </p>
                        </div>
                        <div className="flex items-center gap-3">
                            <span className="text-xs font-medium text-white/90 bg-white/20 px-2.5 py-1 rounded-full border border-white/30">
                                {hasAnyChanges ? (
                                    <>
                                        Activate {matrixDiff.toActivate}, Deactivate {matrixDiff.toDeactivate}, {matrixDiff.unchanged} unchanged
                                        {descriptionDiff.length > 0 && `, ${descriptionDiff.length} description edit(s)`}
                                    </>
                                ) : (
                                    'All items in sync'
                                )}
                            </span>
                            <Button
                                onClick={handleBulkSaveClick}
                                disabled={!hasAnyChanges || isSavingMatrix}
                                size="sm"
                                className="bg-white text-primary hover:bg-slate-100 font-semibold shadow-sm"
                            >
                                <Save className="h-4 w-4 mr-1.5" />
                                {isSavingMatrix ? 'Saving...' : 'Save Matrix'}
                            </Button>
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                        {distinctItemNames.length === 0 || roles.length === 0 ? (
                            <div className="p-8 text-center text-slate-500 text-sm">
                                No items or roles found to populate the matrix. Register an item above first.
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow className="bg-green-50/50 dark:bg-brand-green-darker/50">
                                            <TableHead className="sticky left-0 bg-green-50 dark:bg-brand-green-darker z-10 min-w-[200px] font-semibold text-slate-900 dark:text-white py-4">
                                                Item Name
                                            </TableHead>
                                            <TableHead className="sticky left-[200px] bg-green-50 dark:bg-brand-green-darker z-10 min-w-[260px] font-semibold text-slate-900 dark:text-white border-r border-slate-200 dark:border-sidebar-accent py-4">
                                                Description
                                            </TableHead>
                                            {roles.map((role) => (
                                                <TableHead key={role.id} className="text-center min-w-[130px] font-semibold text-slate-800 dark:text-slate-200 py-4">
                                                    <div className="flex flex-col items-center">
                                                        <span>{role.name}</span>
                                                        <span className="text-[10px] font-mono text-slate-400 font-normal">({role.slug})</span>
                                                    </div>
                                                </TableHead>
                                            ))}
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {distinctItemNames.map((name) => {
                                            const lower = name.toLowerCase();
                                            return (
                                                <TableRow key={name} className="hover:bg-green-50/30 dark:hover:bg-brand-green-darker/20">
                                                    <TableCell className="sticky left-0 bg-white dark:bg-brand-green-darker/90 z-10 font-medium text-slate-900 dark:text-slate-100 border-r border-slate-100 dark:border-sidebar-accent py-3.5">
                                                        <div className="flex items-center justify-between gap-2">
                                                            <span>{name}</span>
                                                            {fullyInactiveNames.has(lower) && (
                                                                <Button
                                                                    size="sm"
                                                                    variant="ghost"
                                                                    onClick={() => setRemoveTarget(name)}
                                                                    className="h-6 w-6 p-0 text-red-600 shrink-0"
                                                                    title="Remove permanently (inactive for every role)"
                                                                >
                                                                    <Trash2 className="h-3.5 w-3.5" />
                                                                </Button>
                                                            )}
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="sticky left-[200px] bg-white dark:bg-brand-green-darker/90 z-10 border-r border-slate-100 dark:border-sidebar-accent p-2.5">
                                                        <Input
                                                            value={descriptionDraft[lower] ?? ''}
                                                            onChange={(e) =>
                                                                setDescriptionDraft((prev) => ({ ...prev, [lower]: e.target.value }))
                                                            }
                                                            placeholder="Add description..."
                                                            className="h-9 text-sm"
                                                        />
                                                    </TableCell>
                                                    {roles.map((role) => {
                                                        const k = makeKey(role.slug, name);
                                                        const checked = !!matrixDraft[k];
                                                        return (
                                                            <TableCell key={role.id} className="text-center p-3">
                                                                <div className="flex justify-center items-center">
                                                                    <Checkbox
                                                                        checked={checked}
                                                                        onCheckedChange={() => handleToggleCell(role.slug, name)}
                                                                        aria-label={`${name} for ${role.name}`}
                                                                    />
                                                                </div>
                                                            </TableCell>
                                                        );
                                                    })}
                                                </TableRow>
                                            );
                                        })}
                                    </TableBody>
                                </Table>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* ── Dialogs ── */}
                <ConfirmationDialog
                    open={bulkDeactivateConfirmOpen}
                    onOpenChange={setBulkDeactivateConfirmOpen}
                    onConfirm={executeBulkSave}
                    title="Confirm Deactivation"
                    description={`You are deactivating ${matrixDiff.toDeactivate} item assignment(s). (Activate ${matrixDiff.toActivate}, Deactivate ${matrixDiff.toDeactivate}, ${matrixDiff.unchanged} unchanged). Unticked items will no longer be available when issuing belongings to those roles.`}
                    confirmText="Confirm &amp; Save"
                    cancelText="Cancel"
                    type="delete"
                    isLoading={isSavingMatrix}
                />

                <ConfirmationDialog
                    open={!!removeTarget}
                    onOpenChange={(open) => !open && setRemoveTarget(null)}
                    onConfirm={handleRemoveConfirm}
                    title="Permanently Remove Item"
                    description={removeTarget ? `Permanently remove "${removeTarget}" from the catalog? It is inactive for every role. This cannot be undone.` : ''}
                    confirmText="Remove Permanently"
                    cancelText="Cancel"
                    type="delete"
                    isLoading={isRemoving}
                />
            </div>
        </div>
    );
}
