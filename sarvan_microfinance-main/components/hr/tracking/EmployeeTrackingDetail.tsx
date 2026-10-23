'use client';

import { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DatePickerField } from '@/components/ui/date-picker-field';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, MapPin, Footprints, Users, BatteryMedium, Building2 } from 'lucide-react';
import { apiClient } from '@/app/lib/api-client';
import { PageLoader } from '@/components/ui/page-loader';
import { STATUS_LABEL, formatTime12h } from '@/components/hr/tracking/LiveTrackingMap';

const LiveTrackingMap = dynamic(() => import('@/components/hr/tracking/LiveTrackingMap').then((m) => m.LiveTrackingMap), {
    ssr: false,
    loading: () => <div className="flex h-full items-center justify-center text-sm text-slate-400">Loading map...</div>,
});

type RoutePoint = { latitude: number; longitude: number; capturedAt: string; activityType: 'PUNCH_IN' | 'PUNCH_OUT' | 'CLIENT_VISIT' | 'EN_ROUTE' | 'IDLE_PING' | 'COLLECTION' | 'CENTER_CREATED' | 'MEMBER_ENROLLED'; source?: 'PING' | 'EVENT' };
type Detail = {
    employee: { id: string; employeeId: string | null; name: string; branch: string | null; designation: string | null };
    punchIn: string | null;
    punchOut: string | null;
    currentStatus: 'ACTIVE' | 'IDLE' | 'CLIENT_VISIT' | 'EN_ROUTE' | 'OFFLINE';
    clientVisitsManual: number;
    centersVisitedViaCollection: number;
    centersCreatedCount: number;
    membersEnrolledCount: number;
    travelledKm: number;
    lastLocation: { latitude: number; longitude: number } | null;
    lastBatteryPercent: number | null;
    routeHistory: RoutePoint[];
    activityTimeline: { at: string; label: string }[];
};

const STATUS_BADGE: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
    ACTIVE: 'default', IDLE: 'secondary', CLIENT_VISIT: 'default', EN_ROUTE: 'outline', OFFLINE: 'destructive',
};

type SnappedRoutePoint = { latitude: number; longitude: number };

// The backend derives most timeline labels straight from the raw enum
// (e.g. "EN ROUTE"); this remaps the two ping-derived ones to friendlier
// display text without needing a backend change. Labels already written
// as human-readable at capture time (Collection/Center/Enrollment) pass
// through unchanged.
function formatTimelineLabel(label: string): string {
    if (label === 'EN ROUTE') return 'Moving';
    if (label === 'IDLE PING') return 'Idle';
    return label;
}

