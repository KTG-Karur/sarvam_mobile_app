'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Download, Eye, FileSpreadsheet, FileText, Info, Loader2, RotateCcw, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { apiClient } from '@/app/lib/api-client';
import type { ScheduleDetail, ScheduleKind, ScheduleList, ScheduleListItem, ScheduleRowView } from '@/app/lib/staff-reports/schedule-types';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { normalizeWorkbookNumbers } from '@/app/lib/reports/excel-report-header';

const PAGE_SIZE = 25;

const COPY: Record<ScheduleKind, { title: string; subtitle: string; noun: string; numberLabel: string; api: string; statusOptions: { value: string; label: string }[] }> = {
    LOAN: {
        title: 'Staff Loan Schedule', subtitle: 'View the repayment schedule of staff loans', noun: 'loan', numberLabel: 'Loan No', api: '/hr/reports/staff-loan-schedule',
        statusOptions: [{ value: 'all', label: 'All' }, { value: 'ACTIVE', label: 'Active' }, { value: 'CLOSED', label: 'Closed / Settled' }],
    },
    ADVANCE: {
        title: 'Staff Advance Schedule', subtitle: 'View the repayment schedule of staff advances', noun: 'advance', numberLabel: 'Advance No', api: '/hr/reports/staff-advance-schedule',
        statusOptions: [{ value: 'all', label: 'All' }, { value: 'ACTIVE', label: 'Active' }, { value: 'COMPLETED', label: 'Completed / Settled' }],
    },
};

const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(value);

const statusBadge = (status: ScheduleRowView['status']) => {
    switch (status) {
        case 'PAID': return <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white">PAID</Badge>;
        case 'SETTLED': return <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white">SETTLED</Badge>;
        case 'PARTIAL': return <Badge className="bg-amber-500 hover:bg-amber-500 text-white">PARTIAL</Badge>;
        case 'OVERDUE': return <Badge variant="destructive">OVERDUE</Badge>;
        default: return <Badge variant="outline" className="text-muted-foreground">PENDING</Badge>;
    }
};

type Option = { id: string; name: string };
type EmployeeOption = { id: string; employeeId: string | null; firstName: string; lastName: string };

