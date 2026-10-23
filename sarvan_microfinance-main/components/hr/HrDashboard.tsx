'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import {
    Users2, UserCheck, UserX, UserPlus, BadgeCheck, TrendingUp, ArrowRightLeft, LogOut,
    CalendarRange, CheckCircle2, XCircle, Radio, ListChecks, type LucideIcon,
} from 'lucide-react';
import { apiClient } from '@/app/lib/api-client';
import { PageLoader } from '@/components/ui/page-loader';
import { toDisplayDate } from '@/app/lib/date-format';

type Kpis = {
    totalEmployees: number;
    activeEmployees: number;
    inactiveEmployees: number;
    newJoiningsThisMonth: number;
    pendingConfirmation: number;
    pendingPromotion: number;
    pendingTransfer: number;
    pendingExit: number;
    employeesOnLeaveToday: number;
    todayPresent: number;
    todayAbsent: number;
    employeesCurrentlyActive: number;
};

type NamedCount = { name: string; count: number };
type TrendPoint = { date?: string; month?: string; present?: number; absent?: number; count?: number };

type Charts = {
    byDepartment: NamedCount[];
    byDesignation: NamedCount[];
    byBranch: NamedCount[];
    attendanceTrend: TrendPoint[];
    joiningTrend: TrendPoint[];
    leaveTrend: TrendPoint[];
};

type PendingItem = { type: string; id: string; label: string; at: string };

function KpiTile({ icon: Icon, label, value, tone = 'primary' }: { icon: LucideIcon; label: string; value: number; tone?: 'primary' | 'good' | 'critical' | 'muted' }) {
    const toneClasses: Record<string, string> = {
        primary: 'text-primary',
        good: 'text-[#0ca30c]',
        critical: 'text-[#d03b3b]',
        muted: 'text-slate-500',
    };
    return (
        <Card className="border-primary/20 bg-white/80 shadow-sm dark:border-sidebar-accent dark:bg-brand-green-darker/40">
            <CardContent className="p-4 flex items-center gap-3">
                <div className={`flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 ${toneClasses[tone]}`}>
                    <Icon className="h-5 w-5" />
                </div>
                <div>
                    <div className={`text-2xl font-bold ${toneClasses[tone]}`}>{value}</div>
                    <div className="text-xs text-slate-500">{label}</div>
                </div>
            </CardContent>
        </Card>
    );
}

/** Single-hue sequential bar (one series → the app's own brand primary, not a
 * foreign hue) for "count by X" magnitude breakdowns. */
function MagnitudeBars({ data }: { data: NamedCount[] }) {
    const max = Math.max(1, ...data.map((d) => d.count));
    return (
        <div className="space-y-2">
            {data.length === 0 ? (
                <p className="text-sm text-slate-500">No data yet.</p>
            ) : (
                data.map((d) => (
                    <div key={d.name} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                            <span className="font-medium text-sidebar-accent dark:text-slate-300">{d.name}</span>
                            <span className="text-slate-500">{d.count}</span>
                        </div>
                        <div className="h-2 rounded-full bg-slate-100 dark:bg-sidebar-accent overflow-hidden">
                            <div className="h-full rounded-full bg-primary" style={{ width: `${(d.count / max) * 100}%` }} />
                        </div>
                    </div>
                ))
            )}
        </div>
    );
}

/** Two-series status pairing (Present=good, Absent=critical) — fixed status
 * colors per the dataviz palette, never themed, always paired with a legend. */
