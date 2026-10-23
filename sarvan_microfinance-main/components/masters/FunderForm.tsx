'use client';

import { useState, useEffect } from 'react';
import {
    Wallet,
    Save,
    RefreshCw,
    Percent,
    FileText,
    Trash2,
    Zap,
    ShieldCheck,
    Users,
    Loader2
} from 'lucide-react';
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

export interface FunderFormData {
    funderId: string;
    funderName: string;
    principleGL: string;
    interestGL: string;
    interestPercent: string;
    tdsPercent: string;
}

interface FunderFormProps {
    initialData?: FunderFormData;
    onSave?: (data: FunderFormData) => Promise<void>;
    onDelete?: (funderId: string) => Promise<void>;
    glAccounts: { id: string, name: string, type: string }[];
}

export function FunderForm({ initialData, onSave, onDelete, glAccounts }: FunderFormProps) {
    const [formData, setFormData] = useState<FunderFormData>({
        funderId: initialData?.funderId || '',
        funderName: initialData?.funderName || '',
        principleGL: initialData?.principleGL || '',
        interestGL: initialData?.interestGL || '',
        interestPercent: initialData?.interestPercent || '',
        tdsPercent: initialData?.tdsPercent || '',
    });
    const [isLoading, setIsLoading] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const { toast } = useToast();

    // Filter GL accounts based on type
    const principleGLOptions = glAccounts.filter(gl => gl.type === 'PRINCIPLE');
    const interestGLOptions = glAccounts.filter(gl => gl.type === 'INTEREST');

    useEffect(() => {
        if (initialData) {
            setFormData({
                funderId: initialData.funderId,
                funderName: initialData.funderName,
                principleGL: initialData.principleGL,
                interestGL: initialData.interestGL,
                interestPercent: String(initialData.interestPercent),
                tdsPercent: String(initialData.tdsPercent),
            });
        } else {
            handleReset();
        }
    }, [initialData]);

    const handleChange = (field: keyof FunderFormData, value: string) => {
        setFormData((prev) => ({ ...prev, [field]: value }));
    };

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        if (!formData.funderName || !formData.principleGL || !formData.interestGL) {
            toast({
                title: 'Validation Error',
                description: 'Funder Name, Principal GL, and Interest GL are required fields.',
                variant: 'destructive',
            });
            return;
        }

        setIsLoading(true);
        try {
            if (onSave) {
                await onSave(formData);
                if (!initialData) handleReset();
            }
        } finally {
            setIsLoading(false);
        }
    };

    const handleDelete = async () => {
        if (!initialData?.funderId || !onDelete) return;

        setIsDeleting(true);
        try {
            await onDelete(initialData.funderId);
            handleReset();
        } finally {
            setIsDeleting(false);
        }
    };

    const handleReset = () => {
        setFormData({
            funderId: '',
            funderName: '',
            principleGL: '',
            interestGL: '',
            interestPercent: '',
            tdsPercent: '',
        });
    };

    const isEditMode = !!initialData?.funderId;

    return (
        <div className="relative w-full mb-8 transition-all duration-300 animate-in fade-in">
            <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden mb-6">
                <div className="h-1.5 bg-gradient-to-r from-primary via-primary to-violet-600" />
                <CardHeader className="bg-gradient-to-r from-slate-50 via-green-50/60 to-green-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker pb-4">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-green-tint dark:bg-brand-green-darker/30">
                                <Wallet className="h-5 w-5 text-primary dark:text-primary" />
                            </div>
                            <div>
                                <h3 className="text-lg font-semibold text-sidebar-accent dark:text-slate-200">
                                    {isEditMode ? 'Modify Funder Details' : 'Register New Funder'}
                                </h3>
                            </div>
                        </div>

                        {isEditMode && (
                            <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-green-50 dark:bg-brand-green-darker/30 rounded-lg border border-primary dark:border-primary animate-in zoom-in-95">
                                <ShieldCheck className="w-4 h-4 text-primary dark:text-primary" />
                                <span className="text-xs font-bold text-primary dark:text-primary tracking-wide uppercase">Editing ID: {initialData.funderId}</span>
                            </div>
                        )}
                    </div>
                </CardHeader>

                <CardContent className="pt-6">
                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-6">

                            {/* Funder Identification */}
                            <div className="space-y-2 lg:col-span-2">
                                <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                    Funder ID
                                </Label>
                                <div className="relative group">
                                    <Input
                                        value={formData.funderId || 'System Generated'}
                                        disabled
                                        className="h-11 border-primary/30 dark:border-sidebar-accent bg-green-50 dark:bg-brand-green-darker text-slate-500 font-mono pl-10 cursor-not-allowed"
                                    />
                                    <Zap className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-amber-500 opacity-60" />
                                </div>
                            </div>

                            <div className="space-y-2 lg:col-span-4">
                                <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                    Funder Name
                                </Label>
                                <div className="relative group">
                                    <Input
                                        placeholder="E.g., SIDBI Microfinance Fund"
                                        value={formData.funderName}
                                        onChange={(e) => handleChange('funderName', e.target.value)}
                                        className="h-11 border-primary/30 dark:border-sidebar-accent bg-white dark:bg-brand-green-darker text-sidebar-accent dark:text-slate-200 pl-10"
                                        required
                                    />
                                    <Users className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary opacity-70" />
                                </div>
                            </div>

                            {/* Financial Mappings */}
                            <div className="space-y-2 lg:col-span-3">
                                <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                    Principal GL Mapping
                                </Label>
                                <Select
                                    value={formData.principleGL}
                                    onValueChange={(v) => handleChange('principleGL', v)}
                                    required
                                >
                                    <SelectTrigger className="h-11 border-primary/30 dark:border-sidebar-accent bg-white dark:bg-brand-green-darker text-sidebar-accent dark:text-slate-200">
                                        <SelectValue placeholder="-- SELECT PRINCIPAL GL --" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {principleGLOptions.map(gl => (
                                            <SelectItem key={gl.id} value={gl.id}>{gl.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2 lg:col-span-3">
                                <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                    Interest GL Mapping
                                </Label>
                                <Select
                                    value={formData.interestGL}
                                    onValueChange={(v) => handleChange('interestGL', v)}
                                    required
                                >
                                    <SelectTrigger className="h-11 border-primary/30 dark:border-sidebar-accent bg-white dark:bg-brand-green-darker text-sidebar-accent dark:text-slate-200">
                                        <SelectValue placeholder="-- SELECT INTEREST GL --" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {interestGLOptions.map(gl => (
                                            <SelectItem key={gl.id} value={gl.id}>{gl.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="grid grid-cols-2 gap-6 md:col-span-6 lg:col-span-2">
                                <div className="space-y-2">
                                    <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">Interest Rate (%)</Label>
                                    <div className="relative group">
                                        <Input
                                            type="number"
                                            step="0.01"
                                            value={formData.interestPercent}
                                            onChange={(e) => handleChange('interestPercent', e.target.value)}
                                            className="h-11 border-primary/30 dark:border-sidebar-accent bg-white dark:bg-brand-green-darker focus:border-primary pr-10"
                                            placeholder="0.00"
                                        />
                                        <Percent className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">TDS Deduction (%)</Label>
                                    <div className="relative group">
                                        <Input
                                            type="number"
                                            step="0.01"
                                            value={formData.tdsPercent}
                                            onChange={(e) => handleChange('tdsPercent', e.target.value)}
                                            className="h-11 border-primary/30 dark:border-sidebar-accent bg-white dark:bg-brand-green-darker focus:border-primary pr-10"
                                            placeholder="0.00"
                                        />
                                        <Percent className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Action Suite */}
                        <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 dark:border-sidebar-accent">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={handleReset}
                                className="h-10 border-primary/30 text-sidebar-accent hover:bg-green-50 dark:border-sidebar-accent/60 dark:text-slate-300 font-medium transition-colors"
                            >
                                <RefreshCw className="w-4 h-4 mr-2" />
                                Reset
                            </Button>

                            {isEditMode && (
                                <Button
                                    type="button"
                                    onClick={handleDelete}
                                    disabled={isDeleting}
                                    className="h-10 bg-rose-500 hover:bg-rose-600 text-white transition-colors"
                                >
                                    {isDeleting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Trash2 className="w-4 h-4 mr-2" />}
                                    Delete
                                </Button>
                            )}

                            <Button
                                type="submit"
                                disabled={isLoading}
                                className="h-10 bg-gradient-to-r from-primary to-primary hover:from-sidebar-accent hover:to-primary text-white shadow-md font-semibold"
                            >
                                {isLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                                {isEditMode ? 'Update' : 'Save'} Funder
                            </Button>
                        </div>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
