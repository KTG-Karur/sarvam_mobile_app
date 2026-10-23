'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Loader2, RotateCcw, Lock, CheckCircle2, Maximize2, Minimize2 } from 'lucide-react';
import { PageLoader } from '@/components/ui/page-loader';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { RevertLocationPicker, type RevertLocationValue } from '@/components/revert/RevertLocationPicker';
import { cn } from '@/lib/utils';
import { formatCurrency, formatDate } from '@/components/approval/collection-modes/types';

const DENOM_NOTES = [500, 200, 100, 50, 20, 10, 5, 2, 1] as const;
type DenomKey = `d${typeof DENOM_NOTES[number]}`;
type DenomCounts = Record<DenomKey, number>;

const keyFor = (v: number): DenomKey => `d${v}` as DenomKey;

type BatchTransaction = {
    transactionId: string;
    clientId: string;
    clientCode: string;
    clientName: string;
    loanNumber: string;
    amount: number;
    principalAmount: number;
    interestAmount: number;
    isReversed: boolean;
    isEodLocked: boolean;
    /** Still allocated for EOD (LoanTransaction.eodAllocatedAt set) — must be
     *  reverted via Allocation Revert before this collection can be reverted. */
    isAllocationLocked: boolean;
    /** Loan-advance/savings cash — counts toward the batch total but is never
     *  selectable here; it has its own ADMIN-only, LIFO-guarded revert flow. */
    isSavingsRow: boolean;
};

type BatchDetail = {
    collectionBatchId: string;
    center: { name: string; code: string };
    branch: { name: string; code: string };
    collectionDate: string;
    submittedBy: string | null;
    photoUrl: string;
    denomination: DenomCounts & { upi: number; totalAmount: number };
    transactions: BatchTransaction[];
};

/** Greedy largest-note-first subtraction — a starting suggestion the BM can hand-edit. */
function suggestDenomination(current: DenomCounts, amountToRemove: number): DenomCounts {
    let remaining = Math.max(0, Math.round(amountToRemove));
    const next: DenomCounts = { ...current };
    for (const note of DENOM_NOTES) {
        if (remaining <= 0) break;
        const key = keyFor(note);
        const removable = Math.min(next[key], Math.floor(remaining / note));
        next[key] -= removable;
        remaining -= removable * note;
    }
    return next;
}

function denomTotal(counts: DenomCounts, upi: number): number {
    return DENOM_NOTES.reduce((sum, note) => sum + counts[keyFor(note)] * note, 0) + (Number(upi) || 0);
}

