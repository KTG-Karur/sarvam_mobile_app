'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { FileText, ListOrdered } from 'lucide-react';
import { apiClient } from '@/app/lib/api-client';
import {
    ADVANCE_REPAYMENT_MONTHS,
    type AdvanceDetail, type AdvanceSalarySummary, type AdvanceScheduleRow, type AdvanceStatus, type ObligationRow, type SalaryProjection,
} from '@/app/lib/staff-advances/advance';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageLoader } from '@/components/ui/page-loader';
import { useToast } from '@/hooks/use-toast';
import {
    EmployeePanel, Field, SectionTitle, formatCurrency, formatDateTime, formatDay,
} from '@/components/hr/staff-loans/StaffLoanDetailParts';

export { formatCurrency, formatDateTime, formatDay, Field, SectionTitle, EmployeePanel };

const STATUS_LABEL: Record<AdvanceStatus, string> = {
    SUBMITTED: 'Under Review', APPROVED: 'Awaiting Disbursement', ACTIVE: 'Active', COMPLETED: 'Completed', REJECTED: 'Rejected', CANCELLED: 'Cancelled',
};

export function AdvanceStatusBadge({ status, stage }: { status: AdvanceStatus; stage?: string | null }) {
    const label = STATUS_LABEL[status] ?? status;
    if (status === 'SUBMITTED') {
        return (
            <div className="flex flex-col items-start gap-0.5">
                <Badge className="bg-blue-600 hover:bg-blue-700 text-white">{label}</Badge>
                {stage && <span className="text-[11px] text-muted-foreground">{stage}</span>}
            </div>
        );
    }
    if (status === 'APPROVED') return <Badge className="bg-amber-600 hover:bg-amber-700 text-white">{label}</Badge>;
    if (status === 'ACTIVE') return <Badge className="bg-emerald-600 hover:bg-emerald-700 text-white">{label}</Badge>;
    if (status === 'COMPLETED') return <Badge className="bg-teal-700 hover:bg-teal-800 text-white">{label}</Badge>;
    if (status === 'REJECTED') return <Badge variant="destructive">{label}</Badge>;
    return <Badge variant="outline" className="text-muted-foreground">{label}</Badge>;
}

/** Salary picture from the payroll calculation, plus what the new advance's deduction does to it. */
export function SalarySummaryPanel({ salary, projection }: { salary: AdvanceSalarySummary; projection?: SalaryProjection | null }) {
    const negative = !!projection && projection.projectedInHand < 0;
    return (
        <div className="space-y-3">
            <SectionTitle>Salary Details</SectionTitle>
            <div className="grid grid-cols-2 gap-3 rounded-lg bg-muted/40 p-4 text-xs sm:grid-cols-4">
                <Field label="Basic Salary">{formatCurrency(salary.basicSalary)}</Field>
                <Field label="Gross Salary">{formatCurrency(salary.grossSalary)}</Field>
                <Field label="Monthly CTC">{salary.monthlyCtc > 0 ? formatCurrency(salary.monthlyCtc) : '—'}</Field>
                <Field label="Total Deductions">{formatCurrency(salary.totalDeductions)}</Field>
                <Field label="Existing Loan Deduction">{formatCurrency(salary.existingLoanDeduction)}</Field>
                <Field label="Existing Advance Deduction">{formatCurrency(salary.existingAdvanceDeduction)}</Field>
                <Field label="Other Deductions">{formatCurrency(salary.otherDeductions)}</Field>
                <Field label="Expected In-Hand Salary"><span className="text-emerald-700 dark:text-emerald-400">{formatCurrency(salary.currentInHand)}</span></Field>
            </div>
            {salary.earnings.some(e => e.amount > 0) && (
                <div className="flex flex-wrap gap-2 text-[11px]">
                    {salary.earnings.filter(e => e.amount > 0).map(e => (
                        <span key={e.name} className="rounded-md border bg-muted/30 px-2 py-1">
                            <span className="text-muted-foreground">{e.name}: </span>
                            <span className="font-medium text-foreground">{formatCurrency(e.amount)}</span>
                        </span>
                    ))}
                </div>
            )}
            {projection && (
                <div className={`grid grid-cols-3 gap-3 rounded-lg border p-4 text-xs ${negative ? 'border-destructive/50 bg-destructive/5' : 'border-primary/30 bg-primary/5'}`}>
                    <Field label="Current In-Hand Salary">{formatCurrency(projection.currentInHand)}</Field>
                    <Field label="New Advance Monthly Deduction">{formatCurrency(projection.monthlyRepayment)}</Field>
                    <Field label="Projected In-Hand After Advance">
                        <span className={negative ? 'text-destructive' : 'text-emerald-700 dark:text-emerald-400'}>{formatCurrency(projection.projectedInHand)}</span>
                    </Field>
                    {negative && <p className="col-span-3 text-destructive">The repayment is more than the expected in-hand salary.</p>}
                </div>
            )}
            <p className="text-[11px] text-muted-foreground">
                Based on the payroll calculation for {String(salary.month).padStart(2, '0')}/{salary.year}: earnings minus all deductions, including loan and advance installments due.
            </p>
        </div>
    );
}

