'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { CheckCircle, XCircle, Loader2, RotateCcw } from 'lucide-react';
import { stripPostingMarker } from '@/app/lib/narration';

export const TRANSACTION_TYPE_LABELS: Record<string, string> = {
    CASH_RECEIPT: 'Cash Receipt',
    CASH_PAYMENT: 'Cash Payment',
    BANK_RECEIPT: 'Bank Receipt',
    BANK_PAYMENT: 'Bank Payment',
    JOURNAL: 'Journal',
    CONTRA: 'Contra',
};

export interface TransactionModalRow {
    id: string;
    voucherNo: string;
    type: string;
    transactionDate: string;
    amount: number;
    description?: string | null;
    approvalStatus: string;
    instrumentNo?: string | null;
    bankName?: string | null;
    createdBy?: { firstName: string; lastName: string } | null;
    createdByRole?: string | null;
    rejectionReason?: string | null;
    rejectedBy?: { firstName: string; lastName: string } | null;
    rejectedAt?: string | null;
    revertReason?: string | null;
    revertedBy?: { firstName: string; lastName: string } | null;
    revertedAt?: string | null;
    amApprovedBy?: { firstName: string; lastName: string } | null;
    amApprovedAt?: string | null;
    adminApprovedBy?: { firstName: string; lastName: string } | null;
    adminApprovedAt?: string | null;
    branch?: { id: string; code: string; name: string } | null;
    selfAccount?: { name: string } | null;
    contraAccount?: { name: string } | null;
    ledger?: { ledgerName: string } | null;
    creditLedger?: { ledgerName: string } | null;
    /** Set by the approval queue endpoint. */
    eodLocked?: boolean;
    /** Set by the per-type list endpoints (inverse of eodLocked). */
    canModify?: boolean;
}

function formatCurrency(amount: number) {
    return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        minimumFractionDigits: 2,
    }).format(amount);
}

function getInstrumentDisplay(tx: TransactionModalRow): string | undefined {
    if (!tx.instrumentNo && !tx.bankName) return undefined;
    return [tx.bankName, tx.instrumentNo ? `#${tx.instrumentNo}` : null].filter(Boolean).join(' ').trim() || undefined;
}

function getThroughAndPaidTo(tx: TransactionModalRow): { through: string; paidTo: string } {
    const instrument = getInstrumentDisplay(tx);
    switch (tx.type) {
        case 'CASH_RECEIPT':
        case 'BANK_RECEIPT':
        case 'CASH_PAYMENT':
        case 'BANK_PAYMENT':
            return {
                through: instrument || tx.selfAccount?.name || '—',
                paidTo: tx.ledger?.ledgerName || '—',
            };
        case 'JOURNAL':
            return {
                through: tx.ledger?.ledgerName || '—',
                paidTo: tx.creditLedger?.ledgerName || '—',
            };
        case 'CONTRA':
            return {
                through: tx.selfAccount?.name || '—',
                paidTo: tx.contraAccount?.name || '—',
            };
        default:
            return { through: '—', paidTo: '—' };
    }
}

function getApprovedByDisplay(tx: TransactionModalRow): { name: string; at?: string | null } | null {
    if (tx.amApprovedBy) return { name: `${tx.amApprovedBy.firstName} ${tx.amApprovedBy.lastName}`, at: tx.amApprovedAt };
    if (tx.adminApprovedBy) return { name: `${tx.adminApprovedBy.firstName} ${tx.adminApprovedBy.lastName}`, at: tx.adminApprovedAt };
    return null;
}

function getDebitCreditNames(tx: TransactionModalRow): { debitName: string; creditName: string } {
    switch (tx.type) {
        case 'CASH_RECEIPT':
        case 'BANK_RECEIPT':
            return { debitName: tx.selfAccount?.name || '—', creditName: tx.ledger?.ledgerName || '—' };
        case 'CASH_PAYMENT':
        case 'BANK_PAYMENT':
            return { debitName: tx.ledger?.ledgerName || '—', creditName: tx.selfAccount?.name || '—' };
        case 'JOURNAL':
            return { debitName: tx.ledger?.ledgerName || '—', creditName: tx.creditLedger?.ledgerName || '—' };
        case 'CONTRA':
            return { debitName: tx.selfAccount?.name || '—', creditName: tx.contraAccount?.name || '—' };
        default:
            return { debitName: '—', creditName: '—' };
    }
}