export function BatchRevertDialog({
    collectionBatchId,
    preselectedTransactionId,
    onClose,
    onReverted,
}: {
    collectionBatchId: string;
    /** When opened from a single row's Revert button, only that client starts checked. */
    preselectedTransactionId?: string;
    onClose: () => void;
    onReverted: () => void;
}) {
    const { toast } = useToast();
    const [loading, setLoading] = useState(true);
    const [detail, setDetail] = useState<BatchDetail | null>(null);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [counts, setCounts] = useState<DenomCounts>({
        d500: 0, d200: 0, d100: 0, d50: 0, d20: 0, d10: 0, d5: 0, d2: 0, d1: 0,
    });
    const [upi, setUpi] = useState(0);
    const [reason, setReason] = useState('');
    const [revertLocation, setRevertLocation] = useState<RevertLocationValue | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [isFullSize, setIsFullSize] = useState(false);

    // Mirrors `selected` so loadDetail() can read the latest selection synchronously
    // (a preserved-selection reload must filter the CURRENT picks, not last render's).
    const selectedRef = useRef<Set<string>>(selected);
    useEffect(() => { selectedRef.current = selected; }, [selected]);

    // Fetches (or re-fetches, e.g. after an inline loan-advance revert) the batch's
    // current state. `preserveSelection` keeps whatever the BM already picked on the
    // main table instead of recomputing the default selection from scratch.
    const loadDetail = useCallback((preserveSelection: boolean) => {
        let cancelled = false;
        setLoading(true);
        apiClient
            .get<BatchDetail>(`/collections/client/reverse/meeting?collectionBatchId=${collectionBatchId}`)
            .then((res) => {
                if (cancelled) return;
                if (res.success && res.data) {
                    const data = res.data;
                    setDetail(data);

                    const nextSelected = preserveSelection
                        ? new Set([...selectedRef.current].filter((id) => data.transactions.some((t) => t.transactionId === id)))
                        : preselectedTransactionId
                            ? new Set([preselectedTransactionId])
                            : new Set(
                                  data.transactions
                                      .filter((t) => !t.isReversed && !t.isEodLocked && !t.isAllocationLocked && !t.isSavingsRow)
                                      .map((t) => t.transactionId)
                              );
                    setSelected(nextSelected);

                    // Re-derive the suggested denomination from the freshly-fetched
                    // record right here — the [selectedTotal] effect below won't fire
                    // on its own since an advance-row revert never changes selection.
                    const selectedTotalNow = data.transactions
                        .filter((t) => nextSelected.has(t.transactionId))
                        .reduce((sum, t) => sum + t.amount, 0);
                    const original = data.denomination;
                    setCounts(suggestDenomination(
                        { d500: original.d500, d200: original.d200, d100: original.d100, d50: original.d50, d20: original.d20, d10: original.d10, d5: original.d5, d2: original.d2, d1: original.d1 },
                        selectedTotalNow
                    ));
                    setUpi(original.upi);
                } else {
                    toast({ title: 'Error', description: res.error || 'Failed to load batch details.', variant: 'destructive' });
                }
            })
            .catch(() => {
                if (!cancelled) toast({ title: 'Error', description: 'Could not connect to the server.', variant: 'destructive' });
            })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [collectionBatchId]);

    useEffect(() => {
        return loadDetail(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [collectionBatchId]);

    // Picking a client's normal collection row also sweeps in that same loan's
    // loan-advance row (matched by loanNumber) — the server reverts it in the same
    // transaction (POST /api/collections/client/reverse), for every role allowed to
    // revert, so the totals and denomination below must include it.
    const linkedSavingsIds = useMemo(() => {
        if (!detail) return new Set<string>();
        const selectedLoanNumbers = new Set(
            detail.transactions.filter((t) => selected.has(t.transactionId)).map((t) => t.loanNumber)
        );
        return new Set(
            detail.transactions
                .filter((t) => t.isSavingsRow && !t.isReversed && !t.isEodLocked && !t.isAllocationLocked && selectedLoanNumbers.has(t.loanNumber))
                .map((t) => t.transactionId)
        );
    }, [detail, selected]);

    const selectedTotal = useMemo(() => {
        if (!detail) return 0;
        return detail.transactions
            .filter((t) => selected.has(t.transactionId) || linkedSavingsIds.has(t.transactionId))
            .reduce((sum, t) => sum + t.amount, 0);
    }, [detail, selected, linkedSavingsIds]);

    // Auto-suggest whenever the selection changes, starting from the record's
    // original denomination — the BM can still hand-edit every field after.
    useEffect(() => {
        if (!detail) return;
        const original = detail.denomination;
        const suggested = suggestDenomination(
            { d500: original.d500, d200: original.d200, d100: original.d100, d50: original.d50, d20: original.d20, d10: original.d10, d5: original.d5, d2: original.d2, d1: original.d1 },
            selectedTotal
        );
        setCounts(suggested);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedTotal]);

    const remainingRequired = useMemo(() => {
        if (!detail) return 0;
        return detail.transactions
            .filter((t) => !t.isReversed && !selected.has(t.transactionId) && !linkedSavingsIds.has(t.transactionId))
            .reduce((sum, t) => sum + t.amount, 0);
    }, [detail, selected, linkedSavingsIds]);

    const enteredTotal = denomTotal(counts, upi);
    const isBalanced = Math.round(enteredTotal) === Math.round(remainingRequired);

    const toggleRow = (t: BatchTransaction) => {
        if (t.isReversed || t.isEodLocked || t.isAllocationLocked || t.isSavingsRow) return;
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(t.transactionId)) next.delete(t.transactionId);
            else next.add(t.transactionId);
            return next;
        });
    };

    const toggleAll = () => {
        if (!detail) return;
        const revertible = detail.transactions.filter((t) => !t.isReversed && !t.isEodLocked && !t.isAllocationLocked && !t.isSavingsRow);
        const allSelected = revertible.every((t) => selected.has(t.transactionId));
        setSelected(allSelected ? new Set() : new Set(revertible.map((t) => t.transactionId)));
    };

    const handleConfirm = async () => {
        if (selected.size === 0 || !isBalanced || !revertLocation) return;
        setSubmitting(true);
        try {
            const res = await apiClient.post<{ count: number }>('/collections/client/reverse', {
                transactionIds: [...selected],
                remarks: reason,
                latitude: revertLocation.latitude,
                longitude: revertLocation.longitude,
                denomination: { ...counts, upi },
            });
            if (res.success) {
                toast({ title: 'Reverted', description: res.message || 'Collection(s) reverted successfully.' });
                onReverted();
                onClose();
            } else {
                toast({
                    title: 'Revert Failed',
                    description: res.error || 'Please try again.',
                    variant: 'destructive',
                });
            }
        } catch {
            toast({ title: 'Error', description: 'An unexpected error occurred.', variant: 'destructive' });
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            {/*
                Width/height are overridden via inline `style`, never className, and
                top/left/transform are never touched at all:
                - `sm:max-w-lg` on the base DialogContent (components/ui/dialog.tsx) wins
                  over any unprefixed `max-w-*` override in the generated stylesheet
                  regardless of className/twMerge order at this viewport (a pre-existing
                  quirk — the original `max-w-4xl` was already silently losing to it).
                  Inline style has no such ordering ambiguity, so it's used for width/height.
                - The base `data-[state=open]:animate-in zoom-in-95` (tailwindcss-animate)
                  runs a CSS Animation with `animation-fill-mode: forwards` that holds
                  `transform: translate(-50%,-50%) scale(1)` on this element indefinitely.
                  CSS Animations outrank inline styles in the cascade, so an inline
                  `transform: none` can never win — leaving `top-[50%] left-[50%]
                  translate-x-[-50%] translate-y-[-50%]` alone instead re-centers the
                  enlarged box for free (translate is proportional to the element's own,
                  now-larger, size).
            */}
            <DialogContent
                className={cn('overflow-y-auto', !isFullSize && 'max-w-4xl max-h-[90vh]')}
                style={isFullSize ? { width: '96vw', maxWidth: '96vw', height: '96vh', maxHeight: '96vh' } : undefined}
            >
                <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="absolute top-3 right-12 h-7 w-7"
                    onClick={() => setIsFullSize((v) => !v)}
                    title={isFullSize ? 'Restore size' : 'Full size'}
                >
                    {isFullSize ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                </Button>
                <DialogHeader>
                    <DialogTitle>Revert Center Collection</DialogTitle>
                    <DialogDescription>
                        Review the meeting, pick the client(s) to revert, and correct the denomination before confirming.
                    </DialogDescription>
                </DialogHeader>

                {loading ? (
                    <PageLoader label="Loading batch details..." fullScreen={false} />
                ) : !detail ? (
                    <p className="text-center text-muted-foreground py-8">Could not load this batch.</p>
                ) : (
                    <div className="space-y-6">
                        {/* Meeting context */}
                        <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-4 items-start">
                            <img
                                src={detail.photoUrl}
                                alt="Collection meeting"
                                className="w-40 h-40 object-cover rounded-lg border"
                            />
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                                <div className="text-muted-foreground">Center</div>
                                <div className="font-medium">{detail.center.code} - {detail.center.name}</div>
                                <div className="text-muted-foreground">Collection Date</div>
                                <div className="font-medium">{formatDate(detail.collectionDate)}</div>
                                <div className="text-muted-foreground">Submitted By</div>
                                <div className="font-medium">{detail.submittedBy || 'N/A'}</div>
                                <div className="text-muted-foreground">Original Total</div>
                                <div className="font-medium">{formatCurrency(detail.denomination.totalAmount)}</div>
                            </div>
                        </div>

                        {/* Client list */}
                        <div className="rounded-lg border overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-10">
                                            <Checkbox
                                                checked={detail.transactions.filter(t => !t.isReversed && !t.isEodLocked && !t.isAllocationLocked && !t.isSavingsRow).length > 0 &&
                                                    detail.transactions.filter(t => !t.isReversed && !t.isEodLocked && !t.isAllocationLocked && !t.isSavingsRow).every(t => selected.has(t.transactionId))}
                                                onCheckedChange={toggleAll}
                                            />
                                        </TableHead>
                                        <TableHead>Member</TableHead>
                                        <TableHead>Loan A/c</TableHead>
                                        <TableHead className="text-right">Principal</TableHead>
                                        <TableHead className="text-right">Interest</TableHead>
                                        <TableHead className="text-right">Total</TableHead>
                                        <TableHead>Status</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {detail.transactions.map((t) => (
                                        <TableRow key={t.transactionId} className={t.isReversed ? 'opacity-50' : ''}>
                                            <TableCell>
                                                <Checkbox
                                                    checked={t.isSavingsRow ? linkedSavingsIds.has(t.transactionId) : selected.has(t.transactionId)}
                                                    disabled={t.isReversed || t.isEodLocked || t.isAllocationLocked || t.isSavingsRow}
                                                    onCheckedChange={() => toggleRow(t)}
                                                />
                                            </TableCell>
                                            <TableCell>{t.clientName} <span className="text-xs text-muted-foreground">({t.clientCode})</span></TableCell>
                                            <TableCell className="font-mono text-xs">{t.loanNumber}</TableCell>
                                            <TableCell className="text-right">{t.isSavingsRow ? '—' : formatCurrency(t.principalAmount)}</TableCell>
                                            <TableCell className="text-right">{t.isSavingsRow ? '—' : formatCurrency(t.interestAmount)}</TableCell>
                                            <TableCell className="text-right font-medium">{formatCurrency(t.amount)}{t.isSavingsRow && <span className="ml-1 text-[10px] text-muted-foreground">(advance)</span>}</TableCell>
                                            <TableCell>
                                                {t.isSavingsRow ? (
                                                    t.isReversed ? (
                                                        <span className="inline-flex items-center text-xs text-muted-foreground"><CheckCircle2 className="h-3 w-3 mr-1" /> Already reverted</span>
                                                    ) : linkedSavingsIds.has(t.transactionId) ? (
                                                        <span className="inline-flex items-center text-xs text-emerald-600"><CheckCircle2 className="h-3 w-3 mr-1" /> Included with revert</span>
                                                    ) : t.isAllocationLocked ? (
                                                        <span className="inline-flex items-center text-xs text-amber-600"><Lock className="h-3 w-3 mr-1" /> Allocated — revert allocation first</span>
                                                    ) : (
                                                        <span className="text-xs text-amber-600">Loan advance — use Loan Advance Revert</span>
                                                    )
                                                ) : t.isReversed ? (
                                                    <span className="inline-flex items-center text-xs text-muted-foreground"><CheckCircle2 className="h-3 w-3 mr-1" /> Already reverted</span>
                                                ) : t.isEodLocked ? (
                                                    <span className="inline-flex items-center text-xs text-muted-foreground"><Lock className="h-3 w-3 mr-1" /> EOD locked</span>
                                                ) : t.isAllocationLocked ? (
                                                    <span className="inline-flex items-center text-xs text-amber-600"><Lock className="h-3 w-3 mr-1" /> Allocated — revert allocation first</span>
                                                ) : (
                                                    <span className="text-xs text-emerald-600">Revertible</span>
                                                )}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>

                        {/* Denomination correction */}
                        <div>
                            <Label className="mb-2 block font-semibold">Corrected Denomination</Label>
                            <p className="text-xs text-muted-foreground mb-3">
                                Suggested automatically from the amount being reverted (₹{selectedTotal.toLocaleString('en-IN')}) — edit any field to match what&apos;s physically left.
                            </p>
                            <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
                                {DENOM_NOTES.map((note) => (
                                    <div key={note}>
                                        <Label className="text-xs mb-1 block">₹{note}</Label>
                                        <Input
                                            type="number"
                                            min={0}
                                            value={counts[keyFor(note)]}
                                            onChange={(e) => setCounts((prev) => ({ ...prev, [keyFor(note)]: Math.max(0, Number(e.target.value) || 0) }))}
                                        />
                                    </div>
                                ))}
                                <div>
                                    <Label className="text-xs mb-1 block">UPI</Label>
                                    <Input
                                        type="number"
                                        min={0}
                                        value={upi}
                                        onChange={(e) => setUpi(Math.max(0, Number(e.target.value) || 0))}
                                    />
                                </div>
                            </div>
                            <div className="mt-3 flex items-center justify-between text-sm">
                                <span>Entered Total: <strong>{formatCurrency(enteredTotal)}</strong></span>
                                <span>Must Equal Remaining: <strong>{formatCurrency(remainingRequired)}</strong></span>
                                {!isBalanced && (
                                    <span className="text-rose-600 font-medium">Does not match — adjust denomination</span>
                                )}
                            </div>
                        </div>

                        <div>
                            <Label className="mb-1.5 block">Reason (optional)</Label>
                            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this being reverted?" />
                        </div>

                        <RevertLocationPicker value={revertLocation} onChange={setRevertLocation} disabled={submitting} />
                    </div>
                )}

                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
                    <Button
                        className="bg-rose-600 hover:bg-rose-700 text-white"
                        onClick={handleConfirm}
                        disabled={submitting || loading || selected.size === 0 || !isBalanced || !revertLocation}
                    >
                        {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RotateCcw className="h-4 w-4 mr-2" />}
                        Revert {selected.size > 0 ? `${selected.size} Selected` : ''}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
