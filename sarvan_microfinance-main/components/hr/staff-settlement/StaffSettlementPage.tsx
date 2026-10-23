'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, FilterX, HandCoins, Loader2, RefreshCw, Search, Wallet } from 'lucide-react';
import { apiClient } from '@/app/lib/api-client';
import type {
    SettlementCapabilities, SettlementDetail, SettlementKind, SettlementListItem, SettlementScheduleRow,
} from '@/app/lib/staff-settlement/settlement';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageLoader } from '@/components/ui/page-loader';

type PaymentMode = 'CASH' | 'BANK_TRANSFER';

const KIND_LABEL: Record<SettlementKind, string> = { LOAN: 'Staff Loan', ADVANCE: 'Staff Advance' };

// Base roles (User.role), same list the HR report filters use.
const ROLE_OPTIONS = ['ADMIN', 'BRANCH_MANAGER', 'FDO', 'AREA_MANAGER', 'DIVISION_MANAGER'];
type FilterOption = { id: string; name: string };

const formatCurrency = (val: number | null | undefined) => {
    if (val === null || val === undefined || isNaN(val)) return '₹0.00';
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(val);
};

const statusBadge = (status: SettlementScheduleRow['status']) => {
    switch (status) {
        case 'PAID': return <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white">PAID</Badge>;
        case 'PARTIAL': return <Badge className="bg-amber-500 hover:bg-amber-500 text-white">PARTIAL</Badge>;
        case 'OVERDUE': return <Badge variant="destructive">OVERDUE</Badge>;
        default: return <Badge variant="outline" className="text-muted-foreground">PENDING</Badge>;
    }
};

