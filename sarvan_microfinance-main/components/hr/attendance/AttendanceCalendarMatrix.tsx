'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import {
    CalendarDays,
    CalendarRange,
    ChevronLeft,
    ChevronRight,
    Download,
    RefreshCw,
    Search,
    Users,
    CheckCircle2,
    Clock,
    AlertCircle,
    UserCheck,
    Calendar,
    Filter,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { branchStorage } from '@/app/lib/branch-storage';
import { tokenStorage } from '@/app/lib/token-storage';
import { LocalBranchFilter } from '@/components/branch/LocalBranchFilter';
import { DatePickerField } from '@/components/ui/date-picker-field';
import { PageLoader } from '@/components/ui/page-loader';
import * as XLSX from 'xlsx';
import { normalizeWorkbookNumbers } from '@/app/lib/reports/excel-report-header';

type CalendarDay = {
    day: number;
    date: string;
    dayOfWeek: string;
    dayOfWeekShort: string;
    isWeeklyOff: boolean;
    isToday: boolean;
    isFuture: boolean;
};

type DayCellData = {
    day: number;
    status: 'PRESENT' | 'HALF_DAY' | 'ABSENT' | 'ON_LEAVE' | 'HOLIDAY' | 'WEEKLY_OFF' | 'UPCOMING';
    badge: 'P' | 'HD' | 'A' | 'L' | 'H' | 'WO' | '-';
    checkInTime: string | null;
    checkOutTime: string | null;
    workingHours: number | null;
    leaveTypeName: string | null;
    isHalfDayLeave: boolean;
};

type EmployeeRow = {
    id: string;
    employeeId: string;
    name: string;
    designation: string;
    role: string;
    days: Record<string, DayCellData>;
    summary: {
        presentDays: number;
        halfDays: number;
        absentDays: number;
        leaveDays: number;
        weeklyOffs: number;
        holidays: number;
        paidDays: number;
        totalWorkingHours: number;
    };
};

type CalendarResponse = {
    branch: {
        id: string;
        name: string;
        code: string;
    };
    period: {
        isCustomRange?: boolean;
        fromDate?: string;
        tillDate?: string;
        month: number | null;
        year: number | null;
        monthName: string;
        totalDays: number;
        days: CalendarDay[];
    };
    employees: EmployeeRow[];
    branchSummary: {
        totalEmployees: number;
        totalPresent: number;
        totalHalfDays: number;
        totalAbsent: number;
        totalLeaves: number;
    };
};

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

const YEARS = [2024, 2025, 2026, 2027];

const MONTH_NAMES_SHORT = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export function formatCalendarColumnDate(dateStr: string): string {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length < 3) return dateStr;
    const year = parts[0];
    const monthIdx = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    const month = MONTH_NAMES_SHORT[monthIdx] || parts[1];
    return `${day}/${month}/${year}`;
}