export function ObligationsTable({ rows, title = 'Existing Loans & Advances' }: { rows: ObligationRow[]; title?: string }) {
    // Each loan/advance opens its own repayment track; tracks are never merged into one.
    const [openTracks, setOpenTracks] = useState<Set<string>>(new Set());
    const toggleTrack = (key: string) => setOpenTracks(prev => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key); else next.add(key);
        return next;
    });
    const running = rows.filter(r => r.status === 'ACTIVE' || r.status === 'SUBMITTED' || r.status === 'APPROVED');
    return (
        <div className="space-y-2">
            <SectionTitle>{title}</SectionTitle>
            {running.length > 0 && (
                <p className="rounded-md border border-amber-300/60 bg-amber-50 p-2 text-[11px] text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                    This employee already has {running.length} loan/advance{running.length > 1 ? 's' : ''} in progress: {running.map(r => r.number).join(', ')}.
                </p>
            )}
            {rows.length === 0 ? (
                <p className="text-xs text-muted-foreground">No previous staff loans or advances for this employee.</p>
            ) : (
                <div className="overflow-x-auto rounded-md border text-xs">
                    <Table>
                        <TableHeader>
                            <TableRow className="bg-muted/40">
                                <TableHead>Number</TableHead>
                                <TableHead>Type</TableHead>
                                <TableHead>Applied On</TableHead>
                                <TableHead className="text-right">Approved Amount</TableHead>
                                <TableHead className="text-right">Outstanding</TableHead>
                                <TableHead className="text-right">Monthly Deduction</TableHead>
                                <TableHead className="text-center">Period</TableHead>
                                <TableHead className="text-center">Paid</TableHead>
                                <TableHead className="text-center">Remaining</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Completed On</TableHead>
                                <TableHead className="text-right">Repayment Track</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {rows.map(row => {
                                const key = `${row.type}-${row.id}`;
                                const open = openTracks.has(key);
                                return (
                                <Fragment key={key}>
                                <TableRow>
                                    <TableCell className="font-mono font-medium">{row.number}</TableCell>
                                    <TableCell>{row.type === 'STAFF_LOAN' ? 'Staff Loan' : 'Staff Advance'}</TableCell>
                                    <TableCell>{formatDay(row.applicationDate)}</TableCell>
                                    <TableCell className="text-right">{formatCurrency(row.approvedAmount)}</TableCell>
                                    <TableCell className="text-right">{row.outstandingAmount === null ? '—' : formatCurrency(row.outstandingAmount)}</TableCell>
                                    <TableCell className="text-right">{formatCurrency(row.monthlyDeduction)}</TableCell>
                                    <TableCell className="text-center">{row.repaymentMonths} mo</TableCell>
                                    <TableCell className="text-center">{row.paidInstallments}</TableCell>
                                    <TableCell className="text-center">{row.remainingInstallments}</TableCell>
                                    <TableCell><Badge variant="outline">{row.status.charAt(0) + row.status.slice(1).toLowerCase()}</Badge></TableCell>
                                    <TableCell>{formatDay(row.completionDate)}</TableCell>
                                    <TableCell className="text-right">
                                        {row.schedule ? (
                                            <Button type="button" variant="outline" size="sm" className="h-7 gap-1.5 text-[11px]" aria-expanded={open} onClick={() => toggleTrack(key)}>
                                                <ListOrdered className="h-3 w-3" /> {open ? 'Hide' : 'View'}
                                            </Button>
                                        ) : <span className="text-muted-foreground" title="The repayment schedule is created when it is disbursed">—</span>}
                                    </TableCell>
                                </TableRow>
                                {open && row.schedule && (
                                    <TableRow className="bg-muted/20 hover:bg-muted/20">
                                        <TableCell colSpan={12} className="space-y-2 p-3">
                                            <div className="text-xs font-semibold">Repayment Track — {row.number} ({row.type === 'STAFF_LOAN' ? 'Staff Loan' : 'Staff Advance'})</div>
                                            <AdvanceScheduleTable schedule={row.schedule} total={row.repaymentMonths} />
                                        </TableCell>
                                    </TableRow>
                                )}
                                </Fragment>
                                );
                            })}
                        </TableBody>
                    </Table>
                </div>
            )}
        </div>
    );
}

