'use client';

import React, { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx-js-style';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DateInput } from '@/components/ui/date-input';
import { LiveUsagePanel } from '@/components/reports/LiveUsagePanel';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { toDisplayDate, toDisplayDateTime } from '@/app/lib/date-format';
import { buildReportSheet, autoSizeColumns, applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { cn } from '@/lib/utils';
import { Activity, Globe, Loader2, Smartphone, UserCheck, UserX, Users, Layers, LogIn } from 'lucide-react';
import type {
    LoginActivityReport,
    LoginActivityUserRow,
} from '@/app/api/reports/others/user-login-activity/route';

type GroupBy = 'DAY' | 'MONTH' | 'YEAR' | 'LIVE';
type StatusFilter = 'ALL' | 'USED' | 'BOTH' | 'WEB' | 'MOBILE' | 'NOT_USED';
type Branch = { id: string; name: string; code: string };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const STATUS_LABEL: Record<LoginActivityUserRow['status'], string> = {
    BOTH: 'Web + Mobile',
    WEB: 'Web only',
    MOBILE: 'Mobile only',
    NOT_USED: 'Not used',
};

/** Today's IST calendar date as YYYY-MM-DD (business dates are always IST). */
function todayIst(): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/** Default range for a grouping, ending today (IST). */
function defaultRange(groupBy: GroupBy): { from: string; to: string } {
    const today = todayIst();
    if (groupBy === 'DAY') return { from: today, to: today };
    if (groupBy === 'MONTH') return { from: `${today.slice(0, 7)}-01`, to: today };
    return { from: `${today.slice(0, 4)}-01-01`, to: today };
}

function periodLabel(period: string, groupBy: GroupBy): string {
    if (groupBy === 'DAY') return toDisplayDate(`${period}T00:00:00`);
    if (groupBy === 'MONTH') return `${MONTHS[Number(period.slice(5, 7)) - 1]} ${period.slice(0, 4)}`;
    return period;
}

const dt = (v: string | null) => (v ? toDisplayDateTime(v) : '-');

export function UserLoginActivityReport() {
    const { toast } = useToast();
    const [groupBy, setGroupBy] = useState<GroupBy>('DAY');
    const [fromDate, setFromDate] = useState(defaultRange('DAY').from);
    const [toDate, setToDate] = useState(defaultRange('DAY').to);
    const [branchId, setBranchId] = useState('ALL');
    const [branches, setBranches] = useState<Branch[]>([]);
    const [report, setReport] = useState<LoginActivityReport | null>(null);
    const [submitted, setSubmitted] = useState<{ groupBy: GroupBy; fromDate: string; toDate: string; branchLabel: string } | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
    const [search, setSearch] = useState('');

    useEffect(() => {
        (async () => {
            const res = await apiClient.get<Branch[]>('/branches?includeInactive=false');
            if (res.success && Array.isArray(res.data)) setBranches(res.data);
        })();
    }, []);

    const changeGroupBy = (value: GroupBy) => {
        setGroupBy(value);
        if (value === 'LIVE') return; // live view needs no date range
        const r = defaultRange(value);
        setFromDate(r.from);
        setToDate(r.to);
    };

    const generate = async () => {
        if (groupBy === 'LIVE') return;
        if (!fromDate || !toDate) {
            toast({ title: 'Select dates', description: 'From Date and To Date are required.', variant: 'destructive' });
            return;
        }
        if (fromDate > toDate) {
            toast({ title: 'Invalid range', description: 'From Date cannot be after To Date.', variant: 'destructive' });
            return;
        }
        setIsLoading(true);
        try {
            const params = new URLSearchParams({ fromDate, toDate, groupBy, branchId });
            const res = await apiClient.get<LoginActivityReport>(`/reports/others/user-login-activity?${params.toString()}`);
            if (res.success && res.data) {
                setReport(res.data);
                const b = branches.find((x) => x.id === branchId);
                setSubmitted({ groupBy, fromDate, toDate, branchLabel: b ? `${b.code} - ${b.name}` : 'All Branches' });
            } else {
                toast({ title: 'Error', description: res.error || 'Failed to load report.', variant: 'destructive' });
            }
        } finally {
            setIsLoading(false);
        }
    };

    const filteredUsers = useMemo(() => {
        if (!report) return [];
        const term = search.trim().toLowerCase();
        return report.users.filter((u) => {
            if (statusFilter === 'USED' && u.status === 'NOT_USED') return false;
            if (statusFilter !== 'ALL' && statusFilter !== 'USED' && u.status !== statusFilter) return false;
            if (!term) return true;
            return [u.employeeId, u.name, u.role, u.branchName].some((v) => (v ?? '').toLowerCase().includes(term));
        });
    }, [report, statusFilter, search]);

    // ── Export ──────────────────────────────────────────────────────────────────
    const periodExportRows = () =>
        (report?.periods ?? []).map((p, i) => ({
            'S.No.': i + 1,
            [submitted?.groupBy === 'DAY' ? 'Date' : submitted?.groupBy === 'MONTH' ? 'Month' : 'Year']: periodLabel(p.period, submitted?.groupBy ?? 'DAY'),
            'Web Users': p.webUsers,
            'Mobile Users': p.mobileUsers,
            'Both (Web + Mobile)': p.bothUsers,
            'Total Users': p.totalUsers,
            'Web Logins': p.webLogins,
            'Mobile Logins': p.mobileLogins,
        }));

    const userExportRows = () =>
        filteredUsers.map((u, i) => ({
            'S.No.': i + 1,
            'Emp ID': u.employeeId ?? '-',
            Name: u.name,
            Role: u.role,
            Branch: u.branchName,
            'Employee Status': u.isActive ? 'Active' : 'Inactive',
            Usage: STATUS_LABEL[u.status],
            'Web Days Used': u.webDays,
            'Mobile Days Used': u.mobileDays,
            'Web Logins': u.webLogins,
            'Mobile Logins': u.mobileLogins,
            'First Seen': dt(u.firstSeenAt),
            'Last Web Use': dt(u.lastWebAt),
            'Last Mobile Use': dt(u.lastMobileAt),
            'Last Device': u.lastDevice ?? '-',
            'Last IP': u.lastIp ?? '-',
        }));

    const fileStem = () =>
        submitted ? `User-Login-Activity_${submitted.fromDate}_to_${submitted.toDate}` : 'User-Login-Activity';

    const handleExportExcel = () => {
        if (!report || !submitted) return;
        const subtitle = `${submitted.branchLabel} | ${toDisplayDate(`${submitted.fromDate}T00:00:00`)} to ${toDisplayDate(`${submitted.toDate}T00:00:00`)}`;
        const wb = XLSX.utils.book_new();
        const summary = buildReportSheet(`User Login Activity — Summary (${subtitle})`, periodExportRows());
        autoSizeColumns(summary);
        applyExcelReportFont(summary);
        XLSX.utils.book_append_sheet(wb, summary, 'Summary');
        const details = buildReportSheet(`User Login Activity — User Details (${subtitle})`, userExportRows());
        autoSizeColumns(details);
        applyExcelReportFont(details);
        XLSX.utils.book_append_sheet(wb, details, 'User Details');
        XLSX.writeFile(wb, `${fileStem()}.xlsx`);
        toast({ title: 'Excel Exported', description: 'File downloaded successfully.' });
    };

    const handleExportCSV = () => {
        if (!report) return;
        const toCsv = (rows: Record<string, string | number>[]) => {
            if (rows.length === 0) return '';
            const headers = Object.keys(rows[0]);
            const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
            return [headers.map(esc).join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))].join('\n');
        };
        const csv = `SUMMARY\n${toCsv(periodExportRows())}\n\nUSER DETAILS\n${toCsv(userExportRows())}`;
        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${fileStem()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        toast({ title: 'CSV Exported', description: 'File downloaded successfully.' });
    };

    const s = report?.summary;
    const cards = s
        ? [
              { label: 'Total Employees', value: s.totalEmployees, icon: Users, tone: 'text-slate-700 dark:text-slate-200' },
              { label: 'Using Software', value: s.activeUsers, icon: UserCheck, tone: 'text-emerald-700 dark:text-emerald-400' },
              { label: 'Web Users', value: s.webUsers, icon: Globe, tone: 'text-sky-700 dark:text-sky-400' },
              { label: 'Mobile Users', value: s.mobileUsers, icon: Smartphone, tone: 'text-violet-700 dark:text-violet-400' },
              { label: 'Both Web + Mobile', value: s.bothUsers, icon: Layers, tone: 'text-teal-700 dark:text-teal-400' },
              { label: 'Not Used', value: s.notUsed, icon: UserX, tone: 'text-rose-700 dark:text-rose-400' },
              { label: 'Web Logins', value: s.webLogins, icon: LogIn, tone: 'text-sky-700 dark:text-sky-400' },
              { label: 'Mobile Logins', value: s.mobileLogins, icon: LogIn, tone: 'text-violet-700 dark:text-violet-400' },
          ]
        : [];

    return (
        <div className="space-y-6">
            <ReportHeader title="User Login Activity" subtitle="Who is using the software on Web and Mobile — by day, month or year" />

            <Card className="border-primary/20 shadow-md">
                <CardHeader>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <CardTitle className="text-xl flex items-center gap-2">
                                <Activity className="h-5 w-5 text-primary" /> Report Parameters
                            </CardTitle>
                            <CardDescription>A user counts as using the software on a day if they logged in or worked in it that day.</CardDescription>
                        </div>
                        {report && (
                            <ExportDropdown hidePdf onExportExcel={handleExportExcel} onExportCSV={handleExportCSV} />
                        )}
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
                        <div className="space-y-1.5">
                            <Label>Group By</Label>
                            <Select value={groupBy} onValueChange={(v) => changeGroupBy(v as GroupBy)}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="DAY">Day-wise</SelectItem>
                                    <SelectItem value="MONTH">Month-wise</SelectItem>
                                    <SelectItem value="YEAR">Year-wise</SelectItem>
                                    <SelectItem value="LIVE">Current (Live)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className={cn('space-y-1.5', groupBy === 'LIVE' && 'hidden')}>
                            <Label>From Date</Label>
                            <DateInput value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
                        </div>
                        <div className={cn('space-y-1.5', groupBy === 'LIVE' && 'hidden')}>
                            <Label>To Date</Label>
                            <DateInput value={toDate} onChange={(e) => setToDate(e.target.value)} />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Branch</Label>
                            <Select value={branchId} onValueChange={setBranchId}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="ALL">All Branches</SelectItem>
                                    {branches.map((b) => (
                                        <SelectItem key={b.id} value={b.id}>{b.code} - {b.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className={cn('flex items-end', groupBy === 'LIVE' && 'hidden')}>
                            <Button className="w-full" onClick={generate} disabled={isLoading}>
                                {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                Generate Report
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {groupBy === 'LIVE' && <LiveUsagePanel branchId={branchId} />}

            {groupBy !== 'LIVE' && report && submitted && (
                <>
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                        {cards.map((c) => (
                            <Card key={c.label} className="border-primary/10">
                                <CardContent className="flex items-center justify-between p-4">
                                    <div>
                                        <p className="text-xs font-medium text-muted-foreground">{c.label}</p>
                                        <p className={cn('text-2xl font-bold tabular-nums', c.tone)}>{c.value.toLocaleString('en-IN')}</p>
                                    </div>
                                    <c.icon className={cn('h-6 w-6 opacity-70', c.tone)} />
                                </CardContent>
                            </Card>
                        ))}
                    </div>

                    <Card className="border-primary/20 shadow-md">
                        <CardContent className="pt-6">
                            <Tabs defaultValue="summary">
                                <TabsList>
                                    <TabsTrigger value="summary">
                                        {submitted.groupBy === 'DAY' ? 'Day-wise' : submitted.groupBy === 'MONTH' ? 'Month-wise' : 'Year-wise'} Summary
                                    </TabsTrigger>
                                    <TabsTrigger value="users">User Details ({report.users.length})</TabsTrigger>
                                </TabsList>

                                <TabsContent value="summary" className="mt-4">
                                    {report.periods.length === 0 ? (
                                        <p className="py-10 text-center text-sm text-muted-foreground">No usage recorded in this period.</p>
                                    ) : (
                                        <div className="overflow-x-auto rounded-md border">
                                            <Table>
                                                <TableHeader>
                                                    <TableRow>
                                                        <TableHead className="w-16">S.No</TableHead>
                                                        <TableHead>{submitted.groupBy === 'DAY' ? 'Date' : submitted.groupBy === 'MONTH' ? 'Month' : 'Year'}</TableHead>
                                                        <TableHead className="text-right">Web Users</TableHead>
                                                        <TableHead className="text-right">Mobile Users</TableHead>
                                                        <TableHead className="text-right">Both</TableHead>
                                                        <TableHead className="text-right">Total Users</TableHead>
                                                        <TableHead className="text-right">Web Logins</TableHead>
                                                        <TableHead className="text-right">Mobile Logins</TableHead>
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {report.periods.map((p, i) => (
                                                        <TableRow key={p.period}>
                                                            <TableCell>{i + 1}</TableCell>
                                                            <TableCell className="whitespace-nowrap font-medium">{periodLabel(p.period, submitted.groupBy)}</TableCell>
                                                            <TableCell className="text-right tabular-nums">{p.webUsers}</TableCell>
                                                            <TableCell className="text-right tabular-nums">{p.mobileUsers}</TableCell>
                                                            <TableCell className="text-right tabular-nums">{p.bothUsers}</TableCell>
                                                            <TableCell className="text-right font-semibold tabular-nums">{p.totalUsers}</TableCell>
                                                            <TableCell className="text-right tabular-nums">{p.webLogins}</TableCell>
                                                            <TableCell className="text-right tabular-nums">{p.mobileLogins}</TableCell>
                                                        </TableRow>
                                                    ))}
                                                </TableBody>
                                            </Table>
                                        </div>
                                    )}
                                </TabsContent>

                                <TabsContent value="users" className="mt-4 space-y-3">
                                    <div className="flex flex-col gap-3 sm:flex-row">
                                        <Input
                                            placeholder="Search Emp ID, name, role, branch…"
                                            value={search}
                                            onChange={(e) => setSearch(e.target.value)}
                                            className="sm:max-w-xs"
                                        />
                                        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
                                            <SelectTrigger className="sm:w-56"><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="ALL">All employees</SelectItem>
                                                <SelectItem value="USED">Used the software</SelectItem>
                                                <SelectItem value="BOTH">Web + Mobile</SelectItem>
                                                <SelectItem value="WEB">Web only</SelectItem>
                                                <SelectItem value="MOBILE">Mobile only</SelectItem>
                                                <SelectItem value="NOT_USED">Not used</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <span className="self-center text-xs text-muted-foreground">{filteredUsers.length} shown — export follows this filter</span>
                                    </div>
                                    <div className="overflow-x-auto rounded-md border">
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead className="w-14">S.No</TableHead>
                                                    <TableHead>Emp ID</TableHead>
                                                    <TableHead>Name</TableHead>
                                                    <TableHead>Role</TableHead>
                                                    <TableHead>Branch</TableHead>
                                                    <TableHead>Usage</TableHead>
                                                    <TableHead className="text-right">Web Days</TableHead>
                                                    <TableHead className="text-right">Mobile Days</TableHead>
                                                    <TableHead className="text-right">Web Logins</TableHead>
                                                    <TableHead className="text-right">Mobile Logins</TableHead>
                                                    <TableHead>Last Web Use</TableHead>
                                                    <TableHead>Last Mobile Use</TableHead>
                                                    <TableHead>Last Device</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {filteredUsers.map((u, i) => (
                                                    <TableRow key={u.userId} className={cn(!u.isActive && 'opacity-60')}>
                                                        <TableCell>{i + 1}</TableCell>
                                                        <TableCell className="whitespace-nowrap font-medium">{u.employeeId ?? '-'}</TableCell>
                                                        <TableCell className="whitespace-nowrap">{u.name}{!u.isActive && ' (Inactive)'}</TableCell>
                                                        <TableCell className="whitespace-nowrap text-xs">{u.role}</TableCell>
                                                        <TableCell className="whitespace-nowrap text-xs">{u.branchName}</TableCell>
                                                        <TableCell>
                                                            <Badge
                                                                variant="outline"
                                                                className={cn(
                                                                    'whitespace-nowrap',
                                                                    u.status === 'BOTH' && 'border-teal-200 bg-teal-50 text-teal-700 dark:bg-teal-500/10 dark:text-teal-400',
                                                                    u.status === 'WEB' && 'border-sky-200 bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-400',
                                                                    u.status === 'MOBILE' && 'border-violet-200 bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-400',
                                                                    u.status === 'NOT_USED' && 'border-rose-200 bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400'
                                                                )}
                                                            >
                                                                {STATUS_LABEL[u.status]}
                                                            </Badge>
                                                        </TableCell>
                                                        <TableCell className="text-right tabular-nums">{u.webDays}</TableCell>
                                                        <TableCell className="text-right tabular-nums">{u.mobileDays}</TableCell>
                                                        <TableCell className="text-right tabular-nums">{u.webLogins}</TableCell>
                                                        <TableCell className="text-right tabular-nums">{u.mobileLogins}</TableCell>
                                                        <TableCell className="whitespace-nowrap text-xs">{dt(u.lastWebAt)}</TableCell>
                                                        <TableCell className="whitespace-nowrap text-xs">{dt(u.lastMobileAt)}</TableCell>
                                                        <TableCell className="max-w-[220px] truncate text-xs" title={u.lastDevice ?? undefined}>{u.lastDevice ?? '-'}</TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </div>
                                </TabsContent>
                            </Tabs>
                        </CardContent>
                    </Card>
                </>
            )}
        </div>
    );
}
