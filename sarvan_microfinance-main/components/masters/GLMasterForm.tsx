'use client';

import { useEffect, useState } from 'react';
import { BookOpen, Save, RefreshCw, Layers, FileText, BadgeCheck } from 'lucide-react';
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
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';

export interface GLMasterFormData {
    glId: string;
    glName: string;
    glType: 'PRINCIPLE' | 'INTEREST' | '';
    description?: string;
}

interface GLMasterFormProps {
    initialData?: GLMasterFormData;
    onSave?: (data: GLMasterFormData) => void;
}

export function GLMasterForm({ initialData, onSave }: GLMasterFormProps) {
    const [formData, setFormData] = useState<GLMasterFormData>({
        glId: initialData?.glId || '',
        glName: initialData?.glName || '',
        glType: initialData?.glType || '',
        description: initialData?.description || '',
    });
    const [isLoading, setIsLoading] = useState(false);
    const { toast } = useToast();

    useEffect(() => {
        if (initialData) {
            setFormData({
                glId: initialData.glId,
                glName: initialData.glName,
                glType: initialData.glType,
                description: initialData.description || '',
            });
        }
    }, [initialData]);

    const handleChange = (field: keyof GLMasterFormData, value: string) => {
        setFormData((prev) => ({ ...prev, [field]: value }));
    };

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        if (!formData.glName || !formData.glType) {
            toast({
                title: 'Validation Error',
                description: 'GL Name and GL Type are required fields.',
                variant: 'destructive',
            });
            return;
        }

        setIsLoading(true);
        if (onSave) {
            await onSave(formData);
        }
        setIsLoading(false);

        if (!initialData) {
            handleReset();
        }
    };

    const handleReset = () => {
        setFormData({
            glId: '',
            glName: '',
            glType: '',
            description: '',
        });
    };

    const isDisabled = isLoading;

    return (
        <div className="relative w-full max-w-5xl">
            {/* Background Accent */}
            <div className="absolute -inset-4 -z-10 rounded-3xl bg-gradient-to-r from-primary/15 via-primary/10 to-primary/15 blur-2xl" />

            {/* Main Card */}
            <div className="relative overflow-hidden rounded-3xl border border-primary/20/80 bg-white/95 shadow-2xl dark:border-sidebar-accent/60 dark:bg-brand-green-darker/95">
                {/* Top Gradient Bar */}
                <div className="h-1.5 bg-gradient-to-r from-primary via-primary to-primary bg-[length:200%_100%] animate-shimmer" />

                {/* Header */}
                <div className="bg-gradient-to-r from-slate-50 via-green-50/60 to-green-50/60 px-4 sm:px-8 py-6 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                    <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-4">
                            <div className="relative flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary shadow-lg shadow-primary/30">
                                <BookOpen className="h-6 w-6 text-white" />
                            </div>
                            <div className="flex flex-col gap-0.5">
                                <div className="flex items-center gap-2">
                                    <h1 className="text-xl font-semibold tracking-tight text-foreground dark:text-white">
                                        GL Master
                                    </h1>
                                    <Badge variant="secondary" className="bg-primary/10 text-primary dark:bg-brand-green-darker/30 dark:text-primary border-none px-2 py-0 h-5 text-[10px] font-bold uppercase tracking-wider">
                                        Accounting
                                    </Badge>
                                </div>
                                <p className="text-xs text-sidebar-accent dark:text-slate-400">
                                    Create and manage General Ledger accounts for Principal and Interest.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Form Section */}
                <div className="px-4 sm:px-8 py-8">
                    <form onSubmit={handleSubmit} className="flex flex-col gap-8" aria-label="GL Master form">
                        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
                            {/* GL ID - Auto-generated field */}
                            <div className="space-y-2.5">
                                <Label
                                    htmlFor="glId"
                                    className="text-sm font-bold text-sidebar-accent dark:text-slate-300 flex items-center gap-2"
                                >
                                    GL Account ID
                                    <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-4 border-primary/30 text-slate-500 font-medium">
                                        Auto-generated
                                    </Badge>
                                </Label>
                                <div className="relative group">
                                    <Input
                                        id="glId"
                                        type="text"
                                        value={formData.glId || 'System Generated'}
                                        readOnly
                                        className={cn(
                                            'h-12 w-full border-primary/20 text-sm font-semibold tracking-wide',
                                            'bg-green-50/50 text-slate-500 border-dashed cursor-not-allowed',
                                            'dark:bg-sidebar-accent/40 dark:border-sidebar-accent dark:text-slate-400'
                                        )}
                                        disabled={true}
                                    />
                                    <BadgeCheck className="absolute right-3 top-1/2 -translate-y-1/2 h-5 w-5 text-primary/50" />
                                </div>
                            </div>

                            {/* GL Type Selection */}
                            <div className="space-y-2.5 lg:col-span-1">
                                <Label
                                    htmlFor="glType"
                                    className="text-sm font-bold text-sidebar-accent dark:text-slate-300 flex items-center gap-2"
                                >
                                    <Layers className="h-4 w-4 text-primary dark:text-primary" />
                                    GL Category Type
                                </Label>
                                <Select
                                    value={formData.glType}
                                    onValueChange={(value) => handleChange('glType', value as any)}
                                >
                                    <SelectTrigger
                                        id="glType"
                                        className={cn(
                                            'h-12 w-full border-primary/20 text-sm font-medium transition-all duration-200',
                                            'bg-white hover:border-primary focus:border-primary focus:ring-4 focus:ring-primary/10',
                                            'dark:bg-brand-green-darker dark:border-sidebar-accent'
                                        )}
                                        disabled={isDisabled}
                                    >
                                        <SelectValue placeholder="Select GL Category" />
                                    </SelectTrigger>
                                    <SelectContent className="border-primary/20 dark:border-sidebar-accent shadow-xl">
                                        <SelectItem value="PRINCIPLE" className="focus:bg-green-50 focus:text-primary dark:focus:bg-brand-green-darker/30 dark:focus:text-primary">
                                            Principle GL
                                        </SelectItem>
                                        <SelectItem value="INTEREST" className="focus:bg-green-50 focus:text-primary dark:focus:bg-brand-green-darker/30 dark:focus:text-primary">
                                            Interest GL
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* GL Name */}
                            <div className="space-y-2.5 md:col-span-2 lg:col-span-1">
                                <Label
                                    htmlFor="glName"
                                    className="text-sm font-bold text-sidebar-accent dark:text-slate-300 flex items-center gap-2"
                                >
                                    <FileText className="h-4 w-4 text-primary dark:text-primary" />
                                    GL Account Name
                                </Label>
                                <Input
                                    id="glName"
                                    type="text"
                                    value={formData.glName}
                                    onChange={(event) => handleChange('glName', event.target.value)}
                                    className={cn(
                                        'h-12 w-full border-primary/20 text-sm font-medium transition-all duration-200',
                                        'bg-white hover:border-primary focus:border-primary focus:ring-4 focus:ring-primary/10',
                                        'dark:bg-brand-green-darker dark:border-sidebar-accent'
                                    )}
                                    placeholder="e.g. Loan Disbursement Account"
                                    disabled={isDisabled}
                                />
                            </div>

                            {/* Description - Full width */}
                            <div className="space-y-2.5 md:col-span-2 lg:col-span-3">
                                <Label
                                    htmlFor="description"
                                    className="text-sm font-bold text-sidebar-accent dark:text-slate-300"
                                >
                                    Description (Optional)
                                </Label>
                                <Input
                                    id="description"
                                    type="text"
                                    value={formData.description}
                                    onChange={(event) => handleChange('description', event.target.value)}
                                    className={cn(
                                        'h-12 w-full border-primary/20 text-sm font-medium transition-all duration-200',
                                        'bg-white hover:border-primary focus:border-primary focus:ring-4 focus:ring-primary/10',
                                        'dark:bg-brand-green-darker dark:border-sidebar-accent'
                                    )}
                                    placeholder="Enter account description and purpose..."
                                    disabled={isDisabled}
                                />
                            </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex flex-wrap items-center justify-end gap-4 pt-4 border-t border-slate-100 dark:border-sidebar-accent">
                            <Button
                                type="button"
                                variant="ghost"
                                onClick={handleReset}
                                disabled={isDisabled}
                                className="h-11 px-6 text-sm font-bold text-slate-500 hover:text-foreground hover:bg-brand-green-tint dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-sidebar-accent"
                            >
                                <RefreshCw className="mr-2 h-4 w-4" />
                                Reset Form
                            </Button>

                            <Button
                                type="submit"
                                disabled={isDisabled}
                                className="h-11 px-10 text-sm font-bold bg-primary hover:bg-sidebar-accent text-white shadow-lg shadow-primary dark:shadow-none transition-all duration-200 active:scale-[0.98]"
                            >
                                {isLoading ? (
                                    <span className="flex items-center gap-2">
                                        <RefreshCw className="h-4 w-4 animate-spin" />
                                        Processing...
                                    </span>
                                ) : (
                                    <span className="flex items-center gap-2">
                                        <Save className="h-4 w-4" />
                                        Save GL Account
                                    </span>
                                )}
                            </Button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}