const SCHEDULE_STATUS: Record<AdvanceScheduleRow['status'], { label: string; className: string }> = {
    PAID: { label: 'Paid', className: 'bg-emerald-600 hover:bg-emerald-700 text-white' },
    PARTIAL: { label: 'Partial', className: 'bg-amber-500 hover:bg-amber-600 text-white' },
    PENDING: { label: 'Pending', className: 'bg-muted text-foreground hover:bg-muted' },
    OVERDUE: { label: 'Overdue', className: 'bg-destructive hover:bg-destructive/90 text-white' },
};

/** The repayment track. Interest is always 0 for a Staff Advance, so principal equals the total due. */
export function AdvanceScheduleTable({ schedule, total = ADVANCE_REPAYMENT_MONTHS }: { schedule: AdvanceScheduleRow[]; total?: number }) {
    return (
        <div className="overflow-x-auto rounded-md border text-xs">
            <Table>
                <TableHeader>
                    <TableRow className="bg-muted/40">
                        <TableHead>Installment</TableHead>
                        <TableHead>Due Date</TableHead>
                        <TableHead className="text-right">Principal</TableHead>
                        <TableHead className="text-right">Interest</TableHead>
                        <TableHead className="text-right">Total Due</TableHead>
                        <TableHead className="text-right">Paid Amount</TableHead>
                        <TableHead>Payment Date</TableHead>
                        <TableHead className="text-right">Outstanding</TableHead>
                        <TableHead>Status</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {schedule.map(row => (
                        <TableRow key={row.id}>
                            <TableCell className="font-medium">{row.installmentNo} of {total}</TableCell>
                            <TableCell>{formatDay(row.dueDate)}</TableCell>
                            <TableCell className="text-right">{formatCurrency(row.principal)}</TableCell>
                            <TableCell className="text-right">{formatCurrency(row.interest)}</TableCell>
                            <TableCell className="text-right font-medium">{formatCurrency(row.totalDue)}</TableCell>
                            <TableCell className="text-right">{formatCurrency(row.paidAmount)}</TableCell>
                            <TableCell>{formatDay(row.paymentDate)}</TableCell>
                            <TableCell className="text-right">{formatCurrency(row.outstanding)}</TableCell>
                            <TableCell><Badge className={SCHEDULE_STATUS[row.status].className}>{SCHEDULE_STATUS[row.status].label}</Badge></TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}

export function SchedulePreviewTable({ rows, total = ADVANCE_REPAYMENT_MONTHS }: { rows: { installmentNo: number; dueDate: string; amount: number }[]; total?: number }) {
    return (
        <div className="overflow-x-auto rounded-md border text-xs">
            <Table>
                <TableHeader>
                    <TableRow className="bg-muted/40">
                        <TableHead>Installment</TableHead>
                        <TableHead>Expected Due Date</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {rows.map(row => (
                        <TableRow key={row.installmentNo}>
                            <TableCell className="font-medium">{row.installmentNo} of {total}</TableCell>
                            <TableCell>{formatDay(row.dueDate)}</TableCell>
                            <TableCell className="text-right font-medium">{formatCurrency(row.amount)}</TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}

const CHANGE_LABEL: Record<string, string> = { amount: 'Amount', purpose: 'Purpose', remarks: 'Remarks', document: 'Document' };
const showValue = (field: string, value: unknown) => (field === 'amount' && typeof value === 'number' ? formatCurrency(value) : String(value ?? '—') || '—');

const ACTION_LABEL: Record<string, string> = {
    SUBMIT: 'Applied', EDIT: 'Edited', APPROVE: 'Approved', REJECT: 'Rejected', CANCEL: 'Cancelled', DISBURSE: 'Disbursed', REPAYMENT: 'Repayment', COMPLETE: 'Completed',
};

export function AdvanceHistory({ decisions }: { decisions: AdvanceDetail['decisions'] }) {
    return (
        <div className="space-y-2">
            <SectionTitle>History</SectionTitle>
            {decisions.length === 0 ? (
                <p className="text-xs text-muted-foreground">No history recorded yet.</p>
            ) : (
                <div className="overflow-x-auto rounded-md border text-xs">
                    <Table>
                        <TableHeader>
                            <TableRow className="bg-muted/40">
                                <TableHead>Date &amp; Time</TableHead>
                                <TableHead>Action</TableHead>
                                <TableHead>Stage</TableHead>
                                <TableHead>By</TableHead>
                                <TableHead>Details</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {decisions.map(d => (
                                <TableRow key={d.id}>
                                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(d.createdAt)}</TableCell>
                                    <TableCell><Badge variant={d.action === 'REJECT' ? 'destructive' : d.action === 'APPROVE' || d.action === 'DISBURSE' || d.action === 'COMPLETE' ? 'default' : 'secondary'}>{ACTION_LABEL[d.action] ?? d.action}</Badge></TableCell>
                                    <TableCell>{d.stageName || '—'}</TableCell>
                                    <TableCell className="font-medium">{d.actorName}</TableCell>
                                    <TableCell className="text-muted-foreground">
                                        <div>{d.remarks || '—'}</div>
                                        {d.changes && (
                                            <ul className="mt-1 space-y-0.5">
                                                {Object.entries(d.changes).map(([field, change]) => (
                                                    <li key={field}>
                                                        <span className="font-medium text-foreground">{CHANGE_LABEL[field] ?? field}:</span> {showValue(field, change.from)} → {showValue(field, change.to)}
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}
        </div>
    );
}

/** Opens the stored supporting document through a short-lived signed URL (scoped to who may see the advance). */
function SupportingDocumentLink({ advanceId, document }: { advanceId: string; document: NonNullable<AdvanceDetail['document']> }) {
    const { toast } = useToast();
    const open = async () => {
        const res = await apiClient.get<{ url: string }>(`/hr/staff-advances/${advanceId}/document`);
        if (res.success && res.data?.url) window.open(res.data.url, '_blank', 'noopener,noreferrer');
        else toast({ title: 'Error', description: res.error || 'Could not open the document.', variant: 'destructive' });
    };
    return (
        <button type="button" className="flex items-center gap-1 font-semibold text-primary hover:underline" onClick={() => void open()}>
            <FileText className="h-3.5 w-3.5" />{document.fileName}
        </button>
    );
}

/** Everything the View shows for one advance; approvers add their own controls around it. */
export function AdvanceDetailBody({ detail, showTrack, onToggleTrack }: { detail: AdvanceDetail; showTrack: boolean; onToggleTrack: () => void }) {
    return (
        <div className="space-y-6 pt-2">
            <EmployeePanel employee={detail.employee} />

            <SalarySummaryPanel salary={detail.salary} projection={detail.projection} />

            <div className="space-y-3">
                <SectionTitle>Advance Details</SectionTitle>
                <div className="grid grid-cols-2 gap-3 rounded-lg bg-muted/40 p-4 text-xs sm:grid-cols-4">
                    <Field label="Advance Number"><span className="font-mono">{detail.advanceNumber}</span></Field>
                    <Field label="Advance Amount">{formatCurrency(detail.amount)}</Field>
                    <Field label="Total Repayable">{formatCurrency(detail.totalRepayable)}</Field>
                    <Field label="Repayment Period">{detail.repaymentMonths} {detail.repaymentMonths === 1 ? 'Month' : 'Months'}</Field>
                    <Field label="Monthly Repayment">{formatCurrency(detail.monthlyRepayment)}</Field>
                    <Field label="Status"><AdvanceStatusBadge status={detail.status} stage={detail.currentStage} /></Field>
                    <Field label="Applied On">{formatDateTime(detail.createdAt)}</Field>
                    <Field label="Approved On">{detail.approvedAt ? formatDateTime(detail.approvedAt) : '—'}</Field>
                    <Field label="Disbursed On">{detail.disbursedAt ? formatDateTime(detail.disbursedAt) : '—'}</Field>
                    {detail.payment && <Field label="Payment Mode">{detail.payment.mode === 'BANK_TRANSFER' ? 'Bank Transfer' : detail.payment.mode === 'CASH' ? 'Cash' : detail.payment.mode}</Field>}
                    {detail.payment?.reference && <Field label="Reference / UTR"><span className="font-mono">{detail.payment.reference}</span></Field>}
                    {detail.outstandingAmount !== null && (
                        <>
                            <Field label="Paid Amount">{formatCurrency(detail.paidAmount)}</Field>
                            <Field label="Outstanding Amount">{formatCurrency(detail.outstandingAmount)}</Field>
                            <Field label="Paid Installments">{detail.paidInstallments} of {detail.repaymentMonths}</Field>
                            <Field label="Completed On">{detail.completedAt ? formatDateTime(detail.completedAt) : '—'}</Field>
                        </>
                    )}
                    <div className="col-span-2 sm:col-span-4"><Field label="Reason / Purpose">{detail.purpose}</Field></div>
                    {detail.remarks && <div className="col-span-2 sm:col-span-4"><Field label="Remarks">{detail.remarks}</Field></div>}
                    <div className="col-span-2 sm:col-span-4">
                        <Field label="Supporting Document">
                            {detail.document ? <SupportingDocumentLink advanceId={detail.id} document={detail.document} /> : <span className="text-muted-foreground">Not attached</span>}
                        </Field>
                    </div>
                </div>
            </div>

            <ObligationsTable rows={detail.obligations} title="Previous Loans & Advances" />

            <div className="space-y-2">
                <Button variant="outline" size="sm" className="gap-2" onClick={onToggleTrack} disabled={!detail.schedule && !detail.schedulePreview}>
                    <ListOrdered className="h-4 w-4" />
                    {showTrack ? 'Hide Repayment Track' : 'Show Repayment Track'}
                </Button>
                {showTrack && detail.schedule && <AdvanceScheduleTable schedule={detail.schedule} />}
                {showTrack && !detail.schedule && detail.schedulePreview && (
                    <>
                        <SchedulePreviewTable rows={detail.schedulePreview} total={detail.repaymentMonths} />
                        <p className="text-[11px] text-muted-foreground">Expected dates if disbursed today. The real schedule is created when the advance is disbursed.</p>
                    </>
                )}
            </div>

            <AdvanceHistory decisions={detail.decisions} />
        </div>
    );
}

/** Loads one advance and shows it in a read-only modal (Apply, Management and Repayment pages). */
export function AdvanceDetailDialog({ advanceId, onClose, description }: { advanceId: string | null; onClose: () => void; description?: string }) {
    const { toast } = useToast();
    const [detail, setDetail] = useState<AdvanceDetail | null>(null);
    const [loading, setLoading] = useState(false);
    const [showTrack, setShowTrack] = useState(false);

    const load = useCallback(async (id: string) => {
        setLoading(true);
        setDetail(null);
        setShowTrack(false);
        try {
            const res = await apiClient.get<AdvanceDetail>(`/hr/staff-advances/${id}`);
            if (!res.success || !res.data) throw new Error(res.error || 'Failed to load the advance');
            setDetail(res.data);
        } catch (err) {
            toast({ title: 'Error', description: err instanceof Error ? err.message : 'Unable to load the advance', variant: 'destructive' });
            onClose();
        } finally {
            setLoading(false);
        }
    }, [toast, onClose]);

    useEffect(() => {
        if (advanceId) void load(advanceId);
        else setDetail(null);
    }, [advanceId, load]);

    return (
        <Dialog open={!!advanceId} onOpenChange={open => { if (!open) onClose(); }}>
            <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[min(1200px,95vw)]">
                <DialogHeader>
                    <DialogTitle className="flex items-center justify-between pr-6">
                        <span>Staff Advance — {detail?.advanceNumber ?? ''}</span>
                        {detail && <AdvanceStatusBadge status={detail.status} stage={detail.currentStage} />}
                    </DialogTitle>
                    <DialogDescription>{description ?? 'Employee, salary, advance details, previous loans and advances, repayment track and history.'}</DialogDescription>
                </DialogHeader>
                {loading || !detail ? (
                    <div className="py-8"><PageLoader label="Loading staff advance..." fullScreen={false} /></div>
                ) : (
                    <AdvanceDetailBody detail={detail} showTrack={showTrack} onToggleTrack={() => setShowTrack(v => !v)} />
                )}
                <DialogFooter>
                    <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
