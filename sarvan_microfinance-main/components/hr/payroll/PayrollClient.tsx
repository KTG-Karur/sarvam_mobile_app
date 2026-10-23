'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import {
    RefreshCw, Save, Loader2, DollarSign, TrendingUp, TrendingDown, CalendarDays,
    CheckCircle2, Banknote, Lock, Info,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageLoader } from '@/components/ui/page-loader';
import { MetricCard } from '@/components/dashboard/MetricCard';
import { apiClient } from '@/app/lib/api-client';
import { EmployeePicker } from './EmployeePicker';
import { tokenStorage } from '@/app/lib/token-storage';
import { BulkPayrollRunClient } from './BulkPayrollRunClient';
import { describeUnpaidDays, type UnpaidDaysBreakdown } from '@/app/lib/payroll/attendance-days';
import { Users, User as UserIcon } from 'lucide-react';

type BranchOption = { id: string; name: string; code: string };
type Employee = { id: string; name: string };

type ComponentItem = {
    id: string;
    salaryId: number;
    name: string;
    type: 'EARNINGS' | 'DEDUCTIONS';
    amount: number;
    readOnly: boolean;
    autoComputed: boolean;
    staffLoanBreakdown?: { loanNumber: string; installmentNo: number; amount: number; dueDate: string }[];
};

type CtcInfo = {
    totalPaidDays: number;
    lopDays: number;
    workingDays: number;
    actualBasic: number;
    actualHra: number;
    actualGross: number;
    monthlyCtc: number;
    lopBreakdown?: UnpaidDaysBreakdown;
};

type ExistingRecord = {
    id: string;
    paymentType: string;
    totalEarnings: number;
    totalDeductions: number;
    netPayable: number;
    status: 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'PAID';
    totalPaidDays: number | null;
    lopDays: number | null;
    approvedAt: string | null;
    paidAt: string | null;
};

const MONTH_OPTIONS = [
    { value: '1', label: 'January' }, { value: '2', label: 'February' }, { value: '3', label: 'March' },
    { value: '4', label: 'April' }, { value: '5', label: 'May' }, { value: '6', label: 'June' },
    { value: '7', label: 'July' }, { value: '8', label: 'August' }, { value: '9', label: 'September' },
    { value: '10', label: 'October' }, { value: '11', label: 'November' }, { value: '12', label: 'December' },
];
const PAYMENT_TYPES = ['Bank Transfer', 'Cash', 'Cheque'];
const CURRENT_CALENDAR_YEAR = new Date().getFullYear();
// Prior-year payroll must stay processable (a run for December can slip into
// January) — offer a small window around today rather than only this year.
const YEAR_OPTIONS = Array.from({ length: 5 }, (_, i) => String(CURRENT_CALENDAR_YEAR - 2 + i));

const formatCurrency = (value: number): string =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(value);

