'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ExternalLink, Loader2, Save, Search, ShieldCheck } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { tokenStorage } from '@/app/lib/token-storage';
import { refreshPermissions } from '@/app/hooks/usePermissionHydration';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { navigationConfig, type NavigationItem } from '@/app/config/navigation.config';

type ExportMode = 'DIRECT' | 'REQUEST_QUEUE';

type PermissionEntry = {
    reportSlug: string;
    reportName: string;
    exportMode: ExportMode;
    /** No server-side export path for this report — Request Queue can't be selected, exportMode always reads DIRECT. */
    queueCapable: boolean;
    /** The report page's own route — used to link out and to locate it in the sidebar. */
    navHref: string;
};

/** Walks the sidebar's nav tree looking for `href`, returning "Section › Sub-section › Leaf" — null if the report isn't in the sidebar (e.g. a per-loan drill-down page opened from a dialog, not top-level nav). */
function findMenuPath(items: NavigationItem[], href: string, trail: string[] = []): string | null {
    for (const item of items) {
        const nextTrail = [...trail, item.name];
        if (item.href === href) return nextTrail.join(' › ');
        if (item.children && item.children.length > 0) {
            const found = findMenuPath(item.children, href, nextTrail);
            if (found) return found;
        }
    }
    return null;
}

