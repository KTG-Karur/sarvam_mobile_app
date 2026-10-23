'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageLoader } from '@/components/ui/page-loader';
import { useToast } from '@/hooks/use-toast';
import { CalendarOff, Loader2, Save } from 'lucide-react';
import { apiClient } from '@/app/lib/api-client';

type Schedule = {
    sunday: boolean;
    monday: boolean;
    tuesday: boolean;
    wednesday: boolean;
    thursday: boolean;
    friday: boolean;
    saturday: boolean;
};

type WeekConfig = Schedule & { branchId: string };
type Branch = { id: string; name: string; code?: string };

const ALL_BRANCHES = '__all__';

const DAY_LABELS: { key: keyof Schedule; label: string }[] = [
    { key: 'sunday', label: 'Sunday' },
    { key: 'monday', label: 'Monday' },
    { key: 'tuesday', label: 'Tuesday' },
    { key: 'wednesday', label: 'Wednesday' },
    { key: 'thursday', label: 'Thursday' },
    { key: 'friday', label: 'Friday' },
    { key: 'saturday', label: 'Saturday' },
];

export function WeekConfigurationClient() {
    const { toast } = useToast();
    const [branches, setBranches] = useState<Branch[]>([]);
    const [branchId, setBranchId] = useState('');
    const [applyAll, setApplyAll] = useState(false);
    const [schedule, setSchedule] = useState<Schedule | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    const load = useCallback(async (id?: string) => {
        setIsLoading(true);
        try {
            const res = await apiClient.get<WeekConfig>(
                id ? `/hr/week-configuration?branchId=${encodeURIComponent(id)}` : '/hr/week-configuration',
            );
            if (res.success && res.data) {
                const { branchId: resolved, ...days } = res.data;
                setBranchId(resolved);
                setSchedule(days);
            } else {
                throw new Error(res.error || 'Failed to load');
            }
        } catch (error: any) {
            toast({ title: 'Error', description: error.message || 'Failed to load week configuration.', variant: 'destructive' });
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

    const handleSave = async () => {
        if (!schedule || (!branchId && !applyAll)) return;
        setIsSaving(true);
        try {
            const res = await apiClient.put<WeekConfig>(
                '/hr/week-configuration',
                applyAll ? { allBranches: true, ...schedule } : { branchId, ...schedule },
            );
            if (!res.success) throw new Error(res.error || 'Save failed');
            toast({
                title: 'Saved',
                description: applyAll ? 'Week configuration applied to all branches.' : 'Week configuration updated.',
            });
        } catch (error: any) {
            toast({ title: 'Error', description: error.message || 'Save failed.', variant: 'destructive' });
        } finally {
            setIsSaving(false);
        }
    };

    if (isLoading && !schedule) {
        return <PageLoader label="Loading Week Configuration..." fullScreen={false} />;
    }

    return (
        <div className="mx-auto max-w-3xl space-y-6">
            <div className="mt-4 flex items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary shadow-lg shadow-primary/30">
                    <CalendarOff className="h-7 w-7 text-white" />
                </div>
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Week Configuration</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Weekly off days per branch. Holidays and one-off working days are managed in the Holiday Calendar.
                    </p>
                </div>
            </div>

            <Card className="border-primary/20 shadow-lg">
                <CardHeader className="bg-primary px-6 py-4">
                    <CardTitle className="text-lg font-semibold text-white">Weekly Off</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 p-6">
                    {branches.length > 1 && (
                        <div className="max-w-xs space-y-2">
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
                                    Saving applies the schedule below to every branch you can manage, replacing their current week-off days.
                                </p>
                            )}
                        </div>
                    )}

                    {schedule && (
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            {DAY_LABELS.map(({ key, label }) => (
                                <div key={key} className="flex items-center justify-between rounded-lg border px-4 py-3">
                                    <Label htmlFor={`day-${key}`} className="cursor-pointer text-sm font-medium">
                                        {label}
                                    </Label>
                                    <div className="flex items-center gap-2">
                                        <span className={schedule[key] ? 'text-xs font-semibold text-emerald-600' : 'text-xs font-semibold text-rose-600'}>
                                            {schedule[key] ? 'Working Day' : 'Week Off'}
                                        </span>
                                        <Switch
                                            id={`day-${key}`}
                                            checked={schedule[key]}
                                            disabled={isLoading || isSaving}
                                            onCheckedChange={(checked) => setSchedule((s) => (s ? { ...s, [key]: checked } : s))}
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    <p className="max-w-lg text-xs text-muted-foreground">
                        Week Off days are excluded from required attendance in the Monthly Calendar Matrix and
                        reject punch-in (face verify and device biometric). Branches with no saved configuration
                        default to Sunday off.
                    </p>
                </CardContent>
            </Card>

            <div className="flex justify-center">
                <Button onClick={handleSave} disabled={isSaving || isLoading || !schedule} className="w-36">
                    {isSaving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving</> : <><Save className="mr-2 h-4 w-4" />Save</>}
                </Button>
            </div>
        </div>
    );
}