function Field({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
    return (
        <div>
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className={strong ? 'text-sm font-bold text-foreground' : 'text-sm font-medium text-foreground'}>{value ?? '—'}</div>
        </div>
    );
}

export default function StaffSettlementPage() {
    const { toast } = useToast();

    const [capabilities, setCapabilities] = useState<SettlementCapabilities | null>(null);
    const [kind, setKind] = useState<SettlementKind>('LOAN');
    const [loading, setLoading] = useState(true);
    const [items, setItems] = useState<SettlementListItem[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [branchId, setBranchId] = useState('all');
    const [role, setRole] = useState('all');
    const [departmentId, setDepartmentId] = useState('all');
    const [branches, setBranches] = useState<FilterOption[]>([]);
    const [departments, setDepartments] = useState<FilterOption[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [detail, setDetail] = useState<SettlementDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);

    const [paymentMode, setPaymentMode] = useState<PaymentMode>('CASH');
    const [reference, setReference] = useState('');
    const [remarks, setRemarks] = useState('');
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    const viewable = capabilities ? (['LOAN', 'ADVANCE'] as const).filter(k => capabilities[k === 'LOAN' ? 'loan' : 'advance'].view) : [];

    useEffect(() => {
        (async () => {
            const res = await apiClient.get<SettlementCapabilities>('/hr/staff-settlement');
            if (res.success && res.data) {
                setCapabilities(res.data);
                if (!res.data.loan.view && res.data.advance.view) setKind('ADVANCE');
            } else {
                toast({ title: 'Error', description: res.error || 'Could not load settlement access.', variant: 'destructive' });
            }
            setLoading(false);
        })();
    }, [toast]);

    // Branch list is already limited to what this user may see; the settlement API re-checks it.
    useEffect(() => {
        apiClient.get<FilterOption[]>('/branches?permitted=true').then(res => { if (res.success && res.data) setBranches(res.data); });
        apiClient.get<FilterOption[]>('/hr/departments').then(res => { if (res.success && res.data) setDepartments(res.data); });
    }, []);

    const loadList = useCallback(async (type: SettlementKind, search?: string) => {
        const query = new URLSearchParams({ type });
        if (search?.trim()) query.set('search', search.trim());
        if (branchId !== 'all') query.set('branchId', branchId);
        if (role !== 'all') query.set('role', role);
        if (departmentId !== 'all') query.set('departmentId', departmentId);
        const res = await apiClient.get<SettlementListItem[]>(`/hr/staff-settlement?${query.toString()}`);
        if (res.success && res.data) setItems(res.data);
        else toast({ title: 'Error', description: res.error || 'Failed to load the list.', variant: 'destructive' });
    }, [toast, branchId, role, departmentId]);

    const loadDetail =useCallback(async (type: SettlementKind, id: string) => {
        setDetailLoading(true);
        const res = await apiClient.get<SettlementDetail>(`/hr/staff-settlement?type=${type}&id=${encodeURIComponent(id)}`);
        if (res.success && res.data) {
            setDetail(res.data);
        } else {
            setDetail(null);
            toast({ title: 'Error', description: res.error || 'Failed to load settlement details.', variant: 'destructive' });
        }
        setDetailLoading(false);
    }, [toast]);

    // A different type or filter is a different list: clear the selection so balances can never be mixed.
    // The search text is deliberately not a dependency: it only applies when Search is submitted.
    const searchRef = useRef('');
    searchRef.current = searchTerm;
    useEffect(() => {
        if (!capabilities) return;
        setSelectedId(null);
        setDetail(null);
        setItems([]);
        if (capabilities[kind === 'LOAN' ? 'loan' : 'advance'].view) void loadList(kind, searchRef.current);
    }, [kind, capabilities, loadList]);

    const changeKind = (value: SettlementKind) => {
        setSearchTerm('');
        searchRef.current = '';
        setKind(value);
    };

    const filtersActive = branchId !== 'all' || role !== 'all' || departmentId !== 'all' || searchTerm.trim() !== '';
    const clearFilters = () => {
        setSearchTerm('');
        searchRef.current = '';
        // Only the search text was active: no dropdown changes, so the list will not reload by itself.
        if (branchId === 'all' && role === 'all' && departmentId === 'all') void loadList(kind, '');
        setBranchId('all');
        setRole('all');
        setDepartmentId('all');
    };

    useEffect(() => {
        if (selectedId) void loadDetail(kind, selectedId);
    }, [selectedId, kind, loadDetail]);

    const select = (id: string) => {
        setSelectedId(id);
        setPaymentMode('CASH');
        setReference('');
        setRemarks('');
    };

    const refreshAll = async () => {
        await loadList(kind, searchTerm);
        if (selectedId) await loadDetail(kind, selectedId);
    };

    const openConfirm = () => {
        if (paymentMode === 'BANK_TRANSFER' && !reference.trim()) {
            toast({ title: 'Validation Error', description: 'Enter the payment reference / UTR number for a bank transfer.', variant: 'destructive' });
            return;
        }
        setConfirmOpen(true);
    };

    const handleSettle = async () => {
        if (!detail) return;
        setSubmitting(true);
        try {
            const res = await apiClient.post('/hr/staff-settlement', {
                type: detail.type,
                id: detail.id,
                paymentMode,
                reference: paymentMode === 'BANK_TRANSFER' ? reference.trim() : undefined,
                remarks: remarks.trim() || undefined,
                expectedVersion: detail.version,
                expectedAmount: detail.settlement.amount,
            });
            if (!res.success) throw new Error(res.error || 'Could not process the settlement.');
            toast({ title: 'Settled', description: `${KIND_LABEL[detail.type]} ${detail.number} has been settled for ${formatCurrency(detail.settlement.amount)}.` });
            setConfirmOpen(false);
            setSelectedId(null);
            setDetail(null);
            await loadList(kind, searchTerm);
        } catch (error) {
            toast({ title: 'Settlement Failed', description: error instanceof Error ? error.message : 'Could not process the settlement.', variant: 'destructive' });
            // A conflict means the balance or version moved: show the fresh figures.
            setConfirmOpen(false);
            await refreshAll();
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) return <PageLoader />;

    if (!viewable.length) {
        return (
            <div className="p-6 max-w-3xl mx-auto">
                <Card className="p-10 text-center text-muted-foreground">You do not have access to Staff Loan or Staff Advance settlement.</Card>
            </div>
        );
    }

    const isLoan = detail?.type === 'LOAN';

    return (
        <div className="p-6 space-y-6 max-w-7xl mx-auto">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b pb-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
                        <HandCoins className="h-6 w-6 text-primary" />
                        Staff Early Settlement
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">Settle the outstanding balance of an active Staff Loan or Staff Advance in one payment.</p>
                </div>
                <Button variant="outline" size="sm" onClick={refreshAll} className="flex items-center gap-1.5">
                    <RefreshCw className="h-4 w-4" />
                    Refresh
                </Button>
            </div>

            <div className="flex flex-col lg:flex-row lg:items-end gap-4">
                <div className="space-y-1.5 w-full lg:w-64">
                    <Label className="text-xs">Settlement For</Label>
                    <Tabs value={kind} onValueChange={value => changeKind(value as SettlementKind)}>
                        <TabsList className="grid w-full" style={{ gridTemplateColumns: `repeat(${viewable.length}, minmax(0, 1fr))` }}>
                            {viewable.map(k => <TabsTrigger key={k} value={k}>{KIND_LABEL[k]}</TabsTrigger>)}
                        </TabsList>
                    </Tabs>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 flex-1">
                    <div className="space-y-1.5">
                        <Label className="text-xs">Branch</Label>
                        <Select value={branchId} onValueChange={setBranchId}>
                            <SelectTrigger><SelectValue placeholder="All Branches" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Branches</SelectItem>
                                {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1.5">
                        <Label className="text-xs">Role</Label>
                        <Select value={role} onValueChange={setRole}>
                            <SelectTrigger><SelectValue placeholder="All Roles" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Roles</SelectItem>
                                {ROLE_OPTIONS.map(r => <SelectItem key={r} value={r}>{r.replace(/_/g, ' ')}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1.5">
                        <Label className="text-xs">Department</Label>
                        <Select value={departmentId} onValueChange={setDepartmentId}>
                            <SelectTrigger><SelectValue placeholder="All Departments" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Departments</SelectItem>
                                {departments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={clearFilters} disabled={!filtersActive} className="flex items-center gap-1.5 h-10">
                    <FilterX className="h-4 w-4" />
                    Clear
                </Button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Left: active loans / advances of the chosen type */}
                <div className="lg:col-span-4">
                    <Card className="shadow-sm">
                        <CardHeader className="p-4 pb-2">
                            <CardTitle className="text-base font-semibold">Active {KIND_LABEL[kind]}s</CardTitle>
                        </CardHeader>
                        <CardContent className="p-4 pt-2 space-y-3">
                            <form onSubmit={e => { e.preventDefault(); void loadList(kind, searchTerm); }} className="flex gap-2">
                                <div className="relative flex-1">
                                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        placeholder={`Search by ${kind === 'LOAN' ? 'loan' : 'advance'} # or staff...`}
                                        value={searchTerm}
                                        onChange={e => setSearchTerm(e.target.value)}
                                        className="pl-8 h-9 text-sm"
                                    />
                                </div>
                                <Button type="submit" size="sm" variant="secondary" className="h-9">Search</Button>
                            </form>
                            <div className="divide-y max-h-[600px] overflow-y-auto rounded-md border">
                                {items.length === 0 ? (
                                    <div className="p-6 text-center text-sm text-muted-foreground">No active {KIND_LABEL[kind].toLowerCase()}s found.</div>
                                ) : items.map(item => (
                                    <div
                                        key={item.id}
                                        onClick={() => select(item.id)}
                                        className={`p-3 text-left transition-colors cursor-pointer ${item.id === selectedId ? 'bg-primary/10 border-l-4 border-l-primary' : 'hover:bg-muted/50'}`}
                                    >
                                        <div className="font-semibold text-sm text-foreground">{item.number}</div>
                                        <div className="text-xs font-medium text-foreground mt-1">{item.employeeName} {item.employeeCode ? `(${item.employeeCode})` : ''}</div>
                                        <div className="flex items-center justify-between text-xs text-muted-foreground mt-2">
                                            <span>{item.department ? `${item.department} • ` : ''}{item.branchName}</span>
                                            <span className="font-semibold text-foreground">{formatCurrency(item.totalOutstanding)}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Right: details + settlement */}
                <div className="lg:col-span-8 space-y-6">
                    {detailLoading && !detail ? (
                        <div className="p-12 text-center"><Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" /></div>
                    ) : !detail ? (
                        <Card className="p-12 text-center text-muted-foreground">Select an active {KIND_LABEL[kind].toLowerCase()} to see its outstanding balance and settle it.</Card>
                    ) : (
                        <>
                            <Card className="shadow-sm">
                                <CardHeader className="p-4 pb-2">
                                    <CardTitle className="text-base font-semibold flex items-center gap-2">
                                        {KIND_LABEL[detail.type]} Details
                                        <Badge variant="default">{detail.number}</Badge>
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="p-4 pt-2 space-y-4">
                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                                        <Field label={isLoan ? 'Loan Number' : 'Advance Number'} value={detail.number} strong />
                                        <Field label="Employee Name" value={detail.employee.name} />
                                        <Field label="Employee ID" value={detail.employee.code} />
                                        <Field label="Department" value={detail.employee.department} />
                                        <Field label="Designation" value={detail.employee.designation} />
                                        <Field label="Branch" value={detail.branchName} />
                                    </div>
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                        <div className="bg-muted/40 p-3 rounded-lg border"><Field label={isLoan ? 'Original Loan Amount' : 'Original Advance Amount'} value={formatCurrency(detail.originalAmount)} strong /></div>
                                        <div className="bg-muted/40 p-3 rounded-lg border"><Field label="Total Repayable" value={formatCurrency(detail.totalRepayable)} strong /></div>
                                        <div className="bg-muted/40 p-3 rounded-lg border"><Field label="Paid Amount" value={<span className="text-emerald-600">{formatCurrency(detail.paidAmount)}</span>} strong /></div>
                                        <div className="bg-muted/40 p-3 rounded-lg border"><Field label="Remaining Installments" value={`${detail.remainingInstallments} of ${detail.totalInstallments}`} strong /></div>
                                        <div className="bg-muted/40 p-3 rounded-lg border"><Field label="Principal Outstanding" value={formatCurrency(detail.principalOutstanding)} strong /></div>
                                        {isLoan && <div className="bg-muted/40 p-3 rounded-lg border"><Field label="Interest Outstanding" value={formatCurrency(detail.interestOutstanding)} strong /></div>}
                                        <div className="bg-muted/40 p-3 rounded-lg border"><Field label="Total Outstanding" value={<span className="text-primary">{formatCurrency(detail.totalOutstanding)}</span>} strong /></div>
                                    </div>
                                </CardContent>
                            </Card>

                            {detail.salary && (
                                <Card className="shadow-sm">
                                    <CardHeader className="p-4 pb-2">
                                        <CardTitle className="text-base font-semibold flex items-center gap-2"><Wallet className="h-4 w-4 text-primary" />Salary Impact</CardTitle>
                                    </CardHeader>
                                    <CardContent className="p-4 pt-2">
                                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                                            <Field label="Current Salary (Gross)" value={formatCurrency(detail.salary.currentSalary)} />
                                            <Field label="Other Deductions" value={formatCurrency(detail.salary.otherDeductions)} />
                                            <Field label="Staff Loan Deduction" value={formatCurrency(detail.salary.existingLoanDeduction)} />
                                            <Field label="Staff Advance Deduction" value={formatCurrency(detail.salary.existingAdvanceDeduction)} />
                                            <Field label="Current In-Hand Salary" value={formatCurrency(detail.salary.currentInHand)} strong />
                                            <Field label={`Removed on Settlement (${isLoan ? 'this loan' : 'this advance'})`} value={formatCurrency(detail.salary.thisObligationDeduction)} />
                                            <Field label="Expected In-Hand Salary" value={<span className="text-emerald-600">{formatCurrency(detail.salary.expectedInHand)}</span>} strong />
                                        </div>
                                    </CardContent>
                                </Card>
                            )}

                            <Card className="shadow-sm">
                                <CardContent className="p-0">
                                    <Table>
                                        <TableHeader>
                                            <TableRow className="bg-muted/30">
                                                <TableHead className="w-12 text-center">#</TableHead>
                                                <TableHead>Month</TableHead>
                                                <TableHead className="text-right">Principal</TableHead>
                                                {isLoan && <TableHead className="text-right">Interest</TableHead>}
                                                <TableHead className="text-right">Total Due</TableHead>
                                                <TableHead className="text-right">Paid</TableHead>
                                                <TableHead className="text-right">Outstanding</TableHead>
                                                <TableHead className="text-center">Status</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {detail.schedule.map(s => (
                                                <TableRow key={s.installmentNo} className="text-xs">
                                                    <TableCell className="text-center font-medium">{s.installmentNo}</TableCell>
                                                    <TableCell>{s.month}</TableCell>
                                                    <TableCell className="text-right font-mono">{formatCurrency(s.principal)}</TableCell>
                                                    {isLoan && <TableCell className="text-right font-mono">{formatCurrency(s.interest)}</TableCell>}
                                                    <TableCell className="text-right font-mono font-medium">{formatCurrency(s.totalDue)}</TableCell>
                                                    <TableCell className="text-right font-mono text-emerald-600">{formatCurrency(s.paid)}</TableCell>
                                                    <TableCell className="text-right font-mono font-semibold">{formatCurrency(s.outstanding)}</TableCell>
                                                    <TableCell className="text-center">{statusBadge(s.status)}</TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </CardContent>
                            </Card>

                            <Card className="shadow-sm">
                                <CardHeader className="p-4 pb-2">
                                    <CardTitle className="text-base font-semibold">Early Settlement</CardTitle>
                                </CardHeader>
                                <CardContent className="p-4 pt-2 space-y-4">
                                    <div className="p-4 rounded-lg bg-muted/40 border space-y-3">
                                        <div className="text-xs font-semibold uppercase tracking-wider">Settlement Amount</div>
                                        <div className={`grid grid-cols-1 ${isLoan ? 'sm:grid-cols-4' : 'sm:grid-cols-2'} gap-3 text-sm`}>
                                            <Field label="Outstanding Principal" value={formatCurrency(detail.settlement.principal)} strong />
                                            {isLoan && <Field label="Interest Due to Date" value={formatCurrency(detail.settlement.interest)} strong />}
                                            {isLoan && (
                                                <Field label="Future Interest Waived" value={<span className="text-emerald-600">{formatCurrency(detail.settlement.waivedInterest)}</span>} strong />
                                            )}
                                            <div className="sm:text-right">
                                                <div className="text-xs text-muted-foreground">Total Settlement Amount</div>
                                                <div className="text-lg font-bold text-primary">{formatCurrency(detail.settlement.amount)}</div>
                                            </div>
                                        </div>
                                        <p className="text-[11px] text-muted-foreground">
                                            {isLoan
                                                ? 'Calculated from the loan schedule and repayment ledger as of today. Interest on installments not yet due is waived. The amount cannot be edited.'
                                                : 'A staff advance carries no interest: the settlement is the unpaid advance amount. It is calculated from the schedule and cannot be edited.'}
                                        </p>
                                    </div>

                                    {detail.blockedReason && (
                                        <div className="p-3 text-sm rounded-md border border-amber-300 bg-amber-50 text-amber-900">{detail.blockedReason}</div>
                                    )}

                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                        <div className="space-y-1.5">
                                            <Label className="text-xs">Payment Method *</Label>
                                            <Select value={paymentMode} onValueChange={value => setPaymentMode(value as PaymentMode)} disabled={!detail.canSettle}>
                                                <SelectTrigger><SelectValue placeholder="Select method" /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="CASH">Cash</SelectItem>
                                                    <SelectItem value="BANK_TRANSFER">Bank Transfer</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="space-y-1.5">
                                            <Label className="text-xs">Settlement Date</Label>
                                            <Input value={detail.settlement.settlementDate} readOnly disabled />
                                        </div>
                                        {paymentMode === 'BANK_TRANSFER' && (
                                            <div className="space-y-1.5">
                                                <Label htmlFor="settleRef" className="text-xs">Reference / UTR Number *</Label>
                                                <Input id="settleRef" value={reference} onChange={e => setReference(e.target.value)} placeholder="e.g. UTR123456" disabled={!detail.canSettle} />
                                            </div>
                                        )}
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label htmlFor="settleRemarks" className="text-xs">Remarks</Label>
                                        <Textarea id="settleRemarks" value={remarks} onChange={e => setRemarks(e.target.value)} placeholder="Optional settlement notes" rows={2} disabled={!detail.canSettle} />
                                    </div>
                                    <div className="flex justify-end pt-2">
                                        <Button type="button" onClick={openConfirm} disabled={!detail.canSettle} className="min-w-[180px]">
                                            <CheckCircle2 className="mr-2 h-4 w-4" />
                                            Process Early Settlement
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        </>
                    )}
                </div>
            </div>

            <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Confirm Early Settlement</DialogTitle>
                        <DialogDescription className="text-xs">
                            This records the payment, settles every remaining installment and closes the {detail ? KIND_LABEL[detail.type].toLowerCase() : 'account'}. It cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    {detail && (
                        <div className="space-y-3 py-2 text-sm">
                            <div className="flex justify-between border-b pb-2"><span className="text-muted-foreground">{KIND_LABEL[detail.type]}</span><span className="font-semibold">{detail.number}</span></div>
                            <div className="flex justify-between border-b pb-2"><span className="text-muted-foreground">Employee</span><span className="font-semibold">{detail.employee.name}</span></div>
                            <div className="flex justify-between border-b pb-2"><span className="text-muted-foreground">Settlement Amount</span><span className="font-bold text-primary text-base">{formatCurrency(detail.settlement.amount)}</span></div>
                            <div className="flex justify-between"><span className="text-muted-foreground">Payment Method</span><span className="font-medium">{paymentMode === 'CASH' ? 'Cash' : `Bank Transfer (${reference.trim()})`}</span></div>
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={submitting}>Cancel</Button>
                        <Button onClick={handleSettle} disabled={submitting}>
                            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Confirm &amp; Settle
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
