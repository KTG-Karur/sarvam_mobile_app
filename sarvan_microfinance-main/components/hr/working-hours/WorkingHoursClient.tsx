'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TimePickerField } from '@/components/ui/time-picker-field';
import { useToast } from '@/hooks/use-toast';
import { Clock, Save, Loader2, RefreshCw, LogOut } from 'lucide-react';
import { apiClient } from '@/app/lib/api-client';
import { PageLoader } from '@/components/ui/page-loader';

// Shift timing (start/end) and the Full Day / Half Day punch thresholds now live per-shift
// on the Shift Management page (HR Administration) - see attendance-hr's Shift Management
// change log entries. This page only keeps the settings that are genuinely company-wide
// and unrelated to which shift an employee is on: `fullDayHours` here is Payroll's own
// daily-rate divisor (see app/lib/payroll/calculation.ts), not an attendance threshold.
// The weekly off schedule now lives per-branch on the Week Configuration page.
type WorkingHours = {
    fullDayHours: number;
    permissionHoursLopThreshold: number;
    autoCheckoutTime: string;
};

const EMPTY: WorkingHours = {
    fullDayHours: 8,
    permissionHoursLopThreshold: 6,
    autoCheckoutTime: '23:59',
};

export function WorkingHoursClient() {
    const { toast } = useToast();
    const [form, setForm] = useState<WorkingHours>(EMPTY);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    // Latest shiftEnd across all configured Shifts (Shift Management) — the
    // Auto-close time can never be set earlier than this, otherwise an
    // employee on the latest shift would get force-closed before their own
    // shift has even ended. 'HH:MM' zero-padded strings compare correctly
    // lexicographically, no need to parse to minutes.
    const [latestShiftEnd, setLatestShiftEnd] = useState<string | null>(null);

    const fetchConfig = useCallback(async () => {
        try {
            const res = await apiClient.get<WorkingHours>('/hr/working-hours');
            if (res.success && res.data) setForm({ ...EMPTY, ...res.data });
        } catch {
            toast({ title: 'Error', description: 'Failed to load working hours.', variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        fetchConfig();
        apiClient.get<{ shiftEnd: string; isActive: boolean }[]>('/hr/shifts').then((res) => {
            if (res.success && res.data && res.data.length > 0) {
                const active = res.data.filter((s) => s.isActive !== false);
                const latest = (active.length > 0 ? active : res.data).reduce((max, s) => (s.shiftEnd > max ? s.shiftEnd : max), '00:00');
                setLatestShiftEnd(latest);
            }
        }).catch(() => {});
    }, [fetchConfig]);

    const set = <K extends keyof WorkingHours>(key: K, value: WorkingHours[K]) =>
        setForm((f) => ({ ...f, [key]: value }));

    const handleSave = async () => {
        if (latestShiftEnd && form.autoCheckoutTime < latestShiftEnd) {
            toast({
                title: 'Auto-close time too early',
                description: `Auto-close time can't be earlier than ${latestShiftEnd} — the latest end time among configured Shifts. Employees on that shift would otherwise get force-closed before their own shift ends.`,
                variant: 'destructive',
            });
            return;
        }
        setIsSaving(true);
        try {
            const res = await apiClient.put<WorkingHours>('/hr/working-hours', form);
            if (res.success) {
                toast({ title: 'Saved', description: 'Working hours updated.' });
                if (res.data) setForm({ ...EMPTY, ...res.data });
            } else {
                throw new Error(res.error || 'Save failed');
            }
        } catch (error: any) {
            toast({ title: 'Error', description: error.message || 'Save failed.', variant: 'destructive' });
        } finally {
            setIsSaving(false);
        }
    };

    if (isLoading) {
        return <PageLoader label="Loading Working Hours..." fullScreen={false} />;
    }

    return (
        <div className="relative min-h-screen">
            <div className="mx-auto max-w-3xl space-y-6">
                <div className="mb-8 flex items-center gap-4 mt-4">
                    <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary shadow-lg shadow-primary/30">
                        <Clock className="h-7 w-7 text-white" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-foreground dark:text-white">Working Hours</h1>
                        <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                            Company-wide payroll settings. Shift timing and Full Day / Half Day punch
                            thresholds are now set per-shift under Shift Management.
                        </p>
                    </div>
                </div>

                <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                    <CardHeader className="bg-gradient-to-r from-primary via-primary to-purple-600 px-6 py-4">
                        <CardTitle className="text-lg font-semibold text-white">Payroll Day-Length</CardTitle>
                    </CardHeader>
                    <CardContent className="p-6 space-y-3">
                        <div className="space-y-2 max-w-xs">
                            <Label htmlFor="fullDayHours">Standard Working Day (hours)</Label>
                            <Input
                                id="fullDayHours"
                                type="number"
                                min={0}
                                max={24}
                                step={0.5}
                                value={form.fullDayHours}
                                onChange={(e) => set('fullDayHours', Number(e.target.value))}
                            />
                        </div>
                        <p className="text-xs text-slate-500 max-w-lg">
                            Used only by Payroll to convert a permission-deduction amount into an hourly
                            rate (daily rate &divide; this value). Not used for attendance status anymore &mdash; that
                            now comes from each employee&rsquo;s assigned Shift.
                        </p>
                    </CardContent>
                </Card>

                <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                    <CardHeader className="bg-gradient-to-r from-primary via-primary to-purple-600 px-6 py-4">
                        <CardTitle className="text-lg font-semibold text-white flex items-center gap-2">
                            <LogOut className="h-5 w-5" />
                            Auto Punch-Out
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-6 space-y-3">
                        <div className="space-y-2 max-w-xs">
                            <Label htmlFor="autoCheckoutTime">Auto-close time (24-hour, Asia/Kolkata)</Label>
                            <TimePickerField
                                id="autoCheckoutTime"
                                value={form.autoCheckoutTime}
                                onChange={(v) => set('autoCheckoutTime', v)}
                                minuteStep={1}
                            />
                            {latestShiftEnd && (
                                <p className="text-xs text-muted-foreground">
                                    Must be 23:59 or earlier, and no earlier than {latestShiftEnd} — the latest
                                    shift end time currently configured under Shift Management.
                                </p>
                            )}
                        </div>
                        <p className="text-xs text-slate-500 max-w-lg">
                            If an employee punched in but never punched out, the Daily Register auto-closes
                            their punch at this time when a PAST date&rsquo;s register is saved — never
                            today&rsquo;s date, since they may still be expected to punch out later. Working
                            hours and status (Present / Half Day) are then recomputed from checkIn to this
                            time, exactly like a real punch-out would. Default 23:59.
                        </p>
                    </CardContent>
                </Card>

                <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                    <CardHeader className="bg-gradient-to-r from-primary via-primary to-purple-600 px-6 py-4">
                        <CardTitle className="text-lg font-semibold text-white">Permission Hours (Payroll)</CardTitle>
                    </CardHeader>
                    <CardContent className="p-6 space-y-3">
                        <div className="space-y-2 max-w-xs">
                            <Label htmlFor="permissionHoursLopThreshold">LOP Threshold (hours per month)</Label>
                            <Input
                                id="permissionHoursLopThreshold"
                                type="number"
                                min={0}
                                max={200}
                                step={0.5}
                                value={form.permissionHoursLopThreshold}
                                onChange={(e) => set('permissionHoursLopThreshold', Number(e.target.value))}
                            />
                        </div>
                        <p className="text-xs text-slate-500 max-w-lg">
                            Approved permission hours never affect a day&rsquo;s punched-in/out working hours or
                            status. Instead, Payroll&rsquo;s Salary Pay screen totals each employee&rsquo;s
                            approved permission hours for the month and auto-fills a <b>Permission Deduction</b> line
                            item — proportional to the hours below this threshold, or a full day&rsquo;s pay once the
                            monthly total reaches it. Always visible and editable by the admin before submitting.
                        </p>
                    </CardContent>
                </Card>

                <div className="flex flex-wrap gap-3 items-center justify-center">
                    <Button onClick={handleSave} disabled={isSaving} className="w-36 bg-primary text-white">
                        {isSaving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving</> : <><Save className="h-4 w-4 mr-2" />Save</>}
                    </Button>
                    <Button onClick={fetchConfig} variant="outline" disabled={isSaving} className="w-36">
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Reset
                    </Button>
                </div>
            </div>
        </div>
    );
}