function AttendanceTrendChart({ data }: { data: TrendPoint[] }) {
    const max = Math.max(1, ...data.map((d) => (d.present ?? 0) + (d.absent ?? 0)));
    return (
        <div className="space-y-3">
            <div className="flex items-center gap-4 text-xs">
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: '#0ca30c' }} />Present</span>
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: '#d03b3b' }} />Absent</span>
            </div>
            <div className="flex items-end gap-1 h-24">
                {data.map((d, i) => {
                    const present = d.present ?? 0;
                    const absent = d.absent ?? 0;
                    return (
                        <div key={i} className="flex-1 flex flex-col items-center gap-0.5" title={`${d.date}: ${present} present, ${absent} absent`}>
                            <div className="w-full flex flex-col justify-end h-full gap-px">
                                <div className="rounded-t-sm" style={{ background: '#d03b3b', height: `${(absent / max) * 100}%` }} />
                                <div className="rounded-b-sm" style={{ background: '#0ca30c', height: `${(present / max) * 100}%` }} />
                            </div>
                        </div>
                    );
                })}
            </div>
            <div className="flex justify-between text-[10px] text-slate-400">
                <span>{data[0]?.date}</span>
                <span>{data[data.length - 1]?.date}</span>
            </div>
        </div>
    );
}

function SimpleTrendBars({ data }: { data: TrendPoint[] }) {
    const max = Math.max(1, ...data.map((d) => d.count ?? 0));
    return (
        <div className="flex items-end gap-2 h-20">
            {data.map((d, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full rounded-t-sm bg-primary" style={{ height: `${((d.count ?? 0) / max) * 100}%`, minHeight: (d.count ?? 0) > 0 ? '2px' : 0 }} />
                    <span className="text-[10px] text-slate-400">{d.month}</span>
                </div>
            ))}
        </div>
    );
}

const PENDING_ROUTE: Record<string, string> = {
    TRANSFER: '/dashboard/hr/lifecycle/transfer',
    EXIT: '/dashboard/hr/lifecycle/exit',
    LEAVE: '/dashboard/hr/leave/approval',
    CONFIRMATION: '/dashboard/hr/lifecycle/confirmation',
    PROMOTION: '/dashboard/hr/lifecycle/promotion',
    DOCUMENT: '/dashboard/hr/employee-documents',
};

