'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { FileSpreadsheet, Download, FileText, ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import { apiClient } from '@/app/lib/api-client';
import { DatePickerField } from '@/components/ui/date-picker-field';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { ReportCatalogEntry } from './report-catalog';
import { normalizeWorkbookNumbers } from '@/app/lib/reports/excel-report-header';

type ReportResult = {
    reportName: string; headers: string[]; rows: (string | number)[][]; totalCount: number;
    /** Staff Loan / Staff Advance reports only: summary cards and the rupee columns. */
    summary?: { label: string; value: number; money: boolean }[];
    moneyColumns?: number[];
};

const PAGE_SIZE = 25;
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const formatMoney = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(value);

// Base roles (User.role) — for the Missed Punch In report's role filter.
const ROLE_OPTIONS = ['ADMIN', 'BRANCH_MANAGER', 'FDO', 'AREA_MANAGER', 'DIVISION_MANAGER'];
type Branch = { id: string; name: string };
type DepartmentOption = { id: string; name: string };
type EmployeeOption = { id: string; employeeId: string | null; firstName: string; lastName: string };

function toCsv(result: ReportResult): string {
    const escape = (v: string | number) => {
        const s = String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [result.headers.map(escape).join(','), ...result.rows.map((r) => r.map(escape).join(','))].join('\n');
}

/**
 * Runs and displays exactly one report from REPORT_CATALOG — the generic
 * date-filter/table/export logic that used to be shared across all 13
 * reports inside the combined HrReportsHub dropdown, now parameterized by
 * a single `report` entry so each report gets its own page
 * (/dashboard/hr/reports/[slug]) instead of a picker.
 */
export function SingleReportRunner({ report }: { report: ReportCatalogEntry }) {
    const router = useRouter();
    const { toast } = useToast();
    const [fromDate, setFromDate] = useState('');
    const [toDate, setToDate] = useState('');
    const [branchId, setBranchId] = useState('all');
    const [employeeId, setEmployeeId] = useState('all');
    const [shiftId, setShiftId] = useState('all');
    const [role, setRole] = useState('all');
    const [search, setSearch] = useState('');
    const [departmentId, setDepartmentId] = useState('all');
    const [status, setStatus] = useState('all');
    const [type, setType] = useState('all');
    // Month / Year for payroll-month reports - default to the current IST month so a report never silently spans every month.
    const nowIst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const [month, setMonth] = useState(String(nowIst.getMonth() + 1));
    const [year, setYear] = useState(String(nowIst.getFullYear()));
    const [departments, setDepartments] = useState<DepartmentOption[]>([]);
    const [page, setPage] = useState(1);
    const [branches, setBranches] = useState<Branch[]>([]);
    const [employees, setEmployees] = useState<EmployeeOption[]>([]);
    const [shifts, setShifts] = useState<{ id: string; name: string; shiftStart: string; shiftEnd: string }[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [result, setResult] = useState<ReportResult | null>(null);

    // Branch filter applies to every report; the API narrows within
    // whatever branches this user is already permitted to see (never wider).
    useEffect(() => {
        apiClient.get<Branch[]>('/branches?permitted=true').then((res) => {
            if (res.success && res.data) setBranches(res.data);
        });
    }, []);

    // Shifts filter for Late Attendance report
    useEffect(() => {
        if (!report.supportsShiftFilter) return;
        apiClient.get<any[]>('/hr/shifts').then((res) => {
            if (res.success && res.data) setShifts(res.data);
        });
    }, [report.supportsShiftFilter]);

    useEffect(() => {
        if (!report.supportsDepartmentFilter) return;
        apiClient.get<DepartmentOption[]>('/hr/departments').then((res) => {
            if (res.success && res.data) setDepartments(res.data);
        });
    }, [report.supportsDepartmentFilter]);

    // Employee filter is only offered on the 4 reports the user asked for
    // (Absentee, Late Attendance, Leave Balance, Travel & Client Visit) —
    // re-scoped to the selected branch, like the leave apply-for-others picker.
    useEffect(() => {
        if (!report.supportsEmployeeFilter) return;
        const qs = branchId !== 'all' ? `?status=active&branchId=${branchId}` : '?status=active';
        apiClient.get<EmployeeOption[]>(`/hr/employees${qs}`).then((res) => {
            if (res.success && res.data) setEmployees(res.data);
        });
        setEmployeeId('all');
    }, [report.supportsEmployeeFilter, branchId]);

    const handleRun = useCallback(async () => {
        if (report.needsRange && !report.rangeOptional && (!fromDate || !toDate)) {
            toast({ title: 'Validation Error', description: 'From and To date are required for this report.', variant: 'destructive' });
            return;
        }
        setIsLoading(true);
        setResult(null);
        try {
            const qs = new URLSearchParams();
            if (fromDate) qs.set('fromDate', fromDate);
            if (toDate) qs.set('toDate', toDate);
            if (branchId !== 'all') qs.set('branchId', branchId);
            if (report.supportsEmployeeFilter && employeeId !== 'all') qs.set('employeeId', employeeId);
            if (report.supportsShiftFilter && shiftId !== 'all') qs.set('shiftId', shiftId);
            if (report.supportsRoleFilter && role !== 'all') qs.set('role', role);
            if (report.supportsSearch && search.trim()) qs.set('search', search.trim());
            if (report.supportsDepartmentFilter && departmentId !== 'all') qs.set('departmentId', departmentId);
            if (report.statusFilter && status !== 'all') qs.set('status', status);
            if (report.typeFilter && type !== 'all') qs.set('type', type);
            if (report.supportsMonthYear) {
                if (month !== 'all') qs.set('month', month);
                if (year !== 'all') qs.set('year', year);
            }
            const res = await apiClient.get<ReportResult>(`/hr/reports/${report.slug}?${qs.toString()}`);
            if (res.success && res.data) {
                setResult(res.data);
                setPage(1);
            } else {
                throw new Error(res.error || 'Failed to run report');
            }
        } catch (error: any) {
            toast({ title: 'Error', description: error.message || 'Failed to run report.', variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
    }, [report.slug, report.needsRange, report.supportsEmployeeFilter, report.supportsShiftFilter, report.supportsRoleFilter, report.supportsSearch, report.supportsDepartmentFilter, report.statusFilter, report.typeFilter, fromDate, toDate, branchId, employeeId, shiftId, role, search, departmentId, status, type, month, year, report.supportsMonthYear, toast]);

    const fileBase = () => (result ? result.reportName.replace(/\s+/g, '-').toLowerCase() : report.slug);

    const handleExportCsv = () => {
        if (!result) return;
        const csv = toCsv(result);
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${fileBase()}.csv`;
        link.click();
        window.URL.revokeObjectURL(url);
    };

    const handleExportExcel = () => {
        if (!result) return;
        try {
            const ws = XLSX.utils.aoa_to_sheet([result.headers, ...result.rows]);
            ws['!cols'] = result.headers.map((h, i) => ({
                wch: Math.min(40, Math.max(h.length, ...result.rows.map((r) => String(r[i] ?? '').length)) + 2),
            }));
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Report');
            normalizeWorkbookNumbers(wb);
            XLSX.writeFile(wb, `${fileBase()}.xlsx`);
        } catch {
            toast({ title: 'Error', description: 'Could not generate the Excel file.', variant: 'destructive' });
        }
    };

    const handleExportPdf = () => {
        if (!result) return;
        try {
            const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
            doc.setFontSize(13);
            doc.text(result.reportName, 14, 14);
            doc.setFontSize(9);
            doc.text(`${result.totalCount} records`, 14, 20);
            autoTable(doc, {
                head: [result.headers],
                body: result.rows.map((r) => r.map((c) => String(c ?? ''))),
                startY: 24,
                styles: { fontSize: 7, cellPadding: 1.5, overflow: 'linebreak' },
                headStyles: { fillColor: [22, 101, 52], textColor: 255 },
            });
            doc.save(`${fileBase()}.pdf`);
        } catch {
            toast({ title: 'Error', description: 'Could not generate the PDF file.', variant: 'destructive' });
        }
    };

    return (
        <div className="relative min-h-screen">
            <div className="mx-auto max-w-6xl space-y-6">
                <div className="mb-8 flex items-center gap-4 mt-4">
                    <Button variant="ghost" size="icon" onClick={() => router.push('/dashboard/hr/reports')}>
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                    <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary shadow-lg shadow-primary/30">
                        <FileSpreadsheet className="h-7 w-7 text-white" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-foreground dark:text-white">{report.label}</h1>
                        <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">{report.category}</p>
                        {report.note && (
                            <p className="text-xs text-muted-foreground mt-1 max-w-2xl">{report.note}</p>
                        )}
                    </div>
                </div>

                <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                    <CardHeader className="bg-gradient-to-r from-primary via-primary to-purple-600 px-6 py-4">
                        <CardTitle className="text-lg font-semibold text-white">Run Report</CardTitle>
                    </CardHeader>
                    <CardContent className="p-6 space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                            <div className="space-y-2">
                                <Label>Branch</Label>
                                <Select value={branchId} onValueChange={setBranchId}>
                                    <SelectTrigger><SelectValue placeholder="All Branches" /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Branches</SelectItem>
                                        {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                            {report.supportsEmployeeFilter && (
                                <div className="space-y-2">
                                    <Label>Employee</Label>
                                    <Select value={employeeId} onValueChange={setEmployeeId}>
                                        <SelectTrigger><SelectValue placeholder="All Employees" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="all">All Employees</SelectItem>
                                            {employees.map((e) => (
                                                <SelectItem key={e.id} value={e.id}>
                                                    {e.employeeId ? `${e.employeeId} - ` : ''}{e.firstName} {e.lastName}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}
                            {report.supportsShiftFilter && (
                                <div className="space-y-2">
                                    <Label>Shift</Label>
                                    <Select value={shiftId} onValueChange={setShiftId}>
                                        <SelectTrigger><SelectValue placeholder="All Shifts" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="all">All Shifts</SelectItem>
                                            {shifts.map((s) => (
                                                <SelectItem key={s.id} value={s.id}>
                                                    {s.name} ({s.shiftStart} - {s.shiftEnd})
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}
                            {report.supportsRoleFilter && (
                                <div className="space-y-2">
                                    <Label>Role</Label>
                                    <Select value={role} onValueChange={setRole}>
                                        <SelectTrigger><SelectValue placeholder="All Roles" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="all">All Roles</SelectItem>
                                            {ROLE_OPTIONS.map((r) => <SelectItem key={r} value={r}>{r.replace(/_/g, ' ')}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}
                            {report.supportsSearch && (
                                <div className="space-y-2">
                                    <Label>Search</Label>
                                    <Input
                                        value={search}
                                        onChange={(e) => setSearch(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === 'Enter') void handleRun(); }}
                                        placeholder="Number, employee name or ID"
                                    />
                                </div>
                            )}
                            {report.supportsDepartmentFilter && (
                                <div className="space-y-2">
                                    <Label>Department</Label>
                                    <Select value={departmentId} onValueChange={setDepartmentId}>
                                        <SelectTrigger><SelectValue placeholder="All Departments" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="all">All Departments</SelectItem>
                                            {departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}
                            {report.statusFilter && (
                                <div className="space-y-2">
                                    <Label>{report.statusFilter.label}</Label>
                                    <Select value={status} onValueChange={setStatus}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {report.statusFilter.options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}
                            {report.typeFilter && (
                                <div className="space-y-2">
                                    <Label>{report.typeFilter.label}</Label>
                                    <Select value={type} onValueChange={setType}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {report.typeFilter.options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}
                            {report.supportsMonthYear && (
                                <>
                                    <div className="space-y-2">
                                        <Label>Month</Label>
                                        <Select value={month} onValueChange={setMonth}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                {report.slug !== 'leave-balance' && <SelectItem value="all">All months</SelectItem>}
                                                {MONTH_NAMES.map((name, i) => <SelectItem key={name} value={String(i + 1)}>{name}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Year</Label>
                                        <Select value={year} onValueChange={setYear}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                {report.slug !== 'leave-balance' && <SelectItem value="all">All years</SelectItem>}
                                                {Array.from({ length: 6 }, (_, i) => nowIst.getFullYear() - i).map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </>
                            )}
                            {report.needsRange && (
                                <>
                                    <div className="space-y-2">
                                        <Label>From Date</Label>
                                        <DatePickerField value={fromDate} onChange={setFromDate} />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>To Date</Label>
                                        <DatePickerField value={toDate} onChange={setToDate} />
                                    </div>
                                </>
                            )}
                        </div>
                        <div className="flex gap-3">
                            <Button onClick={handleRun} disabled={isLoading} className="bg-primary text-white">
                                {isLoading ? 'Running...' : 'Run Report'}
                            </Button>
                            {result && (
                                <>
                                    <Button variant="outline" onClick={handleExportExcel}>
                                        <FileSpreadsheet className="h-4 w-4 mr-2" />
                                        Export Excel
                                    </Button>
                                    <Button variant="outline" onClick={handleExportPdf}>
                                        <FileText className="h-4 w-4 mr-2" />
                                        Export PDF
                                    </Button>
                                    <Button variant="outline" onClick={handleExportCsv}>
                                        <Download className="h-4 w-4 mr-2" />
                                        Export CSV
                                    </Button>
                                </>
                            )}
                        </div>
                    </CardContent>
                </Card>

                {result?.summary && result.summary.length > 0 && (
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                        {result.summary.map((card) => (
                            <Card key={card.label} className="border-primary/20 bg-white/80 shadow-sm dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                                <CardContent className="p-4">
                                    <div className="text-xs text-muted-foreground">{card.label}</div>
                                    <div className="text-lg font-bold text-foreground dark:text-white mt-1">
                                        {card.money ? formatMoney(card.value) : card.value.toLocaleString('en-IN')}
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                )}

                {result && (
                    <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40 overflow-hidden">
                        <CardHeader className="bg-gradient-to-r from-primary via-primary to-purple-600 px-6 py-4">
                            <CardTitle className="text-base font-semibold text-white flex items-center justify-between">
                                {result.reportName}
                                <span className="text-xs font-normal">{result.totalCount} records</span>
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-0">
                            <div className="overflow-x-auto max-h-[500px]">
                                <Table>
                                    <TableHeader>
                                        <TableRow className="bg-green-50/50 dark:bg-brand-green-darker/50">
                                            {/* Index key — headers can legitimately repeat (Payroll Report has "Month CTC Pay" twice). */}
                                            {result.headers.map((h, i) => <TableHead key={i}>{h}</TableHead>)}
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {result.rows.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan={result.headers.length} className="px-4 py-12 text-center text-slate-500">No records found.</TableCell>
                                            </TableRow>
                                        ) : (
                                            (report.paginated ? result.rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) : result.rows).map((row, i) => (
                                                <TableRow key={i}>
                                                    {row.map((cell, j) => {
                                                        const isMoney = result.moneyColumns?.includes(j) && typeof cell === 'number';
                                                        return (
                                                            <TableCell key={j} className={isMoney ? 'text-sm text-right font-mono whitespace-nowrap' : 'text-sm'}>
                                                                {isMoney ? formatMoney(cell as number) : cell}
                                                            </TableCell>
                                                        );
                                                    })}
                                                </TableRow>
                                            ))
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                            {report.paginated && result.rows.length > PAGE_SIZE && (
                                <div className="flex items-center justify-between gap-3 border-t px-4 py-3 text-sm">
                                    <span className="text-muted-foreground">
                                        Showing {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, result.rows.length)} of {result.rows.length}
                                    </span>
                                    <div className="flex items-center gap-2">
                                        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                                            <ChevronLeft className="h-4 w-4" />
                                        </Button>
                                        <span>Page {page} of {Math.ceil(result.rows.length / PAGE_SIZE)}</span>
                                        <Button variant="outline" size="sm" disabled={page >= Math.ceil(result.rows.length / PAGE_SIZE)} onClick={() => setPage((p) => p + 1)}>
                                            <ChevronRight className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                )}
            </div>
        </div>
    );
}
