'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import * as z from 'zod';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
    Clock,
    RotateCcw,
    Loader2,
    CheckCircle2,
    AlertTriangle,
    Pencil,
    UserCheck,
    UserX,
    CalendarDays,
    Download,
    Lock,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { DatePickerField } from '@/components/ui/date-picker-field';
import { useToast } from '@/hooks/use-toast';
import { usePermission } from '@/app/hooks/usePermission';
import { apiClient } from '@/app/lib/api-client';
import { branchStorage } from '@/app/lib/branch-storage';
import { tokenStorage } from '@/app/lib/token-storage';
import { LocalBranchFilter } from '@/components/branch/LocalBranchFilter';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { PageLoader } from '@/components/ui/page-loader';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { AttendanceCalendarMatrix } from './AttendanceCalendarMatrix';
import { normalizeWorkbookNumbers } from '@/app/lib/reports/excel-report-header';

type Employee = {
    id: string;
    employeeId: string;
    firstName: string;
    lastName: string;
    designation: string;
    /** Home branch — shown as a column in the read-only All Branches view. */
    branch?: { id: string; name: string; code: string } | null;
    status?: string | null;
    leaveTypeId?: string | null;
    isHoliday?: boolean;
    leaveBalances?: { leaveTypeId: string; remainingBalance: number | string }[];
    /** Name of the APPROVED *whole-day* leave type covering this date, if any — locks the row. */
    approvedLeaveType?: string | null;
    /** Half-day leave never locks the row — shown as a badge alongside normal editable controls. */
    halfDayLeave?: { leaveTypeName: string; session: 'FIRST_HALF' | 'SECOND_HALF' | null } | null;
    checkIn?: string | null;
    checkOut?: string | null;
    /** Employee's own assigned shift (Shift Management) if any, else the global default. */
    shift?: { id: string | null; name: string | null; shiftStart: string; shiftEnd: string; graceMinutes: number } | null;
};

// Leave type option type
type LeaveTypeOption = {
    id: string;
    leaveType: string;
};

// Format date as DD / MM / YYYY
// IST (Asia/Kolkata) calendar date as 'YYYY-MM-DD' — the default Attendance Date.
const istTodayYmd = (): string =>
    new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date());

