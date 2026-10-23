'use client';

import { useState, useEffect } from 'react';
import { Save, RefreshCw, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';

export interface AccountsGroupFormData {
    id?: string; // CUID for updates
    groupId: string; // Used for display only in edit mode
    groupName: string;
    parentGroupId: string | null;
    allowSubGroups: boolean;
}

interface AccountsGroupFormProps {
    initialData?: AccountsGroupFormData;
    parentGroups: Array<{
        id: string;
        name: string;
        isPrimary: boolean;
        parentGroupName: string | null;
        depth: number;
    }>;
    nextGroupId: number; // Keep for display estimation (optional)
    onSave?: (data: AccountsGroupFormData) => Promise<void>;
}

export function AccountsGroupForm({
    initialData,
    parentGroups,
    nextGroupId,
    onSave,
}: AccountsGroupFormProps) {
    const [formData, setFormData] = useState<AccountsGroupFormData>({
        id: initialData?.id,
        groupId: initialData?.groupId || '',
        groupName: initialData?.groupName || '',
        parentGroupId: initialData?.parentGroupId || null,
        allowSubGroups: initialData?.allowSubGroups ?? false,
    });
    const [isLoading, setIsLoading] = useState(false);
    const { toast } = useToast();

    // Update form when initialData changes
    useEffect(() => {
        if (initialData) {
            setFormData({
                id: initialData.id,
                groupId: initialData.groupId,
                groupName: initialData.groupName,
                parentGroupId: initialData.parentGroupId,
                allowSubGroups: initialData.allowSubGroups,
            });
        } else {
            setFormData({
                // For new items, we don't really know the ID until saved, 
                // but we can show the estimated one or just empty/auto
                groupId: '',
                groupName: '',
                parentGroupId: null,
                allowSubGroups: false,
            });
        }
    }, [initialData]);

    const handleChange = (field: keyof AccountsGroupFormData, value: string | boolean | null) => {
        setFormData((prev) => ({ ...prev, [field]: value }));
    };

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        if (!formData.groupName.trim()) {
            toast({
                title: 'Validation Error',
                description: 'Group Name is required.',
                variant: 'destructive',
            });
            return;
        }

        if (formData.parentGroupId && formData.groupId === formData.parentGroupId && initialData) {
            toast({
                title: 'Validation Error',
                description: 'A group cannot be its own parent.',
                variant: 'destructive',
            });
            return;
        }

        setIsLoading(true);

        try {
            if (onSave) {
                await onSave(formData);
            }
        } catch (error) {
            console.error("Form save error", error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleReset = () => {
        if (initialData) {
            setFormData({
                id: initialData.id,
                groupId: initialData.groupId,
                groupName: initialData.groupName,
                parentGroupId: initialData.parentGroupId,
                allowSubGroups: initialData.allowSubGroups,
            });
        } else {
            setFormData({
                groupId: '',
                groupName: '',
                parentGroupId: null,
                allowSubGroups: false,
            });
        }
        toast({
            title: 'Form Reset',
            description: 'Form fields have been reset.',
        });
    };

    const selectedParentGroup = parentGroups.find((g) => g.id === formData.parentGroupId);

    return (
        <form onSubmit={handleSubmit} className="flex flex-col gap-5" aria-label="Accounts Group form">
            {/* Group ID - Read Only / Auto Gen */}
            <div className="space-y-2">
                <Label
                    htmlFor="groupId"
                    className="text-sm font-semibold text-sidebar-accent dark:text-slate-200"
                >
                    Group Id
                </Label>
                <div className="flex items-center gap-2">
                    <Input
                        id="groupId"
                        type="text"
                        value={initialData ? formData.groupId : "Auto-generated"}
                        readOnly
                        className={cn(
                            'h-10 w-full border border-primary/30 text-sm font-medium',
                            'bg-brand-green-tint cursor-not-allowed text-slate-500',
                            'dark:bg-sidebar-accent dark:border-sidebar-accent dark:text-slate-400'
                        )}
                    />
                    <Badge variant="secondary" className="text-xs whitespace-nowrap">
                        {initialData ? "Immutable" : "System Assigned"}
                    </Badge>
                </div>
                <p className="text-xs text-slate-500">
                    Unique identifier generated automatically by the system.
                </p>
            </div>

            {/* Group Name */}
            <div className="space-y-2">
                <Label
                    htmlFor="groupName"
                    className="text-sm font-semibold text-sidebar-accent dark:text-slate-200"
                >
                    Group Name
                </Label>
                <Input
                    id="groupName"
                    type="text"
                    value={formData.groupName}
                    onChange={(event) => handleChange('groupName', event.target.value)}
                    className={cn(
                        'h-10 w-full border border-primary/30 text-sm font-medium',
                        'bg-green-50 hover:border-primary focus:border-primary focus:ring-2 focus:ring-primary/20',
                        'dark:bg-brand-green-darker dark:border-sidebar-accent'
                    )}
                    placeholder="Enter Group Name"
                    disabled={isLoading}
                    maxLength={100}
                    autoFocus
                />
            </div>

            {/* Parent Group */}
            <div className="space-y-2">
                <Label
                    htmlFor="parentGroup"
                    className="text-sm font-semibold text-sidebar-accent dark:text-slate-200"
                >
                    Parent Group
                </Label>
                <Select
                    value={formData.parentGroupId || 'PRIMARY'}
                    onValueChange={(value) =>
                        handleChange('parentGroupId', value === 'PRIMARY' ? null : value)
                    }
                    disabled={isLoading}
                >
                    <SelectTrigger
                        id="parentGroup"
                        className={cn(
                            'h-10 w-full border border-primary/30 text-sm font-medium',
                            'bg-green-50 hover:border-primary focus:border-primary focus:ring-2 focus:ring-primary/20',
                            'dark:bg-brand-green-darker dark:border-sidebar-accent'
                        )}
                    >
                        <SelectValue placeholder="-- SELECT --" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="PRIMARY">-- PRIMARY GROUP --</SelectItem>
                        {parentGroups
                            .filter(g => g.id !== formData.groupId) // prevent selecting self (only works in edit)
                            .map((group) => (
                                <SelectItem key={group.id} value={group.id}>
                                    <div
                                        className="flex items-center gap-2"
                                        style={{ paddingLeft: group.depth * 14 }}
                                    >
                                        {group.isPrimary ? (
                                            <Badge variant="default" className="text-xs px-1.5 py-0 bg-primary">
                                                Primary
                                            </Badge>
                                        ) : (
                                            <span className="text-slate-400 font-mono">└─</span>
                                        )}
                                        <span>{group.name}</span>
                                        {!group.isPrimary && group.parentGroupName && (
                                            <span className="text-xs text-slate-400">
                                                (under {group.parentGroupName})
                                            </span>
                                        )}
                                    </div>
                                </SelectItem>
                            ))}
                    </SelectContent>
                </Select>
                {formData.parentGroupId && selectedParentGroup && (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                        Parent: {selectedParentGroup.name}
                    </p>
                )}
                {!formData.parentGroupId && (
                    <p className="text-xs text-slate-500 dark:text-slate-400 italic">
                        This will be a primary group
                    </p>
                )}
            </div>

            {/* Allow Sub Groups */}
            <div className="space-y-2">
                <div className="flex items-center gap-2">
                    <Label
                        htmlFor="allowSubGroups"
                        className="text-sm font-semibold text-sidebar-accent dark:text-slate-200 cursor-pointer"
                    >
                        Allow Sub Groups
                    </Label>
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Info className="h-3.5 w-3.5 text-slate-400 cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent>
                                <p className="text-xs">
                                    Enable this to allow creating sub-groups under this group
                                </p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
                <div className="flex items-center gap-3">
                    <Switch
                        id="allowSubGroups"
                        checked={formData.allowSubGroups}
                        onCheckedChange={(checked) =>
                            handleChange('allowSubGroups', checked)
                        }
                        disabled={isLoading}
                    />
                    <span className="text-sm text-sidebar-accent dark:text-slate-400">
                        {formData.allowSubGroups ? 'Yes' : 'No'}
                    </span>
                </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center gap-3 pt-2">
                <Button
                    type="submit"
                    disabled={isLoading}
                    className="h-10 px-6 text-sm font-semibold bg-primary hover:bg-primary text-white shadow-sm"
                >
                    {isLoading ? (
                        <span className="flex items-center gap-2">
                            <RefreshCw className="h-4 w-4 animate-spin" />
                            Saving...
                        </span>
                    ) : (
                        <span className="flex items-center gap-2">
                            <Save className="h-4 w-4" />
                            Save
                        </span>
                    )}
                </Button>

                <Button
                    type="button"
                    variant="outline"
                    onClick={handleReset}
                    disabled={isLoading}
                    className="h-10 px-5 text-sm font-semibold border-primary/30 text-sidebar-accent hover:border-primary hover:text-sidebar-accent hover:bg-green-50 dark:border-sidebar-accent dark:text-slate-200 dark:hover:border-primary dark:hover:text-green-300 dark:hover:bg-brand-green-darker/60"
                >
                    <span className="flex items-center gap-2">
                        <RefreshCw className="h-4 w-4" />
                        Reset
                    </span>
                </Button>
            </div>
        </form>
    );
}