export function AttendanceCalendarMatrix() {
    const { toast } = useToast();
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();
    const todayIso = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const firstDayOfMonthIso = `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`;

    const [selectedBranchId, setSelectedBranchId] = useState<string>(() => {
        const stored = branchStorage.getActiveBranch();
        const user = tokenStorage.getUser();
        return stored?.id || user?.branchId || '';
    });
    const [viewMode, setViewMode] = useState<'month' | 'custom'>('month');
    const [selectedMonth, setSelectedMonth] = useState<number>(currentMonth);
    const [selectedYear, setSelectedYear] = useState<number>(currentYear);
    const [fromDate, setFromDate] = useState<string>(firstDayOfMonthIso);
    const [tillDate, setTillDate] = useState<string>(todayIso);
    const [searchQuery, setSearchQuery] = useState<string>('');
    const [data, setData] = useState<CalendarResponse | null>(null);
    const [isLoading, setIsLoading] = useState<boolean>(true);

    // Initialize branch from active branch storage or current user
    useEffect(() => {
        const stored = branchStorage.getActiveBranch();
        const user = tokenStorage.getUser();
        const resolvedId = stored?.id || user?.branchId;
        if (resolvedId && !selectedBranchId) {
            setSelectedBranchId(resolvedId);
        }
    }, [selectedBranchId]);

    const fetchCalendar = useCallback(async () => {
        setIsLoading(true);
        try {
            const params = new URLSearchParams();
            if (selectedBranchId) params.append('branchId', selectedBranchId);

            if (viewMode === 'custom') {
                if (!fromDate || !tillDate) {
                    toast({
                        title: 'Date Range Required',
                        description: 'Please select both From Date and To Date.',
                        variant: 'destructive',
                    });
                    setIsLoading(false);
                    return;
                }
                if (fromDate > tillDate) {
                    toast({
                        title: 'Invalid Date Range',
                        description: 'From Date cannot be after To Date.',
                        variant: 'destructive',
                    });
                    setIsLoading(false);
                    return;
                }
                params.append('fromDate', fromDate);
                params.append('tillDate', tillDate);
            } else {
                params.append('month', String(selectedMonth));
                params.append('year', String(selectedYear));
            }

            const res = await apiClient.get<CalendarResponse>(`/hr/attendance/calendar?${params.toString()}`);
            if (res.success && res.data) {
                setData(res.data);
            } else {
                toast({
                    title: 'Failed to load calendar',
                    description: res.error || 'Could not fetch attendance data.',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            toast({
                title: 'Error',
                description: error instanceof Error ? error.message : 'Network error loading calendar.',
                variant: 'destructive',
            });
        } finally {
            setIsLoading(false);
        }
    }, [selectedBranchId, viewMode, fromDate, tillDate, selectedMonth, selectedYear, toast]);

    useEffect(() => {
        fetchCalendar();
    }, [fetchCalendar]);

    // Handle Month Navigation
    const handlePrevMonth = () => {
        if (selectedMonth === 1) {
            setSelectedMonth(12);
            setSelectedYear((y) => y - 1);
        } else {
            setSelectedMonth((m) => m - 1);
        }
    };

    const handleNextMonth = () => {
        if (selectedMonth === 12) {
            setSelectedMonth(1);
            setSelectedYear((y) => y + 1);
        } else {
            setSelectedMonth((m) => m + 1);
        }
    };

    // Quick presets for Date Range
    const handlePreset = (days: number) => {
        const end = new Date();
        const start = new Date();
        start.setDate(end.getDate() - (days - 1));
        const toStr = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
        const fromStr = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
        setFromDate(fromStr);
        setTillDate(toStr);
    };

    const handleThisMonthPreset = () => {
        const end = new Date();
        const toStr = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
        const fromStr = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-01`;
        setFromDate(fromStr);
        setTillDate(toStr);
    };

    // Filter employees by search query
    const filteredEmployees = useMemo(() => {
        if (!data?.employees) return [];
        if (!searchQuery.trim()) return data.employees;
        const q = searchQuery.toLowerCase().trim();
        return data.employees.filter(
            (emp) =>
                emp.name.toLowerCase().includes(q) ||
                emp.employeeId.toLowerCase().includes(q) ||
                emp.designation?.toLowerCase().includes(q)
        );
    }, [data?.employees, searchQuery]);

    // Export to Excel Matrix
    const handleExportExcel = () => {
        if (!data) return;
        try {
            const days = data.period.days;
            const headers = [
                'Employee ID',
                'Employee Name',
                'Designation',
                ...days.map((d) => formatCalendarColumnDate(d.date)),
                'Present Days',
                'Half Days',
                'Absent Days',
                'Leave Days',
                'Paid Days',
                'Total Hours',
            ];

            const rows = filteredEmployees.map((emp) => [
                emp.employeeId,
                emp.name,
                emp.designation || emp.role,
                ...days.map((d) => emp.days[d.date]?.badge || '-'),
                emp.summary.presentDays,
                emp.summary.halfDays,
                emp.summary.absentDays,
                emp.summary.leaveDays,
                emp.summary.paidDays,
                emp.summary.totalWorkingHours,
            ]);

            const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
            ws['!cols'] = [
                { wch: 14 },
                { wch: 24 },
                { wch: 16 },
                ...days.map(() => ({ wch: 12 })),
                { wch: 12 },
                { wch: 10 },
                { wch: 12 },
                { wch: 10 },
                { wch: 10 },
                { wch: 12 },
            ];

            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Attendance Matrix');
            const fileName = data.period.isCustomRange
                ? `Attendance_Matrix_${data.branch.code}_${data.period.fromDate}_to_${data.period.tillDate}.xlsx`
                : `Attendance_Calendar_${data.branch.code}_${data.period.monthName.replace(/\s+/g, '_')}.xlsx`;
            normalizeWorkbookNumbers(wb);
            XLSX.writeFile(wb, fileName);
            toast({ title: 'Export Successful', description: 'Excel matrix exported successfully.' });
        } catch {
            toast({ title: 'Error', description: 'Could not export Excel file.', variant: 'destructive' });
        }
    };

    return (
        <TooltipProvider>
            <div className="space-y-6">
                {/* 1. Header Controls Card */}
                <Card className="border-border/60 bg-card/80 backdrop-blur-md shadow-sm">
                    <CardHeader className="pb-4">
                        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                            <div>
                                <CardTitle className="flex flex-wrap items-center gap-2 text-xl font-bold text-foreground">
                                    <CalendarDays className="h-6 w-6 text-primary" />
                                    {data?.period?.isCustomRange ? 'Attendance Register Matrix' : 'Monthly Attendance Calendar'}
                                    {data?.branch && (
                                        <Badge variant="outline" className="font-mono text-xs">
                                            {data.branch.code} - {data.branch.name}
                                        </Badge>
                                    )}
                                    {data?.period && (
                                        <Badge variant="secondary" className="font-semibold text-xs">
                                            {data.period.monthName} ({data.period.totalDays} Days)
                                        </Badge>
                                    )}
                                </CardTitle>
                                <CardDescription className="text-muted-foreground mt-1">
                                    Muster roll matrix showing day-by-day punches, shift status, and totals for all branch staff.
                                </CardDescription>
                            </div>

                            {/* Export & Actions */}
                            <div className="flex flex-wrap items-center gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={fetchCalendar}
                                    disabled={isLoading}
                                    className="gap-1.5"
                                >
                                    <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
                                    Refresh
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={handleExportExcel}
                                    disabled={isLoading || !data}
                                    className="gap-1.5 border-emerald-600/30 text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950"
                                >
                                    <Download className="h-4 w-4" />
                                    Export Excel
                                </Button>
                            </div>
                        </div>
                    </CardHeader>

                    <CardContent className="pt-0 space-y-4">
                        {/* Top Controls: Branch, View Mode Toggle, Search */}
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                            <div className="flex flex-wrap items-center gap-3">
                                {/* Branch Selector */}
                                <div className="w-full sm:w-[260px]">
                                    <LocalBranchFilter
                                        value={selectedBranchId}
                                        onChange={setSelectedBranchId}
                                        className="w-full"
                                    />
                                </div>

                                {/* View Mode Toggle */}
                                <div className="inline-flex items-center rounded-lg border border-border/80 bg-muted/40 p-1 text-xs">
                                    <button
                                        type="button"
                                        onClick={() => setViewMode('month')}
                                        className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-all ${
                                            viewMode === 'month'
                                                ? 'bg-background text-foreground shadow-sm'
                                                : 'text-muted-foreground hover:text-foreground'
                                        }`}
                                    >
                                        <CalendarDays className="h-3.5 w-3.5 text-primary" />
                                        Month View
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setViewMode('custom')}
                                        className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-all ${
                                            viewMode === 'custom'
                                                ? 'bg-background text-foreground shadow-sm'
                                                : 'text-muted-foreground hover:text-foreground'
                                        }`}
                                    >
                                        <CalendarRange className="h-3.5 w-3.5 text-primary" />
                                        Date Range
                                    </button>
                                </div>
                            </div>

                            {/* Search Employee Input */}
                            <div className="relative w-full sm:w-[260px]">
                                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input
                                    type="text"
                                    placeholder="Search staff code or name..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="pl-8 h-9"
                                />
                            </div>
                        </div>

                        {/* Mode-Specific Filter Row */}
                        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-border/40">
                            {viewMode === 'month' ? (
                                <div className="flex items-center gap-2">
                                    <span className="text-xs font-semibold text-muted-foreground">Select Month:</span>
                                    <div className="flex items-center gap-1">
                                        <Button
                                            variant="outline"
                                            size="icon"
                                            className="h-9 w-9 shrink-0"
                                            onClick={handlePrevMonth}
                                            disabled={isLoading}
                                            title="Previous Month"
                                        >
                                            <ChevronLeft className="h-4 w-4" />
                                        </Button>
                                        <Select
                                            value={String(selectedMonth)}
                                            onValueChange={(v) => setSelectedMonth(parseInt(v, 10))}
                                        >
                                            <SelectTrigger className="h-9 w-[130px]">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {MONTHS.map((m) => (
                                                    <SelectItem key={m.value} value={String(m.value)}>
                                                        {m.label}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>

                                        <Select
                                            value={String(selectedYear)}
                                            onValueChange={(v) => setSelectedYear(parseInt(v, 10))}
                                        >
                                            <SelectTrigger className="h-9 w-[95px]">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {YEARS.map((y) => (
                                                    <SelectItem key={y} value={String(y)}>
                                                        {y}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <Button
                                            variant="outline"
                                            size="icon"
                                            className="h-9 w-9 shrink-0"
                                            onClick={handleNextMonth}
                                            disabled={isLoading}
                                            title="Next Month"
                                        >
                                            <ChevronRight className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex flex-wrap items-center gap-3">
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-semibold text-muted-foreground whitespace-nowrap">From:</span>
                                        <div className="w-[145px]">
                                            <DatePickerField
                                                value={fromDate}
                                                onChange={setFromDate}
                                                placeholder="Start date"
                                                className="h-9"
                                            />
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-semibold text-muted-foreground whitespace-nowrap">To:</span>
                                        <div className="w-[145px]">
                                            <DatePickerField
                                                value={tillDate}
                                                onChange={setTillDate}
                                                placeholder="End date"
                                                className="h-9"
                                            />
                                        </div>
                                    </div>

                                    <Button
                                        size="sm"
                                        onClick={fetchCalendar}
                                        disabled={isLoading}
                                        className="h-9 gap-1.5 px-4"
                                    >
                                        <Filter className="h-3.5 w-3.5" />
                                        Apply Filter
                                    </Button>

                                    {/* Quick Range Presets */}
                                    <div className="flex flex-wrap items-center gap-1 pl-2 border-l border-border/60">
                                        <span className="text-[11px] text-muted-foreground font-medium mr-1">Presets:</span>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className="h-7 text-[11px] px-2 text-muted-foreground hover:text-foreground"
                                            onClick={handleThisMonthPreset}
                                        >
                                            This Month
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className="h-7 text-[11px] px-2 text-muted-foreground hover:text-foreground"
                                            onClick={() => handlePreset(7)}
                                        >
                                            Last 7 Days
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className="h-7 text-[11px] px-2 text-muted-foreground hover:text-foreground"
                                            onClick={() => handlePreset(15)}
                                        >
                                            Last 15 Days
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className="h-7 text-[11px] px-2 text-muted-foreground hover:text-foreground"
                                            onClick={() => handlePreset(30)}
                                        >
                                            Last 30 Days
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>

                {/* 2. KPI Summary Cards & Legend */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                    <Card className="border-border/60 bg-card/60 p-3.5 shadow-sm">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-xs font-medium text-muted-foreground">Total Staff</p>
                                <p className="text-2xl font-bold text-foreground">{data?.branchSummary?.totalEmployees ?? 0}</p>
                            </div>
                            <div className="rounded-full bg-primary/10 p-2 text-primary">
                                <Users className="h-5 w-5" />
                            </div>
                        </div>
                    </Card>

                    <Card className="border-border/60 bg-card/60 p-3.5 shadow-sm">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Total Present</p>
                                <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-300">
                                    {data?.branchSummary?.totalPresent ?? 0}
                                </p>
                            </div>
                            <div className="rounded-full bg-emerald-100 p-2 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                                <CheckCircle2 className="h-5 w-5" />
                            </div>
                        </div>
                    </Card>

                    <Card className="border-border/60 bg-card/60 p-3.5 shadow-sm">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-xs font-medium text-amber-600 dark:text-amber-400">Half Days</p>
                                <p className="text-2xl font-bold text-amber-700 dark:text-amber-300">
                                    {data?.branchSummary?.totalHalfDays ?? 0}
                                </p>
                            </div>
                            <div className="rounded-full bg-amber-100 p-2 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                                <Clock className="h-5 w-5" />
                            </div>
                        </div>
                    </Card>

                    <Card className="border-border/60 bg-card/60 p-3.5 shadow-sm">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-xs font-medium text-rose-600 dark:text-rose-400">Total Absent</p>
                                <p className="text-2xl font-bold text-rose-700 dark:text-rose-300">
                                    {data?.branchSummary?.totalAbsent ?? 0}
                                </p>
                            </div>
                            <div className="rounded-full bg-rose-100 p-2 text-rose-700 dark:bg-rose-950 dark:text-rose-300">
                                <AlertCircle className="h-5 w-5" />
                            </div>
                        </div>
                    </Card>

                    <Card className="border-border/60 bg-card/60 p-3.5 shadow-sm col-span-2 sm:col-span-1">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-xs font-medium text-blue-600 dark:text-blue-400">Approved Leaves</p>
                                <p className="text-2xl font-bold text-blue-700 dark:text-blue-300">
                                    {data?.branchSummary?.totalLeaves ?? 0}
                                </p>
                            </div>
                            <div className="rounded-full bg-blue-100 p-2 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                                <Calendar className="h-5 w-5" />
                            </div>
                        </div>
                    </Card>
                </div>

                {/* 3. Status Legend Banner */}
                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border/60 bg-muted/20 px-4 py-2 text-xs">
                    <span className="font-semibold text-foreground">Status Legend:</span>
                    <span className="inline-flex items-center gap-1.5">
                        <span className="flex h-5 w-5 items-center justify-center rounded bg-emerald-100 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">P</span>
                        <span>Present</span>
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                        <span className="flex h-5 w-5 items-center justify-center rounded bg-amber-100 text-[10px] font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-300">HD</span>
                        <span>Half Day</span>
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                        <span className="flex h-5 w-5 items-center justify-center rounded bg-rose-100 text-[10px] font-bold text-rose-800 dark:bg-rose-950 dark:text-rose-300">A</span>
                        <span>Absent</span>
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                        <span className="flex h-5 w-5 items-center justify-center rounded bg-blue-100 text-[10px] font-bold text-blue-800 dark:bg-blue-950 dark:text-blue-300">L</span>
                        <span>Approved Leave</span>
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                        <span className="flex h-5 w-5 items-center justify-center rounded bg-slate-200 text-[10px] font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-300">WO</span>
                        <span>Weekly Off</span>
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                        <span className="flex h-5 w-5 items-center justify-center rounded bg-purple-100 text-[10px] font-bold text-purple-800 dark:bg-purple-950 dark:text-purple-300">H</span>
                        <span>Holiday</span>
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                        <span className="flex h-5 w-5 items-center justify-center rounded border border-dashed text-[10px]">-</span>
                        <span>Upcoming / Not Marked</span>
                    </span>
                </div>

                {/* 4. The Monthly Attendance Matrix Table */}
                <Card className="border-border/60 shadow-sm overflow-hidden">
                    {isLoading ? (
                        <div className="py-20 flex justify-center items-center">
                            <PageLoader label="Loading monthly attendance matrix..." fullScreen={false} />
                        </div>
                    ) : filteredEmployees.length === 0 ? (
                        <div className="py-16 text-center text-muted-foreground">
                            <UserCheck className="mx-auto h-12 w-12 opacity-30 mb-2" />
                            <p className="text-base font-medium">No employees found for this branch or search.</p>
                            <p className="text-xs mt-1">Try clearing the search query or selecting another branch.</p>
                        </div>
                    ) : (
                        <div className="relative overflow-x-auto">
                            <table className="w-full text-left border-collapse text-xs">
                                <thead>
                                    <tr className="border-b border-border/80 bg-muted/60">
                                        {/* Sticky Employee Column Header */}
                                        <th className="sticky left-0 z-20 bg-muted/95 backdrop-blur px-3 py-2.5 font-bold text-foreground min-w-[200px] border-r border-border/60 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                                            Employee Details
                                        </th>

                                        {/* Day Columns (1..N) formatted as 1-AUG-2026 without sun/mon */}
                                        {data?.period.days.map((d) => (
                                            <th
                                                key={d.date}
                                                className={`px-1.5 py-2.5 text-center min-w-[78px] border-r border-border/40 font-medium ${
                                                    d.isToday
                                                        ? 'bg-primary/15 text-primary font-bold'
                                                        : d.isWeeklyOff
                                                        ? 'bg-slate-100/80 dark:bg-slate-900/60 text-muted-foreground'
                                                        : 'text-foreground'
                                                }`}
                                            >
                                                <div className="text-[10px] font-bold tracking-tight whitespace-nowrap">
                                                    {formatCalendarColumnDate(d.date)}
                                                </div>
                                            </th>
                                        ))}

                                        {/* Sticky Summary Column Headers */}
                                        <th className="px-2 py-2.5 text-center font-bold text-emerald-700 dark:text-emerald-400 min-w-[45px] bg-emerald-50/50 dark:bg-emerald-950/20 border-r border-border/60">
                                            P
                                        </th>
                                        <th className="px-2 py-2.5 text-center font-bold text-amber-700 dark:text-amber-400 min-w-[45px] bg-amber-50/50 dark:bg-amber-950/20 border-r border-border/60">
                                            HD
                                        </th>
                                        <th className="px-2 py-2.5 text-center font-bold text-rose-700 dark:text-rose-400 min-w-[45px] bg-rose-50/50 dark:bg-rose-950/20 border-r border-border/60">
                                            A
                                        </th>
                                        <th className="px-2 py-2.5 text-center font-bold text-blue-700 dark:text-blue-400 min-w-[45px] bg-blue-50/50 dark:bg-blue-950/20 border-r border-border/60">
                                            L
                                        </th>
                                        <th className="px-2.5 py-2.5 text-center font-bold text-foreground min-w-[55px] bg-muted/60 border-r border-border/60">
                                            Paid
                                        </th>
                                        <th className="px-2.5 py-2.5 text-center font-bold text-foreground min-w-[60px] bg-muted/60">
                                            Hours
                                        </th>
                                    </tr>
                                </thead>

                                <tbody className="divide-y divide-border/60">
                                    {filteredEmployees.map((emp, rowIdx) => (
                                        <tr
                                            key={emp.id}
                                            className={`transition-colors hover:bg-muted/30 ${
                                                rowIdx % 2 === 1 ? 'bg-muted/10' : 'bg-background'
                                            }`}
                                        >
                                            {/* Sticky Employee Details Cell */}
                                            <td className="sticky left-0 z-10 bg-background/95 backdrop-blur px-3 py-2 border-r border-border/60 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                                                <div className="font-semibold text-foreground truncate max-w-[190px]">
                                                    {emp.name}
                                                </div>
                                                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                                                    <span className="font-mono font-bold text-primary">
                                                        {emp.employeeId}
                                                    </span>
                                                    <span>•</span>
                                                    <span className="truncate max-w-[110px]">{emp.designation}</span>
                                                </div>
                                            </td>

                                            {/* Day Cells (1..N) */}
                                            {data?.period.days.map((d) => {
                                                const cell = emp.days[d.date];
                                                if (!cell) {
                                                    return (
                                                        <td
                                                            key={d.date}
                                                            className="text-center px-0.5 py-1.5 border-r border-border/40 text-muted-foreground"
                                                        >
                                                            -
                                                        </td>
                                                    );
                                                }

                                                let badgeClass = 'bg-muted text-muted-foreground';
                                                if (cell.badge === 'P') {
                                                    badgeClass = 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 font-bold';
                                                } else if (cell.badge === 'HD') {
                                                    badgeClass = 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 font-bold';
                                                } else if (cell.badge === 'A') {
                                                    badgeClass = 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 font-bold';
                                                } else if (cell.badge === 'L') {
                                                    badgeClass = 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 font-bold';
                                                } else if (cell.badge === 'H') {
                                                    badgeClass = 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300 font-bold';
                                                } else if (cell.badge === 'WO') {
                                                    badgeClass = 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400';
                                                }

                                                return (
                                                    <td
                                                        key={d.date}
                                                        className={`text-center px-0.5 py-1.5 border-r border-border/30 ${
                                                            d.isWeeklyOff ? 'bg-slate-50/60 dark:bg-slate-900/30' : ''
                                                        } ${d.isToday ? 'bg-primary/5' : ''}`}
                                                    >
                                                        <Tooltip>
                                                            <TooltipTrigger asChild>
                                                                <button
                                                                    type="button"
                                                                    className={`inline-flex h-6 w-6 items-center justify-center rounded text-[10px] transition-transform hover:scale-110 focus:outline-none ${badgeClass}`}
                                                                >
                                                                    {cell.badge}
                                                                </button>
                                                            </TooltipTrigger>
                                                            <TooltipContent side="top" className="text-xs p-2 max-w-[220px]">
                                                                <div className="font-bold border-b pb-1 mb-1">
                                                                    {emp.name} ({formatCalendarColumnDate(d.date)})
                                                                </div>
                                                                <div className="space-y-0.5 text-[11px]">
                                                                    <div>
                                                                        <span className="text-muted-foreground">Status: </span>
                                                                        <span className="font-semibold">{cell.status.replace('_', ' ')}</span>
                                                                    </div>
                                                                    {cell.checkInTime && (
                                                                        <div>
                                                                            <span className="text-muted-foreground">Check In: </span>
                                                                            <span className="font-mono">{cell.checkInTime}</span>
                                                                        </div>
                                                                    )}
                                                                    {cell.checkOutTime && (
                                                                        <div>
                                                                            <span className="text-muted-foreground">Check Out: </span>
                                                                            <span className="font-mono">{cell.checkOutTime}</span>
                                                                        </div>
                                                                    )}
                                                                    {cell.workingHours !== null && cell.workingHours > 0 && (
                                                                        <div>
                                                                            <span className="text-muted-foreground">Worked: </span>
                                                                            <span className="font-semibold">{cell.workingHours} hrs</span>
                                                                        </div>
                                                                    )}
                                                                    {cell.leaveTypeName && (
                                                                        <div>
                                                                            <span className="text-muted-foreground">Leave: </span>
                                                                            <span className="text-blue-500 font-medium">
                                                                                {cell.leaveTypeName} {cell.isHalfDayLeave ? '(Half Day)' : ''}
                                                                            </span>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </TooltipContent>
                                                        </Tooltip>
                                                    </td>
                                                );
                                            })}

                                            {/* Summary Values per Row */}
                                            <td className="text-center font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50/20 dark:bg-emerald-950/10 border-r border-border/60">
                                                {emp.summary.presentDays}
                                            </td>
                                            <td className="text-center font-semibold text-amber-700 dark:text-amber-400 bg-amber-50/20 dark:bg-amber-950/10 border-r border-border/60">
                                                {emp.summary.halfDays}
                                            </td>
                                            <td className="text-center font-semibold text-rose-700 dark:text-rose-400 bg-rose-50/20 dark:bg-rose-950/10 border-r border-border/60">
                                                {emp.summary.absentDays}
                                            </td>
                                            <td className="text-center font-semibold text-blue-700 dark:text-blue-400 bg-blue-50/20 dark:bg-blue-950/10 border-r border-border/60">
                                                {emp.summary.leaveDays}
                                            </td>
                                            <td className="text-center font-bold text-foreground bg-muted/20 border-r border-border/60">
                                                {emp.summary.paidDays}
                                            </td>
                                            <td className="text-center font-mono text-[11px] text-muted-foreground bg-muted/20">
                                                {emp.summary.totalWorkingHours}h
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </Card>
            </div>
        </TooltipProvider>
    );
}
