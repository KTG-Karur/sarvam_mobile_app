'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, CheckSquare, Eye, Loader2, Pencil, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import { apiClient } from '@/app/lib/api-client';
import {
    projectInHand, splitAdvanceInstallments,
    type AdvanceCapabilities, type AdvanceDetail, type AdvanceList, type AdvanceRow,
} from '@/app/lib/staff-advances/advance';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageLoader } from '@/components/ui/page-loader';
import { SupportingDocumentField, type UploadedDocument } from './SupportingDocumentField';
import {
    AdvanceDetailBody, AdvanceDetailDialog, AdvanceStatusBadge, Field, SectionTitle, formatCurrency, formatDay,
} from './StaffAdvanceParts';

export default function StaffAdvanceApprovalPage() {
    const { toast } = useToast();
    const [capabilities, setCapabilities] = useState<AdvanceCapabilities | null>(null);
    const [capsLoading, setCapsLoading] = useState(true);
    const [list, setList] = useState<AdvanceList | null>(null);
    const [listLoading, setListLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [viewId, setViewId] = useState<string | null>(null);

    // review dialog
    const [reviewing, setReviewing] = useState<AdvanceRow | null>(null);
    const [detail, setDetail] = useState<AdvanceDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [showTrack, setShowTrack] = useState(false);
    const [editing, setEditing] = useState(false);
    const [editAmount, setEditAmount] = useState('');
    const [editPurpose, setEditPurpose] = useState('');
    const [editRemarks, setEditRemarks] = useState('');
    const [editReason, setEditReason] = useState('');
    const [editDocument, setEditDocument] = useState<UploadedDocument | null>(null);
    const [editError, setEditError] = useState('');
    const [editSaving, setEditSaving] = useState(false);
    const [action, setAction] = useState<'APPROVE' | 'REJECT'>('APPROVE');
    const [decisionRemarks, setDecisionRemarks] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const loadList = useCallback(async (targetPage = 1) => {
        setListLoading(true);
        try {
            const res = await apiClient.get<AdvanceList>(`/hr/staff-advances?tab=approvals&page=${targetPage}`);
            if (!res.success || !res.data) throw new Error(res.error || 'Failed to load the approval queue');
            setList(res.data);
            setPage(targetPage);
        } catch (err) {
            toast({ title: 'Error', description: err instanceof Error ? err.message : 'Failed to load the approval queue', variant: 'destructive' });
        } finally {
            setListLoading(false);
        }
    }, [toast]);

    const loadCapabilities = useCallback(async () => {
        setCapsLoading(true);
        try {
            const res = await apiClient.get<AdvanceCapabilities>('/hr/staff-advances/capabilities');
            if (!res.success || !res.data) throw new Error(res.error || 'Failed to load permissions');
            setCapabilities(res.data);
            if (res.data.approvals) void loadList(1);
            else setListLoading(false);
        } catch (err) {
            toast({ title: 'Access Error', description: err instanceof Error ? err.message : 'Unable to determine your permissions', variant: 'destructive' });
            setListLoading(false);
        } finally {
            setCapsLoading(false);
        }
    }, [toast, loadList]);

    useEffect(() => { void loadCapabilities(); }, [loadCapabilities]);

    const loadDetail = async (id: string) => {
        setDetailLoading(true);
        try {
            const res = await apiClient.get<AdvanceDetail>(`/hr/staff-advances/${id}`);
            if (!res.success || !res.data) throw new Error(res.error || 'Failed to load the application');
            setDetail(res.data);
        } catch (err) {
            toast({ title: 'Error', description: err instanceof Error ? err.message : 'Unable to load the application', variant: 'destructive' });
            closeReview();
        } finally {
            setDetailLoading(false);
        }
    };

    const openReview = (row: AdvanceRow) => {
        setReviewing(row);
        setDetail(null);
        setShowTrack(false);
        setEditing(false);
        setAction('APPROVE');
        setDecisionRemarks('');
        void loadDetail(row.id);
    };

    // Shown under the form and as a toast, so the message is seen wherever the user is looking.
    const reportEditError = (message: string) => {
        setEditError(message);
        toast({ title: 'Error', description: message, variant: 'destructive' });
    };

    const closeReview = () => { setReviewing(null); setDetail(null); setEditing(false); };

    const startEdit = () => {
        if (!detail) return;
        setEditAmount(String(detail.amount));
        setEditPurpose(detail.purpose);
        setEditRemarks(detail.remarks);
        setEditReason('');
        setEditError('');
        setEditDocument(null);
        setEditing(true);
    };

    const editAmountNumber = Number(editAmount);
    const editAmountValid = editAmount.trim() !== '' && Number.isFinite(editAmountNumber) && editAmountNumber > 0 && /^\d+(\.\d{1,2})?$/.test(editAmount.trim());
    const editInstallments = useMemo(() => (editAmountValid ? splitAdvanceInstallments(editAmountNumber, detail?.repaymentMonths) : null), [editAmountValid, editAmountNumber, detail?.repaymentMonths]);
    const editProjection = useMemo(
        () => (detail && editInstallments ? projectInHand(detail.salary.currentInHand, editInstallments[0]) : null),
        [detail, editInstallments],
    );

    const handleSaveEdit = async () => {
        if (!detail) return;
        if (!editAmountValid) return reportEditError('Enter a valid advance amount (at most 2 decimal places)');
        if (!editPurpose.trim()) return reportEditError('Reason / purpose is required');
        setEditError('');
        setEditSaving(true);
        try {
            const res = await apiClient.patch(`/hr/staff-advances/${detail.id}`, {
                expectedVersion: detail.version, amount: editAmountNumber, purpose: editPurpose.trim(), remarks: editRemarks.trim(), reason: editReason.trim(),
                document: editDocument ? { fileKey: editDocument.fileKey, fileName: editDocument.fileName } : undefined,
            });
            if (!res.success) throw new Error(res.error || 'Unable to update the advance');
            toast({ title: 'Advance Updated', description: 'The changes were saved and recorded in the history.' });
            setEditing(false);
            await loadDetail(detail.id);
            void loadList(page);
        } catch (err) {
            reportEditError(err instanceof Error ? err.message : 'Unable to update the advance');
        } finally {
            setEditSaving(false);
        }
    };

    const handleDecision = async () => {
        if (!detail) return;
        if (action === 'REJECT' && !decisionRemarks.trim()) {
            toast({ title: 'Remarks Required', description: 'Please enter a reason for rejecting this application.', variant: 'destructive' });
            return;
        }
        setSubmitting(true);
        try {
            const res = await apiClient.post('/hr/staff-advances/review', { id: detail.id, expectedVersion: detail.version, action, remarks: decisionRemarks.trim() });
            if (!res.success) throw new Error(res.error || 'Review failed');
            toast({ title: 'Decision Recorded', description: `${detail.advanceNumber} has been ${action === 'APPROVE' ? 'approved' : 'rejected'}.` });
            closeReview();
            void loadList(page);
        } catch (err) {
            toast({ title: 'Review Failed', description: err instanceof Error ? err.message : 'Another user may have changed this application. Please refresh.', variant: 'destructive' });
        } finally {
            setSubmitting(false);
        }
    };

    if (capsLoading) return <div className="p-8"><PageLoader label="Checking staff advance approval permissions..." fullScreen={false} /></div>;

    if (!capabilities?.approvals) {
        return (
            <div className="mx-auto max-w-3xl space-y-4 p-8 text-center">
                <ShieldCheck className="mx-auto h-12 w-12 text-muted-foreground/40" />
                <h2 className="text-xl font-semibold">Staff Advance Approval</h2>
                <p className="text-sm text-muted-foreground">
                    Your assigned role is not a reviewer in the staff loan approval workflow, so there are no advances for you to approve.
                </p>
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
            <div className="flex flex-col justify-between gap-4 rounded-xl border bg-card p-6 shadow-sm sm:flex-row sm:items-center">
                <div className="space-y-1">
                    <div className="flex items-center gap-2">
                        <CheckSquare className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
                        <h1 className="text-2xl font-bold tracking-tight">Staff Advance Approval</h1>
                    </div>
                    <p className="text-sm text-muted-foreground">Review pending staff advance applications, adjust the details if needed, then approve or reject.</p>
                </div>
                <Button variant="outline" size="sm" className="gap-2" onClick={() => void loadList(page)}><RefreshCw className="h-4 w-4" /> Refresh</Button>
            </div>

            <Card className="border shadow-sm">
                <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                        <CardTitle className="text-lg">Pending Approvals</CardTitle>
                        {list && <Badge variant="outline" className="text-xs">Total: {list.total}</Badge>}
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    {listLoading ? (
                        <div className="p-12"><PageLoader label="Loading applications..." fullScreen={false} /></div>
                    ) : !list || list.items.length === 0 ? (
                        <p className="py-16 text-center text-sm text-muted-foreground">No staff advances are waiting for your approval.</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-muted/40">
                                        <TableHead>Advance No.</TableHead>
                                        <TableHead>Employee</TableHead>
                                        <TableHead>Department</TableHead>
                                        <TableHead>Branch</TableHead>
                                        <TableHead className="text-right">Amount</TableHead>
                                        <TableHead className="text-right">Monthly Repayment</TableHead>
                                        <TableHead className="text-right">Current In-Hand</TableHead>
                                        <TableHead className="text-right">Projected In-Hand</TableHead>
                                        <TableHead>Stage</TableHead>
                                        <TableHead>Applied On</TableHead>
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {list.items.map(row => (
                                        <TableRow key={row.id} className="hover:bg-muted/30">
                                            <TableCell className="font-mono text-xs font-medium">{row.advanceNumber}</TableCell>
                                            <TableCell>
                                                <div className="font-medium">{row.employeeName}</div>
                                                <div className="text-xs text-muted-foreground">{row.employeeCode ?? ''}{row.designation ? ` · ${row.designation}` : ''}</div>
                                            </TableCell>
                                            <TableCell className="text-xs">{row.department ?? '—'}</TableCell>
                                            <TableCell className="text-xs">{row.branchName}</TableCell>
                                            <TableCell className="text-right font-semibold">{formatCurrency(row.amount)}</TableCell>
                                            <TableCell className="text-right">{formatCurrency(row.monthlyRepayment)}</TableCell>
                                            <TableCell className="text-right">{row.currentInHand === null ? '—' : formatCurrency(row.currentInHand)}</TableCell>
                                            <TableCell className="text-right">{row.projectedInHand === null ? '—' : formatCurrency(row.projectedInHand)}</TableCell>
                                            <TableCell><AdvanceStatusBadge status={row.status} stage={row.currentStage} /></TableCell>
                                            <TableCell className="text-xs text-muted-foreground">{formatDay(row.createdAt)}</TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex justify-end gap-1">
                                                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0" title="View" onClick={() => setViewId(row.id)}><Eye className="h-4 w-4" /></Button>
                                                    {row.canReview && (
                                                        <Button variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs font-medium text-emerald-600 dark:text-emerald-400" onClick={() => openReview(row)}>
                                                            <CheckSquare className="h-4 w-4" /> Review
                                                        </Button>
                                                    )}
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                    {list && list.total > list.pageSize && (
                        <div className="flex items-center justify-between border-t p-3 text-xs">
                            <span className="text-muted-foreground">Page {page} of {Math.ceil(list.total / list.pageSize)}</span>
                            <div className="flex gap-2">
                                <Button variant="outline" size="sm" disabled={page <= 1 || listLoading} onClick={() => void loadList(page - 1)}>Previous</Button>
                                <Button variant="outline" size="sm" disabled={page * list.pageSize >= list.total || listLoading} onClick={() => void loadList(page + 1)}>Next</Button>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            <AdvanceDetailDialog advanceId={viewId} onClose={() => setViewId(null)} />

            <Dialog open={!!reviewing} onOpenChange={open => { if (!open && !submitting && !editSaving) closeReview(); }}>
                <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[min(1200px,95vw)]">
                    <DialogHeader>
                        <DialogTitle>Review Staff Advance Application</DialogTitle>
                        <DialogDescription>{reviewing?.advanceNumber} — {reviewing?.employeeName} ({reviewing?.branchName})</DialogDescription>
                    </DialogHeader>

                    {detailLoading || !detail ? (
                        <div className="py-8"><PageLoader label="Loading application..." fullScreen={false} /></div>
                    ) : (
                        <div className="space-y-6">
                            <AdvanceDetailBody detail={detail} showTrack={showTrack} onToggleTrack={() => setShowTrack(v => !v)} />

                            <div className="space-y-3 rounded-lg border border-primary/30 p-4">
                                <div className="flex items-center justify-between">
                                    <SectionTitle>Edit Advance Details</SectionTitle>
                                    {!editing && (
                                        <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={startEdit}><Pencil className="h-3.5 w-3.5" /> Edit</Button>
                                    )}
                                </div>
                                {!editing ? (
                                    <p className="text-xs text-muted-foreground">Adjust the amount, reason or remarks before deciding. Every change is recorded with who made it, when, and the previous and new values.</p>
                                ) : (
                                    <div className="space-y-3 text-xs">
                                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                                            <div className="space-y-1.5">
                                                <Label htmlFor="edit-advance-amount" className="text-xs">Advance Amount (₹) <span className="text-destructive">*</span></Label>
                                                <Input id="edit-advance-amount" type="number" min="1" step="0.01" value={editAmount} onChange={e => setEditAmount(e.target.value)} className="text-xs" />
                                            </div>
                                            <div className="space-y-1.5">
                                                <Label className="text-xs">Repayment Period</Label>
                                                <Input value={detail ? `${detail.repaymentMonths} ${detail.repaymentMonths === 1 ? 'month' : 'months'} (chosen by the applicant)` : ''} disabled readOnly className="text-xs" />
                                            </div>
                                            <div className="space-y-1.5">
                                                <Label className="text-xs">Interest</Label>
                                                <Input value={formatCurrency(0)} disabled readOnly className="text-xs" />
                                            </div>
                                        </div>
                                        <div className="space-y-1.5">
                                            <Label htmlFor="edit-advance-purpose" className="text-xs">Reason / Purpose <span className="text-destructive">*</span></Label>
                                            <Textarea id="edit-advance-purpose" rows={2} value={editPurpose} onChange={e => setEditPurpose(e.target.value)} className="text-xs" />
                                        </div>
                                        <div className="space-y-1.5">
                                            <Label htmlFor="edit-advance-remarks" className="text-xs">Remarks</Label>
                                            <Input id="edit-advance-remarks" value={editRemarks} onChange={e => setEditRemarks(e.target.value)} className="text-xs" />
                                        </div>
                                        <SupportingDocumentField
                                            id="edit-advance-document" label="Replace supporting document (optional)"
                                            value={editDocument} onChange={setEditDocument} uploadFields={{ advanceId: detail.id }} disabled={editSaving}
                                            hint="Leave empty to keep the applicant's document. JPG, PNG or PDF up to 5 MB."
                                        />
                                        <div className="space-y-1.5">
                                            <Label htmlFor="edit-advance-reason" className="text-xs">Reason for edit (optional, saved in the history)</Label>
                                            <Input id="edit-advance-reason" value={editReason} onChange={e => setEditReason(e.target.value)} className="text-xs" />
                                        </div>
                                        <div className="grid grid-cols-2 gap-3 rounded-md bg-muted/50 p-3 sm:grid-cols-4">
                                            <Field label="Total Repayable">{editAmountValid ? formatCurrency(editAmountNumber) : '—'}</Field>
                                            <Field label="Monthly Repayment">{editInstallments ? formatCurrency(editInstallments[0]) : '—'}</Field>
                                            <Field label="Current In-Hand">{formatCurrency(detail.salary.currentInHand)}</Field>
                                            <Field label="Projected In-Hand">
                                                <span className={editProjection && editProjection.projectedInHand < 0 ? 'text-destructive' : ''}>{editProjection ? formatCurrency(editProjection.projectedInHand) : '—'}</span>
                                            </Field>
                                        </div>
                                        {editError && <p className="text-destructive">{editError}</p>}
                                        <div className="flex justify-end gap-2">
                                            <Button variant="outline" size="sm" disabled={editSaving} onClick={() => setEditing(false)}>Cancel Edit</Button>
                                            <Button size="sm" disabled={editSaving} onClick={() => void handleSaveEdit()}>
                                                {editSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save Changes'}
                                            </Button>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="space-y-3">
                                <Label className="text-xs font-semibold">Select Decision</Label>
                                <RadioGroup value={action} onValueChange={val => setAction(val as 'APPROVE' | 'REJECT')} className="grid max-w-md grid-cols-2 gap-2">
                                    <div>
                                        <RadioGroupItem value="APPROVE" id="advance-approve" className="peer sr-only" />
                                        <Label htmlFor="advance-approve" className="flex cursor-pointer flex-col items-center rounded-md border-2 border-muted bg-popover p-2.5 text-xs hover:bg-accent peer-data-[state=checked]:border-emerald-600">
                                            <CheckCircle2 className="mb-1 h-4 w-4 text-emerald-600" /> Approve
                                        </Label>
                                    </div>
                                    <div>
                                        <RadioGroupItem value="REJECT" id="advance-reject" className="peer sr-only" />
                                        <Label htmlFor="advance-reject" className="flex cursor-pointer flex-col items-center rounded-md border-2 border-muted bg-popover p-2.5 text-xs hover:bg-accent peer-data-[state=checked]:border-destructive">
                                            <XCircle className="mb-1 h-4 w-4 text-destructive" /> Reject
                                        </Label>
                                    </div>
                                </RadioGroup>
                                <div className="space-y-1.5">
                                    <Label htmlFor="advance-decision-remarks" className="text-xs">Review Remarks {action === 'REJECT' && <span className="text-destructive">*</span>}</Label>
                                    <Textarea
                                        id="advance-decision-remarks" rows={3} value={decisionRemarks} onChange={e => setDecisionRemarks(e.target.value)} className="text-xs"
                                        placeholder={action === 'REJECT' ? 'Provide the reason for rejection...' : 'Optional approval notes...'}
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    <DialogFooter className="gap-2 sm:items-center">
                        {editing && <span className="text-xs text-muted-foreground sm:mr-auto">Save or cancel your edit before deciding.</span>}
                        <Button variant="outline" size="sm" disabled={submitting || editSaving} onClick={closeReview}>Cancel</Button>
                        <Button
                            size="sm"
                            className={action === 'REJECT' ? 'bg-destructive text-white hover:bg-destructive/90' : 'bg-emerald-600 text-white hover:bg-emerald-700'}
                            disabled={submitting || editSaving || editing || detailLoading || !detail}
                            onClick={() => void handleDecision()}
                        >
                            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Confirm Decision'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
