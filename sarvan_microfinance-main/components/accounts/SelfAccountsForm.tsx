'use client';

import { useState, useEffect } from 'react';
import { Save, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { Textarea } from '@/components/ui/textarea'; // Assuming Textarea component exists
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';

export interface SelfAccountsFormData {
    name: string;
    description: string;
    type: 'CASH' | 'BANK' | '';
}

interface SelfAccountsFormProps {
    initialData?: SelfAccountsFormData;
    onSave?: (data: SelfAccountsFormData) => void;
}

export function SelfAccountsForm({
    initialData,
    onSave,
}: SelfAccountsFormProps) {
    const [formData, setFormData] = useState<SelfAccountsFormData>({
        name: initialData?.name || '',
        description: initialData?.description || '',
        type: initialData?.type || '',
    });
    const [isLoading, setIsLoading] = useState(false);
    const { toast } = useToast();

    const isEditMode = !!initialData;

    // Update form data when initialData changes
    useEffect(() => {
        if (initialData) {
            setFormData({
                name: initialData.name,
                description: initialData.description || '',
                type: initialData.type || '',
            });
        } else {
            setFormData({
                name: '',
                description: '',
                type: '',
            });
        }
    }, [initialData]);

    const handleChange = (field: keyof SelfAccountsFormData, value: string) => {
        setFormData((prev) => ({ ...prev, [field]: value }));
    };

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        if (!formData.name.trim()) {
            toast({
                title: 'Validation Error',
                description: 'Account Name is required.',
                variant: 'destructive',
            });
            return;
        }

        if (!formData.type) {
            toast({
                title: 'Validation Error',
                description: 'Type is required.',
                variant: 'destructive',
            });
            return;
        }

        setIsLoading(true);
        // Simulate loading for UI smoothness
        await new Promise((resolve) => setTimeout(resolve, 800));
        setIsLoading(false);

        if (onSave) {
            onSave(formData);
        }

        // Reset form if creating new, keep if editing (or clear selection via parent)
        if (!isEditMode) {
             setFormData({
                name: '',
                description: '',
                type: '',
            });
        }
    };

    const handleReset = () => {
        setFormData({
            name: '',
            description: '',
            type: '',
        });
        toast({
            title: 'Form Reset',
            description: 'All form fields have been cleared.',
        });
    };

    return (
        <form onSubmit={handleSubmit} className="flex flex-col gap-5" aria-label="Self Accounts form">
            {/* Account Name */}
            <div className="space-y-2">
                <Label
                    htmlFor="accountName"
                    className="text-sm font-semibold text-sidebar-accent dark:text-slate-200"
                >
                    Account Name
                </Label>
                <Input
                    id="accountName"
                    type="text"
                    value={formData.name}
                    onChange={(event) => handleChange('name', event.target.value)}
                    className={cn(
                        'h-10 w-full border border-primary/30 text-sm font-medium',
                        'bg-green-50 hover:border-primary focus:border-primary focus:ring-2 focus:ring-primary/20',
                        'dark:bg-brand-green-darker dark:border-sidebar-accent'
                    )}
                    placeholder="Enter Account Name"
                    disabled={isLoading}
                    maxLength={100}
                    autoFocus
                />
                <p className="text-xs text-slate-500 dark:text-slate-400">
                    {formData.name.length}/100 characters
                </p>
            </div>

            {/* Type */}
            <div className="space-y-2">
                <Label
                    htmlFor="type"
                    className="text-sm font-semibold text-sidebar-accent dark:text-slate-200"
                >
                    Type
                </Label>
                <Select
                    value={formData.type}
                    onValueChange={(value) => handleChange('type', value)}
                    disabled={isLoading}
                >
                    <SelectTrigger
                        id="type"
                        className={cn(
                            'h-10 w-full border border-primary/30 text-sm font-medium',
                            'bg-green-50 hover:border-primary focus:border-primary focus:ring-2 focus:ring-primary/20',
                            'dark:bg-brand-green-darker dark:border-sidebar-accent'
                        )}
                    >
                        <SelectValue placeholder="Select Type" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="CASH">Cash</SelectItem>
                        <SelectItem value="BANK">Bank</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            {/* Description */}
            <div className="space-y-2">
                <Label
                    htmlFor="description"
                    className="text-sm font-semibold text-sidebar-accent dark:text-slate-200"
                >
                    Description
                </Label>
                <Textarea
                    id="description"
                    value={formData.description}
                    onChange={(event) => handleChange('description', event.target.value)}
                    className={cn(
                        'min-h-[100px] w-full border border-primary/30 text-sm font-medium',
                        'bg-green-50 hover:border-primary focus:border-primary focus:ring-2 focus:ring-primary/20',
                        'dark:bg-brand-green-darker dark:border-sidebar-accent'
                    )}
                    placeholder="Enter Description (Optional)"
                    disabled={isLoading}
                />
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
