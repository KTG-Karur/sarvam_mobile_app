'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Eye, HandCoins, Loader2, RefreshCw, Send, XCircle } from 'lucide-react';
import { apiClient } from '@/app/lib/api-client';
import {
    ADVANCE_REPAYMENT_MONTHS, ADVANCE_REPAYMENT_OPTIONS, projectInHand, splitAdvanceInstallments,
    type AdvanceList, type AdvanceOptions, type AdvanceRow,
} from '@/app/lib/staff-advances/advance';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageLoader } from '@/components/ui/page-loader';
import { SupportingDocumentField, type UploadedDocument } from './SupportingDocumentField';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import {
    AdvanceDetailDialog, AdvanceStatusBadge, EmployeePanel, Field, ObligationsTable, SalarySummaryPanel, SectionTitle,
    formatCurrency, formatDay,
} from './StaffAdvanceParts';

const todayInKolkata = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

export default function ApplyStaffAdvancePage() {
    const { toast } = useToast();
    const [options, setOptions] = useState<AdvanceOptions | null>(null);
    const [optionsLoading, setOptionsLoading] = useState(true);
    const [optionsError, setOptionsError] = useState('');
    const [selectedEmployeeId, setSelectedEmployeeId] = useState('');

    const [applications, setApplications] = useState<AdvanceList | null>(null);
    const [listLoading, setListLoading] = useState(true);
    const [page, setPage] = useState(1);

    const [amount, setAmount] = useState('');
    const [purpose, setPurpose] = useState('');
    const [remarks, setRemarks] = useState('');
    const [repaymentMonths, setRepaymentMonths] = useState<number>(ADVANCE_REPAYMENT_MONTHS);
    const [documentFile, setDocumentFile] = useState<UploadedDocument | null>(null);
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [submitting, setSubmitting] = useState(false);

    const [viewId, setViewId] = useState<string | null>(null);
    const [cancelling, setCancelling] = useState<AdvanceRow | null>(null);
    const [cancelBusy, setCancelBusy] = useState(false);

    const loadOptions = useCallback(async (employeeId?: string) => {
        setOptionsLoading(true);
        setOptionsError('');
        try {
            const query = employeeId ? `?employeeId=${encodeURIComponent(employeeId)}` : '';
            const res = await apiClient.get<AdvanceOptions>(`/hr/staff-advances/options${query}`);
            if (!res.success || !res.data) throw new Error(res.error || 'Failed to load the staff advance details');
            setOptions(res.data);
            setSelectedEmployeeId(res.data.employee.id);
        } catch (err) {
            setOptionsError(err instanceof Error ? err.message : 'Unable to load the staff advance details');
        } finally {
            setOptionsLoading(false);
        }
    }, []);

    const loadApplications = useCallback(async (targetPage = 1) => {
        setListLoading(true);
        try {
            const res = await apiClient.get<AdvanceList>(`/hr/staff-advances?tab=own&page=${targetPage}`);
            if (!res.success || !res.data) throw new Error(res.error || 'Failed to load your applications');
            setApplications(res.data);
            setPage(targetPage);
        } catch (err) {
            toast({ title: 'Error', description: err instanceof Error ? err.message : 'Failed to load your applications', variant: 'destructive' });
        } finally {
            setListLoading(false);
        }
    }, [toast]);

    useEffect(() => { void loadOptions(); void loadApplications(1); }, [loadOptions, loadApplications]);

    const amountNumber = Number(amount);
    const amountValid = amount.trim() !== '' && Number.isFinite(amountNumber) && amountNumber > 0 && /^\d+(\.\d{1,2})?$/.test(amount.trim());
    const installments = useMemo(() => (amountValid ? splitAdvanceInstallments(amountNumber, repaymentMonths) : null), [amountValid, amountNumber, repaymentMonths]);
    const projection = useMemo(
        () => (options && installments ? projectInHand(options.salary.currentInHand, installments[0]) : null),
        [options, installments],
    );
    const exceedsSalary = !!options && !!projection && options.salary.monthlyCtc > 0 && projection.projectedInHand < 0;
    const blocked = !options || !!options.openAdvance || !options.workflowAvailable;

    const handleEmployeeChange = (employeeId: string) => {
        setAmount('');
        // The file was stored in the previous employee's folder and would be refused for this one.
        setDocumentFile(null);
        setErrors({});
        void loadOptions(employeeId);
    };

    const resetForm = () => { setAmount(''); setPurpose(''); setRemarks(''); setDocumentFile(null); setErrors({}); };

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        const next: Record<string, string> = {};
        if (!amountValid) next.amount = amount.trim() === '' ? 'Enter the advance amount' : 'Enter a valid amount (at most 2 decimal places)';
        else if (exceedsSalary) next.amount = 'The monthly repayment is more than the expected in-hand salary';
        if (!purpose.trim()) next.purpose = 'Enter the reason for the advance';
        if (!documentFile) next.document = 'Upload the supporting document (image or PDF)';
        setErrors(next);
        if (Object.keys(next).length > 0) {
            toast({ title: 'Validation Error', description: Object.values(next)[0], variant: 'destructive' });
            return;
        }

        setSubmitting(true);
        try {
            const res = await apiClient.post('/hr/staff-advances', {
                employeeId: options?.canSelectEmployee ? selectedEmployeeId : undefined,
                amount: amountNumber,
                repaymentMonths,
                purpose: purpose.trim(),
                remarks: remarks.trim(),
                document: documentFile ? { fileKey: documentFile.fileKey, fileName: documentFile.fileName } : undefined,
            });
            if (!res.success) throw new Error(res.error || 'Failed to submit the application');
            toast({ title: 'Application Submitted', description: 'Your staff advance application has been submitted for approval.' });
            resetForm();
            void loadOptions(options?.canSelectEmployee ? selectedEmployeeId : undefined);
            void loadApplications(1);
        } catch (err) {
            toast({ title: 'Submit Failed', description: err instanceof Error ? err.message : 'Failed to submit the application', variant: 'destructive' });
        } finally {
            setSubmitting(false);
        }
    };

    const handleCancel = async () => {
        if (!cancelling) return;
        setCancelBusy(true);
        try {
            const res = await apiClient.post('/hr/staff-advances/cancel', { id: cancelling.id, expectedVersion: cancelling.version });
            if (!res.success) throw new Error(res.error || 'Failed to cancel the application');
            toast({ title: 'Application Cancelled', description: `${cancelling.advanceNumber} has been cancelled.` });
            setCancelling(null);
            void loadOptions(options?.canSelectEmployee ? selectedEmployeeId : undefined);
            void loadApplications(page);
        } catch (err) {
            toast({ title: 'Cancel Failed', description: err instanceof Error ? err.message : 'Failed to cancel the application', variant: 'destructive' });
        } finally {
            setCancelBusy(false);
        }
    };

    if (optionsLoading && !options) return <div className="p-8"><PageLoader label="Loading staff advance..." fullScreen={false} /></div>;
    if (optionsError && !options) {
        return (
            <div className="mx-auto max-w-3xl space-y-4 p-8 text-center">
                <AlertCircle className="mx-auto h-10 w-10 text-destructive" />
                <p className="text-sm text-muted-foreground">{optionsError}</p>
                <Button variant="outline" onClick={() => void loadOptions()}>Try again</Button>
            </div>
        );
    }
    if (!options) return null;

    return (
        <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
            <div className="flex flex-col justify-between gap-4 rounded-xl border bg-card p-6 shadow-sm sm:flex-row sm:items-center">
                <div className="space-y-1">
                    <div className="flex items-center gap-2">
                        <HandCoins className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
                        <h1 className="text-2xl font-bold tracking-tight">Apply Staff Advance</h1>
                    </div>
                    <p className="text-sm text-muted-foreground">
                        An interest-free salary advance, repaid in 1 or 2 monthly salary deductions - you choose.
                    </p>
                </div>
                <Button variant="outline" size="sm" className="gap-2" onClick={() => { void loadOptions(options.canSelectEmployee ? selectedEmployeeId : undefined); void loadApplications(page); }}>
                    <RefreshCw className="h-4 w-4" /> Refresh
                </Button>
            </div>

            {options.canSelectEmployee && options.employees && options.employees.length > 0 && (
                <Card className="shadow-sm">
                    <CardContent className="space-y-1.5 pt-6">
                        <Label className="text-xs font-medium">Apply for employee</Label>
                        <Select value={selectedEmployeeId} onValueChange={handleEmployeeChange} disabled={submitting || optionsLoading}>
                            <SelectTrigger className="h-10 text-sm"><SelectValue placeholder="Select an employee..." /></SelectTrigger>
                            <SelectContent>
                                {options.employees.map(e => (
                                    <SelectItem key={e.id} value={e.id}>{e.name}{e.employeeId ? ` (${e.employeeId})` : ''}{e.branchName ? ` — ${e.branchName}` : ''}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </CardContent>
                </Card>
            )}

            {options.openAdvance && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                        {options.employee.name} already has advance <strong>{options.openAdvance.advanceNumber}</strong>{' '}
                        {options.openAdvance.status === 'ACTIVE' ? 'being repaid' : options.openAdvance.status === 'APPROVED' ? 'awaiting disbursement' : 'under review'}. A new advance can be requested once it is completed.
                    </span>
                </div>
            )}
            {!options.workflowAvailable && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>The approval workflow is not configured yet, so advances cannot be submitted. Contact the administrator.</span>
                </div>
            )}

            <EmployeePanel employee={options.employee} />
            <SalarySummaryPanel salary={options.salary} projection={projection} />

            <Card className="shadow-sm">
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Advance Details</CardTitle>
                    <CardDescription className="text-xs">No interest is charged. Total repayable equals the advance amount.</CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                        <fieldset disabled={submitting || blocked} className="space-y-4">
                            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                                <div className="space-y-1.5">
                                    <Label htmlFor="advance-amount" className="text-xs">Advance Amount (₹) <span className="text-destructive">*</span></Label>
                                    <Input
                                        id="advance-amount" type="number" min="1" step="0.01" inputMode="decimal" placeholder="e.g. 20000"
                                        value={amount} onChange={e => { setAmount(e.target.value); setErrors(prev => ({ ...prev, amount: '' })); }}
                                        aria-invalid={!!errors.amount}
                                    />
                                    {errors.amount && <p className="text-xs text-destructive">{errors.amount}</p>}
                                </div>
                                <div className="space-y-1.5">
                                    <Label htmlFor="advance-period" className="text-xs">Repayment Period <span className="text-destructive">*</span></Label>
                                    <Select value={String(repaymentMonths)} onValueChange={value => setRepaymentMonths(Number(value))}>
                                        <SelectTrigger id="advance-period"><SelectValue placeholder="Select period" /></SelectTrigger>
                                        <SelectContent>
                                            {ADVANCE_REPAYMENT_OPTIONS.map(months => (
                                                <SelectItem key={months} value={String(months)}>{months} {months === 1 ? 'month' : 'months'}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-xs">Application Date</Label>
                                    <Input value={formatDay(todayInKolkata())} disabled readOnly />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3 rounded-lg bg-muted/40 p-4 text-xs sm:grid-cols-4">
                                <Field label="Advance Amount">{amountValid ? formatCurrency(amountNumber) : '—'}</Field>
                                <Field label="Interest">{formatCurrency(0)}</Field>
                                <Field label="Total Repayable">{amountValid ? formatCurrency(amountNumber) : '—'}</Field>
                                <Field label="Monthly Repayment">{installments ? formatCurrency(installments[0]) : '—'}</Field>
                                {installments && installments.length > 1 && (
                                    <div className="col-span-2 sm:col-span-4 text-[11px] text-muted-foreground">
                                        {installments.map((installment, i) => `Month ${i + 1}: ${formatCurrency(installment)}`).join(' · ')}
                                    </div>
                                )}
                            </div>

                            <div className="space-y-1.5">
                                <Label htmlFor="advance-purpose" className="text-xs">Reason / Purpose <span className="text-destructive">*</span></Label>
                                <Textarea
                                    id="advance-purpose" rows={3} placeholder="Why is the advance needed?"
                                    value={purpose} onChange={e => { setPurpose(e.target.value); setErrors(prev => ({ ...prev, purpose: '' })); }}
                                    aria-invalid={!!errors.purpose}
                                />
                                {errors.purpose && <p className="text-xs text-destructive">{errors.purpose}</p>}
                            </div>
                            <SupportingDocumentField
                                id="advance-document" label="Supporting Document" required
                                value={documentFile} onChange={file => { setDocumentFile(file); setErrors(prev => ({ ...prev, document: '' })); }}
                                uploadFields={options.canSelectEmployee && selectedEmployeeId ? { employeeId: selectedEmployeeId } : undefined}
                                disabled={submitting || blocked} error={errors.document}
                            />
                            <div className="space-y-1.5">
                                <Label htmlFor="advance-remarks" className="text-xs">Remarks</Label>
                                <Input id="advance-remarks" value={remarks} onChange={e => setRemarks(e.target.value)} placeholder="Optional" />
                            </div>
                        </fieldset>

                        <div className="flex justify-end">
                            <Button type="submit" disabled={submitting || blocked || exceedsSalary} className="min-w-[180px] gap-2">
                                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                                Submit Application
                            </Button>
                        </div>
                    </form>
                </CardContent>
            </Card>

            <ObligationsTable rows={options.obligations} />

            <Card className="shadow-sm">
                <CardHeader className="pb-3">
                    <SectionTitle>My Staff Advance Applications</SectionTitle>
                </CardHeader>
                <CardContent className="p-0">
                    {listLoading ? (
                        <div className="p-8"><PageLoader label="Loading applications..." fullScreen={false} /></div>
                    ) : !applications || applications.items.length === 0 ? (
                        <p className="p-8 text-center text-sm text-muted-foreground">You have not applied for a staff advance yet.</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-muted/40">
                                        <TableHead>Advance No.</TableHead>
                                        <TableHead className="text-right">Amount</TableHead>
                                        <TableHead className="text-right">Monthly Repayment</TableHead>
                                        <TableHead className="text-right">Outstanding</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead>Applied On</TableHead>
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {applications.items.map(row => (
                                        <TableRow key={row.id}>
                                            <TableCell className="font-mono text-xs font-medium">{row.advanceNumber}</TableCell>
                                            <TableCell className="text-right font-semibold">{formatCurrency(row.amount)}</TableCell>
                                            <TableCell className="text-right">{formatCurrency(row.monthlyRepayment)}</TableCell>
                                            <TableCell className="text-right">{row.outstandingAmount === null ? '—' : formatCurrency(row.outstandingAmount)}</TableCell>
                                            <TableCell><AdvanceStatusBadge status={row.status} stage={row.currentStage} /></TableCell>
                                            <TableCell className="text-xs text-muted-foreground">{formatDay(row.createdAt)}</TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex justify-end gap-1">
                                                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0" title="View" onClick={() => setViewId(row.id)}><Eye className="h-4 w-4" /></Button>
                                                    {row.status === 'SUBMITTED' && (
                                                        <Button variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs text-destructive" onClick={() => setCancelling(row)}>
                                                            <XCircle className="h-4 w-4" /> Cancel
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
                    {applications && applications.total > applications.pageSize && (
                        <div className="flex items-center justify-between border-t p-3 text-xs">
                            <span className="text-muted-foreground">Page {page} of {Math.ceil(applications.total / applications.pageSize)}</span>
                            <div className="flex gap-2">
                                <Button variant="outline" size="sm" disabled={page <= 1 || listLoading} onClick={() => void loadApplications(page - 1)}>Previous</Button>
                                <Button variant="outline" size="sm" disabled={page * applications.pageSize >= applications.total || listLoading} onClick={() => void loadApplications(page + 1)}>Next</Button>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            <AdvanceDetailDialog advanceId={viewId} onClose={() => setViewId(null)} />

            <ConfirmationDialog
                open={!!cancelling}
                onOpenChange={value => { if (!value && !cancelBusy) setCancelling(null); }}
                onConfirm={() => void handleCancel()}
                title="Cancel this application?"
                description={`Are you sure you want to cancel ${cancelling?.advanceNumber ?? 'this application'}? This cannot be undone.`}
                confirmText="Cancel Application"
                type="warning"
                isLoading={cancelBusy}
            />
        </div>
    );
}