const formatDateForDisplay = (dateString: string): string => {
    if (!dateString) return '';
    const date = new Date(dateString);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day} / ${month} / ${year}`;
};

// Create dynamic schema based on employees
const createAttendanceSchema = (employeeIds: string[]) => {
    const employeeFields: Record<string, z.ZodTypeAny> = {};
    employeeIds.forEach((id) => {
        employeeFields[`attendance_${id}`] = z.string().optional();
        employeeFields[`leaveType_${id}`] = z.string().optional();
    });

    return z.object({
        attendanceDate: z.string().min(1, 'Attendance date is required'),
        ...employeeFields,
    });
};

type AttendanceFormValues = z.infer<ReturnType<typeof createAttendanceSchema>>;

type AttendanceListPayload = {
    employees: Employee[];
    isAllBranches?: boolean;
    branchWorkingDateYmd: string;
    selectedDateYmd: string;
    isWeeklyOff?: boolean;
    weeklyOffReason?: string | null;
    dayType?: 'WORKING' | 'WEEK_OFF' | 'HOLIDAY' | 'WORKING_OVERRIDE';
    dayNote?: string | null;
    shiftStart?: string;
    shiftEnd?: string;
    graceMinutes?: number;
};

// Wall-clock minutes-since-midnight for an ISO timestamp, in Asia/Kolkata.
const kolkataMinutesOfDay = (iso: string): number => {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kolkata',
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
    }).formatToParts(new Date(iso));
    const h = Number(parts.find((p) => p.type === 'hour')?.value || 0);
    const m = Number(parts.find((p) => p.type === 'minute')?.value || 0);
    return h * 60 + m;
};

const minutesFromHHMM = (hhmm: string): number => {
    const [h, m] = hhmm.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
};

/** Formats a punch ISO timestamp as "h:mm AM/PM" (Asia/Kolkata) for display next to its diff badge. */
function formatPunchTime(iso: string): string {
    return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso));
}

/** Formats a minute count as "Xh Ym" (or just "Xh"/"Ym" when one part is zero). */
function formatMinutesAsHm(totalMinutes: number): string {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours === 0) return `${minutes}m`;
    if (minutes === 0) return `${hours}h`;
    return `${hours}h ${minutes}m`;
}

/** Punch-in vs shiftStart (+grace) — "Late by Xh Ym" / "Early by Xh Ym" / "On time". */
function punchInDiffLabel(checkIn: string, shiftStart: string, graceMinutes: number): { label: string; tone: 'late' | 'early' | 'ontime' } {
    const diff = kolkataMinutesOfDay(checkIn) - minutesFromHHMM(shiftStart);
    if (diff > graceMinutes) return { label: `Late by ${formatMinutesAsHm(diff)}`, tone: 'late' };
    if (diff < 0) return { label: `Early by ${formatMinutesAsHm(-diff)}`, tone: 'early' };
    return { label: 'On time', tone: 'ontime' };
}

/** Punch-out vs shiftEnd — "Early by Xh Ym" (left before shift end) / "Late by Xh Ym" (stayed beyond) / "On time". */
function punchOutDiffLabel(checkOut: string, shiftEnd: string): { label: string; tone: 'late' | 'early' | 'ontime' } {
    const diff = kolkataMinutesOfDay(checkOut) - minutesFromHHMM(shiftEnd);
    if (diff < 0) return { label: `Early by ${formatMinutesAsHm(-diff)}`, tone: 'early' };
    if (diff > 0) return { label: `Late by ${formatMinutesAsHm(diff)}`, tone: 'late' };
    return { label: 'On time', tone: 'ontime' };
}

function PunchDiffBadge({ tone, label }: { tone: 'late' | 'early' | 'ontime'; label: string }) {
    const cls =
        tone === 'late'
            ? 'bg-red-100 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-400'
            : tone === 'early'
            ? 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400'
            : 'bg-green-100 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-400';
    return <span className={`ml-1 rounded px-1.5 py-0.5 text-[11px] font-medium border ${cls}`}>{label}</span>;
}

function parseAttendanceResponse(data: unknown): AttendanceListPayload | null {
    if (data && typeof data === 'object' && 'employees' in data && Array.isArray((data as AttendanceListPayload).employees)) {
        return data as AttendanceListPayload;
    }
    if (Array.isArray(data)) {
        return {
            employees: data as Employee[],
            branchWorkingDateYmd: '',
            selectedDateYmd: '',
        };
    }
    return null;
}

export function AttendanceClient() {
    const { canPage, hasRole } = usePermission();
    const canEditPayroll = canPage('/dashboard/hr/attendance', 'edit');
    const [currentUserRole, setCurrentUserRole] = useState<string | null>(null);

    useEffect(() => {
        const user = tokenStorage.getUser();
        if (user?.role) {
            setCurrentUserRole(user.role);
        }
    }, []);

    const { toast } = useToast();
    // Page-local branch filter — does not switch the session-wide active branch.
    const [branchId, setBranchId] = useState<string>(() => {
        const activeBranch = branchStorage.getActiveBranch();
        const storedUser = tokenStorage.getUser();
        return activeBranch?.id || storedUser?.branchId || '';
    });
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [leaveTypes, setLeaveTypes] = useState<LeaveTypeOption[]>([]);
    const [branchWorkingDateYmd, setBranchWorkingDateYmd] = useState<string | null>(null);
    const [shiftConfig, setShiftConfig] = useState<{ shiftStart: string; shiftEnd: string; graceMinutes: number } | null>(null);
    const [isWeeklyOff, setIsWeeklyOff] = useState(false);
    const [weeklyOffReason, setWeeklyOffReason] = useState<string | null>(null);
    const [dayType, setDayType] = useState<'WORKING' | 'WEEK_OFF' | 'HOLIDAY' | 'WORKING_OVERRIDE'>('WORKING');
    const [dayNote, setDayNote] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isViewMode, setIsViewMode] = useState(false);
    // "All Branches" is a read-only overview across branches; marking needs one branch's register.
    const isAllBranches = branchId === 'all';
    const syncedDateRef = useRef<string | undefined>(undefined);

    const schema = createAttendanceSchema(employees.map((e) => e.id));
    const form = useForm<AttendanceFormValues>({
        resolver: zodResolver(schema),
        defaultValues: {
            attendanceDate: istTodayYmd(),
        },
    });

    const attendanceDate = form.watch('attendanceDate');
    const isHolidayDay = employees.length > 0 && employees.some((emp) => emp.isHoliday || emp.status === 'HOLIDAY');

    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(employees);

    const [shiftFilter, setShiftFilter] = useState<string>('all');
    const [statusFilter, setStatusFilter] = useState<string>('all');
    // Subscribed snapshot of every row's status — the status filter must re-run when a row is
    // edited; `form` itself is a stable reference, so it can't be the memo dependency.
    const watchedFormValues = form.watch();

    // Distinct shifts present across fetched employees
    const shiftOptions = useMemo(() => {
        const map = new Map<string, string>();
        for (const e of employees) {
            if (e.shift?.id && e.shift?.name) {
                map.set(e.shift.id, `${e.shift.name} (${e.shift.shiftStart}–${e.shift.shiftEnd})`);
            }
        }
        return Array.from(map.entries()).map(([id, label]) => ({ id, label }));
    }, [employees]);

    // Combined search + shift filter + status/late filter
    const displayRows = useMemo(() => {
        return searchedRows.filter((employee) => {
            // 1. Shift filter
            if (shiftFilter !== 'all') {
                if (employee.shift?.id !== shiftFilter) return false;
            }

            // 2. Status / Late filter
            if (statusFilter !== 'all') {
                if (statusFilter === 'LATE') {
                    if (!employee.checkIn) return false;
                    const diff = punchInDiffLabel(
                        employee.checkIn,
                        employee.shift?.shiftStart ?? shiftConfig?.shiftStart ?? '09:30',
                        employee.shift?.graceMinutes ?? shiftConfig?.graceMinutes ?? 15
                    );
                    if (diff.tone !== 'late') return false;
                } else if (statusFilter === 'LEAVE') {
                    if (!employee.approvedLeaveType && !employee.halfDayLeave) return false;
                } else {
                    const status = watchedFormValues[`attendance_${employee.id}` as keyof AttendanceFormValues] as string;
                    if (status !== statusFilter) return false;
                }
            }

            return true;
        });
    }, [searchedRows, shiftFilter, statusFilter, shiftConfig, watchedFormValues]);

    useEffect(() => {
        const loadLeaveTypes = async () => {
            try {
                const ltRes = await apiClient.get<any[]>('/payroll/leave-types');
                if (ltRes.success && ltRes.data) {
                    setLeaveTypes(
                        ltRes.data
                            .filter((lt) => lt.isActive)
                            .map((lt) => ({
                                id: lt.id,
                                leaveType: lt.leaveType,
                            }))
                    );
                }
            } catch (error) {
                console.error('Error fetching leave types:', error);
            }
        };
        void loadLeaveTypes();
    }, []);

    useEffect(() => {
        if (!branchId) return;
        syncedDateRef.current = undefined;
        setEmployees([]);
        // Shift ids belong to the previous branch — a stale selection would hide every row.
        setShiftFilter('all');
        setStatusFilter('all');
        // Default to IST "today" rather than the branch working date.
        void fetchAttendance(istTodayYmd());
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [branchId]);

    useEffect(() => {
        if (!attendanceDate) return;
        if (syncedDateRef.current === undefined) {
            syncedDateRef.current = attendanceDate;
            return;
        }
        if (attendanceDate !== syncedDateRef.current) {
            syncedDateRef.current = attendanceDate;
            void fetchAttendance(attendanceDate);
        }
    }, [attendanceDate]);

    const fetchAttendance = async (date?: string) => {
        try {
            setIsLoading(true);
            const params = new URLSearchParams();
            if (date) params.set('date', date);
            if (branchId) params.set('branchId', branchId);
            const qs = params.toString();
            const url = qs ? `/payroll/attendance?${qs}` : '/payroll/attendance';
            const res = await apiClient.get<unknown>(url);
            if (!res.success || res.data === undefined || res.data === null) {
                return;
            }
            const payload = parseAttendanceResponse(res.data);
            if (!payload) {
                return;
            }

            setBranchWorkingDateYmd(payload.branchWorkingDateYmd || null);
            setEmployees(payload.employees);
            setIsWeeklyOff(Boolean(payload.isWeeklyOff));
            setWeeklyOffReason(payload.weeklyOffReason || null);
            setDayType(payload.dayType || 'WORKING');
            setDayNote(payload.dayNote || null);
            if (payload.shiftStart && payload.shiftEnd) {
                setShiftConfig({
                    shiftStart: payload.shiftStart,
                    shiftEnd: payload.shiftEnd,
                    graceMinutes: payload.graceMinutes ?? 0,
                });
            }

            const ymd = payload.selectedDateYmd || payload.branchWorkingDateYmd;
            if (ymd) {
                form.setValue('attendanceDate', ymd);
            }

            payload.employees.forEach((emp) => {
                const status = emp.status || '';
                form.setValue(`attendance_${emp.id}` as keyof AttendanceFormValues, status);
                form.setValue(`leaveType_${emp.id}` as keyof AttendanceFormValues, emp.leaveTypeId || '');
            });

            const isAnyHoliday = payload.employees.length > 0 && payload.employees.some((emp) => emp.isHoliday || emp.status === 'HOLIDAY');

            const hasData = payload.employees.some((emp) => !!emp.status && emp.status !== 'WEEKLY_OFF');
            setIsViewMode(isAllBranches || Boolean(payload.isWeeklyOff) || hasData || isAnyHoliday);
        } catch (error) {
            console.error('Error fetching attendance:', error);
            toast({
                title: 'Error',
                description: 'Failed to load attendance records.',
                variant: 'destructive',
            });
        } finally {
            setIsLoading(false);
        }
    };

    const onSubmit = async (values: AttendanceFormValues) => {
        try {
            setIsSubmitting(true);
            const token = tokenStorage.getAccessToken();

            if (!branchId || !token) {
                toast({
                    title: 'Error',
                    description: 'Branch or authentication token not found',
                    variant: 'destructive',
                });
                return;
            }

            // Prepare attendance data
            const attendanceData = employees.map((employee) => {
                const attendanceStatus = values[`attendance_${employee.id}` as keyof AttendanceFormValues] as string;

                return {
                    employeeId: employee.id, // User UUID
                    branchId: employee.branch?.id ?? null,
                    status: (attendanceStatus || '').toUpperCase(),
                    leaveTypeId: null,
                };
            });

            if (isAllBranches) {
                // The save endpoint works on one branch's register (its own working day, holiday
                // calendar and EOD lock), so an All Branches edit is saved branch by branch.
                // Rows the branch calendar marks as off are not sent.
                const byBranch = new Map<string, typeof attendanceData>();
                for (const row of attendanceData) {
                    if (!row.branchId || row.status === 'WEEKLY_OFF' || row.status === 'HOLIDAY') continue;
                    byBranch.set(row.branchId, [...(byBranch.get(row.branchId) ?? []), row]);
                }
                const failures: string[] = [];
                for (const [rowBranchId, rows] of byBranch) {
                    const branchLabel = employees.find((e) => e.branch?.id === rowBranchId)?.branch?.name ?? rowBranchId;
                    try {
                        const res = await apiClient.post('/payroll/attendance', {
                            attendanceDate: values.attendanceDate,
                            branchId: rowBranchId,
                            employees: rows.map(({ employeeId, status, leaveTypeId }) => ({ employeeId, status, leaveTypeId })),
                        });
                        if (!res.success) failures.push(`${branchLabel}: ${res.error || 'not saved'}`);
                    } catch (err) {
                        failures.push(`${branchLabel}: ${err instanceof Error ? err.message : 'not saved'}`);
                    }
                }
                if (failures.length > 0) {
                    toast({ title: 'Some branches were not saved', description: failures.join(' | '), variant: 'destructive' });
                    await fetchAttendance(values.attendanceDate);
                    return;
                }
            } else {
                await apiClient.post(
                    '/payroll/attendance',
                    {
                        attendanceDate: values.attendanceDate,
                        branchId,
                        employees: attendanceData.map(({ employeeId, status, leaveTypeId }) => ({ employeeId, status, leaveTypeId })),
                    }
                );
            }

            toast({
                title: 'Success',
                description: 'Attendance updated successfully',
            });

            setIsViewMode(true);
            await fetchAttendance(values.attendanceDate);
        } catch (error: any) {
            console.error('Error updating attendance:', error);
            toast({
                title: 'Error',
                description: error.response?.data?.message || 'Failed to update attendance',
                variant: 'destructive',
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    const markAllAttendance = (status: 'PRESENT' | 'ABSENT') => {
        employees.forEach((employee) => {
            if (employee.approvedLeaveType) return;
            form.setValue(`attendance_${employee.id}` as keyof AttendanceFormValues, status, {
                shouldDirty: true,
                shouldValidate: true,
            });
            form.setValue(`leaveType_${employee.id}` as keyof AttendanceFormValues, '');
        });
    };

    // Builds the export rows from the currently displayed (filtered/searched)
    // rows — same Punch In/Out time + diff + status/leave data shown on
    // screen, not a separate server-fetched report. Shared by both the Excel
    // and PDF download options.
    const buildAttendanceReportData = () => {
        const headers = ['Employee ID', 'Employee Name', 'Designation', 'Shift', 'Status', 'Punch In', 'Punch In Diff', 'Punch Out', 'Punch Out Diff', 'Leave Type', 'Total Worked Hours'];
        const rows = displayRows.map((employee) => {
            const status = (form.getValues(`attendance_${employee.id}` as keyof AttendanceFormValues) as string) || '';
            const ltId = (form.getValues(`leaveType_${employee.id}` as keyof AttendanceFormValues) as string) || '';
            const ltName = leaveTypes.find((l) => l.id === ltId)?.leaveType || '';
            const shiftForDiff = employee.shift || shiftConfig;
            const punchIn = employee.checkIn ? formatPunchTime(employee.checkIn) : '';
            const punchInDiff = employee.checkIn && shiftForDiff ? punchInDiffLabel(employee.checkIn, employee.shift?.shiftStart ?? shiftConfig!.shiftStart, employee.shift?.graceMinutes ?? shiftConfig!.graceMinutes).label : '';
            const punchOut = employee.checkOut ? formatPunchTime(employee.checkOut) : '';
            const punchOutDiff = employee.checkOut && shiftForDiff ? punchOutDiffLabel(employee.checkOut, employee.shift?.shiftEnd ?? shiftConfig!.shiftEnd).label : '';
            const totalWorkedHours = employee.checkIn && employee.checkOut
                ? formatMinutesAsHm(Math.round((new Date(employee.checkOut).getTime() - new Date(employee.checkIn).getTime()) / 60000))
                : '';
            const displayStatus = employee.approvedLeaveType
                ? `Approved Leave (${employee.approvedLeaveType})`
                : (status === 'WEEKLY_OFF' || (isWeeklyOff && !status))
                ? (dayType === 'HOLIDAY' ? 'Holiday' : 'Week Off')
                : status;
            return [
                employee.employeeId, `${employee.firstName} ${employee.lastName}`, employee.designation,
                employee.shift?.name ?? 'Default', displayStatus,
                punchIn, punchInDiff, punchOut, punchOutDiff, ltName, totalWorkedHours,
            ];
        });
        return { headers, rows };
    };

    const reportFileBase = () => `attendance-${form.getValues('attendanceDate') || istTodayYmd()}`;

    const handleDownloadExcel = async () => {
        const { headers, rows } = buildAttendanceReportData();
        try {
            const XLSX = await import('xlsx');
            const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
            ws['!cols'] = headers.map((h, i) => ({
                wch: Math.min(40, Math.max(h.length, ...rows.map((r) => String(r[i] ?? '').length)) + 2),
            }));
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Attendance');
            normalizeWorkbookNumbers(wb);
            XLSX.writeFile(wb, `${reportFileBase()}.xlsx`);
        } catch {
            toast({ title: 'Error', description: 'Could not generate the Excel file.', variant: 'destructive' });
        }
    };

    const handleDownloadPdf = async () => {
        const { headers, rows } = buildAttendanceReportData();
        try {
            const [{ jsPDF }, autoTableModule] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
            const autoTable = autoTableModule.default;
            const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
            doc.setFontSize(13);
            doc.text('Attendance Report', 14, 14);
            doc.setFontSize(9);
            doc.text(`${reportFileBase()} — ${rows.length} employees`, 14, 20);
            autoTable(doc, {
                head: [headers],
                body: rows,
                startY: 24,
                styles: { fontSize: 7, cellPadding: 1.5, overflow: 'linebreak' },
                headStyles: { fillColor: [22, 101, 52], textColor: 255 },
            });
            doc.save(`${reportFileBase()}.pdf`);
        } catch {
            toast({ title: 'Error', description: 'Could not generate the PDF file.', variant: 'destructive' });
        }
    };

    const handleReset = () => {
        const ymd = branchWorkingDateYmd || '';
        syncedDateRef.current = undefined;
        setIsWeeklyOff(false);
        setWeeklyOffReason(null);
        setDayType('WORKING');
        setDayNote(null);
        form.reset({
            attendanceDate: ymd,
        });
        employees.forEach((employee) => {
            form.setValue(`attendance_${employee.id}` as keyof AttendanceFormValues, '');
            form.setValue(`leaveType_${employee.id}` as keyof AttendanceFormValues, '');
        });
        void fetchAttendance(ymd || undefined);
    };

    return (
        <div className="space-y-6">
            <Tabs defaultValue="daily" className="w-full space-y-6">
                {/* Header with Tab Switcher */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border/60 pb-4">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-foreground dark:text-slate-50">
                            Attendance Management
                        </h1>
                        <p className="text-muted-foreground mt-1">
                            Record daily punch register or view branch-wide monthly attendance calendar matrix
                        </p>
                    </div>
                    <TabsList className="bg-muted/70 p-1">
                        <TabsTrigger value="daily" className="gap-2 data-[state=active]:bg-background font-medium">
                            <Clock className="h-4 w-4" />
                            Daily Register
                        </TabsTrigger>
                        <TabsTrigger value="calendar" className="gap-2 data-[state=active]:bg-background font-medium">
                            <CalendarDays className="h-4 w-4 text-primary" />
                            Monthly Calendar
                        </TabsTrigger>
                    </TabsList>
                </div>

                <TabsContent value="daily" className="space-y-6 mt-0">

            {/* Warning Alert */}
            <Alert className="border-yellow-200 bg-yellow-50 dark:border-yellow-900 dark:bg-yellow-950/20">
                <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
                <AlertDescription className="text-yellow-800 dark:text-yellow-200">
                    <strong>Note:</strong> Mark Absent only if the employee is on un-informed leave. Approved leaves are automatically recorded and locked.
                </AlertDescription>
            </Alert>

            {isWeeklyOff && (
                <Alert className="border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/20">
                    <CalendarDays className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                    <AlertDescription className="text-blue-900 dark:text-blue-100 flex items-center justify-between">
                        <span>
                            <strong>{dayType === 'HOLIDAY' ? 'Holiday' : 'Scheduled Weekly Off'}:</strong>{' '}
                            {dayType === 'HOLIDAY'
                                ? (dayNote || 'This date is a holiday.')
                                : (weeklyOffReason || 'This date is a scheduled Weekly Off.')}{' '}
                            The attendance register is locked. (To enable attendance for this date, mark it as a Working Day in the Holiday Calendar.)
                        </span>
                    </AlertDescription>
                </Alert>
            )}

            {branchWorkingDateYmd &&
                attendanceDate &&
                attendanceDate !== branchWorkingDateYmd && (
                    <Alert className="border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20">
                        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                        <AlertDescription className="text-amber-900 dark:text-amber-100">
                            You are viewing <strong>{attendanceDate}</strong>. End of day checks attendance for the
                            branch <strong>working date</strong>{' '}
                            <strong>{branchWorkingDateYmd}</strong> (Asia/Kolkata). Save for that date so EOD passes.
                        </AlertDescription>
                    </Alert>
                )}

            {/* Main Form Card */}
            <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
                {/* Top Accent Bar */}
                <div className="h-1.5 bg-gradient-to-r from-primary via-primary to-purple-600" />

                <CardHeader className="bg-gradient-to-r from-slate-50 via-green-50/60 to-green-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                    <CardTitle className="flex items-center gap-2 text-xl">
                        <Clock className="h-5 w-5 text-primary dark:text-primary" />
                        Employee Attendance
                    </CardTitle>
                    <CardDescription>
                        Select attendance date and mark employee attendance status
                    </CardDescription>
                </CardHeader>

                <CardContent className="pt-6">
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                            {isLoading ? (
                                <PageLoader label="Loading employees..." fullScreen={false} />
                            ) : (
                                <>
                                    <LocalBranchFilter value={branchId} onChange={setBranchId} includeAll />
                                    {isAllBranches && (
                                        <p className="text-sm text-slate-500 dark:text-slate-400">
                                            Showing every branch you have access to. Use Edit Attendance to mark them here — each branch is saved with its own calendar and rules.
                                        </p>
                                    )}

                                    {/* Date and Holiday Section */}
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        {/* Attendance Date */}
                                        <FormField
                                            control={form.control}
                                            name="attendanceDate"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel className="text-base font-semibold">
                                                        Attendance Date <span className="text-red-500">*</span>
                                                    </FormLabel>
                                                    <FormControl>
                                                        <DatePickerField
                                                            id="attendanceDate"
                                                            value={field.value}
                                                            onChange={field.onChange}
                                                            disabled={isSubmitting}
                                                        />
                                                    </FormControl>
                                                    <p className="text-sm text-muted-foreground">
                                                        {attendanceDate ? formatDateForDisplay(attendanceDate) : 'Select date'}
                                                    </p>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />

                                        {/* Day Status — holidays and week-offs are managed in Holiday Calendar / Week Configuration */}
                                        <div className="flex flex-col justify-end">
                                            <Label className="text-base font-semibold mb-2">Day Status</Label>
                                            <div className="flex items-center h-10 gap-2">
                                                {isHolidayDay || dayType === 'HOLIDAY' ? (
                                                    <Badge className="bg-brand-green-tint text-sidebar-accent hover:bg-brand-green-tint uppercase border-primary/30 shadow-sm">
                                                        Holiday
                                                    </Badge>
                                                ) : isWeeklyOff ? (
                                                    <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100 uppercase border-slate-300 shadow-sm dark:bg-slate-800 dark:text-slate-300">
                                                        Week Off
                                                    </Badge>
                                                ) : (
                                                    <Badge variant="outline" className="border-emerald-300 text-emerald-700 bg-emerald-50 dark:bg-emerald-950/20 dark:text-emerald-400 font-medium">
                                                        Working Day
                                                    </Badge>
                                                )}
                                                {dayNote && (
                                                    <span className="text-sm text-muted-foreground" title={dayNote}>
                                                        {dayNote}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Employee Attendance Table */}
                                    {employees.length > 0 && (
                                        <div className="space-y-4">
                                            <div className="flex items-center justify-between">
                                                <h3 className="text-lg font-semibold text-foreground dark:text-slate-50">
                                                    Employee Attendance
                                                </h3>
                                                {isWeeklyOff ? (
                                                    <Button type="button" disabled variant="outline" className="border-slate-300 text-slate-500 cursor-not-allowed">
                                                        <Lock className="w-4 h-4 mr-2" />
                                                        {isHolidayDay || dayType === 'HOLIDAY' ? 'Holiday (Locked)' : 'Week Off (Locked)'}
                                                    </Button>
                                                ) : isViewMode ? (
                                                    <Button type="button" onClick={() => setIsViewMode(false)} variant="outline" className="border-primary text-primary hover:bg-green-50 dark:hover:bg-brand-green-darker/20">
                                                        <Pencil className="w-4 h-4 mr-2" />
                                                        Edit Attendance
                                                    </Button>
                                                ) : null}
                                                {!isViewMode && canEditPayroll && (
                                                    <div className="flex gap-2">
                                                        <Button
                                                            type="button"
                                                            onClick={() => markAllAttendance('PRESENT')}
                                                            disabled={isSubmitting}
                                                            variant="outline"
                                                            size="sm"
                                                            className="border-green-600 text-green-700 hover:bg-green-50 dark:border-green-700 dark:text-green-400 dark:hover:bg-green-950/20"
                                                        >
                                                            <UserCheck className="w-4 h-4 mr-2" />
                                                            Mark All Present
                                                        </Button>
                                                        <Button
                                                            type="button"
                                                            onClick={() => markAllAttendance('ABSENT')}
                                                            disabled={isSubmitting}
                                                            variant="outline"
                                                            size="sm"
                                                            className="border-red-600 text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950/20"
                                                        >
                                                            <UserX className="w-4 h-4 mr-2" />
                                                            Mark All Absent
                                                        </Button>
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex flex-wrap items-center justify-between gap-4">
                                                <div className="flex flex-wrap items-center gap-3">
                                                    {/* Shift Filter */}
                                                    <div className="w-56">
                                                        <Select value={shiftFilter} onValueChange={setShiftFilter}>
                                                            <SelectTrigger className="h-9 text-xs">
                                                                <SelectValue placeholder="All Shifts" />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="all">All Shifts</SelectItem>
                                                                {shiftOptions.map((s) => (
                                                                    <SelectItem key={s.id} value={s.id}>
                                                                        {s.label}
                                                                    </SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                    </div>

                                                    {/* Status / Late Filter */}
                                                    <div className="w-48">
                                                        <Select value={statusFilter} onValueChange={setStatusFilter}>
                                                            <SelectTrigger className="h-9 text-xs">
                                                                <SelectValue placeholder="All Statuses" />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="all">All Statuses</SelectItem>
                                                                <SelectItem value="PRESENT">Present</SelectItem>
                                                                <SelectItem value="ABSENT">Absent</SelectItem>
                                                                <SelectItem value="HALF_DAY">Half Day</SelectItem>
                                                                <SelectItem value="LATE">Late Arrival (Shift-based)</SelectItem>
                                                                <SelectItem value="LEAVE">On Leave</SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                    </div>
                                                    {(shiftFilter !== 'all' || statusFilter !== 'all') && (
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            className="h-9 text-xs text-muted-foreground hover:text-foreground"
                                                            onClick={() => {
                                                                setShiftFilter('all');
                                                                setStatusFilter('all');
                                                            }}
                                                        >
                                                            Reset Filters
                                                        </Button>
                                                    )}
                                                </div>

                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button
                                                            type="button"
                                                            variant="outline"
                                                            size="sm"
                                                            className="ml-auto h-9"
                                                            disabled={displayRows.length === 0}
                                                        >
                                                            <Download className="w-4 h-4 mr-2" />
                                                            Download Report
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end">
                                                        <DropdownMenuItem onClick={handleDownloadExcel}>Excel (.xlsx)</DropdownMenuItem>
                                                        <DropdownMenuItem onClick={handleDownloadPdf}>PDF</DropdownMenuItem>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                                <TableSearchInput
                                                    value={tableSearchQuery}
                                                    onChange={setTableSearchQuery}
                                                    placeholder="Search employees..."
                                                    className="w-64"
                                                />
                                            </div>
                                            <div className="border rounded-lg overflow-hidden">
                                                <div className="overflow-x-auto">
                                                {isViewMode ? (
                                                    <Table>
                                                        <TableHeader>
                                                            <TableRow className="bg-primary dark:bg-primary">
                                                                <TableHead className="text-white font-semibold w-[160px]">Employee Name</TableHead>
                                                                {isAllBranches && <TableHead className="text-white font-semibold w-[130px]">Branch</TableHead>}
                                                                <TableHead className="text-white font-semibold w-[70px]">Designation</TableHead>
                                                                <TableHead className="text-white font-semibold w-[90px]">Shift</TableHead>
                                                                <TableHead className="text-white font-semibold text-center w-[110px]">Status</TableHead>
                                                                <TableHead className="text-white font-semibold text-center">Punch In</TableHead>
                                                                <TableHead className="text-white font-semibold text-center">Punch In Diff</TableHead>
                                                                <TableHead className="text-white font-semibold text-center">Punch Out</TableHead>
                                                                <TableHead className="text-white font-semibold text-center">Punch Out Diff</TableHead>
                                                                <TableHead className="text-white font-semibold text-right">Leave Type</TableHead>
                                                            </TableRow>
                                                        </TableHeader>
                                                        <TableBody>
                                                            {displayRows.length === 0 ? (
                                                                <TableRow>
                                                                    <TableCell colSpan={isAllBranches ? 9 : 8} className="py-8 text-center text-slate-500">
                                                                        No employees match the selected filters.
                                                                    </TableCell>
                                                                </TableRow>
                                                            ) : displayRows.map((employee, index) => {
                                                                const status = form.watch(`attendance_${employee.id}` as keyof AttendanceFormValues) as string;
                                                                const ltId = form.watch(`leaveType_${employee.id}` as keyof AttendanceFormValues) as string;
                                                                const ltName = leaveTypes.find(l => l.id === ltId)?.leaveType || '-';

                                                                return (
                                                                    <TableRow key={employee.id} className={index % 2 === 0 ? 'bg-white dark:bg-brand-green-darker' : 'bg-green-50 dark:bg-sidebar-accent'}>
                                                                        <TableCell className="font-medium">
                                                                            {employee.employeeId} - {employee.firstName} {employee.lastName}
                                                                        </TableCell>
                                                                        {isAllBranches && (
                                                                            <TableCell className="text-sm">{employee.branch ? `${employee.branch.code} - ${employee.branch.name}` : '—'}</TableCell>
                                                                        )}
                                                                        <TableCell>{employee.designation}</TableCell>
                                                                        <TableCell className="text-sm">
                                                                            <Badge variant="outline" className="font-normal">
                                                                                {employee.shift?.name ?? 'Default'}
                                                                            </Badge>
                                                                            <div className="text-[10px] text-slate-400">
                                                                                {employee.shift?.shiftStart}–{employee.shift?.shiftEnd}
                                                                            </div>
                                                                        </TableCell>
                                                                        <TableCell className="text-center">
                                                                            {employee.approvedLeaveType ? (
                                                                                <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100 uppercase border-blue-200 shadow-sm">
                                                                                    Approved Leave — {employee.approvedLeaveType}
                                                                                </Badge>
                                                                            ) : (
                                                                                <>
                                                                                    {status === 'PRESENT' && <Badge className="bg-green-100 text-green-700 hover:bg-green-100 uppercase border-green-200 shadow-sm">Present</Badge>}
                                                                                    {status === 'ABSENT' && <Badge className="bg-red-100 text-red-700 hover:bg-red-100 uppercase border-red-200 shadow-sm">Absent</Badge>}
                                                                                    {status === 'HALF_DAY' && <Badge className="bg-orange-100 text-orange-700 hover:bg-orange-100 uppercase border-orange-200 shadow-sm">Half Day</Badge>}
                                                                                    {status === 'HOLIDAY' && <Badge className="bg-brand-green-tint text-sidebar-accent hover:bg-brand-green-tint uppercase border-primary/30 shadow-sm">Holiday</Badge>}
                                                                                    {isWeeklyOff && !status && dayType === 'HOLIDAY' && (
                                                                                        <Badge className="bg-brand-green-tint text-sidebar-accent hover:bg-brand-green-tint uppercase border-primary/30 shadow-sm">Holiday</Badge>
                                                                                    )}
                                                                                    {(status === 'WEEKLY_OFF' || (isWeeklyOff && !status && dayType !== 'HOLIDAY')) && (
                                                                                        <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100 uppercase border-slate-300 shadow-sm dark:bg-slate-800 dark:text-slate-300">
                                                                                            Week Off
                                                                                        </Badge>
                                                                                    )}
                                                                                    {!status && !isWeeklyOff && <Badge variant="outline" className="text-slate-500">Not Marked</Badge>}
                                                                                    {employee.halfDayLeave && (
                                                                                        <div className="mt-1">
                                                                                            <Badge variant="outline" className="border-blue-300 text-blue-600 text-[10px]">
                                                                                                Half Day Leave{employee.halfDayLeave.session ? ` (${employee.halfDayLeave.session === 'FIRST_HALF' ? 'First' : 'Second'})` : ''} — {employee.halfDayLeave.leaveTypeName}
                                                                                            </Badge>
                                                                                        </div>
                                                                                    )}
                                                                                </>
                                                                            )}
                                                                        </TableCell>
                                                                        <TableCell className="text-center text-sm font-medium text-sidebar-accent dark:text-slate-200">
                                                                            {employee.checkIn ? formatPunchTime(employee.checkIn) : <span className="text-slate-300 dark:text-sidebar-accent font-normal">-</span>}
                                                                        </TableCell>
                                                                        <TableCell className="text-center text-sm">
                                                                            {employee.checkIn && (employee.shift || shiftConfig) ? (
                                                                                <PunchDiffBadge {...punchInDiffLabel(employee.checkIn, employee.shift?.shiftStart ?? shiftConfig!.shiftStart, employee.shift?.graceMinutes ?? shiftConfig!.graceMinutes)} />
                                                                            ) : (
                                                                                <span className="text-slate-300 dark:text-sidebar-accent">-</span>
                                                                            )}
                                                                        </TableCell>
                                                                        <TableCell className="text-center text-sm font-medium text-sidebar-accent dark:text-slate-200">
                                                                            {employee.checkOut ? formatPunchTime(employee.checkOut) : <span className="text-slate-300 dark:text-sidebar-accent font-normal">-</span>}
                                                                        </TableCell>
                                                                        <TableCell className="text-center text-sm">
                                                                            {employee.checkOut && (employee.shift || shiftConfig) ? (
                                                                                <PunchDiffBadge {...punchOutDiffLabel(employee.checkOut, employee.shift?.shiftEnd ?? shiftConfig!.shiftEnd)} />
                                                                            ) : (
                                                                                <span className="text-slate-300 dark:text-sidebar-accent">-</span>
                                                                            )}
                                                                        </TableCell>
                                                                        <TableCell className="text-right font-medium text-sidebar-accent dark:text-slate-400">
                                                                            {ltId && ltId !== '' ? (
                                                                                <Badge variant="secondary" className="uppercase">{ltName}</Badge>
                                                                            ) : (
                                                                                <span className="text-slate-300 dark:text-sidebar-accent">-</span>
                                                                            )}
                                                                        </TableCell>
                                                                    </TableRow>
                                                                );
                                                            })}
                                                        </TableBody>
                                                    </Table>
                                                ) : (
                                                    <Table>
                                                        <TableHeader>
                                                            <TableRow className="bg-primary dark:bg-primary">
                                                                <TableHead className="text-white font-semibold">Employee Name</TableHead>
                                                                {isAllBranches && <TableHead className="text-white font-semibold">Branch</TableHead>}
                                                                <TableHead className="text-white font-semibold">Designation</TableHead>
                                                                <TableHead className="text-white font-semibold">Shift</TableHead>
                                                                <TableHead className="text-white font-semibold text-center">Present</TableHead>
                                                                <TableHead className="text-white font-semibold text-center">Absent</TableHead>
                                                                <TableHead className="text-white font-semibold text-center">Half Day</TableHead>
                                                            </TableRow>
                                                        </TableHeader>
                                                        <TableBody>
                                                            {displayRows.length === 0 ? (
                                                                <TableRow>
                                                                    <TableCell colSpan={isAllBranches ? 7 : 6} className="py-8 text-center text-slate-500">
                                                                        No employees match the selected filters.
                                                                    </TableCell>
                                                                </TableRow>
                                                            ) : displayRows.map((employee, index) => {
                                                                const attendanceFieldName = `attendance_${employee.id}` as keyof AttendanceFormValues;
                                                                const leaveTypeFieldName = `leaveType_${employee.id}` as keyof AttendanceFormValues;

                                                                return (
                                                                    <TableRow
                                                                        key={employee.id}
                                                                        className={index % 2 === 0 ? 'bg-white dark:bg-brand-green-darker' : 'bg-green-50 dark:bg-sidebar-accent'}
                                                                    >
                                                                        <TableCell className="font-medium">
                                                                            {employee.employeeId} - {employee.firstName} {employee.lastName}
                                                                            {employee.halfDayLeave && (
                                                                                <div className="mt-1">
                                                                                    <Badge variant="outline" className="border-blue-300 text-blue-600 text-[10px]">
                                                                                        Half Day Leave{employee.halfDayLeave.session ? ` (${employee.halfDayLeave.session === 'FIRST_HALF' ? 'First' : 'Second'})` : ''}
                                                                                    </Badge>
                                                                                </div>
                                                                            )}
                                                                        </TableCell>
                                                                        {isAllBranches && (
                                                                            <TableCell className="text-sm">{employee.branch ? `${employee.branch.code} - ${employee.branch.name}` : '—'}</TableCell>
                                                                        )}
                                                                        <TableCell>{employee.designation}</TableCell>
                                                                        <TableCell className="text-sm">
                                                                            <Badge variant="outline" className="font-normal">
                                                                                {employee.shift?.name ?? 'Default'}
                                                                            </Badge>
                                                                        </TableCell>
                                                                        {employee.approvedLeaveType ? (
                                                                            <TableCell colSpan={3} className="text-center">
                                                                                <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100 uppercase border-blue-200 shadow-sm">
                                                                                    Approved Leave — {employee.approvedLeaveType}
                                                                                </Badge>
                                                                            </TableCell>
                                                                        ) : (
                                                                        <FormField
                                                                            control={form.control}
                                                                            name={attendanceFieldName}
                                                                            render={({ field }) => (
                                                                                <>
                                                                                    <TableCell className="text-center">
                                                                                        <FormItem>
                                                                                            <FormControl>
                                                                                                <div className="flex justify-center">
                                                                                                    <input
                                                                                                        type="radio"
                                                                                                        id={`present-${employee.id}`}
                                                                                                        name={`attendance-${employee.id}`}
                                                                                                        value="PRESENT"
                                                                                                        checked={field.value === "PRESENT"}
                                                                                                        onChange={() => {
                                                                                                            field.onChange("PRESENT");
                                                                                                            form.setValue(leaveTypeFieldName, '');
                                                                                                        }}
                                                                                                        disabled={isSubmitting}
                                                                                                        className="h-4 w-4 cursor-pointer"
                                                                                                    />
                                                                                                </div>
                                                                                            </FormControl>
                                                                                        </FormItem>
                                                                                    </TableCell>
                                                                                    <TableCell className="text-center">
                                                                                        <FormItem>
                                                                                            <FormControl>
                                                                                                <div className="flex justify-center">
                                                                                                    <input
                                                                                                        type="radio"
                                                                                                        id={`absent-${employee.id}`}
                                                                                                        name={`attendance-${employee.id}`}
                                                                                                        value="ABSENT"
                                                                                                        checked={field.value === "ABSENT"}
                                                                                                        onChange={() => {
                                                                                                            field.onChange("ABSENT");
                                                                                                            form.setValue(leaveTypeFieldName, '');
                                                                                                        }}
                                                                                                        disabled={isSubmitting}
                                                                                                        className="h-4 w-4 cursor-pointer"
                                                                                                    />
                                                                                                </div>
                                                                                            </FormControl>
                                                                                        </FormItem>
                                                                                    </TableCell>
                                                                                    <TableCell className="text-center">
                                                                                        <FormItem>
                                                                                            <FormControl>
                                                                                                <div className="flex justify-center">
                                                                                                    <input
                                                                                                        type="radio"
                                                                                                        id={`halfday-${employee.id}`}
                                                                                                        name={`attendance-${employee.id}`}
                                                                                                        value="HALF_DAY"
                                                                                                        checked={field.value === "HALF_DAY"}
                                                                                                        onChange={() => {
                                                                                                            field.onChange("HALF_DAY");
                                                                                                            form.setValue(leaveTypeFieldName, '');
                                                                                                        }}
                                                                                                        disabled={isSubmitting}
                                                                                                        className="h-4 w-4 cursor-pointer"
                                                                                                    />
                                                                                                </div>
                                                                                            </FormControl>
                                                                                        </FormItem>
                                                                                    </TableCell>
                                                                                </>
                                                                            )}
                                                                        />
                                                                        )}
                                                                    </TableRow>
                                                                );
                                                            })}
                                                        </TableBody>
                                                    </Table>
                                                )}
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* Action Buttons */}
                                    {!isViewMode && canEditPayroll && (
                                        <div className="flex flex-wrap gap-3 pt-4">
                                            <Button
                                                type="submit"
                                                disabled={isSubmitting || !form.formState.isValid}
                                                className="flex-1 min-w-[120px] bg-primary hover:bg-primary text-white"
                                                size="lg"
                                            >
                                                {isSubmitting ? (
                                                    <>
                                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                        Updating...
                                                    </>
                                                ) : (
                                                    <>
                                                        <CheckCircle2 className="mr-2 h-4 w-4" />
                                                        Update
                                                    </>
                                                )}
                                            </Button>

                                            <Button
                                                type="button"
                                                onClick={() => {
                                                    setIsViewMode(true);
                                                    void fetchAttendance(form.getValues('attendanceDate') || undefined);
                                                }}
                                                disabled={isSubmitting}
                                                variant="outline"
                                                size="lg"
                                                className="flex-1 min-w-[120px]"
                                            >
                                                Cancel
                                            </Button>

                                            <Button
                                                type="button"
                                                onClick={handleReset}
                                                disabled={isSubmitting}
                                                variant="destructive"
                                                className="flex-1 min-w-[120px]"
                                                size="lg"
                                            >
                                                <RotateCcw className="mr-2 h-4 w-4" />
                                                Reset
                                            </Button>
                                        </div>
                                    )}
                                </>
                            )}
                        </form>
                    </Form>
                </CardContent>
            </Card>

            {/* Empty State */}
            {
                !isLoading && employees.length === 0 && (
                    <Card className="border-2 border-dashed border-primary/30 dark:border-sidebar-accent">
                        <CardContent className="flex flex-col items-center justify-center py-12">
                            <Clock className="h-12 w-12 text-muted-foreground mb-4" />
                            <p className="text-lg font-semibold text-muted-foreground mb-2">No Employees Available</p>
                            <p className="text-sm text-muted-foreground text-center">
                                There are no employees available for the current branch. Please contact your administrator.
                            </p>
                        </CardContent>
                    </Card>
                )
            }
                </TabsContent>

                <TabsContent value="calendar" className="mt-0">
                    <AttendanceCalendarMatrix />
                </TabsContent>
            </Tabs>
        </div>
    );
}