const STATUS_BADGE: Record<ExistingRecord['status'], { label: string; className: string }> = {
    DRAFT: { label: 'Draft', className: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
    PENDING_APPROVAL: { label: 'Pending Approval', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
    APPROVED: { label: 'Approved', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
    PAID: { label: 'Paid', className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
};

/** The original single-employee flow — Submit → Approve → Mark Paid, still
 * available for one-off corrections. Bulk Payroll Run (see PayrollClient
 * below) is the primary way payroll should be run for everyone at once. */
function IndividualPayrollRun() {
    const { toast } = useToast();

    const [branches, setBranches] = useState<BranchOption[]>([]);
    const [selectedBranchId, setSelectedBranchId] = useState('all');
    const [isLoadingBranches, setIsLoadingBranches] = useState(false);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [selectedEmployee, setSelectedEmployee] = useState<string>('all');
    const [paymentMonth, setPaymentMonth] = useState<string>('all');
    const [paymentYear, setPaymentYear] = useState<string>(String(CURRENT_CALENDAR_YEAR));
    const [paymentType, setPaymentType] = useState<string>('all');

    const [isInitialLoading, setIsInitialLoading] = useState(true);
    // Changing the branch reloads only the employee list - the filter card stays on screen (the full-page
    // loader is for the very first load only).
    const [isLoadingEmployees, setIsLoadingEmployees] = useState(false);
    const employeesRequestRef = useRef(0);
    const [isLoading, setIsLoading] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isActing, setIsActing] = useState(false);
    const [showData, setShowData] = useState(false);
    const [components, setComponents] = useState<ComponentItem[]>([]);
    const [ctcInfo, setCtcInfo] = useState<CtcInfo | null>(null);
    const [existingRecord, setExistingRecord] = useState<ExistingRecord | null>(null);

    useEffect(() => {
        setIsLoadingBranches(true);
        apiClient.get<BranchOption[]>('/branches?permitted=true')
            .then((res) => {
                if (res.success && res.data) setBranches(res.data.map((b) => ({ id: b.id, name: b.name, code: b.code })));
            })
            .catch(() => toast({ title: 'Error', description: 'Failed to load branches.', variant: 'destructive' }))
            .finally(() => setIsLoadingBranches(false));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const requestId = ++employeesRequestRef.current;
        const fetchEmployees = async () => {
            setIsLoadingEmployees(true);
            try {
                const params = new URLSearchParams({ branchScoped: 'true' });
                if (selectedBranchId !== 'all') params.set('branchId', selectedBranchId);
                const res = await apiClient.get<Employee[]>(`/employees?${params.toString()}`);
                // A newer branch selection superseded this request - drop the stale answer.
                if (requestId !== employeesRequestRef.current) return;
                if (res.success && res.data) setEmployees(res.data);
                else toast({ title: 'Error', description: res.error || 'Failed to load employees.', variant: 'destructive' });
            } catch {
                if (requestId === employeesRequestRef.current) {
                    toast({ title: 'Error', description: 'Failed to load employee list.', variant: 'destructive' });
                }
            } finally {
                if (requestId === employeesRequestRef.current) {
                    setIsLoadingEmployees(false);
                    setIsInitialLoading(false);
                }
            }
        };
        fetchEmployees();
        setSelectedEmployee('all');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedBranchId]);

    const fetchPayrollData = useCallback(async () => {
        if (selectedEmployee === 'all' || paymentMonth === 'all') return;
        setIsLoading(true);
        try {
            const url = `/payroll/salary-pay?employeeId=${selectedEmployee}&month=${paymentMonth}&year=${paymentYear}`;
            const res = await apiClient.get<{ components: ComponentItem[]; ctcInfo: CtcInfo | null; existingRecord: ExistingRecord | null }>(url);
            if (res.success && res.data) {
                setComponents(res.data.components);
                setCtcInfo(res.data.ctcInfo);
                setExistingRecord(res.data.existingRecord);
                if (res.data.existingRecord?.paymentType && paymentType === 'all') setPaymentType(res.data.existingRecord.paymentType);
                setShowData(true);
            } else {
                toast({ title: 'Error', description: res.error || 'Failed to load payroll data.', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'An unexpected error occurred.', variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedEmployee, paymentMonth, paymentYear]);

    useEffect(() => {
        if (selectedEmployee !== 'all' && paymentMonth !== 'all') {
            fetchPayrollData();
        } else {
            setShowData(false);
            setComponents([]);
            setCtcInfo(null);
            setExistingRecord(null);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedEmployee, paymentMonth, paymentYear]);

    const earnings = useMemo(() => components.filter((c) => c.type === 'EARNINGS'), [components]);
    const deductions = useMemo(() => components.filter((c) => c.type === 'DEDUCTIONS'), [components]);
    const staffLoanComponent = useMemo(() => components.find((c) => c.name.trim().toLowerCase() === 'staff loan'), [components]);

    const totals = useMemo(() => {
        const totalEarnings = earnings.reduce((sum, item) => sum + item.amount, 0);
        const totalDeductions = deductions.reduce((sum, item) => sum + item.amount, 0);
        return { totalEarnings, totalDeductions, netPayable: totalEarnings - totalDeductions };
    }, [earnings, deductions]);

    const isLocked = existingRecord?.status === 'APPROVED' || existingRecord?.status === 'PAID';

    const handleAmountChange = (id: string, value: string) => {
        if (value !== '' && isNaN(parseFloat(value))) return;
        setComponents((prev) => prev.map((c) => (c.id === id && !c.readOnly ? { ...c, amount: value === '' ? 0 : parseFloat(value) } : c)));
    };

    const handleSubmit = async () => {
        if (selectedEmployee === 'all') return toast({ title: 'Validation Error', description: 'Please select an employee.', variant: 'destructive' });
        if (paymentMonth === 'all') return toast({ title: 'Validation Error', description: 'Please select a payment month.', variant: 'destructive' });
        if (paymentType === 'all') return toast({ title: 'Validation Error', description: 'Please select a payment type.', variant: 'destructive' });

        setIsSubmitting(true);
        try {
            const payload = {
                employeeId: selectedEmployee,
                month: parseInt(paymentMonth),
                year: parseInt(paymentYear),
                paymentType,
                components: components.map((c) => ({ salaryComponentId: c.id, amount: c.amount || 0 })),
            };
            const res = await apiClient.post('/payroll/salary-pay', payload);
            if (res.success) {
                toast({
                    title: 'Success',
                    description: existingRecord ? 'Salary payment updated and pending approval.' : 'Salary payment submitted for approval.',
                    className: 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800',
                });
                fetchPayrollData();
            } else {
                toast({ title: 'Error', description: res.error || 'Failed to submit payment.', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'An unexpected error occurred.', variant: 'destructive' });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleAction = async (action: 'approve' | 'pay') => {
        if (!existingRecord) return;
        setIsActing(true);
        try {
            const res = await apiClient.patch('/payroll/salary-pay', { id: existingRecord.id, action });
            if (res.success) {
                toast({
                    title: 'Success',
                    description: action === 'approve' ? 'Payroll approved.' : 'Payroll marked as paid.',
                    className: 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800',
                });
                fetchPayrollData();
            } else {
                toast({ title: 'Error', description: res.error || `Failed to ${action}.`, variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'An unexpected error occurred.', variant: 'destructive' });
        } finally {
            setIsActing(false);
        }
    };

    const handleReset = () => {
        setSelectedEmployee('all');
        setPaymentMonth('all');
        setPaymentType('all');
        setShowData(false);
        setComponents([]);
        setCtcInfo(null);
        setExistingRecord(null);
        toast({ title: 'Form Reset', description: 'Form has been reset.' });
    };

    const renderComponentRows = (items: ComponentItem[], colorClass: string) => (
        <div className="space-y-3">
            {items.map((item) => (
                <div key={item.id} className="space-y-1">
                    <div
                        className={cn(
                            'flex items-center gap-4 p-3 rounded-lg border border-primary/20 dark:border-sidebar-accent bg-white dark:bg-brand-green-darker/50',
                            item.readOnly && 'bg-slate-50 dark:bg-sidebar-accent/30'
                        )}
                    >
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-sidebar-accent dark:text-slate-200 truncate flex items-center gap-1.5">
                                {item.name}
                                {item.readOnly && <Lock className="h-3 w-3 text-slate-400" />}
                                {item.autoComputed && !item.readOnly && (
                                    <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">auto</Badge>
                                )}
                            </p>
                            <p className="text-xs text-slate-500">ID: {item.salaryId}</p>
                        </div>
                        <div className="w-40">
                            <Input
                                type="number"
                                step="0.01"
                                min="0"
                                value={item.amount || ''}
                                onChange={(e) => handleAmountChange(item.id, e.target.value)}
                                disabled={item.readOnly || isLocked}
                                placeholder="0.00"
                                className={cn('text-right font-semibold bg-white dark:bg-sidebar-accent border-primary/30 dark:border-sidebar-accent', colorClass)}
                            />
                        </div>
                    </div>
                    {item.staffLoanBreakdown && item.staffLoanBreakdown.length > 0 && (
                        <div className="ml-3 pl-3 border-l-2 border-primary/20 space-y-1">
                            {item.staffLoanBreakdown.map((b, i) => (
                                <p key={i} className="text-xs text-slate-500 dark:text-slate-400">
                                    {b.loanNumber} · installment #{b.installmentNo} · due {b.dueDate} — {formatCurrency(b.amount)}
                                </p>
                            ))}
                        </div>
                    )}
                </div>
            ))}
            {items.length === 0 && (
                <div className="text-sm text-slate-500 dark:text-slate-400 py-6 text-center border border-dashed border-primary/30 dark:border-sidebar-accent rounded-lg">
                    No {items === earnings ? 'earning' : 'deduction'} components configured.
                </div>
            )}
        </div>
    );

    if (isInitialLoading) return <PageLoader label="Loading Payroll..." fullScreen={false} />;

    return (
        <div className="space-y-6">
            <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                <CardHeader className="bg-gradient-to-r from-primary via-primary to-purple-600 px-6 py-4">
                    <CardTitle className="text-lg font-semibold text-white">Payroll Run</CardTitle>
                </CardHeader>
                <CardContent className="p-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                        {branches.length > 1 && (
                            <div className="space-y-2">
                                <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">Branch</Label>
                                <Select value={selectedBranchId} onValueChange={setSelectedBranchId} disabled={isLoadingBranches}>
                                    <SelectTrigger className="w-full bg-white dark:bg-sidebar-accent"><SelectValue placeholder="All Branches" /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Branches</SelectItem>
                                        {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.code} - {b.name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}
                        <div className="space-y-2">
                            <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">Employee</Label>
                            <EmployeePicker employees={employees} value={selectedEmployee} onChange={setSelectedEmployee} isLoading={isLoadingEmployees} />
                        </div>
                        <div className="space-y-2">
                            <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">Month</Label>
                            <Select value={paymentMonth} onValueChange={setPaymentMonth}>
                                <SelectTrigger className="w-full bg-white dark:bg-sidebar-accent"><SelectValue placeholder="-- SELECT --" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">-- SELECT --</SelectItem>
                                    {MONTH_OPTIONS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">Year</Label>
                            <Select value={paymentYear} onValueChange={setPaymentYear}>
                                <SelectTrigger className="w-full bg-white dark:bg-sidebar-accent"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {YEAR_OPTIONS.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-3 mt-6">
                        <Button onClick={handleReset} variant="destructive" className="shadow-lg"><RefreshCw className="h-4 w-4 mr-2" />Reset</Button>
                    </div>
                </CardContent>
            </Card>

            {!isLoading && !showData && (selectedEmployee === 'all' || paymentMonth === 'all') && (
                <p className="px-1 text-sm text-slate-500 dark:text-slate-400">
                    Select an employee and a month to load their payroll.
                </p>
            )}

            {isLoading && (
                <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                    <CardContent className="py-12"><PageLoader label="Loading payroll data..." fullScreen={false} /></CardContent>
                </Card>
            )}

            {showData && !isLoading && (
                <>
                    {existingRecord && (
                        <div className="flex items-center gap-3">
                            <Badge className={STATUS_BADGE[existingRecord.status].className}>{STATUS_BADGE[existingRecord.status].label}</Badge>
                            {isLocked && (
                                <span className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
                                    <Lock className="h-3 w-3" /> This payroll record is locked — no further edits until reset by an approval reversal.
                                </span>
                            )}
                        </div>
                    )}

                    {ctcInfo && (
                        <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                            <CardHeader className="bg-gradient-to-r from-indigo-600 to-blue-600 px-6 py-4">
                                <CardTitle className="text-lg font-semibold text-white flex items-center gap-2"><CalendarDays className="h-5 w-5" />Attendance & CTC</CardTitle>
                            </CardHeader>
                            <CardContent className="p-6 grid grid-cols-2 md:grid-cols-4 gap-4">
                                <div><p className="text-xs text-slate-500">Month CTC Pay</p><p className="text-sm font-bold">{formatCurrency(ctcInfo.monthlyCtc)}</p></div>
                                <div><p className="text-xs text-slate-500">Total Paid Days</p><p className="text-sm font-bold">{ctcInfo.totalPaidDays}</p></div>
                                <div>
                                    <p className="text-xs text-slate-500">LOP</p>
                                    <p className="text-sm font-bold">{ctcInfo.lopDays}</p>
                                    <p className="text-[11px] text-slate-500">{describeUnpaidDays(ctcInfo.lopBreakdown)}</p>
                                </div>
                                <div><p className="text-xs text-slate-500">Working Days</p><p className="text-sm font-bold">{ctcInfo.workingDays}</p></div>
                                <div><p className="text-xs text-slate-500">Actual Basic</p><p className="text-sm font-bold">{formatCurrency(ctcInfo.actualBasic)}</p></div>
                                <div><p className="text-xs text-slate-500">Actual HRA</p><p className="text-sm font-bold">{formatCurrency(ctcInfo.actualHra)}</p></div>
                                <div><p className="text-xs text-slate-500">Actual Gross</p><p className="text-sm font-bold">{formatCurrency(ctcInfo.actualGross)}</p></div>
                                {ctcInfo.monthlyCtc === 0 && (
                                    <div className="col-span-full flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                                        <Info className="h-3.5 w-3.5" /> No Month CTC Pay set for this employee — set it on Salary Master first.
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <MetricCard title="Total Earnings" value={formatCurrency(totals.totalEarnings)} subtitle={`${earnings.length} earning components`} icon={TrendingUp} gradient="green" />
                        <MetricCard title="Total Deductions" value={formatCurrency(totals.totalDeductions)} subtitle={`${deductions.length} deduction components`} icon={TrendingDown} gradient="rose" />
                        <MetricCard title="Net Payable" value={formatCurrency(totals.netPayable)} subtitle="Earnings - Deductions" icon={DollarSign} gradient="blue" />
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                            <CardHeader className="bg-gradient-to-r from-emerald-600 to-green-600 px-6 py-4">
                                <CardTitle className="text-lg font-semibold text-white flex items-center gap-2"><TrendingUp className="h-5 w-5" />Earnings</CardTitle>
                            </CardHeader>
                            <CardContent className="p-4">{renderComponentRows(earnings, 'focus:ring-green-500')}</CardContent>
                        </Card>
                        <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                            <CardHeader className="bg-gradient-to-r from-rose-600 to-red-600 px-6 py-4">
                                <CardTitle className="text-lg font-semibold text-white flex items-center gap-2"><TrendingDown className="h-5 w-5" />Deductions</CardTitle>
                            </CardHeader>
                            <CardContent className="p-4">{renderComponentRows(deductions, 'focus:ring-red-500')}</CardContent>
                        </Card>
                    </div>

                    <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                        <CardContent className="p-6">
                            <div className="flex flex-col gap-4">
                                <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                                    <div className="w-full sm:w-64 space-y-2">
                                        <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">Payment Type</Label>
                                        <Select value={paymentType} onValueChange={setPaymentType} disabled={isLocked}>
                                            <SelectTrigger className="w-full bg-white dark:bg-sidebar-accent"><SelectValue placeholder="-- SELECT --" /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="all">-- SELECT --</SelectItem>
                                                {PAYMENT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-sm font-medium text-sidebar-accent dark:text-slate-400">Net Payable</p>
                                        <p className={cn('text-2xl font-bold', totals.netPayable >= 0 ? 'text-primary' : 'text-red-600 dark:text-red-400')}>
                                            {formatCurrency(totals.netPayable)}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex flex-wrap justify-end gap-3">
                                    {!isLocked && (
                                        <Button onClick={handleSubmit} disabled={isSubmitting} size="lg" className="bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white shadow-lg min-w-[200px]">
                                            {isSubmitting ? <><Loader2 className="h-5 w-5 mr-2 animate-spin" />Submitting...</> : <><Save className="h-5 w-5 mr-2" />{existingRecord ? 'Update & Resubmit' : 'Submit for Approval'}</>}
                                        </Button>
                                    )}
                                    {existingRecord?.status === 'PENDING_APPROVAL' && (
                                        <Button onClick={() => handleAction('approve')} disabled={isActing} size="lg" variant="outline" className="border-blue-300 text-blue-700 dark:text-blue-300 min-w-[160px]">
                                            {isActing ? <Loader2 className="h-5 w-5 mr-2 animate-spin" /> : <CheckCircle2 className="h-5 w-5 mr-2" />}Approve
                                        </Button>
                                    )}
                                    {existingRecord?.status === 'APPROVED' && (
                                        <Button onClick={() => handleAction('pay')} disabled={isActing} size="lg" className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow-lg min-w-[160px]">
                                            {isActing ? <Loader2 className="h-5 w-5 mr-2 animate-spin" /> : <Banknote className="h-5 w-5 mr-2" />}Mark Paid
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {staffLoanComponent && staffLoanComponent.amount > 0 && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                            <Info className="h-3.5 w-3.5" /> The Staff Loan deduction posts to the loan schedule as a pending recovery on submit, and becomes final only once this payroll is marked Paid.
                        </p>
                    )}
                </>
            )}
        </div>
    );
}

type PayrollMode = 'bulk' | 'individual';

/** Payroll should run for everyone at once (branch-wise or company-wide),
 * not one employee at a time — Bulk Run is the default/primary mode;
 * Individual stays available for one-off corrections. */
export function PayrollClient() {
    const [mode, setMode] = useState<PayrollMode>('bulk');

    return (
        <div className="space-y-6">
            <div className="inline-flex rounded-lg border border-primary/20 dark:border-sidebar-accent bg-white dark:bg-brand-green-darker/40 p-1 shadow-sm">
                <button
                    type="button"
                    onClick={() => setMode('bulk')}
                    className={cn(
                        'flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors',
                        mode === 'bulk' ? 'bg-primary text-white shadow' : 'text-sidebar-accent dark:text-slate-300 hover:bg-green-50 dark:hover:bg-sidebar-accent/50'
                    )}
                >
                    <Users className="h-4 w-4" /> Bulk Run (Branch / All Branches)
                </button>
                <button
                    type="button"
                    onClick={() => setMode('individual')}
                    className={cn(
                        'flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors',
                        mode === 'individual' ? 'bg-primary text-white shadow' : 'text-sidebar-accent dark:text-slate-300 hover:bg-green-50 dark:hover:bg-sidebar-accent/50'
                    )}
                >
                    <UserIcon className="h-4 w-4" /> Individual (correction)
                </button>
            </div>

            {mode === 'bulk' ? <BulkPayrollRunClient /> : <IndividualPayrollRun />}
        </div>
    );
}
