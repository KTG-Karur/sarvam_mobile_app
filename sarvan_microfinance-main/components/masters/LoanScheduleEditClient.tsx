'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { ArrowLeft, ChevronLeft, ChevronRight, Loader2, Save, TriangleAlert } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { TableSearchInput } from '@/components/ui/table-search';
import { DateInput } from '@/components/ui/date-input';
import { toDisplayDate } from '@/app/lib/date-format';
import type { ScheduleEditPlan, ScheduleRowView } from '@/app/lib/services/loan-schedule-edit.service';

interface LoanRow {
    loanId: string;
    loanNumber: string;
    amount: number;
    disbursedAt: string | null;
    funderName: string;
    clientId: string;
    clientName: string;
    branchName: string;
    centerName: string;
    productName: string;
}

interface NamedRow {
    id: string;
    name: string;
    code?: string;
}

interface ScheduleResponse {
    loanId: string;
    loanNumber: string;
    rows: ScheduleRowView[];
    blockers: string[];
    amountLocks: string[];
}

type PlanView = Omit<ScheduleEditPlan, 'internal'>;

const PAGE_SIZE = 20;
const inr = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function addDaysYmd(ymd: string, days: number): string {
    const [y, m, d] = ymd.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d + days));
    return t.toISOString().slice(0, 10);
}
function diffDaysYmd(a: string, b: string): number {
    const p = (s: string) => {
        const [y, m, d] = s.split('-').map(Number);
        return Date.UTC(y, m - 1, d);
    };
    return Math.round((p(b) - p(a)) / 86400000);
}

