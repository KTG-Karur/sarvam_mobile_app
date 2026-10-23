'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { DatePickerField } from '@/components/ui/date-picker-field';
import { Badge } from '@/components/ui/badge';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { MapPinned, Search, X, Crosshair, ChevronRight } from 'lucide-react';
import { apiClient } from '@/app/lib/api-client';
import { PageLoader } from '@/components/ui/page-loader';
import type { MapEmployee } from '@/components/hr/tracking/LiveTrackingMap';
import { STATUS_LABEL, formatTime12h } from '@/components/hr/tracking/LiveTrackingMap';

// Google Maps JS SDK touches window/document — must load client-only, never SSR.
const LiveTrackingMap = dynamic(() => import('@/components/hr/tracking/LiveTrackingMap').then((m) => m.LiveTrackingMap), {
    ssr: false,
    loading: () => <div className="flex h-full items-center justify-center text-sm text-slate-400">Loading map...</div>,
});

type LiveEmployee = MapEmployee & { branch: string | null; designation: string | null; lastActivity: string | null };
type Branch = { id: string; name: string };
type Department = { id: string; name: string };
type Designation = { id: string; name: string };

const STATUS_BADGE: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
    ACTIVE: 'default',
    IDLE: 'secondary',
    CLIENT_VISIT: 'default',
    EN_ROUTE: 'outline',
    OFFLINE: 'destructive',
};

