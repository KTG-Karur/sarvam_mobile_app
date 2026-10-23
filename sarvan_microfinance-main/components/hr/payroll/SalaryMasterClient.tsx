'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { RefreshCw, Save, Loader2, DollarSign, TrendingUp, TrendingDown, FileText, Wallet, BadgePercent } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageLoader } from '@/components/ui/page-loader';
import { MetricCard } from '@/components/dashboard/MetricCard';
import { apiClient } from '@/app/lib/api-client';
import { EmployeePicker } from './EmployeePicker';
import { tokenStorage } from '@/app/lib/token-storage';
import { BulkSalaryMasterClient } from './BulkSalaryMasterClient';
import { Users, User as UserIcon } from 'lucide-react';

type BranchOption = { id: string; name: string; code: string };

type SalaryComponentItem = {
    id: string;
    salaryId: number;
    name: string;
    type: 'EARNINGS' | 'DEDUCTIONS';
    amount: number;
    masterId: string | null;
    isPercentBased: boolean;
    defaultPercent: number | null;
    percentBasis: 'BASIC' | 'GROSS' | null;
    maxAmount: number | null;
    percentOverride: number | null;
};

type Employee = {
    id: string;
    name: string;
};

type SalaryMasterData = {
    monthlyCtc: number;
    yearCtc: number;
    designationName: string | null;
    basicPercent: number;
    hraPercent: number;
    basic: number;
    hra: number;
    components: SalaryComponentItem[];
};

const formatCurrency = (value: number): string =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(value);

/** The original single-employee flow, kept for one-off review/correction —
 * Bulk Salary Master (below) is the primary way to set Month CTC Pay for
 * everyone at once. */