export default function ReportPermissionsPage() {
    const router = useRouter();
    const { toast } = useToast();

    const [userRole, setUserRole] = useState<string | null>(null);
    useEffect(() => {
        setUserRole(tokenStorage.getUser()?.role ?? null);
    }, []);
    const isNonAdmin = userRole !== null && userRole !== 'ADMIN';
    useEffect(() => {
        if (isNonAdmin) router.replace('/dashboard?error=insufficient_permissions');
    }, [isNonAdmin, router]);

    const [entries, setEntries] = useState<PermissionEntry[]>([]);
    // Computed once per load from navHref (which never changes from editing exportMode
    // dropdowns) — kept out of the entries-derived useMemo below so picking an export
    // mode doesn't re-walk the nav tree for all reports on every click.
    const [menuPathBySlug, setMenuPathBySlug] = useState<Map<string, string | null>>(new Map());
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    // Last-saved (or last-loaded) exportMode per slug — lets Save send only what actually
    // changed instead of re-upserting every report x every role on every click.
    const savedModesRef = useRef<Map<string, ExportMode>>(new Map());

    // Reports with no sidebar Menu Path (not linked in navigation.config.ts, so there's no
    // in-app way to actually reach them) are hidden from this list entirely — they stay in
    // `entries`/get included in Save so a previously-set exportMode isn't lost, just not shown.
    const visibleEntries = useMemo(
        () => entries.filter((e) => !!menuPathBySlug.get(e.reportSlug)),
        [entries, menuPathBySlug]
    );

    const filteredEntries = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return visibleEntries;
        return visibleEntries.filter((e) => {
            const path = menuPathBySlug.get(e.reportSlug) ?? '';
            return e.reportName.toLowerCase().includes(q) || path.toLowerCase().includes(q);
        });
    }, [visibleEntries, searchQuery, menuPathBySlug]);

    const hasChanges = useMemo(
        () => entries.some((e) => savedModesRef.current.get(e.reportSlug) !== e.exportMode),
        [entries]
    );

    const loadEntries = useCallback(async () => {
        setLoading(true);
        try {
            const result = await apiClient.get<{ entries: PermissionEntry[] }>('/admin/report-permissions');
            if (result.success && result.data) {
                setEntries(result.data.entries);
                const pathMap = new Map<string, string | null>();
                const modeMap = new Map<string, ExportMode>();
                for (const entry of result.data.entries) {
                    pathMap.set(entry.reportSlug, findMenuPath(navigationConfig, entry.navHref));
                    modeMap.set(entry.reportSlug, entry.exportMode);
                }
                setMenuPathBySlug(pathMap);
                savedModesRef.current = modeMap;
            } else {
                toast({ title: 'Error', description: result.error || 'Failed to load report permissions.', variant: 'destructive' });
            }
        } finally {
            setLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        loadEntries();
    }, [loadEntries]);

    const updateEntry = (reportSlug: string, exportMode: ExportMode) => {
        setEntries((prev) => prev.map((e) => (e.reportSlug === reportSlug ? { ...e, exportMode } : e)));
    };

    const handleSave = async () => {
        const changed = entries.filter((e) => savedModesRef.current.get(e.reportSlug) !== e.exportMode);
        if (changed.length === 0) {
            toast({ title: 'No changes', description: "Export modes already match what's saved — nothing to do." });
            return;
        }
        setSaving(true);
        try {
            const result = await apiClient.post('/admin/report-permissions', {
                entries: changed.map((e) => ({ reportSlug: e.reportSlug, exportMode: e.exportMode })),
            });
            if (result.success) {
                for (const e of changed) savedModesRef.current.set(e.reportSlug, e.exportMode);
                toast({ title: 'Saved', description: `Export mode updated for ${changed.length} report${changed.length !== 1 ? 's' : ''}, every role.` });
                // Re-hydrate this session's own authStore.reportPermissions immediately —
                // otherwise the change only takes effect on the next 3-minute poll or a
                // full browser refresh (usePermissionHydration doesn't re-run on SPA nav).
                await refreshPermissions();
            } else {
                toast({ title: 'Error', description: result.error || 'Failed to save report permissions.', variant: 'destructive' });
            }
        } finally {
            setSaving(false);
        }
    };

    if (isNonAdmin) return null;

    return (
        <ProtectedRoute>
            <div className="mx-auto max-w-7xl space-y-6 px-3 sm:px-6 py-4 sm:py-8">
                <PageHeader
                    title="Report Permissions"
                    description="Choose how each report's export is delivered — direct browser download, or generated in the background and downloadable only from Request Report."
                />

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between">
                        <CardTitle className="flex items-center gap-2 text-lg">
                            <ShieldCheck className="h-5 w-5 text-[#037f35]" />
                            Export Mode
                        </CardTitle>
                        <Button onClick={handleSave} disabled={saving || loading || !hasChanges} className="bg-[#025c27] text-white hover:bg-[#013318]">
                            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                            Save
                        </Button>
                    </CardHeader>
                    <CardContent className="p-0">
                        {loading ? (
                            <div className="p-12 text-center text-sm text-muted-foreground">Loading...</div>
                        ) : entries.length === 0 ? (
                            <div className="p-12 text-center text-sm text-muted-foreground">No reports registered yet.</div>
                        ) : (
                            <>
                                <div className="border-b px-4 py-3 sm:px-6">
                                    <div className="relative max-w-sm">
                                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                        <Input
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                            placeholder="Search reports by name or menu path…"
                                            className="pl-9"
                                        />
                                    </div>
                                </div>
                                {filteredEntries.length === 0 ? (
                                    <div className="p-12 text-center text-sm text-muted-foreground">No reports match &quot;{searchQuery}&quot;.</div>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead>Report</TableHead>
                                                    <TableHead>Menu Path</TableHead>
                                                    <TableHead>Export Mode</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {filteredEntries.map((entry) => {
                                                    const menuPath = menuPathBySlug.get(entry.reportSlug);
                                                    return (
                                                        <TableRow key={entry.reportSlug}>
                                                            <TableCell className="font-medium">{entry.reportName}</TableCell>
                                                            <TableCell className="text-sm text-muted-foreground">
                                                                {menuPath ? (
                                                                    <Link
                                                                        href={entry.navHref}
                                                                        target="_blank"
                                                                        rel="noopener noreferrer"
                                                                        className="inline-flex items-center gap-1 text-[#025c27] hover:underline dark:text-emerald-400"
                                                                        title="Open this report in a new tab"
                                                                    >
                                                                        {menuPath}
                                                                        <ExternalLink className="h-3 w-3 shrink-0" />
                                                                    </Link>
                                                                ) : (
                                                                    <span>—</span>
                                                                )}
                                                            </TableCell>
                                                            <TableCell>
                                                                <Select
                                                                    value={entry.exportMode}
                                                                    onValueChange={(v) => updateEntry(entry.reportSlug, v as ExportMode)}
                                                                >
                                                                    <SelectTrigger className="h-9 w-[190px]" title={entry.queueCapable ? undefined : 'This report has no server-side export path yet — it can only download directly.'}>
                                                                        <SelectValue />
                                                                    </SelectTrigger>
                                                                    <SelectContent>
                                                                        <SelectItem value="DIRECT">Direct download</SelectItem>
                                                                        <SelectItem value="REQUEST_QUEUE" disabled={!entry.queueCapable}>Request Report only</SelectItem>
                                                                    </SelectContent>
                                                                </Select>
                                                            </TableCell>
                                                        </TableRow>
                                                    );
                                                })}
                                            </TableBody>
                                        </Table>
                                    </div>
                                )}
                            </>
                        )}
                    </CardContent>
                </Card>
            </div>
        </ProtectedRoute>
    );
}
