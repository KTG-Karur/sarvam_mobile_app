'use client';

import { useState, useMemo, useEffect } from 'react';
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
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { RefreshCw, Loader2, FileText, Calendar, TrendingUp, CheckCircle, Save } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MetricCard } from '@/components/dashboard/MetricCard';
import { apiClient } from '@/app/lib/api-client';
import { tokenStorage } from '@/app/lib/token-storage';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';
import { PageLoader } from '@/components/ui/page-loader';

type BranchOption = { id: string; name: string; code: string };

type LeaveBalance = {
    id: string;
    leaveType: string;
    typeId: number;
    openingBalance: string | number;
    carriedForwardDays?: string | number;
    allowCarryForward?: boolean;
    used: number;
    remainingBalance: string | number;
    balanceId: string | null;
};

type Employee = {
    id: string;
    name: string;
};

// Half-day leave can leave a balance on a .5 value — round-tripping through
// Math.round() here would silently hide that (e.g. "0.5 remaining" showing as
// "1" or "0"). Show the real decimal, but keep it a clean whole number when
// it actually is one (the overwhelmingly common case).
const formatBalance = (value: number): string => (Number.isInteger(value) ? value.toString() : value.toFixed(1));

export function LeaveBalanceClient() {
    const { toast } = useToast();
    const storedUser = tokenStorage.getUser();
    const isAdminOrAM = storedUser?.role === 'ADMIN' || storedUser?.role === 'AREA_MANAGER';
    const currentIstDate = new Date();
    const currentIstMonth = currentIstDate.getMonth() + 1;
    const currentIstYear = currentIstDate.getFullYear();

    const [selectedMonth, setSelectedMonth] = useState<number>(currentIstMonth);
    const [selectedYear, setSelectedYear] = useState<number>(currentIstYear);
    const [branches, setBranches] = useState<BranchOption[]>([]);
    const [selectedBranchId, setSelectedBranchId] = useState('all');
    const [isLoadingBranches, setIsLoadingBranches] = useState(false);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [selectedEmployee, setSelectedEmployee] = useState<string>('all');
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isInitialLoading, setIsInitialLoading] = useState(true);
    const [showData, setShowData] = useState(false);
    const [leaveBalances, setLeaveBalances] = useState<LeaveBalance[]>([]);

    const MONTHS = [
        { value: 1, label: 'January' },
        { value: 2, label: 'February' },
        { value: 3, label: 'March' },
        { value: 4, label: 'April' },
        { value: 5, label: 'May' },
        { value: 6, label: 'June' },
        { value: 7, label: 'July' },
        { value: 8, label: 'August' },
        { value: 9, label: 'September' },
        { value: 10, label: 'October' },
        { value: 11, label: 'November' },
        { value: 12, label: 'December' },
    ];
    const YEARS = [currentIstYear - 1, currentIstYear, currentIstYear + 1];

    // Branch filter — ADMIN sees all branches, AREA_MANAGER scoped to their assigned branches
    useEffect(() => {
        if (!isAdminOrAM) return;
        setIsLoadingBranches(true);
        fetch('/api/branches')
            .then((res) => res.json())
            .then((json) => {
                let list: BranchOption[] = (json?.data ?? []).map(
                    (b: any) => ({ id: b.id, name: b.name, code: b.code })
                );
                if (storedUser?.role === 'AREA_MANAGER') {
                    const assignedBranchIds = (storedUser as any)?.assignedBranchIds ?? [];
                    if (assignedBranchIds.length > 0) {
                        list = list.filter((b) => assignedBranchIds.includes(b.id));
                    }
                }
                setBranches(list);
            })
            .catch(() => {
                toast({ title: 'Error', description: 'Failed to load branches.', variant: 'destructive' });
            })
            .finally(() => setIsLoadingBranches(false));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAdminOrAM]);

    useEffect(() => {
        const fetchEmployees = async () => {
            setIsInitialLoading(true);
            try {
                const params = new URLSearchParams({ branchScoped: 'true' });
                if (isAdminOrAM && selectedBranchId !== 'all') params.set('branchId', selectedBranchId);
                const res = await apiClient.get<Employee[]>(`/employees?${params.toString()}`);
                if (res.success && res.data) {
                    setEmployees(res.data);
                } else {
                    toast({ title: 'Error', description: res.error || 'Failed to load employees.', variant: 'destructive' });
                }
            } catch {
                toast({ title: 'Error', description: 'Failed to load employee list.', variant: 'destructive' });
            } finally {
                setIsInitialLoading(false);
            }
        };
        fetchEmployees();
        setSelectedEmployee('all');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedBranchId]);

    useEffect(() => {
        if (selectedEmployee && selectedEmployee !== 'all') {
            fetchLeaveBalances();
        } else {
            setShowData(false);
            setLeaveBalances([]);
        }
    }, [selectedEmployee, selectedMonth, selectedYear]);

    const metrics = useMemo(() => {
        if (leaveBalances.length === 0) {
            return { totalLeaveTypes: 0, totalOpeningBalance: 0, totalRemainingBalance: 0, totalUsedBalance: 0 };
        }
        const totalOpeningBalance = leaveBalances.reduce((sum, lb) => sum + Number(lb.openingBalance), 0);
        const totalUsedBalance = leaveBalances.reduce((sum, lb) => sum + (Number(lb.used) || 0), 0);
        return {
            totalLeaveTypes: new Set(leaveBalances.map((lb) => lb.leaveType)).size,
            totalOpeningBalance,
            totalRemainingBalance: totalOpeningBalance - totalUsedBalance,
            totalUsedBalance,
        };
    }, [leaveBalances]);

    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(leaveBalances);

    const fetchLeaveBalances = async () => {
        if (selectedEmployee === 'all') return;
        setIsLoading(true);
        try {
            const res = await apiClient.get<LeaveBalance[]>(
                `/payroll/leave-balance?employeeId=${selectedEmployee}&month=${selectedMonth}&year=${selectedYear}`
            );
            if (res.success && res.data) {
                // Opening balance is admin-set and always a whole number (enforced on
                // save below), so rounding it is safe — but `used`/`remainingBalance`
                // can legitimately be a .5 value from half-day leave and must NOT be
                // rounded away here (see attendance-hr/plan-half-day-leave.md §9).
                const normalizedData = res.data.map((lb) => ({
                    ...lb,
                    openingBalance: Math.round(Number(lb.openingBalance) || 0),
                    used: Number(lb.used) || 0,
                    remainingBalance: Number(lb.remainingBalance) || 0,
                }));
                setLeaveBalances(normalizedData);
                setShowData(true);
            } else {
                toast({ title: 'Error', description: res.error || 'Failed to fetch balances.', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'Failed to load leave balances.', variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
    };

    const handleReset = () => {
        setSelectedEmployee('all');
        setShowData(false);
        setLeaveBalances([]);
        toast({ title: 'Form Reset', description: 'Form has been reset.' });
    };

    const handleBalanceChange = (id: string, value: string) => {
        if (value !== '' && (!/^\d+$/.test(value) || isNaN(parseInt(value, 10)))) return;
        setLeaveBalances((prev) =>
            prev.map((lb) => {
                if (lb.id === id) {
                    const openingVal = value === '' ? 0 : parseInt(value, 10);
                    const usedVal = Number(lb.used) || 0;
                    return { ...lb, openingBalance: value, remainingBalance: Math.max(0, openingVal - usedVal) };
                }
                return lb;
            })
        );
    };

    const handleSaveBalances = async () => {
        if (selectedEmployee === 'all') return;
        setIsSaving(true);
        try {
            const dataToSave = {
                employeeId: selectedEmployee,
                balances: leaveBalances.map(lb => ({
                    leaveTypeId: lb.id,
                    openingBalance: parseInt(lb.openingBalance.toString(), 10) || 0,
                })),
            };
            const res = await apiClient.post('/payroll/leave-balance', dataToSave);
            if (res.success) {
                toast({
                    title: 'Success',
                    description: 'Leave balances updated successfully.',
                    className: 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800',
                });
                fetchLeaveBalances();
            } else {
                toast({ title: 'Error', description: res.error || 'Failed to save balances.', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'An unexpected error occurred while saving.', variant: 'destructive' });
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="space-y-6">
            {showData && leaveBalances.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <MetricCard title="Leave Types" value={metrics.totalLeaveTypes.toString()} subtitle="Unique leave types" icon={FileText} gradient="blue" />
                    <MetricCard title="Monthly Quota" value={formatBalance(metrics.totalOpeningBalance)} subtitle="Sum of all monthly quotas" icon={Calendar} gradient="green" />
                    <MetricCard title="Used This Month" value={formatBalance(metrics.totalUsedBalance)} subtitle="Total leaves used this month" icon={TrendingUp} gradient="orange" />
                    <MetricCard title="Remaining This Month" value={formatBalance(metrics.totalRemainingBalance)} subtitle="Sum of remaining monthly quotas" icon={CheckCircle} gradient="purple" />
                </div>
            )}

            <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                <CardHeader className="bg-gradient-to-r from-primary via-primary to-purple-600 px-6 py-4">
                    <CardTitle className="text-lg font-semibold text-white">Employee Leave Balance (Monthly Quota)</CardTitle>
                </CardHeader>
                <CardContent className="p-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                        {isAdminOrAM && (
                            <div className="space-y-2">
                                <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">Branch</Label>
                                <Select value={selectedBranchId} onValueChange={setSelectedBranchId} disabled={isLoadingBranches}>
                                    <SelectTrigger className="w-full bg-white dark:bg-sidebar-accent">
                                        <SelectValue placeholder="All Branches" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">
                                            {storedUser?.role === 'AREA_MANAGER' ? 'All Assigned Branches' : 'All Branches'}
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
                            <Select value={selectedEmployee} onValueChange={setSelectedEmployee}>
                                <SelectTrigger id="employee-name" className="w-full bg-white dark:bg-sidebar-accent">
                                    <SelectValue placeholder={isInitialLoading ? 'Loading employees...' : '-- SELECT --'} />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">-- SELECT --</SelectItem>
                                    {employees.map((employee) => (
                                        <SelectItem key={employee.id} value={employee.id}>
                                            {employee.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">Month</Label>
                            <Select value={selectedMonth.toString()} onValueChange={(v) => setSelectedMonth(parseInt(v))}>
                                <SelectTrigger className="w-full bg-white dark:bg-sidebar-accent">
                                    <SelectValue placeholder="Select Month" />
                                </SelectTrigger>
                                <SelectContent>
                                    {MONTHS.map((m) => (
                                        <SelectItem key={m.value} value={m.value.toString()}>{m.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">Year</Label>
                            <Select value={selectedYear.toString()} onValueChange={(v) => setSelectedYear(parseInt(v))}>
                                <SelectTrigger className="w-full bg-white dark:bg-sidebar-accent">
                                    <SelectValue placeholder="Select Year" />
                                </SelectTrigger>
                                <SelectContent>
                                    {YEARS.map((y) => (
                                        <SelectItem key={y} value={y.toString()}>{y}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
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

            {isLoading && (
                <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                    <CardContent className="py-4">
                        <PageLoader label="Loading leave balances..." fullScreen={false} />
                    </CardContent>
                </Card>
            )}

            {showData && !isLoading && leaveBalances.length > 0 && (
                <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                    <CardHeader className="bg-gradient-to-r from-primary via-primary to-purple-600 px-6 py-4 flex flex-row items-center justify-between gap-4">
                        <CardTitle className="text-lg font-semibold text-white">Leave Balance Details</CardTitle>
                        <TableSearchInput
                            value={tableSearchQuery}
                            onChange={setTableSearchQuery}
                            placeholder="Search leave balances..."
                            className="bg-white dark:bg-sidebar-accent rounded-md"
                        />
                    </CardHeader>
                    <CardContent className="p-0">
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-gradient-to-r from-primary via-primary to-purple-600 hover:from-primary hover:via-primary hover:to-purple-600">
                                        <TableHead className="text-white font-semibold whitespace-nowrap px-6">Leave Type</TableHead>
                                        <TableHead className="text-white font-semibold whitespace-nowrap text-center">Monthly Quota</TableHead>
                                        <TableHead className="text-white font-semibold whitespace-nowrap text-center text-emerald-200">Carried Forward</TableHead>
                                        <TableHead className="text-white font-semibold whitespace-nowrap text-center text-amber-200">Used This Month</TableHead>
                                        <TableHead className="text-white font-semibold whitespace-nowrap text-center">Remaining This Month</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody className="bg-white dark:bg-green-950/30">
                                    {searchedRows.map((balance) => (
                                        <TableRow
                                            key={balance.id}
                                            className={cn('bg-white odd:bg-green-50/70 hover:bg-green-50/60 transition-colors dark:bg-brand-green-darker dark:odd:bg-brand-green-darker/80 dark:hover:bg-sidebar-accent/80')}
                                        >
                                            <TableCell className="px-6 py-3 text-sm font-medium text-foreground dark:text-slate-100">
                                                {balance.leaveType}
                                            </TableCell>
                                            <TableCell className="px-4 py-3">
                                                <div className="flex justify-center">
                                                    <Input
                                                        type="number"
                                                        step="1"
                                                        min="0"
                                                        value={balance.openingBalance}
                                                        onKeyDown={(e) => {
                                                            if (e.key === '.' || e.key === 'e' || e.key === 'E' || e.key === '+' || e.key === '-') {
                                                                e.preventDefault();
                                                            }
                                                        }}
                                                        onChange={(e) => handleBalanceChange(balance.id, e.target.value)}
                                                        className="w-32 text-center bg-white dark:bg-sidebar-accent font-semibold border-primary/30 dark:border-sidebar-accent focus:ring-2 focus:ring-primary"
                                                    />
                                                </div>
                                            </TableCell>
                                            <TableCell className="px-4 py-3 text-center font-bold text-emerald-600">
                                                {balance.allowCarryForward ? formatBalance(Number(balance.carriedForwardDays) || 0) : '—'}
                                            </TableCell>
                                            <TableCell className="px-4 py-3 text-center font-bold text-amber-600">
                                                {formatBalance(balance.used || 0)}
                                            </TableCell>
                                            <TableCell className="px-4 py-3">
                                                <div className="flex justify-center">
                                                    <Input
                                                        type="number"
                                                        step="1"
                                                        min="0"
                                                        value={Number(balance.remainingBalance) || 0}
                                                        readOnly
                                                        disabled
                                                        className="w-32 text-center bg-brand-green-tint dark:bg-sidebar-accent/50 font-bold text-primary border-primary/20 dark:border-sidebar-accent opacity-100 cursor-not-allowed"
                                                    />
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                        <div className="p-4 bg-green-50 border-t dark:bg-brand-green-darker/80 flex justify-center">
                            <Button
                                onClick={handleSaveBalances}
                                disabled={isSaving}
                                size="lg"
                                className="bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white shadow-lg min-w-[200px]"
                            >
                                {isSaving ? (
                                    <>
                                        <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                                        Updating Balances...
                                    </>
                                ) : (
                                    <>
                                        <Save className="h-5 w-5 mr-2" />
                                        Update Leave Balances
                                    </>
                                )}
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}

            {showData && !isLoading && leaveBalances.length === 0 && (
                <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                    <CardContent className="flex flex-col items-center justify-center py-12">
                        <Calendar className="h-12 w-12 text-slate-400 dark:text-slate-500 mb-4" />
                        <p className="text-sm font-medium text-sidebar-accent dark:text-slate-400">
                            No leave balance data found for the selected employee.
                        </p>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
