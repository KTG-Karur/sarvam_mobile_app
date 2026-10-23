'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
import { ArrowLeft, ChevronLeft, ChevronRight, Loader2, Repeat, TriangleAlert } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { TableSearchInput } from '@/components/ui/table-search';
import { toDisplayDate } from '@/app/lib/date-format';
import type { FunderChangePlan } from '@/app/lib/services/loan-funder-change.service';

interface LoanRow {
    loanId: string;
    loanNumber: string;
    amount: number;
    disbursedAt: string | null;
    disbursementStatus: 'DISBURSED' | 'CLOSED';
    funderId: string | null;
    funderName: string;
    clientId: string;
    clientName: string;
    branchName: string;
    branchCode: string;
    centerName: string;
    productName: string;
}

interface FunderRow {
    id: string;
    funderId: string;
    funderName: string;
}

interface NamedRow {
    id: string;
    name: string;
    code?: string;
}

const PAGE_SIZE = 20;
const inr = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function MemberLoanEditClient() {
    const { toast } = useToast();

    const [loans, setLoans] = useState<LoanRow[]>([]);
    const [isLoadingList, setIsLoadingList] = useState(true);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [query, setQuery] = useState('');
    const [branchFilter, setBranchFilter] = useState('');
    const [statusFilter, setStatusFilter] = useState<'ALL' | 'DISBURSED' | 'CLOSED'>('ALL');
    const [branches, setBranches] = useState<NamedRow[]>([]);
    const [funders, setFunders] = useState<FunderRow[]>([]);

    const [selected, setSelected] = useState<LoanRow | null>(null);
    const [newFunderId, setNewFunderId] = useState('');
    const [reason, setReason] = useState('');
    const [plan, setPlan] = useState<FunderChangePlan | null>(null);
    const [isPreviewing, setIsPreviewing] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [confirmOpen, setConfirmOpen] = useState(false);

    const loadList = useCallback(async () => {
        setIsLoadingList(true);
        try {
            const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
            if (query.trim()) params.set('q', query.trim());
            if (branchFilter) params.set('branchId', branchFilter);
            if (statusFilter !== 'ALL') params.set('status', statusFilter);
            const res = await apiClient.get<{ loans: LoanRow[]; totalPages: number }>(
                `/super-control/member-loan-edit/loans?${params.toString()}`
            );
            if (res.success && res.data) {
                setLoans(res.data.loans);
                setTotalPages(Math.max(1, res.data.totalPages));
            } else {
                toast({ title: 'Error', description: res.error || 'Failed to load loans', variant: 'destructive' });
            }
        } finally {
            setIsLoadingList(false);
        }
    }, [page, query, branchFilter, statusFilter, toast]);

    useEffect(() => {
        if (!selected) loadList();
    }, [selected, loadList]);

    useEffect(() => {
        apiClient.get<NamedRow[]>('/branches').then((r) => r.success && r.data && setBranches(r.data));
        apiClient.get<FunderRow[]>('/masters/funder').then((r) => r.success && r.data && setFunders(r.data));
    }, []);

    const openLoan = (loan: LoanRow) => {
        setSelected(loan);
        setNewFunderId('');
        setReason('');
        setPlan(null);
    };

    const runPreview = async (funderId: string) => {
        if (!selected) return;
        setNewFunderId(funderId);
        setPlan(null);
        setIsPreviewing(true);
        try {
            const res = await apiClient.get<FunderChangePlan>(
                `/super-control/member-loan-edit/loans/${selected.loanId}/funder?newFunderId=${encodeURIComponent(funderId)}`
            );
            if (res.success && res.data) setPlan(res.data);
            else toast({ title: 'Cannot preview', description: res.error || 'Failed to build preview', variant: 'destructive' });
        } finally {
            setIsPreviewing(false);
        }
    };

    const applyChange = async () => {
        if (!selected || !plan) return;
        setIsSaving(true);
        try {
            const res = await apiClient.post<{ movedVoucherCount: number }>(
                `/super-control/member-loan-edit/loans/${selected.loanId}/funder`,
                { newFunderId, reason: reason.trim(), acknowledgeWarnings: plan.warnings.length > 0 }
            );
            if (res.success) {
                toast({
                    title: 'Funder changed',
                    description: `${selected.loanNumber} → ${plan.newFunderName}. ${res.data?.movedVoucherCount ?? 0} GL voucher entries updated.`,
                });
                setConfirmOpen(false);
                setSelected(null);
            } else {
                toast({ title: 'Failed', description: res.error || 'Could not change funder', variant: 'destructive' });
            }
        } finally {
            setIsSaving(false);
        }
    };

    // ── Detail ───────────────────────────────────────────────────────────────
    if (selected) {
        const otherFunders = funders.filter((f) => f.id !== selected.funderId);
        return (
            <div className="space-y-4">
                <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
                    <ArrowLeft className="mr-2 h-4 w-4" /> Back to loans
                </Button>

                <Card>
                    <CardHeader>
                        <CardTitle className="text-lg sm:text-xl">
                            {selected.clientName} · Loan {selected.loanNumber}
                        </CardTitle>
                        <CardDescription>
                            {selected.clientId} · {selected.branchName} · {selected.centerName} · {selected.productName} ·{' '}
                            {inr(selected.amount)} · Disbursed {selected.disbursedAt ? toDisplayDate(selected.disbursedAt) : '—'}
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-1">
                                <Label>Current funder</Label>
                                <div>
                                    <Badge variant="secondary">{selected.funderName}</Badge>
                                </div>
                            </div>
                            <div className="space-y-1">
                                <Label>Change funder to</Label>
                                <Select value={newFunderId} onValueChange={runPreview}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select new funder" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {otherFunders.map((f) => (
                                            <SelectItem key={f.id} value={f.id}>
                                                {f.funderName} ({f.funderId})
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        {isPreviewing && (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <Loader2 className="h-4 w-4 animate-spin" /> Checking GL vouchers…
                            </div>
                        )}

                        {plan && (
                            <div className="space-y-3">
                                <Alert>
                                    <AlertDescription>
                                        The original vouchers (original dates) will be rewritten so every posting of this loan moves from{' '}
                                        <b>{plan.oldFunderName}</b> ledgers to <b>{plan.newFunderName}</b> ledgers. Loan schedule, amounts
                                        and collections are not touched.
                                    </AlertDescription>
                                </Alert>

                                {plan.warnings.length > 0 && (
                                    <Alert variant="destructive">
                                        <TriangleAlert className="h-4 w-4" />
                                        <AlertDescription>
                                            <p className="font-medium">These could not be matched to a voucher (left unchanged):</p>
                                            <ul className="list-disc pl-5">
                                                {plan.warnings.map((w) => (
                                                    <li key={w}>{w}</li>
                                                ))}
                                            </ul>
                                        </AlertDescription>
                                    </Alert>
                                )}

                                <div className="overflow-x-auto rounded-md border">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Date</TableHead>
                                                <TableHead>Entry</TableHead>
                                                <TableHead>Voucher</TableHead>
                                                <TableHead>From ledger</TableHead>
                                                <TableHead>To ledger</TableHead>
                                                <TableHead className="text-right">Amount</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {plan.moves.length === 0 ? (
                                                <TableRow>
                                                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                                                        No posted GL vouchers for this loan — only the funder will change.
                                                    </TableCell>
                                                </TableRow>
                                            ) : (
                                                plan.moves.map((m) => (
                                                    <TableRow key={`${m.fromVoucherId}-${m.group}-${m.date}-${m.component}`}>
                                                        <TableCell>{toDisplayDate(m.date)}</TableCell>
                                                        <TableCell>
                                                            {m.group === 'DISBURSEMENT' ? 'Disbursement' : 'EOD collection'} · {m.component.toLowerCase()}
                                                        </TableCell>
                                                        <TableCell>{m.fromVoucherNo}</TableCell>
                                                        <TableCell>{m.fromLedgerName}</TableCell>
                                                        <TableCell>{m.toLedgerName}</TableCell>
                                                        <TableCell className="text-right">{inr(m.amount)}</TableCell>
                                                    </TableRow>
                                                ))
                                            )}
                                        </TableBody>
                                    </Table>
                                </div>

                                <div className="space-y-1">
                                    <Label htmlFor="funder-change-reason">Reason (audit log)</Label>
                                    <Textarea
                                        id="funder-change-reason"
                                        value={reason}
                                        onChange={(e) => setReason(e.target.value)}
                                        placeholder="e.g. Funding changed as per management request"
                                    />
                                </div>

                                <div className="flex justify-end">
                                    <Button onClick={() => setConfirmOpen(true)} disabled={reason.trim().length < 5}>
                                        <Repeat className="mr-2 h-4 w-4" /> Change funder
                                    </Button>
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>

                <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Confirm funder change</DialogTitle>
                            <DialogDescription>
                                Loan {selected.loanNumber}: {plan?.oldFunderName} → {plan?.newFunderName}. {plan?.moves.length ?? 0} GL
                                voucher entries will be rewritten on their original dates. This is recorded in the audit log.
                            </DialogDescription>
                        </DialogHeader>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={isSaving}>
                                Cancel
                            </Button>
                            <Button onClick={applyChange} disabled={isSaving}>
                                {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Confirm
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>
        );
    }

    // ── List ─────────────────────────────────────────────────────────────────
    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-lg sm:text-xl">Individual Funder Change</CardTitle>
                <CardDescription>
                    Super Control — change the funder of a live loan. This re-homes the loan and every posted GL voucher. Search a loan to begin.
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
                        placeholder="Loan no. / member ID / name"
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
                                <TableHead>Loan</TableHead>
                                <TableHead>Member</TableHead>
                                <TableHead>Branch / Center</TableHead>
                                <TableHead className="text-right">Amount</TableHead>
                                <TableHead>Funder</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead />
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoadingList ? (
                                <TableRow>
                                    <TableCell colSpan={7} className="text-center">
                                        <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                                    </TableCell>
                                </TableRow>
                            ) : loans.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={7} className="text-center text-muted-foreground">
                                        No loans found
                                    </TableCell>
                                </TableRow>
                            ) : (
                                loans.map((l) => (
                                    <TableRow key={l.loanId}>
                                        <TableCell className="font-medium">{l.loanNumber}</TableCell>
                                        <TableCell>
                                            {l.clientName}
                                            <div className="text-xs text-muted-foreground">{l.clientId}</div>
                                        </TableCell>
                                        <TableCell>
                                            {l.branchName}
                                            <div className="text-xs text-muted-foreground">{l.centerName}</div>
                                        </TableCell>
                                        <TableCell className="text-right">{inr(l.amount)}</TableCell>
                                        <TableCell>
                                            <Badge variant="secondary">{l.funderName}</Badge>
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant={l.disbursementStatus === 'CLOSED' ? 'outline' : 'default'}>{l.disbursementStatus}</Badge>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <Button size="sm" variant="outline" onClick={() => openLoan(l)}>
                                                Edit
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
        </Card>
    );
}
