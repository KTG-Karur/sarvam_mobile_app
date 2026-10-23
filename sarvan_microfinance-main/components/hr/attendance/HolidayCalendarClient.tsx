'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { DatePickerField } from '@/components/ui/date-picker-field';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageLoader } from '@/components/ui/page-loader';
import { useToast } from '@/hooks/use-toast';
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { apiClient } from '@/app/lib/api-client';

type Holiday = { id: string; branchId: string; date: string; isWorkingDay: boolean; reason: string | null };
type Schedule = Record<'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday', boolean>;
type Branch = { id: string; name: string; code?: string };

const ALL_BRANCHES = '__all__';

type DayKind = 'WORKING' | 'WEEK_OFF' | 'HOLIDAY' | 'WORKING_OVERRIDE';
const KIND_LABEL: Record<DayKind, string> = {
    WORKING: 'Working',
    WEEK_OFF: 'Week Off',
    HOLIDAY: 'Holiday',
    WORKING_OVERRIDE: 'Working',
};
const KIND_TITLE: Record<DayKind, string> = {
    WORKING: 'Working Day',
    WEEK_OFF: 'Week Off',
    HOLIDAY: 'Holiday',
    WORKING_OVERRIDE: 'Working Day (override)',
};
const KIND_CLASS: Record<DayKind, string> = {
    WORKING: 'border-emerald-700 bg-emerald-600 text-white hover:bg-emerald-700',
    WORKING_OVERRIDE: 'border-emerald-700 bg-emerald-600 text-white hover:bg-emerald-700',
    HOLIDAY: 'border-rose-200 bg-rose-50 text-rose-900 hover:bg-rose-100',
    WEEK_OFF: 'border-slate-200 bg-slate-100 text-slate-600 hover:bg-slate-200',
};

