'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
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
import { ChevronLeft, ChevronRight, Loader2, Repeat, TriangleAlert } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { TableSearchInput } from '@/components/ui/table-search';
import { toDisplayDate } from '@/app/lib/date-format';

interface LoanRow {
    loanId: string;
    loanNumber: string;
    amount: number;
    disbursedAt: string | null;
    disbursementStatus: 'DISBURSED' | 'CLOSED';
    clientId: string;
    clientName: string;
    centerName: string;
    productName: string;
}

interface FunderRow {
    id: string;
    funderId: string;
    funderName: string;
    loanCount?: number;
    aliases?: string[];
    aliasCounts?: Record<string, number>;
}

interface NamedRow {
    id: string;
    name: string;
    code?: string;
}

interface PreviewSummary {
    loanId: string;
    loanNumber: string;
    oldFunderName: string;
    newFunderName: string;
    moveCount: number;
    movedAmount: number;
    warnings: string[];
}

const PAGE_SIZE = 50;
const CHUNK_SIZE = 8;
const inr = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function BulkFunderChangeClient() {
    const { toast } = useToast();

    const [branches, setBranches] = useState<NamedRow[]>([]);
    const [funders, setFunders] = useState<FunderRow[]>([]);
    const [branchId, setBranchId] = useState('');
    // Source key = funder id, or `funderId::LEGACY LEDGER NAME` for a GL-only fix of an older-spelt ledger
    const [fromKey, setFromKey] = useState('');
    const [fromFunderId, legacyAlias = ''] = fromKey.split('::');
    const [toFunderId, setToFunderId] = useState('');
    const [statusFilter, setStatusFilter] = useState<'ALL' | 'DISBURSED' | 'CLOSED'>('ALL');
    const [query, setQuery] = useState('');

    const [loans, setLoans] = useState<LoanRow[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [totalCount, setTotalCount] = useState(0);
    const [selected, setSelected] = useState<Set<string>>(new Set());

    const [summaries, setSummaries] = useState<PreviewSummary[] | null>(null);
    const [isPreviewing, setIsPreviewing] = useState(false);
    const [previewProgress, setPreviewProgress] = useState({ done: 0, total: 0 });
    const [reason, setReason] = useState('');
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    // GL reconcile (leftover amounts in the wrong funder ledger)
    interface ReconMove {
        date: string;
        component: string;
        amount: number;
        fromVoucherNo: string;
        fromLedgerName: string;
        toLedgerName: string;
    }
    const [reconMoves, setReconMoves] = useState<ReconMove[] | null>(null);
    const [reconSkipped, setReconSkipped] = useState<string[]>([]);
    const [reconReason, setReconReason] = useState('');
    const [reconBusy, setReconBusy] = useState(false);
    // Opening balance left on an older-named funder ledger (not a voucher, so no loan list shows it)
    interface OpeningMove {
        openingId: string;
        fromLedgerName: string;
        toLedgerName: string;
        balanceType: 'DEBIT' | 'CREDIT';
        amount: number;
    }
    const [openingMoves, setOpeningMoves] = useState<OpeningMove[] | null>(null);
    const [openingReason, setOpeningReason] = useState('');
    const [openingBusy, setOpeningBusy] = useState(false);
    const [progress, setProgress] = useState<{ done: number; total: number; failed: string[] } | null>(null);

    useEffect(() => {
        apiClient.get<NamedRow[]>('/branches').then((r) => r.success && r.data && setBranches(r.data));
    }, []);

    // All funders (incl. inactive) with this branch's loan counts, refreshed when the branch changes
    useEffect(() => {
        const qs = branchId ? `?branchId=${encodeURIComponent(branchId)}` : '';
        apiClient.get<FunderRow[]>(`/super-control/bulk-funder-change/funders${qs}`).then((r) => r.success && r.data && setFunders(r.data));
    }, [branchId]);

    const ready = Boolean(branchId && fromFunderId);

    const loadList = useCallback(async () => {
        if (!branchId || !fromFunderId) {
            setLoans([]);
            return;
        }
        setIsLoading(true);
        try {
            const params = new URLSearchParams({ branchId, funderId: fromFunderId, page: String(page), pageSize: String(PAGE_SIZE) });
            if (legacyAlias) params.set('ledgerAlias', legacyAlias);
            else {
                const own = funders.find((f) => f.id === fromFunderId)?.aliases ?? [];
                if (own.length > 0) params.set('excludeAliases', own.join('|'));
            }
            if (query.trim()) params.set('q', query.trim());
            if (statusFilter !== 'ALL') params.set('status', statusFilter);
            const res = await apiClient.get<{ loans: LoanRow[]; totalPages: number; totalCount: number }>(
                `/super-control/bulk-funder-change/loans?${params.toString()}`
            );
            if (res.success && res.data) {
                setLoans(res.data.loans);
                setTotalPages(Math.max(1, res.data.totalPages));
                setTotalCount(res.data.totalCount);
            } else {
                toast({ title: 'Error', description: res.error || 'Failed to load loans', variant: 'destructive' });
            }
        } finally {
            setIsLoading(false);
        }
    }, [branchId, fromFunderId, legacyAlias, funders, page, query, statusFilter, toast]);

    useEffect(() => {
        loadList();
    }, [loadList]);

    // Any change of scope invalidates the selection and the preview.
    const resetSelection = () => {
        setSelected(new Set());
        setSummaries(null);
        setPage(1);
    };

    const toggle = (id: string) => {
        setSummaries(null);
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const allOnPageSelected = loans.length > 0 && loans.every((l) => selected.has(l.loanId));
    const togglePage = () => {
        setSummaries(null);
        setSelected((prev) => {
            const next = new Set(prev);
            if (allOnPageSelected) loans.forEach((l) => next.delete(l.loanId));
            else loans.forEach((l) => next.add(l.loanId));
            return next;
        });
    };

    const targetFunders = useMemo(() => funders.filter((f) => f.id !== fromFunderId), [funders, fromFunderId]);
    const fromFunderName = legacyAlias || (funders.find((f) => f.id === fromFunderId)?.funderName ?? '');
    const toFunderName = toFunderId === 'KEEP' ? "each loan's current funder" : (funders.find((f) => f.id === toFunderId)?.funderName ?? '');
    const hasWarnings = (summaries ?? []).some((s) => s.warnings.length > 0);

    const call = (mode: 'preview' | 'apply', ids: string[] = [...selected]) =>
        apiClient.post<{ summaries?: PreviewSummary[]; transferred?: number }>('/super-control/bulk-funder-change/apply', {
            branchId,
            fromFunderId,
            newFunderId: toFunderId,
            ...(legacyAlias ? { fromLedgerAlias: legacyAlias } : {}),
            loanIds: ids,
            mode,
            ...(mode === 'apply' ? { reason: reason.trim(), acknowledgeWarnings: hasWarnings } : {}),
        });

    const runReconcile = async (mode: 'preview' | 'apply') => {
        setReconBusy(true);
        try {
            const res = await apiClient.post<{ moves: ReconMove[]; skipped: string[] }>('/super-control/bulk-funder-change/reconcile', {
                branchId,
                mode,
                ...(mode === 'apply' ? { reason: reconReason.trim() } : {}),
            });
            if (!res.success || !res.data) {
                toast({ title: mode === 'apply' ? 'Reconcile failed' : 'Cannot check', description: res.error || 'Request failed', variant: 'destructive' });
                return;
            }
            if (mode === 'apply') {
                toast({ title: 'GL reconciled', description: `${res.data.moves.length} voucher move(s) applied.` });
                setReconReason('');
                setReconMoves(null);
                setReconSkipped([]);
            } else {
                setReconMoves(res.data.moves);
                setReconSkipped(res.data.skipped);
            }
        } finally {
            setReconBusy(false);
        }
    };

    const runOpening = async (mode: 'preview' | 'apply') => {
        setOpeningBusy(true);
        try {
            const res = await apiClient.post<{ moves: OpeningMove[] }>('/super-control/bulk-funder-change/opening-balance', {
                branchId,
                mode,
                ...(mode === 'apply' ? { reason: openingReason.trim() } : {}),
            });
            if (!res.success || !res.data) {
                toast({ title: mode === 'apply' ? 'Opening balance fix failed' : 'Cannot check', description: res.error || 'Request failed', variant: 'destructive' });
                return;
            }
            if (mode === 'apply') {
                toast({ title: 'Opening balance fixed', description: `${res.data.moves.length} opening balance(s) moved.` });
                setOpeningReason('');
                setOpeningMoves(null);
            } else {
                setOpeningMoves(res.data.moves);
            }
        } finally {
            setOpeningBusy(false);
        }
    };

    const runPreview = async () => {
        setIsPreviewing(true);
        setSummaries(null);
        try {
            // small batches keep each request well inside the server / DB time limits
            const all: PreviewSummary[] = [];
            const ids = [...selected];
            setPreviewProgress({ done: 0, total: ids.length });
            for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
                const res = await call('preview', ids.slice(i, i + CHUNK_SIZE));
                if (!res.success || !res.data?.summaries) {
                    toast({ title: 'Cannot preview', description: res.error || 'Failed to build preview', variant: 'destructive' });
                    return;
                }
                all.push(...res.data.summaries);
                setPreviewProgress({ done: Math.min(i + CHUNK_SIZE, ids.length), total: ids.length });
            }
            setSummaries(all);
        } finally {
            setIsPreviewing(false);
        }
    };

    const apply = async () => {
        setIsSaving(true);
        setProgress({ done: 0, total: selected.size, failed: [] });
        try {
            // One loan = one transaction. A failed loan is rolled back on its own, the rest carry on.
            const ids = [...selected];
            const nameOf = new Map(loans.map((l) => [l.loanId, l.loanNumber]));
            let done = 0;
            const failed: string[] = [];
            for (let i = 0; i < ids.length; i++) {
                const res = await call('apply', [ids[i]]);
                if (res.success) done += 1;
                else failed.push(`${nameOf.get(ids[i]) ?? ids[i]}: ${res.error || 'failed'}`);
                setProgress({ done: done + failed.length, total: ids.length, failed: [...failed] });
            }
            if (failed.length === 0) {
                toast({ title: 'Funder changed', description: `${done} loan(s) moved to ${toFunderName}.` });
                setConfirmOpen(false);
                setReason('');
            } else {
                toast({
                    title: `${done} done, ${failed.length} failed`,
                    description: 'Failed loans were rolled back untouched — see the list in the dialog, then retry them.',
                    variant: 'destructive',
                });
            }
            setSelected(new Set());
            setSummaries(null);
            loadList();
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="space-y-4">
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg sm:text-xl">Bulk Funder Change</CardTitle>
                    <CardDescription>
                        Super Control — pick a branch and the funder to move loans away from, tick the loans to transfer, then choose the
                        new funder. Posted GL vouchers are rewritten on their original dates.
                    </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-3">
                    <div className="space-y-1">
                        <Label>Branch</Label>
                        <Select
                            value={branchId}
                            onValueChange={(v) => {
                                setBranchId(v);
                                resetSelection();
                            }}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Select branch" />
                            </SelectTrigger>
                            <SelectContent>
                                {branches.map((b) => (
                                    <SelectItem key={b.id} value={b.id}>
                                        {b.code ? `${b.code} - ${b.name}` : b.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1">
                        <Label>Transfer from funder</Label>
                        <Select
                            value={fromKey}
                            onValueChange={(v) => {
                                setFromKey(v);
                                const [fid, alias] = v.split('::');
                                if (alias) setToFunderId('KEEP');
                                else if (fid === toFunderId || legacyAlias) setToFunderId('');
                                resetSelection();
                            }}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Select current funder" />
                            </SelectTrigger>
                            <SelectContent>
                                {funders.map((f) => (
                                    <Fragment key={f.id}>
                                        <SelectItem value={f.id}>
                                            {f.funderName} ({f.funderId}){branchId ? ` — ${f.loanCount ?? 0} loans` : ''}
                                        </SelectItem>
                                        {(f.aliases ?? []).map((a) => (
                                            <SelectItem key={`${f.id}::${a}`} value={`${f.id}::${a}`}>
                                                {a} — old ledger of {f.funderName} (GL fix only){branchId ? ` — ${f.aliasCounts?.[a] ?? 0} loans` : ''}
                                            </SelectItem>
                                        ))}
                                    </Fragment>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1">
                        <Label>Transfer to funder</Label>
                        <Select
                            value={toFunderId}
                            onValueChange={(v) => {
                                setToFunderId(v);
                                setSummaries(null);
                            }}
                            disabled={!fromFunderId}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Select new funder" />
                            </SelectTrigger>
                            <SelectContent>
                                {legacyAlias && <SelectItem value="KEEP">Keep each loan's current funder (fix GL ledger only)</SelectItem>}
                                {(legacyAlias ? funders : targetFunders).map((f) => (
                                    <SelectItem key={f.id} value={f.id}>
                                        {f.funderName} ({f.funderId}){legacyAlias && f.id === fromFunderId ? ' — same funder' : ''}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </CardContent>
            </Card>

            {branchId && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">GL reconcile — fix leftover amounts</CardTitle>
                        <CardDescription>
                            Compares each funder's posted EOD ledger amounts with what its loans actually collected, per day, and moves small
                            leftovers (e.g. ₹50) from the wrong funder ledger to the right one. The day's GL total never changes.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <Button variant="outline" onClick={() => runReconcile('preview')} disabled={reconBusy}>
                            {reconBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Check mismatches
                        </Button>
                        {reconMoves && (
                            <div className="space-y-3">
                                {reconMoves.length === 0 ? (
                                    <p className="text-sm text-muted-foreground">No funder mismatch found for this branch.</p>
                                ) : (
                                    <div className="overflow-x-auto rounded-md border">
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead>Date</TableHead>
                                                    <TableHead>Type</TableHead>
                                                    <TableHead>Voucher</TableHead>
                                                    <TableHead>From ledger</TableHead>
                                                    <TableHead>To ledger</TableHead>
                                                    <TableHead className="text-right">Amount</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {reconMoves.map((m, i) => (
                                                    <TableRow key={`${m.fromVoucherNo}-${m.toLedgerName}-${i}`}>
                                                        <TableCell>{toDisplayDate(m.date)}</TableCell>
                                                        <TableCell>{m.component}</TableCell>
                                                        <TableCell>{m.fromVoucherNo}</TableCell>
                                                        <TableCell>{m.fromLedgerName}</TableCell>
                                                        <TableCell>{m.toLedgerName}</TableCell>
                                                        <TableCell className="text-right">{inr(m.amount)}</TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </div>
                                )}
                                {reconSkipped.length > 0 && (
                                    <Alert>
                                        <TriangleAlert className="h-4 w-4" />
                                        <AlertDescription>
                                            <p className="mb-1 font-medium">Left as is (not a funder mix-up):</p>
                                            <ul className="list-disc space-y-1 pl-5">
                                                {reconSkipped.slice(0, 20).map((n, i) => (
                                                    <li key={`${i}-${n}`}>{n}</li>
                                                ))}
                                            </ul>
                                        </AlertDescription>
                                    </Alert>
                                )}
                                {reconMoves.length > 0 && (
                                    <div className="space-y-2">
                                        <Label htmlFor="recon-reason">Reason (audit log)</Label>
                                        <Textarea id="recon-reason" value={reconReason} onChange={(e) => setReconReason(e.target.value)} placeholder="e.g. Residual ₹50 left after funder transfer" />
                                        <Button onClick={() => runReconcile('apply')} disabled={reconBusy || reconReason.trim().length < 5}>
                                            {reconBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Apply {reconMoves.length} move(s)
                                        </Button>
                                    </div>
                                )}
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

            {branchId && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">Opening balance — old ledger</CardTitle>
                        <CardDescription>
                            If the branch&apos;s opening balance sits on an older-named funder ledger (e.g. &quot;OWN FUND GOLD PRINCIPAL&quot;), it never
                            shows in the loan list above. This moves it onto the funder&apos;s proper ledger; the branch&apos;s total opening balance never changes.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <Button variant="outline" onClick={() => runOpening('preview')} disabled={openingBusy}>
                            {openingBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Check opening balances
                        </Button>
                        {openingMoves && (
                            <div className="space-y-3">
                                {openingMoves.length === 0 ? (
                                    <p className="text-sm text-muted-foreground">No opening balance on an old-named funder ledger in this branch.</p>
                                ) : (
                                    <>
                                        <div className="overflow-x-auto rounded-md border">
                                            <Table>
                                                <TableHeader>
                                                    <TableRow>
                                                        <TableHead>From ledger</TableHead>
                                                        <TableHead>To ledger</TableHead>
                                                        <TableHead>Type</TableHead>
                                                        <TableHead className="text-right">Amount</TableHead>
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {openingMoves.map((m) => (
                                                        <TableRow key={m.openingId}>
                                                            <TableCell>{m.fromLedgerName}</TableCell>
                                                            <TableCell>{m.toLedgerName}</TableCell>
                                                            <TableCell>{m.balanceType}</TableCell>
                                                            <TableCell className="text-right">{inr(m.amount)}</TableCell>
                                                        </TableRow>
                                                    ))}
                                                </TableBody>
                                            </Table>
                                        </div>
                                        <div className="space-y-2">
                                            <Label htmlFor="opening-reason">Reason</Label>
                                            <Textarea id="opening-reason" value={openingReason} onChange={(e) => setOpeningReason(e.target.value)} placeholder="e.g. Opening balance moved to the renamed Own Fund - Gold ledger" />
                                            <Button onClick={() => runOpening('apply')} disabled={openingBusy || openingReason.trim().length < 5}>
                                                {openingBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Move {openingMoves.length} opening balance(s)
                                            </Button>
                                        </div>
                                    </>
                                )}
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

            {ready && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">
                            {fromFunderName} loans in this branch <Badge variant="secondary">{totalCount}</Badge>
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex flex-col gap-2 sm:flex-row">
                            <TableSearchInput
                                value={query}
                                onChange={(v: string) => {
                                    setQuery(v);
                                    setPage(1);
                                }}
                                placeholder="Loan no. / member ID / name"
                            />
                            <Select
                                value={statusFilter}
                                onValueChange={(v) => {
                                    setStatusFilter(v as 'ALL' | 'DISBURSED' | 'CLOSED');
                                    setPage(1);
                                }}
                            >
                                <SelectTrigger className="sm:w-40">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="ALL">All status</SelectItem>
                                    <SelectItem value="DISBURSED">Disbursed</SelectItem>
                                    <SelectItem value="CLOSED">Closed</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="overflow-x-auto rounded-md border">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-10">
                                            <Checkbox checked={allOnPageSelected} onCheckedChange={togglePage} aria-label="Select all on page" />
                                        </TableHead>
                                        <TableHead>Loan</TableHead>
                                        <TableHead>Member</TableHead>
                                        <TableHead>Center</TableHead>
                                        <TableHead>Product</TableHead>
                                        <TableHead>Disbursed</TableHead>
                                        <TableHead className="text-right">Amount</TableHead>
                                        <TableHead>Status</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {isLoading ? (
                                        <TableRow>
                                            <TableCell colSpan={8} className="text-center">
                                                <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                                            </TableCell>
                                        </TableRow>
                                    ) : loans.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={8} className="text-center text-muted-foreground">
                                                No loans under this funder in this branch
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        loans.map((l) => (
                                            <TableRow key={l.loanId}>
                                                <TableCell>
                                                    <Checkbox checked={selected.has(l.loanId)} onCheckedChange={() => toggle(l.loanId)} aria-label={`Select ${l.loanNumber}`} />
                                                </TableCell>
                                                <TableCell className="font-medium">{l.loanNumber}</TableCell>
                                                <TableCell>
                                                    {l.clientName}
                                                    <div className="text-xs text-muted-foreground">{l.clientId}</div>
                                                </TableCell>
                                                <TableCell>{l.centerName}</TableCell>
                                                <TableCell>{l.productName}</TableCell>
                                                <TableCell>{l.disbursedAt ? toDisplayDate(l.disbursedAt) : '—'}</TableCell>
                                                <TableCell className="text-right">{inr(l.amount)}</TableCell>
                                                <TableCell>
                                                    <Badge variant={l.disbursementStatus === 'CLOSED' ? 'outline' : 'default'}>{l.disbursementStatus}</Badge>
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>

                        <div className="flex items-center justify-between gap-2">
                            <span className="text-sm text-muted-foreground">{selected.size} selected</span>
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

                        <div className="flex justify-end">
                            <Button onClick={runPreview} disabled={selected.size === 0 || !toFunderId || isPreviewing}>
                                {isPreviewing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Preview transfer ({selected.size})
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}

            {isPreviewing && (
                <Card>
                    <CardContent className="flex flex-col items-center gap-3 py-10">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        <p className="text-sm font-medium">Building transfer preview…</p>
                        <p className="text-xs text-muted-foreground">
                            {previewProgress.done} of {previewProgress.total} loan(s) checked
                        </p>
                        <div className="h-2 w-64 max-w-full overflow-hidden rounded-full bg-muted">
                            <div
                                className="h-full bg-primary transition-all"
                                style={{ width: `${previewProgress.total ? (previewProgress.done / previewProgress.total) * 100 : 0}%` }}
                            />
                        </div>
                    </CardContent>
                </Card>
            )}

            {summaries && !isPreviewing && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">
                            Preview: {fromFunderName} → {toFunderName}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <Alert>
                            <AlertDescription>
                                Each loan&apos;s original GL vouchers are rewritten on their original dates. Schedules, amounts and collections
                                are not touched. All loans are transferred together — if one fails, nothing changes.
                            </AlertDescription>
                        </Alert>
                        {hasWarnings && (
                            <Alert variant="destructive">
                                <TriangleAlert className="h-4 w-4" />
                                <AlertDescription>Some vouchers could not be matched (listed below). Those entries are left unchanged.</AlertDescription>
                            </Alert>
                        )}
                        <div className="overflow-x-auto rounded-md border">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Loan</TableHead>
                                        <TableHead className="text-right">GL entries to move</TableHead>
                                        <TableHead className="text-right">Amount moved</TableHead>
                                        <TableHead>Warnings</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {summaries.map((s) => (
                                        <TableRow key={s.loanId}>
                                            <TableCell className="font-medium">{s.loanNumber}</TableCell>
                                            <TableCell className="text-right">{s.moveCount}</TableCell>
                                            <TableCell className="text-right">{inr(s.movedAmount)}</TableCell>
                                            <TableCell className="text-xs">{s.warnings.length ? s.warnings.join(' | ') : '—'}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                        <div className="space-y-1">
                            <Label htmlFor="bulk-funder-reason">Reason (audit log)</Label>
                            <Textarea
                                id="bulk-funder-reason"
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                                placeholder="e.g. Funding changed as per management request"
                            />
                        </div>
                        <div className="flex justify-end">
                            <Button onClick={() => { setProgress(null); setConfirmOpen(true); }} disabled={reason.trim().length < 5}>
                                <Repeat className="mr-2 h-4 w-4" /> Transfer {summaries.length} loan(s)
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}

            <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Confirm bulk funder change</DialogTitle>
                        <DialogDescription>
                            {summaries?.length ?? 0} loan(s): {fromFunderName} → {toFunderName}. GL vouchers will be rewritten on their original
                            dates and recorded in the audit log.
                        </DialogDescription>
                    </DialogHeader>
                    {progress && (
                        <div className="space-y-2 text-sm">
                            <div className="h-2 w-full overflow-hidden rounded bg-muted">
                                <div className="h-full bg-primary transition-all" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
                            </div>
                            <p>
                                {progress.done} / {progress.total} processed{progress.failed.length > 0 ? ` — ${progress.failed.length} failed` : ''}
                            </p>
                            {progress.failed.length > 0 && (
                                <ul className="max-h-40 list-disc space-y-1 overflow-y-auto pl-5 text-destructive">
                                    {progress.failed.map((f, i) => (
                                        <li key={`${i}-${f}`}>{f}</li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={isSaving}>
                            Cancel
                        </Button>
                        <Button onClick={apply} disabled={isSaving}>
                            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Confirm
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