function IndividualSalaryMaster() {
    const { toast } = useToast();
    const [branches, setBranches] = useState<BranchOption[]>([]);
    const [selectedBranchId, setSelectedBranchId] = useState('all');
    const [isLoadingBranches, setIsLoadingBranches] = useState(false);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [selectedEmployee, setSelectedEmployee] = useState<string>('all');
    const [monthlyCtc, setMonthlyCtc] = useState<string>('0');
    const [masterData, setMasterData] = useState<SalaryMasterData | null>(null);
    const [components, setComponents] = useState<SalaryComponentItem[]>([]);
    const [isInitialLoading, setIsInitialLoading] = useState(true);
    const employeesRequestRef = useRef(0);
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [showData, setShowData] = useState(false);

    // Branch filter — ADMIN sees all branches, AREA_MANAGER scoped to their assigned branches
    useEffect(() => {
        setIsLoadingBranches(true);
        apiClient.get<BranchOption[]>('/branches?permitted=true')
            .then((res) => {
                if (res.success && res.data) setBranches(res.data.map((b) => ({ id: b.id, name: b.name, code: b.code })));
            })
            .catch(() => {
                toast({ title: 'Error', description: 'Failed to load branches.', variant: 'destructive' });
            })
            .finally(() => setIsLoadingBranches(false));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const requestId = ++employeesRequestRef.current;
        const fetchEmployees = async () => {
            setIsInitialLoading(true);
            try {
                const params = new URLSearchParams({ branchScoped: 'true' });
                if (selectedBranchId !== 'all') params.set('branchId', selectedBranchId);
                const res = await apiClient.get<Employee[]>(`/employees?${params.toString()}`);
                // A newer branch selection superseded this request - drop the stale answer.
                if (requestId !== employeesRequestRef.current) return;
                if (res.success && res.data) {
                    setEmployees(res.data);
                } else {
                    toast({ title: 'Error', description: res.error || 'Failed to load employees.', variant: 'destructive' });
                }
            } catch {
                toast({ title: 'Error', description: 'Failed to load employee list.', variant: 'destructive' });
            } finally {
                if (requestId === employeesRequestRef.current) setIsInitialLoading(false);
            }
        };
        fetchEmployees();
        setSelectedEmployee('all');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedBranchId]);

    useEffect(() => {
        if (selectedEmployee && selectedEmployee !== 'all') {
            fetchSalaryMaster();
        } else {
            setShowData(false);
            setMasterData(null);
            setComponents([]);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedEmployee]);

    const earnings = useMemo(() => components.filter((c) => c.type === 'EARNINGS'), [components]);
    const deductions = useMemo(() => components.filter((c) => c.type === 'DEDUCTIONS'), [components]);

    const totals = useMemo(() => {
        const basicHra = (masterData?.basic ?? 0) + (masterData?.hra ?? 0);
        const totalEarnings = basicHra + earnings.reduce((sum, item) => sum + item.amount, 0);
        const totalDeductions = deductions.reduce((sum, item) => sum + item.amount, 0);
        return { totalEarnings, totalDeductions, netSalary: totalEarnings - totalDeductions };
    }, [masterData, earnings, deductions]);

    const yearCtcPreview = useMemo(() => {
        const n = parseFloat(monthlyCtc);
        return Number.isFinite(n) ? n * 12 : 0;
    }, [monthlyCtc]);

    const fetchSalaryMaster = async () => {
        if (selectedEmployee === 'all') return;
        setIsLoading(true);
        try {
            const res = await apiClient.get<SalaryMasterData>(`/payroll/salary-master?employeeId=${selectedEmployee}`);
            if (res.success && res.data) {
                setMasterData(res.data);
                setComponents(res.data.components);
                setMonthlyCtc(String(res.data.monthlyCtc || 0));
                setShowData(true);
            } else {
                toast({ title: 'Error', description: res.error || 'Failed to load salary master.', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'An unexpected error occurred.', variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
    };

    const handleAmountChange = (id: string, value: string) => {
        if (value !== '' && isNaN(parseFloat(value))) return;
        setComponents((prev) =>
            prev.map((c) => (c.id === id ? { ...c, amount: value === '' ? 0 : parseFloat(value) } : c))
        );
    };

    const handlePercentOverrideChange = (id: string, value: string) => {
        if (value !== '' && (isNaN(parseFloat(value)) || parseFloat(value) < 0 || parseFloat(value) > 100)) return;
        setComponents((prev) =>
            prev.map((c) => (c.id === id ? { ...c, percentOverride: value === '' ? null : parseFloat(value) } : c))
        );
    };

    const handleSave = async () => {
        if (selectedEmployee === 'all') return;
        const ctcValue = parseFloat(monthlyCtc);
        if (!Number.isFinite(ctcValue) || ctcValue < 0) {
            toast({ title: 'Validation Error', description: 'Enter a valid Month CTC Pay.', variant: 'destructive' });
            return;
        }
        setIsSaving(true);
        try {
            const payload = {
                employeeId: selectedEmployee,
                monthlyCtc: ctcValue,
                components: components.map((c) => ({
                    salaryComponentId: c.id,
                    amount: c.amount || 0,
                    percentOverride: c.isPercentBased ? c.percentOverride : null,
                })),
            };
            const res = await apiClient.post('/payroll/salary-master', payload);
            if (res.success) {
                toast({
                    title: 'Success',
                    description: 'Salary master saved successfully.',
                    className: 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800',
                });
                fetchSalaryMaster();
            } else {
                toast({ title: 'Error', description: res.error || 'Failed to save.', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'An unexpected error occurred while saving.', variant: 'destructive' });
        } finally {
            setIsSaving(false);
        }
    };

    const handleReset = () => {
        setSelectedEmployee('all');
        setShowData(false);
        setMasterData(null);
        setComponents([]);
        setMonthlyCtc('0');
        toast({ title: 'Form Reset', description: 'Form has been reset.' });
    };

    const handleDownloadLetter = async () => {
        if (selectedEmployee === 'all') return;
        try {
            const response = await fetch(`/api/hr/salary-letter/${selectedEmployee}`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${tokenStorage.getAccessToken() ?? ''}` },
            });
            if (!response.ok) {
                const result = await response.json().catch(() => null);
                throw new Error(result?.error || 'Failed to generate salary letter');
            }
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `salary-letter-${selectedEmployee}.pdf`;
            link.click();
            window.URL.revokeObjectURL(url);
        } catch (error: any) {
            toast({ title: 'Error', description: error.message || 'Failed to download salary letter.', variant: 'destructive' });
        }
    };

    const renderComponentRows = (items: SalaryComponentItem[], colorClass: string) => (
        <div className="space-y-3">
            {items.map((item) => (
                <div
                    key={item.id}
                    className="flex items-center gap-4 p-3 rounded-lg border border-primary/20 dark:border-sidebar-accent bg-white dark:bg-brand-green-darker/50 hover:shadow-sm transition-shadow"
                >
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-sidebar-accent dark:text-slate-200 truncate">{item.name}</p>
                        <p className="text-xs text-slate-500">
                            ID: {item.salaryId}
                            {item.isPercentBased && (
                                <> · default {item.defaultPercent}% of {item.percentBasis === 'GROSS' ? 'Gross' : 'Basic'}
                                    {item.maxAmount !== null && item.maxAmount !== undefined && <> (max {formatCurrency(item.maxAmount)})</>}
                                    {' '}→ {formatCurrency(item.amount)}</>
                            )}
                        </p>
                    </div>
                    {item.isPercentBased ? (
                        <div className="w-40">
                            <div className="relative">
                                <Input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    max="100"
                                    value={item.percentOverride ?? ''}
                                    onChange={(e) => handlePercentOverrideChange(item.id, e.target.value)}
                                    placeholder={`Default ${item.defaultPercent}%`}
                                    className="text-right font-semibold pr-7 bg-white dark:bg-sidebar-accent border-primary/30 dark:border-sidebar-accent"
                                />
                                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">%</span>
                            </div>
                        </div>
                    ) : (
                        <div className="w-40">
                            <Input
                                type="number"
                                step="0.01"
                                min="0"
                                value={item.amount || ''}
                                onChange={(e) => handleAmountChange(item.id, e.target.value)}
                                placeholder="0.00"
                                className={cn(
                                    'text-right font-semibold bg-white dark:bg-sidebar-accent border-primary/30 dark:border-sidebar-accent',
                                    colorClass
                                )}
                            />
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

    return (
        <div className="space-y-6">
            {/* Form Section */}
            <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                <CardHeader className="bg-gradient-to-r from-primary via-primary to-purple-600 px-6 py-4">
                    <CardTitle className="text-lg font-semibold text-white">Employee Salary Master — CTC</CardTitle>
                </CardHeader>
                <CardContent className="p-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {branches.length > 1 && (
                            <div className="space-y-2">
                                <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">Branch</Label>
                                <Select value={selectedBranchId} onValueChange={setSelectedBranchId} disabled={isLoadingBranches}>
                                    <SelectTrigger className="w-full bg-white dark:bg-sidebar-accent">
                                        <SelectValue placeholder="All Branches" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">
                                            All Branches
                                        </SelectItem>
                                        {branches.map((b) => (
                                            <SelectItem key={b.id} value={b.id}>{b.code} - {b.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}
                        <div className="space-y-2">
                            <Label htmlFor="employee-name" className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                                Employee Name
                            </Label>
                            <EmployeePicker id="employee-name" employees={employees} value={selectedEmployee} onChange={setSelectedEmployee} isLoading={isInitialLoading} />
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-3 mt-6">
                        <Button onClick={handleReset} variant="destructive" className="shadow-lg">
                            <RefreshCw className="h-4 w-4 mr-2" />
                            Reset
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* Loading State */}
            {isLoading && (
                <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                    <CardContent className="py-12">
                        <PageLoader label="Loading salary master..." fullScreen={false} />
                    </CardContent>
                </Card>
            )}

            {/* Data Section */}
            {showData && !isLoading && masterData && (
                <>
                    {/* CTC card */}
                    <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                        <CardHeader className="bg-gradient-to-r from-indigo-600 to-blue-600 px-6 py-4">
                            <CardTitle className="text-lg font-semibold text-white flex items-center gap-2">
                                <Wallet className="h-5 w-5" />
                                CTC & Basic/HRA split
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-6 space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-2">
                                    <Label htmlFor="monthly-ctc" className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                                        Month CTC Pay <span className="text-red-500">*</span>
                                    </Label>
                                    <Input
                                        id="monthly-ctc"
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        value={monthlyCtc}
                                        onChange={(e) => setMonthlyCtc(e.target.value)}
                                        className="bg-white dark:bg-sidebar-accent text-right font-semibold"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">Year CTC</Label>
                                    <Input
                                        value={formatCurrency(yearCtcPreview)}
                                        disabled
                                        className="bg-slate-50 dark:bg-sidebar-accent/50 text-right font-semibold"
                                    />
                                </div>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                                <BadgePercent className="h-3.5 w-3.5" />
                                <span>
                                    Split for designation {masterData.designationName ?? '—'}: {masterData.basicPercent}% Basic / {masterData.hraPercent}% HRA
                                    — configured on Designation Master.
                                </span>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="flex items-center justify-between p-3 rounded-lg border border-primary/20 dark:border-sidebar-accent bg-slate-50 dark:bg-sidebar-accent/30">
                                    <span className="text-sm font-medium text-sidebar-accent dark:text-slate-300">Basic (derived)</span>
                                    <span className="text-sm font-bold text-foreground dark:text-slate-100">{formatCurrency(masterData.basic)}</span>
                                </div>
                                <div className="flex items-center justify-between p-3 rounded-lg border border-primary/20 dark:border-sidebar-accent bg-slate-50 dark:bg-sidebar-accent/30">
                                    <span className="text-sm font-medium text-sidebar-accent dark:text-slate-300">HRA (derived)</span>
                                    <span className="text-sm font-bold text-foreground dark:text-slate-100">{formatCurrency(masterData.hra)}</span>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Metric Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <MetricCard
                            title="Total Earnings"
                            value={formatCurrency(totals.totalEarnings)}
                            subtitle={`Basic + HRA + ${earnings.length} earning components`}
                            icon={TrendingUp}
                            gradient="green"
                        />
                        <MetricCard
                            title="Total Deductions"
                            value={formatCurrency(totals.totalDeductions)}
                            subtitle={`${deductions.length} deduction components`}
                            icon={TrendingDown}
                            gradient="rose"
                        />
                        <MetricCard
                            title="Net Salary"
                            value={formatCurrency(totals.netSalary)}
                            subtitle="Earnings - Deductions"
                            icon={DollarSign}
                            gradient="blue"
                        />
                    </div>

                    {/* Earnings & Deductions Side by Side */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Earnings */}
                        <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                            <CardHeader className="bg-gradient-to-r from-emerald-600 to-green-600 px-6 py-4">
                                <CardTitle className="text-lg font-semibold text-white flex items-center gap-2">
                                    <TrendingUp className="h-5 w-5" />
                                    Other Earnings
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="p-4">
                                {renderComponentRows(earnings, 'focus:ring-green-500')}
                                <div className="mt-4 pt-4 border-t border-primary/20 dark:border-sidebar-accent flex justify-between items-center">
                                    <span className="text-sm font-semibold text-sidebar-accent dark:text-slate-400">Total (incl. Basic + HRA)</span>
                                    <span className="text-lg font-bold text-green-600 dark:text-green-400">
                                        {formatCurrency(totals.totalEarnings)}
                                    </span>
                                </div>
                            </CardContent>
                        </Card>

                        {/* Deductions */}
                        <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                            <CardHeader className="bg-gradient-to-r from-rose-600 to-red-600 px-6 py-4">
                                <CardTitle className="text-lg font-semibold text-white flex items-center gap-2">
                                    <TrendingDown className="h-5 w-5" />
                                    Deductions
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="p-4">
                                {renderComponentRows(deductions, 'focus:ring-red-500')}
                                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                                    Staff Loan is not set here — it's auto-filled at Payroll time from the employee's active loan schedule.
                                </p>
                                <div className="mt-4 pt-4 border-t border-primary/20 dark:border-sidebar-accent flex justify-between items-center">
                                    <span className="text-sm font-semibold text-sidebar-accent dark:text-slate-400">Total Deductions</span>
                                    <span className="text-lg font-bold text-red-600 dark:text-red-400">
                                        {formatCurrency(totals.totalDeductions)}
                                    </span>
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Net Salary & Save */}
                    <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                        <CardContent className="p-6">
                            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                                <div className="flex items-center gap-4">
                                    <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary shadow-lg">
                                        <DollarSign className="h-7 w-7 text-white" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium text-sidebar-accent dark:text-slate-400">Net Payable Salary</p>
                                        <p className={cn(
                                            'text-2xl font-bold',
                                            totals.netSalary >= 0 ? 'text-primary dark:text-primary' : 'text-red-600 dark:text-red-400'
                                        )}>
                                            {formatCurrency(totals.netSalary)}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex gap-3">
                                    <Button
                                        onClick={handleDownloadLetter}
                                        variant="outline"
                                        size="lg"
                                        className="border-primary/30 text-primary"
                                    >
                                        <FileText className="h-5 w-5 mr-2" />
                                        Salary Letter
                                    </Button>
                                    <Button
                                        onClick={handleSave}
                                        disabled={isSaving}
                                        size="lg"
                                        className="bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white shadow-lg min-w-[200px]"
                                    >
                                        {isSaving ? (
                                            <>
                                                <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                                                Saving...
                                            </>
                                        ) : (
                                            <>
                                                <Save className="h-5 w-5 mr-2" />
                                                Save Salary Master
                                            </>
                                        )}
                                    </Button>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </>
            )}
        </div>
    );
}

type SalaryMasterMode = 'bulk' | 'individual';

/** Salary Master should let you set CTC/percentages for everyone at once,
 * not one employee at a time — Bulk is the default/primary mode; Individual
 * stays available for reviewing/correcting one employee, including their
 * PF/ESI % overrides. */
export function SalaryMasterClient() {
    const [mode, setMode] = useState<SalaryMasterMode>('bulk');

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
                    <Users className="h-4 w-4" /> Bulk (Branch / All Branches)
                </button>
                <button
                    type="button"
                    onClick={() => setMode('individual')}
                    className={cn(
                        'flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors',
                        mode === 'individual' ? 'bg-primary text-white shadow' : 'text-sidebar-accent dark:text-slate-300 hover:bg-green-50 dark:hover:bg-sidebar-accent/50'
                    )}
                >
                    <UserIcon className="h-4 w-4" /> Individual (review / PF-ESI override)
                </button>
            </div>

            {mode === 'bulk' ? <BulkSalaryMasterClient /> : <IndividualSalaryMaster />}
        </div>
    );
}
