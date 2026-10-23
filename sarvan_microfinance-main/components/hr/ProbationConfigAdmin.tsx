'use client';

import { useState, useEffect, useCallback } from 'react';
import { Clock, Save, Loader2, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { PageLoader } from '@/components/ui/page-loader';

export function ProbationConfigAdmin() {
    const { toast } = useToast();
    const [probationMonths, setProbationMonths] = useState<number>(6);
    const [initialMonths, setInitialMonths] = useState<number>(6);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    const fetchConfig = useCallback(async () => {
        try {
            const res = await apiClient.get<{ probationMonths: number }>('/hr/probation-config');
            if (res.success && res.data) {
                setProbationMonths(res.data.probationMonths);
                setInitialMonths(res.data.probationMonths);
            } else {
                toast({
                    title: 'Failed to load configuration',
                    description: res.error || 'Could not fetch probation settings.',
                    variant: 'destructive',
                });
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Network error';
            toast({
                title: 'Error',
                description: message,
                variant: 'destructive',
            });
        } finally {
            setIsLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        fetchConfig();
    }, [fetchConfig]);

    const handleSave = async () => {
        const val = Number(probationMonths);
        if (isNaN(val) || val < 1 || val > 24) {
            toast({
                title: 'Invalid period',
                description: 'Probation period must be between 1 and 24 months.',
                variant: 'destructive',
            });
            return;
        }

        setIsSaving(true);
        try {
            const res = await apiClient.put<{ probationMonths: number }>('/hr/probation-config', {
                probationMonths: val,
            });
            if (res.success && res.data) {
                setProbationMonths(res.data.probationMonths);
                setInitialMonths(res.data.probationMonths);
                toast({
                    title: 'Configuration saved',
                    description: `Probation period successfully updated to ${res.data.probationMonths} months.`,
                });
            } else {
                toast({
                    title: 'Save failed',
                    description: res.error || 'Failed to update probation period.',
                    variant: 'destructive',
                });
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Network error';
            toast({
                title: 'Error',
                description: message,
                variant: 'destructive',
            });
        } finally {
            setIsSaving(false);
        }
    };

    if (isLoading) {
        return <PageLoader label="Loading probation configuration..." fullScreen={false} />;
    }

    const hasChanges = probationMonths !== initialMonths;

    return (
        <div className="mx-auto max-w-4xl space-y-6">
            <div className="mb-8 flex items-center justify-between mt-4">
                <div className="flex items-center gap-4">
                    <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary shadow-lg shadow-primary/30">
                        <Clock className="h-7 w-7 text-white" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-foreground dark:text-white">
                            Probation Period Configuration
                        </h1>
                        <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                            Set the global probation period duration for employee confirmation due tracking and prefill.
                        </p>
                    </div>
                </div>
            </div>

            <Card className="border-primary/20 bg-white/90 shadow-md dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                <CardHeader>
                    <CardTitle className="text-lg font-semibold text-foreground dark:text-white">
                        Global Probation Duration
                    </CardTitle>
                    <CardDescription>
                        Determines the default confirmation timeline across the organization.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="max-w-xs space-y-2">
                        <Label htmlFor="probation-months" className="text-sm font-medium">
                            Probation Period (Months)
                        </Label>
                        <div className="flex items-center gap-3">
                            <Input
                                id="probation-months"
                                type="number"
                                min={1}
                                max={24}
                                step={1}
                                value={probationMonths}
                                onChange={(e) => setProbationMonths(parseInt(e.target.value, 10) || 0)}
                                className="w-32 text-base font-semibold"
                            />
                            <span className="text-sm text-slate-500 font-medium">months</span>
                        </div>
                    </div>

                    <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50/60 p-4 text-sm text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300">
                        <Info className="h-5 w-5 flex-shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5" />
                        <div className="space-y-1">
                            <p className="font-medium">
                                Confirmation due date = Date of Joining + N months.
                            </p>
                            <p className="text-xs text-emerald-800/90 dark:text-emerald-400/90 leading-relaxed">
                                Used for prefill and due highlighting only — early confirmations are still allowed.
                                The confirmation date remains completely flexible and editable during initiation.
                            </p>
                        </div>
                    </div>

                    <div className="pt-2 flex items-center gap-3">
                        <Button
                            onClick={handleSave}
                            disabled={isSaving || !hasChanges || probationMonths < 1 || probationMonths > 24}
                            className="bg-primary text-white"
                        >
                            {isSaving ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            ) : (
                                <Save className="h-4 w-4 mr-2" />
                            )}
                            {isSaving ? 'Saving...' : 'Save Configuration'}
                        </Button>
                        {hasChanges && (
                            <Button
                                variant="outline"
                                onClick={() => setProbationMonths(initialMonths)}
                                disabled={isSaving}
                            >
                                Revert
                            </Button>
                        )}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}

