'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Save, Users } from 'lucide-react';
import { PageLoader } from '@/components/ui/page-loader';
import { apiClient } from '@/app/lib/api-client';
import { useToast } from '@/hooks/use-toast';

const MIN_MAX_MEMBERS = 1;
const MAX_MAX_MEMBERS = 100;
const DEFAULT_MAX_MEMBERS = 5;

type GroupAssignmentConfig = {
    maxMembersPerGroup: number;
};

/**
 * Admin-only configuration for automatic group assignment.
 * Rendered inside the Hub page "Settings" tab (visible to ADMIN only).
 */
export function GroupAssignmentSettings() {
    const { toast } = useToast();
    const [maxMembers, setMaxMembers] = useState<number>(DEFAULT_MAX_MEMBERS);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        const loadConfig = async () => {
            try {
                const result = await apiClient.get<GroupAssignmentConfig>('/settings/group-assignment');
                if (result.success && result.data) {
                    setMaxMembers(result.data.maxMembersPerGroup);
                }
            } catch {
                toast({
                    title: 'Error',
                    description: 'Failed to load group assignment settings.',
                    variant: 'destructive',
                });
            } finally {
                setIsLoading(false);
            }
        };
        loadConfig();
    }, [toast]);

    const handleSave = async () => {
        if (!Number.isInteger(maxMembers) || maxMembers < MIN_MAX_MEMBERS || maxMembers > MAX_MAX_MEMBERS) {
            toast({
                title: 'Invalid Value',
                description: `Maximum members per group must be a whole number between ${MIN_MAX_MEMBERS} and ${MAX_MAX_MEMBERS}.`,
                variant: 'destructive',
            });
            return;
        }

        setIsSaving(true);
        try {
            const result = await apiClient.put<GroupAssignmentConfig>('/settings/group-assignment', {
                maxMembersPerGroup: maxMembers,
            });
            if (result.success) {
                toast({
                    title: 'Saved',
                    description: `Maximum members per group is now ${maxMembers}.`,
                });
            } else {
                toast({
                    title: 'Error',
                    description: result.error || 'Failed to save settings.',
                    variant: 'destructive',
                });
            }
        } catch {
            toast({
                title: 'Error',
                description: 'Failed to save settings. Please try again.',
                variant: 'destructive',
            });
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Card className="border-2 border-primary/20 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
            <div className="h-1.5 bg-gradient-to-r from-primary via-primary to-purple-600" />
            <CardHeader className="bg-gradient-to-r from-slate-50 via-green-50/60 to-green-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-green-tint dark:bg-brand-green-darker/30">
                        <Users className="h-5 w-5 text-primary dark:text-primary" />
                    </div>
                    <div>
                        <CardTitle className="text-xl">Group Capacity</CardTitle>
                        <CardDescription>
                            Used to determine group capacity across group creation (Centers → Groups)
                            and client group assignment (Client Operations → Group Assignment). Full
                            groups are hidden from assignment dropdowns.
                        </CardDescription>
                    </div>
                </div>
            </CardHeader>

            <CardContent className="pt-6">
                {isLoading ? (
                    <PageLoader label="Loading settings…" fullScreen={false} />
                ) : (
                    <div className="space-y-4 max-w-md">
                        <div className="space-y-2">
                            <Label htmlFor="maxMembersPerGroup" className="text-sm font-medium">
                                Maximum Members Per Group
                            </Label>
                            <Input
                                id="maxMembersPerGroup"
                                type="number"
                                min={MIN_MAX_MEMBERS}
                                max={MAX_MAX_MEMBERS}
                                step={1}
                                value={maxMembers}
                                onChange={(e) => setMaxMembers(Number(e.target.value))}
                                className="h-11"
                            />
                            <p className="text-xs text-muted-foreground">
                                Between {MIN_MAX_MEMBERS} and {MAX_MAX_MEMBERS}. Counts ACTIVE clients
                                only — clients marked inactive no longer occupy a capacity slot. New
                                groups are created manually from Centers → Groups; this setting only
                                affects how full an existing group can get.
                            </p>
                        </div>

                        <Button
                            onClick={handleSave}
                            disabled={isSaving}
                            className="bg-primary hover:bg-sidebar-accent text-white"
                        >
                            {isSaving ? (
                                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</>
                            ) : (
                                <><Save className="mr-2 h-4 w-4" />Save Settings</>
                            )}
                        </Button>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
