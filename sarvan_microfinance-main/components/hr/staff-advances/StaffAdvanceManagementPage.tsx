'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Banknote, BookOpen, Eye, HandCoins, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { apiClient } from '@/app/lib/api-client';
import { splitAdvanceInstallments, type AdvanceCapabilities, type AdvanceList, type AdvanceRow } from '@/app/lib/staff-advances/advance';
import { buildSalaryDueDates, defaultFirstDueMonth, firstSalaryDueDate, isValidSalaryDay, type FirstDueMonth } from '@/app/lib/staff-loans/salary-schedule';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageLoader } from '@/components/ui/page-loader';
import { AdvanceDetailDialog, AdvanceStatusBadge, formatCurrency, formatDay } from './StaffAdvanceParts';
import { DateInput } from '@/components/ui/date-input';

type TabKey = 'register' | 'disbursements';

// Business dates are Indian calendar dates: derive "today" in Asia/Kolkata, not from the UTC clock.
const todayInKolkata = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

function SummaryCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
    return (
        <Card className="shadow-sm">
            <CardContent className="space-y-1 p-4">
                <div className="text-xs text-muted-foreground">{label}</div>
                <div className="text-xl font-bold tracking-tight text-foreground">{value}</div>
                {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
            </CardContent>
        </Card>
    );
}

