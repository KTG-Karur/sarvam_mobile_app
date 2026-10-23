'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { ChevronLeft, ChevronRight, Loader2, Save, TriangleAlert } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { TableSearchInput } from '@/components/ui/table-search';

interface ClientRow {
    id: string;
    clientId: string;
    name: string;
    phone: string;
    isActive: boolean;
    centerName: string;
    centerCode: string;
    branchName: string;
    branchCode: string;
    loanCount: number;
}

interface NamedRow {
    id: string;
    name: string;
    code?: string;
}

interface IdChangeResult {
    oldClientId: string;
    newClientId: string;
    warnings: string[];
    applied: boolean;
}

const PAGE_SIZE = 20;
const MEMBER_ID_RE = /^\d+-\d+-\d+-\d+$/;

export function MemberIdEditClient() {
    const { toast } = useToast();

    const [clients, setClients] = useState<ClientRow[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [query, setQuery] = useState('');
    const [branchFilter, setBranchFilter] = useState('');
    const [branches, setBranches] = useState<NamedRow[]>([]);

    const [editing, setEditing] = useState<ClientRow | null>(null);
    const [newId, setNewId] = useState('');
    const [reason, setReason] = useState('');
    const [preview, setPreview] = useState<IdChangeResult | null>(null);
    const [isChecking, setIsChecking] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    const loadList = useCallback(async () => {
        setIsLoading(true);
        try {
            const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
            if (query.trim()) params.set('q', query.trim());
            if (branchFilter) params.set('branchId', branchFilter);
            const res = await apiClient.get<{ clients: ClientRow[]; totalPages: number }>(
                `/super-control/member-id-edit/clients?${params.toString()}`
            );
            if (res.success && res.data) {
                setClients(res.data.clients);
                setTotalPages(Math.max(1, res.data.totalPages));
            } else {
                toast({ title: 'Error', description: res.error || 'Failed to load clients', variant: 'destructive' });
            }
        } finally {
            setIsLoading(false);
        }
    }, [page, query, branchFilter, toast]);

    useEffect(() => {
        loadList();
    }, [loadList]);

    useEffect(() => {
        apiClient.get<NamedRow[]>('/branches').then((r) => r.success && r.data && setBranches(r.data));
    }, []);

    const openEdit = (c: ClientRow) => {
        setEditing(c);
        setNewId(c.clientId);
        setReason('');
        setPreview(null);
    };

    const idValid = MEMBER_ID_RE.test(newId.trim());

    const check = async () => {
        if (!editing) return;
        setIsChecking(true);
        try {
            const res = await apiClient.post<IdChangeResult>(`/super-control/member-id-edit/clients/${editing.id}`, {
                newClientId: newId.trim(),
                mode: 'preview',
            });
            if (res.success && res.data) setPreview(res.data);
            else {
                setPreview(null);
                toast({ title: 'Cannot use this ID', description: res.error || 'Validation failed', variant: 'destructive' });
            }
        } finally {
            setIsChecking(false);
        }
    };

    const save = async () => {
        if (!editing || !preview) return;
        setIsSaving(true);
        try {
            const res = await apiClient.post<IdChangeResult>(`/super-control/member-id-edit/clients/${editing.id}`, {
                newClientId: newId.trim(),
                mode: 'apply',
                reason: reason.trim(),
                acknowledgeWarnings: preview.warnings.length > 0,
            });
            if (res.success) {
                toast({ title: 'Member ID updated', description: `${editing.clientId} → ${newId.trim()}` });
                setEditing(null);
                loadList();
            } else {
                toast({ title: 'Failed', description: res.error || 'Could not update Member ID', variant: 'destructive' });
            }
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-lg sm:text-xl">Member ID Edit</CardTitle>
                <CardDescription>
                    Super Control — change a client&apos;s Member ID (e.g. 33-44-1-3). Only the ID changes; loans, collections and GL are
                    untouched.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex flex-col gap-2 sm:flex-row">
                    <TableSearchInput
                        value={query}
                        onChange={(v: string) => {
                            setQuery(v);
                            setPage(1);
                        }}
                        placeholder="Member ID / name / phone"
                    />
                    <Select
                        value={branchFilter || 'ALL'}
                        onValueChange={(v) => {
                            setBranchFilter(v === 'ALL' ? '' : v);
                            setPage(1);
                        }}
                    >
                        <SelectTrigger className="sm:w-56">
                            <SelectValue placeholder="All branches" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="ALL">All branches</SelectItem>
                            {branches.map((b) => (
                                <SelectItem key={b.id} value={b.id}>
                                    {b.code ? `${b.code} - ${b.name}` : b.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                <div className="overflow-x-auto rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Member ID</TableHead>
                                <TableHead>Name</TableHead>
                                <TableHead>Phone</TableHead>
                                <TableHead>Branch / Center</TableHead>
                                <TableHead className="text-right">Loans</TableHead>
                                <TableHead />
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading ? (
                                <TableRow>
                                    <TableCell colSpan={6} className="text-center">
                                        <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                                    </TableCell>
                                </TableRow>
                            ) : clients.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                                        No clients found
                                    </TableCell>
                                </TableRow>
                            ) : (
                                clients.map((c) => (
                                    <TableRow key={c.id}>
                                        <TableCell className="font-medium">
                                            {c.clientId} {!c.isActive && <Badge variant="outline">Inactive</Badge>}
                                        </TableCell>
                                        <TableCell>{c.name}</TableCell>
                                        <TableCell>{c.phone || '—'}</TableCell>
                                        <TableCell>
                                            {c.branchName}
                                            <div className="text-xs text-muted-foreground">{c.centerName}</div>
                                        </TableCell>
                                        <TableCell className="text-right">{c.loanCount}</TableCell>
                                        <TableCell className="text-right">
                                            <Button size="sm" variant="outline" onClick={() => openEdit(c)}>
                                                Edit ID
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>

                <div className="flex items-center justify-end gap-2">
                    <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                        <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-sm">
                        {page} / {totalPages}
                    </span>
                    <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                </div>
            </CardContent>

            <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Edit Member ID</DialogTitle>
                        <DialogDescription>
                            {editing?.name} · current ID <b>{editing?.clientId}</b> · {editing?.branchName} / {editing?.centerName}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-3">
                        <div className="space-y-1">
                            <Label htmlFor="new-member-id">New Member ID</Label>
                            <Input
                                id="new-member-id"
                                value={newId}
                                onChange={(e) => {
                                    setNewId(e.target.value);
                                    setPreview(null);
                                }}
                                placeholder="33-44-1-3"
                            />
                            {newId.trim() && !idValid && <p className="text-xs text-destructive">Format: branch-center-group-number, e.g. 33-44-1-3</p>}
                        </div>

                        {preview && preview.warnings.length > 0 && (
                            <Alert variant="destructive">
                                <TriangleAlert className="h-4 w-4" />
                                <AlertDescription>
                                    <ul className="list-disc pl-5">
                                        {preview.warnings.map((w) => (
                                            <li key={w}>{w}</li>
                                        ))}
                                    </ul>
                                </AlertDescription>
                            </Alert>
                        )}
                        {preview && (
                            <Alert>
                                <AlertDescription>
                                    {preview.oldClientId} → <b>{preview.newClientId}</b>
                                    {preview.warnings.length === 0 ? ' — ID is free to use.' : ' — review the warnings above, then save to confirm.'}
                                </AlertDescription>
                            </Alert>
                        )}

                        {preview && (
                            <div className="space-y-1">
                                <Label htmlFor="member-id-reason">Reason (audit log)</Label>
                                <Textarea id="member-id-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Wrong sequence assigned at enrollment" />
                            </div>
                        )}
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEditing(null)} disabled={isSaving}>
                            Cancel
                        </Button>
                        {!preview ? (
                            <Button onClick={check} disabled={!idValid || newId.trim() === editing?.clientId || isChecking}>
                                {isChecking && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Check ID
                            </Button>
                        ) : (
                            <Button onClick={save} disabled={reason.trim().length < 5 || isSaving}>
                                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Save
                            </Button>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    );
}