interface TransactionApprovalModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    transaction: TransactionModalRow | null;
    canAct: boolean;
    /** Admin/Sub-Admin only — no AM branch-scope allowance, unlike canAct. */
    canRevertRole: boolean;
    onActionComplete: () => void;
}

export function TransactionApprovalModal({ open, onOpenChange, transaction, canAct, canRevertRole, onActionComplete }: TransactionApprovalModalProps) {
    const { toast } = useToast();
    const [isRejecting, setIsRejecting] = useState(false);
    const [rejectionReason, setRejectionReason] = useState('');
    const [isReverting, setIsReverting] = useState(false);
    const [revertReason, setRevertReason] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    if (!transaction) return null;

    const { through, paidTo } = getThroughAndPaidTo(transaction);
    const { debitName, creditName } = getDebitCreditNames(transaction);
    const approvedByDisplay = getApprovedByDisplay(transaction);
    const title = `${TRANSACTION_TYPE_LABELS[transaction.type] ?? transaction.type} Voucher`;
    const isPending = transaction.approvalStatus === 'PENDING_APPROVAL';
    const isApproved = transaction.approvalStatus === 'APPROVED';
    const isRejected = transaction.approvalStatus === 'REJECTED';
    const isReverted = transaction.approvalStatus === 'REVERTED';
    const isEodLocked = transaction.eodLocked === true || transaction.canModify === false;
    // Approve applies to a pending transaction, or reverses a REJECTED one back
    // to APPROVED. Reject applies to a pending transaction, an APPROVED one, or
    // a REVERTED one (skip editing and mark it dead-end instead of resubmitting
    // it). Either direction requires EOD not to have closed this transaction's
    // branch/date yet.
    const canApprove = canAct && (isPending || isRejected) && !isEodLocked;
    const canReject = canAct && (isPending || isApproved || isReverted) && !isEodLocked;
    // Revert is Admin/Sub-Admin only (canRevertRole), unlike approve/reject
    // which AM can also do — and only ever applies to an APPROVED transaction.
    const canRevert = canRevertRole && isApproved && !isEodLocked;
    const showActions = canAct && (isPending || isApproved || isRejected || isReverted);

    const resetLocal = () => {
        setIsRejecting(false);
        setRejectionReason('');
        setIsReverting(false);
        setRevertReason('');
    };

    const handleClose = (next: boolean) => {
        if (!next) resetLocal();
        onOpenChange(next);
    };

    const handleApprove = async () => {
        setIsSubmitting(true);
        try {
            const res = await fetch(`/api/transactions/approval/${transaction.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'approve' }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Failed to approve');
            toast({
                title: 'Approved',
                description: data.message || 'Voucher approved successfully.',
                className: 'bg-emerald-50 border-emerald-200 text-emerald-800',
            });
            resetLocal();
            onActionComplete();
            onOpenChange(false);
        } catch (err: any) {
            toast({ title: 'Error', description: err.message, variant: 'destructive' });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleReject = async () => {
        if (!rejectionReason.trim()) {
            toast({ title: 'Required', description: 'Please provide a rejection reason', variant: 'destructive' });
            return;
        }
        setIsSubmitting(true);
        try {
            const res = await fetch(`/api/transactions/approval/${transaction.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'reject', rejectionReason }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Failed to reject');
            toast({ title: 'Rejected', description: data.message || 'Voucher rejected.' });
            resetLocal();
            onActionComplete();
            onOpenChange(false);
        } catch (err: any) {
            toast({ title: 'Error', description: err.message, variant: 'destructive' });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleRevert = async () => {
        if (!revertReason.trim()) {
            toast({ title: 'Required', description: 'Please provide a revert reason', variant: 'destructive' });
            return;
        }
        setIsSubmitting(true);
        try {
            const res = await fetch(`/api/transactions/approval/${transaction.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'revert', revertReason }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Failed to revert');
            toast({ title: 'Reverted', description: data.message || 'Voucher reverted.' });
            resetLocal();
            onActionComplete();
            onOpenChange(false);
        } catch (err: any) {
            toast({ title: 'Error', description: err.message, variant: 'destructive' });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="sm:max-w-[560px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        {title}
                        {(isApproved || isReverted) && <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300">Approved</Badge>}
                        {isRejected && <Badge className="bg-red-100 text-red-800 border-red-300">Rejected</Badge>}
                        {isPending && <Badge className="bg-amber-100 text-amber-800 border-amber-300">Pending</Badge>}
                    </DialogTitle>
                </DialogHeader>

                <div className="space-y-3 text-sm">
                    <div className="grid grid-cols-2 gap-2">
                        <div><span className="font-semibold">Branch Name :</span> {transaction.branch ? `${transaction.branch.code}-${transaction.branch.name}` : '—'}</div>
                        <div><span className="font-semibold">Voucher No :</span> {transaction.voucherNo}</div>
                        <div><span className="font-semibold">Date :</span> {format(new Date(transaction.transactionDate), 'dd/MM/yyyy')}</div>
                        <div><span className="font-semibold">Through :</span> {through}</div>
                        <div className="col-span-2"><span className="font-semibold">Paid To :</span> {paidTo}</div>
                    </div>

                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Ledger Head</TableHead>
                                <TableHead className="text-right">Debit</TableHead>
                                <TableHead className="text-right">Credit</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            <TableRow>
                                <TableCell>{debitName}</TableCell>
                                <TableCell className="text-right">{formatCurrency(transaction.amount)}</TableCell>
                                <TableCell className="text-right">₹0</TableCell>
                            </TableRow>
                            <TableRow>
                                <TableCell>{creditName}</TableCell>
                                <TableCell className="text-right">₹0</TableCell>
                                <TableCell className="text-right">{formatCurrency(transaction.amount)}</TableCell>
                            </TableRow>
                        </TableBody>
                    </Table>

                    <div>
                        <span className="font-semibold">Narration :</span>{' '}
                        <span className="text-muted-foreground">{stripPostingMarker(transaction.description) || '—'}</span>
                    </div>

                    <div className="flex items-center justify-between rounded-md border p-3 bg-muted/30">
                        <div className="text-sm">
                            <div className="text-xs text-muted-foreground">Total Debit</div>
                            <div className="font-semibold">{formatCurrency(transaction.amount)}</div>
                        </div>
                        <div className="text-sm text-right">
                            <div className="text-xs text-muted-foreground">Total Credit</div>
                            <div className="font-semibold">{formatCurrency(transaction.amount)}</div>
                        </div>
                    </div>

                    {approvedByDisplay && (
                        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                            <div className="font-semibold">Approved By</div>
                            <div className="text-xs mt-1 text-emerald-700">
                                {approvedByDisplay.name}
                                {approvedByDisplay.at ? ` on ${format(new Date(approvedByDisplay.at), 'dd/MM/yyyy hh:mm a')}` : ''}
                            </div>
                        </div>
                    )}

                    {(isRejected || transaction.rejectionReason || transaction.rejectedBy) && (
                        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                            <div className="font-semibold">Rejection Reason</div>
                            <div>{transaction.rejectionReason || '—'}</div>
                            {transaction.rejectedBy && (
                                <div className="text-xs mt-1 text-red-600">
                                    by {transaction.rejectedBy.firstName} {transaction.rejectedBy.lastName}
                                    {transaction.rejectedAt ? ` on ${format(new Date(transaction.rejectedAt), 'dd/MM/yyyy hh:mm a')}` : ''}
                                </div>
                            )}
                        </div>
                    )}

                    {(isReverted || transaction.revertReason || transaction.revertedBy) && (
                        <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800">
                            <div className="font-semibold">Revert Reason</div>
                            <div>{transaction.revertReason || '—'}</div>
                            {transaction.revertedBy && (
                                <div className="text-xs mt-1 text-slate-600">
                                    by {transaction.revertedBy.firstName} {transaction.revertedBy.lastName}
                                    {transaction.revertedAt ? ` on ${format(new Date(transaction.revertedAt), 'dd/MM/yyyy hh:mm a')}` : ''}
                                </div>
                            )}
                        </div>
                    )}

                    {(isPending || isApproved || isRejected) && isEodLocked && (
                        <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
                            EOD date does not match the branch&apos;s current working date — {isPending ? 'approve and reject are' : isApproved ? 'reject and revert are' : 'approve is'} locked.
                        </div>
                    )}

                    {isRejecting && (
                        <div className="space-y-2">
                            <Label htmlFor="rejectionReason" className="text-sm font-medium">
                                Rejection Reason <span className="text-red-500">*</span>
                            </Label>
                            <Textarea
                                id="rejectionReason"
                                value={rejectionReason}
                                onChange={(e) => setRejectionReason(e.target.value)}
                                placeholder="Provide a clear reason for rejection..."
                                className="min-h-[80px] resize-none"
                            />
                        </div>
                    )}

                    {isReverting && (
                        <div className="space-y-2">
                            <Label htmlFor="revertReason" className="text-sm font-medium">
                                Revert Reason <span className="text-red-500">*</span>
                            </Label>
                            <Textarea
                                id="revertReason"
                                value={revertReason}
                                onChange={(e) => setRevertReason(e.target.value)}
                                placeholder="Explain why this approved voucher is being reverted..."
                                className="min-h-[80px] resize-none"
                            />
                        </div>
                    )}
                </div>

                {showActions && (
                    <DialogFooter className="gap-2">
                        {isRejecting ? (
                            <>
                                <Button variant="outline" onClick={() => { setIsRejecting(false); setRejectionReason(''); }} disabled={isSubmitting}>
                                    Cancel
                                </Button>
                                <Button variant="destructive" onClick={handleReject} disabled={isSubmitting || !rejectionReason.trim()}>
                                    {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <XCircle className="h-4 w-4 mr-2" />}
                                    Confirm Reject
                                </Button>
                            </>
                        ) : isReverting ? (
                            <>
                                <Button variant="outline" onClick={() => { setIsReverting(false); setRevertReason(''); }} disabled={isSubmitting}>
                                    Cancel
                                </Button>
                                <Button
                                    className="bg-slate-700 hover:bg-slate-800 text-white"
                                    onClick={handleRevert}
                                    disabled={isSubmitting || !revertReason.trim()}
                                >
                                    {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RotateCcw className="h-4 w-4 mr-2" />}
                                    Confirm Revert
                                </Button>
                            </>
                        ) : (isApproved || isReverted) ? (
                            // Order per spec: Revert, Approve, Reject. Once already
                            // reverted, all three stay visible but naturally disabled
                            // (canApprove/canReject/canRevert all require the specific
                            // prior status they reverse) rather than disappearing.
                            <>
                                {canRevertRole && (
                                    <Button
                                        variant="outline"
                                        className={canRevert ? "text-slate-700 border-slate-300 hover:bg-slate-50" : ""}
                                        onClick={() => setIsReverting(true)}
                                        disabled={isSubmitting || !canRevert}
                                        title={isReverted ? "Already reverted — edit the transaction to resubmit it for approval" : (!canRevert && isEodLocked ? "EOD date does not match — revert is locked" : undefined)}
                                    >
                                        <RotateCcw className="h-4 w-4 mr-2" />
                                        Revert
                                    </Button>
                                )}
                                <Button
                                    variant="outline"
                                    onClick={handleApprove}
                                    disabled={isSubmitting || !canApprove}
                                    title={isReverted ? "Already reverted — edit the transaction to resubmit it for approval" : (!canApprove && isEodLocked ? "EOD date does not match — approve is locked" : undefined)}
                                >
                                    {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle className="h-4 w-4 mr-2" />}
                                    Approved
                                </Button>
                                <Button
                                    variant="outline"
                                    className={canReject ? "text-red-600 border-red-300 hover:bg-red-50" : ""}
                                    onClick={() => setIsRejecting(true)}
                                    disabled={isSubmitting || !canReject}
                                    title={!canReject && isEodLocked ? "EOD date does not match — reject is locked" : undefined}
                                >
                                    <XCircle className="h-4 w-4 mr-2" />
                                    Reject
                                </Button>
                            </>
                        ) : (
                            <>
                                {isPending && (
                                    <Button
                                        variant="outline"
                                        className={canReject ? "text-red-600 border-red-300 hover:bg-red-50" : ""}
                                        onClick={() => setIsRejecting(true)}
                                        disabled={isSubmitting || !canReject}
                                        title={!canReject && isEodLocked ? "EOD date does not match — reject is locked" : undefined}
                                    >
                                        <XCircle className="h-4 w-4 mr-2" />
                                        Reject
                                    </Button>
                                )}
                                <Button
                                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                                    onClick={handleApprove}
                                    disabled={isSubmitting || !canApprove}
                                    title={!canApprove && isEodLocked ? "EOD date does not match — approve is locked" : undefined}
                                >
                                    {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle className="h-4 w-4 mr-2" />}
                                    Approve
                                </Button>
                            </>
                        )}
                    </DialogFooter>
                )}
            </DialogContent>
        </Dialog>
    );
}