export default function StaffAdvanceManagementPage() {
    const { toast } = useToast();
    const [capabilities, setCapabilities] = useState<AdvanceCapabilities | null>(null);
    const [capsLoading, setCapsLoading] = useState(true);
    const [tab, setTab] = useState<TabKey>('register');
    const [list, setList] = useState<AdvanceList | null>(null);
    const [listLoading, setListLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [viewId, setViewId] = useState<string | null>(null);

    // Disburse dialog
    const [disbursing, setDisbursing] = useState<AdvanceRow | null>(null);
    const [disburseDate, setDisburseDate] = useState('');
    const [paymentMode, setPaymentMode] = useState<'CASH' | 'BANK_TRANSFER'>('BANK_TRANSFER');
    const [reference, setReference] = useState('');
    const [firstDueDate, setFirstDueDate] = useState('');
    const [firstDueMonth, setFirstDueMonth] = useState<FirstDueMonth>('NEXT_MONTH');
    const [remarks, setRemarks] = useState('');
    const [submitting, setSubmitting] = useState(false);

    // A bank transfer must carry its UTR / transaction reference.
    const referenceRequired = paymentMode === 'BANK_TRANSFER';
    const referenceMissing = referenceRequired && !reference.trim();

    // Salary date from the Staff Loan workflow master (disbursements tab list response); null until an admin sets it.
    const configuredSalaryDay = list?.salaryDay;
    const salaryDay: number | null = isValidSalaryDay(configuredSalaryDay) ? configuredSalaryDay : null;
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(disburseDate);
    const thisMonthAvailable = salaryDay !== null && validDate && firstSalaryDueDate(disburseDate, 'THIS_MONTH', salaryDay) >= disburseDate;
    const effectiveFirstDueMonth: FirstDueMonth = firstDueMonth === 'THIS_MONTH' && !thisMonthAvailable ? 'NEXT_MONTH' : firstDueMonth;

    const installmentPreview = useMemo(() => {
        if (!disbursing || !validDate || salaryDay === null) return [];
        const dates = buildSalaryDueDates(disburseDate, effectiveFirstDueMonth, salaryDay, disbursing.repaymentMonths);
        const amounts = splitAdvanceInstallments(disbursing.amount, disbursing.repaymentMonths);
        return dates.map((dueDate, i) => ({ installmentNo: i + 1, dueDate, amount: amounts[i] }));
    }, [disbursing, disburseDate, validDate, salaryDay, effectiveFirstDueMonth]);

    const loadList = useCallback(async (targetTab: TabKey, targetPage = 1) => {
        setListLoading(true);
        try {
            const res = await apiClient.get<AdvanceList>(`/hr/staff-advances?tab=${targetTab}&page=${targetPage}`);
            if (!res.success || !res.data) throw new Error(res.error || 'Failed to load staff advances');
            setList(res.data);
            setPage(targetPage);
        } catch (err) {
            toast({ title: 'Error', description: err instanceof Error ? err.message : 'Failed to load staff advances', variant: 'destructive' });
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
            const first: TabKey | null = res.data.register ? 'register' : res.data.disbursements ? 'disbursements' : null;
            if (first) { setTab(first); void loadList(first, 1); } else setListLoading(false);
        } catch (err) {
            toast({ title: 'Access Error', description: err instanceof Error ? err.message : 'Unable to determine your permissions', variant: 'destructive' });
            setListLoading(false);
        } finally {
            setCapsLoading(false);
        }
    }, [toast, loadList]);

    useEffect(() => { void loadCapabilities(); }, [loadCapabilities]);

    const switchTab = (next: TabKey) => {
        setTab(next);
        setList(null);
        void loadList(next, 1);
    };

    const openDisburse = (row: AdvanceRow) => {
        setDisbursing(row);
        const today = todayInKolkata();
        const nextMonth = new Date(`${today}T00:00:00Z`);
        nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
        setDisburseDate(today);
        setFirstDueDate(nextMonth.toISOString().split('T')[0]);
        setFirstDueMonth(salaryDay !== null ? defaultFirstDueMonth(today, salaryDay) : 'NEXT_MONTH');
        setPaymentMode('BANK_TRANSFER');
        setReference('');
        setRemarks('');
    };

    const confirmDisburse = async () => {
        if (!disbursing) return;
        if (referenceMissing) {
            toast({ title: 'Reference Required', description: 'Enter the payment reference / UTR number for a bank transfer.', variant: 'destructive' });
            return;
        }
        setSubmitting(true);
        try {
            const res = await apiClient.post('/hr/staff-advances/disburse', {
                id: disbursing.id, expectedVersion: disbursing.version, disbursementDate: disburseDate,
                paymentMode, reference: reference.trim() || null,
                // With a salary date the server builds both due dates from it; otherwise the entered date is used.
                ...(salaryDay !== null ? { firstDueMonth: effectiveFirstDueMonth } : { firstDueDate }),
                remarks: remarks.trim() || null,
            });
            if (!res.success) throw new Error(res.error || 'Disbursement failed');
            toast({ title: 'Advance Disbursed', description: `${disbursing.advanceNumber} is now active and its ${disbursing.repaymentMonths} installment${disbursing.repaymentMonths === 1 ? '' : 's'} ha${disbursing.repaymentMonths === 1 ? 's' : 've'} been scheduled.` });
            setDisbursing(null);
            void loadCapabilities();
            void loadList(tab, page);
        } catch (err) {
            toast({ title: 'Disbursement Failed', description: err instanceof Error ? err.message : 'Unable to disburse the advance.', variant: 'destructive' });
        } finally {
            setSubmitting(false);
        }
    };

    if (capsLoading) return <div className="p-8"><PageLoader label="Checking staff advance permissions..." fullScreen={false} /></div>;

    if (!capabilities?.register && !capabilities?.disbursements) {
        return (
            <div className="mx-auto max-w-3xl space-y-4 p-8 text-center">
                <ShieldCheck className="mx-auto h-12 w-12 text-muted-foreground/40" />
                <h2 className="text-xl font-semibold">Staff Advance Management</h2>
                <p className="text-sm text-muted-foreground">You do not hold view permission for staff advance management. Ask the administrator to grant it to your role.</p>
            </div>
        );
    }

    const summary = tab === 'register' ? list?.summary : null;

    return (
        <div className="mx-auto max-w-[1600px] space-y-6 p-4 md:p-8">
            <div className="flex flex-col justify-between gap-4 rounded-xl border bg-card p-6 shadow-sm sm:flex-row sm:items-center">
                <div className="space-y-1">
                    <div className="flex items-center gap-2">
                        <HandCoins className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
                        <h1 className="text-2xl font-bold tracking-tight">Staff Advance Management</h1>
                    </div>
                    <p className="text-sm text-muted-foreground">Track every staff advance: approval status, disbursement, repayment progress and the salary impact.</p>
                </div>
                <Button variant="outline" size="sm" className="gap-2" onClick={() => void loadList(tab, page)}><RefreshCw className="h-4 w-4" /> Refresh</Button>
            </div>

            <Tabs value={tab} onValueChange={value => switchTab(value as TabKey)}>
                <TabsList>
                    {capabilities?.register && <TabsTrigger value="register" className="gap-2"><BookOpen className="h-4 w-4" />Register</TabsTrigger>}
                    {capabilities?.disbursements && <TabsTrigger value="disbursements" className="gap-2"><Banknote className="h-4 w-4" />Disbursements</TabsTrigger>}
                </TabsList>
            </Tabs>

            {tab === 'register' && (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                    <SummaryCard label="Total Staff Advances" value={summary ? String(summary.totalAdvances) : '—'} hint="Excluding cancelled" />
                    <SummaryCard label="Active Advances" value={summary ? String(summary.activeAdvances) : '—'} />
                    <SummaryCard label="Completed Advances" value={summary ? String(summary.completedAdvances) : '—'} />
                    <SummaryCard label="Total Advance Amount" value={summary ? formatCurrency(summary.totalAdvanceAmount) : '—'} hint="Active and completed" />
                    <SummaryCard label="Total Outstanding" value={summary ? formatCurrency(summary.totalOutstanding) : '—'} />
                    <SummaryCard label="Repaid This Month" value={summary ? formatCurrency(summary.repaidThisMonth) : '—'} />
                </div>
            )}

            <Card className="border shadow-sm">
                <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                        <CardTitle className="text-lg">{tab === 'register' ? 'Staff Advance Register' : 'Approved Advances Awaiting Disbursement'}</CardTitle>
                        {list && <Badge variant="outline" className="text-xs">Total: {list.total}</Badge>}
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    {listLoading ? (
                        <div className="p-12"><PageLoader label="Loading staff advances..." fullScreen={false} /></div>
                    ) : !list || list.items.length === 0 ? (
                        <p className="py-16 text-center text-sm text-muted-foreground">
                            {tab === 'register' ? 'No staff advances found.' : 'No approved advances are waiting for disbursement.'}
                        </p>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-muted/40">
                                        <TableHead>Advance No.</TableHead>
                                        <TableHead>Employee ID</TableHead>
                                        <TableHead>Employee Name</TableHead>
                                        <TableHead>Department</TableHead>
                                        <TableHead>Designation</TableHead>
                                        <TableHead>Branch</TableHead>
                                        <TableHead className="text-right">Advance Amount</TableHead>
                                        <TableHead className="text-right">Total Repayable</TableHead>
                                        <TableHead className="text-right">Paid</TableHead>
                                        <TableHead className="text-right">Outstanding</TableHead>
                                        <TableHead className="text-right">Monthly Repayment</TableHead>
                                        <TableHead className="text-center">Paid Inst.</TableHead>
                                        <TableHead className="text-center">Remaining Inst.</TableHead>
                                        <TableHead className="text-right">Current In-Hand</TableHead>
                                        <TableHead className="text-right">Projected In-Hand</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead>Applied</TableHead>
                                        <TableHead>Approved</TableHead>
                                        <TableHead>Disbursed</TableHead>
                                        <TableHead>Completed</TableHead>
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {list.items.map(row => (
                                        <TableRow key={row.id} className="hover:bg-muted/30">
                                            <TableCell className="font-mono text-xs font-medium">{row.advanceNumber}</TableCell>
                                            <TableCell className="text-xs">{row.employeeCode ?? '—'}</TableCell>
                                            <TableCell className="whitespace-nowrap font-medium">{row.employeeName}</TableCell>
                                            <TableCell className="text-xs">{row.department ?? '—'}</TableCell>
                                            <TableCell className="text-xs">{row.designation}</TableCell>
                                            <TableCell className="text-xs">{row.branchName}</TableCell>
                                            <TableCell className="text-right font-semibold">{formatCurrency(row.amount)}</TableCell>
                                            <TableCell className="text-right">{formatCurrency(row.totalRepayable)}</TableCell>
                                            <TableCell className="text-right">{formatCurrency(row.paidAmount)}</TableCell>
                                            <TableCell className="text-right">{row.outstandingAmount === null ? '—' : formatCurrency(row.outstandingAmount)}</TableCell>
                                            <TableCell className="text-right">{formatCurrency(row.monthlyRepayment)}</TableCell>
                                            <TableCell className="text-center">{row.paidInstallments}</TableCell>
                                            <TableCell className="text-center">{row.remainingInstallments}</TableCell>
                                            <TableCell className="text-right">{row.currentInHand === null ? '—' : formatCurrency(row.currentInHand)}</TableCell>
                                            <TableCell className="text-right">{row.projectedInHand === null ? '—' : formatCurrency(row.projectedInHand)}</TableCell>
                                            <TableCell><AdvanceStatusBadge status={row.status} stage={row.currentStage} /></TableCell>
                                            <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDay(row.createdAt)}</TableCell>
                                            <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDay(row.approvedAt)}</TableCell>
                                            <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDay(row.disbursedAt)}</TableCell>
                                            <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDay(row.completedAt)}</TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex items-center justify-end gap-1">
                                                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0" title="View" onClick={() => setViewId(row.id)}><Eye className="h-4 w-4" /></Button>
                                                    {tab === 'disbursements' && row.canDisburse && (
                                                        <Button size="sm" className="h-8 gap-1.5 bg-emerald-600 text-xs text-white hover:bg-emerald-700" title="Disburse Advance" onClick={() => openDisburse(row)}>
                                                            <Banknote className="h-3.5 w-3.5" /> Disburse
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
                                <Button variant="outline" size="sm" disabled={page <= 1 || listLoading} onClick={() => void loadList(tab, page - 1)}>Previous</Button>
                                <Button variant="outline" size="sm" disabled={page * list.pageSize >= list.total || listLoading} onClick={() => void loadList(tab, page + 1)}>Next</Button>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            <AdvanceDetailDialog advanceId={viewId} onClose={() => setViewId(null)} />

            <Dialog open={!!disbursing} onOpenChange={open => { if (!open && !submitting) setDisbursing(null); }}>
                <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[min(680px,95vw)]">
                    <DialogHeader>
                        <DialogTitle>Disburse Staff Advance</DialogTitle>
                        <DialogDescription>{disbursing?.advanceNumber} — {disbursing?.employeeName}</DialogDescription>
                    </DialogHeader>

                    {disbursing && (
                        <div className="space-y-4 py-2">
                            <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted/50 p-3 text-xs">
                                <div><span className="text-muted-foreground">Advance Amount: </span><span className="font-semibold text-emerald-600 dark:text-emerald-400">{formatCurrency(disbursing.amount)}</span></div>
                                <div><span className="text-muted-foreground">Repayment: </span><span className="font-semibold">{disbursing.repaymentMonths} monthly {disbursing.repaymentMonths === 1 ? 'installment' : 'installments'}</span></div>
                                <div><span className="text-muted-foreground">Interest: </span><span className="font-medium">Interest-free (₹0)</span></div>
                                <div><span className="text-muted-foreground">Monthly Repayment: </span><span className="font-semibold">{formatCurrency(disbursing.monthlyRepayment)}</span></div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1.5">
                                    <Label htmlFor="adv-disb-date" className="text-xs">Disbursement Date</Label>
                                    <DateInput id="adv-disb-date" value={disburseDate} onChange={e => setDisburseDate(e.target.value)} className="text-xs" />
                                </div>
                                <div className="space-y-1.5">
                                    <Label htmlFor="adv-disb-mode" className="text-xs">Payment Mode</Label>
                                    <Select value={paymentMode} onValueChange={val => setPaymentMode(val as 'CASH' | 'BANK_TRANSFER')}>
                                        <SelectTrigger id="adv-disb-mode" className="text-xs"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="BANK_TRANSFER">Bank Transfer</SelectItem>
                                            <SelectItem value="CASH">Cash Payment</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            <div className="space-y-1.5">
                                <Label htmlFor="adv-disb-ref" className="text-xs">
                                    Payment Reference / UTR{referenceRequired && <span className="text-destructive"> *</span>}
                                </Label>
                                <Input
                                    id="adv-disb-ref" placeholder="e.g. UTR12345678" value={reference} onChange={e => setReference(e.target.value)}
                                    required={referenceRequired} aria-invalid={referenceMissing}
                                    className={`text-xs ${referenceMissing ? 'border-destructive' : ''}`}
                                />
                                {referenceMissing && <p className="text-[11px] text-destructive">Required for a bank transfer.</p>}
                            </div>

                            {/* First due date: the staff loan rules (salary date, this month / next month) */}
                            {salaryDay !== null ? (
                                <div className="space-y-1.5">
                                    <Label className="text-xs">First Due Date Month</Label>
                                    <RadioGroup value={effectiveFirstDueMonth} onValueChange={val => setFirstDueMonth(val as FirstDueMonth)} className="grid grid-cols-2 gap-2">
                                        <div>
                                            <RadioGroupItem value="THIS_MONTH" id="adv-due-this-month" className="peer sr-only" disabled={!thisMonthAvailable} />
                                            <Label
                                                htmlFor="adv-due-this-month"
                                                className={`flex items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-xs peer-data-[state=checked]:border-emerald-600 ${thisMonthAvailable ? 'cursor-pointer hover:bg-accent' : 'cursor-not-allowed opacity-50'}`}
                                            >
                                                This month
                                            </Label>
                                        </div>
                                        <div>
                                            <RadioGroupItem value="NEXT_MONTH" id="adv-due-next-month" className="peer sr-only" />
                                            <Label
                                                htmlFor="adv-due-next-month"
                                                className="flex items-center justify-center rounded-md border-2 border-muted bg-popover p-2 text-xs cursor-pointer hover:bg-accent peer-data-[state=checked]:border-emerald-600"
                                            >
                                                Next month
                                            </Label>
                                        </div>
                                    </RadioGroup>
                                    {!thisMonthAvailable && (
                                        <p className="text-[11px] text-muted-foreground">This month&apos;s salary date has already passed for this disbursement date.</p>
                                    )}
                                </div>
                            ) : (
                                <div className="space-y-1.5">
                                    <Label htmlFor="adv-disb-due" className="text-xs">First Due Date</Label>
                                    <DateInput id="adv-disb-due" value={firstDueDate} onChange={e => setFirstDueDate(e.target.value)} className="text-xs" />
                                </div>
                            )}

                            {salaryDay !== null ? (
                                <div className="space-y-2 rounded-md border bg-muted/40 p-3 text-xs">
                                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                                        <span>
                                            <span className="text-muted-foreground">Salary date: </span>
                                            <span className="font-semibold text-foreground">{salaryDay}{salaryDay === 31 ? ' (last day in shorter months)' : ''} of every month</span>
                                        </span>
                                        <span>
                                            <span className="text-muted-foreground">First due date: </span>
                                            <span className="font-semibold text-emerald-700 dark:text-emerald-400">{installmentPreview[0] ? formatDay(installmentPreview[0].dueDate) : '—'}</span>
                                        </span>
                                    </div>
                                    <p className="text-[11px] text-muted-foreground">If a due date falls on a Sunday it moves to the previous day (Saturday), for every installment.</p>
                                    {installmentPreview.length > 0 && (
                                        <div className="overflow-hidden rounded border bg-background">
                                            {installmentPreview.map(row => (
                                                <div key={row.installmentNo} className="flex items-center justify-between border-b px-2 py-1.5 text-[11px] last:border-b-0">
                                                    <span className="text-muted-foreground">Installment {row.installmentNo} of {disbursing.repaymentMonths}</span>
                                                    <span className="font-medium text-foreground">{formatDay(row.dueDate)}</span>
                                                    <span className="font-semibold">{formatCurrency(row.amount)}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <p className="rounded-md border border-amber-300/60 bg-amber-50 p-2 text-[11px] text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                                    No salary date is set yet. Set one under Masters &gt; Staff Loan Approval Workflow so due dates follow it automatically. For now the first due date is entered manually and the second installment falls one month later.
                                </p>
                            )}

                            <div className="space-y-1.5">
                                <Label htmlFor="adv-disb-remarks" className="text-xs">Disbursement Remarks</Label>
                                <Input id="adv-disb-remarks" placeholder="Optional notes..." value={remarks} onChange={e => setRemarks(e.target.value)} className="text-xs" />
                            </div>
                        </div>
                    )}

                    <DialogFooter className="gap-2">
                        <Button variant="outline" size="sm" disabled={submitting} onClick={() => setDisbursing(null)}>Cancel</Button>
                        <Button
                            size="sm" className="bg-emerald-600 text-white hover:bg-emerald-700"
                            disabled={submitting || !disburseDate || referenceMissing || (salaryDay === null && !firstDueDate)} onClick={() => void confirmDisburse()}
                        >
                            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Confirm Disbursement'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