export function EmployeeTrackingDetail({ employeeId }: { employeeId: string }) {
    const router = useRouter();
    const { toast } = useToast();
    const [detail, setDetail] = useState<Detail | null>(null);
    const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
    const [isLoading, setIsLoading] = useState(true);
    const [snappedPath, setSnappedPath] = useState<SnappedRoutePoint[] | null>(null);

    const fetchDetail = useCallback(async () => {
        try {
            const res = await apiClient.get<Detail>(`/hr/tracking/employee/${employeeId}/detail?date=${date}`);
            if (res.success && res.data) setDetail(res.data);
        } catch {
            toast({ title: 'Error', description: 'Failed to fetch tracking detail.', variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
    }, [employeeId, date, toast]);

    // Best-effort — the map already draws the raw straight-line path, so a
    // failed/missing map-matching provider (GOOGLE_MAPS_API_KEY unset, quota,
    // etc.) is silently ignored here rather than surfaced as an error toast.
    const fetchSnappedPath = useCallback(async () => {
        try {
            const res = await apiClient.get<{ snappedPath: SnappedRoutePoint[] | null }>(
                `/hr/tracking/employee/${employeeId}/route-snapped?date=${date}`,
            );
            setSnappedPath(res.success && res.data ? res.data.snappedPath : null);
        } catch {
            setSnappedPath(null);
        }
    }, [employeeId, date]);

    useEffect(() => { fetchDetail(); }, [fetchDetail]);
    useEffect(() => { fetchSnappedPath(); }, [fetchSnappedPath]);

    if (isLoading) {
        return <PageLoader label="Loading Employee Tracking..." fullScreen={false} />;
    }
    if (!detail) {
        return <div className="mx-auto max-w-3xl py-12 text-center text-slate-500">No tracking data available.</div>;
    }

    return (
        <div className="relative min-h-screen">
            <div className="mx-auto max-w-6xl space-y-6">
                <div className="mb-6 flex items-center justify-between mt-4">
                    <div className="flex items-center gap-4">
                        <Button variant="ghost" size="icon" onClick={() => router.push('/dashboard/hr/tracking/live')}>
                            <ArrowLeft className="h-5 w-5" />
                        </Button>
                        <div>
                            <h1 className="text-2xl font-bold tracking-tight text-foreground dark:text-white">{detail.employee.name}</h1>
                            <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                                {detail.employee.employeeId} · {detail.employee.designation ?? '—'} · {detail.employee.branch ?? '—'}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <Badge variant={STATUS_BADGE[detail.currentStatus]}>{STATUS_LABEL[detail.currentStatus]}</Badge>
                        <DatePickerField value={date} onChange={setDate} className="w-40" />
                    </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
                    <Card className="border-primary/20 bg-white/80 shadow-sm dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                        <CardContent className="p-4">
                            <div className="text-xs text-slate-500">Punch In</div>
                            <div className="text-lg font-bold">{formatTime12h(detail.punchIn, { includeSeconds: true })}</div>
                        </CardContent>
                    </Card>
                    <Card className="border-primary/20 bg-white/80 shadow-sm dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                        <CardContent className="p-4">
                            <div className="text-xs text-slate-500">Punch Out</div>
                            <div className="text-lg font-bold">{formatTime12h(detail.punchOut, { includeSeconds: true })}</div>
                        </CardContent>
                    </Card>
                    <Card className="border-primary/20 bg-white/80 shadow-sm dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                        <CardContent className="p-4 flex items-center gap-2">
                            <Footprints className="h-4 w-4 text-primary" />
                            <div>
                                <div className="text-xs text-slate-500">Travelled</div>
                                <div className="text-lg font-bold">{detail.travelledKm} km</div>
                            </div>
                        </CardContent>
                    </Card>
                    <Card className="border-primary/20 bg-white/80 shadow-sm dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                        <CardContent className="p-4 flex items-center gap-2">
                            <Users className="h-4 w-4 text-primary" />
                            <div>
                                <div className="text-xs text-slate-500">Clients Visited</div>
                                <div className="text-lg font-bold">{detail.clientVisitsManual}</div>
                            </div>
                        </CardContent>
                    </Card>
                    <Card className="border-primary/20 bg-white/80 shadow-sm dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                        <CardContent className="p-4 flex items-center gap-2">
                            <Building2 className="h-4 w-4 text-primary" />
                            <div>
                                <div className="text-xs text-slate-500">Centers Visited</div>
                                <div className="text-lg font-bold">{detail.centersVisitedViaCollection}</div>
                            </div>
                        </CardContent>
                    </Card>
                    <Card className="border-primary/20 bg-white/80 shadow-sm dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                        <CardContent className="p-4 flex items-center gap-2">
                            <Building2 className="h-4 w-4 text-primary" />
                            <div>
                                <div className="text-xs text-slate-500">Centers Created</div>
                                <div className="text-lg font-bold">{detail.centersCreatedCount}</div>
                            </div>
                        </CardContent>
                    </Card>
                    <Card className="border-primary/20 bg-white/80 shadow-sm dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                        <CardContent className="p-4 flex items-center gap-2">
                            <Users className="h-4 w-4 text-primary" />
                            <div>
                                <div className="text-xs text-slate-500">Members Enrolled</div>
                                <div className="text-lg font-bold">{detail.membersEnrolledCount}</div>
                            </div>
                        </CardContent>
                    </Card>
                    <Card className="border-primary/20 bg-white/80 shadow-sm dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                        <CardContent className="p-4 flex items-center gap-2">
                            <BatteryMedium className="h-4 w-4 text-primary" />
                            <div>
                                <div className="text-xs text-slate-500">Last Known Battery</div>
                                <div className="text-lg font-bold">{detail.lastBatteryPercent != null ? `${Math.round(detail.lastBatteryPercent)}%` : '—'}</div>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4" style={{ height: '55vh' }}>
                    <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40 overflow-hidden flex flex-col">
                        <CardHeader className="bg-gradient-to-r from-primary via-primary to-purple-600 px-4 py-3">
                            <CardTitle className="text-sm font-semibold text-white flex items-center gap-2"><MapPin className="h-4 w-4" />Activity Timeline</CardTitle>
                        </CardHeader>
                        <CardContent className="p-0 overflow-y-auto flex-1">
                            {detail.activityTimeline.length === 0 ? (
                                <p className="p-4 text-sm text-slate-500">No activity recorded for this date.</p>
                            ) : (
                                <ul className="divide-y divide-slate-100 dark:divide-sidebar-accent">
                                    {detail.activityTimeline.map((item, i) => (
                                        <li key={i} className="px-4 py-2 text-sm">
                                            <div className="font-medium">{formatTimelineLabel(item.label)}</div>
                                            <div className="text-xs text-slate-400">{formatTime12h(item.at, { includeSeconds: false })}</div>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </CardContent>
                    </Card>
                    <div className="lg:col-span-2 rounded-xl overflow-hidden border border-primary/20">
                        <LiveTrackingMap
                            employees={[{
                                id: detail.employee.id, name: detail.employee.name, employeeId: detail.employee.employeeId,
                                status: detail.currentStatus, lastLocation: detail.lastLocation, lastUpdated: null,
                                lastBatteryPercent: detail.lastBatteryPercent,
                            }]}
                            routeHistory={detail.routeHistory}
                            snappedPath={snappedPath}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