export function StaffScheduleReport({ kind }: { kind: ScheduleKind }) {
    const copy = COPY[kind];
    const isLoan = kind === 'LOAN';
    const router = useRouter();
    const { toast } = useToast();

    const [branches, setBranches] = useState<Option[]>([]);
    const [departments, setDepartments] = useState<Option[]>([]);
    const [employees, setEmployees] = useState<EmployeeOption[]>([]);
    const [branchId, setBranchId] = useState('all');
    const [departmentId, setDepartmentId] = useState('all');
    const [employeeId, setEmployeeId] = useState('all');
    const [status, setStatus] = useState('all');
    const [search, setSearch] = useState('');

    const [loading, setLoading] = useState(false);
    const [list, setList] = useState<ScheduleList | null>(null);
    const [page, setPage] = useState(1);

    const [loadingId, setLoadingId] = useState<string | null>(null);
    const [detail, setDetail] = useState<ScheduleDetail | null>(null);

    useEffect(() => {
        apiClient.get<Option[]>('/branches?permitted=true').then(res => { if (res.success && res.data) setBranches(res.data); });
        apiClient.get<Option[]>('/hr/departments').then(res => { if (res.success && res.data) setDepartments(res.data); });
    }, []);

    // The employee list follows the chosen branch.
    useEffect(() => {
        apiClient.get<EmployeeOption[]>(`/hr/employees?status=active${branchId !== 'all' ? `&branchId=${branchId}` : ''}`)
            .then(res => { if (res.success && res.data) setEmployees(res.data); });
    }, [branchId]);

    const generate = useCallback(async () => {
        setLoading(true);
        const query = new URLSearchParams();
        if (branchId !== 'all') query.set('branchId', branchId);
        if (departmentId !== 'all') query.set('departmentId', departmentId);
        if (employeeId !== 'all') query.set('employeeId', employeeId);
        if (status !== 'all') query.set('status', status);
        if (search.trim()) query.set('search', search.trim());
        const res = await apiClient.get<ScheduleList>(`${copy.api}?${query.toString()}`);
        if (res.success && res.data) {
            setList(res.data);
            setPage(1);
        } else {
            toast({ title: 'Error', description: res.error || 'Failed to load the report.', variant: 'destructive' });
        }
        setLoading(false);
    }, [branchId, departmentId, employeeId, status, search, copy.api, toast]);

    const reset = () => {
        setBranchId('all'); setDepartmentId('all'); setEmployeeId('all'); setStatus('all'); setSearch('');
        setList(null);
    };

    const viewSchedule = async (item: ScheduleListItem) => {
        setLoadingId(item.id);
        const res = await apiClient.get<ScheduleDetail>(`${copy.api}?id=${encodeURIComponent(item.id)}`);
        if (res.success && res.data) setDetail(res.data);
        else toast({ title: 'Error', description: res.error || 'Failed to load the schedule.', variant: 'destructive' });
        setLoadingId(null);
    };

    // ── exports of the open schedule ──────────────────────────────────────

    const tableFor = (d: ScheduleDetail) => {
        const headers = ['#', 'Month', 'Principal', ...(d.kind === 'LOAN' ? ['Interest'] : []), 'Total Due', 'Paid', 'Outstanding', 'Status'];
        const rows = d.schedule.map(r => [r.installmentNo, r.month, r.principal, ...(d.kind === 'LOAN' ? [r.interest] : []), r.totalDue, r.paid, r.outstanding, r.status]);
        const info = [
            [`${copy.title}`], [`${copy.numberLabel}`, d.number], ['Employee', `${d.employee.name} (${d.employee.code})`],
            ['Department', d.employee.department], ['Branch', d.employee.branch], [d.kind === 'LOAN' ? 'Loan Amount' : 'Advance Amount', d.amount],
            ['Status', d.status],
        ];
        return { headers, rows, info };
    };

    const exportExcel = (d: ScheduleDetail) => {
        const { headers, rows, info } = tableFor(d);
        const ws = XLSX.utils.aoa_to_sheet([...info, [], headers, ...rows]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Schedule');
        normalizeWorkbookNumbers(wb);
        XLSX.writeFile(wb, `${copy.noun}-schedule-${d.number}.xlsx`);
    };

    const exportCsv = (d: ScheduleDetail) => {
        const { headers, rows, info } = tableFor(d);
        const cell = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
        const csv = [...info, [], headers, ...rows].map(r => r.map(cell).join(',')).join('\n');
        const url = window.URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `${copy.noun}-schedule-${d.number}.csv`;
        link.click();
        window.URL.revokeObjectURL(url);
    };

    const exportPdf = (d: ScheduleDetail) => {
        const { headers, rows } = tableFor(d);
        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        doc.setFontSize(14);
        doc.text(copy.title, 14, 16);
        doc.setFontSize(9);
        doc.text(`${copy.numberLabel}: ${d.number}    Status: ${d.status}`, 14, 23);
        doc.text(`Employee: ${d.employee.name} (${d.employee.code})    Department: ${d.employee.department}    Branch: ${d.employee.branch}`, 14, 28);
        doc.text(`${d.kind === 'LOAN' ? 'Loan' : 'Advance'} Amount: ${money(d.amount)}${d.interestLabel ? `    Interest: ${d.interestLabel}` : ''}    Tenure: ${d.tenureMonths} months`, 14, 33);
        autoTable(doc, {
            head: [headers], body: rows.map(r => r.map(String)), startY: 38,
            styles: { fontSize: 8, cellPadding: 1.5 }, headStyles: { fillColor: [22, 101, 52], textColor: 255 },
        });
        doc.save(`${copy.noun}-schedule-${d.number}.pdf`);
    };

    // ── render ────────────────────────────────────────────────────────────

    const items = list?.items ?? [];
    const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    const visible = items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    return (
        <div className="mx-auto max-w-6xl space-y-6">
            <div className="flex items-center gap-4 mt-4">
                <Button variant="ghost" size="icon" onClick={() => router.push('/dashboard/hr/reports')}><ArrowLeft className="h-5 w-5" /></Button>
                <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary shadow-lg shadow-primary/30">
                    <FileText className="h-7 w-7 text-white" />
                </div>
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-foreground dark:text-white">{copy.title}</h1>
                    <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">{copy.subtitle}. Installments are shown by month.</p>
                </div>
            </div>

            <Card className="border-2 border-primary/20 shadow-lg bg-card">
                <CardHeader className="border-b">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10"><Search className="h-5 w-5 text-primary" /></div>
                        <div>
                            <CardTitle className="text-lg font-semibold">Report Filters</CardTitle>
                            <CardDescription>Select criteria to list the staff {copy.noun}s</CardDescription>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="pt-6 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-2">
                            <Label>Branch</Label>
                            <Select value={branchId} onValueChange={value => { setBranchId(value); setEmployeeId('all'); }}>
                                <SelectTrigger><SelectValue placeholder="All Branches" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Branches</SelectItem>
                                    {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Department</Label>
                            <Select value={departmentId} onValueChange={setDepartmentId}>
                                <SelectTrigger><SelectValue placeholder="All Departments" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Departments</SelectItem>
                                    {departments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Employee</Label>
                            <Select value={employeeId} onValueChange={setEmployeeId}>
                                <SelectTrigger><SelectValue placeholder="All Employees" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Employees</SelectItem>
                                    {employees.map(e => <SelectItem key={e.id} value={e.id}>{e.employeeId ? `${e.employeeId} - ` : ''}{e.firstName} {e.lastName}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>{isLoan ? 'Loan Status' : 'Advance Status'}</Label>
                            <Select value={status} onValueChange={setStatus}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>{copy.statusOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2 md:col-span-2">
                            <Label>Search</Label>
                            <Input
                                value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void generate(); }}
                                placeholder={`${copy.numberLabel}, employee name or ID`}
                            />
                        </div>
                    </div>
                    <div className="flex gap-3">
                        <Button onClick={generate} disabled={loading} className="bg-primary text-white">
                            {loading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Loading...</> : <><Search className="h-4 w-4 mr-2" />Generate Report</>}
                        </Button>
                        <Button variant="outline" onClick={reset}><RotateCcw className="h-4 w-4" /></Button>
                    </div>
                </CardContent>
            </Card>

            {list && (
                <>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        {list.summary.map(card => (
                            <Card key={card.label} className="border-primary/20 bg-white/80 shadow-sm dark:bg-brand-green-darker/40">
                                <CardContent className="p-4">
                                    <div className="text-xs text-muted-foreground">{card.label}</div>
                                    <div className="text-lg font-bold text-foreground dark:text-white mt-1">{card.money ? money(card.value) : card.value.toLocaleString('en-IN')}</div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>

                    <Card className="border-2 border-primary/20 shadow-lg overflow-hidden">
                        <CardHeader className="border-b">
                            <CardTitle className="text-lg">Staff {isLoan ? 'Loan' : 'Advance'} List</CardTitle>
                            <CardDescription>Found {items.length} {copy.noun}{items.length === 1 ? '' : 's'}</CardDescription>
                        </CardHeader>
                        <CardContent className="p-0">
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow className="hover:bg-transparent">
                                            <TableHead>#</TableHead>
                                            <TableHead>Employee</TableHead>
                                            <TableHead>{copy.numberLabel}</TableHead>
                                            <TableHead>Department</TableHead>
                                            <TableHead>Branch</TableHead>
                                            <TableHead className="text-right">{isLoan ? 'Loan Amount' : 'Advance Amount'}</TableHead>
                                            <TableHead>Status</TableHead>
                                            <TableHead className="text-center">Action</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {visible.length === 0 ? (
                                            <TableRow><TableCell colSpan={8} className="py-10 text-center text-muted-foreground">No {copy.noun}s found.</TableCell></TableRow>
                                        ) : visible.map((item, index) => (
                                            <TableRow key={item.id} className="hover:bg-green-50 dark:hover:bg-brand-green-darker/50 transition-colors">
                                                <TableCell className="w-[50px] text-muted-foreground">{(page - 1) * PAGE_SIZE + index + 1}</TableCell>
                                                <TableCell>
                                                    <div className="font-medium text-foreground dark:text-slate-100">{item.employeeName}</div>
                                                    <div className="text-xs text-muted-foreground">{item.employeeCode}</div>
                                                </TableCell>
                                                <TableCell className="font-mono text-sm">{item.number}</TableCell>
                                                <TableCell>{item.department}</TableCell>
                                                <TableCell>{item.branch}</TableCell>
                                                <TableCell className="text-right font-semibold">{money(item.amount)}</TableCell>
                                                <TableCell><Badge variant={item.status === 'ACTIVE' ? 'default' : 'secondary'}>{item.status}</Badge></TableCell>
                                                <TableCell className="text-center">
                                                    <Button
                                                        size="sm" variant="secondary" disabled={loadingId !== null} onClick={() => viewSchedule(item)}
                                                        className="h-8 px-3 bg-primary/10 text-primary hover:bg-primary/20"
                                                    >
                                                        {loadingId === item.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Eye className="h-3.5 w-3.5 mr-1.5" />View Schedule</>}
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                            {items.length > PAGE_SIZE && (
                                <div className="flex items-center justify-between gap-3 border-t px-4 py-3 text-sm">
                                    <span className="text-muted-foreground">Showing {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, items.length)} of {items.length}</span>
                                    <div className="flex items-center gap-2">
                                        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
                                        <span>Page {page} of {pages}</span>
                                        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(p => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </>
            )}

            <Dialog open={detail !== null} onOpenChange={open => { if (!open) setDetail(null); }}>
                <DialogContent className="w-[96vw] max-w-[96vw] sm:max-w-[96vw] lg:max-w-6xl xl:max-w-7xl h-[92vh] max-h-[92vh] flex flex-col p-0 gap-0">
                    <DialogHeader className="p-6 pb-4 border-b">
                        <DialogTitle className="text-xl flex items-center gap-2 text-primary"><FileText className="h-6 w-6" />Repayment Schedule</DialogTitle>
                        <DialogDescription>Installments by month{isLoan ? ', with principal and interest' : ' (a staff advance carries no interest)'}.</DialogDescription>
                    </DialogHeader>
                    {detail && (
                        <>
                            <div className="p-6 bg-green-50 dark:bg-brand-green-darker/50 border-b">
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-base">
                                    <div className="space-y-1">
                                        <p className="text-muted-foreground text-xs uppercase tracking-wider font-semibold">Employee</p>
                                        <p className="font-medium text-base truncate" title={detail.employee.name}>{detail.employee.name}</p>
                                        <p className="text-xs text-muted-foreground">{detail.employee.code} • {detail.employee.designation}</p>
                                    </div>
                                    <div className="space-y-1">
                                        <p className="text-muted-foreground text-xs uppercase tracking-wider font-semibold">{isLoan ? 'Loan Details' : 'Advance Details'}</p>
                                        <p className="font-medium text-base">{detail.number}</p>
                                        <p className="text-xs text-muted-foreground">{detail.status}</p>
                                    </div>
                                    <div className="space-y-1">
                                        <p className="text-muted-foreground text-xs uppercase tracking-wider font-semibold">Financials</p>
                                        <p className="font-medium text-base text-green-600 dark:text-green-400">{money(detail.amount)}</p>
                                        <p className="text-xs text-muted-foreground">{detail.interestLabel ? `${detail.interestLabel} | ` : ''}{detail.tenureMonths} Mths</p>
                                    </div>
                                    <div className="space-y-1">
                                        <p className="text-muted-foreground text-xs uppercase tracking-wider font-semibold">Department</p>
                                        <p className="font-medium text-base">{detail.employee.department || '—'}</p>
                                        <p className="text-xs text-muted-foreground">{detail.employee.branch}</p>
                                    </div>
                                </div>
                            </div>
                            <div className="flex-1 overflow-y-auto p-0">
                                <Table className="text-base [&_th]:h-14 [&_td]:py-4">
                                    <TableHeader className="sticky top-0 bg-white dark:bg-green-950 shadow-sm z-10">
                                        <TableRow>
                                            <TableHead className="w-[80px] text-center">#</TableHead>
                                            <TableHead>Month</TableHead>
                                            <TableHead className="text-right">Principal</TableHead>
                                            {isLoan && <TableHead className="text-right">Interest</TableHead>}
                                            <TableHead className="text-right font-bold">Total Due</TableHead>
                                            <TableHead className="text-right">Paid</TableHead>
                                            <TableHead className="text-right">Outstanding</TableHead>
                                            <TableHead className="text-center">Status</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {detail.schedule.map(row => (
                                            <TableRow key={row.installmentNo} className="even:bg-green-50/50 dark:even:bg-brand-green-darker/30">
                                                <TableCell className="text-center font-medium text-muted-foreground">{row.installmentNo}</TableCell>
                                                <TableCell className="font-medium">{row.month}</TableCell>
                                                <TableCell className="text-right">{money(row.principal)}</TableCell>
                                                {isLoan && <TableCell className="text-right">{money(row.interest)}</TableCell>}
                                                <TableCell className="text-right font-bold">{money(row.totalDue)}</TableCell>
                                                <TableCell className="text-right text-emerald-600">{money(row.paid)}</TableCell>
                                                <TableCell className="text-right font-semibold">{money(row.outstanding)}</TableCell>
                                                <TableCell className="text-center">{statusBadge(row.status)}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                            <DialogFooter className="p-4 border-t bg-green-50 dark:bg-brand-green-darker/50 sm:justify-between items-center">
                                <div className="text-sm text-muted-foreground flex items-center gap-2">
                                    <Info className="h-4 w-4" /><span>Total: {detail.schedule.length} Installments</span>
                                </div>
                                <div className="flex gap-2">
                                    <Button variant="outline" onClick={() => setDetail(null)}>Close</Button>
                                    <Button variant="outline" onClick={() => exportExcel(detail)}><FileSpreadsheet className="h-4 w-4 mr-2" />Excel</Button>
                                    <Button variant="outline" onClick={() => exportPdf(detail)}><FileText className="h-4 w-4 mr-2" />PDF</Button>
                                    <Button variant="outline" onClick={() => exportCsv(detail)}><Download className="h-4 w-4 mr-2" />CSV</Button>
                                </div>
                            </DialogFooter>
                        </>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