export function LoanScheduleEditClient() {
    const { toast } = useToast();

    const [loans, setLoans] = useState<LoanRow[]>([]);
    const [isLoadingList, setIsLoadingList] = useState(true);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [query, setQuery] = useState('');
    const [branchFilter, setBranchFilter] = useState('');
    const [branches, setBranches] = useState<NamedRow[]>([]);

    const [selected, setSelected] = useState<LoanRow | null>(null);
    const [original, setOriginal] = useState<ScheduleRowView[]>([]);
    const [draft, setDraft] = useState<ScheduleRowView[]>([]);
    const [blockers, setBlockers] = useState<string[]>([]);
    const [amountLocks, setAmountLocks] = useState<string[]>([]);
    const [isLoadingSchedule, setIsLoadingSchedule] = useState(false);

    const [shiftFrom, setShiftFrom] = useState('1');
    const [shiftDays, setShiftDays] = useState('');
    const [newFirstDate, setNewFirstDate] = useState('');

    const [plan, setPlan] = useState<PlanView | null>(null);
    const [isPreviewing, setIsPreviewing] = useState(false);
    const [reason, setReason] = useState('');
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    const loadList = useCallback(async () => {
        setIsLoadingList(true);
        try {
            const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), status: 'DISBURSED' });
            if (query.trim()) params.set('q', query.trim());
            if (branchFilter) params.set('branchId', branchFilter);
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
    }, [page, query, branchFilter, toast]);

    useEffect(() => {
        if (!selected) loadList();
    }, [selected, loadList]);

    useEffect(() => {
        apiClient.get<NamedRow[]>('/branches').then((r) => r.success && r.data && setBranches(r.data));
    }, []);

    const loadSchedule = useCallback(
        async (loan: LoanRow) => {
            setIsLoadingSchedule(true);
            try {
                const res = await apiClient.get<ScheduleResponse>(`/super-control/loan-schedule-edit/loans/${loan.loanId}/schedule`);
                if (res.success && res.data) {
                    setOriginal(res.data.rows);
                    setDraft(res.data.rows.map((r) => ({ ...r })));
                    setBlockers(res.data.blockers);
                    setAmountLocks(res.data.amountLocks);
                } else {
                    toast({ title: 'Error', description: res.error || 'Failed to load schedule', variant: 'destructive' });
                }
            } finally {
                setIsLoadingSchedule(false);
            }
        },
        [toast]
    );

    const openLoan = (loan: LoanRow) => {
        setSelected(loan);
        setPlan(null);
        setReason('');
        setShiftDays('');
        setNewFirstDate('');
        setShiftFrom('1');
        loadSchedule(loan);
    };

    const amountsLocked = amountLocks.length > 0 || blockers.length > 0;
    // Only untouched (pending) installments are editable — a collected / part-collected one is frozen.
    const isRowLocked = (r: ScheduleRowView) =>
        r.status === 'PAID' || r.status === 'PARTIALLY_PAID' || r.status === 'WAIVED' || r.status === 'CLOSED' || r.principalPaid > 0 || r.interestPaid > 0;

    const edits = useMemo(() => {
        const out: { installmentNo: number; dueDate?: string; principalDue?: number; interestDue?: number; savingsDue?: number }[] = [];
        draft.forEach((d, i) => {
            const o = original[i];
            if (!o) return;
            const e: (typeof out)[number] = { installmentNo: d.installmentNo };
            if (d.dueDate !== o.dueDate) e.dueDate = d.dueDate;
            if (d.principalDue !== o.principalDue) e.principalDue = d.principalDue;
            if (d.interestDue !== o.interestDue) e.interestDue = d.interestDue;
            if (d.savingsDue !== o.savingsDue) e.savingsDue = d.savingsDue;
            if (Object.keys(e).length > 1) out.push(e);
        });
        return out;
    }, [draft, original]);

    const patchRow = (installmentNo: number, patch: Partial<ScheduleRowView>) => {
        setPlan(null);
        setDraft((rows) => rows.map((r) => (r.installmentNo === installmentNo ? { ...r, ...patch } : r)));
    };

    const applyShift = () => {
        const days = parseInt(shiftDays, 10);
        const from = parseInt(shiftFrom, 10);
        if (!Number.isFinite(days) || days === 0 || !Number.isFinite(from)) return;
        setPlan(null);
        setDraft((rows) => rows.map((r) => (r.installmentNo >= from && !isRowLocked(r) ? { ...r, dueDate: addDaysYmd(r.dueDate, days) } : r)));
    };

    const applyFirstDate = () => {
        const firstPending = draft.find((r) => !isRowLocked(r));
        if (!newFirstDate || !firstPending) return;
        const delta = diffDaysYmd(firstPending.dueDate, newFirstDate);
        if (delta === 0) return;
        setPlan(null);
        setDraft((rows) => rows.map((r) => (isRowLocked(r) ? r : { ...r, dueDate: addDaysYmd(r.dueDate, delta) })));
    };

    const resetDraft = () => {
        setPlan(null);
        setDraft(original.map((r) => ({ ...r })));
    };

    const runPreview = async () => {
        if (!selected) return;
        setIsPreviewing(true);
        try {
            const res = await apiClient.post<PlanView>(`/super-control/loan-schedule-edit/loans/${selected.loanId}/schedule`, {
                mode: 'preview',
                edits,
            });
            if (res.success && res.data) setPlan(res.data);
            else toast({ title: 'Cannot preview', description: res.error || 'Failed to build preview', variant: 'destructive' });
        } finally {
            setIsPreviewing(false);
        }
    };

    const apply = async () => {
        if (!selected || !plan) return;
        setIsSaving(true);
        try {
            const res = await apiClient.post<{ mode: string }>(`/super-control/loan-schedule-edit/loans/${selected.loanId}/schedule`, {
                mode: 'apply',
                edits,
                reason: reason.trim(),
                acknowledgeWarnings: plan.warnings.length > 0,
            });
            if (res.success) {
                toast({ title: 'Schedule updated', description: `Loan ${selected.loanNumber} (${res.data?.mode === 'AMOUNTS' ? 'amounts updated' : 'dates only'}).` });
                setConfirmOpen(false);
                setPlan(null);
                setReason('');
                await loadSchedule(selected);
            } else {
                toast({ title: 'Failed', description: res.error || 'Could not update schedule (nothing was changed)', variant: 'destructive' });
            }
        } finally {
            setIsSaving(false);
        }
    };

    // ── Detail ───────────────────────────────────────────────────────────────
    if (selected) {
        const changedNos = new Set(edits.map((e) => e.installmentNo));
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
                            {selected.clientId} · {selected.branchName} · {selected.centerName} · {selected.productName} · {inr(selected.amount)} ·{' '}
                            <Badge variant="secondary">{selected.funderName}</Badge>
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {blockers.length > 0 && (
                            <Alert variant="destructive">
                                <TriangleAlert className="h-4 w-4" />
                                <AlertDescription>{blockers.join(' ')}</AlertDescription>
                            </Alert>
                        )}
                        {amountLocks.length > 0 && (
                            <Alert>
                                <AlertDescription>
                                    Installment <b>amounts</b> are locked ({amountLocks.join(', ')}). Due dates can still be edited.
                                </AlertDescription>
                            </Alert>
                        )}
                        <Alert>
                            <AlertDescription>
                                Only <b>pending</b> installments can be edited (collected rows are locked). Edits are in place — collections, GL vouchers and the loan&apos;s paid totals are not changed. Collection dates are not
                                editable here. Historical DCR/demand snapshots captured at collection time keep their old values.
                            </AlertDescription>
                        </Alert>

                        <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-2 lg:grid-cols-3">
                            <div className="space-y-1">
                                <Label>Shift due dates from installment</Label>
                                <div className="flex gap-2">
                                    <Input type="number" min={1} value={shiftFrom} onChange={(e) => setShiftFrom(e.target.value)} className="w-20" />
                                    <Input type="number" placeholder="± days" value={shiftDays} onChange={(e) => setShiftDays(e.target.value)} />
                                    <Button type="button" variant="outline" onClick={applyShift} disabled={!shiftDays}>
                                        Shift
                                    </Button>
                                </div>
                            </div>
                            <div className="space-y-1">
                                <Label>Set next pending due date (shifts all pending)</Label>
                                <div className="flex gap-2">
                                    <Input type="date" value={newFirstDate} onChange={(e) => setNewFirstDate(e.target.value)} />
                                    <Button type="button" variant="outline" onClick={applyFirstDate} disabled={!newFirstDate}>
                                        Apply
                                    </Button>
                                </div>
                            </div>
                            <div className="flex items-end">
                                <Button type="button" variant="ghost" onClick={resetDraft} disabled={edits.length === 0}>
                                    Reset changes
                                </Button>
                            </div>
                        </div>

                        {isLoadingSchedule ? (
                            <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                        ) : (
                            <div className="overflow-x-auto rounded-md border">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>#</TableHead>
                                            <TableHead>Due Date</TableHead>
                                            <TableHead>Principal Due</TableHead>
                                            <TableHead>Interest Due</TableHead>
                                            <TableHead>Savings Due</TableHead>
                                            <TableHead>Total</TableHead>
                                            <TableHead>Paid (P / I)</TableHead>
                                            <TableHead>Outstanding</TableHead>
                                            <TableHead>Received Date</TableHead>
                                            <TableHead>Status</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {draft.map((r) => (
                                            <TableRow key={r.installmentNo} className={changedNos.has(r.installmentNo) ? 'bg-amber-50 dark:bg-amber-950/20' : ''}>
                                                <TableCell>{r.installmentNo}</TableCell>
                                                <TableCell>
                                                    <DateInput
                                                        className="h-8 min-w-[140px] text-sm"
                                                        value={r.dueDate}
                                                        disabled={blockers.length > 0 || isRowLocked(r)}
                                                        onChange={(e) => e.target.value && patchRow(r.installmentNo, { dueDate: e.target.value })}
                                                    />
                                                </TableCell>
                                                {(['principalDue', 'interestDue', 'savingsDue'] as const).map((f) => (
                                                    <TableCell key={f}>
                                                        <Input
                                                            type="number"
                                                            step="0.01"
                                                            min={0}
                                                            className="h-8 min-w-[90px] text-sm"
                                                            value={r[f]}
                                                            disabled={amountsLocked || isRowLocked(r)}
                                                            onChange={(e) => patchRow(r.installmentNo, { [f]: e.target.value === '' ? 0 : Number(e.target.value) })}
                                                        />
                                                    </TableCell>
                                                ))}
                                                <TableCell>{(r.principalDue + r.interestDue).toFixed(2)}</TableCell>
                                                <TableCell className="text-xs">
                                                    {r.principalPaid} / {r.interestPaid}
                                                </TableCell>
                                                <TableCell>
                                                    {Math.max(0, r.principalDue + r.interestDue - r.principalPaid - r.interestPaid).toFixed(2)}
                                                </TableCell>
                                                <TableCell>{r.paidAt ? toDisplayDate(r.paidAt) : '—'}</TableCell>
                                                <TableCell>
                                                    <Badge variant="outline">{r.status}</Badge>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        )}

                        <div className="flex items-center justify-between">
                            <span className="text-sm text-muted-foreground">{edits.length} installment(s) changed</span>
                            <Button onClick={runPreview} disabled={edits.length === 0 || isPreviewing || blockers.length > 0}>
                                {isPreviewing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Preview changes
                            </Button>
                        </div>
                    </CardContent>
                </Card>

                {plan && (
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base">
                                Preview — {plan.mode === 'AMOUNTS' ? 'installment amounts changed (pending installments only)' : 'due dates only'}
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            {plan.errors.length > 0 && (
                                <Alert variant="destructive">
                                    <TriangleAlert className="h-4 w-4" />
                                    <AlertDescription>
                                        <ul className="list-disc pl-5">
                                            {plan.errors.map((e) => (
                                                <li key={e}>{e}</li>
                                            ))}
                                        </ul>
                                    </AlertDescription>
                                </Alert>
                            )}
                            {plan.warnings.length > 0 && (
                                <Alert>
                                    <TriangleAlert className="h-4 w-4" />
                                    <AlertDescription>
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
                                            <TableHead>#</TableHead>
                                            <TableHead>Due date</TableHead>
                                            <TableHead className="text-right">Principal</TableHead>
                                            <TableHead className="text-right">Interest</TableHead>
                                            <TableHead className="text-right">Savings</TableHead>
                                            <TableHead className="text-right">Paid (P / I)</TableHead>
                                            <TableHead>Status</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {plan.after.map((a, i) => {
                                            const b = plan.before[i];
                                            const changed = JSON.stringify(a) !== JSON.stringify(b);
                                            if (!changed) return null;
                                            return (
                                                <TableRow key={a.installmentNo}>
                                                    <TableCell>{a.installmentNo}</TableCell>
                                                    <TableCell>
                                                        {a.dueDate !== b.dueDate ? (
                                                            <>
                                                                <span className="text-muted-foreground line-through">{toDisplayDate(b.dueDate)}</span> → {toDisplayDate(a.dueDate)}
                                                            </>
                                                        ) : (
                                                            toDisplayDate(a.dueDate)
                                                        )}
                                                    </TableCell>
                                                    <TableCell className="text-right">
                                                        {a.principalDue !== b.principalDue ? `${b.principalDue} → ${a.principalDue}` : a.principalDue}
                                                    </TableCell>
                                                    <TableCell className="text-right">
                                                        {a.interestDue !== b.interestDue ? `${b.interestDue} → ${a.interestDue}` : a.interestDue}
                                                    </TableCell>
                                                    <TableCell className="text-right">
                                                        {a.savingsDue !== b.savingsDue ? `${b.savingsDue} → ${a.savingsDue}` : a.savingsDue}
                                                    </TableCell>
                                                    <TableCell className="text-right text-xs">
                                                        {b.principalPaid} / {b.interestPaid} → {a.principalPaid} / {a.interestPaid}
                                                    </TableCell>
                                                    <TableCell>{b.status !== a.status ? `${b.status} → ${a.status}` : a.status}</TableCell>
                                                </TableRow>
                                            );
                                        })}
                                    </TableBody>
                                </Table>
                            </div>
                            {plan.errors.length === 0 && (
                                <>
                                    <div className="space-y-1">
                                        <Label htmlFor="schedule-edit-reason">Reason (audit log)</Label>
                                        <Textarea
                                            id="schedule-edit-reason"
                                            value={reason}
                                            onChange={(e) => setReason(e.target.value)}
                                            placeholder="e.g. Due dates corrected as per center meeting day"
                                        />
                                    </div>
                                    <div className="flex justify-end">
                                        <Button onClick={() => setConfirmOpen(true)} disabled={reason.trim().length < 5}>
                                            <Save className="mr-2 h-4 w-4" /> Apply changes
                                        </Button>
                                    </div>
                                </>
                            )}
                        </CardContent>
                    </Card>
                )}

                <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Confirm schedule edit</DialogTitle>
                            <DialogDescription>
                                Loan {selected.loanNumber}: {edits.length} installment(s) will be updated in place and recorded in the audit log.
                            </DialogDescription>
                        </DialogHeader>
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

    // ── List ─────────────────────────────────────────────────────────────────
    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-lg sm:text-xl">Live Loan Schedule Edit</CardTitle>
                <CardDescription>
                    Super Control — edit the Loan Card (due dates / installment amounts) of a live disbursed loan, in place. Search a loan to begin.
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
                </div>

                <div className="overflow-x-auto rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Loan</TableHead>
                                <TableHead>Member</TableHead>
                                <TableHead>Branch / Center</TableHead>
                                <TableHead className="text-right">Amount</TableHead>
                                <TableHead>Disbursed</TableHead>
                                <TableHead />
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoadingList ? (
                                <TableRow>
                                    <TableCell colSpan={6} className="text-center">
                                        <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                                    </TableCell>
                                </TableRow>
                            ) : loans.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={6} className="text-center text-muted-foreground">
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
                                        <TableCell>{l.disbursedAt ? toDisplayDate(l.disbursedAt) : '—'}</TableCell>
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
