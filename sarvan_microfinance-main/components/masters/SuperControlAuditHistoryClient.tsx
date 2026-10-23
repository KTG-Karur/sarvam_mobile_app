'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { TableSearchInput } from '@/components/ui/table-search';
import { DateInput } from '@/components/ui/date-input';
import { toDisplayDate } from '@/app/lib/date-format';

interface AuditEntry {
    id: string;
    type: 'INDIVIDUAL_FUNDER' | 'BULK_FUNDER' | 'SCHEDULE' | 'MEMBER_ID' | 'CENTER_ID';
    menu: string;
    at: string;
    changedBy: string;
    target: string;
    targetName: string;
    summary: string;
    reason: string;
    lines: string[];
}

const PAGE_SIZE = 20;

const TYPE_OPTIONS = [
    { value: 'ALL', label: 'All menus' },
    { value: 'INDIVIDUAL_FUNDER', label: 'Individual Funder Change' },
    { value: 'BULK_FUNDER', label: 'Bulk Funder Change' },
    { value: 'SCHEDULE', label: 'Live Loan Schedule Edit' },
    { value: 'MEMBER_ID', label: 'Member ID Edit' },
    { value: 'CENTER_ID', label: 'Center ID Edit' },
];

const formatWhen = (iso: string) =>
    new Date(iso).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
    });

export function SuperControlAuditHistoryClient() {
    const { toast } = useToast();

    const [entries, setEntries] = useState<AuditEntry[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [totalCount, setTotalCount] = useState(0);
    const [type, setType] = useState('ALL');
    const [query, setQuery] = useState('');
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [openId, setOpenId] = useState<string | null>(null);
    const [branches, setBranches] = useState<{ id: string; name: string; code?: string }[]>([]);
    const [branchId, setBranchId] = useState('');

    useEffect(() => {
        apiClient.get<{ id: string; name: string; code?: string }[]>('/branches').then((r) => r.success && r.data && setBranches(r.data));
    }, []);

    const load = useCallback(async () => {
        setIsLoading(true);
        try {
            const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), type });
            if (query.trim()) params.set('q', query.trim());
            if (from) params.set('from', from);
            if (to) params.set('to', to);
            if (branchId) params.set('branchId', branchId);
            const res = await apiClient.get<{ entries: AuditEntry[]; totalPages: number; totalCount: number }>(
                `/super-control/audit-history?${params.toString()}`
            );
            if (res.success && res.data) {
                setEntries(res.data.entries);
                setTotalPages(Math.max(1, res.data.totalPages));
                setTotalCount(res.data.totalCount);
            } else {
                toast({ title: 'Error', description: res.error || 'Failed to load audit history', variant: 'destructive' });
            }
        } finally {
            setIsLoading(false);
        }
    }, [page, type, query, from, to, branchId, toast]);

    useEffect(() => {
        load();
    }, [load]);

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-lg sm:text-xl">Super Control Audit History</CardTitle>
                <CardDescription>Who changed what, and when — across Individual / Bulk Funder Change, Live Loan Schedule Edit, Member ID Edit and Center ID Edit.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                    <div className="space-y-1">
                        <Label>Branch</Label>
                        <Select
                            value={branchId || 'ALL'}
                            onValueChange={(v) => {
                                setBranchId(v === 'ALL' ? '' : v);
                                setPage(1);
                            }}
                        >
                            <SelectTrigger>
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
                    <div className="space-y-1">
                        <Label>Menu</Label>
                        <Select
                            value={type}
                            onValueChange={(v) => {
                                setType(v);
                                setPage(1);
                            }}
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {TYPE_OPTIONS.map((o) => (
                                    <SelectItem key={o.value} value={o.value}>
                                        {o.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1">
                        <Label>From</Label>
                        <DateInput
                            value={from}
                            onChange={(e) => {
                                setFrom(e.target.value);
                                setPage(1);
                            }}
                        />
                    </div>
                    <div className="space-y-1">
                        <Label>To</Label>
                        <DateInput
                            value={to}
                            onChange={(e) => {
                                setTo(e.target.value);
                                setPage(1);
                            }}
                        />
                    </div>
                    <div className="space-y-1">
                        <Label>Search</Label>
                        <TableSearchInput
                            value={query}
                            onChange={(v: string) => {
                                setQuery(v);
                                setPage(1);
                            }}
                            placeholder="Loan no. / Member ID / Center ID / name"
                        />
                    </div>
                </div>

                <div className="overflow-x-auto rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>When</TableHead>
                                <TableHead>Who</TableHead>
                                <TableHead>Menu</TableHead>
                                <TableHead>On</TableHead>
                                <TableHead>What changed</TableHead>
                                <TableHead>Reason</TableHead>
                                <TableHead className="w-10" />
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading ? (
                                <TableRow>
                                    <TableCell colSpan={7} className="text-center">
                                        <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                                    </TableCell>
                                </TableRow>
                            ) : entries.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={7} className="text-center text-muted-foreground">
                                        No changes recorded
                                    </TableCell>
                                </TableRow>
                            ) : (
                                entries.map((e) => (
                                    <Fragment key={e.id}>
                                        <TableRow>
                                            <TableCell className="whitespace-nowrap text-sm">{formatWhen(e.at)}</TableCell>
                                            <TableCell>{e.changedBy}</TableCell>
                                            <TableCell>
                                                <Badge variant="secondary">{e.menu}</Badge>
                                            </TableCell>
                                            <TableCell>
                                                {e.target}
                                                <div className="text-xs text-muted-foreground">{e.targetName}</div>
                                            </TableCell>
                                            <TableCell>{e.summary}</TableCell>
                                            <TableCell className="max-w-xs text-sm">{e.reason}</TableCell>
                                            <TableCell>
                                                {e.lines.length > 0 && (
                                                    <Button
                                                        size="icon"
                                                        variant="ghost"
                                                        aria-label="Show details"
                                                        onClick={() => setOpenId(openId === e.id ? null : e.id)}
                                                    >
                                                        {openId === e.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                                    </Button>
                                                )}
                                            </TableCell>
                                        </TableRow>
                                        {openId === e.id && (
                                            <TableRow>
                                                <TableCell colSpan={7} className="bg-muted/40">
                                                    <ul className="list-disc space-y-1 pl-5 text-sm">
                                                        {e.lines.map((l, i) => (
                                                            <li key={`${e.id}-${i}`}>{l.replace(/^(\d{4})-(\d{2})-(\d{2})/, (_m, y, m, d) => toDisplayDate(`${y}-${m}-${d}`))}</li>
                                                        ))}
                                                    </ul>
                                                </TableCell>
                                            </TableRow>
                                        )}
                                    </Fragment>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>

                <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-muted-foreground">{totalCount} change(s)</span>
                    <div className="flex items-center gap-2">
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
                </div>
            </CardContent>
        </Card>
    );
}