const DAY_KEYS: (keyof Schedule)[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

const ymd = (y: number, m: number, d: number) =>
    `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

export function HolidayCalendarClient() {
    const { toast } = useToast();
    const [branches, setBranches] = useState<Branch[]>([]);
    const [branchId, setBranchId] = useState('');
    const [applyAll, setApplyAll] = useState(false);
    const [confirmRemoveDate, setConfirmRemoveDate] = useState<string | null>(null);
    const [schedule, setSchedule] = useState<Schedule | null>(null);
    const [holidays, setHolidays] = useState<Holiday[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [calendarDate, setCalendarDate] = useState(() => new Date());

    const [customDate, setCustomDate] = useState('');
    const [customIsWorking, setCustomIsWorking] = useState(false);
    const [customReason, setCustomReason] = useState('');

    const load = useCallback(async (id?: string) => {
        setIsLoading(true);
        try {
            const q = id ? `?branchId=${encodeURIComponent(id)}` : '';
            const weekRes = await apiClient.get<Schedule & { branchId: string }>(`/hr/week-configuration${q}`);
            if (!weekRes.success || !weekRes.data) throw new Error(weekRes.error || 'Failed to load week configuration');
            const { branchId: resolved, ...days } = weekRes.data;
            const holRes = await apiClient.get<Holiday[]>(`/hr/holidays?branchId=${encodeURIComponent(resolved)}`);
            if (!holRes.success) throw new Error(holRes.error || 'Failed to load holidays');
            setBranchId(resolved);
            setSchedule(days);
            setHolidays(holRes.data ?? []);
        } catch (error: any) {
            toast({ title: 'Error', description: error.message || 'Failed to load holiday calendar.', variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        load();
        apiClient.get<Branch[]>('/branches').then((res) => {
            if (res.success && res.data) setBranches(res.data);
        }).catch(() => {});
    }, [load]);

    const byDate = useMemo(() => new Map(holidays.map((h) => [h.date, h])), [holidays]);

    const dayStatus = (year: number, month: number, day: number) => {
        const h = byDate.get(ymd(year, month, day));
        if (h) {
            return {
                isWorking: h.isWorkingDay,
                isOverride: true,
                reason: h.reason,
                kind: (h.isWorkingDay ? 'WORKING_OVERRIDE' : 'HOLIDAY') as DayKind,
            };
        }
        const weekly = schedule ? schedule[DAY_KEYS[new Date(year, month, day).getDay()]] : true;
        return {
            isWorking: weekly,
            isOverride: false,
            reason: null as string | null,
            kind: (weekly ? 'WORKING' : 'WEEK_OFF') as DayKind,
        };
    };

    const weeklyWorking = (dateStr: string) => {
        const [y, m, d] = dateStr.split('-').map(Number);
        return schedule ? schedule[DAY_KEYS[new Date(y, m - 1, d).getDay()]] : true;
    };

    // "Working Day" only means something on a week-off date (it overrides the week-off);
    // on an ordinary working day it would be a no-op, so it isn't offered there.
    const customIsWeekOff = customDate ? !weeklyWorking(customDate) : false;
    const effectiveWorking = customIsWorking && customIsWeekOff;

    const toggleDate = (dateStr: string, isWorking: boolean) => {
        const target = !isWorking;
        if (!applyAll && target === weeklyWorking(dateStr)) {
            // Back to the weekly default — drop the override instead of storing a redundant one.
            if (byDate.has(dateStr)) setConfirmRemoveDate(dateStr);
            return;
        }
        // Every holiday / working-day override needs a reason - hand off to the form below.
        setCustomDate(dateStr);
        setCustomIsWorking(target);
        toast({
            title: 'Reason required',
            description: `Enter a reason to mark ${dateStr} as a ${target ? 'working day' : 'holiday'}, then Save.`,
        });
    };

    const saveHoliday = async (date: string, isWorkingDay: boolean, reason?: string) => {
        if (!branchId) return;
        setIsSaving(true);
        try {
            const res = await apiClient.post<Holiday>('/hr/holidays', { branchId, date, isWorkingDay, reason, ...(applyAll ? { allBranches: true } : {}) });
            if (!res.success || !res.data) throw new Error(res.error || 'Save failed');
            const saved = res.data;
            setHolidays((prev) => [...prev.filter((h) => h.date !== date), saved].sort((a, b) => a.date.localeCompare(b.date)));
            toast({ title: 'Saved', description: `${date} updated.` });
        } catch (error: any) {
            toast({ title: 'Error', description: error.message || 'Save failed.', variant: 'destructive' });
        } finally {
            setIsSaving(false);
        }
    };

    const removeHoliday = async (date: string) => {
        setIsSaving(true);
        try {
            const res = await apiClient.delete(`/hr/holidays?branchId=${encodeURIComponent(branchId)}&date=${date}`);
            if (!res.success) throw new Error(res.error || 'Remove failed');
            setHolidays((prev) => prev.filter((h) => h.date !== date));
            toast({ title: 'Removed', description: `${date} override removed.` });
        } catch (error: any) {
            toast({ title: 'Error', description: error.message || 'Remove failed.', variant: 'destructive' });
        } finally {
            setIsSaving(false);
        }
    };

    const handleAdd = async () => {
        if (!customDate) {
            toast({ title: 'Select Date', description: 'Please select a calendar date.', variant: 'destructive' });
            return;
        }
        if (!customReason.trim()) {
            toast({ title: 'Reason required', description: 'Please enter a reason.', variant: 'destructive' });
            return;
        }
        await saveHoliday(customDate, effectiveWorking, customReason.trim());
        setCustomDate('');
        setCustomReason('');
    };

    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDayOfWeek = new Date(year, month, 1).getDay();
    const now = new Date();
    const todayStr = ymd(now.getFullYear(), now.getMonth(), now.getDate());

    if (isLoading && !schedule) {
        return <PageLoader label="Loading Holiday Calendar..." fullScreen={false} />;
    }

    return (
        <div className="mx-auto max-w-4xl space-y-6">
            <div className="mt-4 flex items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary shadow-lg shadow-primary/30">
                    <CalendarDays className="h-7 w-7 text-white" />
                </div>
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Holiday Calendar</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Click a date to toggle it between Working Day and Holiday for the selected branch.
                    </p>
                </div>
            </div>

            <Card className="border-primary/20 shadow-lg">
                <CardHeader className="bg-primary px-6 py-4">
                    <CardTitle className="text-lg font-semibold text-white">Calendar</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6 p-6">
                    <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-end">
                        {branches.length > 1 ? (
                            <div className="w-full max-w-xs space-y-2">
                                <Label htmlFor="branch">Branch</Label>
                                <Select
                                    value={applyAll ? ALL_BRANCHES : branchId}
                                    onValueChange={(v) => {
                                        if (v === ALL_BRANCHES) {
                                            setApplyAll(true);
                                        } else {
                                            setApplyAll(false);
                                            load(v);
                                        }
                                    }}
                                    disabled={isLoading || isSaving}
                                >
                                    <SelectTrigger id="branch" className="h-10 w-full">
                                        <SelectValue placeholder="Select branch" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value={ALL_BRANCHES}>All branches</SelectItem>
                                        {branches.map((b) => (
                                            <SelectItem key={b.id} value={b.id}>
                                                {b.code ? `${b.code} — ${b.name}` : b.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                {applyAll && (
                                    <p className="text-xs text-amber-600">
                                        Dates you save or toggle apply to every branch you can manage. The calendar shown is the first branch&rsquo;s.
                                    </p>
                                )}
                            </div>
                        ) : <div />}

                        <div className="flex items-center gap-2 rounded-lg border px-3 py-1.5">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setCalendarDate(new Date(year, month - 1, 1))} title="Previous Month">
                                <ChevronLeft className="h-4 w-4" />
                            </Button>
                            <span className="min-w-32 text-center text-sm font-bold">{MONTH_NAMES[month]} {year}</span>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setCalendarDate(new Date(year, month + 1, 1))} title="Next Month">
                                <ChevronRight className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>

                    <div className="rounded-xl border bg-muted/30 p-3">
                        <div className="mb-2 grid grid-cols-7 gap-1 text-center text-xs font-bold">
                            <div className="text-rose-600">Sun</div>
                            <div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div>Sat</div>
                        </div>
                        <div className="grid grid-cols-7 gap-1.5">
                            {Array.from({ length: firstDayOfWeek }).map((_, i) => (
                                <div key={`blank-${i}`} className="h-14 rounded-lg" />
                            ))}
                            {Array.from({ length: daysInMonth }).map((_, i) => {
                                const day = i + 1;
                                const dateStr = ymd(year, month, day);
                                const { isWorking, isOverride, reason, kind } = dayStatus(year, month, day);
                                const isToday = dateStr === todayStr;
                                return (
                                    <button
                                        key={dateStr}
                                        disabled={isSaving || isLoading}
                                        onClick={() => toggleDate(dateStr, isWorking)}
                                        title={`Click to toggle ${dateStr} (${KIND_TITLE[kind]})${reason ? ` — ${reason}` : ''}`}
                                        className={`relative flex h-14 flex-col justify-between rounded-lg border p-1.5 text-left transition-all ${KIND_CLASS[kind]} ${isToday ? 'ring-2 ring-amber-400 ring-offset-1' : ''}`}
                                    >
                                        <span className="text-xs font-bold">{day}</span>
                                        <span className="flex w-full items-center justify-between text-[10px] font-semibold leading-none">
                                            {KIND_LABEL[kind]}
                                            {isOverride && <span className="h-1.5 w-1.5 rounded-full bg-amber-300" />}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="space-y-3 border-t pt-4">
                        <Label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            <Plus className="h-3.5 w-3.5" /> Add date with reason
                        </Label>
                        <div className="flex flex-col items-stretch gap-2 rounded-lg border bg-muted/30 p-3 sm:flex-row sm:items-center">
                            <div className="w-full sm:w-48">
                                <DatePickerField id="holidayDate" value={customDate} onChange={setCustomDate} disabled={isSaving || isLoading} />
                            </div>
                            <Select
                                value={effectiveWorking ? 'WORKING' : 'HOLIDAY'}
                                onValueChange={(v) => setCustomIsWorking(v === 'WORKING')}
                                disabled={isSaving || isLoading}
                            >
                                <SelectTrigger className="h-10 w-full sm:w-44">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="HOLIDAY">Holiday / Off</SelectItem>
                                    {customIsWeekOff && <SelectItem value="WORKING">Working Day (override week-off)</SelectItem>}
                                </SelectContent>
                            </Select>
                            <Input
                                placeholder={effectiveWorking ? 'Reason (required) e.g. Sunday working drive' : 'Reason (required) e.g. Diwali'}
                                value={customReason}
                                onChange={(e) => setCustomReason(e.target.value)}
                                className="flex-1 bg-background text-sm"
                            />
                            <Button size="sm" onClick={handleAdd} disabled={isSaving || isLoading} className="whitespace-nowrap">
                                <Plus className="mr-1 h-4 w-4" /> Save
                            </Button>
                        </div>

                        {holidays.length > 0 && (
                            <div className="flex flex-wrap gap-2 pt-1">
                                {holidays.map((item) => (
                                    <div
                                        key={item.id}
                                        className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium ${
                                            item.isWorkingDay
                                                ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                                                : 'border-rose-200 bg-rose-50 text-rose-900'
                                        }`}
                                    >
                                        <span className="font-bold">{item.date}</span>
                                        <Badge variant="outline" className="text-[10px]">
                                            {item.isWorkingDay ? 'Working Day' : 'Holiday'}
                                        </Badge>
                                        {item.reason && <span className="italic text-muted-foreground">({item.reason})</span>}
                                        <button
                                            onClick={() => setConfirmRemoveDate(item.date)}
                                            disabled={isSaving}
                                            className="ml-1 p-0.5 text-muted-foreground hover:text-rose-600"
                                            title="Remove"
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </CardContent>
            </Card>

            <Dialog open={confirmRemoveDate !== null} onOpenChange={(open) => { if (!open) setConfirmRemoveDate(null); }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Remove this override?</DialogTitle>
                        <DialogDescription>
                            {confirmRemoveDate && byDate.get(confirmRemoveDate)
                                ? `${confirmRemoveDate} is marked as ${byDate.get(confirmRemoveDate)!.isWorkingDay ? 'a working day' : 'a holiday'}${byDate.get(confirmRemoveDate)!.reason ? ` (${byDate.get(confirmRemoveDate)!.reason})` : ''}. Removing it puts the date back to the branch's normal weekly schedule.`
                                : 'This puts the date back to the branch\'s normal weekly schedule.'}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setConfirmRemoveDate(null)} disabled={isSaving}>
                            No
                        </Button>
                        <Button
                            variant="destructive"
                            disabled={isSaving}
                            onClick={async () => {
                                const d = confirmRemoveDate;
                                setConfirmRemoveDate(null);
                                if (d) await removeHoliday(d);
                            }}
                        >
                            Yes, remove
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