export function HrDashboard() {
    const router = useRouter();
    const { toast } = useToast();
    const [kpis, setKpis] = useState<Kpis | null>(null);
    const [charts, setCharts] = useState<Charts | null>(null);
    const [pending, setPending] = useState<PendingItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const fetchAll = useCallback(async () => {
        try {
            const [kpisRes, chartsRes, pendingRes] = await Promise.all([
                apiClient.get<Kpis>('/hr/dashboard/kpis'),
                apiClient.get<Charts>('/hr/dashboard/charts'),
                apiClient.get<{ items: PendingItem[] }>('/hr/dashboard/pending-actions'),
            ]);
            if (kpisRes.success && kpisRes.data) setKpis(kpisRes.data);
            if (chartsRes.success && chartsRes.data) setCharts(chartsRes.data);
            if (pendingRes.success && pendingRes.data) setPending(pendingRes.data.items);
        } catch {
            toast({ title: 'Error', description: 'Failed to fetch HR dashboard data.', variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        fetchAll();
    }, [fetchAll]);

    if (isLoading) {
        return <PageLoader label="Loading HR Dashboard..." fullScreen={false} />;
    }

    return (
        <div className="relative min-h-screen">
            <div className="mx-auto max-w-6xl space-y-6">
                <div className="mb-8 flex items-center gap-4 mt-4">
                    <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary shadow-lg shadow-primary/30">
                        <Users2 className="h-7 w-7 text-white" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-foreground dark:text-white">HR Management</h1>
                        <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">Workforce overview, trends and pending approvals.</p>
                    </div>
                </div>

                {kpis && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <KpiTile icon={Users2} label="Total Employees" value={kpis.totalEmployees} />
                        <KpiTile icon={UserCheck} label="Active" value={kpis.activeEmployees} tone="good" />
                        <KpiTile icon={UserX} label="Inactive" value={kpis.inactiveEmployees} tone="muted" />
                        <KpiTile icon={UserPlus} label="New Joinings (Month)" value={kpis.newJoiningsThisMonth} />
                        <KpiTile icon={BadgeCheck} label="Pending Confirmation" value={kpis.pendingConfirmation} />
                        <KpiTile icon={TrendingUp} label="Pending Promotion" value={kpis.pendingPromotion} />
                        <KpiTile icon={ArrowRightLeft} label="Pending Transfer" value={kpis.pendingTransfer} />
                        <KpiTile icon={LogOut} label="Pending Exit" value={kpis.pendingExit} />
                        <KpiTile icon={CalendarRange} label="On Leave Today" value={kpis.employeesOnLeaveToday} />
                        <KpiTile icon={CheckCircle2} label="Present Today" value={kpis.todayPresent} tone="good" />
                        <KpiTile icon={XCircle} label="Absent Today" value={kpis.todayAbsent} tone="critical" />
                        <KpiTile icon={Radio} label="Currently Active" value={kpis.employeesCurrentlyActive} />
                    </div>
                )}

                {charts && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                            <CardHeader className="bg-gradient-to-r from-primary via-primary to-purple-600 px-6 py-4">
                                <CardTitle className="text-base font-semibold text-white">Employees by Department</CardTitle>
                            </CardHeader>
                            <CardContent className="p-6"><MagnitudeBars data={charts.byDepartment} /></CardContent>
                        </Card>
                        <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                            <CardHeader className="bg-gradient-to-r from-primary via-primary to-purple-600 px-6 py-4">
                                <CardTitle className="text-base font-semibold text-white">Employees by Designation</CardTitle>
                            </CardHeader>
                            <CardContent className="p-6"><MagnitudeBars data={charts.byDesignation} /></CardContent>
                        </Card>
                        <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                            <CardHeader className="bg-gradient-to-r from-primary via-primary to-purple-600 px-6 py-4">
                                <CardTitle className="text-base font-semibold text-white">Employees by Branch</CardTitle>
                            </CardHeader>
                            <CardContent className="p-6"><MagnitudeBars data={charts.byBranch} /></CardContent>
                        </Card>
                        <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                            <CardHeader className="bg-gradient-to-r from-primary via-primary to-purple-600 px-6 py-4">
                                <CardTitle className="text-base font-semibold text-white">Attendance Trend (14 days)</CardTitle>
                            </CardHeader>
                            <CardContent className="p-6"><AttendanceTrendChart data={charts.attendanceTrend} /></CardContent>
                        </Card>
                        <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                            <CardHeader className="bg-gradient-to-r from-primary via-primary to-purple-600 px-6 py-4">
                                <CardTitle className="text-base font-semibold text-white">Joining Trend (6 months)</CardTitle>
                            </CardHeader>
                            <CardContent className="p-6"><SimpleTrendBars data={charts.joiningTrend} /></CardContent>
                        </Card>
                        <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                            <CardHeader className="bg-gradient-to-r from-primary via-primary to-purple-600 px-6 py-4">
                                <CardTitle className="text-base font-semibold text-white">Leave Applications Trend (6 months)</CardTitle>
                            </CardHeader>
                            <CardContent className="p-6"><SimpleTrendBars data={charts.leaveTrend} /></CardContent>
                        </Card>
                    </div>
                )}

                <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                    <CardHeader className="bg-gradient-to-r from-primary via-primary to-purple-600 px-6 py-4">
                        <CardTitle className="text-base font-semibold text-white flex items-center justify-between">
                            <span className="flex items-center gap-2"><ListChecks className="h-4 w-4" />My Tasks / Pending Approvals</span>
                            <Badge variant="outline" className="text-white border-white/40">{pending.length}</Badge>
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                        {pending.length === 0 ? (
                            <p className="p-6 text-sm text-slate-500">Nothing pending — you&apos;re all caught up.</p>
                        ) : (
                            <ul className="divide-y divide-slate-100 dark:divide-sidebar-accent">
                                {pending.map((item) => (
                                    <li key={`${item.type}-${item.id}`}>
                                        <button
                                            className="w-full flex items-center justify-between px-6 py-3 text-left text-sm hover:bg-green-50/60 dark:hover:bg-sidebar-accent/50 transition-colors"
                                            onClick={() => router.push(PENDING_ROUTE[item.type] ?? '/dashboard/hr')}
                                        >
                                            <span>{item.label}</span>
                                            <span className="text-xs text-slate-400">{toDisplayDate(new Date(item.at))}</span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
