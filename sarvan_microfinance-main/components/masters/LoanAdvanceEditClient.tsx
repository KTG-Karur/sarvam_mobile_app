'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { ChevronLeft, ChevronRight, Loader2, Save, Undo2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { TableSearchInput } from '@/components/ui/table-search';
import { cn } from '@/lib/utils';

interface NamedRow {
    id: string;
    name: string;
}

interface CenterRow extends NamedRow {
    code: string;
}

interface MemberRow {
    id: string;
    clientId: string;
    name: string;
    centerId: string | null;
    centerCode: string;
    centerName: string;
    loanAdvance: number;
}

interface MemberListResponse {
    clients: MemberRow[];
    totalCount: number;
    page: number;
    totalPages: number;
}

const ALL_CENTERS = 'ALL';

export function LoanAdvanceEditClient() {
    const { toast } = useToast();

    const [branches, setBranches] = useState<NamedRow[]>([]);
    const [centers, setCenters] = useState<CenterRow[]>([]);
    const [branchId, setBranchId] = useState('');
    const [centerId, setCenterId] = useState(ALL_CENTERS);
    const [search, setSearch] = useState('');
    const [query, setQuery] = useState('');
    const [page, setPage] = useState(1);

    const [rows, setRows] = useState<MemberRow[]>([]);
    const [totalCount, setTotalCount] = useState(0);
    const [totalPages, setTotalPages] = useState(1);
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    // Saved value of every member seen so far, and the raw text typed for edited ones.
    // Both are keyed by Client.id so edits survive paging / search / center changes.
    const [originals, setOriginals] = useState<Record<string, number>>({});
    const [edits, setEdits] = useState<Record<string, string>>({});

    const parse = (raw: string): number | null => {
        if (raw.trim() === '') return null;
        const n = Number(raw);
        return Number.isFinite(n) ? n : null;
    };

    // An edit counts only when it is a valid number that differs from the saved value.
    const changed = useMemo(
        () =>
            Object.entries(edits).flatMap(([id, raw]) => {
                const value = parse(raw);
                return value !== null && originals[id] !== undefined && value !== originals[id]
                    ? [{ id, loanAdvance: value }]
                    : [];
            }),
        [edits, originals]
    );
    const invalidCount = useMemo(
        () => Object.values(edits).filter((raw) => {
            const v = parse(raw);
            return v === null || v < 0 || Math.abs(v * 100 - Math.round(v * 100)) > 1e-6;
        }).length,
        [edits]
    );

    useEffect(() => {
        apiClient.get<NamedRow[]>('/branches').then((r) => {
            if (r.success && r.data) setBranches(r.data);
        });
    }, []);

    // Centers follow the selected branch
    useEffect(() => {
        setCenters([]);
        setCenterId(ALL_CENTERS);
        if (!branchId) return;
        apiClient
            .get<CenterRow[]>(`/centers?branchId=${branchId}&includeInactive=false&status=APPROVED`)
            .then((r) => {
                if (r.success && r.data) setCenters(r.data);
            });
    }, [branchId]);

    // Debounce the search box so we don't query on every keystroke
    useEffect(() => {
        const t = setTimeout(() => {
            setQuery(search.trim());
            setPage(1);
        }, 350);
        return () => clearTimeout(t);
    }, [search]);

    const loadMembers = useCallback(async () => {
        if (!branchId) {
            setRows([]);
            return;
        }
        setIsLoading(true);
        try {
            const params = new URLSearchParams({ branchId, page: String(page), pageSize: '50' });
            if (centerId !== ALL_CENTERS) params.set('centerId', centerId);
            if (query) params.set('q', query);
            const res = await apiClient.get<MemberListResponse>(`/uploan/loan-advance?${params.toString()}`);
            if (res.success && res.data) {
                setRows(res.data.clients);
                setTotalCount(res.data.totalCount);
                setTotalPages(res.data.totalPages);
                setOriginals((prev) => {
                    const next = { ...prev };
                    for (const c of res.data!.clients) {
                        // Keep the value first seen for a row that has unsaved edits
                        if (!(c.id in prev) || !(c.id in edits)) next[c.id] = c.loanAdvance;
                    }
                    return next;
                });
            } else {
                setRows([]);
                toast({ title: 'Error', description: res.error || 'Failed to load members', variant: 'destructive' });
            }
        } catch {
            setRows([]);
            toast({ title: 'Error', description: 'Failed to load members', variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
        // `edits` is intentionally not a dependency — typing must not refetch the list.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [branchId, centerId, query, page, toast]);

    useEffect(() => {
        loadMembers();
    }, [loadMembers]);

    const handleChange = (row: MemberRow, raw: string) => {
        setEdits((prev) => {
            const next = { ...prev };
            const value = parse(raw);
            // Typing the saved value back removes the edit
            if (value !== null && value === originals[row.id]) delete next[row.id];
            else next[row.id] = raw;
            return next;
        });
    };

    const handleDiscard = () => setEdits({});

    const handleSave = async () => {
        if (invalidCount > 0) {
            toast({
                title: 'Fix invalid values',
                description: 'Loan advance must be a number ≥ 0 with at most 2 decimals.',
                variant: 'destructive',
            });
            return;
        }
        setIsSaving(true);
        try {
            const res = await apiClient.put<{ updated: number }>('/uploan/loan-advance', {
                branchId,
                updates: changed,
            });
            if (res.success) {
                toast({ title: 'Saved', description: `${res.data?.updated ?? changed.length} loan advance value(s) updated.` });
                setOriginals((prev) => {
                    const next = { ...prev };
                    for (const c of changed) next[c.id] = c.loanAdvance;
                    return next;
                });
                setEdits({});
                await loadMembers();
            } else {
                toast({ title: 'Error', description: res.error || 'Failed to save', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'Failed to save changes', variant: 'destructive' });
        } finally {
            setIsSaving(false);
        }
    };

    const hasUnsaved = Object.keys(edits).length > 0;

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle>Loan Advance Edit</CardTitle>
                    <CardDescription>
                        Select a branch to list its members and edit the loan advance stored on each member.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        <div className="space-y-1.5">
                            <Label>Branch</Label>
                            <Select
                                value={branchId}
                                onValueChange={(v) => {
                                    setBranchId(v);
                                    setPage(1);
                                }}
                                disabled={hasUnsaved}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Select branch" />
                                </SelectTrigger>
                                <SelectContent>
                                    {branches.map((b) => (
                                        <SelectItem key={b.id} value={b.id}>
                                            {b.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {hasUnsaved && (
                                <p className="text-xs text-muted-foreground">Save or discard changes to switch branch.</p>
                            )}
                        </div>
                        <div className="space-y-1.5">
                            <Label>Center</Label>
                            <Select
                                value={centerId}
                                onValueChange={(v) => {
                                    setCenterId(v);
                                    setPage(1);
                                }}
                                disabled={!branchId}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="All centers" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={ALL_CENTERS}>All centers</SelectItem>
                                    {centers.map((c) => (
                                        <SelectItem key={c.id} value={c.id}>
                                            {c.code} - {c.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label>Search</Label>
                            <TableSearchInput
                                value={search}
                                onChange={setSearch}
                                placeholder="Member name or ID"
                                className="w-full"
                            />
                        </div>
                    </div>
                </CardContent>
            </Card>

            {!branchId ? (
                <Card>
                    <CardContent className="py-12 text-center text-muted-foreground">
                        Select a branch to view its members.
                    </CardContent>
                </Card>
            ) : (
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between gap-4">
                        <CardTitle className="text-base">
                            Members{' '}
                            <span className="text-sm font-normal text-muted-foreground">({totalCount})</span>
                        </CardTitle>
                        {hasUnsaved && (
                            <div className="flex items-center gap-2">
                                <span className="text-sm text-muted-foreground">
                                    {changed.length} change{changed.length === 1 ? '' : 's'}
                                    {invalidCount > 0 ? `, ${invalidCount} invalid` : ''}
                                </span>
                                <Button type="button" variant="outline" size="sm" onClick={handleDiscard} disabled={isSaving}>
                                    <Undo2 className="mr-1.5 h-4 w-4" />
                                    Discard
                                </Button>
                                <Button
                                    type="button"
                                    size="sm"
                                    onClick={handleSave}
                                    disabled={isSaving || changed.length === 0 || invalidCount > 0}
                                >
                                    {isSaving ? (
                                        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                                    ) : (
                                        <Save className="mr-1.5 h-4 w-4" />
                                    )}
                                    Save
                                </Button>
                            </div>
                        )}
                    </CardHeader>
                    <CardContent>
                        {isLoading ? (
                            <div className="flex justify-center py-12">
                                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                            </div>
                        ) : rows.length === 0 ? (
                            <p className="py-12 text-center text-muted-foreground">No members found.</p>
                        ) : (
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Member ID</TableHead>
                                        <TableHead>Name</TableHead>
                                        <TableHead>Center</TableHead>
                                        <TableHead className="text-right">Saved Advance (₹)</TableHead>
                                        <TableHead className="w-48 text-right">Loan Advance (₹)</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {rows.map((row) => {
                                        const raw = edits[row.id];
                                        const isEdited = raw !== undefined;
                                        const value = isEdited ? parse(raw) : row.loanAdvance;
                                        const invalid =
                                            isEdited && (value === null || value < 0 || Math.abs(value * 100 - Math.round(value * 100)) > 1e-6);
                                        return (
                                            <TableRow key={row.id} className={cn(isEdited && 'bg-amber-50 dark:bg-amber-950/20')}>
                                                <TableCell className="font-medium">{row.clientId}</TableCell>
                                                <TableCell>{row.name}</TableCell>
                                                <TableCell>
                                                    {row.centerCode} - {row.centerName}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    {(originals[row.id] ?? row.loanAdvance).toLocaleString('en-IN', {
                                                        minimumFractionDigits: 2,
                                                        maximumFractionDigits: 2,
                                                    })}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <Input
                                                        type="number"
                                                        inputMode="decimal"
                                                        min={0}
                                                        step="0.01"
                                                        value={isEdited ? raw : String(row.loanAdvance)}
                                                        onChange={(e) => handleChange(row, e.target.value)}
                                                        className={cn('ml-auto w-40 text-right', invalid && 'border-red-500')}
                                                        disabled={isSaving}
                                                    />
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        )}

                        {totalPages > 1 && (
                            <div className="mt-4 flex items-center justify-end gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={page <= 1 || isLoading}
                                    onClick={() => setPage((p) => p - 1)}
                                >
                                    <ChevronLeft className="h-4 w-4" />
                                </Button>
                                <span className="text-sm text-muted-foreground">
                                    Page {page} of {totalPages}
                                </span>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={page >= totalPages || isLoading}
                                    onClick={() => setPage((p) => p + 1)}
                                >
                                    <ChevronRight className="h-4 w-4" />
                                </Button>
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