export function LiveTrackingDashboard() {
    const router = useRouter();
    const { toast } = useToast();
    const [employees, setEmployees] = useState<LiveEmployee[]>([]);
    const [branches, setBranches] = useState<Branch[]>([]);
    const [departments, setDepartments] = useState<Department[]>([]);
    const [designations, setDesignations] = useState<Designation[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const [searchQuery, setSearchQuery] = useState('');
    const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
    const [branchId, setBranchId] = useState('all');
    const [departmentId, setDepartmentId] = useState('all');
    const [designationId, setDesignationId] = useState('all');
    const [status, setStatus] = useState('all');
    const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));

    const fetchLookups = useCallback(async () => {
        const [branchesRes, departmentsRes, designationsRes] = await Promise.all([
            apiClient.get<Branch[]>('/branches?permitted=true'),
            apiClient.get<Department[]>('/hr/departments'),
            apiClient.get<Designation[]>('/hr/designations'),
        ]);
        if (branchesRes.success && branchesRes.data) setBranches(branchesRes.data);
        if (departmentsRes.success && departmentsRes.data) setDepartments(departmentsRes.data);
        if (designationsRes.success && designationsRes.data) setDesignations(designationsRes.data);
    }, []);

    const fetchLive = useCallback(async () => {
        try {
            const qs = new URLSearchParams({ date });
            if (branchId !== 'all') qs.set('branchId', branchId);
            if (departmentId !== 'all') qs.set('departmentId', departmentId);
            if (designationId !== 'all') qs.set('designationId', designationId);
            if (status !== 'all') qs.set('status', status);
            const res = await apiClient.get<LiveEmployee[]>(`/hr/tracking/live?${qs.toString()}`);
            if (res.success && res.data) setEmployees(res.data);
        } catch {
            toast({ title: 'Error', description: 'Failed to fetch live tracking data.', variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
    }, [branchId, departmentId, designationId, status, date, toast]);

    useEffect(() => { fetchLookups(); }, [fetchLookups]);
    useEffect(() => { fetchLive(); }, [fetchLive]);

    const filteredEmployees = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return employees;
        return employees.filter((e) => {
            const empId = (e.employeeId ?? '').toLowerCase();
            const name = e.name.toLowerCase();
            return empId.includes(q) || name.includes(q);
        });
    }, [employees, searchQuery]);

    // Automatically highlight and pan when a single search result is matched
    useEffect(() => {
        if (searchQuery.trim() && filteredEmployees.length === 1) {
            setSelectedEmployeeId(filteredEmployees[0].id);
        }
    }, [searchQuery, filteredEmployees]);

    if (isLoading) {
        return <PageLoader label="Loading Live Tracking..." fullScreen={false} />;
    }

    return (
        <div className="relative min-h-screen">
            <div className="mx-auto max-w-7xl space-y-6">
                <div className="mb-6 flex items-center gap-4 mt-4">
                    <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary shadow-lg shadow-primary/30">
                        <MapPinned className="h-7 w-7 text-white" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-foreground dark:text-white">Live Employee Map</h1>
                        <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">Real-time field location, punch and client-visit activity.</p>
                    </div>
                </div>

                <Card className="border-primary/20 bg-white/80 shadow-sm dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                    <CardContent className="p-4 flex flex-wrap items-center gap-3">
                        <div className="relative flex-1 min-w-[240px] max-w-sm">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                            <Input
                                type="text"
                                placeholder="Search by Employee ID (e.g. ST001)..."
                                value={searchQuery}
                                onChange={(e) => {
                                    setSearchQuery(e.target.value);
                                    if (!e.target.value.trim()) setSelectedEmployeeId(null);
                                }}
                                className="pl-9 pr-8 h-10 text-sm"
                            />
                            {searchQuery && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setSearchQuery('');
                                        setSelectedEmployeeId(null);
                                    }}
                                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                                    title="Clear search"
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            )}
                        </div>
                        <Select value={branchId} onValueChange={setBranchId}>
                            <SelectTrigger className="w-40"><SelectValue placeholder="Branch" /></SelectTrigger>
                            <SelectContent><SelectItem value="all">All Branches</SelectItem>{branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
                        </Select>
                        <Select value={departmentId} onValueChange={setDepartmentId}>
                            <SelectTrigger className="w-40"><SelectValue placeholder="Department" /></SelectTrigger>
                            <SelectContent><SelectItem value="all">All Departments</SelectItem>{departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
                        </Select>
                        <Select value={designationId} onValueChange={setDesignationId}>
                            <SelectTrigger className="w-40"><SelectValue placeholder="Designation" /></SelectTrigger>
                            <SelectContent><SelectItem value="all">All Designations</SelectItem>{designations.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
                        </Select>
                        <Select value={status} onValueChange={setStatus}>
                            <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Status</SelectItem>
                                <SelectItem value="ACTIVE">Active</SelectItem>
                                <SelectItem value="IDLE">Idle</SelectItem>
                                <SelectItem value="CLIENT_VISIT">Client Visit</SelectItem>
                                <SelectItem value="EN_ROUTE">Moving</SelectItem>
                                <SelectItem value="OFFLINE">Offline / Last Seen</SelectItem>
                            </SelectContent>
                        </Select>
                        <DatePickerField value={date} onChange={setDate} className="w-40" />
                    </CardContent>
                </Card>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4" style={{ height: '65vh' }}>
                    <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40 overflow-hidden flex flex-col">
                        <div className="px-4 py-3 bg-slate-50/80 dark:bg-sidebar-accent/30 border-b border-slate-100 dark:border-sidebar-accent flex items-center justify-between">
                            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                                Staff ({filteredEmployees.length}{filteredEmployees.length !== employees.length ? ` of ${employees.length}` : ''})
                            </span>
                            {searchQuery && (
                                <Badge variant="outline" className="text-[11px] font-mono py-0 px-2 flex items-center gap-1 border-primary/40 text-primary">
                                    ID: {searchQuery}
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setSearchQuery('');
                                            setSelectedEmployeeId(null);
                                        }}
                                        className="hover:text-red-500 font-bold ml-1"
                                    >
                                        ×
                                    </button>
                                </Badge>
                            )}
                        </div>
                        <CardContent className="p-0 overflow-y-auto flex-1">
                            {filteredEmployees.length === 0 ? (
                                <div className="p-6 text-center space-y-2">
                                    <p className="text-sm font-medium text-slate-600 dark:text-slate-400">
                                        No staff found matching &ldquo;{searchQuery}&rdquo;
                                    </p>
                                    <p className="text-xs text-slate-400">Check the employee ID or clear the search filter.</p>
                                    {searchQuery && (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setSearchQuery('');
                                                setSelectedEmployeeId(null);
                                            }}
                                            className="text-xs font-semibold text-primary hover:underline mt-1"
                                        >
                                            Clear Search
                                        </button>
                                    )}
                                </div>
                            ) : (
                                <ul className="divide-y divide-slate-100 dark:divide-sidebar-accent">
                                    {filteredEmployees.map((e) => {
                                        const isSelected = selectedEmployeeId === e.id;
                                        return (
                                            <li
                                                key={e.id}
                                                className={`transition-colors ${
                                                    isSelected
                                                        ? 'bg-emerald-50/90 dark:bg-emerald-950/40 border-l-4 border-emerald-500'
                                                        : 'hover:bg-green-50/60 dark:hover:bg-sidebar-accent/50'
                                                }`}
                                            >
                                                <div className="w-full text-left px-4 py-3 flex items-start justify-between gap-2">
                                                    <button
                                                        type="button"
                                                        className="flex-1 text-left"
                                                        onClick={() => {
                                                            setSelectedEmployeeId(e.id);
                                                        }}
                                                        title="Click to focus on map"
                                                    >
                                                        <div className="flex items-center justify-between">
                                                            <div className="flex items-center gap-2">
                                                                <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{e.name}</span>
                                                                {e.employeeId && (
                                                                    <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium">
                                                                        {e.employeeId}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <Badge variant={STATUS_BADGE[e.status]}>{STATUS_LABEL[e.status]}</Badge>
                                                        </div>
                                                        <div className="text-xs text-slate-500 mt-1">
                                                            {e.branch ?? '—'} · {e.designation ?? '—'}
                                                        </div>
                                                        <div className="flex items-center gap-2 mt-1 text-xs">
                                                            {e.punchIn ? (
                                                                <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                                                                    In: {formatTime12h(e.punchIn, { includeSeconds: false })}
                                                                </span>
                                                            ) : (
                                                                <span className="text-slate-400">Not Punched In</span>
                                                            )}
                                                            {e.punchOut && (
                                                                <span className="text-rose-700 dark:text-rose-400 font-medium">
                                                                    · Out: {formatTime12h(e.punchOut, { includeSeconds: false })}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="flex items-center gap-2 mt-1">
                                                            {e.lastUpdated ? (
                                                                <span className="text-xs text-slate-400">
                                                                    Updated: {formatTime12h(e.lastUpdated, { includeSeconds: false })}
                                                                </span>
                                                            ) : (
                                                                <span className="text-xs text-amber-600/80 dark:text-amber-400/80">No GPS fix today</span>
                                                            )}
                                                            {e.lastBatteryPercent != null && (
                                                                <span className="text-xs text-slate-400">· 🔋 {Math.round(e.lastBatteryPercent)}%</span>
                                                            )}
                                                        </div>
                                                    </button>
                                                    <div className="flex items-center gap-1 self-center">
                                                        {e.lastLocation && (
                                                            <button
                                                                type="button"
                                                                onClick={() => setSelectedEmployeeId(e.id)}
                                                                className={`p-1.5 rounded-lg border transition-colors ${
                                                                    isSelected
                                                                        ? 'bg-emerald-600 text-white border-emerald-600'
                                                                        : 'text-slate-500 border-slate-200 hover:text-emerald-600 hover:border-emerald-300 dark:border-slate-700'
                                                                }`}
                                                                title="Focus location on map"
                                                            >
                                                                <Crosshair className="h-3.5 w-3.5" />
                                                            </button>
                                                        )}
                                                        <button
                                                            type="button"
                                                            onClick={() => router.push(`/dashboard/hr/tracking/employee/${e.id}`)}
                                                            className="p-1.5 rounded-lg border text-slate-500 border-slate-200 hover:text-primary hover:border-primary/40 dark:border-slate-700 transition-colors"
                                                            title="View full-day route trail"
                                                        >
                                                            <ChevronRight className="h-3.5 w-3.5" />
                                                        </button>
                                                    </div>
                                                </div>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </CardContent>
                    </Card>
                    <div className="lg:col-span-2 rounded-xl overflow-hidden border border-primary/20">
                        <LiveTrackingMap
                            employees={filteredEmployees}
                            selectedEmployeeId={selectedEmployeeId}
                            onSelectEmployee={setSelectedEmployeeId}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
