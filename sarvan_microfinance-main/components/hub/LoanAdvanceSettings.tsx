'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Wallet } from 'lucide-react';
import { PageLoader } from '@/components/ui/page-loader';
import { apiClient } from '@/app/lib/api-client';
import { useToast } from '@/hooks/use-toast';

/**
 * Admin-only global kill-switch for the Loan Advance feature (client
 * loan-advance wallet, collection in Single/Bulk/Arrear/Demand Collection,
 * Loan Advance Refund, and every related report/column). Rendered inside
 * the Hub page "Settings" tab (visible to ADMIN only).
 */
export function LoanAdvanceSettings() {
    const { toast } = useToast();
    const [enabled, setEnabled] = useState(true);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        const loadConfig = async () => {
            try {
                const result = await apiClient.get<{ enabled: boolean }>('/settings/loan-advance');
                if (result.success && result.data) {
                    setEnabled(result.data.enabled);
                }
            } catch {
                toast({
                    title: 'Error',
                    description: 'Failed to load Loan Advance setting.',
                    variant: 'destructive',
                });
            } finally {
                setIsLoading(false);
            }
        };
        loadConfig();
    }, [toast]);

    const handleToggle = async (checked: boolean) => {
        const previous = enabled;
        setEnabled(checked); // optimistic
        setIsSaving(true);
        try {
            const result = await apiClient.put<{ enabled: boolean }>('/settings/loan-advance', { enabled: checked });
            if (result.success) {
                toast({
                    title: 'Saved',
                    description: `Loan Advance is now ${checked ? 'enabled' : 'disabled'} project-wide.`,
                });
            } else {
                setEnabled(previous); // revert
                toast({
                    title: 'Error',
                    description: result.error || 'Failed to save setting.',
                    variant: 'destructive',
                });
            }
        } catch {
            setEnabled(previous); // revert
            toast({
                title: 'Error',
                description: 'Failed to save setting. Please try again.',
                variant: 'destructive',
            });
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Card className="border-2 border-primary/20 dark:border-sidebar-accent/60 shadow-xl overflow-hidden mb-6">
            <div className="h-1.5 bg-gradient-to-r from-primary via-primary to-purple-600" />
            <CardHeader className="bg-gradient-to-r from-slate-50 via-green-50/60 to-green-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-green-tint dark:bg-brand-green-darker/30">
                        <Wallet className="h-5 w-5 text-primary dark:text-primary" />
                    </div>
                    <div>
                        <CardTitle className="text-xl">Loan Advance</CardTitle>
                        <CardDescription>
                            Project-wide switch for the Loan Advance feature. When disabled, Loan Advance
                            is hidden and blocked in Single/Bulk/Arrear/Demand Collection, Loan Advance
                            Refund, EOD allocation/revert, and every related report — for every branch and
                            role. Existing historical records are never deleted.
                        </CardDescription>
                    </div>
                </div>
            </CardHeader>

            <CardContent className="pt-6">
                {isLoading ? (
                    <PageLoader label="Loading setting…" fullScreen={false} />
                ) : (
                    <div className="flex items-center gap-3">
                        <Switch checked={enabled} disabled={isSaving} onCheckedChange={handleToggle} />
                        <Label className="text-sm">
                            {enabled ? 'Loan Advance enabled' : 'Loan Advance disabled'}
                        </Label>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
