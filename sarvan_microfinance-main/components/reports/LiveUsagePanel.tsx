'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2 } from 'lucide-react';
import { apiClient } from '@/app/lib/api-client';
import { toDisplayDateTime } from '@/app/lib/date-format';
import type { LiveReport } from '@/app/api/reports/others/user-login-activity/live/route';

const REFRESH_MS = 30_000;
const n = (v: number) => v.toLocaleString('en-IN');

/** "Current (Live)" view of the User Login Activity report: who is online now + API call load. */
export function LiveUsagePanel({ branchId }: { branchId: string }) {
    const [data, setData] = useState<LiveReport | null>(null);
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        const res = await apiClient.get<LiveReport>(`/reports/others/user-login-activity/live?branchId=${encodeURIComponent(branchId)}`);
        if (res.success && res.data) {
            setData(res.data);
            setError('');
        } else {
            setError(res.error || 'Failed to load live usage');
        }
    }, [branchId]);

    useEffect(() => {
        load();
        const t = setInterval(load, REFRESH_MS);
        return () => clearInterval(t);
    }, [load]);

    if (error) return <p className="text-sm text-destructive">{error}</p>;
    if (!data) return <Loader2 className="mx-auto h-5 w-5 animate-spin" />;

    const t = data.traffic;
    const maxMinute = Math.max(1, ...t.minutes.map((m) => m.web + m.mobile));
    const stats = [
        { label: 'Online now', value: data.online.total },
        { label: 'On web', value: data.online.web },
        { label: 'On mobile app', value: data.online.mobile },
        { label: 'Both', value: data.online.both },
        { label: 'API calls / min (now)', value: t.perMinuteNow },
        { label: 'Peak calls / min (today)', value: t.peakPerMinuteToday },
        { label: 'Avg calls / min (last hour)', value: t.avgPerMinuteLastHour },
        { label: 'API calls today', value: t.today },
    ];

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {stats.map((s) => (
                    <Card key={s.label}>
                        <CardContent className="p-4">
                            <p className="text-xs font-medium text-muted-foreground">{s.label}</p>
                            <p className="text-2xl font-bold tabular-nums">{n(s.value)}</p>
                        </CardContent>
                    </Card>
                ))}
            </div>
            <p className="text-xs text-muted-foreground">
                Online = active in the last {data.windowMinutes} min (refreshes every 30 s). Peak requests/second ≈ peak calls/min ÷ 60 ={' '}
                {(t.peakPerMinuteToday / 60).toFixed(1)}.{' '}
                {t.trackingStartedAt ? `API tracking since ${toDisplayDateTime(t.trackingStartedAt)}.` : 'API tracking has no data yet.'}
            </p>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">API calls — last 60 minutes</CardTitle>
                    <CardDescription>Web (blue) + Mobile (green) per minute</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex h-24 items-end gap-px">
                        {t.minutes.map((m) => (
                            <div key={m.minute} className="flex flex-1 flex-col justify-end" title={`${toDisplayDateTime(m.minute)} — web ${m.web}, mobile ${m.mobile}`}>
                                <div className="bg-green-500" style={{ height: `${(m.mobile / maxMinute) * 100}%` }} />
                                <div className="bg-blue-500" style={{ height: `${(m.web / maxMinute) * 100}%` }} />
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">Top APIs today</CardTitle>
                    </CardHeader>
                    <CardContent className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Endpoint</TableHead>
                                    <TableHead className="text-right">Web</TableHead>
                                    <TableHead className="text-right">Mobile</TableHead>
                                    <TableHead className="text-right">Total</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {t.topEndpoints.map((e) => (
                                    <TableRow key={e.path}>
                                        <TableCell className="max-w-[260px] truncate text-xs">{e.path}</TableCell>
                                        <TableCell className="text-right tabular-nums">{n(e.web)}</TableCell>
                                        <TableCell className="text-right tabular-nums">{n(e.mobile)}</TableCell>
                                        <TableCell className="text-right tabular-nums">{n(e.total)}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">Daily load — last 30 days</CardTitle>
                        <CardDescription>Use the highest peak/min to size cores and RAM</CardDescription>
                    </CardHeader>
                    <CardContent className="max-h-80 overflow-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Day</TableHead>
                                    <TableHead className="text-right">Calls</TableHead>
                                    <TableHead className="text-right">Peak / min</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {[...t.daily].reverse().map((d) => (
                                    <TableRow key={d.day}>
                                        <TableCell>{d.day}</TableCell>
                                        <TableCell className="text-right tabular-nums">{n(d.requests)}</TableCell>
                                        <TableCell className="text-right tabular-nums">{n(d.peakPerMinute)}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Who is using now ({data.users.length})</CardTitle>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Emp ID</TableHead>
                                <TableHead>Name</TableHead>
                                <TableHead>Role</TableHead>
                                <TableHead>Branch</TableHead>
                                <TableHead>Using</TableHead>
                                <TableHead>Last seen</TableHead>
                                <TableHead>Device</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {data.users.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={7} className="text-center text-muted-foreground">
                                        Nobody active in the last {data.windowMinutes} minutes
                                    </TableCell>
                                </TableRow>
                            ) : (
                                data.users.map((u) => (
                                    <TableRow key={u.userId}>
                                        <TableCell>{u.employeeId ?? '-'}</TableCell>
                                        <TableCell>{u.name}</TableCell>
                                        <TableCell>{u.role}</TableCell>
                                        <TableCell>{u.branchName}</TableCell>
                                        <TableCell className="space-x-1">
                                            {u.platforms.map((p) => (
                                                <Badge key={p} variant="secondary">
                                                    {p === 'WEB' ? 'Web' : 'Mobile app'}
                                                </Badge>
                                            ))}
                                        </TableCell>
                                        <TableCell className="whitespace-nowrap text-xs">{toDisplayDateTime(u.lastSeenAt)}</TableCell>
                                        <TableCell className="max-w-[200px] truncate text-xs">{u.device ?? '-'}</TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    );
}
