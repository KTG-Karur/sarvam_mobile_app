'use client';

import { useState, useEffect } from 'react';
import { Save, RefreshCw } from 'lucide-react';
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
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { usePermission } from '@/app/hooks/usePermission';

export interface AccountsLedgerFormData {
    ledgerId: string;
    ledgerName: string;
    groupedUnder: string | null;
    allowAccessTo: ('H.O' | 'B.O')[];
    hasTransactions?: boolean;
}

interface AccountsLedgerFormProps {
    initialData?: AccountsLedgerFormData;
    accountGroups: Array<{ id: string; name: string; parentGroupId: string; parentGroupName: string }>;
    nextLedgerId: number;
    onSave?: (data: AccountsLedgerFormData) => void;
}

export function AccountsLedgerForm({
    initialData,
    accountGroups,
    nextLedgerId,
    onSave,
}: AccountsLedgerFormProps) {
    const [formData, setFormData] = useState<AccountsLedgerFormData>({
        ledgerId: initialData?.ledgerId || nextLedgerId.toString(),
        ledgerName: initialData?.ledgerName || '',
        groupedUnder: initialData?.groupedUnder || null,
        allowAccessTo: initialData?.allowAccessTo || [],
    });
    const [isLoading, setIsLoading] = useState(false);
    const { toast } = useToast();
    const { hasRole } = usePermission();
    const isAdmin = hasRole('admin');

    const isEditMode = !!initialData;
    const isLocked = isEditMode && !!initialData?.hasTransactions;
    const nameLocked = isEditMode && !isAdmin;

    // Update form data when initialData changes
    useEffect(() => {
        if (initialData) {
            setFormData({
                ledgerId: initialData.ledgerId,
                ledgerName: initialData.ledgerName,
                groupedUnder: initialData.groupedUnder,
                allowAccessTo: initialData.allowAccessTo,
            });
        } else {
            setFormData({
                ledgerId: nextLedgerId.toString(),
                ledgerName: '',
                groupedUnder: null,
                allowAccessTo: [],
            });
        }
    }, [initialData, nextLedgerId]);

    const handleChange = (field: keyof AccountsLedgerFormData, value: string | null) => {
        setFormData((prev) => ({ ...prev, [field]: value }));
    };

    const toggleAccess = (value: 'H.O' | 'B.O') => {
        setFormData((prev) => ({
            ...prev,
            allowAccessTo: prev.allowAccessTo.includes(value)
                ? prev.allowAccessTo.filter((v) => v !== value)
                : [...prev.allowAccessTo, value],
        }));
    };

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        if (!formData.ledgerName.trim()) {
            toast({
                title: 'Validation Error',
                description: 'Ledger Name is required.',
                variant: 'destructive',
            });
            return;
        }

        if (!formData.groupedUnder) {
            toast({
                title: 'Validation Error',
                description: 'Please select a group.',
                variant: 'destructive',
            });
            return;
        }

        if (formData.allowAccessTo.length === 0) {
            toast({
                title: 'Validation Error',
                description: 'Please select access permission.',
                variant: 'destructive',
            });
            return;
        }

        // Check for duplicate name
        // Note: In real app, this would check against existing ledgers
        setIsLoading(true);
        await new Promise((resolve) => setTimeout(resolve, 800));
        setIsLoading(false);

        if (onSave) {
            onSave(formData);
        }

        toast({
            title: isEditMode ? 'Ledger Updated' : 'Ledger Created',
            description: `Ledger "${formData.ledgerName}" has been ${isEditMode ? 'updated' : 'created'} successfully.`,
        });

        // Reset form if creating new
        if (!isEditMode) {
            setFormData({
                ledgerId: (nextLedgerId + 1).toString(),
                ledgerName: '',
                groupedUnder: null,
                allowAccessTo: [],
            });
        }
    };

    const handleReset = () => {
        setFormData({
            ledgerId: nextLedgerId.toString(),
            ledgerName: '',
            groupedUnder: null,
            allowAccessTo: [],
        });
        toast({
            title: 'Form Reset',
            description: 'All form fields have been cleared.',
        });
    };

    const selectedGroup = accountGroups.find((g) => g.id === formData.groupedUnder);

    return (
        <form onSubmit={handleSubmit} className="flex flex-col gap-5" aria-label="Accounts Ledger form">
            {/* Ledger ID */}
            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <Label
                        htmlFor="ledgerId"
                        className="text-sm font-semibold text-sidebar-accent dark:text-slate-200"
                    >
                        Ledger Id
                    </Label>
                    <Badge variant="secondary" className="text-xs font-normal bg-brand-green-tint text-slate-500 hover:bg-brand-green-tint dark:bg-sidebar-accent dark:text-slate-400">
                        Auto-generated
                    </Badge>
                </div>
                <Input
                    id="ledgerId"
                    type="text"
                    value={formData.ledgerId}
                    readOnly
                    className={cn(
                        'h-10 w-full border border-primary/30 text-sm font-medium',
                        'bg-green-50 text-slate-500 cursor-not-allowed',
                        'dark:bg-brand-green-darker dark:border-sidebar-accent dark:text-slate-400'
                    )}
                />
            </div>

            {/* Ledger Name */}
            <div className="space-y-2">
                <Label
                    htmlFor="ledgerName"
                    className="text-sm font-semibold text-sidebar-accent dark:text-slate-200"
                >
                    Ledger Name
                </Label>
                <Input
                    id="ledgerName"
                    type="text"
                    value={formData.ledgerName}
                    onChange={(event) => handleChange('ledgerName', event.target.value)}
                    className={cn(
                        'h-10 w-full border border-primary/30 text-sm font-medium',
                        'bg-green-50 hover:border-primary focus:border-primary focus:ring-2 focus:ring-primary/20',
                        'dark:bg-brand-green-darker dark:border-sidebar-accent',
                        nameLocked && 'cursor-not-allowed opacity-60'
                    )}
                    placeholder="Enter Ledger Name"
                    disabled={isLoading || nameLocked}
                    readOnly={nameLocked}
                    maxLength={100}
                    autoFocus={!isEditMode}
                />
                <p className="text-xs text-slate-500 dark:text-slate-400">
                    {formData.ledgerName.length}/100 characters
                </p>
                {nameLocked && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                        Only Admin can rename an existing ledger.
                    </p>
                )}
            </div>

            {/* Grouped Under */}
            <div className="space-y-2">
                <Label
                    htmlFor="groupedUnder"
                    className="text-sm font-semibold text-sidebar-accent dark:text-slate-200"
                >
                    Grouped Under
                </Label>
                <Select
                    value={formData.groupedUnder || ''}
                    onValueChange={(value) => handleChange('groupedUnder', value || null)}
                    disabled={isLoading || isLocked}
                >
                    <SelectTrigger
                        id="groupedUnder"
                        className={cn(
                            'h-10 w-full border border-primary/30 text-sm font-medium',
                            'bg-green-50 hover:border-primary focus:border-primary focus:ring-2 focus:ring-primary/20',
                            'dark:bg-brand-green-darker dark:border-sidebar-accent',
                            isLocked && 'cursor-not-allowed opacity-60'
                        )}
                        disabled={isLoading || isLocked}
                    >
                        <SelectValue placeholder="-- SELECT --" />
                    </SelectTrigger>
                    <SelectContent>
                        {accountGroups.map((group) => (
                            <SelectItem key={group.id} value={group.id}>
                                <div className="flex items-center gap-2">
                                    <span>{group.name}</span>
                                    <Badge variant="outline" className="text-xs ml-auto">
                                        Parent: {group.parentGroupName} (#{group.parentGroupId})
                                    </Badge>
                                </div>
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                {selectedGroup && (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                        Group: {selectedGroup.name} — Parent Group: {selectedGroup.parentGroupName} (#{selectedGroup.parentGroupId})
                    </p>
                )}
                {isLocked && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                        Group is locked — this ledger has recorded transactions.
                    </p>
                )}
            </div>

            {/* Allow Access To */}
            <div className="space-y-3">
                <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                    Allow Access To
                </Label>
                <div className="flex items-center gap-8">
                    <div className="flex items-center gap-2 cursor-pointer">
                        <Checkbox
                            id="ho"
                            checked={formData.allowAccessTo.includes('H.O')}
                            onCheckedChange={() => toggleAccess('H.O')}
                            disabled={isLoading}
                        />
                        <Label
                            htmlFor="ho"
                            className="text-sm font-normal text-sidebar-accent dark:text-slate-300 cursor-pointer"
                        >
                            H.O
                        </Label>
                    </div>

                    <div className="flex items-center gap-2 cursor-pointer">
                        <Checkbox
                            id="bo"
                            checked={formData.allowAccessTo.includes('B.O')}
                            onCheckedChange={() => toggleAccess('B.O')}
                            disabled={isLoading}
                        />
                        <Label
                            htmlFor="bo"
                            className="text-sm font-normal text-sidebar-accent dark:text-slate-300 cursor-pointer"
                        >
                            B.O
                        </Label>
                    </div>
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

